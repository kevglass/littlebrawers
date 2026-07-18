import * as THREE from "three";

export interface LocalInputState {
  moveX: number;
  moveY: number;
  aimX: number;
  aimZ: number;
  attack: boolean;
}

const GROUND_PLANE = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

/** Keyboard (WASD/arrows) movement + mouse-on-ground aim direction. */
export class InputManager {
  private readonly keys = new Set<string>();
  private mouseNdc = new THREE.Vector2(0, 0);
  private attackHeld = false;
  private readonly raycaster = new THREE.Raycaster();

  constructor(
    private readonly domElement: HTMLElement,
    private readonly camera: THREE.Camera,
  ) {
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    domElement.addEventListener("mousemove", this.onMouseMove);
    domElement.addEventListener("mousedown", this.onMouseDown);
    domElement.addEventListener("mouseup", this.onMouseUp);
    domElement.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    this.keys.add(e.code);
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
  };

  private onMouseMove = (e: MouseEvent): void => {
    const rect = this.domElement.getBoundingClientRect();
    this.mouseNdc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouseNdc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  };

  private onMouseDown = (): void => {
    this.attackHeld = true;
  };

  private onMouseUp = (): void => {
    this.attackHeld = false;
  };

  /** Ground-plane intersection point of the current mouse position, in world space. */
  private getMouseGroundPoint(): THREE.Vector3 | null {
    this.raycaster.setFromCamera(this.mouseNdc, this.camera);
    const point = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(GROUND_PLANE, point) ? point : null;
  }

  sample(playerWorldX: number, playerWorldZ: number): LocalInputState {
    let moveX = 0;
    let moveY = 0;
    if (this.keys.has("KeyW") || this.keys.has("ArrowUp")) moveY -= 1;
    if (this.keys.has("KeyS") || this.keys.has("ArrowDown")) moveY += 1;
    if (this.keys.has("KeyA") || this.keys.has("ArrowLeft")) moveX -= 1;
    if (this.keys.has("KeyD") || this.keys.has("ArrowRight")) moveX += 1;

    const len = Math.hypot(moveX, moveY);
    if (len > 0) {
      moveX /= len;
      moveY /= len;
    }

    let aimX = 0;
    let aimZ = 1;
    const groundPoint = this.getMouseGroundPoint();
    if (groundPoint) {
      const dx = groundPoint.x - playerWorldX;
      const dz = groundPoint.z - playerWorldZ;
      const aimLen = Math.hypot(dx, dz);
      if (aimLen > 0.001) {
        aimX = dx / aimLen;
        aimZ = dz / aimLen;
      }
    }

    return { moveX, moveY, aimX, aimZ, attack: this.attackHeld };
  }

  dispose(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    this.domElement.removeEventListener("mousemove", this.onMouseMove);
    this.domElement.removeEventListener("mousedown", this.onMouseDown);
    this.domElement.removeEventListener("mouseup", this.onMouseUp);
  }
}
