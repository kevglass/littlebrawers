import * as THREE from "three";

const OFFSET = new THREE.Vector3(0, 16, 10);
const FOLLOW_LERP = 0.12;

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

  follow(worldX: number, worldZ: number): void {
    this.targetPosition.set(worldX + OFFSET.x, OFFSET.y, worldZ + OFFSET.z);
    this.camera.position.lerp(this.targetPosition, FOLLOW_LERP);
    this.lookAt.set(worldX, 0, worldZ);
    this.camera.lookAt(this.lookAt);
  }

  snapTo(worldX: number, worldZ: number): void {
    this.camera.position.set(worldX + OFFSET.x, OFFSET.y, worldZ + OFFSET.z);
    this.camera.lookAt(worldX, 0, worldZ);
  }
}
