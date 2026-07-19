import { PLAYER_COLORS, type MapData, type NetMessage, type RosterEntry } from "@brawlers/shared";
import { NetworkManager } from "../net/NetworkManager";
import { SignalingClient } from "../net/SignalingClient";
import { getMap, listMaps } from "../net/MapApi";
import { buildDefaultMap } from "../maps/defaultMap";
import type { GameStartInfo } from "../game/Game";
import type { AuthState } from "../net/AuthClient";
import {
  CHARACTER_MODEL_IDS,
  DEFAULT_CHARACTER_MODEL,
  SELECTABLE_CHARACTER_MODELS,
  type CharacterModelId,
} from "../game/CharacterModel";
import { LobbyPreview } from "./LobbyPreview";

const MAX_PLAYERS = 4;
const COUNTDOWN_S = 10;
const BOT_NAMES = ["Bot Alpha", "Bot Beta", "Bot Gamma", "Bot Delta"];
const CHARACTER_MODEL_LABELS: Record<CharacterModelId, string> = { mina: "Mina", shelly: "Shelly" };

export class Lobby {
  private network: NetworkManager | undefined;
  private signalingClient: SignalingClient | undefined;
  private localPeerId = "";
  private isHost = false;
  private roster: RosterEntry[] = [];
  private openedAt = 0; // Unix timestamp (s)
  private countdownTimer: ReturnType<typeof setInterval> | undefined;
  private preview: LobbyPreview | undefined;
  private roomCode = "";
  private selectedCharacterModel: CharacterModelId = DEFAULT_CHARACTER_MODEL;
  private chosenMapId: string | undefined;
  private chosenMapName = "";

  constructor(
    private readonly root: HTMLElement,
    private readonly auth: AuthState,
    private readonly onStart: (network: NetworkManager, info: GameStartInfo) => void,
  ) {
    this.renderEntryScreen();
  }

  // ── Entry screen ───────────────────────────────────────────────────────────

  private renderEntryScreen(): void {
    this.clearCountdown();
    this.preview?.dispose();
    this.preview = undefined;
    this.root.innerHTML = "";

    const layout = el("div", "entry-layout");

    const previewPane = el("div", "preview-pane");
    const canvas = document.createElement("canvas");
    canvas.className = "preview-canvas";
    previewPane.appendChild(canvas);
    layout.appendChild(previewPane);

    const panelPane = el("div", "panel-pane");
    const panel = el("div", "panel");

    const title = el("h1", "title");
    title.textContent = "Little Brawlers";
    panel.appendChild(title);

    const greeting = el("p", "status-text");
    greeting.textContent = `Playing as ${this.auth.username}${this.auth.token ? " ✓" : " (guest)"}`;
    greeting.style.color = this.auth.token ? "#2ecc71" : "#9aa4b8";
    panel.appendChild(greeting);

    const modelLabel = el("label", "field-label");
    modelLabel.textContent = "Character";
    panel.appendChild(modelLabel);

    const modelTabs = el("div", "auth-tabs");
    for (const modelId of CHARACTER_MODEL_IDS) {
      const selectable = SELECTABLE_CHARACTER_MODELS.includes(modelId);
      const tab = el("button", "auth-tab") as HTMLButtonElement;
      tab.textContent = selectable ? CHARACTER_MODEL_LABELS[modelId] : `${CHARACTER_MODEL_LABELS[modelId]} (soon)`;
      if (modelId === this.selectedCharacterModel) tab.classList.add("active");
      if (!selectable) {
        tab.disabled = true;
        tab.title = "Coming soon";
      } else {
        tab.onclick = () => {
          this.selectedCharacterModel = modelId;
          for (const sibling of modelTabs.children) sibling.classList.toggle("active", sibling === tab);
          this.preview?.setModel(modelId);
        };
      }
      modelTabs.appendChild(tab);
    }
    panel.appendChild(modelTabs);

    const playBtn = el("button", "primary-button") as HTMLButtonElement;
    playBtn.textContent = "Play!";
    playBtn.onclick = () => void this.findMatch(playBtn);
    panel.appendChild(playBtn);

    const status = el("p", "status-text");
    panel.appendChild(status);
    this.statusEl = status;

    panelPane.appendChild(panel);
    layout.appendChild(panelPane);
    this.root.appendChild(layout);

    this.preview = new LobbyPreview(canvas, this.selectedCharacterModel);
    const onResize = () => this.preview?.resize(previewPane.clientWidth, previewPane.clientHeight);
    window.addEventListener("resize", onResize);
    const orig = this.preview.dispose.bind(this.preview);
    this.preview.dispose = () => { window.removeEventListener("resize", onResize); orig(); };
  }

  // ── Matchmaking ────────────────────────────────────────────────────────────

  private async findMatch(btn: HTMLButtonElement): Promise<void> {
    btn.disabled = true;
    btn.textContent = "Finding match…";
    this.setStatus("");
    try {
      const result = await SignalingClient.findMatch(this.auth.username, this.selectedCharacterModel, this.auth.token);
      this.localPeerId = result.peerId;
      this.isHost = result.isHost;
      this.openedAt = result.openedAt;
      this.roomCode = result.roomCode;

      if (this.isHost) {
        // Pick the arena up-front so it's visible on the waiting screen.
        void listMaps().then((maps) => {
          if (maps.length > 0) {
            const picked = maps[Math.floor(Math.random() * maps.length)]!;
            this.chosenMapId = picked.id;
            this.chosenMapName = picked.name;
          } else {
            this.chosenMapName = "Default Arena";
          }
          if (this.arenaNameEl) this.arenaNameEl.textContent = `Arena: ${this.chosenMapName}`;
        }).catch(() => {
          this.chosenMapName = "Default Arena";
          if (this.arenaNameEl) this.arenaNameEl.textContent = `Arena: ${this.chosenMapName}`;
        });
      }

      this.network = new NetworkManager(
        {
          roomCode: result.roomCode,
          localPeerId: result.peerId,
          hostPeerId: result.hostPeerId,
          isHost: result.isHost,
        },
        {
          onMessage: (from, msg) => this.handleNetMessage(from, msg),
          onPeerConnected: () => {},
          onPeerDisconnected: () => {},
          onRosterUpdate: (roster) => {
            this.roster = roster;
            if (this.isHost) this.checkAutoStart();
            this.renderWaitingScreen();
          },
        },
      );
      this.network.start();
      this.renderWaitingScreen();
      this.startCountdown();
    } catch (err) {
      btn.disabled = false;
      btn.textContent = "Play!";
      this.setStatus((err as Error).message);
    }
  }

  // ── Waiting room ───────────────────────────────────────────────────────────

  private countdownEl: HTMLElement | undefined;
  private arenaNameEl: HTMLElement | undefined;
  private rosterListEl: HTMLElement | undefined;
  private statusEl: HTMLElement | undefined;
  private onWaitScreen = false;

  private renderWaitingScreen(): void {
    if (this.onWaitScreen) {
      this.updateWaitInPlace();
      return;
    }
    this.preview?.dispose();
    this.preview = undefined;
    this.root.innerHTML = "";
    this.onWaitScreen = true;

    const wrap = el("div", "screen-center");
    const panel = el("div", "panel");

    const title = el("h1", "title");
    title.textContent = "Little Brawlers";
    panel.appendChild(title);

    const countdown = el("p", "countdown-text");
    this.countdownEl = countdown;
    panel.appendChild(countdown);

    const arenaLine = el("p", "arena-text");
    arenaLine.textContent = this.chosenMapName ? `Arena: ${this.chosenMapName}` : "Arena: choosing…";
    this.arenaNameEl = arenaLine;
    panel.appendChild(arenaLine);

    const rosterTitle = el("h2", "section-title");
    rosterTitle.textContent = "Players";
    panel.appendChild(rosterTitle);

    const list = el("ul", "roster-list");
    this.rosterListEl = list;
    this.buildRosterItems();
    panel.appendChild(list);

    const status = el("p", "status-text");
    this.statusEl = status;
    panel.appendChild(status);

    wrap.appendChild(panel);
    this.root.appendChild(wrap);
    this.updateCountdownText();
  }

  private updateWaitInPlace(): void {
    if (this.rosterListEl) this.buildRosterItems();
    this.updateCountdownText();
    if (this.arenaNameEl && this.chosenMapName) {
      this.arenaNameEl.textContent = `Arena: ${this.chosenMapName}`;
    }
  }

  private buildRosterItems(): void {
    const list = this.rosterListEl;
    if (!list) return;
    list.innerHTML = "";
    this.roster.forEach((entry, i) => {
      const item = el("li", "roster-item");
      const swatch = el("span", "swatch");
      swatch.style.background = `#${(PLAYER_COLORS[i % PLAYER_COLORS.length]?.hex ?? 0xffffff).toString(16).padStart(6, "0")}`;
      item.appendChild(swatch);
      const label = el("span", "roster-name");
      label.textContent = entry.name + (entry.isHost ? " (host)" : "");
      item.appendChild(label);
      list.appendChild(item);
    });
    // Show pending bot slots
    for (let i = this.roster.length; i < MAX_PLAYERS; i++) {
      const item = el("li", "roster-item roster-item--bot");
      const swatch = el("span", "swatch swatch--pending");
      item.appendChild(swatch);
      const label = el("span", "roster-name");
      label.textContent = "Waiting…";
      label.style.color = "#6b7386";
      item.appendChild(label);
      list.appendChild(item);
    }
  }

  private setStatus(msg: string): void {
    if (this.statusEl) this.statusEl.textContent = msg;
  }

  // ── Countdown ──────────────────────────────────────────────────────────────

  private startCountdown(): void {
    this.clearCountdown();
    this.countdownTimer = setInterval(() => {
      const remaining = this.remainingMs();
      this.updateCountdownText();
      if (remaining <= 0 && this.isHost) {
        this.clearCountdown();
        void this.launchGame();
      }
    }, 250);
  }

  private clearCountdown(): void {
    if (this.countdownTimer) { clearInterval(this.countdownTimer); this.countdownTimer = undefined; }
  }

  private remainingMs(): number {
    return Math.max(0, this.openedAt * 1000 + COUNTDOWN_S * 1000 - Date.now());
  }

  private updateCountdownText(): void {
    if (!this.countdownEl) return;
    const remaining = this.remainingMs();
    const secs = Math.ceil(remaining / 1000);
    const botCount = MAX_PLAYERS - this.roster.length;
    if (remaining <= 0) {
      this.countdownEl.textContent = botCount > 0
        ? `Starting with ${botCount} bot${botCount > 1 ? "s" : ""}…`
        : "Starting…";
    } else {
      this.countdownEl.textContent = botCount > 0
        ? `Starting in ${secs}s (${botCount} bot${botCount > 1 ? "s" : ""} if no more players join)`
        : `Starting in ${secs}s`;
    }
  }

  private checkAutoStart(): void {
    if (this.roster.length >= MAX_PLAYERS) {
      this.clearCountdown();
      void this.launchGame();
    }
  }

  // ── Game launch ────────────────────────────────────────────────────────────

  private async launchGame(): Promise<void> {
    if (!this.network) return;
    this.setStatus("Loading map…");

    let mapData: MapData;
    try {
      if (this.chosenMapId) {
        mapData = await getMap(this.chosenMapId);
      } else {
        // Fallback: pick randomly now if the async pre-selection didn't finish in time.
        const maps = await listMaps().catch(() => []);
        if (maps.length > 0) {
          const picked = maps[Math.floor(Math.random() * maps.length)]!;
          mapData = await getMap(picked.id);
        } else {
          mapData = buildDefaultMap();
        }
      }
    } catch {
      mapData = buildDefaultMap();
    }

    const humanPlayers = this.roster.map((entry, i) => ({
      peerId: entry.peerId,
      name: entry.name,
      color: PLAYER_COLORS[i % PLAYER_COLORS.length]?.hex ?? 0xffffff,
      team: i,
      isBot: false,
      characterModel: entry.characterModel,
    }));

    const players = [...humanPlayers];
    for (let i = players.length; i < MAX_PLAYERS; i++) {
      players.push({
        peerId: `bot:${i}`,
        name: BOT_NAMES[i - humanPlayers.length] ?? `Bot ${i + 1}`,
        color: PLAYER_COLORS[i % PLAYER_COLORS.length]?.hex ?? 0xffffff,
        team: i,
        isBot: true,
        characterModel: DEFAULT_CHARACTER_MODEL,
      });
    }

    const startMsg = {
      type: "start" as const,
      mapId: mapData.id,
      mapData,
      players,
      startTimeMs: Date.now(),
    };

    this.network.broadcast(startMsg);
    void SignalingClient.markStarted(this.roomCode).catch(() => {});
    this.onWaitScreen = false;
    this.onStart(this.network, { mapData, players, localPeerId: this.localPeerId });
  }

  // ── Client: receive start from host ───────────────────────────────────────

  private handleNetMessage(_from: string, message: NetMessage): void {
    if (message.type === "start" && this.network) {
      this.clearCountdown();
      this.onWaitScreen = false;
      const mapData = message.mapData as MapData;
      this.onStart(this.network, {
        mapData,
        players: message.players as GameStartInfo["players"],
        localPeerId: this.localPeerId,
      });
    }
  }
}

function el(tag: string, className: string): HTMLElement {
  const e = document.createElement(tag);
  e.className = className;
  return e;
}
