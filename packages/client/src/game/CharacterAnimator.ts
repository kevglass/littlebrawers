import * as THREE from "three";

const RUN_CLIP_PATTERN = /\|Run$/;
const IDLE_CLIP_PATTERN = /\|Idle$/;
const SHOOT_CLIP_PATTERN = /\|Shoot_OneHanded$/;

export class CharacterAnimator {
  private readonly mixer: THREE.AnimationMixer;
  private idleAction: THREE.AnimationAction | undefined;
  private runAction: THREE.AnimationAction | undefined;
  private shootAction: THREE.AnimationAction | undefined;

  constructor(root: THREE.Object3D, animations: THREE.AnimationClip[]) {
    this.mixer = new THREE.AnimationMixer(root);

    const idleClip = animations.find((a) => IDLE_CLIP_PATTERN.test(a.name));
    const runClip = animations.find((a) => RUN_CLIP_PATTERN.test(a.name));
    const shootClip = animations.find((a) => SHOOT_CLIP_PATTERN.test(a.name));

    if (idleClip) {
      this.idleAction = this.mixer.clipAction(idleClip);
      this.idleAction.weight = 1;
      this.idleAction.play();
    }
    if (runClip) {
      this.runAction = this.mixer.clipAction(runClip);
      this.runAction.weight = 0;
      this.runAction.play();
    }
    if (shootClip) {
      this.shootAction = this.mixer.clipAction(shootClip);
      this.shootAction.setLoop(THREE.LoopOnce, 1);
      this.shootAction.clampWhenFinished = false;
    }

    this.mixer.addEventListener("finished", (e) => {
      if (e.action === this.shootAction) this.shootAction?.stop();
    });
  }

  triggerAttack(): void {
    if (this.shootAction) {
      this.shootAction.reset();
      this.shootAction.weight = 1;
      this.shootAction.play();
    }
  }

  update(dtSeconds: number, speedRatio: number): void {
    const run = Math.max(0, Math.min(1, speedRatio));
    if (this.idleAction) this.idleAction.weight = 1 - run;
    if (this.runAction) this.runAction.weight = run;
    this.mixer.update(dtSeconds);
  }

  dispose(): void {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.mixer.getRoot() as THREE.Object3D);
  }
}
