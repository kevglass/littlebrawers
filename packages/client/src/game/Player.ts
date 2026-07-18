import * as THREE from "three";
import { GAME_CONSTANTS } from "@brawlers/shared";

const HEALTH_BAR_WIDTH = 1.2;
const HEALTH_BAR_HEIGHT = 0.14;
const HEALTH_BAR_Y_OFFSET = 1.3;

export class Player {
  readonly group = new THREE.Group();
  readonly mesh: THREE.Mesh;
  readonly aimArrow: THREE.Mesh;

  private readonly healthBarFill: THREE.Mesh;
  private readonly healthBarBg: THREE.Mesh;
  private readonly nameSprite: THREE.Sprite;

  targetX = 0;
  targetZ = 0;
  hp: number = GAME_CONSTANTS.PLAYER_MAX_HP;
  maxHp: number = GAME_CONSTANTS.PLAYER_MAX_HP;

  constructor(
    public readonly peerId: string,
    public readonly name: string,
    public readonly color: number,
    public readonly isLocal: boolean,
  ) {
    const geometry = new THREE.SphereGeometry(GAME_CONSTANTS.PLAYER_RADIUS, 24, 16);
    const material = new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.05 });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.position.y = GAME_CONSTANTS.PLAYER_RADIUS;
    this.mesh.castShadow = true;
    this.group.add(this.mesh);

    const arrowGeometry = new THREE.ConeGeometry(0.18, 0.5, 8);
    arrowGeometry.rotateX(Math.PI / 2);
    arrowGeometry.translate(0, 0, GAME_CONSTANTS.PLAYER_RADIUS + 0.35);
    this.aimArrow = new THREE.Mesh(arrowGeometry, new THREE.MeshStandardMaterial({ color: 0xffffff }));
    this.aimArrow.position.y = GAME_CONSTANTS.PLAYER_RADIUS;
    this.group.add(this.aimArrow);

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
    this.nameSprite.position.y = HEALTH_BAR_Y_OFFSET + 0.35;
    this.nameSprite.scale.set(1.6, 0.4, 1);
    this.group.add(this.nameSprite);
  }

  setPosition(x: number, z: number): void {
    this.group.position.set(x, 0, z);
  }

  setAim(aimX: number, aimZ: number): void {
    if (aimX === 0 && aimZ === 0) return;
    const angle = Math.atan2(aimX, aimZ);
    this.group.rotation.y = angle;
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

  setVisible(visible: boolean): void {
    this.group.visible = visible;
  }

  faceCameraBillboards(cameraQuaternion: THREE.Quaternion): void {
    this.healthBarBg.quaternion.copy(cameraQuaternion);
    this.healthBarFill.quaternion.copy(cameraQuaternion);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.aimArrow.geometry.dispose();
    (this.aimArrow.material as THREE.Material).dispose();
    this.healthBarBg.geometry.dispose();
    (this.healthBarBg.material as THREE.Material).dispose();
    this.healthBarFill.geometry.dispose();
    (this.healthBarFill.material as THREE.Material).dispose();
    (this.nameSprite.material as THREE.SpriteMaterial).map?.dispose();
    this.nameSprite.material.dispose();
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
