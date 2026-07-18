export const GAME_CONSTANTS = {
  PLAYER_RADIUS: 0.6,
  PLAYER_SPEED: 6, // world units per second
  PLAYER_MAX_HP: 100,
  ATTACK_RANGE: 8,
  ATTACK_DAMAGE: 20,
  ATTACK_COOLDOWN_MS: 600,
  SNAPSHOT_RATE_HZ: 20,
  TICK_RATE_HZ: 30,
} as const;

export interface PlayerColor {
  name: string;
  hex: number;
}

export const PLAYER_COLORS: PlayerColor[] = [
  { name: "Red", hex: 0xe74c3c },
  { name: "Blue", hex: 0x3498db },
  { name: "Green", hex: 0x2ecc71 },
  { name: "Yellow", hex: 0xf1c40f },
  { name: "Purple", hex: 0x9b59b6 },
  { name: "Orange", hex: 0xe67e22 },
];
