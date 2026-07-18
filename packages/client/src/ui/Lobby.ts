import { PLAYER_COLORS, type MapData, type NetMessage, type RosterEntry } from "@brawlers/shared";
import { NetworkManager } from "../net/NetworkManager";
import { SignalingClient } from "../net/SignalingClient";
import { getMap, listMaps, type MapSummary } from "../net/MapApi";
import { buildDefaultMap } from "../maps/defaultMap";
import type { GameStartInfo } from "../game/Game";

const DEFAULT_MAP_OPTION = "__default__";

export class Lobby {
  private network: NetworkManager | undefined;
  private localPeerId = "";
  private hostPeerId = "";
  private roomCode = "";
  private isHost = false;
  private playerName = "Player";
  private roster: RosterEntry[] = [];
  private selectedMapId = DEFAULT_MAP_OPTION;
  private mapSummaries: MapSummary[] = [];

  constructor(
    private readonly root: HTMLElement,
    private readonly onStart: (network: NetworkManager, info: GameStartInfo) => void,
  ) {
    this.renderEntryScreen();
  }

  private renderEntryScreen(): void {
    this.root.innerHTML = "";
    const panel = el("div", "panel");

    const title = el("h1", "title");
    title.textContent = "Brawlers";
    panel.appendChild(title);

    const nameLabel = el("label", "field-label");
    nameLabel.textContent = "Your name";
    const nameInput = document.createElement("input");
    nameInput.className = "text-input";
    nameInput.maxLength = 20;
    nameInput.value = this.playerName;
    nameInput.placeholder = "Player";
    panel.appendChild(nameLabel);
    panel.appendChild(nameInput);

    const hostButton = el("button", "primary-button");
    hostButton.textContent = "Host Game";
    hostButton.onclick = () => void this.hostGame(nameInput.value.trim() || "Player");
    panel.appendChild(hostButton);

    const divider = el("div", "divider");
    divider.textContent = "or join a room";
    panel.appendChild(divider);

    const codeInput = document.createElement("input");
    codeInput.className = "text-input code-input";
    codeInput.maxLength = 6;
    codeInput.placeholder = "ROOM CODE";
    codeInput.style.textTransform = "uppercase";
    panel.appendChild(codeInput);

    const joinButton = el("button", "secondary-button");
    joinButton.textContent = "Join Game";
    joinButton.onclick = () =>
      void this.joinGame(nameInput.value.trim() || "Player", codeInput.value.trim().toUpperCase());
    panel.appendChild(joinButton);

    const status = el("p", "status-text");
    panel.appendChild(status);
    this.statusEl = status;

    this.root.appendChild(panel);
  }

  private statusEl: HTMLElement | undefined;
  private setStatus(message: string): void {
    if (this.statusEl) this.statusEl.textContent = message;
  }

  private async hostGame(name: string): Promise<void> {
    this.playerName = name;
    this.setStatus("Creating room...");
    try {
      const { roomCode, peerId } = await SignalingClient.createRoom(name);
      this.roomCode = roomCode;
      this.localPeerId = peerId;
      this.hostPeerId = peerId;
      this.isHost = true;
      this.network = new NetworkManager(
        { roomCode, localPeerId: peerId, hostPeerId: peerId, isHost: true },
        {
          onMessage: () => {},
          onPeerConnected: () => {},
          onPeerDisconnected: () => this.renderRoomScreen(),
          onRosterUpdate: (roster) => {
            this.roster = roster;
            this.renderRoomScreen();
          },
        },
      );
      this.network.start();
      this.mapSummaries = await listMaps().catch(() => []);
      this.renderRoomScreen();
    } catch (err) {
      this.setStatus(`Failed to create room: ${(err as Error).message}`);
    }
  }

  private async joinGame(name: string, roomCode: string): Promise<void> {
    if (!roomCode) {
      this.setStatus("Enter a room code first.");
      return;
    }
    this.playerName = name;
    this.setStatus("Joining room...");
    try {
      const { peerId, hostPeerId } = await SignalingClient.joinRoom(roomCode, name);
      this.roomCode = roomCode;
      this.localPeerId = peerId;
      this.hostPeerId = hostPeerId;
      this.isHost = false;
      this.network = new NetworkManager(
        { roomCode, localPeerId: peerId, hostPeerId, isHost: false },
        {
          onMessage: (from, message) => this.handleClientMessage(from, message),
          onPeerConnected: () => this.setStatus("Connected to host. Waiting for the game to start..."),
          onPeerDisconnected: () => this.setStatus("Lost connection to host."),
          onRosterUpdate: (roster) => {
            this.roster = roster;
            this.renderRoomScreen();
          },
        },
      );
      this.network.start();
      this.renderRoomScreen();
    } catch (err) {
      this.setStatus(`Failed to join room: ${(err as Error).message}`);
    }
  }

  private handleClientMessage(_from: string, message: NetMessage): void {
    if (message.type === "start" && this.network) {
      const mapData = message.mapData as MapData;
      this.onStart(this.network, {
        mapData,
        players: message.players as GameStartInfo["players"],
        localPeerId: this.localPeerId,
      });
    }
  }

  private renderRoomScreen(): void {
    this.root.innerHTML = "";
    const panel = el("div", "panel");

    const title = el("h1", "title");
    title.textContent = this.isHost ? "Room created" : "Room joined";
    panel.appendChild(title);

    const codeRow = el("div", "room-code");
    codeRow.textContent = this.roomCode;
    panel.appendChild(codeRow);

    const rosterTitle = el("h2", "section-title");
    rosterTitle.textContent = `Players (${this.roster.length})`;
    panel.appendChild(rosterTitle);

    const list = el("ul", "roster-list");
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
    panel.appendChild(list);

    if (this.isHost) {
      const mapLabel = el("label", "field-label");
      mapLabel.textContent = "Map";
      panel.appendChild(mapLabel);

      const select = document.createElement("select");
      select.className = "text-input";
      const defaultOption = document.createElement("option");
      defaultOption.value = DEFAULT_MAP_OPTION;
      defaultOption.textContent = "Default Arena";
      select.appendChild(defaultOption);
      for (const summary of this.mapSummaries) {
        const option = document.createElement("option");
        option.value = summary.id;
        option.textContent = `${summary.name} (${summary.width}x${summary.height})`;
        select.appendChild(option);
      }
      select.value = this.selectedMapId;
      select.onchange = () => (this.selectedMapId = select.value);
      panel.appendChild(select);

      const startButton = el("button", "primary-button");
      startButton.textContent = "Start Game";
      startButton.onclick = () => void this.startGame();
      panel.appendChild(startButton);
    } else {
      const waiting = el("p", "status-text");
      waiting.textContent = "Waiting for the host to start the game...";
      panel.appendChild(waiting);
    }

    const status = el("p", "status-text");
    panel.appendChild(status);
    this.statusEl = status;

    this.root.appendChild(panel);
  }

  private async startGame(): Promise<void> {
    if (!this.network) return;
    this.setStatus("Loading map...");

    let mapData: MapData;
    try {
      mapData = this.selectedMapId === DEFAULT_MAP_OPTION ? buildDefaultMap() : await getMap(this.selectedMapId);
    } catch {
      mapData = buildDefaultMap();
    }

    const players: GameStartInfo["players"] = this.roster.map((entry, i) => ({
      peerId: entry.peerId,
      name: entry.name,
      color: PLAYER_COLORS[i % PLAYER_COLORS.length]?.hex ?? 0xffffff,
      team: i,
    }));

    this.network.broadcast({
      type: "start",
      mapId: mapData.id,
      mapData,
      players,
      startTimeMs: Date.now(),
    });

    this.onStart(this.network, { mapData, players, localPeerId: this.localPeerId });
  }
}

function el(tag: string, className: string): HTMLElement {
  const element = document.createElement(tag);
  element.className = className;
  return element;
}
