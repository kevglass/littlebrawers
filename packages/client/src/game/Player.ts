import * as THREE from "three";
import { GAME_CONSTANTS } from "@brawlers/shared";
import { CharacterAnimator } from "./CharacterAnimator";
import { createCharacterInstance } from "./CharacterModel";

const HEALTH_BAR_WIDTH = 1.2;
const HEALTH_BAR_HEIGHT = 0.14;
const HEALTH_BAR_Y_OFFSET = 1.95;
const NAME_Y_OFFSET = HEALTH_BAR_Y_OFFSET + 0.3;
const MARKER_RADIUS = 0.55;

export class Player {
  readonly group = new THREE.Group();

  private readonly marker: THREE.Mesh;
  private readonly healthBarFill: THREE.Mesh;
  private readonly healthBarBg: THREE.Mesh;
  private readonly nameSprite: THREE.Sprite;
  private characterRoot: THREE.Group | undefined;
  private animator: CharacterAnimator | undefined;
  private lastAttackSeq = 0;

  hp: number = GAME_CONSTANTS.PLAYER_MAX_HP;
  maxHp: number = GAME_CONSTANTS.PLAYER_MAX_HP;

  constructor(
    public readonly peerId: string,
    public readonly name: string,
    public readonly color: number,
    public readonly isLocal: boolean,
  ) {
    this.marker = new THREE.Mesh(
      new THREE.CircleGeometry(MARKER_RADIUS, 24),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85 }),
    );
    this.marker.rotation.x = -Math.PI / 2;
    this.marker.position.y = 0.02;
    this.group.add(this.marker);

    this.healthBarBg = new THREE.Mesh(
      new THREE.PlaneGeometry(HEALTH_BAR_WIDTH, HEALTH_BAR_HEIGHT),
      new THREE.MeshBasicMaterial({ color: 0x1a1a1a, depthTest: false }),
    );
    this.healthBarBg.position.y = HEALTH_BAR_Y_OFFSET;
    this.healthBarBg.renderOrder = 1;
    this.group.add(this.healthBarBg);

    this.healthBarFill = new THREE.Mesh(
      new THREE.PlaneGeometry(HEALTH_BAR_WIDTH, HEALTH_BAR_HEIGHT),
      new THREE.MeshBasicMaterial({ color: 0x38d34a, depthTest: false }),
    );
    this.healthBarFill.position.y = HEALTH_BAR_Y_OFFSET;
    this.healthBarFill.position.z = 0.001;
    this.healthBarFill.renderOrder = 2;
    this.group.add(this.healthBarFill);

    this.nameSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeNameTexture(name) }));
    this.nameSprite.position.y = NAME_Y_OFFSET;
    this.nameSprite.scale.set(1.6, 0.4, 1);
    this.group.add(this.nameSprite);

    void createCharacterInstance().then(({ root, animations }) => {
      this.characterRoot = root;
      this.group.add(root);
      this.animator = new CharacterAnimator(root, animations);
    });
  }

  setPosition(x: number, z: number): void {
    this.group.position.set(x, 0, z);
  }

  setAim(aimX: number, aimZ: number): void {
    if (aimX === 0 && aimZ === 0) return;
    this.group.rotation.y = Math.atan2(aimX, aimZ);
  }

  setHp(hp: number, maxHp: number): void {
    this.hp = hp;
    this.maxHp = maxHp;
    const ratio = Math.max(0, Math.min(1, hp / maxHp));
    this.healthBarFill.scale.x = ratio;
    this.healthBarFill.position.x = -(HEALTH_BAR_WIDTH * (1 - ratio)) / 2;
    const material = this.healthBarFill.material as THREE.MeshBasicMaterial;
    material.color.setHex(ratio > 0.5 ? 0x38d34a : ratio > 0.25 ? 0xe6c33a : 0xd4392f);
  }

  /** Drives locomotion/attack animation. `attackSeq` increments upstream each time the player attacks. */
  updateAnimation(dtSeconds: number, moving: boolean, attackSeq: number): void {
    if (attackSeq !== this.lastAttackSeq) {
      this.lastAttackSeq = attackSeq;
      this.animator?.triggerAttack();
    }
    this.animator?.update(dtSeconds, moving ? 1 : 0);
  }

  setVisible(visible: boolean): void {
    this.group.visible = visible;
  }

  faceCameraBillboards(cameraQuaternion: THREE.Quaternion): void {
    this.healthBarBg.quaternion.copy(cameraQuaternion);
    this.healthBarFill.quaternion.copy(cameraQuaternion);
  }

  dispose(): void {
    this.marker.geometry.dispose();
    (this.marker.material as THREE.Material).dispose();
    this.healthBarBg.geometry.dispose();
    (this.healthBarBg.material as THREE.Material).dispose();
    this.healthBarFill.geometry.dispose();
    (this.healthBarFill.material as THREE.Material).dispose();
    (this.nameSprite.material as THREE.SpriteMaterial).map?.dispose();
    this.nameSprite.material.dispose();
    // characterRoot's geometry/materials are shared from the cached template — just detach, don't dispose.
    if (this.characterRoot) this.group.remove(this.characterRoot);
  }
}

function makeNameTexture(name: string): THREE.Texture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  ctx.font = "bold 36px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineWidth = 6;
  ctx.strokeStyle = "rgba(0,0,0,0.8)";
  ctx.strokeText(name, canvas.width / 2, canvas.height / 2);
  ctx.fillStyle = "white";
  ctx.fillText(name, canvas.width / 2, canvas.height / 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}
