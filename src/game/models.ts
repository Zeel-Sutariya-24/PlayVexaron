// Procedural models: the enchanted spellbook, the first-person book rig, and the enemy mage.
import * as THREE from "three";
import { glowSprite, makeCanvasTexture } from "./fx";
import type { SpellType } from "./elements";

let pageTex: THREE.CanvasTexture | null = null;
let leatherTex: THREE.CanvasTexture | null = null;
let runeTex: THREE.CanvasTexture | null = null;

function pageTexture() {
  if (!pageTex) {
    pageTex = makeCanvasTexture(256, (ctx, s) => {
      const g = ctx.createLinearGradient(0, 0, s, s);
      g.addColorStop(0, "#f4f8fa");
      g.addColorStop(1, "#c8d7df");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, s, s);
      ctx.strokeStyle = "rgba(31,58,72,0.48)";
      ctx.lineWidth = 2;
      for (let y = 70; y < s - 16; y += 14) {
        ctx.beginPath();
        let x = 22;
        ctx.moveTo(x, y);
        while (x < s - 26) {
          x += 4 + Math.random() * 9;
          ctx.lineTo(Math.min(x, s - 24), y + (Math.random() - 0.5) * 3);
          x += 2;
          ctx.moveTo(x, y);
        }
        ctx.stroke();
      }
      ctx.strokeStyle = "rgba(34,127,151,0.82)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(s / 2, 38, 22, 0, Math.PI * 2);
      ctx.moveTo(s / 2, 14);
      ctx.lineTo(s / 2 + 21, 50);
      ctx.lineTo(s / 2 - 21, 50);
      ctx.closePath();
      ctx.stroke();
    });
  }
  return pageTex;
}

function leatherTexture() {
  if (!leatherTex) {
    leatherTex = makeCanvasTexture(128, (ctx, s) => {
      ctx.fillStyle = "#192833";
      ctx.fillRect(0, 0, s, s);
      for (let i = 0; i < 700; i++) {
        ctx.fillStyle = `rgba(${Math.random() < 0.5 ? "255,255,255" : "0,0,0"},${Math.random() * 0.07})`;
        ctx.fillRect(Math.random() * s, Math.random() * s, 2, 2);
      }
      ctx.strokeStyle = "#6d8798";
      ctx.lineWidth = 3;
      ctx.strokeRect(8, 8, s - 16, s - 16);
    });
  }
  return leatherTex;
}

function roundedPlate(width: number, length: number, thickness: number, radius: number) {
  const w = width / 2;
  const h = length / 2;
  const r = Math.min(radius, w * 0.45, h * 0.45);
  const shape = new THREE.Shape();
  shape.moveTo(-w + r, -h);
  shape.lineTo(w - r, -h);
  shape.quadraticCurveTo(w, -h, w, -h + r);
  shape.lineTo(w, h - r);
  shape.quadraticCurveTo(w, h, w - r, h);
  shape.lineTo(-w + r, h);
  shape.quadraticCurveTo(-w, h, -w, h - r);
  shape.lineTo(-w, -h + r);
  shape.quadraticCurveTo(-w, -h, -w + r, -h);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: thickness,
    steps: 1,
    bevelEnabled: true,
    bevelSegments: 3,
    bevelSize: Math.min(0.004, thickness * 0.22),
    bevelThickness: Math.min(0.004, thickness * 0.22),
    curveSegments: 8,
  });
  geometry.translate(0, 0, -thickness / 2);
  geometry.rotateX(Math.PI / 2);
  geometry.computeVertexNormals();
  return geometry;
}

export function runeTexture() {
  if (!runeTex) {
    runeTex = makeCanvasTexture(256, (ctx, s) => {
      ctx.clearRect(0, 0, s, s);
      ctx.strokeStyle = "#fff";
      ctx.fillStyle = "#fff";
      ctx.lineCap = "round";
      const c = s / 2;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(c, c, c - 8, 0, Math.PI * 2);
      ctx.stroke();
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(c, c, c - 26, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(c, c, c * 0.45, 0, Math.PI * 2);
      ctx.stroke();
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
        const b = ((i + 2) / 5) * Math.PI * 2 - Math.PI / 2;
        ctx.beginPath();
        ctx.moveTo(c + Math.cos(a) * (c - 26), c + Math.sin(a) * (c - 26));
        ctx.lineTo(c + Math.cos(b) * (c - 26), c + Math.sin(b) * (c - 26));
        ctx.stroke();
      }
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        const r1 = c - 8;
        const r2 = c - 24 + (i % 2) * 6;
        ctx.beginPath();
        ctx.moveTo(c + Math.cos(a) * r1, c + Math.sin(a) * r1);
        ctx.lineTo(c + Math.cos(a) * r2, c + Math.sin(a) * r2);
        ctx.stroke();
      }
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 + 0.2;
        ctx.save();
        ctx.translate(c + Math.cos(a) * (c - 17), c + Math.sin(a) * (c - 17));
        ctx.rotate(a + Math.PI / 2);
        ctx.fillRect(-2, -5, 4, 10);
        ctx.restore();
      }
    });
  }
  return runeTex;
}

/** An open spellbook lying flat (pages up, spine along Z). */
export class BookMesh {
  readonly group = new THREE.Group();
  readonly runes: THREE.Mesh;
  private flipPivot = new THREE.Group();
  private flipMesh: THREE.Mesh;
  private flipT = 1;
  private runeMat: THREE.MeshBasicMaterial;

  constructor() {
    const leather = new THREE.MeshStandardMaterial({ color: 0xffffff, map: leatherTexture(), roughness: 0.42, metalness: 0.18 });
    const gold = new THREE.MeshStandardMaterial({ color: 0x74d9ea, metalness: 0.72, roughness: 0.22, emissive: 0x124255, emissiveIntensity: 0.45 });
    const pageMat = new THREE.MeshStandardMaterial({ color: 0xffffff, map: pageTexture(), roughness: 0.9, emissive: 0x30240e });
    const blockMat = new THREE.MeshStandardMaterial({ color: 0xc5d3d9, roughness: 0.84 });

    for (const side of [-1, 1]) {
      const half = new THREE.Group();
      half.rotation.z = side * 0.1;
      const cover = new THREE.Mesh(roundedPlate(0.235, 0.32, 0.026, 0.03), leather);
      cover.position.set(side * 0.1175, -0.022, 0);
      const block = new THREE.Mesh(roundedPlate(0.215, 0.3, 0.03, 0.022), blockMat);
      block.position.set(side * 0.11, -0.002, 0);
      const top = new THREE.Mesh(new THREE.PlaneGeometry(0.212, 0.298), pageMat);
      top.rotation.x = -Math.PI / 2;
      top.position.set(side * 0.11, 0.016, 0);
      if (side < 0) top.scale.x = -1;
      const trim = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.016, 0.322), gold);
      trim.position.set(side * 0.234, -0.02, 0);
      half.add(cover, block, top, trim);
      this.group.add(half);
    }
    const spine = new THREE.Mesh(new THREE.CapsuleGeometry(0.018, 0.28, 6, 16), leather);
    spine.rotation.x = Math.PI / 2;
    spine.position.y = -0.024;
    this.group.add(spine);

    this.flipMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.21, 0.296), new THREE.MeshStandardMaterial({ map: pageTexture(), side: THREE.DoubleSide, roughness: 0.9, emissive: 0x30240e }));
    this.flipMesh.rotation.x = -Math.PI / 2;
    this.flipMesh.position.set(0.108, 0.02, 0);
    this.flipPivot.add(this.flipMesh);
    this.flipPivot.position.y = 0.01;
    this.flipPivot.visible = false;
    this.group.add(this.flipPivot);

    this.runeMat = new THREE.MeshBasicMaterial({
      map: runeTexture(),
      color: 0xffffff,
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.runes = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.34), this.runeMat);
    this.runes.rotation.x = -Math.PI / 2;
    this.runes.position.y = 0.075;
    this.group.add(this.runes);
  }

  setGlow(color: number, opacity = 0.8) {
    this.runeMat.color.setHex(color);
    this.runeMat.opacity = opacity;
  }

  flip() {
    this.flipT = 0;
    this.flipPivot.visible = true;
  }

  update(dt: number) {
    this.runes.rotation.z += dt * 0.6;
    if (this.flipT < 1) {
      this.flipT = Math.min(1, this.flipT + dt / 0.32);
      const e = this.flipT < 0.5 ? 2 * this.flipT * this.flipT : 1 - Math.pow(-2 * this.flipT + 2, 2) / 2;
      this.flipPivot.rotation.z = Math.PI * e;
      this.flipPivot.position.y = 0.01 + Math.sin(Math.PI * e) * 0.07;
      if (this.flipT >= 1) this.flipPivot.visible = false;
    }
  }
}

const gloveMat = () => new THREE.MeshStandardMaterial({ color: 0x263742, roughness: 0.48, metalness: 0.22 });
const goldMat = () => new THREE.MeshStandardMaterial({ color: 0x8fa8b4, metalness: 0.72, roughness: 0.24, emissive: 0x102632, emissiveIntensity: 0.35 });
const sleeveMat = () => new THREE.MeshStandardMaterial({ color: 0x344c59, roughness: 0.52, metalness: 0.12, emissive: 0x0a1820, side: THREE.DoubleSide });

function makeHand(mirror: number): THREE.Group {
  const g = new THREE.Group();
  const m = gloveMat();
  const palm = new THREE.Mesh(new THREE.SphereGeometry(0.047, 28, 20), m);
  palm.scale.set(1.08, 0.62, 1.22);
  g.add(palm);
  for (let i = 0; i < 4; i++) {
    const f = new THREE.Mesh(new THREE.CapsuleGeometry(0.009, 0.046, 6, 16), m);
    f.rotation.x = Math.PI / 2 - 0.2;
    f.position.set((i - 1.5) * 0.021, 0.006, -0.053);
    g.add(f);
  }
  const th = new THREE.Mesh(new THREE.CapsuleGeometry(0.01, 0.038, 6, 16), m);
  th.rotation.set(Math.PI / 2 - 0.3, 0, mirror * 0.9);
  th.position.set(mirror * 0.05, 0, -0.02);
  g.add(th);
  const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.07, 0.55, 32, 1, false), sleeveMat());
  sleeve.rotation.x = Math.PI / 2;
  sleeve.position.z = 0.3;
  const cuff = new THREE.Mesh(new THREE.TorusGeometry(0.055, 0.008, 12, 40), goldMat());
  cuff.position.z = 0.035;
  g.add(sleeve, cuff);
  return g;
}

export interface RigState {
  charge01: number;
  charging: boolean;
  speed01: number;
  dash: number;
  yawVel: number;
  pitchVel: number;
  stunned: boolean;
  t: number;
}

/** First-person spellbook + hands, parented to the camera. */
export class BookRig {
  readonly group = new THREE.Group();
  readonly book = new BookMesh();
  private bookPivot = new THREE.Group();
  private rightHand: THREE.Group;
  private leftHand: THREE.Group;
  private orb: THREE.Sprite;
  private orbCore: THREE.Sprite;
  private light: THREE.PointLight;
  private kickT = 0;
  private kickType: SpellType = "ball";
  private kickAlt = 1;
  private swayX = 0;
  private swayY = 0;
  private bobT = 0;
  private equipT = 1;
  private colorA = 0xffffff;

  constructor() {
    this.bookPivot.add(this.book.group);
    this.book.group.scale.setScalar(0.72);
    this.group.add(this.bookPivot);

    this.leftHand = makeHand(1);
    this.leftHand.rotation.set(0.9, 0.25, 0.2);
    this.leftHand.position.set(-0.17, -0.37, -0.5);
    this.leftHand.scale.setScalar(0.8);
    this.group.add(this.leftHand);

    this.rightHand = makeHand(-1);
    this.rightHand.scale.setScalar(0.8);
    this.group.add(this.rightHand);

    this.orb = glowSprite(0xffffff, 0.2, 0.9);
    this.orb.position.set(0, 0.02, -0.12);
    this.orbCore = glowSprite(0xffffff, 0.07, 1);
    this.orbCore.position.copy(this.orb.position);
    this.rightHand.add(this.orb, this.orbCore);

    this.light = new THREE.PointLight(0xffffff, 0.3, 4, 2);
    this.light.position.set(0.1, 0.1, -0.35);
    this.group.add(this.light);
  }

  setColors(a: number, _b: number) {
    void _b;
    this.colorA = a;
    this.book.setGlow(a, 0.85);
    (this.orb.material as THREE.SpriteMaterial).color.setHex(a);
    (this.orbCore.material as THREE.SpriteMaterial).color.setHex(0xffffff).lerp(new THREE.Color(a), 0.35);
    this.light.color.setHex(a);
  }

  flip() {
    this.book.flip();
    this.equipT = 0;
  }

  kick(type: SpellType, alt: number) {
    this.kickT = 1;
    this.kickType = type;
    this.kickAlt = alt;
  }

  orbWorld(out: THREE.Vector3) {
    return this.orb.getWorldPosition(out);
  }

  update(dt: number, s: RigState) {
    this.kickT = Math.max(0, this.kickT - dt * 3.6);
    this.equipT = Math.min(1, this.equipT + dt * 3);
    const k = this.kickT * this.kickT;
    this.bobT += dt * (4 + s.speed01 * 8);
    const bob = Math.sin(this.bobT) * 0.006 * s.speed01;
    const bobX = Math.cos(this.bobT * 0.5) * 0.006 * s.speed01;
    // sway lags behind camera rotation
    this.swayX += (-s.yawVel * 0.012 - this.swayX) * Math.min(1, dt * 8);
    this.swayY += (s.pitchVel * 0.012 - this.swayY) * Math.min(1, dt * 8);
    const ch = s.charge01;
    const shake = s.charging ? (0.0015 + ch * 0.004) : 0;
    const sx = (Math.random() - 0.5) * shake;
    const sy = (Math.random() - 0.5) * shake;
    const equip = Math.sin(this.equipT * Math.PI) * 0.06;
    const dashDip = s.dash * 0.09;

    // book
    const lift = s.charging ? 0.05 + ch * 0.04 : 0;
    this.bookPivot.position.set(-0.25 + bobX + this.swayX * 0.5 + sx + (this.kickType === "wall" ? 0 : 0) , -0.31 + bob + lift - equip - dashDip + this.swayY * 0.5 + sy + (this.kickType === "wall" ? k * 0.06 : 0), -0.63 + k * 0.05 + dashDip * 0.6);
    this.bookPivot.rotation.set(1.02 - lift * 2.2 - k * 0.15, 0.3 + this.swayX * 1.5, 0.04 + this.swayX);
    this.book.update(dt);
    this.book.setGlow(this.colorA, (s.stunned ? 0.25 : 0.55) + ch * 0.45);
    this.leftHand.position.set(-0.23 + bobX + this.swayX * 0.5, -0.38 + bob + lift * 0.9 - equip - dashDip, -0.5);

    // right hand: rests at right, rises while charging, thrusts on cast
    let rx = 0.3 + bobX * 1.2 + this.swayX;
    let ry = -0.31 + bob + this.swayY;
    let rz = -0.56;
    let rotX = -0.25;
    let rotY = -0.2;
    let rotZ = 0;
    if (s.charging) {
      rx -= 0.1 + ch * 0.03;
      ry += 0.14 + ch * 0.03;
      rz -= 0.06;
      rotX = 0.15;
      rx += sx * 3;
      ry += sy * 3;
    }
    if (this.kickT > 0) {
      if (this.kickType === "ball") {
        rz -= k * 0.22;
        ry += k * 0.02;
        rotX -= k * 0.3;
      } else if (this.kickType === "slash") {
        const sweep = (this.kickT - 0.5) * 2 * this.kickAlt;
        rx += sweep * -0.28;
        ry += k * 0.08;
        rz -= k * 0.12;
        rotZ = sweep * 1.1;
        rotY += sweep * 0.5;
      } else {
        ry -= k * 0.12;
        rz -= k * 0.14;
        rotX += k * 0.5;
      }
    }
    rx += dashDip * 0.4;
    ry -= dashDip;
    this.rightHand.position.set(rx, ry, rz);
    this.rightHand.rotation.set(rotX, rotY, rotZ);

    // orb at the hand
    const pulse = 1 + Math.sin(s.t * 18) * 0.08 * ch;
    const orbScale = (s.charging ? 0.1 + ch * 0.32 : 0.05) * pulse + k * 0.3;
    this.orb.scale.setScalar(orbScale);
    this.orbCore.scale.setScalar(orbScale * 0.38);
    (this.orb.material as THREE.SpriteMaterial).opacity = s.charging ? 0.95 : k * 0.9;
    (this.orbCore.material as THREE.SpriteMaterial).opacity = s.charging ? 1 : k;
    this.light.intensity = 0.25 + ch * 1.4 + k * 1.2;
  }
}

/** The enemy wizard. Faces -Z at yaw 0 (same convention as the camera). */
export class MageModel {
  readonly group = new THREE.Group();
  private root = new THREE.Group();
  private rightArm = new THREE.Group();
  private leftArm = new THREE.Group();
  private book = new BookMesh();
  private orb: THREE.Sprite;
  private aura: THREE.Mesh;
  private flashMats: { m: THREE.MeshStandardMaterial; base: THREE.Color }[] = [];
  private kickT = 0;
  private kickType: SpellType = "ball";
  private smoothSpeed = 0;
  private deadT = 0;
  private eyeMat: THREE.MeshBasicMaterial;

  constructor(accent: number) {
    const robeMat = new THREE.MeshStandardMaterial({ color: 0x273744, roughness: 0.68, metalness: 0.08, emissive: 0x07131c, side: THREE.DoubleSide });
    const trimMat = new THREE.MeshStandardMaterial({ color: 0x9ab1bc, metalness: 0.76, roughness: 0.24, emissive: 0x102630, emissiveIntensity: 0.4 });
    const skinMat = new THREE.MeshStandardMaterial({ color: 0xd9a98a, roughness: 0.8 });
    const hatMat = new THREE.MeshStandardMaterial({ color: 0x111e28, roughness: 0.48, metalness: 0.16, emissive: 0x050a0e });
    for (const m of [robeMat, skinMat, hatMat]) this.flashMats.push({ m, base: m.emissive.clone() });

    const pts: THREE.Vector2[] = [
      new THREE.Vector2(0.0, 0.1),
      new THREE.Vector2(0.54, 0.1),
      new THREE.Vector2(0.61, 0.17),
      new THREE.Vector2(0.53, 0.34),
      new THREE.Vector2(0.46, 0.68),
      new THREE.Vector2(0.37, 1.02),
      new THREE.Vector2(0.34, 1.3),
      new THREE.Vector2(0.0, 1.4),
    ];
    const robe = new THREE.Mesh(new THREE.LatheGeometry(pts, 48), robeMat);
    const hem = new THREE.Mesh(new THREE.TorusGeometry(0.57, 0.028, 12, 48), trimMat);
    hem.rotation.x = Math.PI / 2;
    hem.position.y = 0.16;
    const sash = new THREE.Mesh(new THREE.TorusGeometry(0.38, 0.045, 12, 40), trimMat);
    sash.rotation.x = Math.PI / 2;
    sash.position.y = 0.95;
    const shoulders = new THREE.Mesh(new THREE.SphereGeometry(0.34, 32, 24), robeMat);
    shoulders.scale.set(1.18, 0.64, 0.9);
    shoulders.position.y = 1.38;
    const chest = new THREE.Mesh(new THREE.SphereGeometry(0.27, 32, 24), new THREE.MeshStandardMaterial({ color: 0x405665, roughness: 0.32, metalness: 0.42, emissive: 0x10212b }));
    chest.scale.set(1.05, 0.82, 0.54);
    chest.position.set(0, 1.17, -0.23);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 32, 24), skinMat);
    head.position.y = 1.66;
    const hood = new THREE.Mesh(new THREE.SphereGeometry(0.29, 36, 28, 0, Math.PI * 2, 0, Math.PI * 0.58), hatMat);
    hood.scale.set(1.2, 1.08, 1.08);
    hood.position.set(0, 1.78, 0.035);
    const visorMat = new THREE.MeshStandardMaterial({ color: 0x163b49, emissive: 0x11748b, emissiveIntensity: 0.45, metalness: 0.58, roughness: 0.22 });
    const visor = new THREE.Mesh(new THREE.SphereGeometry(0.17, 32, 20), visorMat);
    visor.scale.set(1.16, 0.28, 0.46);
    visor.position.set(0, 1.68, -0.145);
    const brow = new THREE.Mesh(new THREE.TorusGeometry(0.155, 0.018, 10, 40, Math.PI), trimMat);
    brow.rotation.y = Math.PI;
    brow.position.set(0, 1.72, -0.17);
    this.eyeMat = new THREE.MeshBasicMaterial({ color: accent });
    const eyeGeo = new THREE.SphereGeometry(0.026, 20, 16);
    const e1 = new THREE.Mesh(eyeGeo, this.eyeMat);
    const e2 = new THREE.Mesh(eyeGeo, this.eyeMat);
    e1.position.set(-0.06, 1.685, -0.23);
    e2.position.set(0.06, 1.685, -0.23);
    this.root.add(robe, hem, sash, shoulders, chest, head, hood, visor, brow, e1, e2);

    // arms
    for (const [arm, side] of [[this.rightArm, 1], [this.leftArm, -1]] as const) {
      arm.position.set(side * 0.42, 1.38, 0);
      const sl = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.36, 8, 20), robeMat);
      sl.position.y = -0.26;
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.07, 24, 18), skinMat);
      hand.position.y = -0.56;
      const pauldron = new THREE.Mesh(new THREE.SphereGeometry(0.16, 28, 20), new THREE.MeshStandardMaterial({ color: 0x405565, roughness: 0.3, metalness: 0.48, emissive: 0x0c1a22 }));
      pauldron.scale.set(1.12, 0.72, 1.08);
      pauldron.position.y = -0.05;
      const cuff = new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.016, 12, 32), trimMat);
      cuff.rotation.x = Math.PI / 2;
      cuff.position.y = -0.5;
      arm.add(sl, hand, pauldron, cuff);
      this.root.add(arm);
    }
    this.orb = glowSprite(accent, 0.1, 0.95);
    this.orb.position.set(0, -0.62, -0.05);
    this.rightArm.add(this.orb);

    this.book.group.scale.setScalar(0.9);
    this.book.group.position.set(-0.62, 1.2, -0.35);
    this.book.group.rotation.set(0.5, 0.5, 0.1);
    this.root.add(this.book.group);

    this.aura = new THREE.Mesh(
      new THREE.PlaneGeometry(3, 3),
      new THREE.MeshBasicMaterial({ map: runeTexture(), color: accent, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    );
    this.aura.rotation.x = -Math.PI / 2;
    this.aura.position.y = 0.03;
    const halo = glowSprite(accent, 3.4, 0.28);
    halo.position.y = 1.2;
    this.root.add(halo);
    this.group.add(this.aura, this.root);
    this.group.scale.setScalar(1.15);
  }

  kick(type: SpellType) {
    this.kickT = 1;
    this.kickType = type;
  }

  get orbObject() {
    return this.orb;
  }

  update(dt: number, s: { speed01: number; charging: boolean; charge01: number; flash: number; dead: boolean; auraColor: number; auraOn: number; stunned: boolean; t: number; strafe: number }) {
    this.kickT = Math.max(0, this.kickT - dt * 3);
    const k = this.kickT * this.kickT;
    this.smoothSpeed += (s.speed01 - this.smoothSpeed) * Math.min(1, dt * 6);
    this.book.update(dt);
    this.book.setGlow(s.auraColor, 0.7);

    if (s.dead) this.deadT = Math.min(1, this.deadT + dt / 0.8);
    else this.deadT = 0;
    const dead = this.deadT;

    const hover = 0.14 + Math.sin(s.t * 2.2) * 0.05;
    this.root.position.y = hover - dead * 0.2;
    this.root.rotation.x = -this.smoothSpeed * 0.14 + dead * 1.45;
    this.root.rotation.z = -s.strafe * 0.12 + (s.stunned ? Math.sin(s.t * 40) * 0.05 : 0);

    // arms
    let rA = -0.25 + Math.sin(s.t * 2) * 0.05;
    let lA = -0.3 - Math.sin(s.t * 2 + 1) * 0.05;
    let rZ = -0.1;
    if (s.charging) {
      rA = -1.45 - s.charge01 * 0.15;
      lA = -1.0;
      rZ = -0.25;
    }
    if (this.kickT > 0) {
      if (this.kickType === "ball") rA = -1.75 * k + rA * (1 - k);
      else if (this.kickType === "slash") {
        rA = -1.2;
        rZ = -1.4 * k + 0.7 * (1 - k);
      } else {
        rA = -0.6;
        lA = -0.6;
        this.root.position.y += k * 0.1;
      }
    }
    this.rightArm.rotation.set(rA, 0, rZ);
    this.leftArm.rotation.set(lA, 0, 0.1);
    const orbS = s.charging ? 0.12 + s.charge01 * 0.4 : k * 0.4;
    this.orb.scale.setScalar(orbS * (1 + Math.sin(s.t * 20) * 0.06));
    (this.orb.material as THREE.SpriteMaterial).color.setHex(s.auraColor);
    (this.orb.material as THREE.SpriteMaterial).opacity = s.charging ? 1 : k;

    const am = this.aura.material as THREE.MeshBasicMaterial;
    am.color.setHex(s.auraColor);
    am.opacity = 0.12 + s.auraOn * 0.5;
    this.aura.rotation.z += dt * 0.5;
    this.eyeMat.color.setHex(s.auraOn > 0.1 ? s.auraColor : 0xffd27a);

    for (const f of this.flashMats) f.m.emissive.copy(f.base).lerp(new THREE.Color(0xff5533), Math.min(1, s.flash));
    this.group.visible = true;
  }

  dispose() {
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as THREE.Material | undefined;
      if (mat && !(mat as THREE.SpriteMaterial).isSpriteMaterial) mat.dispose();
    });
  }
}
