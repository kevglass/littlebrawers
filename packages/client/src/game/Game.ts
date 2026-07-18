import * as THREE from "three";
import { GAME_CONSTANTS, type GameSnapshotMessage, type MapData, type NetMessage } from "@brawlers/shared";
import type { NetworkManager } from "../net/NetworkManager";
import { CameraController } from "./CameraController";
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

  private inputSeq = 0;
  private inputAccumulator = 0;
  private snapshotAccumulator = 0;
  private latestSnapshot: GameSnapshotMessage | undefined;
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
    this.inputManager = new InputManager(this.renderer.domElement, this.cameraController.camera);

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.65));
    const sun = new THREE.DirectionalLight(0xffffff, 0.9);
    sun.position.set(-8, 20, 10);
    sun.castShadow = true;
    this.scene.add(sun);

    this.mapRenderer = new MapRenderer(info.mapData);
    this.scene.add(this.mapRenderer.group);

    for (const p of info.players) {
      const player = new Player(p.peerId, p.name, p.color, p.peerId === this.localPeerId);
      this.players.set(p.peerId, player);
      this.scene.add(player.group);
    }

    if (this.isHost) {
      this.simulation = new Simulation(info.mapData, info.players);
      const snapshot = this.simulation.getSnapshot();
      this.applySnapshot(snapshot, 1);
    }

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
      if (message.type === "input") this.simulation?.applyInput(fromPeerId, message);
    } else if (message.type === "snapshot") {
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

  private animate = (): void => {
    if (this.disposed) return;
    this.animationHandle = requestAnimationFrame(this.animate);

    const dt = Math.min(this.clock.getDelta(), 0.1);
    const nowMs = performance.now();
    const localPlayer = this.players.get(this.localPeerId);
    const localPos = localPlayer?.group.position ?? new THREE.Vector3();
    const localInput = this.inputManager.sample(localPos.x, localPos.z);

    if (this.isHost && this.simulation) {
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

      this.snapshotAccumulator += dt;
      const snapshot = this.simulation.getSnapshot();
      this.applySnapshot(snapshot, 1);
      if (this.snapshotAccumulator >= 1 / SNAPSHOT_SEND_HZ) {
        this.snapshotAccumulator = 0;
        this.network.broadcast(snapshot);
      }
    } else {
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
      }
      if (this.latestSnapshot) this.applySnapshot(this.latestSnapshot, REMOTE_LERP_FACTOR);
    }

    if (localPlayer) this.cameraController.follow(localPlayer.group.position.x, localPlayer.group.position.z);
    for (const player of this.players.values()) player.faceCameraBillboards(this.cameraController.camera.quaternion);

    this.renderer.render(this.scene, this.cameraController.camera);
  };

  private applySnapshot(snapshot: GameSnapshotMessage, lerpFactor: number): void {
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
    }
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.animationHandle);
    window.removeEventListener("resize", this.onResize);
    this.inputManager.dispose();
    this.mapRenderer.dispose();
    for (const player of this.players.values()) player.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
