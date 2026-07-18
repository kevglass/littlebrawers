import type { NetMessage } from "@brawlers/shared";
import { ICE_SERVERS } from "./config";
import type { SignalingClient } from "./SignalingClient";

export type PeerLinkState = "connecting" | "open" | "closed";

interface PeerLinkCallbacks {
  onMessage: (message: NetMessage) => void;
  onStateChange: (state: PeerLinkState) => void;
}

/**
 * Wraps a single RTCPeerConnection + RTCDataChannel to one remote peer.
 * The host holds one PeerLink per connected client (star topology); a
 * client holds exactly one PeerLink, to the host.
 */
export class PeerLink {
  private readonly pc: RTCPeerConnection;
  private channel: RTCDataChannel | undefined;
  private state: PeerLinkState = "connecting";
  private pendingCandidates: RTCIceCandidateInit[] = [];
  private remoteDescriptionSet = false;

  constructor(
    private readonly remotePeerId: string,
    private readonly signaling: SignalingClient,
    private readonly isOfferer: boolean,
    private readonly callbacks: PeerLinkCallbacks,
  ) {
    this.pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    this.pc.onicecandidate = (event) => {
      if (event.candidate) {
        void this.signaling.send(this.remotePeerId, "ice-candidate", event.candidate.toJSON());
      }
    };

    this.pc.onconnectionstatechange = () => {
      if (this.pc.connectionState === "connected" && this.state !== "open") {
        // actual "open" transition is driven by the data channel below
      }
      if (this.pc.connectionState === "failed" || this.pc.connectionState === "closed") {
        this.setState("closed");
      }
    };

    if (this.isOfferer) {
      this.channel = this.pc.createDataChannel("game");
      this.bindChannel(this.channel);
    } else {
      this.pc.ondatachannel = (event) => {
        this.channel = event.channel;
        this.bindChannel(this.channel);
      };
    }
  }

  private bindChannel(channel: RTCDataChannel): void {
    channel.onopen = () => this.setState("open");
    channel.onclose = () => this.setState("closed");
    channel.onerror = () => this.setState("closed");
    channel.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data as string) as NetMessage;
        this.callbacks.onMessage(message);
      } catch {
        // ignore malformed payloads
      }
    };
  }

  private setState(state: PeerLinkState): void {
    if (this.state === state) return;
    this.state = state;
    this.callbacks.onStateChange(state);
  }

  async createOffer(): Promise<void> {
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    await this.signaling.send(this.remotePeerId, "offer", { sdp: offer.sdp, type: offer.type });
  }

  async handleOffer(payload: { sdp: string; type: RTCSdpType }): Promise<void> {
    await this.pc.setRemoteDescription(new RTCSessionDescription(payload));
    this.remoteDescriptionSet = true;
    await this.drainPendingCandidates();
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    await this.signaling.send(this.remotePeerId, "answer", { sdp: answer.sdp, type: answer.type });
  }

  async handleAnswer(payload: { sdp: string; type: RTCSdpType }): Promise<void> {
    await this.pc.setRemoteDescription(new RTCSessionDescription(payload));
    this.remoteDescriptionSet = true;
    await this.drainPendingCandidates();
  }

  async handleIceCandidate(payload: RTCIceCandidateInit): Promise<void> {
    if (!this.remoteDescriptionSet) {
      this.pendingCandidates.push(payload);
      return;
    }
    try {
      await this.pc.addIceCandidate(payload);
    } catch {
      // benign: candidate arrived after connection settled, or was redundant
    }
  }

  private async drainPendingCandidates(): Promise<void> {
    const candidates = this.pendingCandidates;
    this.pendingCandidates = [];
    for (const candidate of candidates) {
      try {
        await this.pc.addIceCandidate(candidate);
      } catch {
        // benign
      }
    }
  }

  send(message: NetMessage): void {
    if (this.channel && this.channel.readyState === "open") {
      this.channel.send(JSON.stringify(message));
    }
  }

  get currentState(): PeerLinkState {
    return this.state;
  }

  close(): void {
    this.channel?.close();
    this.pc.close();
    this.setState("closed");
  }
}
