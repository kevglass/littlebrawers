export enum TileType {
  Empty = 0,
  Wall = 1,
  Bush = 2,
}

export interface SpawnPoint {
  /** tile column */
  x: number;
  /** tile row */
  y: number;
  team: number;
}

export interface MapData {
  id: string;
  name: string;
  width: number;
  height: number;
  /** world-space size of one tile, in three.js units */
  tileSize: number;
  /** row-major grid, tiles[y][x] */
  tiles: TileType[][];
  spawnPoints: SpawnPoint[];
}

export function createEmptyMap(name: string, width: number, height: number, tileSize = 2): MapData {
  const tiles: TileType[][] = [];
  for (let y = 0; y < height; y++) {
    const row: TileType[] = [];
    for (let x = 0; x < width; x++) {
      const isBorder = x === 0 || y === 0 || x === width - 1 || y === height - 1;
      row.push(isBorder ? TileType.Wall : TileType.Empty);
    }
    tiles.push(row);
  }
  return {
    id: crypto.randomUUID(),
    name,
    width,
    height,
    tileSize,
    tiles,
    spawnPoints: [],
  };
}

export function isBlockingTile(tile: TileType): boolean {
  return tile === TileType.Wall;
}
