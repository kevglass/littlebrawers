import "./style.css";
import { AuthClient, type AuthState } from "./net/AuthClient";
import { AuthScreen } from "./ui/AuthScreen";
import { Lobby } from "./ui/Lobby";
import { Game } from "./game/Game";
import type { NetworkManager } from "./net/NetworkManager";

const app = document.getElementById("app");
if (!app) throw new Error("#app element missing");

let game: Game | undefined;

async function boot(): Promise<void> {
  // Restore an existing session (no auth screen if token is still valid)
  let auth: AuthState | null = await AuthClient.checkSession().catch(() => null);

  if (!auth) {
    auth = await new Promise<AuthState>((resolve) => {
      new AuthScreen(app!, resolve);
    });
  }

  app!.innerHTML = "";
  new Lobby(app!, auth, (network: NetworkManager, info) => {
    app!.innerHTML = "";
    const container = document.createElement("div");
    container.id = "game-container";
    app!.appendChild(container);

    const hud = document.createElement("div");
    hud.className = "hud";
    hud.textContent = "WASD to move · mouse to aim · click to attack";
    container.appendChild(hud);

    game?.dispose();
    game = new Game(container, network, info);
  });
}

void boot();
