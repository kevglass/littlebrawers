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
  moving: boolean;
  attackSeq: number;
}

const RESPAWN_DELAY_MS = 3000;

/**
 * Host-authoritative game state. Runs only on the peer hosting the room;
 * clients just render the GameSnapshotMessage broadcasts this produces.
 */
export class Simulation {
  private readonly players = new Map<string, SimPlayerState>();
  private readonly latestInput = new Map<string, PlayerInputMessage>();
  private readonly lastProcessedSeq = new Map<string, number>();
  private tick = 0;

  constructor(
    private readonly map: MapData,
    playerInfos: SimPlayerInfo[],
  ) {
    const spawns = map.spawnPoints.length > 0 ? map.spawnPoints : [{ x: 1, y: 1, team: 0 }];
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
        moving: false,
        attackSeq: 0,
      });
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
    const spawns = this.map.spawnPoints.length > 0 ? this.map.spawnPoints : [{ x: 1, y: 1, team: 0 }];
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
      bestTarget.hp = Math.max(0, bestTarget.hp - GAME_CONSTANTS.ATTACK_DAMAGE);
      if (bestTarget.hp === 0) {
        bestTarget.alive = false;
        bestTarget.respawnAtMs = nowMs + RESPAWN_DELAY_MS;
      }
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
