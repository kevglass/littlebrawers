import * as THREE from "three";
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
import { clone as cloneSkeletal } from "three/addons/utils/SkeletonUtils.js";

const MODEL_URL = "/models/Soldier_Male.fbx";

/** World-space height (in tile-size units) the loaded model is rescaled to. */
const TARGET_HEIGHT = 1.7;

export interface CharacterInstance {
  /** Add this to a Player's group. Owns no unique geometry/material — safe to just remove(), no dispose needed. */
  root: THREE.Group;
  /** Baked animation clips from the FBX, re-targeted to this instance's skeleton by bone name via AnimationMixer. */
  animations: THREE.AnimationClip[];
}

let templatePromise: Promise<THREE.Group> | undefined;

function loadTemplate(): Promise<THREE.Group> {
  templatePromise ??= new Promise((resolve, reject) => {
    new FBXLoader().load(
      MODEL_URL,
      (group) => {
        fitToGround(group);
        group.traverse((obj) => {
          const mesh = obj as THREE.Mesh;
          if (mesh.isMesh) {
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            // The source FBX bakes hard per-face normals, which duplicates every vertex
            // shared between faces. mergeVertices only welds vertices whose attributes
            // all match, so the stale normals (which differ per face) block the weld —
            // drop them first so vertices merge by position/skinning alone, then
            // recompute normals so computeVertexNormals has neighbors to average.
            mesh.geometry.deleteAttribute("normal");
            mesh.geometry = mergeVertices(mesh.geometry);
            mesh.geometry.computeVertexNormals();
            // FBXLoader misreads this asset's default TransparentColor as a transparency
            // factor (no TransparencyFactor/Opacity is set), leaving materials at opacity
            // 0 — invisible in color passes even though shadows (depth-only) still render.
            for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
              material.transparent = false;
              material.opacity = 1;
            }
          }
        });
        resolve(group);
      },
      undefined,
      (err) => reject(err instanceof Error ? err : new Error(String(err))),
    );
  });
  return templatePromise;
}

function fitToGround(group: THREE.Group): void {
  group.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(group);
  const height = box.max.y - box.min.y;
  if (height > 0) group.scale.setScalar(TARGET_HEIGHT / height);

  group.updateMatrixWorld(true);
  const rescaledBox = new THREE.Box3().setFromObject(group);
  group.position.y -= rescaledBox.min.y;
  group.updateMatrixWorld(true);
}

/** Loads (once, cached) and clones the character model with its own independent skeleton. */
export async function createCharacterInstance(): Promise<CharacterInstance> {
  const template = await loadTemplate();
  const root = cloneSkeletal(template) as THREE.Group;
  root.updateMatrixWorld(true);
  // Clips stay on the template; AnimationMixer re-targets them to cloned bones by name.
  return { root, animations: template.animations };
}
