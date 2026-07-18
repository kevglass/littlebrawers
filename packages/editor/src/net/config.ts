export const SIGNAL_BASE_URL: string =
  (import.meta.env.VITE_SIGNAL_BASE_URL as string | undefined) ?? "http://localhost:8080";
