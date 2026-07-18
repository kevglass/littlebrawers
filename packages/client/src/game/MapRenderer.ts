import * as THREE from "three";
import { TileType, type MapData } from "@brawlers/shared";
import { tileToWorld } from "./mapGeometry";

const WALL_HEIGHT = 2.2;
const BUSH_HEIGHT = 1.1;

export class MapRenderer {
  readonly group = new THREE.Group();

  constructor(map: MapData) {
    this.group.add(this.buildGround(map));

    const wallGeometries: THREE.BufferGeometry[] = [];
    const bushGeometries: THREE.BufferGeometry[] = [];

    for (let ty = 0; ty < map.height; ty++) {
      for (let tx = 0; tx < map.width; tx++) {
        const tile = map.tiles[ty]?.[tx];
        if (tile === TileType.Wall) {
          wallGeometries.push(this.tileBoxGeometry(map, tx, ty, WALL_HEIGHT));
        } else if (tile === TileType.Bush) {
          bushGeometries.push(this.tileBoxGeometry(map, tx, ty, BUSH_HEIGHT));
        }
      }
    }

    if (wallGeometries.length > 0) {
      const merged = mergeBoxGeometries(wallGeometries);
      const wallMesh = new THREE.Mesh(merged, new THREE.MeshStandardMaterial({ color: 0x6b6f7a }));
      wallMesh.castShadow = true;
      wallMesh.receiveShadow = true;
      this.group.add(wallMesh);
    }

    if (bushGeometries.length > 0) {
      const merged = mergeBoxGeometries(bushGeometries);
      const bushMesh = new THREE.Mesh(
        merged,
        new THREE.MeshStandardMaterial({ color: 0x3f7d3a, transparent: true, opacity: 0.75 }),
      );
      this.group.add(bushMesh);
    }
  }

  private buildGround(map: MapData): THREE.Mesh {
    const width = map.width * map.tileSize;
    const height = map.height * map.tileSize;
    const geometry = new THREE.PlaneGeometry(width, height);
    geometry.rotateX(-Math.PI / 2);
    const material = new THREE.MeshStandardMaterial({ color: 0x4a8f4a });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.receiveShadow = true;
    return mesh;
  }

  private tileBoxGeometry(map: MapData, tx: number, ty: number, height: number): THREE.BufferGeometry {
    const { x, z } = tileToWorld(map, tx, ty);
    const geometry = new THREE.BoxGeometry(map.tileSize, height, map.tileSize);
    geometry.translate(x, height / 2, z);
    return geometry;
  }

  dispose(): void {
    this.group.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
        else obj.material.dispose();
      }
    });
  }
}

/** Minimal geometry merge (position/normal/uv, no groups) so a whole tileset is one draw call. */
function mergeBoxGeometries(geometries: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  let indexOffset = 0;

  for (const geometry of geometries) {
    const position = geometry.getAttribute("position");
    const normal = geometry.getAttribute("normal");
    const uv = geometry.getAttribute("uv");
    const index = geometry.getIndex();

    for (let i = 0; i < position.count; i++) {
      positions.push(position.getX(i), position.getY(i), position.getZ(i));
      normals.push(normal.getX(i), normal.getY(i), normal.getZ(i));
      uvs.push(uv.getX(i), uv.getY(i));
    }

    if (index) {
      for (let i = 0; i < index.count; i++) indices.push(index.getX(i) + indexOffset);
    }

    indexOffset += position.count;
    geometry.dispose();
  }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  merged.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  merged.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  merged.setIndex(indices);
  return merged;
}
