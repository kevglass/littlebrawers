// ---------------------------------------------------------------------------
// Signaling protocol (HTTP, talks to the PHP flat-file signaling server).
// Only used to bootstrap a WebRTC connection; once a data channel is open,
// game traffic no longer touches this server.
// ---------------------------------------------------------------------------

export interface CreateRoomRequest {
  hostName: string;
}

export interface CreateRoomResponse {
  roomCode: string;
  peerId: string;
}

export interface JoinRoomRequest {
  roomCode: string;
  playerName: string;
}

export interface JoinRoomResponse {
  roomCode: string;
  peerId: string;
  hostPeerId: string;
}

export type SignalPayloadType = "offer" | "answer" | "ice-candidate";

export interface SignalEnvelope {
  /** monotonically increasing index within the room's inbox for `to` */
  seq: number;
  from: string;
  to: string;
  type: SignalPayloadType;
  payload: unknown;
  ts: number;
}

export interface SendSignalRequest {
  roomCode: string;
  from: string;
  to: string;
  type: SignalPayloadType;
  payload: unknown;
}

export interface PollSignalRequest {
  roomCode: string;
  peerId: string;
  /** return envelopes with seq strictly greater than this */
  since: number;
}

export interface PollSignalResponse {
  envelopes: SignalEnvelope[];
  roster: RosterEntry[];
}

export interface RosterEntry {
  peerId: string;
  name: string;
  isHost: boolean;
  joinedAt: number;
}

// ---------------------------------------------------------------------------
// Game protocol (sent over WebRTC data channels, star topology: every client
// talks only to the host; the host is authoritative and rebroadcasts state).
// ---------------------------------------------------------------------------

export interface PlayerInputMessage {
  type: "input";
  seq: number;
  moveX: number;
  moveY: number;
  aimX: number;
  aimY: number;
  attack: boolean;
}

export interface PlayerSnapshot {
  peerId: string;
  name: string;
  color: number;
  x: number;
  y: number;
  aimX: number;
  aimY: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  team: number;
  /** true while this player's movement input is non-zero, for locomotion animation */
  moving: boolean;
  /** increments each time this player performs an attack action, so clients can trigger a one-shot animation */
  attackSeq: number;
}

export interface GameSnapshotMessage {
  type: "snapshot";
  tick: number;
  serverTimeMs: number;
  players: PlayerSnapshot[];
  lastProcessedInputSeq: Record<string, number>;
}

export interface GameStartMessage {
  type: "start";
  mapId: string;
  mapData: unknown; // MapData, kept unknown here to avoid a circular import
  players: { peerId: string; name: string; color: number; team: number }[];
  startTimeMs: number;
}

export interface PlayerJoinedMessage {
  type: "player-joined";
  peerId: string;
  name: string;
  color: number;
}

export interface PlayerLeftMessage {
  type: "player-left";
  peerId: string;
}

export interface PingMessage {
  type: "ping";
  clientTimeMs: number;
}

export interface PongMessage {
  type: "pong";
  clientTimeMs: number;
  hostTimeMs: number;
}

export type NetMessage =
  | PlayerInputMessage
  | GameSnapshotMessage
  | GameStartMessage
  | PlayerJoinedMessage
  | PlayerLeftMessage
  | PingMessage
  | PongMessage;
