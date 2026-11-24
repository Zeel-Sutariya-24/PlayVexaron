// Shared visual-effect helpers: procedural textures, GPU particle system, ring/shockwave pool.
import * as THREE from "three";

export function makeCanvasTexture(size: number, draw: (ctx: CanvasRenderingContext2D, size: number) => void): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d")!;
  draw(ctx, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

let glowTex: THREE.CanvasTexture | null = null;
export function glowTexture(): THREE.CanvasTexture {
  if (!glowTex) {
    glowTex = makeCanvasTexture(128, (ctx, s) => {
      const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      g.addColorStop(0, "rgba(255,255,255,1)");
      g.addColorStop(0.25, "rgba(255,255,255,0.65)");
      g.addColorStop(0.55, "rgba(255,255,255,0.18)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, s, s);
    });
  }
  return glowTex;
}

let ringTex: THREE.CanvasTexture | null = null;
export function ringTexture(): THREE.CanvasTexture {
  if (!ringTex) {
    ringTex = makeCanvasTexture(256, (ctx, s) => {
      const g = ctx.createRadialGradient(s / 2, s / 2, s * 0.3, s / 2, s / 2, s / 2);
      g.addColorStop(0, "rgba(255,255,255,0)");
      g.addColorStop(0.7, "rgba(255,255,255,0.9)");
      g.addColorStop(0.82, "rgba(255,255,255,0.55)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, s, s);
    });
  }
  return ringTex;
}

export function glowSprite(color: number, scale: number, opacity = 1): THREE.Sprite {
  const m = new THREE.SpriteMaterial({
    map: glowTexture(),
    color,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const s = new THREE.Sprite(m);
  s.scale.setScalar(scale);
  return s;
}

export function randRange(a: number, b: number): number {
  return a + Math.random() * (b - a);
}

const tmpColor = new THREE.Color();

export interface BurstOpts {
  grav?: number;
  drag?: number;
  color2?: number;
  endSize?: number;
  up?: number;
  hdr?: number;
  spreadY?: number;
}

export class ParticleSystem {
  readonly points: THREE.Points;
  private max: number;
  private cursor = 0;
  private pos: Float32Array;
  private col: Float32Array;
  private size: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private s0: Float32Array;
  private s1: Float32Array;
  private grav: Float32Array;
  private drag: Float32Array;
  private base: Float32Array;
  private geo: THREE.BufferGeometry;
  private mat: THREE.ShaderMaterial;
  private pAttr: THREE.BufferAttribute;
  private cAttr: THREE.BufferAttribute;
  private sAttr: THREE.BufferAttribute;

  constructor(max = 3000) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 4);
    this.size = new Float32Array(max);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.s0 = new Float32Array(max);
    this.s1 = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.base = new Float32Array(max * 4);
    for (let i = 0; i < max; i++) this.pos[i * 3 + 1] = -999;
    this.geo = new THREE.BufferGeometry();
    this.pAttr = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.cAttr = new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage);
    this.sAttr = new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute("position", this.pAttr);
    this.geo.setAttribute("aColor", this.cAttr);
    this.geo.setAttribute("aSize", this.sAttr);
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 500 }, uMap: { value: glowTexture() } },
      vertexShader: `
        attribute float aSize; attribute vec4 aColor; varying vec4 vColor; uniform float uScale;
        void main(){
          vColor = aColor;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = min(aSize * uScale / max(0.2, -mv.z), 320.0);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform sampler2D uMap; varying vec4 vColor;
        void main(){
          float a = texture2D(uMap, gl_PointCoord).a * vColor.a;
          if (a < 0.003) discard;
          gl_FragColor = vec4(vColor.rgb, a);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
  }

  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, color: number, size: number, life: number, grav = 0, drag = 0, endSize = 0, hdr = 1) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    tmpColor.setHex(color);
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx;
    this.vel[i * 3 + 1] = vy;
    this.vel[i * 3 + 2] = vz;
    this.base[i * 4] = tmpColor.r * hdr;
    this.base[i * 4 + 1] = tmpColor.g * hdr;
    this.base[i * 4 + 2] = tmpColor.b * hdr;
    this.base[i * 4 + 3] = 1;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.s0[i] = size;
    this.s1[i] = endSize;
    this.grav[i] = grav;
    this.drag[i] = drag;
  }

  /** Spherical burst of particles. */
  burst(x: number, y: number, z: number, color: number, count: number, speed: number, life: number, size: number, o: BurstOpts = {}) {
    for (let i = 0; i < count; i++) {
      const u = Math.random() * 2 - 1;
      const th = Math.random() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      const sp = speed * (0.35 + Math.random() * 0.65);
      const c = o.color2 !== undefined && Math.random() < 0.5 ? o.color2 : color;
      this.emit(
        x,
        y,
        z,
        s * Math.cos(th) * sp,
        (u * (o.spreadY ?? 1)) * sp + (o.up ?? 0),
        s * Math.sin(th) * sp,
        c,
        size * (0.6 + Math.random() * 0.8),
        life * (0.6 + Math.random() * 0.6),
        o.grav ?? 0,
        o.drag ?? 1.5,
        o.endSize ?? 0,
        o.hdr ?? 1.4,
      );
    }
  }

  setScale(viewHeightPx: number, fovDeg: number) {
    this.mat.uniforms.uScale.value = viewHeightPx / (2 * Math.tan((fovDeg * Math.PI) / 360));
  }

  update(dt: number) {
    const { pos, vel, life, maxLife, s0, s1, size, col, base, grav, drag } = this;
    for (let i = 0; i < this.max; i++) {
      const l = life[i];
      if (l <= 0) continue;
      const nl = l - dt;
      life[i] = nl;
      if (nl <= 0) {
        size[i] = 0;
        col[i * 4 + 3] = 0;
        pos[i * 3 + 1] = -999;
        continue;
      }
      const k = 1 - nl / maxLife[i];
      const dr = Math.max(0, 1 - drag[i] * dt);
      vel[i * 3] *= dr;
      vel[i * 3 + 1] = vel[i * 3 + 1] * dr - grav[i] * dt;
      vel[i * 3 + 2] *= dr;
      pos[i * 3] += vel[i * 3] * dt;
      pos[i * 3 + 1] += vel[i * 3 + 1] * dt;
      pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
      size[i] = s0[i] + (s1[i] - s0[i]) * k;
      const fade = k < 0.12 ? k / 0.12 : 1 - (k - 0.12) / 0.88;
      col[i * 4] = base[i * 4];
      col[i * 4 + 1] = base[i * 4 + 1];
      col[i * 4 + 2] = base[i * 4 + 2];
      col[i * 4 + 3] = Math.max(0, fade) * base[i * 4 + 3];
    }
    this.pAttr.needsUpdate = true;
    this.cAttr.needsUpdate = true;
    this.sAttr.needsUpdate = true;
  }

  dispose() {
    this.geo.dispose();
    this.mat.dispose();
  }
}

interface RingItem {
  mesh: THREE.Mesh;
  age: number;
  life: number;
  r0: number;
  r1: number;
  billboard: boolean;
  opacity: number;
}

/** Pool of expanding ring shockwaves (ground or billboard). */
export class RingPool {
  readonly group = new THREE.Group();
  private items: RingItem[] = [];
  private free: THREE.Mesh[] = [];
  private geo = new THREE.PlaneGeometry(2, 2);

  spawn(x: number, y: number, z: number, color: number, r0: number, r1: number, life: number, billboard = false, opacity = 0.9) {
    let mesh = this.free.pop();
    if (!mesh) {
      const mat = new THREE.MeshBasicMaterial({
        map: ringTexture(),
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      mesh = new THREE.Mesh(this.geo, mat);
      mesh.renderOrder = 9;
    }
    (mesh.material as THREE.MeshBasicMaterial).color.setHex(color);
    mesh.position.set(x, y, z);
    mesh.rotation.set(billboard ? 0 : -Math.PI / 2, 0, 0);
    mesh.scale.setScalar(r0);
    this.group.add(mesh);
    this.items.push({ mesh, age: 0, life, r0, r1, billboard, opacity });
  }

  update(dt: number, camera: THREE.Camera) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.age += dt;
      const k = it.age / it.life;
      if (k >= 1) {
        this.group.remove(it.mesh);
        this.free.push(it.mesh);
        this.items.splice(i, 1);
        continue;
      }
      const e = 1 - Math.pow(1 - k, 3);
      it.mesh.scale.setScalar(it.r0 + (it.r1 - it.r0) * e);
      (it.mesh.material as THREE.MeshBasicMaterial).opacity = it.opacity * (1 - k) * (1 - k * 0.3);
      if (it.billboard) it.mesh.quaternion.copy(camera.quaternion);
    }
  }

  dispose() {
    for (const it of this.items) (it.mesh.material as THREE.Material).dispose();
    for (const m of this.free) (m.material as THREE.Material).dispose();
    this.geo.dispose();
  }
}
