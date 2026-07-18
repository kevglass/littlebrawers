import type { NetMessage, RosterEntry, SignalEnvelope } from "@brawlers/shared";
import { PeerLink } from "./PeerLink";
import { SignalingClient } from "./SignalingClient";

export interface NetworkCallbacks {
  onMessage: (fromPeerId: string, message: NetMessage) => void;
  onPeerConnected: (peerId: string) => void;
  onPeerDisconnected: (peerId: string) => void;
  onRosterUpdate: (roster: RosterEntry[]) => void;
}

export interface NetworkManagerOptions {
  roomCode: string;
  localPeerId: string;
  hostPeerId: string;
  isHost: boolean;
}

/**
 * Star-topology WebRTC session: the host holds a PeerLink to every client;
 * each client holds exactly one PeerLink, to the host. The PHP signaling
 * server is only used to exchange the SDP/ICE handshake for each link.
 */
export class NetworkManager {
  readonly isHost: boolean;
  readonly localPeerId: string;
  readonly hostPeerId: string;
  readonly roomCode: string;

  private readonly signaling: SignalingClient;
  private readonly peers = new Map<string, PeerLink>();
  private callbacks: NetworkCallbacks;

  constructor(options: NetworkManagerOptions, callbacks: NetworkCallbacks) {
    this.isHost = options.isHost;
    this.localPeerId = options.localPeerId;
    this.hostPeerId = options.hostPeerId;
    this.roomCode = options.roomCode;
    this.callbacks = callbacks;
    this.signaling = new SignalingClient(options.roomCode, options.localPeerId);
  }

  /** Swaps the active callback set, e.g. when moving from the lobby UI to an in-progress Game. */
  setCallbacks(callbacks: NetworkCallbacks): void {
    this.callbacks = callbacks;
  }

  start(): void {
    this.signaling.startPolling(
      (envelopes) => this.handleEnvelopes(envelopes),
      (roster) => this.handleRoster(roster),
    );
  }

  private handleRoster(roster: RosterEntry[]): void {
    this.callbacks.onRosterUpdate(roster);

    if (!this.isHost) return;

    for (const entry of roster) {
      if (entry.peerId === this.localPeerId) continue;
      if (this.peers.has(entry.peerId)) continue;
      this.connectToNewPeer(entry.peerId);
    }
  }

  private connectToNewPeer(remotePeerId: string): void {
    const link = this.makeLink(remotePeerId, true);
    this.peers.set(remotePeerId, link);
    void link.createOffer();
  }

  private makeLink(remotePeerId: string, isOfferer: boolean): PeerLink {
    return new PeerLink(remotePeerId, this.signaling, isOfferer, {
      onMessage: (message) => this.callbacks.onMessage(remotePeerId, message),
      onStateChange: (state) => {
        if (state === "open") this.callbacks.onPeerConnected(remotePeerId);
        if (state === "closed") {
          this.peers.delete(remotePeerId);
          this.callbacks.onPeerDisconnected(remotePeerId);
        }
      },
    });
  }

  private handleEnvelopes(envelopes: SignalEnvelope[]): void {
    for (const envelope of envelopes) {
      let link = this.peers.get(envelope.from);
      if (!link) {
        if (this.isHost) continue; // host only talks to peers it already offered to
        link = this.makeLink(envelope.from, false);
        this.peers.set(envelope.from, link);
      }

      switch (envelope.type) {
        case "offer":
          void link.handleOffer(envelope.payload as { sdp: string; type: RTCSdpType });
          break;
        case "answer":
          void link.handleAnswer(envelope.payload as { sdp: string; type: RTCSdpType });
          break;
        case "ice-candidate":
          void link.handleIceCandidate(envelope.payload as RTCIceCandidateInit);
          break;
      }
    }
  }

  broadcast(message: NetMessage): void {
    for (const link of this.peers.values()) link.send(message);
  }

  sendTo(peerId: string, message: NetMessage): void {
    this.peers.get(peerId)?.send(message);
  }

  sendToHost(message: NetMessage): void {
    this.peers.get(this.hostPeerId)?.send(message);
  }

  get connectedPeerIds(): string[] {
    return [...this.peers.keys()];
  }

  async stop(): Promise<void> {
    for (const link of this.peers.values()) link.close();
    this.peers.clear();
    await this.signaling.leave();
  }
}
