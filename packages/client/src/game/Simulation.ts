import {
  GAME_CONSTANTS,
  type GameSnapshotMessage,
  type MapData,
  type PlayerInputMessage,
  type PlayerSnapshot,
} from "@brawlers/shared";
import { resolveCircleCollision, tileToWorld } from "./mapGeometry";

export interface SimPlayerInfo {
  peerId: string;
  name: string;
  color: number;
  team: number;
  isBot?: boolean;
  /** Purely cosmetic (which 3D model to render) — the simulation itself doesn't use it. */
  characterModel: string;
}

interface SimPlayerState {
  name: string;
  color: number;
  team: number;
  x: number;
  z: number;
  aimX: number;
  aimZ: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  respawnAtMs: number;
  lastAttackAtMs: number;
  lastDamagedAtMs: number;
  moving: boolean;
  attackSeq: number;
}

const RESPAWN_DELAY_MS = 3000;
// Bot preferred engagement distance: close enough to attack but with a margin
const BOT_ENGAGE_DIST = GAME_CONSTANTS.ATTACK_RANGE * 0.65;

/**
 * Maps saved without spawn points (e.g. hand-edited or older editor exports) used to fall
 * back to a single fixed corner tile — every player and bot landed on the exact same spot,
 * so bots looked "missing" (all stacked on top of each other, often against a wall) and
 * instantly killed whichever bot won the tie-break each tick. Spreads a handful of points
 * around the map's center tile instead so everyone lands apart from each other.
 */
function fallbackSpawnPoints(map: MapData): { x: number; y: number; team: number }[] {
  const cx = Math.floor(map.width / 2);
  const cy = Math.floor(map.height / 2);
  const offsets: [number, number][] = [
    [0, 0],
    [-2, -2],
    [2, -2],
    [-2, 2],
    [2, 2],
    [0, -3],
  ];
  return offsets.map(([dx, dy]) => ({
    x: Math.min(map.width - 1, Math.max(0, cx + dx)),
    y: Math.min(map.height - 1, Math.max(0, cy + dy)),
    team: 0,
  }));
}

/**
 * Host-authoritative game state. Runs only on the peer hosting the room;
 * clients just render the GameSnapshotMessage broadcasts this produces.
 */
export class Simulation {
  private readonly players = new Map<string, SimPlayerState>();
  private readonly latestInput = new Map<string, PlayerInputMessage>();
  private readonly lastProcessedSeq = new Map<string, number>();
  private readonly botPeerIds = new Set<string>();
  private tick = 0;

  constructor(
    private readonly map: MapData,
    playerInfos: SimPlayerInfo[],
  ) {
    const spawns = map.spawnPoints.length > 0 ? map.spawnPoints : fallbackSpawnPoints(map);
    playerInfos.forEach((info, i) => {
      const spawn = spawns[i % spawns.length]!;
      const world = tileToWorld(map, spawn.x, spawn.y);
      this.players.set(info.peerId, {
        name: info.name,
        color: info.color,
        team: info.team,
        x: world.x,
        z: world.z,
        aimX: 0,
        aimZ: 1,
        hp: GAME_CONSTANTS.PLAYER_MAX_HP,
        maxHp: GAME_CONSTANTS.PLAYER_MAX_HP,
        alive: true,
        respawnAtMs: 0,
        lastAttackAtMs: 0,
        lastDamagedAtMs: 0,
        moving: false,
        attackSeq: 0,
      });
      if (info.isBot) this.botPeerIds.add(info.peerId);
    });
  }

  applyInput(peerId: string, input: PlayerInputMessage): void {
    const existing = this.latestInput.get(peerId);
    if (existing && existing.seq >= input.seq) return;
    this.latestInput.set(peerId, input);
  }

  removePlayer(peerId: string): void {
    this.players.delete(peerId);
    this.latestInput.delete(peerId);
  }

  step(dtSeconds: number, nowMs: number): void {
    this.tick += 1;

    for (const [peerId, player] of this.players) {
      if (!player.alive) {
        if (nowMs >= player.respawnAtMs) this.respawn(peerId, player);
        continue;
      }

      if (player.hp < player.maxHp && nowMs - player.lastDamagedAtMs >= GAME_CONSTANTS.HEAL_DELAY_MS) {
        player.hp = Math.min(player.maxHp, player.hp + GAME_CONSTANTS.HEAL_RATE_PER_SEC * dtSeconds);
      }

      if (this.botPeerIds.has(peerId)) {
        this.stepBot(peerId, player, dtSeconds, nowMs);
        continue;
      }

      const input = this.latestInput.get(peerId);
      if (input) {
        this.lastProcessedSeq.set(peerId, input.seq);

        const moveLen = Math.hypot(input.moveX, input.moveY);
        player.moving = moveLen > 0.001;
        if (moveLen > 0.001) {
          const speed = GAME_CONSTANTS.PLAYER_SPEED * dtSeconds;
          const nx = player.x + (input.moveX / moveLen) * speed;
          const nz = player.z + (input.moveY / moveLen) * speed;
          const resolved = resolveCircleCollision(this.map, nx, nz, GAME_CONSTANTS.PLAYER_RADIUS);
          player.x = resolved.x;
          player.z = resolved.z;
        }

        if (Math.hypot(input.aimX, input.aimY) > 0.001) {
          player.aimX = input.aimX;
          player.aimZ = input.aimY;
        }

        if (input.attack && nowMs - player.lastAttackAtMs >= GAME_CONSTANTS.ATTACK_COOLDOWN_MS) {
          player.lastAttackAtMs = nowMs;
          player.attackSeq += 1;
          this.tryAttack(peerId, player, nowMs);
        }
      }
    }
  }

  private respawn(peerId: string, player: SimPlayerState): void {
    const spawns = this.map.spawnPoints.length > 0 ? this.map.spawnPoints : fallbackSpawnPoints(this.map);
    const spawn = spawns[Math.floor(Math.random() * spawns.length)]!;
    const world = tileToWorld(this.map, spawn.x, spawn.y);
    player.x = world.x;
    player.z = world.z;
    player.hp = player.maxHp;
    player.alive = true;
  }

  private tryAttack(attackerId: string, attacker: SimPlayerState, nowMs: number): void {
    let bestTarget: SimPlayerState | undefined;
    let bestDist = Infinity;

    for (const [peerId, candidate] of this.players) {
      if (peerId === attackerId || !candidate.alive) continue;

      const dx = candidate.x - attacker.x;
      const dz = candidate.z - attacker.z;
      const forward = dx * attacker.aimX + dz * attacker.aimZ;
      if (forward <= 0 || forward > GAME_CONSTANTS.ATTACK_RANGE) continue;

      const perp = Math.abs(dx * attacker.aimZ - dz * attacker.aimX);
      if (perp > GAME_CONSTANTS.PLAYER_RADIUS * 1.5) continue;

      if (forward < bestDist) {
        bestDist = forward;
        bestTarget = candidate;
      }
    }

    if (bestTarget) {
      const damage = this.botPeerIds.has(attackerId)
        ? GAME_CONSTANTS.ATTACK_DAMAGE * GAME_CONSTANTS.BOT_DAMAGE_MULTIPLIER
        : GAME_CONSTANTS.ATTACK_DAMAGE;
      bestTarget.hp = Math.max(0, bestTarget.hp - damage);
      bestTarget.lastDamagedAtMs = nowMs;
      if (bestTarget.hp === 0) {
        bestTarget.alive = false;
        bestTarget.respawnAtMs = nowMs + RESPAWN_DELAY_MS;
      }
    }
  }

  private stepBot(peerId: string, bot: SimPlayerState, dtSeconds: number, nowMs: number): void {
    // Nearest living opponent — any other player, bot or human, is a valid target.
    let nearestEnemy: SimPlayerState | undefined;
    let nearestDist = Infinity;
    for (const [otherId, other] of this.players) {
      if (otherId === peerId || !other.alive) continue;
      const dist = Math.hypot(other.x - bot.x, other.z - bot.z);
      if (dist < nearestDist) { nearestDist = dist; nearestEnemy = other; }
    }

    if (!nearestEnemy) { bot.moving = false; return; }

    const dx = nearestEnemy.x - bot.x;
    const dz = nearestEnemy.z - bot.z;
    const dist = Math.hypot(dx, dz);

    bot.aimX = dx / dist;
    bot.aimZ = dz / dist;

    if (dist > BOT_ENGAGE_DIST) {
      // Move toward enemy
      const speed = GAME_CONSTANTS.PLAYER_SPEED * dtSeconds;
      const nx = bot.x + (dx / dist) * speed;
      const nz = bot.z + (dz / dist) * speed;
      const resolved = resolveCircleCollision(this.map, nx, nz, GAME_CONSTANTS.PLAYER_RADIUS);
      bot.x = resolved.x;
      bot.z = resolved.z;
      bot.moving = true;
    } else {
      bot.moving = false;
    }

    if (dist <= GAME_CONSTANTS.ATTACK_RANGE && nowMs - bot.lastAttackAtMs >= GAME_CONSTANTS.BOT_ATTACK_COOLDOWN_MS) {
      bot.lastAttackAtMs = nowMs;
      bot.attackSeq += 1;
      this.tryAttack(peerId, bot, nowMs);
    }
  }

  getSnapshot(): GameSnapshotMessage {
    const players: PlayerSnapshot[] = [];
    for (const [peerId, p] of this.players) {
      players.push({
        peerId,
        name: p.name,
        color: p.color,
        x: p.x,
        y: p.z,
        aimX: p.aimX,
        aimY: p.aimZ,
        hp: p.hp,
        maxHp: p.maxHp,
        alive: p.alive,
        team: p.team,
        moving: p.moving,
        attackSeq: p.attackSeq,
      });
    }

    return {
      type: "snapshot",
      tick: this.tick,
      serverTimeMs: performance.now(),
      players,
      lastProcessedInputSeq: Object.fromEntries(this.lastProcessedSeq),
    };
  }
}
