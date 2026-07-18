import { createEmptyMap, TileType, type MapData } from "@brawlers/shared";

/** A small symmetric arena used when no saved maps exist yet. */
export function buildDefaultMap(): MapData {
  const map = createEmptyMap("Default Arena", 17, 13, 2);

  const setTile = (x: number, y: number, tile: TileType): void => {
    if (y < 0 || y >= map.height || x < 0 || x >= map.width) return;
    const row = map.tiles[y];
    if (row) row[x] = tile;
  };

  // symmetric obstacle clusters
  const obstacles: Array<[number, number]> = [
    [4, 4], [4, 5], [5, 4],
    [12, 4], [12, 5], [11, 4],
    [4, 8], [4, 7], [5, 8],
    [12, 8], [12, 7], [11, 8],
    [8, 6], [8, 6],
  ];
  for (const [x, y] of obstacles) setTile(x, y, TileType.Wall);

  const bushes: Array<[number, number]> = [
    [7, 3], [9, 3], [7, 9], [9, 9], [8, 6],
  ];
  for (const [x, y] of bushes) setTile(x, y, TileType.Bush);

  map.spawnPoints = [
    { x: 1, y: 1, team: 0 },
    { x: 15, y: 11, team: 1 },
    { x: 15, y: 1, team: 2 },
    { x: 1, y: 11, team: 3 },
    { x: 8, y: 1, team: 4 },
    { x: 8, y: 11, team: 5 },
  ];

  return map;
}
