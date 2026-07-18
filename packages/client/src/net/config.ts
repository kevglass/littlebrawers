export const SIGNAL_BASE_URL: string =
  (import.meta.env.VITE_SIGNAL_BASE_URL as string | undefined) ?? "http://localhost:8080";

export const ICE_SERVERS: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];

export const POLL_INTERVAL_MS = 600;
