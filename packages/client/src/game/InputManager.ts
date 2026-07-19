import * as THREE from "three";

export interface LocalInputState {
  moveX: number;
  moveY: number;
  aimX: number;
  aimZ: number;
  attack: boolean;
}

const GROUND_PLANE = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const JOYSTICK_DEAD_ZONE = 0.15;

function createOverlayEl(tag: string, className: string): HTMLDivElement {
  const el = document.createElement(tag) as HTMLDivElement;
  el.className = className;
  return el;
}

/**
 * Keyboard (WASD/arrows) + mouse-on-ground aim, plus touch equivalents: a virtual
 * joystick for movement and a button for attack. The joystick/button are always in
 * the DOM; CSS shows them only for coarse/touch-primary pointers (see .touch-controls).
 */
export class InputManager {
  private readonly keys = new Set<string>();
  private mouseNdc = new THREE.Vector2(0, 0);
  private mouseActive = false;
  private attackHeld = false;
  private readonly raycaster = new THREE.Raycaster();

  private readonly joystickBase: HTMLDivElement;
  private readonly joystickKnob: HTMLDivElement;
  private readonly attackButton: HTMLDivElement;
  private joystickTouchId: number | null = null;
  private readonly joystickVector = new THREE.Vector2(0, 0);
  private touchAttackHeld = false;
  /** Facing direction to fall back on when there's no mouse to aim with (touch has no hover). */
  private readonly lastAimDir = new THREE.Vector2(0, 1);

  constructor(
    private readonly domElement: HTMLElement,
    private readonly camera: THREE.Camera,
    container: HTMLElement,
  ) {
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    domElement.addEventListener("mousemove", this.onMouseMove);
    domElement.addEventListener("mousedown", this.onMouseDown);
    domElement.addEventListener("mouseup", this.onMouseUp);
    domElement.addEventListener("contextmenu", (e) => e.preventDefault());

    this.joystickBase = createOverlayEl("div", "touch-joystick-base");
    this.joystickKnob = createOverlayEl("div", "touch-joystick-knob");
    this.joystickBase.appendChild(this.joystickKnob);
    container.appendChild(this.joystickBase);

    this.attackButton = createOverlayEl("div", "touch-attack-button");
    this.attackButton.textContent = "⚔";
    container.appendChild(this.attackButton);

    this.joystickBase.addEventListener("touchstart", this.onJoystickTouchStart, { passive: false });
    window.addEventListener("touchmove", this.onJoystickTouchMove, { passive: false });
    window.addEventListener("touchend", this.onJoystickTouchEnd);
    window.addEventListener("touchcancel", this.onJoystickTouchEnd);

    this.attackButton.addEventListener("touchstart", this.onAttackTouchStart, { passive: false });
    this.attackButton.addEventListener("touchend", this.onAttackTouchEnd);
    this.attackButton.addEventListener("touchcancel", this.onAttackTouchEnd);
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    this.keys.add(e.code);
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
  };

  private onMouseMove = (e: MouseEvent): void => {
    this.mouseActive = true;
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

  private onJoystickTouchStart = (e: TouchEvent): void => {
    e.preventDefault();
    if (this.joystickTouchId !== null) return;
    const touch = e.changedTouches[0];
    if (!touch) return;
    this.joystickTouchId = touch.identifier;
    this.updateJoystick(touch);
  };

  private onJoystickTouchMove = (e: TouchEvent): void => {
    if (this.joystickTouchId === null) return;
    const touch = Array.from(e.changedTouches).find((t) => t.identifier === this.joystickTouchId);
    if (!touch) return;
    e.preventDefault();
    this.updateJoystick(touch);
  };

  private onJoystickTouchEnd = (e: TouchEvent): void => {
    if (this.joystickTouchId === null) return;
    const ended = Array.from(e.changedTouches).some((t) => t.identifier === this.joystickTouchId);
    if (!ended) return;
    this.joystickTouchId = null;
    this.joystickVector.set(0, 0);
    this.joystickKnob.style.transform = "translate(-50%, -50%)";
  };

  private updateJoystick(touch: Touch): void {
    const rect = this.joystickBase.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const maxRadius = rect.width / 2;

    let dx = touch.clientX - centerX;
    let dy = touch.clientY - centerY;
    const dist = Math.hypot(dx, dy);
    if (dist > maxRadius) {
      dx = (dx / dist) * maxRadius;
      dy = (dy / dist) * maxRadius;
    }

    const nx = dx / maxRadius;
    const ny = dy / maxRadius;
    const inDeadZone = Math.hypot(nx, ny) < JOYSTICK_DEAD_ZONE;
    this.joystickVector.set(inDeadZone ? 0 : nx, inDeadZone ? 0 : ny);
    this.joystickKnob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
  }

  private onAttackTouchStart = (e: TouchEvent): void => {
    e.preventDefault();
    this.touchAttackHeld = true;
    this.attackButton.classList.add("active");
  };

  private onAttackTouchEnd = (): void => {
    this.touchAttackHeld = false;
    this.attackButton.classList.remove("active");
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

    if (this.joystickVector.lengthSq() > 0) {
      moveX = this.joystickVector.x;
      moveY = this.joystickVector.y;
    } else {
      if (this.keys.has("KeyW") || this.keys.has("ArrowUp")) moveY -= 1;
      if (this.keys.has("KeyS") || this.keys.has("ArrowDown")) moveY += 1;
      if (this.keys.has("KeyA") || this.keys.has("ArrowLeft")) moveX -= 1;
      if (this.keys.has("KeyD") || this.keys.has("ArrowRight")) moveX += 1;
      const len = Math.hypot(moveX, moveY);
      if (len > 0) {
        moveX /= len;
        moveY /= len;
      }
    }

    let aimX: number | undefined;
    let aimZ: number | undefined;
    if (this.mouseActive) {
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
    }
    if (aimX === undefined || aimZ === undefined) {
      // No mouse to aim with (touch has no hover) — face the movement direction,
      // or keep the last facing direction while standing still.
      const moveLen = Math.hypot(moveX, moveY);
      if (moveLen > 0.001) this.lastAimDir.set(moveX / moveLen, moveY / moveLen);
      aimX = this.lastAimDir.x;
      aimZ = this.lastAimDir.y;
    }

    return { moveX, moveY, aimX, aimZ, attack: this.attackHeld || this.touchAttackHeld };
  }

  dispose(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    this.domElement.removeEventListener("mousemove", this.onMouseMove);
    this.domElement.removeEventListener("mousedown", this.onMouseDown);
    this.domElement.removeEventListener("mouseup", this.onMouseUp);
    window.removeEventListener("touchmove", this.onJoystickTouchMove);
    window.removeEventListener("touchend", this.onJoystickTouchEnd);
    window.removeEventListener("touchcancel", this.onJoystickTouchEnd);
    this.joystickBase.remove();
    this.attackButton.remove();
  }
}
