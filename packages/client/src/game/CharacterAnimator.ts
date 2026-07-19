import * as THREE from "three";

// Matches both "CharacterArmature|Run"-style names (the Soldier's own Mixamo export) and
// plain "Run"-style names (this project's re-exported clips, renamed on load since Mixamo
// always calls the actual clip "mixamo.com" regardless of the download filename).
const RUN_CLIP_PATTERN = /(^|\|)Run$/;
const IDLE_CLIP_PATTERN = /(^|\|)Idle$/;
const SHOOT_CLIP_PATTERN = /(^|\|)Shoot_OneHanded$/;

interface MeshRig {
  mixer: THREE.AnimationMixer;
  idleAction: THREE.AnimationAction | undefined;
  runAction: THREE.AnimationAction | undefined;
  shootAction: THREE.AnimationAction | undefined;
}

/**
 * Drives locomotion/attack animation. Some models (Mina, Shelly) have each of their
 * meshes — body, hair, clothes, props — rigged with its own independent skeleton
 * instance rather than one shared skeleton, so a single AnimationMixer bound to the
 * model root can't move all of them; this holds one mixer per mesh instead, all
 * updated together each frame so they stay in sync.
 */
export class CharacterAnimator {
  private readonly rigs: MeshRig[];

  constructor(clipsByMesh: Map<THREE.Object3D, THREE.AnimationClip[]>) {
    this.rigs = [...clipsByMesh.entries()].map(([mesh, clips]) => {
      const mixer = new THREE.AnimationMixer(mesh);

      const idleClip = clips.find((a) => IDLE_CLIP_PATTERN.test(a.name));
      const runClip = clips.find((a) => RUN_CLIP_PATTERN.test(a.name));
      const shootClip = clips.find((a) => SHOOT_CLIP_PATTERN.test(a.name));

      const idleAction = idleClip ? mixer.clipAction(idleClip) : undefined;
      if (idleAction) {
        idleAction.weight = 1;
        idleAction.play();
      }

      const runAction = runClip ? mixer.clipAction(runClip) : undefined;
      if (runAction) {
        runAction.weight = 0;
        runAction.play();
      }

      const shootAction = shootClip ? mixer.clipAction(shootClip) : undefined;
      if (shootAction) {
        shootAction.setLoop(THREE.LoopOnce, 1);
        shootAction.clampWhenFinished = false;
      }

      mixer.addEventListener("finished", (e) => {
        if (e.action === shootAction) shootAction?.stop();
      });

      return { mixer, idleAction, runAction, shootAction };
    });
  }

  triggerAttack(): void {
    for (const rig of this.rigs) {
      if (!rig.shootAction) continue;
      rig.shootAction.reset();
      rig.shootAction.weight = 1;
      rig.shootAction.play();
    }
  }

  update(dtSeconds: number, speedRatio: number): void {
    const run = Math.max(0, Math.min(1, speedRatio));
    for (const rig of this.rigs) {
      if (rig.idleAction) rig.idleAction.weight = 1 - run;
      if (rig.runAction) rig.runAction.weight = run;
      rig.mixer.update(dtSeconds);
    }
  }

  dispose(): void {
    for (const rig of this.rigs) {
      rig.mixer.stopAllAction();
      rig.mixer.uncacheRoot(rig.mixer.getRoot() as THREE.Object3D);
    }
  }
}
