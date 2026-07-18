import { isBlockingTile, TileType, type MapData } from "@brawlers/shared";

/** World X/Z position of the center of tile (tx, ty). Map is centered on the origin. */
export function tileToWorld(map: MapData, tx: number, ty: number): { x: number; z: number } {
  const halfW = (map.width * map.tileSize) / 2;
  const halfH = (map.height * map.tileSize) / 2;
  return {
    x: tx * map.tileSize + map.tileSize / 2 - halfW,
    z: ty * map.tileSize + map.tileSize / 2 - halfH,
  };
}

export function worldToTile(map: MapData, x: number, z: number): { tx: number; ty: number } {
  const halfW = (map.width * map.tileSize) / 2;
  const halfH = (map.height * map.tileSize) / 2;
  return {
    tx: Math.floor((x + halfW) / map.tileSize),
    ty: Math.floor((z + halfH) / map.tileSize),
  };
}

export function tileAt(map: MapData, tx: number, ty: number): TileType {
  if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) return TileType.Wall;
  return map.tiles[ty]?.[tx] ?? TileType.Wall;
}

/**
 * Resolves a moving circle against blocking tiles by pushing it out of any
 * overlapping tile AABB along the axis of least penetration. Cheap and good
 * enough for a flat, grid-based arena with no elevation.
 */
export function resolveCircleCollision(
  map: MapData,
  x: number,
  z: number,
  radius: number,
): { x: number; z: number } {
  let resolvedX = x;
  let resolvedZ = z;

  const { tx: centerTx, ty: centerTy } = worldToTile(map, resolvedX, resolvedZ);
  for (let ty = centerTy - 1; ty <= centerTy + 1; ty++) {
    for (let tx = centerTx - 1; tx <= centerTx + 1; tx++) {
      if (!isBlockingTile(tileAt(map, tx, ty))) continue;

      const center = tileToWorld(map, tx, ty);
      const half = map.tileSize / 2;
      const minX = center.x - half;
      const maxX = center.x + half;
      const minZ = center.z - half;
      const maxZ = center.z + half;

      const closestX = Math.max(minX, Math.min(resolvedX, maxX));
      const closestZ = Math.max(minZ, Math.min(resolvedZ, maxZ));
      const dx = resolvedX - closestX;
      const dz = resolvedZ - closestZ;
      const distSq = dx * dx + dz * dz;

      if (distSq >= radius * radius || distSq === 0) {
        if (distSq === 0) {
          // center is exactly inside the tile; push out along the shallowest axis
          const penLeft = resolvedX - minX;
          const penRight = maxX - resolvedX;
          const penTop = resolvedZ - minZ;
          const penBottom = maxZ - resolvedZ;
          const minPen = Math.min(penLeft, penRight, penTop, penBottom);
          if (minPen === penLeft) resolvedX = minX - radius;
          else if (minPen === penRight) resolvedX = maxX + radius;
          else if (minPen === penTop) resolvedZ = minZ - radius;
          else resolvedZ = maxZ + radius;
        }
        continue;
      }

      const dist = Math.sqrt(distSq);
      const overlap = radius - dist;
      const pushX = (dx / dist) * overlap;
      const pushZ = (dz / dist) * overlap;
      resolvedX += pushX;
      resolvedZ += pushZ;
    }
  }

  return { x: resolvedX, z: resolvedZ };
}
