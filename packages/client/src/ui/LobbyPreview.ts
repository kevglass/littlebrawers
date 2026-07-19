import * as THREE from "three";
import { createCharacterInstance, DEFAULT_CHARACTER_MODEL, type CharacterModelId } from "../game/CharacterModel";
import { CharacterAnimator } from "../game/CharacterAnimator";

export class LobbyPreview {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private animator: CharacterAnimator | undefined;
  private characterRoot: THREE.Group | undefined;
  private disposed = false;
  private animHandle = 0;
  private lastTime = performance.now();
  private rotationY = 0;
  /** Guards against an earlier setModel()'s load resolving after a later one has started. */
  private modelLoadToken = 0;

  constructor(canvas: HTMLCanvasElement, characterModel: CharacterModelId = DEFAULT_CHARACTER_MODEL) {
    const w = canvas.clientWidth || 300;
    const h = canvas.clientHeight || 400;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h);
    this.renderer.setClearColor(0x0d1117, 1);
    this.renderer.shadowMap.enabled = true;

    this.camera = new THREE.PerspectiveCamera(40, w / h, 0.1, 100);
    this.camera.position.set(0, 1.1, 3.5);
    this.camera.lookAt(0, 0.9, 0);

    const ambient = new THREE.AmbientLight(0x8ab4cc, 0.6);
    this.scene.add(ambient);

    const key = new THREE.DirectionalLight(0xffffff, 1.2);
    key.position.set(-3, 6, 4);
    key.castShadow = true;
    this.scene.add(key);

    const fill = new THREE.DirectionalLight(0x4466aa, 0.4);
    fill.position.set(4, 2, -2);
    this.scene.add(fill);

    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(2.5, 48),
      new THREE.MeshStandardMaterial({ color: 0x1a2235, roughness: 0.9 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    this.setModel(characterModel);
    this.animate();
  }

  /** Swaps the previewed character model, e.g. when the player changes their selection. */
  setModel(characterModel: CharacterModelId): void {
    const token = ++this.modelLoadToken;
    if (this.characterRoot) {
      this.scene.remove(this.characterRoot);
      this.characterRoot = undefined;
    }
    this.animator?.dispose();
    this.animator = undefined;

    void createCharacterInstance(characterModel).then(({ root, clipsByMesh }) => {
      if (this.disposed || token !== this.modelLoadToken) return;
      this.characterRoot = root;
      this.scene.add(root);
      this.animator = new CharacterAnimator(clipsByMesh);
      // Prime a first frame so the model isn't in T-pose while it fades in.
      this.animator.update(0, 1);
    });
  }

  private animate = (): void => {
    if (this.disposed) return;
    this.animHandle = requestAnimationFrame(this.animate);

    const now = performance.now();
    const dt = Math.min((now - this.lastTime) / 1000, 0.1);
    this.lastTime = now;

    this.rotationY += dt * 0.4;
    if (this.characterRoot) this.characterRoot.rotation.y = this.rotationY;

    this.animator?.update(dt, 1);
    this.renderer.render(this.scene, this.camera);
  };

  resize(w: number, h: number): void {
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.animHandle);
    this.animator?.dispose();
    this.renderer.dispose();
  }
}
