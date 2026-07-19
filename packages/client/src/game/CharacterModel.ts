import * as THREE from "three";
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
import { clone as cloneSkeletal } from "three/addons/utils/SkeletonUtils.js";

export type CharacterModelId = "mina" | "shelly";
export const DEFAULT_CHARACTER_MODEL: CharacterModelId = "mina";
export const CHARACTER_MODEL_IDS: CharacterModelId[] = ["mina", "shelly"];
export const SELECTABLE_CHARACTER_MODELS: CharacterModelId[] = ["mina", "shelly"];

/** Validates a model id coming off the network (another peer's roster/start message). */
export function toCharacterModelId(id: string | undefined): CharacterModelId {
  return (CHARACTER_MODEL_IDS as string[]).includes(id ?? "") ? (id as CharacterModelId) : DEFAULT_CHARACTER_MODEL;
}

/** World-space height (in tile-size units) every model is rescaled to. */
const TARGET_HEIGHT = 1.7;

// Mina and Shelly ship as three separate Mixamo exports per model: `idle.fbx` carries the
// mesh + skeleton + an idle clip; `run.fbx`/`Shoot_OneHanded.fbx` are skeleton-only (no
// mesh) exports carrying just one animation clip each, re-using the exact same skeleton
// and bone names as idle.fbx (mixamo.com auto-rigged/re-rigged the model once and these
// are just different animations sampled off that same rig) — so their clips apply
// directly with no retargeting, as long as every mesh's AnimationMixer resolves bone
// names against its own skeleton (see CharacterAnimator).
const MODEL_DIRS: Record<CharacterModelId, string> = {
  mina: "/models/mina",
  shelly: "/models/shelly",
};

// Shelly's export carries a held-gun mesh that isn't positioned correctly on her hand bone —
// drop it entirely rather than render it floating in the wrong spot.
const EXCLUDED_MESH_NAMES: Partial<Record<CharacterModelId, RegExp>> = {
  shelly: /gun/i,
};

// Shelly's embedded FBX texture ("Tex.png") decodes to a blank/broken image — the real
// texture ships alongside the export as a separate file, so force every material onto that
// instead of whatever the FBX references internally.
const TEXTURE_OVERRIDE: Partial<Record<CharacterModelId, string>> = {
  shelly: "Shelly.jpg",
};

// Mixamo always names the actual animation clip "mixamo.com" regardless of what you type
// in the download dialog (that only affects the downloaded filename), so clips are
// identified by which file they came from, then renamed to match what CharacterAnimator's
// RUN_CLIP_PATTERN/IDLE_CLIP_PATTERN/SHOOT_CLIP_PATTERN look for.
const CLIP_FILES: { file: string; name: string }[] = [
  { file: "idle.fbx", name: "Idle" },
  { file: "run.fbx", name: "Run" },
  { file: "Shoot_OneHanded.fbx", name: "Shoot_OneHanded" },
];

export interface CharacterInstance {
  /** Add this to a Player's group. Owns no unique geometry/material — safe to just remove(), no dispose needed. */
  root: THREE.Group;
  /**
   * Per-skinned-mesh animation clips, keyed by mesh since a model can ship each of its
   * meshes (hair, clothes, body, ...) with its own independent skeleton instance rather
   * than one shared skeleton, each needing its own AnimationMixer to move together.
   */
  clipsByMesh: Map<THREE.SkinnedMesh, THREE.AnimationClip[]>;
}

interface CharacterTemplate {
  group: THREE.Group;
  /** Keyed by mesh name (stable across SkeletonUtils.clone(), unlike uuid). */
  clipsByMeshName: Map<string, THREE.AnimationClip[]>;
}

const templatePromises = new Map<CharacterModelId, Promise<CharacterTemplate>>();

/**
 * Mixamo's re-export of Mina stores her texture reference as an absolute path with
 * forward slashes (e.g. "C:/Users/.../mina_tex_highres.png"). FBXLoader only strips a
 * Windows-style path down to its basename by splitting on backslashes, so a
 * forward-slash absolute path passes through unchanged and gets naively concatenated
 * onto our own model directory — the request 200s (dev/prod servers fall back to
 * serving something for the unmatched path) but isn't the actual image, so the texture
 * silently never loads. A URL modifier intercepts every request FBXLoader/TextureLoader
 * make and rewrites any that match this pattern down to just the basename, which is
 * where the texture actually lives (alongside the FBX).
 */
function createTextureFixupManager(dir: string): THREE.LoadingManager {
  const manager = new THREE.LoadingManager();
  manager.setURLModifier((url) => {
    const match = /[A-Za-z]:[/\\].*[/\\]([^/\\]+\.(?:png|jpe?g))$/i.exec(url);
    return match ? `${dir}/${match[1]}` : url;
  });
  return manager;
}

function loadFbx(url: string, manager?: THREE.LoadingManager): Promise<THREE.Group> {
  return new Promise((resolve, reject) => {
    new FBXLoader(manager).load(url, resolve, undefined, (err) => reject(err instanceof Error ? err : new Error(String(err))));
  });
}

function removeExcludedMeshes(group: THREE.Group, pattern: RegExp | undefined): void {
  if (!pattern) return;
  const toRemove: THREE.Mesh[] = [];
  group.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.isMesh && pattern.test(mesh.name)) toRemove.push(mesh);
  });
  for (const mesh of toRemove) {
    mesh.removeFromParent();
    mesh.geometry.dispose();
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) material.dispose();
  }
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

async function applyTextureOverride(group: THREE.Group, dir: string, filename: string): Promise<void> {
  const texture = await new THREE.TextureLoader().loadAsync(`${dir}/${filename}`);
  texture.colorSpace = THREE.SRGBColorSpace;
  // This mesh's UVs run well outside [0,1] (e.g. eyebrows sit at V ≈ -0.5) — with the default
  // clamp-to-edge wrapping that samples garbage edge pixels instead of the intended region.
  // Repeat wrapping makes out-of-range coordinates wrap back into the atlas instead.
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  group.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      (material as THREE.MeshPhongMaterial).map = texture;
      material.needsUpdate = true;
    }
  });
}

function fixMeshes(group: THREE.Group): void {
  group.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      // The source FBX bakes hard per-face normals, which duplicates every vertex shared
      // between faces. mergeVertices only welds vertices whose attributes all match, so
      // the stale normals (which differ per face) block the weld — drop them first so
      // vertices merge by position/skinning alone, then recompute normals so
      // computeVertexNormals has neighbors to average.
      mesh.geometry.deleteAttribute("normal");
      mesh.geometry = mergeVertices(mesh.geometry);
      mesh.geometry.computeVertexNormals();
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        // Some of these FBX exports leave materials at opacity 0 (FBXLoader misreads a
        // default TransparentColor as a transparency factor when no TransparencyFactor/
        // Opacity is set) — invisible in color passes even though shadows still render.
        material.transparent = false;
        material.opacity = 1;
        // Flat, matte look instead of FBXLoader's default shiny MeshPhongMaterial —
        // kill the specular highlight entirely.
        const phong = material as THREE.MeshPhongMaterial;
        if (phong.isMeshPhongMaterial) {
          phong.shininess = 0;
          phong.specular.setScalar(0);
        }
      }
    }
  });
}

/** Renames the first clip with actual keyframe data (Mixamo sometimes ships an empty "Base stack" placeholder clip alongside the real one). */
function extractNamedClip(clips: THREE.AnimationClip[], name: string): THREE.AnimationClip | undefined {
  const clip = clips.find((c) => c.tracks.length > 0);
  if (clip) clip.name = name;
  return clip;
}

function isIdentityBone(bone: THREE.Bone): boolean {
  return bone.position.lengthSq() < 1e-8 && Math.abs(bone.quaternion.w) > 0.9999;
}

interface CanonicalBoneData {
  bone: THREE.Bone;
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  scale: THREE.Vector3;
  /** Undefined means the joint's real parent is a non-Bone ancestor (shared Armature/Root group). */
  parentName: string | undefined;
}

/**
 * Multi-mesh Mixamo exports (Mina, Shelly) only carry correct bind-pose bone transforms for
 * SOME meshes' copy of each joint — every other mesh's version is an identity-transform
 * duplicate Model node, and those duplicates are chained to each other (dummy-for-cap parented
 * under dummy-for-hair parented under dummy-for-leg, etc., cascading off whichever mesh got
 * the real one) rather than each hanging directly off its rightful same-mesh parent. No single
 * mesh is guaranteed to have every joint correct (Mina has one clean "primary" mesh; Shelly's
 * correct data is scattered across several meshes with none of them clean) — so this scans
 * every mesh for the first non-identity value per bone name, then for every degenerate bone
 * both re-parents it (preferring *this mesh's own* bone matching the correct parent name, and
 * falling back to the shared source bone when this mesh doesn't skin to that ancestor at all)
 * and copies in the real local transform, bypassing the bogus chain entirely. Copying the real
 * transform onto every same-named duplicate without fixing the chain would apply the same
 * offset/rotation once per nesting level — compounding into wildly stretched geometry, which
 * is exactly what a version of this repair without the re-parenting step produced. Finishes by
 * recomputing inverse bind matrices so GPU skinning matches the repaired bind pose.
 */
function repairDegenerateSkeletons(group: THREE.Group): void {
  const meshes: THREE.SkinnedMesh[] = [];
  group.traverse((obj) => {
    if ((obj as THREE.SkinnedMesh).isSkinnedMesh) meshes.push(obj as THREE.SkinnedMesh);
  });
  if (meshes.length < 2) return;

  const canonical = new Map<string, CanonicalBoneData>();
  for (const mesh of meshes) {
    for (const bone of mesh.skeleton.bones) {
      if (canonical.has(bone.name) || isIdentityBone(bone)) continue;
      canonical.set(bone.name, {
        bone,
        position: bone.position.clone(),
        quaternion: bone.quaternion.clone(),
        scale: bone.scale.clone(),
        parentName: bone.parent && (bone.parent as THREE.Bone).isBone ? bone.parent.name : undefined,
      });
    }
  }
  if (canonical.size === 0) return;

  const repairedSkeletons = new Set<THREE.Skeleton>();
  for (const mesh of meshes) {
    const byName = new Map(mesh.skeleton.bones.map((b) => [b.name, b]));
    for (const bone of mesh.skeleton.bones) {
      if (!isIdentityBone(bone)) continue;
      const good = canonical.get(bone.name);
      if (!good) continue;

      const targetParent = good.parentName
        ? (byName.get(good.parentName) ?? canonical.get(good.parentName)?.bone ?? good.bone.parent)
        : good.bone.parent;
      if (targetParent && bone.parent !== targetParent) targetParent.add(bone);

      bone.position.copy(good.position);
      bone.quaternion.copy(good.quaternion);
      bone.scale.copy(good.scale);
      repairedSkeletons.add(mesh.skeleton);
    }
  }
  if (repairedSkeletons.size === 0) return;

  group.updateMatrixWorld(true);
  for (const skeleton of repairedSkeletons) skeleton.calculateInverses();
}

/**
 * Independently of the degenerate-bone-pose bug, some exports (Shelly's shelly-miaxmo2 pass)
 * ship every mesh's `bindMatrix` reset to identity while `bindMatrixInverse` still holds the
 * correct inverse of the mesh's real placement (100x scale + axis-correction rotation) — the
 * two fall out of sync with each other and with the mesh's actual matrixWorld. Skinning uses
 * both together (world-space bone delta, converted back to mesh-local via bindMatrixInverse),
 * so this mismatch quietly wrecks every vertex position rather than throwing. Re-binding from
 * the mesh's own current (correct) matrixWorld makes both consistent again; safe to run
 * unconditionally since it's a no-op for meshes that were already correct (e.g. Mina's).
 */
function resyncBindMatrices(group: THREE.Group): void {
  group.updateMatrixWorld(true);
  group.traverse((obj) => {
    const mesh = obj as THREE.SkinnedMesh;
    if (mesh.isSkinnedMesh) mesh.bind(mesh.skeleton, mesh.matrixWorld);
  });
}

async function loadTemplate(modelId: CharacterModelId): Promise<CharacterTemplate> {
  let promise = templatePromises.get(modelId);
  if (!promise) {
    promise = (async () => {
      const dir = MODEL_DIRS[modelId];
      const manager = createTextureFixupManager(dir);
      const groups: THREE.Group[] = [];
      for (const c of CLIP_FILES) groups.push(await loadFbx(`${dir}/${c.file}`, manager));
      const idleGroup = groups[0]!;
      removeExcludedMeshes(idleGroup, EXCLUDED_MESH_NAMES[modelId]);
      repairDegenerateSkeletons(idleGroup);
      resyncBindMatrices(idleGroup);
      fitToGround(idleGroup);
      fixMeshes(idleGroup);
      const textureOverride = TEXTURE_OVERRIDE[modelId];
      if (textureOverride) await applyTextureOverride(idleGroup, dir, textureOverride);

      const clips = groups
        .map((group, i) => extractNamedClip(group.animations, CLIP_FILES[i]!.name))
        .filter((clip): clip is THREE.AnimationClip => clip !== undefined);

      // The skeleton-only run/shoot files carry no mesh, so their clips are irrelevant
      // once extracted — every mesh in idleGroup gets the exact same clip set, resolved
      // against its own skeleton by AnimationMixer at play time.
      const clipsByMeshName = new Map<string, THREE.AnimationClip[]>();
      idleGroup.traverse((obj) => {
        if ((obj as THREE.SkinnedMesh).isSkinnedMesh) clipsByMeshName.set(obj.name, clips);
      });

      return { group: idleGroup, clipsByMeshName };
    })();
    templatePromises.set(modelId, promise);
  }
  return promise;
}

/** Loads (once, cached) and clones a character model with its own independent skeleton(s). */
export async function createCharacterInstance(
  modelId: CharacterModelId = DEFAULT_CHARACTER_MODEL,
): Promise<CharacterInstance> {
  const template = await loadTemplate(modelId);
  const root = cloneSkeletal(template.group) as THREE.Group;
  root.updateMatrixWorld(true);

  const clipsByMesh = new Map<THREE.SkinnedMesh, THREE.AnimationClip[]>();
  root.traverse((obj) => {
    const mesh = obj as THREE.SkinnedMesh;
    if (!mesh.isSkinnedMesh) return;
    const clips = template.clipsByMeshName.get(mesh.name);
    if (clips) clipsByMesh.set(mesh, clips);
  });

  return { root, clipsByMesh };
}
