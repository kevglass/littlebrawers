import * as THREE from "three";
import { GAME_CONSTANTS, type GameSnapshotMessage, type MapData, type NetMessage } from "@brawlers/shared";
import type { NetworkManager } from "../net/NetworkManager";
import { CameraController } from "./CameraController";
import { toCharacterModelId } from "./CharacterModel";
import { InputManager } from "./InputManager";
import { MapRenderer } from "./MapRenderer";
import { Player } from "./Player";
import { Simulation, type SimPlayerInfo } from "./Simulation";

export interface GameStartInfo {
  mapData: MapData;
  players: SimPlayerInfo[];
  localPeerId: string;
}

const INPUT_SEND_HZ = 30;
const SNAPSHOT_SEND_HZ = GAME_CONSTANTS.SNAPSHOT_RATE_HZ;
const REMOTE_LERP_FACTOR = 0.35;

export class Game {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly cameraController: CameraController;
  private readonly mapRenderer: MapRenderer;
  private readonly inputManager: InputManager;
  private readonly players = new Map<string, Player>();
  private readonly simulation: Simulation | undefined;
  private readonly clock = new THREE.Clock();
  private readonly localPeerId: string;
  private readonly isHost: boolean;

  private readonly statusEl: HTMLElement;
  private readonly remotePeers: { peerId: string; name: string }[];

  private inputSeq = 0;
  private inputAccumulator = 0;
  private snapshotAccumulator = 0;
  private statusAccumulator = 0;
  private latestSnapshot: GameSnapshotMessage | undefined;
  private lastInputSentAt = 0;
  private readonly lastInputRecvAt = new Map<string, number>();
  private lastSnapshotSentAt = 0;
  private lastSnapshotRecvAt = 0;
  private lastHostTickAt = 0;
  private hostTickTimer: ReturnType<typeof setInterval> | undefined;
  private signalingStopTimer: ReturnType<typeof setTimeout> | undefined;
  private animationHandle = 0;
  private disposed = false;

  constructor(
    private readonly container: HTMLElement,
    private readonly network: NetworkManager,
    info: GameStartInfo,
  ) {
    this.localPeerId = info.localPeerId;
    this.isHost = network.isHost;

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.shadowMap.enabled = true;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(this.renderer.domElement);

    this.cameraController = new CameraController(container.clientWidth / container.clientHeight);
    this.inputManager = new InputManager(this.renderer.domElement, this.cameraController.camera, container);

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.65));
    const sun = new THREE.DirectionalLight(0xffffff, 0.9);
    sun.position.set(-8, 20, 10);
    sun.castShadow = true;
    this.scene.add(sun);

    this.mapRenderer = new MapRenderer(info.mapData);
    this.scene.add(this.mapRenderer.group);

    for (const p of info.players) {
      const player = new Player(
        p.peerId,
        p.name,
        p.color,
        p.peerId === this.localPeerId,
        toCharacterModelId(p.characterModel),
      );
      this.players.set(p.peerId, player);
      this.scene.add(player.group);
    }

    this.remotePeers = info.players
      .filter((p) => p.peerId !== this.localPeerId && !p.isBot)
      .map((p) => ({ peerId: p.peerId, name: p.name }));
    this.statusEl = document.createElement("div");
    this.statusEl.className = "connection-status";
    this.container.appendChild(this.statusEl);

    if (this.isHost) {
      this.simulation = new Simulation(info.mapData, info.players);
      const snapshot = this.simulation.getSnapshot();
      this.applySnapshot(snapshot, 1, 0);
      this.lastHostTickAt = performance.now();
      // setInterval keeps the simulation alive when the tab is backgrounded (rAF stops there).
      // When the tab is visible, animate() runs the simulation at full frame rate instead.
      this.hostTickTimer = setInterval(this.hostTick, 1000 / SNAPSHOT_SEND_HZ);
    }

    // Stop signaling polling 30 seconds after game start — the ICE handshake window is closed
    // by then, so the polling serves no purpose and generates unnecessary server traffic.
    this.signalingStopTimer = setTimeout(() => network.stopSignaling(), 30_000);

    this.network.setCallbacks({
      onMessage: (fromPeerId, message) => this.handleNetMessage(fromPeerId, message),
      onPeerConnected: () => {},
      onPeerDisconnected: (peerId) => this.handlePeerDisconnected(peerId),
      onRosterUpdate: () => {},
    });

    window.addEventListener("resize", this.onResize);
    this.animate();
  }

  private handleNetMessage(fromPeerId: string, message: NetMessage): void {
    if (this.isHost) {
      if (message.type === "input") {
        this.lastInputRecvAt.set(fromPeerId, performance.now());
        this.simulation?.applyInput(fromPeerId, message);
      }
    } else if (message.type === "snapshot") {
      this.lastSnapshotRecvAt = performance.now();
      this.latestSnapshot = message;
    }
  }

  private handlePeerDisconnected(peerId: string): void {
    this.simulation?.removePlayer(peerId);
    this.players.get(peerId)?.setVisible(false);
  }

  private onResize = (): void => {
    this.cameraController.setAspect(this.container.clientWidth / this.container.clientHeight);
    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
  };

  /**
   * Fallback simulation tick that runs only when the tab is hidden (rAF stops there).
   * When the tab is visible, animate() runs the simulation at full frame rate instead,
   * which gives smooth 60fps rendering. The setInterval keeps clients alive if the host
   * tabs away.
   */
  private hostTick = (): void => {
    if (this.disposed || !this.simulation) return;
    if (!document.hidden) return; // animate() handles it while visible
    const nowMs = performance.now();
    const dt = Math.min((nowMs - this.lastHostTickAt) / 1000, 0.1);
    this.lastHostTickAt = nowMs;

    const localPlayer = this.players.get(this.localPeerId);
    const localPos = localPlayer?.group.position ?? new THREE.Vector3();
    const localInput = this.inputManager.sample(localPos.x, localPos.z);

    this.inputSeq += 1;
    this.simulation.applyInput(this.localPeerId, {
      type: "input",
      seq: this.inputSeq,
      moveX: localInput.moveX,
      moveY: localInput.moveY,
      aimX: localInput.aimX,
      aimY: localInput.aimZ,
      attack: localInput.attack,
    });
    this.simulation.step(dt, nowMs);

    const snapshot = this.simulation.getSnapshot();
    this.applySnapshot(snapshot, 1, dt);
    this.network.broadcast(snapshot);
    this.lastSnapshotSentAt = nowMs;
  };

  private animate = (): void => {
    if (this.disposed) return;
    this.animationHandle = requestAnimationFrame(this.animate);

    const dt = Math.min(this.clock.getDelta(), 0.1);
    const nowMs = performance.now();
    const localPlayer = this.players.get(this.localPeerId);

    this.inputManager.setOpponents(
      [...this.players.entries()]
        .filter(([peerId, p]) => peerId !== this.localPeerId && p.group.visible)
        .map(([peerId, p]) => ({ peerId, x: p.group.position.x, z: p.group.position.z })),
    );

    // Host: run simulation at full frame rate for smooth rendering. The hostTick setInterval
    // is skipped while the tab is visible and only takes over when it's hidden.
    if (this.isHost && this.simulation) {
      const localPos = localPlayer?.group.position ?? new THREE.Vector3();
      const localInput = this.inputManager.sample(localPos.x, localPos.z);
      this.inputSeq += 1;
      this.simulation.applyInput(this.localPeerId, {
        type: "input",
        seq: this.inputSeq,
        moveX: localInput.moveX,
        moveY: localInput.moveY,
        aimX: localInput.aimX,
        aimY: localInput.aimZ,
        attack: localInput.attack,
      });
      this.simulation.step(dt, nowMs);
      const snapshot = this.simulation.getSnapshot();
      this.applySnapshot(snapshot, 1, dt);
      this.snapshotAccumulator += dt;
      if (this.snapshotAccumulator >= 1 / SNAPSHOT_SEND_HZ) {
        this.snapshotAccumulator = 0;
        this.network.broadcast(snapshot);
        this.lastSnapshotSentAt = nowMs;
      }
      // Keep lastHostTickAt current so hostTick has a correct dt on first hidden tick.
      this.lastHostTickAt = nowMs;
    }

    if (!this.isHost) {
      const localPos = localPlayer?.group.position ?? new THREE.Vector3();
      const localInput = this.inputManager.sample(localPos.x, localPos.z);
      this.inputAccumulator += dt;
      if (this.inputAccumulator >= 1 / INPUT_SEND_HZ) {
        this.inputAccumulator = 0;
        this.inputSeq += 1;
        this.network.sendToHost({
          type: "input",
          seq: this.inputSeq,
          moveX: localInput.moveX,
          moveY: localInput.moveY,
          aimX: localInput.aimX,
          aimY: localInput.aimZ,
          attack: localInput.attack,
        });
        this.lastInputSentAt = nowMs;
      }
      if (this.latestSnapshot) this.applySnapshot(this.latestSnapshot, REMOTE_LERP_FACTOR, dt);
    }

    if (localPlayer) this.cameraController.follow(localPlayer.group.position.x, localPlayer.group.position.z, dt);
    for (const player of this.players.values()) player.faceCameraBillboards(this.cameraController.camera.quaternion);

    this.statusAccumulator += dt;
    if (this.statusAccumulator >= 0.25) {
      this.statusAccumulator = 0;
      this.updateConnectionStatus(nowMs);
    }

    this.renderer.render(this.scene, this.cameraController.camera);
  };

  private updateConnectionStatus(nowMs: number): void {
    const ago = (t: number): string => (t === 0 ? "never" : `${Math.round(nowMs - t)}ms ago`);
    const lines: string[] = [];
    if (this.isHost) {
      for (const peer of this.remotePeers) {
        const state = this.network.getPeerState(peer.peerId) ?? "no link";
        lines.push(`${peer.name}: ${state} — input ${ago(this.lastInputRecvAt.get(peer.peerId) ?? 0)}`);
      }
      lines.push(`snapshot sent ${ago(this.lastSnapshotSentAt)}`);
    } else {
      const state = this.network.getPeerState(this.network.hostPeerId) ?? "no link";
      lines.push(`Host: ${state}`);
      lines.push(`snapshot recv ${ago(this.lastSnapshotRecvAt)}`);
      lines.push(`input sent ${ago(this.lastInputSentAt)}`);
    }
    this.statusEl.textContent = lines.join("\n");
  }

  private applySnapshot(snapshot: GameSnapshotMessage, lerpFactor: number, dt: number): void {
    for (const snap of snapshot.players) {
      const player = this.players.get(snap.peerId);
      if (!player) continue;

      const factor = snap.peerId === this.localPeerId && this.isHost ? 1 : lerpFactor;
      const x = player.group.position.x + (snap.x - player.group.position.x) * factor;
      const z = player.group.position.z + (snap.y - player.group.position.z) * factor;
      player.setPosition(x, z);
      player.setAim(snap.aimX, snap.aimY);
      player.setHp(snap.hp, snap.maxHp);
      player.setVisible(snap.alive);
      player.updateAnimation(dt, snap.moving, snap.attackSeq);
    }
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.animationHandle);
    if (this.hostTickTimer) clearInterval(this.hostTickTimer);
    if (this.signalingStopTimer) clearTimeout(this.signalingStopTimer);
    window.removeEventListener("resize", this.onResize);
    this.inputManager.dispose();
    this.mapRenderer.dispose();
    for (const player of this.players.values()) player.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.statusEl.remove();
  }
}
