import type {
  CreateRoomResponse,
  JoinRoomResponse,
  PollSignalResponse,
  RosterEntry,
  SignalEnvelope,
  SignalPayloadType,
} from "@brawlers/shared";
import { POLL_INTERVAL_MS, SIGNAL_BASE_URL } from "./config";

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${SIGNAL_BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Request to ${path} failed (${res.status}): ${text}`);
  }
  return res.json() as Promise<T>;
}

/**
 * Talks to the PHP flat-file signaling server. Only used to bootstrap
 * WebRTC peer connections (room lobby + SDP/ICE exchange) via polling,
 * since flat files can't push. Game traffic never goes through this.
 */
export class SignalingClient {
  private lastSeq = 0;
  private pollTimer: ReturnType<typeof setInterval> | undefined;
  private stopped = false;

  constructor(
    public readonly roomCode: string,
    public readonly peerId: string,
  ) {}

  static async createRoom(hostName: string): Promise<CreateRoomResponse> {
    return postJson<CreateRoomResponse>("/api/create-room.php", { hostName });
  }

  static async joinRoom(roomCode: string, playerName: string): Promise<JoinRoomResponse> {
    return postJson<JoinRoomResponse>("/api/join-room.php", { roomCode, playerName });
  }

  async send(to: string, type: SignalPayloadType, payload: unknown): Promise<void> {
    await postJson("/api/signal.php", {
      roomCode: this.roomCode,
      from: this.peerId,
      to,
      type,
      payload,
    });
  }

  startPolling(onEnvelopes: (envelopes: SignalEnvelope[]) => void, onRoster: (roster: RosterEntry[]) => void): void {
    const poll = async () => {
      if (this.stopped) return;
      try {
        const url = `${SIGNAL_BASE_URL}/api/poll.php?roomCode=${encodeURIComponent(this.roomCode)}&peerId=${encodeURIComponent(this.peerId)}&since=${this.lastSeq}`;
        const res = await fetch(url);
        if (!res.ok) return;
        const data: PollSignalResponse = await res.json();
        if (data.envelopes.length > 0) {
          this.lastSeq = Math.max(this.lastSeq, ...data.envelopes.map((e) => e.seq));
          onEnvelopes(data.envelopes);
        }
        onRoster(data.roster);
      } catch {
        // transient network error; next poll will retry
      }
    };

    void poll();
    this.pollTimer = setInterval(() => void poll(), POLL_INTERVAL_MS);
  }

  async leave(): Promise<void> {
    this.stopped = true;
    if (this.pollTimer) clearInterval(this.pollTimer);
    try {
      await postJson("/api/leave-room.php", { roomCode: this.roomCode, peerId: this.peerId });
    } catch {
      // best-effort
    }
  }
}
