import "./style.css";
import { Lobby } from "./ui/Lobby";
import { Game } from "./game/Game";
import type { NetworkManager } from "./net/NetworkManager";

const app = document.getElementById("app");
if (!app) throw new Error("#app element missing");

let game: Game | undefined;

new Lobby(app, (network: NetworkManager, info) => {
  app.innerHTML = "";
  const container = document.createElement("div");
  container.id = "game-container";
  app.appendChild(container);

  const hud = document.createElement("div");
  hud.className = "hud";
  hud.textContent = `Room ${network.roomCode} — WASD to move, mouse to aim, click to attack`;
  container.appendChild(hud);

  game?.dispose();
  game = new Game(container, network, info);
});
