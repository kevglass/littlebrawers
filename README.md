# Brawlers

A Brawl-Stars-style top-down multiplayer arena game:

- **Rendering**: [three.js](https://threejs.org/) + TypeScript, flat tile-based arenas (no elevation, just walkable tiles and blocking walls/bushes). Players are placeholder colored spheres until real character models are added.
- **Networking**: WebRTC data channels in a host-authoritative star topology (every client connects directly to whichever player is hosting; the host simulates the match and broadcasts state). No game traffic ever touches a server.
- **Signaling**: a tiny PHP + flat-file server (`server/`) whose only job is bootstrapping the WebRTC handshake (room codes, SDP offer/answer, ICE candidates) and storing level-editor maps as JSON files. Once peers are connected it's out of the loop.
- **Level editor**: a standalone web app (`packages/editor`) for painting tile maps and placing spawn points, saved to the same flat-file server.

## Project layout

```
packages/
  shared/   TypeScript types shared by client + editor (map format, network protocol, game constants)
  client/   The game itself (vite + three.js)
  editor/   The level editor (vite, 2D canvas)
server/     PHP signaling + map storage, flat-file backed (no database)
```

## Running it locally

You need Node.js and PHP 8+ installed.

```bash
npm install

# in three separate terminals:
npm run dev:server   # PHP signaling/map server on http://localhost:8080
npm run dev:client   # game client, vite prints the URL (default http://localhost:5173)
npm run dev:editor   # level editor, vite prints the URL (default http://localhost:5174)
```

If a port is already in use on your machine, Vite automatically picks the next free one and prints it in the terminal — use whatever URL it reports.

To try multiplayer, open the client URL in two browser tabs (or two devices on the same network): host a game in one tab, copy the room code, and join from the other.

### Configuring the signaling server URL

Both the client and editor default to `http://localhost:8080` for the signaling/map API. To point at a different host (e.g. when deploying), set `VITE_SIGNAL_BASE_URL` before building:

```bash
VITE_SIGNAL_BASE_URL=https://your-domain.example npm run build
```

## How multiplayer works

1. The host calls `create-room.php`, which allocates a short room code and a peer ID, stored in `server/data/rooms/{CODE}.json`.
2. Other players call `join-room.php` with that code to get their own peer ID.
3. Everyone polls `poll.php` every ~600ms for new signaling messages and the current player roster (flat files can't push, so this is simple polling rather than websockets/long-polling).
4. When the host sees a new player in the roster, it opens an `RTCPeerConnection`, creates a data channel, and sends an offer via `signal.php`. The new player answers the same way, and ICE candidates flow through the same endpoint.
5. Once each data channel is open, that's it for the signaling server — all game traffic (player input, state snapshots) goes peer-to-peer over WebRTC.
6. The host runs the authoritative simulation (movement, collision against the map, basic hitscan attacks, respawns) at a fixed tick rate and broadcasts state snapshots to every connected client, which just render them (with light smoothing for players other than themselves).

This is a star topology, not full mesh — clients never talk directly to each other, only to the host. If the host leaves, the match ends (no host migration yet).

**NAT traversal**: only a public STUN server is configured (`stun.l.google.com`), no TURN relay. This works for most home networks but a small fraction of connections behind strict/symmetric NAT won't establish a direct P2P path. Adding a TURN server is the fix if that becomes an issue.

## Level editor

`packages/editor` is a 2D top-down canvas editor (no need for 3D since maps have no elevation):

- Paint tiles by dragging: **Empty**, **Wall** (blocks movement), **Bush** (decorative, non-blocking).
- **Spawn** tool places numbered spawn points (cycles through the 6 player colors); right-click a tile to remove a spawn point.
- Resize the grid, rename the map, and **Save to Server** (writes to `server/data/maps/{id}.json`) or **Export JSON** / **Import JSON** for local files.
- The game client's lobby screen (host only) lists saved maps to pick from before starting a match, falling back to a small built-in default arena if none exist yet.

## Current limitations / next steps

- No host migration if the host disconnects mid-match.
- No client-side prediction — non-host players see host-authoritative movement with light interpolation, so there's a small amount of input latency proportional to the P2P round-trip.
- Combat is a simple short-range hitscan "attack" rather than real projectiles/abilities — a placeholder until actual character kits are designed.
- Player models are spheres colored per-player; swap in real models in `packages/client/src/game/Player.ts` when ready.
- No TURN server, so a minority of NAT configurations may fail to connect peer-to-peer.
