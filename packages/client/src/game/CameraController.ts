import * as THREE from "three";

const OFFSET = new THREE.Vector3(0, 16, 10);
// Exponential smoothing coefficient: 1/e decay per (1/FOLLOW_SPEED) seconds, frame-rate independent.
const FOLLOW_SPEED = 10;

/** Fixed-angle top-down-ish follow camera, in the style of Brawl Stars. */
export class CameraController {
  readonly camera: THREE.PerspectiveCamera;
  private readonly targetPosition = new THREE.Vector3();
  private readonly lookAt = new THREE.Vector3();

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(50, aspect, 0.1, 200);
    this.camera.position.copy(OFFSET);
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  follow(worldX: number, worldZ: number, dt: number): void {
    this.targetPosition.set(worldX + OFFSET.x, OFFSET.y, worldZ + OFFSET.z);
    const alpha = 1 - Math.exp(-FOLLOW_SPEED * dt);
    this.camera.position.lerp(this.targetPosition, alpha);
    this.lookAt.set(worldX, 0, worldZ);
    this.camera.lookAt(this.lookAt);
  }

  snapTo(worldX: number, worldZ: number): void {
    this.camera.position.set(worldX + OFFSET.x, OFFSET.y, worldZ + OFFSET.z);
    this.camera.lookAt(worldX, 0, worldZ);
  }
}
