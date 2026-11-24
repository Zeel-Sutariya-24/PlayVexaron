// The duel arena: a clean, readable combat space with elemental landmarks.
import * as THREE from "three";
import { ELEMENTS } from "./elements";
import { glowSprite, makeCanvasTexture, type ParticleSystem } from "./fx";
import { ARENA_R, OBSTACLES } from "./sim";

const R = ARENA_R + 2;

function drawGlyph(ctx: CanvasRenderingContext2D, kind: string, x: number, y: number, s: number) {
  ctx.beginPath();
  const up = kind === "fire" || kind === "wind";
  const d = up ? -1 : 1;
  ctx.moveTo(x, y + d * s);
  ctx.lineTo(x - s * 0.9, y - d * s * 0.6);
  ctx.lineTo(x + s * 0.9, y - d * s * 0.6);
  ctx.closePath();
  ctx.stroke();
  if (kind === "wind" || kind === "earth") {
    ctx.beginPath();
    ctx.moveTo(x - s * 0.55, y + d * -s * 0.05 * 0 + (up ? s * 0.18 : -s * 0.18));
    ctx.lineTo(x + s * 0.55, y + (up ? s * 0.18 : -s * 0.18));
    ctx.stroke();
  }
}

function floorTextures() {
  const S = 1024;
  const c = S / 2;
  const k = c / R;
  const cvBase = document.createElement("canvas");
  const cvEmi = document.createElement("canvas");
  cvBase.width = cvBase.height = cvEmi.width = cvEmi.height = S;
  const b = cvBase.getContext("2d")!;
  const e = cvEmi.getContext("2d")!;
  const g = b.createRadialGradient(c, c, 0, c, c, c);
  g.addColorStop(0, "#34404a");
  g.addColorStop(0.7, "#202a33");
  g.addColorStop(1, "#111820");
  b.fillStyle = g;
  b.fillRect(0, 0, S, S);
  e.fillStyle = "#000";
  e.fillRect(0, 0, S, S);
  // slab seams
  b.strokeStyle = "rgba(0,0,0,0.45)";
  b.lineWidth = 2;
  for (let r = 2; r < R; r += 2.6) {
    b.beginPath();
    b.arc(c, c, r * k, 0, Math.PI * 2);
    b.stroke();
  }
  for (let i = 0; i < 70; i++) {
    const a = Math.random() * Math.PI * 2;
    const r0 = Math.floor(Math.random() * 9) * 2.6 + 2;
    b.beginPath();
    b.moveTo(c + Math.cos(a) * r0 * k, c + Math.sin(a) * r0 * k);
    b.lineTo(c + Math.cos(a) * (r0 + 2.6) * k, c + Math.sin(a) * (r0 + 2.6) * k);
    b.stroke();
  }
  for (let i = 0; i < 6000; i++) {
    b.fillStyle = `rgba(${Math.random() < 0.5 ? "255,255,255" : "0,0,0"},${Math.random() * 0.06})`;
    b.fillRect(Math.random() * S, Math.random() * S, 2 + Math.random() * 3, 2 + Math.random() * 3);
  }
  // glowing rune rings
  const ring = (r: number, w: number, col: string) => {
    for (const ctx of [e, b]) {
      ctx.strokeStyle = col;
      ctx.lineWidth = w;
      ctx.globalAlpha = ctx === b ? 0.35 : 1;
      ctx.beginPath();
      ctx.arc(c, c, r * k, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  };
  ring(ARENA_R - 0.2, 5, "#ff4655");
  ring(ARENA_R - 1.3, 2, "#ff4655");
  ring(17, 2.5, "#58d8ff");
  ring(6, 3, "#58d8ff");
  ring(5.2, 1.5, "#d8f6ff");
  e.strokeStyle = "#ff4655";
  e.lineWidth = 3;
  for (let i = 0; i < 72; i++) {
    const a = (i / 72) * Math.PI * 2;
    const r1 = (ARENA_R - 1.3) * k;
    const r2 = (ARENA_R - (i % 3 === 0 ? 2.8 : 2.1)) * k;
    e.beginPath();
    e.moveTo(c + Math.cos(a) * r1, c + Math.sin(a) * r1);
    e.lineTo(c + Math.cos(a) * r2, c + Math.sin(a) * r2);
    e.stroke();
  }
  // star polygon in the centre
  e.strokeStyle = "#d8f6ff";
  e.lineWidth = 2.5;
  e.beginPath();
  for (let i = 0; i <= 8; i++) {
    const a = ((i * 3) % 8 / 8) * Math.PI * 2 - Math.PI / 2;
    const x = c + Math.cos(a) * 6 * k;
    const y = c + Math.sin(a) * 6 * k;
    if (i === 0) e.moveTo(x, y);
    else e.lineTo(x, y);
  }
  e.stroke();
  // elemental sigils: fire north(-z), water east(+x), wind south(+z), earth west(-x)
  const sig: [string, number, number][] = [
    ["fire", 0, -1],
    ["water", 1, 0],
    ["wind", 0, 1],
    ["earth", -1, 0],
  ];
  for (const [id, dx, dz] of sig) {
    const col = ELEMENTS[id as keyof typeof ELEMENTS].css;
    const x = c + dx * 12 * k;
    const y = c + dz * 12 * k;
    e.strokeStyle = col;
    e.lineWidth = 7;
    drawGlyph(e, id, x, y, 2.4 * k);
    e.beginPath();
    e.arc(x, y, 3.6 * k, 0, Math.PI * 2);
    e.lineWidth = 3;
    e.stroke();
    b.strokeStyle = col;
    b.globalAlpha = 0.3;
    b.lineWidth = 7;
    drawGlyph(b, id, x, y, 2.4 * k);
    b.globalAlpha = 1;
  }
  const mk = (cv: HTMLCanvasElement) => {
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  };
  return { map: mk(cvBase), emissive: mk(cvEmi) };
}

export interface Arena {
  update(dt: number, t: number, focus: THREE.Vector3): void;
  dispose(): void;
}

export function buildArena(scene: THREE.Scene, particles: ParticleSystem, low: boolean): Arena {
  const root = new THREE.Group();
  scene.add(root);
  scene.background = new THREE.Color(0x101820);
  scene.fog = new THREE.FogExp2(0x202b34, 0.0085);

  // ---- lights
  const hemi = new THREE.HemisphereLight(0xb7d4e5, 0x17212a, 1.05);
  const moon = new THREE.DirectionalLight(0xc8deeb, 1.7);
  moon.position.set(-30, 50, -40);
  moon.castShadow = !low;
  moon.shadow.mapSize.set(1024, 1024);
  moon.shadow.camera.left = -64;
  moon.shadow.camera.right = 64;
  moon.shadow.camera.top = 64;
  moon.shadow.camera.bottom = -64;
  moon.shadow.camera.near = 1;
  moon.shadow.camera.far = 150;
  moon.shadow.normalBias = 0.035;
  moon.shadow.radius = 4;
  const centre = new THREE.PointLight(0x58d8ff, 100, 70, 2);
  centre.position.set(0, 13, 0);
  const azure = new THREE.PointLight(0x3ca9ff, low ? 90 : 150, 52, 2);
  azure.position.set(-18, 7, 16);
  const amber = new THREE.PointLight(0xffa34a, low ? 70 : 125, 42, 2);
  amber.position.set(16, 5, -18);
  root.add(hemi, moon, centre, azure, amber);

  // ---- sky dome
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: { uTime: { value: 0 } },
    vertexShader: `varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `
      varying vec3 vDir; uniform float uTime;
      void main(){
        vec3 d = normalize(vDir); float h = d.y;
        vec3 top = vec3(0.025,0.04,0.065);
        vec3 mid = vec3(0.09,0.15,0.19);
        vec3 hor = vec3(0.34,0.19,0.22);
        vec3 low = vec3(0.035,0.075,0.11);
        vec3 c = mix(hor, mid, smoothstep(0.0, 0.32, h));
        c = mix(c, top, smoothstep(0.28, 0.85, h));
        c = mix(c, low, smoothstep(0.0, -0.35, h));
        float band = pow(max(0.0, 1.0 - abs(h - 0.22) * 3.5), 2.0);
        float wob = sin(d.x * 7.0 + uTime * 0.25) * 0.5 + 0.5;
        c += vec3(0.12, 0.48, 0.58) * band * 0.12 * wob;
        c += vec3(0.55, 0.12, 0.17) * pow(max(0.0, 1.0 - abs(h - 0.05) * 6.0), 3.0) * 0.12;
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(700, 32, 16), skyMat);
  sky.renderOrder = -10;
  sky.frustumCulled = false;
  root.add(sky);

  const starCount = low ? 450 : 1000;
  const sp = new Float32Array(starCount * 3);
  const sc = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount; i++) {
    const u = Math.random() * 0.95 + 0.05;
    const th = Math.random() * Math.PI * 2;
    const s = Math.sqrt(1 - u * u);
    sp.set([Math.cos(th) * s * 600, u * 600, Math.sin(th) * s * 600], i * 3);
    const w = 0.6 + Math.random() * 0.4;
    sc.set([w, w, 0.8 + Math.random() * 0.2], i * 3);
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute("position", new THREE.BufferAttribute(sp, 3));
  starGeo.setAttribute("color", new THREE.BufferAttribute(sc, 3));
  const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ size: 2.2, sizeAttenuation: false, vertexColors: true, transparent: true, depthWrite: false, fog: false }));
  stars.frustumCulled = false;
  root.add(stars);

  const moonHalo = glowSprite(0x7a8cff, 280, 0.35);
  const moonCore = glowSprite(0xeef2ff, 75, 1);
  for (const s of [moonHalo, moonCore]) {
    (s.material as THREE.SpriteMaterial).fog = false;
    s.position.set(-260, 250, -380);
    root.add(s);
  }

  // ---- floor + island
  const ft = floorTextures();
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(R, 72),
    new THREE.MeshStandardMaterial({ map: ft.map, emissiveMap: ft.emissive, emissive: 0xffffff, emissiveIntensity: 0.48, roughness: 0.82, metalness: 0.12 }),
  );
  floor.rotation.x = -Math.PI / 2;
  root.add(floor);

  // Thin animated rune circles make the arena read clearly from either spawn point.
  const runeRings: THREE.Mesh[] = [];
  for (const [index, radius, color] of [[0, 17.8, 0xff4655], [1, 22.4, 0x50d9ff]] as const) {
    const mat = new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: index === 0 ? 1.2 : 0.8,
      roughness: 0.32,
      metalness: 0.45,
      transparent: true,
      opacity: index === 0 ? 0.62 : 0.42,
      depthWrite: false,
    });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, index === 0 ? 0.055 : 0.04, 6, 144), mat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.055 + index * 0.015;
    root.add(ring);
    runeRings.push(ring);
  }

  const islandGeo = new THREE.CylinderGeometry(R, 7, 18, low ? 32 : 64, 12, true);
  const ip = islandGeo.attributes.position;
  for (let i = 0; i < ip.count; i++) {
    const x = ip.getX(i);
    const y = ip.getY(i);
    const z = ip.getZ(i);
    if (y > 8.9) continue;
    const n = Math.sin(x * 0.55 + y * 0.3) * Math.cos(z * 0.6 - y * 0.2) * 1.3 + Math.sin(y * 1.1 + x * 0.2) * 0.6;
    const len = Math.hypot(x, z) || 1;
    ip.setX(i, x + (x / len) * n);
    ip.setZ(i, z + (z / len) * n);
    ip.setY(i, y + Math.sin(x * 0.9 + z * 0.7) * 0.5);
  }
  islandGeo.computeVertexNormals();
  const island = new THREE.Mesh(islandGeo, new THREE.MeshStandardMaterial({ color: 0x202c34, roughness: 0.92, flatShading: false }));
  island.position.y = -9.05;
  root.add(island);
  // hanging crystals under the island
  const crystalGeo = new THREE.ConeGeometry(0.9, 5, 32, 8);
  const crystalMat = new THREE.MeshStandardMaterial({ color: 0x59c7dc, emissive: 0x177f99, emissiveIntensity: 0.9, roughness: 0.24, metalness: 0.22, flatShading: false });
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + Math.random();
    const m = new THREE.Mesh(crystalGeo, crystalMat);
    m.position.set(Math.cos(a) * (6 + Math.random() * 10), -19 - Math.random() * 3, Math.sin(a) * (6 + Math.random() * 10));
    m.rotation.x = Math.PI;
    m.scale.setScalar(0.6 + Math.random() * 0.8);
    root.add(m);
  }

  // ---- stone rim
  const rimMat = new THREE.MeshStandardMaterial({ color: 0x34434d, roughness: 0.78, metalness: 0.12, flatShading: false });
  const rimCount = low ? 40 : 72;
  const rim = new THREE.InstancedMesh(new THREE.BoxGeometry(2.2, 1, 0.9), rimMat, rimCount);
  const dummy = new THREE.Object3D();
  for (let i = 0; i < rimCount; i++) {
    const a = (i / rimCount) * Math.PI * 2;
    const h = 0.6 + Math.random() * 0.9;
    dummy.position.set(Math.cos(a) * (ARENA_R + 0.9), h / 2, Math.sin(a) * (ARENA_R + 0.9));
    dummy.rotation.set(0, -a + Math.PI / 2, 0);
    dummy.scale.set(2.1 * (28 / rimCount) * 0.5 + 0.4, h, 1);
    dummy.updateMatrix();
    rim.setMatrixAt(i, dummy.matrix);
  }
  root.add(rim);

  // ---- outer colonnade
  const colMat = new THREE.MeshStandardMaterial({ color: 0x3b4c57, roughness: 0.75, metalness: 0.16, flatShading: false });
  const gold = new THREE.MeshStandardMaterial({ color: 0xf0c060, metalness: 0.9, roughness: 0.35, emissive: 0x4a3208, emissiveIntensity: 1 });
  const colN = 12;
  const shaft = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.9, 1.15, 1, 32), colMat, colN);
  const cap = new THREE.InstancedMesh(new THREE.BoxGeometry(2.8, 0.7, 2.8), colMat, colN);
  const flames: { sprite: THREE.Sprite; x: number; y: number; z: number; ph: number }[] = [];
  for (let i = 0; i < colN; i++) {
    const a = (i / colN) * Math.PI * 2 + Math.PI / colN;
    const h = i % 3 === 0 ? 7 + Math.random() * 2 : 11 + Math.random() * 3;
    const x = Math.cos(a) * (ARENA_R + 4.2);
    const z = Math.sin(a) * (ARENA_R + 4.2);
    dummy.position.set(x, h / 2 - 1, z);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1, h, 1);
    dummy.updateMatrix();
    shaft.setMatrixAt(i, dummy.matrix);
    dummy.position.set(x, h - 0.65, z);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    cap.setMatrixAt(i, dummy.matrix);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.07, 6, 18), gold);
    ring.rotation.x = Math.PI / 2;
    ring.position.set(x, 3, z);
    root.add(ring);
    const f = glowSprite(i % 2 ? 0x7a5cff : 0xff8a3a, 3.2, 0.9);
    f.position.set(x, h + 0.3, z);
    root.add(f);
    flames.push({ sprite: f, x, y: h + 0.2, z, ph: Math.random() * 6 });
  }
  root.add(shaft, cap);

  // ---- torch stands inside the rim
  const standMat = new THREE.MeshStandardMaterial({ color: 0x2a2238, roughness: 0.6, metalness: 0.4 });
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    const x = Math.cos(a) * (ARENA_R - 1.4);
    const z = Math.sin(a) * (ARENA_R - 1.4);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.14, 2.2, 8), standMat);
    pole.position.set(x, 1.1, z);
    const bowl = new THREE.Mesh(new THREE.ConeGeometry(0.4, 0.4, 10, 1, true), gold);
    bowl.rotation.x = Math.PI;
    bowl.position.set(x, 2.3, z);
    root.add(pole, bowl);
    const f = glowSprite(0xff9a45, 1.9, 0.95);
    f.position.set(x, 2.7, z);
    root.add(f);
    flames.push({ sprite: f, x, y: 2.6, z, ph: Math.random() * 6 });
  }

  // ---- elemental colossus crystals
  const colossi: { m: THREE.Mesh; halo: THREE.Sprite; y0: number; ph: number }[] = [];
  const cardinals: [keyof typeof ELEMENTS, number, number][] = [
    ["fire", 0, -1],
    ["water", 1, 0],
    ["wind", 0, 1],
    ["earth", -1, 0],
  ];
  for (const [id, dx, dz] of cardinals) {
    const col = ELEMENTS[id].color;
    const m = new THREE.Mesh(
      new THREE.IcosahedronGeometry(1, 2),
      new THREE.MeshPhysicalMaterial({ color: col, emissive: col, emissiveIntensity: 0.85, roughness: 0.18, metalness: 0.12, transmission: 0.12, transparent: true, opacity: 0.88, flatShading: false, clearcoat: 0.8, clearcoatRoughness: 0.14 }),
    );
    m.scale.set(4, 9, 4);
    m.position.set(dx * 52, 14, dz * 52);
    const halo = glowSprite(col, 46, 0.55);
    halo.position.copy(m.position);
    root.add(m, halo);
    colossi.push({ m, halo, y0: 14, ph: Math.random() * 6 });
  }

  // ---- floating rocks in the sky
  const rocks: { m: THREE.Mesh; ph: number; y0: number; spin: number }[] = [];
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x27333d, roughness: 0.94, flatShading: false });
  const rockN = low ? 6 : 12;
  for (let i = 0; i < rockN; i++) {
    const a = Math.random() * Math.PI * 2;
    const d = 70 + Math.random() * 120;
    const s = 3 + Math.random() * 9;
    const m = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 1), rockMat);
    m.scale.y = 0.6;
    m.position.set(Math.cos(a) * d, -10 + Math.random() * 60, Math.sin(a) * d);
    root.add(m);
    rocks.push({ m, ph: Math.random() * 6, y0: m.position.y, spin: (Math.random() - 0.5) * 0.1 });
  }

  // ---- obstacles (must mirror the simulation's cylinders)
  const obsMat = new THREE.MeshStandardMaterial({ color: 0x66737b, roughness: 0.72, metalness: 0.12, flatShading: false });
  const runeMat = new THREE.MeshStandardMaterial({ color: 0x58d8ff, emissive: 0x34b7d4, emissiveIntensity: 1.5 });
  const shardMat = new THREE.MeshPhysicalMaterial({ color: 0xa8e8f2, emissive: 0x3199b2, emissiveIntensity: 1.05, roughness: 0.2, metalness: 0.16, clearcoat: 0.8, flatShading: false, transparent: true, opacity: 0.9 });
  for (const o of OBSTACLES) {
    if (o.h > 3) {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(o.r * 0.85, o.r * 1.15, o.h, 32), obsMat);
      p.position.set(o.x, o.h / 2, o.z);
      const r1 = new THREE.Mesh(new THREE.TorusGeometry(o.r * 0.95, 0.06, 6, 18), runeMat);
      r1.rotation.x = Math.PI / 2;
      r1.position.set(o.x, o.h * 0.33, o.z);
      const r2 = r1.clone();
      r2.position.y = o.h * 0.72;
      const top = new THREE.Mesh(new THREE.BoxGeometry(o.r * 2.5, 0.5, o.r * 2.5), obsMat);
      top.position.set(o.x, o.h + 0.25, o.z);
      const base = new THREE.Mesh(new THREE.BoxGeometry(o.r * 2.6, 0.4, o.r * 2.6), obsMat);
      base.position.set(o.x, 0.2, o.z);
      const sh = new THREE.Mesh(new THREE.IcosahedronGeometry(0.5, 1), shardMat);
      sh.position.set(o.x, o.h + 1.4, o.z);
      sh.scale.y = 1.6;
      root.add(p, r1, r2, top, base, sh);
      const gl = glowSprite(0x9a6cff, 3.4, 0.5);
      gl.position.copy(sh.position);
      root.add(gl);
      colossi.push({ m: sh, halo: gl, y0: sh.position.y, ph: Math.random() * 6 });
    } else {
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(o.r, 1), obsMat);
      rock.scale.y = o.h / o.r;
      rock.position.set(o.x, o.h * 0.4, o.z);
      root.add(rock);
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + 0.5;
        const sh = new THREE.Mesh(new THREE.IcosahedronGeometry(0.28, 1), shardMat);
        sh.position.set(o.x + Math.cos(a) * o.r * 0.7, o.h + 0.15, o.z + Math.sin(a) * o.r * 0.7);
        sh.scale.y = 2;
        sh.rotation.z = Math.cos(a) * 0.4;
        root.add(sh);
      }
      const gl = glowSprite(0x9a6cff, 4, 0.35);
      gl.position.set(o.x, o.h + 0.3, o.z);
      root.add(gl);
    }
  }

  if (!low) {
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh || (mesh as THREE.InstancedMesh).isInstancedMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });
  }

  return {
    update(dt, t, focus) {
      skyMat.uniforms.uTime.value = t;
      runeRings.forEach((ring, i) => {
        ring.rotation.z += dt * (i === 0 ? 0.025 : -0.018);
        (ring.material as THREE.MeshStandardMaterial).opacity = (i === 0 ? 0.58 : 0.38) + Math.sin(t * 1.2 + i) * 0.05;
      });
      for (const f of flames) {
        const fl = 0.85 + Math.sin(t * 11 + f.ph) * 0.1 + Math.sin(t * 23 + f.ph * 2) * 0.05;
        f.sprite.scale.setScalar((f.y > 5 ? 3.4 : 2.0) * fl);
        if (Math.random() < 0.3) {
          const hot = f.y < 5;
          particles.emit(f.x + (Math.random() - 0.5) * 0.3, f.y, f.z + (Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.3, 1.2 + Math.random(), (Math.random() - 0.5) * 0.3, hot ? 0xff8a3a : 0x9a7cff, 0.22, 1.1, -0.5, 0.5, 0, 1.2);
        }
      }
      for (const c of colossi) {
        c.m.position.y = c.y0 + Math.sin(t * 0.6 + c.ph) * (c.y0 > 5 ? 0.8 : 0.12);
        c.m.rotation.y += dt * 0.35;
        c.halo.position.y = c.m.position.y;
        c.halo.material.opacity = 0.45 + Math.sin(t * 1.4 + c.ph) * 0.12;
      }
      for (const r of rocks) {
        r.m.position.y = r.y0 + Math.sin(t * 0.3 + r.ph) * 1.6;
        r.m.rotation.y += dt * r.spin;
      }
      // drifting motes of mana
      if (Math.random() < (low ? 0.4 : 0.9)) {
        const a = Math.random() * Math.PI * 2;
        const d = Math.random() * 20;
        particles.emit(focus.x + Math.cos(a) * d, 0.3 + Math.random() * 5, focus.z + Math.sin(a) * d, (Math.random() - 0.5) * 0.4, 0.25 + Math.random() * 0.4, (Math.random() - 0.5) * 0.4, Math.random() < 0.5 ? 0xb8a8ff : 0x7fe8ff, 0.1 + Math.random() * 0.1, 4, 0, 0.1, 0, 1);
      }
    },
    dispose() {
      scene.remove(root);
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        const mat = m.material as THREE.Material | undefined;
        if (mat) mat.dispose();
      });
      ft.map.dispose();
      ft.emissive.dispose();
    },
  };
}
