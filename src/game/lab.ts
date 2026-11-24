// The Magic Lab: a circular chamber with a floating crystal chained to Fire, Water, Wind and Earth sources.
import * as THREE from "three";
import { buildSpell, ELEMENTS, ELEMENT_ORDER, type ElementId, type SpellType } from "./elements";
import type { Engine, SceneModule } from "./engine";
import { glowSprite, makeCanvasTexture, ParticleSystem, RingPool } from "./fx";
import { runeTexture } from "./models";

export interface LabConfig {
  picks: ElementId[];
  temp: number;
  type: SpellType;
}

export interface LabCallbacks {
  onPick: (e: ElementId) => void;
  onCrystal: () => void;
  onWheel: (dir: number) => void;
}

const SRC_R = 6.2;
const CRYSTAL = new THREE.Vector3(0, 3.4, 0);
const CARDINAL: Record<ElementId, [number, number]> = { fire: [0, -1], water: [1, 0], wind: [0, 1], earth: [-1, 0] };
const LINKS = 19;
const PULSES = 5;

function makeCrystalGeometry() {
  const geometry = new THREE.BufferGeometry();
  const positions: number[] = [];
  const colors: number[] = [];
  const palette = [0x9b5cff, 0xc49aff, 0x713be8, 0xe3c5ff, 0x8b45f5, 0x5522bd].map((c) => new THREE.Color(c));
  const ring = (y: number, radius: number, offset = 0) => Array.from({ length: 6 }, (_, i) => {
    const a = (i / 6) * Math.PI * 2 + offset;
    return new THREE.Vector3(Math.cos(a) * radius, y, Math.sin(a) * radius);
  });
  const top = new THREE.Vector3(0, 1.9, 0);
  const upper = ring(0.52, 0.78);
  const waist = ring(0.02, 0.92, Math.PI / 6);
  const lower = ring(-0.52, 0.76);
  const bottom = new THREE.Vector3(0, -1.9, 0);
  let face = 0;
  const triangle = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) => {
    const color = palette[face++ % palette.length];
    for (const v of [a, b, c]) {
      positions.push(v.x, v.y, v.z);
      colors.push(color.r, color.g, color.b);
    }
  };
  for (let i = 0; i < 6; i++) {
    const n = (i + 1) % 6;
    triangle(top, upper[i], upper[n]);
    triangle(upper[i], waist[i], waist[n]);
    triangle(upper[i], waist[n], upper[n]);
    triangle(waist[i], lower[i], lower[n]);
    triangle(waist[i], lower[n], waist[n]);
    triangle(lower[i], bottom, lower[n]);
  }
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
}

interface Source {
  id: ElementId;
  group: THREE.Group;
  anchor: THREE.Vector3;
  end: THREE.Vector3;
  halo: THREE.Sprite;
  light: THREE.PointLight;
  hit: THREE.Mesh;
  animate: (t: number, dt: number, sel: number) => void;
  chain: THREE.InstancedMesh;
  chainMat: THREE.MeshStandardMaterial;
  pulses: THREE.Sprite[];
  pulseT: number[];
  label: THREE.Sprite;
  sel: number;
}

function labelSprite(text: string, color: string) {
  const tex = makeCanvasTexture(256, (ctx, s) => {
    ctx.clearRect(0, 0, s, s);
    ctx.font = "bold 54px Georgia, serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.shadowColor = color;
    ctx.shadowBlur = 24;
    ctx.fillStyle = "#fff";
    ctx.fillText(text, s / 2, s / 2);
    ctx.shadowBlur = 8;
    ctx.fillStyle = color;
    ctx.fillText(text, s / 2, s / 2);
  });
  const m = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
  const sp = new THREE.Sprite(m);
  sp.scale.set(0.5, 0.5, 1);
  return sp;
}

export class LabScene implements SceneModule {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(62, 1, 0.1, 400);
  readonly bloom = { strength: 0.4, radius: 0.5, threshold: 0.96 };
  interactive = false;
  private particles: ParticleSystem;
  private rings = new RingPool();
  private sources: Source[] = [];
  private crystal = new THREE.Group();
  private crystalBody: THREE.Mesh;
  private crystalMat: THREE.MeshStandardMaterial;
  private crystalGlow: THREE.Sprite;
  private crystalLight: THREE.PointLight;
  private hitCrystal: THREE.Mesh;
  private preview = new THREE.Group();
  private previewMeshes: Record<SpellType, THREE.Mesh>;
  private previewMat: THREE.MeshStandardMaterial;
  private runeRings: THREE.Mesh[] = [];
  private shards: THREE.Mesh[] = [];
  private flames: { s: THREE.Sprite; x: number; y: number; z: number; ph: number }[] = [];
  private candles: { g: THREE.Group; y0: number; ph: number; f: THREE.Sprite }[] = [];
  private cfg: LabConfig = { picks: [], temp: 0, type: "ball" };
  private theta = Math.PI / 4;
  private targetTheta = Math.PI / 4;
  private height = 2.9;
  private targetHeight = 2.9;
  private dist = 9.5;
  private pop = 0;
  private shake = 0;
  private flash = 0;
  private colA = new THREE.Color(0xa855f7);
  private colB = new THREE.Color(0x6d28d9);
  private previewColors: [number, number] = [0xa855f7, 0x6d28d9];
  private tmpColA = new THREE.Color();
  private tmpColB = new THREE.Color();
  private ray = new THREE.Raycaster();
  private ndc = new THREE.Vector2();
  private down: { x: number; y: number; t: number; id: number } | null = null;
  private dragging = false;
  private hover: ElementId | "crystal" | null = null;
  private keys = new Set<string>();
  private shiftX = 0;
  private shiftY = 0;
  private curShiftX = 0;
  private curShiftY = 0;
  private time = 0;
  private lookAt = new THREE.Vector3();

  constructor(private engine: Engine, private canvas: HTMLCanvasElement, private cb: LabCallbacks) {
    const low = engine.isMobile;
    this.particles = new ParticleSystem(low ? 1500 : 2800);
    this.scene.add(this.particles.points, this.rings.group);
    this.scene.background = new THREE.Color(0x101820);
    this.scene.fog = new THREE.FogExp2(0x1c2930, 0.016);

    this.buildRoom(low);

    // ---- crystal
    this.crystalMat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, vertexColors: true, emissive: 0x6d28d9, emissiveIntensity: 0.8, transparent: true, opacity: 0.88, depthWrite: false, roughness: 0.14, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.06, flatShading: true, side: THREE.DoubleSide });
    this.crystalBody = new THREE.Mesh(makeCrystalGeometry(), this.crystalMat);
    this.crystalBody.scale.set(1.04, 1.24, 1.04);
    const crystalHeart = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.64, 1),
      new THREE.MeshBasicMaterial({ color: 0xb96aff, transparent: true, opacity: 0.52, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    crystalHeart.scale.y = 1.28;
    crystalHeart.renderOrder = 2;
    const crystalOrbit = new THREE.Mesh(
      new THREE.TorusGeometry(1.16, 0.022, 12, 96),
      new THREE.MeshBasicMaterial({ color: 0xd8a7ff, transparent: true, opacity: 0.78, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    crystalOrbit.rotation.x = Math.PI / 2.6;
    crystalOrbit.scale.set(0.92, 1, 0.92);
    this.crystal.add(this.crystalBody, crystalHeart, crystalOrbit);
    this.previewMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 2.2, roughness: 0.3 });
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.4, 32, 24), this.previewMat);
    const slash = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.06, 14, 64, Math.PI * 1.15), this.previewMat);
    slash.rotation.z = -Math.PI * 0.08;
    const wall = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.7, 0.16), this.previewMat);
    this.previewMeshes = { ball, slash, wall };
    this.preview.add(ball, slash, wall);
    this.crystal.add(this.preview);
    this.crystalGlow = glowSprite(0xa855f7, 9, 0.86);
    this.crystal.add(this.crystalGlow);
    for (let i = 0; i < 2; i++) {
      const r = new THREE.Mesh(
        new THREE.PlaneGeometry(i ? 3.2 : 4.4, i ? 3.2 : 4.4),
        new THREE.MeshBasicMaterial({ map: runeTexture(), color: 0xb7a4ff, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
      );
      r.rotation.x = -Math.PI / 2;
      r.position.y = i ? 0.055 : 0.035;
      this.scene.add(r);
      this.runeRings.push(r);
    }
    for (let i = 0; i < 5; i++) {
      const s = new THREE.Mesh(new THREE.IcosahedronGeometry(0.16, 1), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 1.2, roughness: 0.2, metalness: 0.15 }));
      this.crystal.add(s);
      this.shards.push(s);
    }
    this.crystal.position.copy(CRYSTAL);
    this.scene.add(this.crystal);
    this.crystalLight = new THREE.PointLight(0x9c4dff, 28, 27, 2);
    this.crystalLight.position.copy(CRYSTAL);
    this.scene.add(this.crystalLight);
    this.hitCrystal = new THREE.Mesh(new THREE.SphereGeometry(2, 10, 8), new THREE.MeshBasicMaterial({ visible: false }));
    this.hitCrystal.position.copy(CRYSTAL);
    this.scene.add(this.hitCrystal);

    for (const el of ELEMENT_ORDER) this.sources.push(this.buildSource(el));

    this.scene.add(new THREE.HemisphereLight(0xb6d8e7, 0x18242b, 0.9));
    const key = new THREE.DirectionalLight(0xd7edf5, 2.2);
    key.position.set(-8, 13, 9);
    key.castShadow = !low;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = -20;
    key.shadow.camera.right = 20;
    key.shadow.camera.top = 20;
    key.shadow.camera.bottom = -20;
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 45;
    key.shadow.normalBias = 0.025;
    this.scene.add(key);
    if (!low) {
      this.scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh || (mesh as THREE.InstancedMesh).isInstancedMesh) {
          mesh.castShadow = true;
          mesh.receiveShadow = true;
        }
      });
    }

    canvas.addEventListener("pointerdown", this.onDown);
    canvas.addEventListener("pointermove", this.onMove);
    window.addEventListener("pointerup", this.onUp);
    canvas.addEventListener("wheel", this.onWheel, { passive: true });
    window.addEventListener("keydown", this.onKey);
    window.addEventListener("keyup", this.onKeyUp);
    this.setConfig(this.cfg);
  }

  // ---- construction ----------------------------------------------------------
  private buildRoom(low: boolean) {
    const S = 1024;
    const c = S / 2;
    const base = document.createElement("canvas");
    const emi = document.createElement("canvas");
    base.width = base.height = emi.width = emi.height = S;
    const b = base.getContext("2d")!;
    const e = emi.getContext("2d")!;
    const gr = b.createRadialGradient(c, c, 0, c, c, c);
    gr.addColorStop(0, "#34434a");
    gr.addColorStop(1, "#172129");
    b.fillStyle = gr;
    b.fillRect(0, 0, S, S);
    for (let i = 0; i < 5000; i++) {
      b.fillStyle = `rgba(${Math.random() < 0.5 ? "255,255,255" : "0,0,0"},${Math.random() * 0.06})`;
      b.fillRect(Math.random() * S, Math.random() * S, 3, 3);
    }
    b.strokeStyle = "rgba(0,0,0,0.4)";
    b.lineWidth = 2;
    for (let r = 40; r < c; r += 52) {
      b.beginPath();
      b.arc(c, c, r, 0, Math.PI * 2);
      b.stroke();
    }
    e.fillStyle = "#000";
    e.fillRect(0, 0, S, S);
    const ring = (r: number, w: number, col: string) => {
      e.strokeStyle = col;
      e.lineWidth = w;
      e.beginPath();
      e.arc(c, c, r, 0, Math.PI * 2);
      e.stroke();
    };
    ring(c - 12, 6, "#a855f7");
    ring(c - 30, 2.5, "#e5b8ff");
    ring(c * 0.62, 3, "#c084fc");
    ring(c * 0.3, 3, "#e5d4ff");
    e.lineWidth = 2.5;
      e.strokeStyle = "#c084fc";
    for (const [id, [dx, dz]] of Object.entries(CARDINAL)) {
      const col = ELEMENTS[id as ElementId].css;
      e.strokeStyle = col;
      e.lineWidth = 5;
      const x = c + dx * c * 0.62;
      const y = c + dz * c * 0.62;
      e.beginPath();
      e.arc(x, y, 38, 0, Math.PI * 2);
      e.stroke();
      e.beginPath();
      e.moveTo(c + dx * c * 0.3, c + dz * c * 0.3);
      e.lineTo(x - dx * 38, y - dz * 38);
      e.stroke();
    }
    for (let i = 0; i < 64; i++) {
      const a = (i / 64) * Math.PI * 2;
      e.strokeStyle = "#e9b84f";
      e.lineWidth = 3;
      e.beginPath();
      e.moveTo(c + Math.cos(a) * (c - 30), c + Math.sin(a) * (c - 30));
      e.lineTo(c + Math.cos(a) * (c - (i % 4 === 0 ? 70 : 52)), c + Math.sin(a) * (c - (i % 4 === 0 ? 70 : 52)));
      e.stroke();
    }
    const mk = (cv: HTMLCanvasElement) => {
      const t = new THREE.CanvasTexture(cv);
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 8;
      return t;
    };
    const floor = new THREE.Mesh(new THREE.CircleGeometry(15, 64), new THREE.MeshStandardMaterial({ map: mk(base), emissiveMap: mk(emi), emissive: 0xffffff, emissiveIntensity: 1.3, roughness: 0.7, metalness: 0.2 }));
    floor.rotation.x = -Math.PI / 2;
    this.scene.add(floor);

    // brick wall
    const brick = makeCanvasTexture(256, (ctx, s) => {
      ctx.fillStyle = "#302a35";
      ctx.fillRect(0, 0, s, s);
      ctx.strokeStyle = "rgba(0,0,0,0.5)";
      ctx.lineWidth = 3;
      for (let y = 0; y < s; y += 32) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(s, y);
        ctx.stroke();
        for (let x = (y / 32) % 2 ? 0 : 32; x < s; x += 64) {
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x, y + 32);
          ctx.stroke();
        }
      }
      for (let i = 0; i < 1500; i++) {
        ctx.fillStyle = `rgba(${Math.random() < 0.5 ? "255,255,255" : "0,0,0"},${Math.random() * 0.08})`;
        ctx.fillRect(Math.random() * s, Math.random() * s, 3, 3);
      }
    });
    brick.wrapS = brick.wrapT = THREE.RepeatWrapping;
    brick.repeat.set(10, 2);
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(16, 16, 14, 48, 1, true), new THREE.MeshStandardMaterial({ map: brick, side: THREE.BackSide, roughness: 0.95 }));
    wall.position.y = 7;
    this.scene.add(wall);

    // dome with stars
    const domeTex = makeCanvasTexture(1024, (ctx, s) => {
      const g = ctx.createLinearGradient(0, s, 0, 0);
      g.addColorStop(0, "#1b303a");
      g.addColorStop(1, "#080e13");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, s, s);
      for (let i = 0; i < 700; i++) {
        ctx.fillStyle = `rgba(255,255,255,${0.3 + Math.random() * 0.7})`;
        const r = Math.random() * 1.8;
        ctx.fillRect(Math.random() * s, Math.random() * s, r, r);
      }
    });
    const dome = new THREE.Mesh(new THREE.SphereGeometry(25, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshBasicMaterial({ map: domeTex, side: THREE.BackSide, fog: false }));
    dome.position.y = 13;
    this.scene.add(dome);
    // dome ribs
    const ribMat = new THREE.MeshStandardMaterial({ color: 0x536a77, roughness: 0.4, metalness: 0.55 });
    for (let i = 0; i < 8; i++) {
      const rib = new THREE.Mesh(new THREE.TorusGeometry(24.5, 0.28, 6, 24, Math.PI / 2), ribMat);
      rib.position.y = 13;
      rib.rotation.y = (i / 8) * Math.PI;
      rib.rotation.z = 0;
      rib.rotation.x = 0;
      const pivot = new THREE.Group();
      pivot.rotation.y = (i / 8) * Math.PI;
      rib.rotation.set(0, 0, 0);
      rib.position.set(0, 13, 0);
      pivot.add(rib);
      this.scene.add(pivot);
    }

    // bookshelves
    const shelfMat = new THREE.MeshStandardMaterial({ color: 0x26343c, roughness: 0.62, metalness: 0.24 });
    const nShelf = 12;
    const booksPer = 14;
    const rows = 4;
    const books = new THREE.InstancedMesh(new THREE.BoxGeometry(0.22, 0.9, 0.55), new THREE.MeshStandardMaterial({ roughness: 0.7 }), nShelf * booksPer * rows);
    const dummy = new THREE.Object3D();
    const col = new THREE.Color();
    let bi = 0;
    for (let i = 0; i < nShelf; i++) {
      const a = (i / nShelf) * Math.PI * 2 + Math.PI / nShelf;
      const rx = Math.cos(a);
      const rz = Math.sin(a);
      const shelf = new THREE.Mesh(new THREE.BoxGeometry(4.2, 7, 0.9), shelfMat);
      shelf.position.set(rx * 15.3, 3.5, rz * 15.3);
      shelf.rotation.y = -a + Math.PI / 2;
      this.scene.add(shelf);
      for (let r = 0; r < rows; r++) {
        for (let k = 0; k < booksPer; k++) {
          const u = (k - booksPer / 2 + 0.5) * 0.28;
          const tx = -rz * u;
          const tz = rx * u;
          dummy.position.set(rx * 14.9 + tx, 1.3 + r * 1.55 + 0.45, rz * 14.9 + tz);
          dummy.rotation.set(0, -a + Math.PI / 2, (Math.random() - 0.5) * 0.06);
          dummy.scale.set(0.8 + Math.random() * 0.5, 0.75 + Math.random() * 0.4, 1);
          dummy.updateMatrix();
          books.setMatrixAt(bi, dummy.matrix);
          col.setHSL(0.52 + Math.random() * 0.1, 0.12 + Math.random() * 0.12, 0.2 + Math.random() * 0.12);
          books.setColorAt(bi, col);
          bi++;
        }
      }
    }
    this.scene.add(books);

    // glowing windows between shelves
    const winMat = new THREE.MeshBasicMaterial({ color: 0x56cce8, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    for (let i = 0; i < nShelf; i += 2) {
      const a = (i / nShelf) * Math.PI * 2;
      const w = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 7), winMat);
      w.position.set(Math.cos(a) * 15.8, 7.6, Math.sin(a) * 15.8);
      w.rotation.y = -a + Math.PI / 2;
      this.scene.add(w);
    }

    // hanging lanterns
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.3;
      const x = Math.cos(a) * 11;
      const z = Math.sin(a) * 11;
      const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 5, 4), ribMat);
      chain.position.set(x, 10.5, z);
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.28, 28, 20), new THREE.MeshBasicMaterial({ color: 0xc8f5ff }));
      lamp.position.set(x, 8, z);
      const halo = glowSprite(0xffb870, 3.4, 0.7);
      halo.position.copy(lamp.position);
      this.scene.add(chain, lamp, halo);
      this.flames.push({ s: halo, x, y: 8, z, ph: Math.random() * 6 });
    }

    // floating candles
    const candleMat = new THREE.MeshStandardMaterial({ color: 0xf4ead0, roughness: 0.8, emissive: 0x3a3020 });
    const nC = low ? 10 : 22;
    for (let i = 0; i < nC; i++) {
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.4, 8), candleMat);
      const f = glowSprite(0xffc070, 0.55, 0.95);
      f.position.y = 0.32;
      g.add(body, f);
      const a = Math.random() * Math.PI * 2;
      const d = 9 + Math.random() * 4.5;
      const y0 = 3 + Math.random() * 5;
      g.position.set(Math.cos(a) * d, y0, Math.sin(a) * d);
      this.scene.add(g);
      this.candles.push({ g, y0, ph: Math.random() * 6, f });
    }
  }

  private buildSource(id: ElementId): Source {
    const info = ELEMENTS[id];
    const [dx, dz] = CARDINAL[id];
    // Elemental alcoves turn the circular room into four distinct stations.
    const alcove = new THREE.Group();
    alcove.position.set(dx * 13.75, 0, dz * 13.75);
    alcove.rotation.y = Math.atan2(-dx, -dz);
    const alcoveStone = new THREE.MeshStandardMaterial({ color: 0x514858, roughness: 0.78, metalness: 0.2 });
    const archGold = new THREE.MeshStandardMaterial({ color: 0xc39b65, roughness: 0.34, metalness: 0.68, emissive: info.color, emissiveIntensity: 0.26 });
    const inset = new THREE.Mesh(new THREE.PlaneGeometry(4.9, 6.2), new THREE.MeshBasicMaterial({ color: info.color, transparent: true, opacity: 0.14, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    inset.position.set(0, 3.15, -0.3);
    const outerCurve = new THREE.Mesh(new THREE.TorusGeometry(2.95, 0.15, 8, 56, Math.PI), archGold);
    outerCurve.position.set(0, 3.35, -0.12);
    const archCurve = new THREE.Mesh(new THREE.TorusGeometry(2.5, 0.34, 10, 48, Math.PI), alcoveStone);
    archCurve.position.y = 3.35;
    const innerCurve = new THREE.Mesh(new THREE.TorusGeometry(2.16, 0.055, 8, 48, Math.PI), archGold);
    innerCurve.position.set(0, 3.34, 0.18);
    alcove.add(inset, outerCurve, archCurve, innerCurve);
    for (const side of [-1, 1]) {
      const pier = new THREE.Mesh(new THREE.BoxGeometry(0.62, 3.45, 0.78), alcoveStone);
      pier.position.set(side * 2.5, 1.72, 0);
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.28, 1.05), archGold);
      foot.position.set(side * 2.5, 0.16, 0.05);
      const capital = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.26, 0.98), archGold);
      capital.position.set(side * 2.5, 3.34, 0.04);
      alcove.add(pier, foot, capital);
    }
    this.scene.add(alcove);

    const group = new THREE.Group();
    group.position.set(dx * SRC_R, 0, dz * SRC_R);
    const stone = new THREE.MeshStandardMaterial({ color: 0x3c4e58, roughness: 0.72, metalness: 0.16, flatShading: false });
    const gold = new THREE.MeshStandardMaterial({ color: 0xf0c060, metalness: 0.9, roughness: 0.3, emissive: 0x3a2806 });
    const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 1.15, 1.1, 40), stone);
    ped.position.y = 0.55;
    const ringTop = new THREE.Mesh(new THREE.TorusGeometry(0.88, 0.055, 12, 48), gold);
    ringTop.rotation.x = Math.PI / 2;
    ringTop.position.y = 1.1;
    const ringBase = new THREE.Mesh(new THREE.TorusGeometry(1.35, 0.045, 12, 56), new THREE.MeshBasicMaterial({ color: info.color }));
    ringBase.rotation.x = Math.PI / 2;
    ringBase.position.y = 0.06;
    group.add(ped, ringTop, ringBase);

    const topY = 2.0;
    let animate: Source["animate"] = () => {};
    const px = group.position.x;
    const pz = group.position.z;
    const P = this.particles;
    if (id === "fire") {
      const bowl = new THREE.Mesh(new THREE.ConeGeometry(0.75, 0.55, 12, 1, true), gold);
      bowl.rotation.x = Math.PI;
      bowl.position.y = 1.4;
      bowl.material.side = THREE.DoubleSide;
      const flame = glowSprite(0xff7a2e, 2.6, 0.95);
      flame.position.y = topY;
      const core = glowSprite(0xffe0a0, 1.2, 1);
      core.position.y = topY - 0.1;
      const tongues = [0, 1, 2].map((i) => {
        const material = new THREE.MeshBasicMaterial({ color: i === 1 ? 0xffe4a0 : 0xff6b25, transparent: true, opacity: i === 1 ? 0.48 : 0.3, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
        const mesh = new THREE.Mesh(new THREE.ConeGeometry(i === 1 ? 0.24 : 0.34, i === 1 ? 1.1 : 1.45, 20, 3), material);
        mesh.position.set((i - 1) * 0.24, topY + 0.35, (i - 1) * 0.12);
        return mesh;
      });
      group.add(bowl, flame, core, ...tongues);
      animate = (t, dt, sel) => {
        const f = 1 + Math.sin(t * 12) * 0.08 + Math.sin(t * 27) * 0.05;
        flame.scale.setScalar((2.3 + sel * 0.7) * f);
        core.scale.setScalar(1.1 * f);
        tongues.forEach((mesh, i) => {
          const lick = 0.84 + Math.sin(t * 10 + i * 1.9) * 0.16 + sel * 0.12;
          mesh.scale.set(0.8 + Math.sin(t * 8 + i) * 0.16, lick, 0.8 + Math.cos(t * 9 + i) * 0.12);
          mesh.rotation.y = Math.sin(t * 4 + i * 2) * 0.35;
          mesh.position.x = (i - 1) * 0.24 + Math.sin(t * 7 + i) * 0.08;
        });
        const n = Math.random() < 0.7 + sel * 0.3 ? 1 : 0;
        for (let i = 0; i < n + sel; i++) P.emit(px + (Math.random() - 0.5) * 0.5, topY - 0.3, pz + (Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.4, 1.4 + Math.random() * 1.6, (Math.random() - 0.5) * 0.4, Math.random() < 0.5 ? 0xff6a1f : 0xffc060, 0.45, 0.9, -0.6, 0.4, 0, 1.4);
        void dt;
      };
    } else if (id === "water") {
      const orb = new THREE.Mesh(new THREE.SphereGeometry(0.78, 20, 14), new THREE.MeshStandardMaterial({ color: 0x2e9bff, emissive: 0x1a60c0, emissiveIntensity: 0.9, transparent: true, opacity: 0.6, roughness: 0.05 }));
      orb.position.y = topY + 0.1;
      const inner = new THREE.Mesh(new THREE.SphereGeometry(0.38, 12, 10), new THREE.MeshBasicMaterial({ color: 0x8fd8ff }));
      inner.position.y = topY + 0.1;
      const currents = [0, 1].map((i) => {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.82 + i * 0.17, 0.022, 8, 48), new THREE.MeshBasicMaterial({ color: i ? 0x73caff : 0xd7f5ff, transparent: true, opacity: 0.62, blending: THREE.AdditiveBlending, depthWrite: false }));
        ring.rotation.x = Math.PI / 2;
        ring.position.y = topY + 0.1;
        group.add(ring);
        return ring;
      });
      group.add(orb, inner);
      animate = (t, dt, sel) => {
        const w = 1 + Math.sin(t * 3) * 0.05;
        orb.scale.set(w, 1 / w, w);
        orb.position.y = topY + 0.1 + Math.sin(t * 1.6) * 0.1;
        inner.position.y = orb.position.y;
        currents.forEach((ring, i) => {
          ring.rotation.z = t * (i ? -0.9 : 0.65);
          ring.scale.setScalar(1 + Math.sin(t * 2 + i * 2) * 0.07);
          (ring.material as THREE.MeshBasicMaterial).opacity = 0.42 + sel * 0.25 + Math.sin(t * 3 + i) * 0.12;
        });
        if (Math.random() < 0.3 + sel * 0.4) {
          const a = Math.random() * Math.PI * 2;
          P.emit(px + Math.cos(a) * 0.8, orb.position.y + 0.2, pz + Math.sin(a) * 0.8, Math.cos(a) * 0.5, 1.5, Math.sin(a) * 0.5, 0x7fc8ff, 0.14, 1.1, 7, 0.2, 0, 1.3);
        }
        void dt;
      };
    } else if (id === "wind") {
      const rings: THREE.Mesh[] = [];
      for (let i = 0; i < 3; i++) {
        const r = new THREE.Mesh(new THREE.TorusGeometry(0.45 + i * 0.22, 0.035, 6, 28), new THREE.MeshStandardMaterial({ color: 0xc4f6ff, emissive: 0xaef0ff, emissiveIntensity: 1.5, transparent: true, opacity: 0.85 }));
        r.position.y = topY + 0.1;
        rings.push(r);
        group.add(r);
      }
      animate = (t, dt, sel) => {
        rings.forEach((r, i) => {
          r.rotation.x = t * (1.2 + i * 0.6);
          r.rotation.y = t * (0.8 - i * 0.4);
          r.position.y = topY + 0.1 + Math.sin(t * 2 + i) * 0.08;
        });
        if (Math.random() < 0.6 + sel * 0.4) {
          const a = t * 4 + Math.random() * 6;
          const rr = 0.4 + Math.random() * 0.8;
          P.emit(px + Math.cos(a) * rr, topY - 0.2 + Math.random() * 0.8, pz + Math.sin(a) * rr, -Math.sin(a) * 2.5, 0.8, Math.cos(a) * 2.5, 0xdffaff, 0.12, 0.8, 0, 0.3, 0, 1.3);
        }
        void dt;
      };
    } else {
      const rocks: { m: THREE.Mesh; r: number; ph: number; s: number }[] = [];
      const rockMat = new THREE.MeshStandardMaterial({ color: 0x4c6870, roughness: 0.72, metalness: 0.12, flatShading: false, emissive: 0x173642, emissiveIntensity: 0.35 });
      for (let i = 0; i < 5; i++) {
        const m = new THREE.Mesh(new THREE.DodecahedronGeometry(0.18 + Math.random() * 0.2, 1), rockMat);
        group.add(m);
        rocks.push({ m, r: 0.7 + Math.random() * 0.4, ph: Math.random() * 6, s: 0.6 + Math.random() * 0.8 });
      }
      const crystal = new THREE.Mesh(new THREE.IcosahedronGeometry(0.5, 2), new THREE.MeshPhysicalMaterial({ color: 0x8fd14f, emissive: 0x8fd14f, emissiveIntensity: 1.1, roughness: 0.18, metalness: 0.12, clearcoat: 0.8, flatShading: false, transparent: true, opacity: 0.92 }));
      crystal.scale.y = 1.5;
      crystal.position.y = topY + 0.1;
      group.add(crystal);
      animate = (t, dt, sel) => {
        crystal.rotation.y = t * 0.8;
        crystal.position.y = topY + 0.1 + Math.sin(t * 1.5) * 0.1;
        rocks.forEach((r) => {
          const a = t * r.s + r.ph;
          r.m.position.set(Math.cos(a) * r.r, topY + 0.1 + Math.sin(t * 1.3 + r.ph) * 0.35, Math.sin(a) * r.r);
          r.m.rotation.x += dt;
          r.m.rotation.y += dt * 0.7;
        });
        if (Math.random() < 0.25 + sel * 0.4) P.emit(px + (Math.random() - 0.5) * 1.4, 0.2, pz + (Math.random() - 0.5) * 1.4, 0, 0.8, 0, 0xa8d870, 0.14, 1.2, 0, 0.2, 0, 1.1);
      };
    }

    const anchor = new THREE.Vector3(px, topY + 0.15, pz);
    const dir = new THREE.Vector3(-dx, 0, -dz);
    const end = CRYSTAL.clone().addScaledVector(dir.clone().multiplyScalar(-1), 0.75).add(new THREE.Vector3(0, -0.3, 0));
    end.set(dx * 0.85, CRYSTAL.y - 0.25, dz * 0.85);
    const halo = glowSprite(info.color, 3.6, 0.5);
    halo.position.copy(anchor);
    const light = new THREE.PointLight(info.color, 42, 12, 2);
    light.position.set(px, topY + 0.4, pz);
    const label = labelSprite(info.name.toUpperCase(), info.css);
    label.position.set(px, 4.3, pz);
    const hit = new THREE.Mesh(new THREE.SphereGeometry(1.5, 8, 6), new THREE.MeshBasicMaterial({ visible: false }));
    hit.position.set(px, topY, pz);
    hit.userData.element = id;
    this.scene.add(group, halo, light, label, hit);

    const chainMat = new THREE.MeshStandardMaterial({ color: info.color, metalness: 0.62, roughness: 0.28, emissive: info.color, emissiveIntensity: 0.82 });
    const chain = new THREE.InstancedMesh(new THREE.TorusGeometry(0.13, 0.045, 8, 14), chainMat, LINKS);
    chain.frustumCulled = false;
    this.scene.add(chain);
    const pulses: THREE.Sprite[] = [];
    const pulseT: number[] = [];
    for (let i = 0; i < PULSES; i++) {
      const s = glowSprite(info.color, 0.4, 0.9);
      this.scene.add(s);
      pulses.push(s);
      pulseT.push(i / PULSES);
    }
    return { id, group, anchor, end, halo, light, hit, animate, chain, chainMat, pulses, pulseT, label, sel: 0 };
  }

  // ---- public api ---------------------------------------------------------------
  setConfig(cfg: LabConfig) {
    this.cfg = cfg;
    if (cfg.picks[0]) {
      const def = buildSpell({ a: cfg.picks[0], b: cfg.picks[1] ?? cfg.picks[0], temp: cfg.temp, type: cfg.type });
      this.previewColors = [...def.colors];
    } else {
      this.previewColors = [0xa855f7, 0x6d28d9];
    }
  }

  setViewShift(x: number, y: number) {
    this.shiftX = x;
    this.shiftY = y;
  }

  forgeBurst(colorA: number, colorB: number) {
    this.pop = 1;
    this.shake = 0.5;
    this.flash = 1;
    const P = this.particles;
    P.burst(CRYSTAL.x, CRYSTAL.y, CRYSTAL.z, colorA, 140, 11, 1.4, 0.36, { color2: colorB, drag: 1.2, grav: 1 });
    P.burst(CRYSTAL.x, CRYSTAL.y, CRYSTAL.z, 0xffffff, 40, 6, 0.8, 0.2, { drag: 2 });
    this.rings.spawn(CRYSTAL.x, CRYSTAL.y, CRYSTAL.z, colorA, 0.5, 7, 0.9, true);
    this.rings.spawn(CRYSTAL.x, CRYSTAL.y, CRYSTAL.z, colorB, 0.3, 11, 1.2, true, 0.6);
    this.rings.spawn(CRYSTAL.x, 0.08, CRYSTAL.z, colorA, 0.6, 13, 1.1);
  }

  pickBurst(id: ElementId) {
    const s = this.sources.find((q) => q.id === id);
    if (!s) return;
    this.particles.burst(s.anchor.x, s.anchor.y, s.anchor.z, ELEMENTS[id].color, 36, 5, 0.8, 0.26, { drag: 1.5 });
    this.rings.spawn(s.anchor.x, s.anchor.y, s.anchor.z, ELEMENTS[id].color, 0.3, 3, 0.5, true);
  }

  // ---- input ----------------------------------------------------------------------
  private pick(clientX: number, clientY: number): ElementId | "crystal" | null {
    const r = this.canvas.getBoundingClientRect();
    this.ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.camera);
    const objs: THREE.Object3D[] = [this.hitCrystal, ...this.sources.map((s) => s.hit)];
    const hits = this.ray.intersectObjects(objs, false);
    if (!hits.length) return null;
    const o = hits[0].object;
    if (o === this.hitCrystal) return "crystal";
    return (o.userData.element as ElementId) ?? null;
  }

  private onDown = (e: PointerEvent) => {
    if (!this.interactive) return;
    this.down = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId };
    this.dragging = false;
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };
  private onMove = (e: PointerEvent) => {
    if (!this.interactive) return;
    if (this.down && e.pointerId === this.down.id) {
      const dx = e.clientX - this.down.x;
      const dy = e.clientY - this.down.y;
      if (this.dragging || Math.hypot(dx, dy) > 6) {
        this.dragging = true;
        this.targetTheta -= (e.movementX || 0) * 0.006;
        this.targetHeight = Math.min(5.5, Math.max(1.2, this.targetHeight + (e.movementY || 0) * 0.012));
      }
    } else if (e.pointerType === "mouse") {
      const h = this.pick(e.clientX, e.clientY);
      if (h !== this.hover) {
        this.hover = h;
        this.canvas.style.cursor = h ? "pointer" : "grab";
      }
    }
  };
  private onUp = (e: PointerEvent) => {
    if (!this.down || e.pointerId !== this.down.id) return;
    const d = this.down;
    this.down = null;
    try {
      this.canvas.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    if (!this.interactive) return;
    if (!this.dragging && performance.now() - d.t < 500) {
      const h = this.pick(e.clientX, e.clientY);
      if (h === "crystal") this.cb.onCrystal();
      else if (h) this.cb.onPick(h);
    }
    this.dragging = false;
  };
  private onWheel = (e: WheelEvent) => {
    if (this.interactive) this.cb.onWheel(e.deltaY > 0 ? -1 : 1);
  };
  private onKey = (e: KeyboardEvent) => {
    this.keys.add(e.code);
  };
  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
  };

  // ---- update -----------------------------------------------------------------------
  update(dt: number, t: number) {
    this.time = t;
    const P = this.particles;
    const cfg = this.cfg;
    const heat = cfg.temp / 100;

    // camera orbit
    if (this.interactive) {
      if (this.keys.has("KeyA") || this.keys.has("ArrowLeft")) this.targetTheta += dt * 1.4;
      if (this.keys.has("KeyD") || this.keys.has("ArrowRight")) this.targetTheta -= dt * 1.4;
      if (this.keys.has("KeyW") || this.keys.has("ArrowUp")) this.targetHeight = Math.max(1.2, this.targetHeight - dt * 2);
      if (this.keys.has("KeyS") || this.keys.has("ArrowDown")) this.targetHeight = Math.min(5.5, this.targetHeight + dt * 2);
    } else {
      this.targetTheta += dt * 0.1;
    }
    this.theta += (this.targetTheta - this.theta) * Math.min(1, dt * 6);
    this.height += (this.targetHeight - this.height) * Math.min(1, dt * 5);
    const aspect = this.camera.aspect || 1.6;
    const portrait = aspect < 1;
    const wantDist = portrait ? 10.5 : 9.5;
    this.dist += (wantDist - this.dist) * Math.min(1, dt * 3);
    const fov = portrait ? 68 : 62;
    if (Math.abs(this.camera.fov - fov) > 0.1) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
    this.curShiftX += (this.shiftX - this.curShiftX) * Math.min(1, dt * 4);
    this.curShiftY += (this.shiftY - this.curShiftY) * Math.min(1, dt * 4);
    this.shake = Math.max(0, this.shake - dt * 2);
    const sk = this.shake * this.shake;
    const cx = Math.sin(this.theta) * this.dist;
    const cz = Math.cos(this.theta) * this.dist;
    this.camera.position.set(cx + (Math.random() - 0.5) * sk * 0.4, this.height + Math.sin(t * 0.5) * 0.06 + (Math.random() - 0.5) * sk * 0.4, cz);
    const rightX = Math.cos(this.theta);
    const rightZ = -Math.sin(this.theta);
    this.lookAt.set(CRYSTAL.x + rightX * this.curShiftX, CRYSTAL.y - (portrait ? 1.65 : 0.2) + this.curShiftY, CRYSTAL.z + rightZ * this.curShiftX);
    this.camera.lookAt(this.lookAt);

    // crystal colours from the picked elements
    const picks = cfg.picks;
    const [a, b] = this.previewColors;
    this.tmpColA.setHex(a);
    this.tmpColB.setHex(b);
    this.colA.lerp(this.tmpColA, Math.min(1, dt * 6));
    this.colB.lerp(this.tmpColB, Math.min(1, dt * 6));
    this.pop = Math.max(0, this.pop - dt * 2.2);
    this.flash = Math.max(0, this.flash - dt * 3);
    const popS = 1 + Math.sin(this.pop * Math.PI) * 0.35;
    this.crystal.scale.setScalar(popS);
    this.crystal.position.y = CRYSTAL.y + Math.sin(t * 1.1) * 0.15;
    this.crystal.rotation.y = t * 0.24;
    this.crystal.rotation.z = Math.sin(t * 0.72) * 0.035;
    this.crystalBody.rotation.y += dt * (0.95 + Math.abs(heat) * 1.2 + this.pop * 6);
    this.crystalBody.rotation.x = Math.sin(t * 0.8) * 0.08;
    this.crystalMat.color.copy(this.colB).lerp(new THREE.Color(0xd4a0ff), 0.22);
    this.crystalMat.emissive.copy(this.colB).lerp(new THREE.Color(0x9d4edd), 0.35);
    this.crystalMat.emissiveIntensity = 0.58 + picks.length * 0.26 + this.flash * 1.8;
    (this.crystalGlow.material as THREE.SpriteMaterial).color.copy(this.colA);
    this.crystalGlow.scale.setScalar(4.8 + picks.length * 0.7 + this.flash * 3.2);
    this.crystalLight.color.copy(this.colA);
    this.crystalLight.intensity = 28 + picks.length * 18 + this.flash * 160;
    this.previewMat.color.copy(this.colA);
    this.previewMat.emissive.copy(this.colB).lerp(this.colA, 0.4);
    (Object.keys(this.previewMeshes) as SpellType[]).forEach((k) => {
      const m = this.previewMeshes[k];
      const on = k === cfg.type;
      m.visible = on;
      if (on) {
        m.rotation.y += dt * (k === "wall" ? 0.8 : 2.2);
        if (k === "ball") m.rotation.x += dt * 1.5;
        if (k === "slash") m.rotation.x = Math.sin(t * 2) * 0.35;
        const s = 1 + Math.sin(t * 5) * 0.06;
        m.scale.setScalar(s);
      }
    });
    this.runeRings.forEach((r, i) => {
      r.rotation.z += dt * (i ? -0.9 : 0.5);
      const mm = r.material as THREE.MeshBasicMaterial;
      mm.color.copy(i ? this.colB : this.colA);
      mm.opacity = 0.35 + picks.length * 0.15 + this.flash * 0.4;
    });
    this.shards.forEach((s, i) => {
      const ang = t * (0.8 + heat * 0.8) + (i / this.shards.length) * Math.PI * 2;
      const rr = 1.7 + Math.sin(t + i) * 0.15;
      s.position.set(Math.cos(ang) * rr, Math.sin(t * 1.3 + i) * 0.6, Math.sin(ang) * rr);
      s.rotation.x += dt * 2;
      s.rotation.y += dt * 3;
      const m = s.material as THREE.MeshStandardMaterial;
      m.emissive.copy(i % 2 ? this.colA : this.colB);
      m.color.copy(m.emissive);
    });

    // temperature particles around the crystal
    const cy = this.crystal.position.y;
    if (Math.random() < 0.55) {
      const ang = Math.random() * Math.PI * 2;
      const rr = 0.9 + Math.random() * 1.6;
      const px = Math.cos(ang) * rr;
      const pz = Math.sin(ang) * rr;
      if (heat > 0.1) P.emit(px, cy - 1 + Math.random() * 0.5, pz, 0, 1 + heat * 3 + Math.random(), 0, Math.random() < 0.5 ? 0xff7a2a : 0xffc070, 0.2, 1.3, -0.3, 0.3, 0, 1.4);
      else if (heat < -0.1) P.emit(px, cy + 1.6, pz, (Math.random() - 0.5) * 0.4, -0.5 - -heat * 1.5, (Math.random() - 0.5) * 0.4, 0xcdf3ff, 0.16, 1.8, 0, 0.2, 0, 1.4);
      else P.emit(px, cy + (Math.random() - 0.5) * 2, pz, -pz * 0.5, 0.2, px * 0.5, this.colA.getHex(), 0.12, 1.5, 0, 0.2, 0, 1.3);
    }
    for (const f of this.flames) {
      const fl = 0.9 + Math.sin(t * 9 + f.ph) * 0.1;
      f.s.scale.setScalar(3.4 * fl);
    }
    for (const c of this.candles) {
      c.g.position.y = c.y0 + Math.sin(t * 0.7 + c.ph) * 0.25;
      c.f.scale.setScalar(0.5 + Math.sin(t * 13 + c.ph) * 0.07);
    }

    // sources + chains
    const dummy = new THREE.Object3D();
    const p0 = new THREE.Vector3();
    const p1 = new THREE.Vector3();
    const tmp = new THREE.Vector3();
    const crystalEnd = new THREE.Vector3();
    for (const s of this.sources) {
      const count = picks.filter((x) => x === s.id).length;
      s.sel += (count - s.sel) * Math.min(1, dt * 6);
      s.animate(t, dt, Math.min(1, s.sel));
      const hov = this.hover === s.id ? 0.4 : 0;
      (s.halo.material as THREE.SpriteMaterial).opacity = 0.35 + s.sel * 0.4 + hov;
      s.halo.scale.setScalar(3.4 + s.sel * 1.6 + Math.sin(t * 3) * 0.2 + hov);
      s.light.intensity = 30 + s.sel * 90 + hov * 40;
      s.chainMat.emissiveIntensity = 0.82 + s.sel * 1.8;
      s.label.scale.setScalar(0.9 * (1 + s.sel * 0.12 + hov * 0.2));
      // chain curve (catenary-like sag with sway)
      crystalEnd.set(s.end.x, s.end.y + (this.crystal.position.y - CRYSTAL.y), s.end.z);
      const sag = 0.28 + Math.sin(t * 1.2 + s.anchor.x) * 0.05;
      const pt = (u: number, out: THREE.Vector3) => {
        out.lerpVectors(s.anchor, crystalEnd, u);
        out.y -= Math.sin(Math.PI * u) * sag;
        out.x += Math.sin(t * 1.5 + u * 5 + s.anchor.z) * 0.05 * Math.sin(Math.PI * u);
        return out;
      };
      for (let i = 0; i < LINKS; i++) {
        const u = (i + 0.5) / LINKS;
        pt(u, p0);
        pt(Math.min(1, u + 0.02), p1);
        dummy.position.copy(p0);
        dummy.lookAt(tmp.copy(p0).add(p1.clone().sub(p0)));
        dummy.rotateY(Math.PI / 2);
        if (i % 2) dummy.rotateX(Math.PI / 2);
        dummy.scale.set(1.35, 1, 1);
        dummy.updateMatrix();
        s.chain.setMatrixAt(i, dummy.matrix);
      }
      s.chain.instanceMatrix.needsUpdate = true;
      for (let i = 0; i < PULSES; i++) {
        s.pulseT[i] = (s.pulseT[i] + dt * (0.18 + s.sel * 0.55)) % 1;
        pt(s.pulseT[i], p0);
        s.pulses[i].position.copy(p0);
        s.pulses[i].scale.setScalar((0.24 + s.sel * 0.54) * (0.7 + Math.sin(s.pulseT[i] * Math.PI) * 0.6));
        (s.pulses[i].material as THREE.SpriteMaterial).opacity = 0.52 + s.sel * 0.45;
      }
      if (s.sel > 0.3 && Math.random() < 0.5 * s.sel) {
        const u = Math.random();
        pt(u, p0);
        P.emit(p0.x, p0.y, p0.z, (Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.5, ELEMENTS[s.id].color, 0.12, 0.6, 0, 1, 0, 1.5);
      }
    }

    P.setScale(this.engine.drawHeight, this.camera.fov);
    P.update(dt);
    this.rings.update(dt, this.camera);
  }

  dispose() {
    this.canvas.removeEventListener("pointerdown", this.onDown);
    this.canvas.removeEventListener("pointermove", this.onMove);
    window.removeEventListener("pointerup", this.onUp);
    this.canvas.removeEventListener("wheel", this.onWheel);
    window.removeEventListener("keydown", this.onKey);
    window.removeEventListener("keyup", this.onKeyUp);
    this.particles.dispose();
    this.rings.dispose();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as THREE.Material | undefined;
      if (mat) mat.dispose();
    });
  }
}
