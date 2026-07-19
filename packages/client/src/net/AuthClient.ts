import { SIGNAL_BASE_URL } from "./config";

const TOKEN_KEY = "lb_token";
const USERNAME_KEY = "lb_username";

export interface AuthState {
  username: string;
  token?: string; // undefined for guests
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${SIGNAL_BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    let msg = `${res.status}`;
    try { msg = (JSON.parse(text) as { error?: string }).error ?? text; } catch { msg = text; }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

export const AuthClient = {
  /** Verify the locally stored token with the server. Returns null if there is none or it's expired. */
  async checkSession(): Promise<AuthState | null> {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) return null;
    try {
      const { username } = await postJson<{ username: string }>("/api/auth/verify.php", { token });
      localStorage.setItem(USERNAME_KEY, username);
      return { username, token };
    } catch {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USERNAME_KEY);
      return null;
    }
  },

  async register(username: string, email: string, password: string): Promise<AuthState> {
    const { token, username: name } = await postJson<{ token: string; username: string }>(
      "/api/auth/register.php",
      { username, email, password },
    );
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USERNAME_KEY, name);
    return { username: name, token };
  },

  async login(usernameOrEmail: string, password: string): Promise<AuthState> {
    const { token, username } = await postJson<{ token: string; username: string }>(
      "/api/auth/login.php",
      { usernameOrEmail, password },
    );
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USERNAME_KEY, username);
    return { username, token };
  },

  logout(): void {
    const token = localStorage.getItem(TOKEN_KEY);
    if (token) {
      void fetch(`${SIGNAL_BASE_URL}/api/auth/logout.php`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      }).catch(() => {});
    }
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USERNAME_KEY);
  },

  /** Cached local state (no server round-trip). */
  getLocal(): AuthState | null {
    const token = localStorage.getItem(TOKEN_KEY);
    const username = localStorage.getItem(USERNAME_KEY);
    if (token && username) return { username, token };
    return null;
  },
};
