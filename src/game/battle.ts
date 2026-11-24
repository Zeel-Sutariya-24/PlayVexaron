// BattleSession: owns the simulation, AI, input and all visuals/feedback for one duel.
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { AIController, DIFFICULTY } from "./ai";
import { buildArena, type Arena } from "./arena";
import { sfx } from "./audio";
import { disposeTree, type Engine, type SceneModule } from "./engine";
import { aiLoadout, matchup, type Difficulty, type ElementId, type SpellDef, type SpellType, type StatusId } from "./elements";
import { glowSprite, ParticleSystem, RingPool, randRange } from "./fx";
import { InputManager } from "./input";
import { BookRig, MageModel, runeTexture } from "./models";
import type { Intent } from "./sim";
import { ARENA_R, DASH_TIME, EYE_H, Sim, fwd, rgt, type Projectile, type Result, type SimEvent, type Stats, type Wall, type Zone } from "./sim";

export type Phase = "countdown" | "playing" | "paused" | "over";

export interface HudSlot {
  id: string;
  name: string;
  c1: number;
  c2: number;
  elements: [ElementId, ElementId];
  type: SpellType;
  cdFrac: number;
  cdLeft: number;
  cost: number;
  afford: boolean;
  adv: number;
  selected: boolean;
}

export interface Toast {
  id: number;
  text: string;
  kind: "score" | "env" | "bad" | "info";
}

export interface HudSnap {
  phase: Phase;
  countdown: number;
  timeLeft: number;
  hp: number;
  mana: number;
  ehp: number;
  emana: number;
  slots: HudSlot[];
  charge: number;
  charging: boolean;
  pStatus: StatusId[];
  eStatus: StatusId[];
  eAttune: ElementId[];
  pAttune: ElementId[];
  combo: number;
  comboMult: number;
  score: number;
  dashFrac: number;
  blind: boolean;
  enemyName: string;
  toasts: Toast[];
  locked: boolean;
  lastHit: number;
  lastHurt: number;
  manaFlash: number;
  walls: number;
}

export interface EndInfo {
  result: Result;
  score: number;
  bonus: number;
  stats: Stats;
  enemyStats: Stats;
  time: number;
  timedOut: boolean;
  hp: number;
  ehp: number;
  difficulty: Difficulty;
}

export interface BattleOptions {
  loadout: SpellDef[];
  difficulty: Difficulty;
  damageLayer: HTMLElement;
  inputEl: HTMLElement;
  touch: boolean;
  sensitivity: number;
  onEnd: (e: EndInfo) => void;
  online?: { host: boolean; opponentLoadout: SpellDef[]; opponentName: string };
}

const STATUS_TEXT: Record<StatusId, string> = { burn: "BURNING!", chill: "CHILLED", freeze: "FROZEN!", wet: "SOAKED", stun: "STUNNED!", blind: "BLINDED", mud: "BOGGED" };
const STATUS_CSS: Record<StatusId, string> = { burn: "#ff9a4a", chill: "#8fe3ff", freeze: "#e6fbff", wet: "#6ab8ff", stun: "#ffe14d", blind: "#d9c79a", mud: "#c09a6a" };

function arcStripGeometry(arcRad: number, radius: number, maxW: number, n = 32) {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    const a = (u - 0.5) * arcRad;
    const cx = Math.sin(a) * radius;
    const cy = (Math.cos(a) - 1) * radius * 0.55;
    const tx = Math.cos(a) * radius;
    const ty = -Math.sin(a) * radius * 0.55;
    const tl = Math.hypot(tx, ty) || 1;
    const nx = -ty / tl;
    const ny = tx / tl;
    const w = maxW * Math.pow(Math.sin(Math.PI * u), 0.75) * 0.5;
    pos.push(cx + nx * w, cy + ny * w, 0, cx - nx * w, cy - ny * w, 0);
    uv.push(u, 1, u, 0);
    if (i < n) {
      const k = i * 2;
      idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

interface SlashFx {
  group: THREE.Group;
  mat: THREE.ShaderMaterial;
  rimMat: THREE.ShaderMaterial;
  geo: THREE.BufferGeometry;
  age: number;
}
interface ProjVis {
  group: THREE.Group;
  spin: THREE.Object3D;
  orbit: THREE.Object3D;
  tail?: THREE.Group;
  glow: THREE.Sprite;
  seen: boolean;
  p: Projectile;
}
interface WallVis {
  group: THREE.Group;
  body: THREE.Mesh;
  mats: THREE.Material[];
  scanBands: { mesh: THREE.Mesh; phase: number }[];
  baseOpacity: number;
  baseEmissive: number;
  seen: boolean;
  w: Wall;
  acc: number;
  gone: number;
}
interface ZoneVis {
  mesh: THREE.Mesh;
  fireRing?: THREE.Mesh;
  fireCore?: THREE.Mesh;
  seen: boolean;
  z: Zone;
  acc: number;
  fade: number;
}
interface Popup {
  el: HTMLElement;
  pos: THREE.Vector3;
  age: number;
  life: number;
}

export class BattleSession implements SceneModule {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(74, 1, 0.05, 1500);
  readonly bloom = { strength: 0.42, radius: 0.45, threshold: 0.92 };
  readonly sim: Sim;
  readonly input: InputManager;
  phase: Phase = "countdown";
  private prevPhase: Phase = "countdown";
  private ai: AIController | null;
  private particles: ParticleSystem;
  private rings = new RingPool();
  private arena: Arena;
  private mage: MageModel;
  private rig: BookRig;
  private projVis = new Map<number, ProjVis>();
  private wallVis = new Map<number, WallVis>();
  private zoneVis = new Map<number, ZoneVis>();
  private slashes: SlashFx[] = [];
  private popups: Popup[] = [];
  private toasts: (Toast & { born: number })[] = [];
  private toastId = 1;
  private projLights: THREE.PointLight[] = [];
  private flashLights: { l: THREE.PointLight; life: number; max: number; i: number }[] = [];
  private flashIdx = 0;
  private low: boolean;
  private countdown = 1.9;
  private lastCountInt = 3;
  private trauma = 0;
  private fovKick = 0;
  private hitStop = 0;
  private yawVel = 0;
  private pitchVel = 0;
  private lastSel = -1;
  private chargeSnd = false;
  private lastHit = 0;
  private lastHurt = 0;
  private manaFlash = 0;
  private endFired = false;
  private camDead = 0;
  private clock = 0;
  private bobT = 0;
  private lean = 0;
  private lastEnv = { text: "", t: 0 };
  private tmpV = new THREE.Vector3();
  private tmpDir = new THREE.Vector3();
  private forwardAxis = new THREE.Vector3(0, 0, 1);
  private chargeFullT = 0;
  private sparkAcc = 0;
  private locked = false;

  constructor(private engine: Engine, private o: BattleOptions) {
    const diff = DIFFICULTY[o.difficulty];
    this.low = engine.isMobile;
    const enemyLoadout = o.online?.opponentLoadout ?? aiLoadout(o.difficulty);
    this.sim = new Sim({
      playerLoadout: o.loadout,
      enemyLoadout,
      enemySpeed: o.online ? 7.6 : diff.speed,
      scoreMult: o.online ? 1 : diff.scoreMult,
      enemyDmg: o.online ? 1 : diff.damage,
      assist: o.online ? 0 : Math.max(diff.assist, o.touch ? 0.9 : 0),
      enemyName: o.online?.opponentName ?? diff.enemyName,
    });
    this.ai = o.online ? null : new AIController(this.sim, this.sim.enemy, this.sim.player, diff);
    this.input = new InputManager(o.inputEl);
    this.input.sensitivity = o.sensitivity;
    this.input.onPointerLockLost = () => {
      if (this.phase === "playing" || this.phase === "countdown") this.pause();
    };
    this.input.attach();

    this.particles = new ParticleSystem(this.low ? 2200 : 4000);
    this.scene.add(this.particles.points, this.rings.group);
    this.arena = buildArena(this.scene, this.particles, this.low);

    this.mage = new MageModel(0xffd27a);
    this.scene.add(this.mage.group);
    this.rig = new BookRig();
    this.camera.rotation.order = "YXZ";
    this.camera.add(this.rig.group);
    this.scene.add(this.camera);
    if (!this.low) {
      this.scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh || (mesh as THREE.InstancedMesh).isInstancedMesh) {
          mesh.castShadow = true;
          mesh.receiveShadow = true;
        }
      });
    }

    const nProj = this.low ? 1 : 2;
    for (let i = 0; i < nProj; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 16, 2);
      this.scene.add(l);
      this.projLights.push(l);
    }
    const nFlash = this.low ? 1 : 2;
    for (let i = 0; i < nFlash; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 18, 2);
      this.scene.add(l);
      this.flashLights.push({ l, life: 0, max: 1, i: 0 });
    }
    this.sim.player.yaw = 0;
    this.updateCamera(0);
    sfx.tick(3);
  }

  // ---- control -------------------------------------------------------------
  pause() {
    if (this.phase === "paused" || this.phase === "over") return;
    if (this.o.online && !this.o.online.host) {
      this.toast("The room host controls pauses.", "info");
      return;
    }
    this.prevPhase = this.phase;
    this.phase = "paused";
    this.input.releaseAll();
    this.input.exitLock();
    this.stopCharge();
  }

  resume() {
    if (this.phase !== "paused") return;
    this.phase = this.prevPhase;
    this.input.releaseAll();
    this.input.pauseQueued = false;
    if (!this.o.touch) this.input.requestLock();
  }

  private stopCharge() {
    if (this.chargeSnd) {
      sfx.chargeStop();
      this.chargeSnd = false;
    }
  }

  // ---- HUD -----------------------------------------------------------------
  snapshot(): HudSnap {
    const s = this.sim;
    const p = s.player;
    const e = s.enemy;
    const now = performance.now();
    const slots: HudSlot[] = p.loadout.map((d, i) => ({
      id: d.id,
      name: d.name,
      c1: d.colors[0],
      c2: d.colors[1],
      elements: d.elements,
      type: d.type,
      cdFrac: p.cd[i] > 0 ? Math.min(1, p.cd[i] / Math.max(0.1, p.cdMax[i])) : 0,
      cdLeft: p.cd[i],
      cost: d.manaCost,
      afford: p.mana >= d.manaCost,
      adv: e.attune.length ? matchup(d.elements, e.attune) : 0,
      selected: p.selected === i,
    }));
    this.toasts = this.toasts.filter((t) => now - t.born < 1700);
    return {
      phase: this.phase,
      countdown: this.countdown,
      timeLeft: Math.max(0, s.timeLimit - s.time),
      hp: p.hp,
      mana: p.mana,
      ehp: e.hp,
      emana: e.mana,
      slots,
      charge: p.cast ? Math.min(1, p.cast.charge / 3) : 0,
      charging: !!p.cast,
      pStatus: Object.keys(p.status) as StatusId[],
      eStatus: Object.keys(e.status) as StatusId[],
      eAttune: e.attune,
      pAttune: p.attune,
      combo: s.combo,
      comboMult: s.comboMult,
      score: s.score,
      dashFrac: p.dashCd > 0 ? 1 - p.dashCd / 1.4 : 1,
      blind: !!p.status.blind,
      enemyName: e.name,
      toasts: this.toasts.map(({ id, text, kind }) => ({ id, text, kind })),
      locked: this.input.locked,
      lastHit: this.lastHit,
      lastHurt: this.lastHurt,
      manaFlash: this.manaFlash,
      walls: s.walls.filter((w) => w.owner === "player").length,
    };
  }

  networkInput() { return { intent: { ...this.sim.intents.player }, yaw: this.sim.player.yaw, pitch: this.sim.player.pitch }; }

  setRemoteInput(input: { intent: Intent; yaw: number; pitch: number }) {
    if (!this.o.online?.host) return;
    Object.assign(this.sim.intents.enemy, input.intent);
    this.sim.enemy.yaw = input.yaw + Math.PI;
    this.sim.enemy.pitch = input.pitch;
  }

  networkState() { return JSON.stringify({ sim: this.sim.serialize(), phase: this.phase, countdown: this.countdown }); }

  applyNetworkState(serialized: string) {
    if (this.o.online?.host) return;
    const state = JSON.parse(serialized) as { sim: string; phase: Phase; countdown: number };
    this.sim.applyNetworkSnapshot(state.sim, true);
    this.phase = state.phase;
    this.countdown = state.countdown;
  }

  private toast(text: string, kind: Toast["kind"]) {
    this.toasts.push({ id: this.toastId++, text, kind, born: performance.now() });
    if (this.toasts.length > 4) this.toasts.shift();
  }

  // ---- main loop -----------------------------------------------------------
  update(dt: number, t: number) {
    const sim = this.sim;
    this.clock += dt;
    this.locked = this.input.locked;
    if (this.phase === "paused") {
      this.particles.setScale(this.engine.drawHeight, this.camera.fov);
      return;
    }
    let sdt = dt;
    if (this.phase === "over") sdt = dt * (sim.postTime < 1.8 ? 0.35 : 0.6);
    if (this.hitStop > 0) {
      this.hitStop -= dt;
      sdt *= 0.1;
    }

    const input = this.input;
    if (this.phase === "countdown" || this.phase === "playing") {
      const look = input.consumeLook(dt);
      sim.look(sim.player, look.yaw, look.pitch);
      this.yawVel += (look.yaw / Math.max(dt, 0.001) - this.yawVel) * Math.min(1, dt * 10);
      this.pitchVel += (look.pitch / Math.max(dt, 0.001) - this.pitchVel) * Math.min(1, dt * 10);
      if (input.pauseQueued) {
        input.pauseQueued = false;
        this.pause();
        return;
      }
      const it = sim.intents.player;
      if (this.phase === "playing") {
        const mv = input.getMove();
        it.mx = mv.mx;
        it.mz = mv.mz;
        it.fire = input.fire;
        if (input.dashQueued) it.dash = true;
        if (input.selectQueued !== null) it.select = input.selectQueued;
        if (input.cycleQueued !== 0 && !sim.player.cast) {
          const n = sim.player.loadout.length;
          it.select = (sim.player.selected + input.cycleQueued + n) % n;
        }
      } else {
        it.mx = it.mz = 0;
        it.fire = false;
      }
      input.dashQueued = false;
      input.selectQueued = null;
      input.cycleQueued = 0;
    }

    if (this.phase === "countdown" && (!this.o.online || this.o.online.host)) {
      this.countdown -= dt;
      const ci = Math.ceil(this.countdown / 0.6);
      if (ci !== this.lastCountInt && ci >= 1 && ci <= 3) {
        this.lastCountInt = ci;
        sfx.tick(ci);
      }
      if (this.countdown <= 0) {
        this.phase = "playing";
        sfx.tick(0);
        this.toast("DUEL!", "info");
      }
    }
    if (this.phase === "playing" && (!this.o.online || this.o.online.host)) {
      this.ai?.update(sdt);
      sim.step(sdt);
    } else if (this.phase === "over" && (!this.o.online || this.o.online.host)) {
      sim.step(sdt);
    }

    this.processEvents();
    this.syncVisuals(sdt, t);
    this.updateCamera(sdt);
    this.particles.setScale(this.engine.drawHeight, this.camera.fov);
    this.particles.update(sdt);
    this.rings.update(sdt, this.camera);
    this.arena.update(sdt, t, sim.player.pos);
    this.updatePopups(dt);

    this.trauma = Math.max(0, this.trauma - dt * 1.6);
    this.fovKick *= Math.exp(-dt * 7);
    this.manaFlash = Math.max(0, this.manaFlash - dt);

    if (this.phase === "over" && !this.endFired && sim.postTime > 1.9) {
      this.endFired = true;
      this.stopCharge();
      this.input.exitLock();
      this.o.onEnd({
        result: sim.result ?? "draw",
        score: sim.score,
        bonus: sim.bonus,
        stats: sim.stats.player,
        enemyStats: sim.stats.enemy,
        time: sim.time,
        timedOut: sim.timedOut,
        hp: sim.player.hp,
        ehp: sim.enemy.hp,
        difficulty: this.o.difficulty,
      });
    }
  }

  // ---- camera ----------------------------------------------------------------
  private updateCamera(dt: number) {
    const p = this.sim.player;
    const cam = this.camera;
    const speed01 = Math.min(1, Math.hypot(p.vel.x, p.vel.z) / 7.6);
    this.bobT += dt * (6 + speed01 * 6) * (p.dashT > 0 ? 0 : 1);
    const bob = Math.sin(this.bobT) * 0.035 * speed01;
    const rightV = rgt(p.yaw);
    const side = (p.vel.x * rightV.x + p.vel.z * rightV.z) / 7.6;
    this.lean += (side * 0.035 - this.lean) * Math.min(1, dt * 8);
    if (!p.alive) this.camDead = Math.min(1, this.camDead + dt / 0.9);
    const dash = p.dashT > 0 ? p.dashT / DASH_TIME : 0;
    const tr = this.trauma * this.trauma;
    const tt = this.clock * 38;
    const sx = (Math.sin(tt * 1.3) + Math.sin(tt * 2.1 + 1)) * 0.5 * tr * 0.07;
    const sy = (Math.sin(tt * 1.7 + 2) + Math.sin(tt * 2.9)) * 0.5 * tr * 0.07;
    const sr = Math.sin(tt * 1.1 + 4) * tr * 0.05;
    const eye = EYE_H + bob - dash * 0.25 - this.camDead * 1.1;
    cam.position.set(p.pos.x + sx, eye + sy, p.pos.z);
    cam.rotation.set(p.pitch + sy * 0.6 - dash * 0.05 + this.camDead * 0.3, p.yaw + sx * 0.6, this.lean + sr + this.camDead * 0.7);
    const chargeK = p.cast ? Math.min(1, p.cast.charge / 3) : 0;
    const fov = 74 + this.fovKick + chargeK * 4 + dash * 7;
    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
  }

  // ---- events ---------------------------------------------------------------
  private shake(amount: number, x?: number, z?: number) {
    let k = amount;
    if (x !== undefined && z !== undefined) {
      const d = Math.hypot(x - this.sim.player.pos.x, z - this.sim.player.pos.z);
      k = amount / (1 + d * 0.22);
    }
    this.trauma = Math.min(1, this.trauma + k);
  }

  private flash(x: number, y: number, z: number, color: number, intensity: number, life: number) {
    const f = this.flashLights[this.flashIdx % this.flashLights.length];
    this.flashIdx++;
    f.l.position.set(x, y, z);
    f.l.color.setHex(color);
    f.max = life;
    f.life = life;
    f.i = intensity;
  }

  private processEvents() {
    const sim = this.sim;
    const evs = sim.events;
    for (let i = 0; i < evs.length; i++) this.handleEvent(evs[i]);
    evs.length = 0;
  }

  private handleEvent(ev: SimEvent) {
    const sim = this.sim;
    switch (ev.t) {
      case "select":
        if (ev.side === "player") sfx.select();
        break;
      case "castStart":
        if (ev.side === "player") {
          sfx.chargeStart();
          this.chargeSnd = true;
        }
        break;
      case "cast": {
        const mine = ev.side === "player";
        sfx.cast(ev.def.type, ev.def.elements, ev.cf, mine);
        if (mine) {
          this.stopCharge();
          this.rig.kick(ev.def.type, ev.alt);
          this.fovKick += ev.def.type === "wall" ? 2 : 4 + ev.cf * 3;
          this.shake((ev.def.type === "wall" ? 0.3 : ev.def.type === "slash" ? 0.22 : 0.14) + ev.cf * 0.25);
          if (ev.def.type === "ball") {
            this.rig.orbWorld(this.tmpV);
            this.particles.burst(this.tmpV.x, this.tmpV.y, this.tmpV.z, ev.def.colors[0], 14, 2.5, 0.4, 0.14, { color2: ev.def.colors[1], drag: 3 });
          }
        } else {
          this.mage.kick(ev.def.type);
          this.shake(0.05, sim.enemy.pos.x, sim.enemy.pos.z);
          this.particles.burst(sim.enemy.pos.x, 1.4, sim.enemy.pos.z, ev.def.colors[0], 12, 3, 0.4, 0.2, { color2: ev.def.colors[1], drag: 3 });
        }
        break;
      }
      case "interrupt":
        sfx.interrupt();
        if (ev.side === "player") {
          this.stopCharge();
          this.toast("CAST INTERRUPTED", "bad");
        } else {
          this.popup("INTERRUPTED!", sim.enemy.pos.x, 2.7, sim.enemy.pos.z, "txt");
        }
        break;
      case "noMana":
        if (ev.side === "player") {
          sfx.noMana();
          this.manaFlash = 0.5;
        }
        break;
      case "hit": {
        const me = ev.side === "player";
        if (ev.kind === "dot") {
          this.popup(String(Math.max(1, Math.round(ev.amount))), ev.x, ev.y, ev.z, "dot");
          break;
        }
        const col = ev.def ? ev.def.colors[0] : 0xffe14d;
        const col2 = ev.def ? ev.def.colors[1] : 0xffffff;
        if (me) {
          this.lastHurt = performance.now();
          this.shake(Math.min(0.9, 0.3 + ev.amount / 30));
          sfx.hurt(ev.amount);
          this.hitStop = Math.max(this.hitStop, 0.05);
          this.popup(String(Math.round(ev.amount)), sim.player.pos.x + (Math.random() - 0.5) * 0.6, 1.0, sim.player.pos.z, "hurt");
        } else {
          this.lastHit = performance.now();
          this.shake(0.12 + ev.amount / 70);
          sfx.hit(ev.amount, true, ev.def?.type ?? "ball");
          this.hitStop = Math.max(this.hitStop, ev.amount > 18 ? 0.07 : 0.035);
          const cls = ev.tag === "adv" ? "adv" : ev.tag === "res" ? "res" : ev.tag === "conduct" || ev.tag === "shatter" ? "conduct" : ev.amount >= 24 ? "big" : "norm";
          const pre = ev.tag === "adv" ? "▲ " : ev.tag === "res" ? "▼ " : "";
          this.popup(pre + Math.round(ev.amount), ev.x + (Math.random() - 0.5) * 0.6, 2.2, ev.z, cls);
        }
        this.particles.burst(ev.x, ev.y, ev.z, col, this.low ? 14 : 24, 6 + ev.amount * 0.15, 0.55, 0.26, { color2: col2, drag: 2.2, grav: 4 });
        this.rings.spawn(ev.x, ev.y, ev.z, col, 0.2, 1.6, 0.35, true);
        break;
      }
      case "impact":
        this.impactFx(ev);
        break;
      case "slash":
        this.makeSlash(ev);
        break;
      case "wallSpawn": {
        this.makeWallVis(ev.wall);
        const w = ev.wall;
        this.particles.burst(w.x, 0.3, w.z, w.def.colors[0], 28, 4, 0.8, 0.35, { color2: w.def.colors[1], grav: 3, up: 2 });
        this.rings.spawn(w.x, 0.06, w.z, w.def.colors[0], 0.5, w.hw + 1.2, 0.6);
        this.shake(0.22, w.x, w.z);
        this.flash(w.x, 1.5, w.z, w.def.colors[0], 90, 0.4);
        break;
      }
      case "wallHit": {
        const w = ev.wall;
        sfx.wallHit();
        this.particles.burst(w.x + (Math.random() - 0.5) * w.hw, 1.5, w.z, w.def.colors[1], 12, 4, 0.4, 0.2, { grav: 6 });
        this.popup(String(Math.round(ev.amount)), w.x, 3.2, w.z, "wall");
        this.shake(0.08, w.x, w.z);
        break;
      }
      case "wallBreak": {
        const w = ev.wall;
        if (ev.reason === "hp") {
          sfx.wallBreak();
          this.shake(0.3, w.x, w.z);
          this.hitStop = Math.max(this.hitStop, 0.04);
        }
        const n = ev.reason === "hp" ? 60 : 30;
        const ux = Math.cos(w.yaw);
        const uz = -Math.sin(w.yaw);
        for (let i = 0; i < n; i++) {
          const k = (Math.random() * 2 - 1) * w.hw;
          const col = Math.random() < 0.5 ? w.def.colors[0] : w.def.colors[1];
          this.particles.emit(w.x + ux * k, Math.random() * 3, w.z + uz * k, (Math.random() - 0.5) * 4, Math.random() * 4, (Math.random() - 0.5) * 4, col, 0.3 + Math.random() * 0.3, 0.9, 9, 0.5, 0, 1.3);
        }
        this.rings.spawn(w.x, 0.06, w.z, w.def.colors[0], 0.5, w.hw + 2, 0.5);
        const wv = this.wallVis.get(w.id);
        if (wv) wv.gone = 0.01;
        break;
      }
      case "deflect":
        sfx.deflect();
        this.toast("DEFLECTED!", "score");
        this.rings.spawn(ev.x, ev.y, ev.z, 0xffffff, 0.3, 3, 0.4, true);
        this.particles.burst(ev.x, ev.y, ev.z, 0xffffff, 24, 8, 0.5, 0.2, { drag: 2 });
        this.hitStop = Math.max(this.hitStop, 0.08);
        this.shake(0.3);
        break;
      case "dodge":
        if (ev.side === "player") {
          sfx.dodge();
          this.fovKick += 3;
        }
        this.rings.spawn(ev.x, 1.2, ev.z, 0x9affff, 0.3, 2.2, 0.35, true, 0.7);
        break;
      case "dash": {
        sfx.dash();
        const c = ev.side === "player" ? sim.player : sim.enemy;
        if (ev.side === "player") this.fovKick += 5;
        for (let i = 0; i < 18; i++) {
          this.particles.emit(c.pos.x + (Math.random() - 0.5) * 0.8, 0.2 + Math.random() * 1.4, c.pos.z + (Math.random() - 0.5) * 0.8, -ev.dx * 3 * Math.random(), Math.random(), -ev.dz * 3 * Math.random(), 0xbfd8ff, 0.2, 0.45, 0, 2, 0, 1);
        }
        break;
      }
      case "status":
        if (ev.side === "player") {
          this.toast(STATUS_TEXT[ev.id], "bad");
          if (ev.id === "stun" || ev.id === "freeze") this.shake(0.3);
        } else {
          this.popup(STATUS_TEXT[ev.id], sim.enemy.pos.x, 2.9, sim.enemy.pos.z, "status", STATUS_CSS[ev.id]);
        }
        break;
      case "zone":
        break;
      case "env": {
        sfx.combo();
        this.lastEnv = { text: ev.text, t: this.clock };
        this.popup(ev.text, ev.x, ev.y + 0.8, ev.z, "txt");
        this.toast(ev.text, "env");
        this.particles.burst(ev.x, ev.y, ev.z, 0xfff1a8, 22, 6, 0.6, 0.22, { drag: 2 });
        this.rings.spawn(ev.x, ev.y, ev.z, 0xfff1a8, 0.3, 2.4, 0.45, true);
        this.shake(0.15, ev.x, ev.z);
        break;
      }
      case "clash": {
        sfx.clash();
        const c1 = ev.a.colors[0];
        const c2 = ev.b.colors[0];
        this.particles.burst(ev.x, ev.y, ev.z, c1, 18, 7, 0.5, 0.22, { color2: c2, drag: 2 });
        this.rings.spawn(ev.x, ev.y, ev.z, 0xffffff, 0.3, 2.8, 0.4, true);
        this.flash(ev.x, ev.y, ev.z, c1, 70, 0.2);
        this.shake(0.12, ev.x, ev.z);
        break;
      }
      case "score":
        if (ev.label === "HIT" || ev.label.startsWith("x") || ev.label === "DEFLECT!") break;
        if (this.lastEnv.text === ev.label && this.clock - this.lastEnv.t < 0.4) break;
        this.toast(`+${ev.pts} ${ev.label}`, "score");
        break;
      case "end": {
        this.phase = "over";
        this.stopCharge();
        const win = ev.result === "win";
        if (ev.result === "win") sfx.win();
        else if (ev.result === "lose") sfx.lose();
        this.toast(win ? "VICTORY!" : ev.result === "draw" ? "DRAW" : sim.timedOut ? "TIME!" : "DEFEATED", win ? "score" : "bad");
        const loser = win ? sim.enemy : sim.player;
        if (ev.result !== "draw") {
          this.particles.burst(loser.pos.x, 1.2, loser.pos.z, 0xffe9a8, 80, 9, 1.3, 0.35, { color2: 0xa78bfa, grav: 2, drag: 1 });
          this.rings.spawn(loser.pos.x, 0.1, loser.pos.z, 0xffe9a8, 0.5, 9, 1.0);
        }
        this.shake(0.6);
        this.fovKick += 8;
        break;
      }
      default:
        break;
    }
  }

  private impactFx(ev: Extract<SimEvent, { t: "impact" }>) {
    const { x, y, z, def, where } = ev;
    if (where === "expire") {
      this.particles.burst(x, y, z, def.colors[0], 8, 2, 0.4, 0.16, { drag: 2 });
      return;
    }
    const n = Math.round((this.low ? 8 : 14) + ev.power * 0.8);
    const els: ElementId[] = def.elements[0] === def.elements[1] ? [def.elements[0]] : def.elements;
    for (const e of els) {
      const c1 = e === def.elements[0] ? def.colors[0] : def.colors[1];
      const c2 = e === def.elements[0] ? def.colors[1] : def.colors[0];
      const m = els.length === 1 ? n : n / 2;
      if (e === "fire") this.particles.burst(x, y, z, c1, m, 7, 0.75, 0.34, { color2: 0xffd27a, up: 3, grav: -1.2, drag: 1.5 });
      else if (e === "water") this.particles.burst(x, y, z, c1, m, 6, 0.85, 0.24, { color2: 0xdff4ff, up: 4, grav: 12, drag: 0.4 });
      else if (e === "wind") this.particles.burst(x, y, z, c1, m, 11, 0.6, 0.2, { color2: c2, drag: 3, spreadY: 0.4 });
      else this.particles.burst(x, y, z, c1, m, 6, 0.95, 0.3, { color2: 0x8b6b3a, up: 3, grav: 16, drag: 0.3, hdr: 1 });
    }
    this.rings.spawn(x, 0.07, z, def.colors[0], 0.3, 1.8 + ev.r * 3 + (ev.power > 25 ? 1.5 : 0), 0.5);
    this.rings.spawn(x, y, z, 0xffffff, 0.2, 1.4, 0.25, true, 0.8);
    this.flash(x, y + 0.3, z, def.colors[0], 70 + ev.power * 2, 0.25);
    sfx.impact(def.elements[0]);
    this.shake((where === "player" ? 0.08 : 0.2) + ev.power * 0.004, x, z);
  }

  private makeSlash(ev: Extract<SimEvent, { t: "slash" }>) {
    const arcVis = Math.min(2.4, ev.arc * 1.05);
    const geo = arcStripGeometry(arcVis, ev.range * 0.78, 1.5 + ev.cf * 0.8);
    const mat = new THREE.ShaderMaterial({
      uniforms: { uSweep: { value: 0 }, uAlpha: { value: 1 }, uA: { value: new THREE.Color(ev.def.colors[0]) }, uB: { value: new THREE.Color(ev.def.colors[1]) } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `varying vec2 vUv; uniform float uSweep; uniform float uAlpha; uniform vec3 uA; uniform vec3 uB;
        void main(){
          float behind = uSweep - vUv.x;
          float vis = step(0.0, behind) * exp(-behind * 3.0);
          float edge = 1.0 - abs(vUv.y * 2.0 - 1.0);
          float core = pow(edge, 1.3);
          vec3 col = mix(uB, uA, core) + vec3(1.0) * pow(edge, 6.0) * 0.5;
          gl_FragColor = vec4(col * 1.5, vis * core * uAlpha);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.z = ev.alt * (0.5 + Math.random() * 0.25);
    mesh.scale.x = ev.alt;
    const group = new THREE.Group();
    const rimMat = mat.clone();
    rimMat.uniforms.uA.value.set(0xe9fbff);
    rimMat.uniforms.uB.value.set(ev.def.colors[1]);
    rimMat.uniforms.uAlpha.value = 0.58;
    const rim = new THREE.Mesh(geo, rimMat);
    rim.rotation.z = mesh.rotation.z;
    rim.scale.set(ev.alt, 0.14, 1);
    rim.position.z = 0.02;
    group.add(mesh, rim);
    const yaw = Math.atan2(-ev.fx, -ev.fz);
    group.rotation.y = yaw;
    group.position.set(ev.x + ev.fx * ev.range * 0.6, ev.side === "player" ? 1.25 : 1.3, ev.z + ev.fz * ev.range * 0.6);
    this.scene.add(group);
    this.slashes.push({ group, mat, rimMat, geo, age: 0 });
    // sparks along the arc
    const rx = Math.cos(yaw);
    const rz = -Math.sin(yaw);
    for (let i = 0; i < 16; i++) {
      const k = (Math.random() - 0.5) * ev.range * 1.5;
      this.particles.emit(group.position.x + rx * k, 1.1 + Math.random() * 0.8, group.position.z + rz * k, ev.fx * 4, Math.random() * 2, ev.fz * 4, i % 2 ? ev.def.colors[0] : ev.def.colors[1], 0.22, 0.4, 0, 2, 0, 1.5);
    }
  }

  // ---- visual sync -------------------------------------------------------------
  private popup(text: string, x: number, y: number, z: number, cls: string, color?: string) {
    const el = document.createElement("div");
    el.className = `dmg-pop ${cls}`;
    el.textContent = text;
    if (color) el.style.color = color;
    this.o.damageLayer.appendChild(el);
    this.popups.push({ el, pos: new THREE.Vector3(x, y, z), age: 0, life: 1.0 });
    if (this.popups.length > 22) {
      const old = this.popups.shift();
      old?.el.remove();
    }
  }

  private updatePopups(dt: number) {
    const cw = this.engine.renderer.domElement.clientWidth;
    const ch = this.engine.renderer.domElement.clientHeight;
    for (let i = this.popups.length - 1; i >= 0; i--) {
      const p = this.popups[i];
      p.age += dt;
      if (p.age >= p.life) {
        p.el.remove();
        this.popups.splice(i, 1);
        continue;
      }
      const v = this.tmpV.copy(p.pos);
      v.y += p.age * 1.1;
      v.project(this.camera);
      if (v.z > 1 || v.z < -1) {
        p.el.style.opacity = "0";
        continue;
      }
      const k = p.age / p.life;
      p.el.style.opacity = String(k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3);
      const sc = k < 0.15 ? 0.6 + (k / 0.15) * 0.7 : 1.3 - Math.min(0.3, (k - 0.15) * 0.5);
      p.el.style.transform = `translate(-50%,-50%) translate(${((v.x + 1) / 2) * cw}px, ${((1 - v.y) / 2) * ch}px) scale(${sc})`;
    }
  }

  private makeProjVis(p: Projectile): ProjVis {
    const d = p.def;
    const [ea, eb] = d.elements;
    const r = p.r;
    const group = new THREE.Group();
    const geoFor = (e: ElementId, s: number): THREE.BufferGeometry => {
      if (e === "fire" || e === "water") return new THREE.SphereGeometry(s, 32, 24);
      if (e === "wind") return new THREE.TorusGeometry(s * 0.8, s * 0.18, 14, 40);
      return new THREE.DodecahedronGeometry(s, 1);
    };
    const isFire = ea === "fire";
    const core = new THREE.Mesh(geoFor(ea, r * (isFire ? 0.78 : 0.85)), new THREE.MeshStandardMaterial({ color: d.colors[0], emissive: d.colors[0], emissiveIntensity: isFire ? 1.65 : 2.4, roughness: isFire ? 0.25 : 0.4, metalness: isFire ? 0.12 : 0, flatShading: false }));
    const shell = new THREE.Mesh(
      new THREE.SphereGeometry(r * (isFire ? 1.22 : 1.3), 32, 24),
      new THREE.MeshBasicMaterial({ color: d.colors[1], transparent: true, opacity: isFire ? 0.2 : 0.32, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    const spin = new THREE.Group();
    spin.add(core);
    if (isFire) {
      const heart = new THREE.Mesh(
        new THREE.SphereGeometry(r * 0.36, 24, 18),
        new THREE.MeshBasicMaterial({ color: 0xfff3bd, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }),
      );
      spin.add(heart);
      for (let i = 0; i < 3; i++) {
        const band = new THREE.Mesh(
          new THREE.TorusGeometry(r * (0.84 + i * 0.04), r * 0.055, 12, 56),
          new THREE.MeshBasicMaterial({ color: i === 1 ? 0xffd072 : d.colors[i % 2], transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }),
        );
        band.rotation.set(Math.PI * (0.28 + i * 0.24), Math.PI * (i / 3), Math.PI * 0.12);
        spin.add(band);
      }
    }
    const orbit = new THREE.Group();
    for (let i = 0; i < 3; i++) {
      const m = new THREE.Mesh(geoFor(eb, r * 0.28), new THREE.MeshBasicMaterial({ color: d.colors[1] }));
      const a = (i / 3) * Math.PI * 2;
      m.position.set(Math.cos(a) * r * 1.55, Math.sin(a * 2) * r * 0.4, Math.sin(a) * r * 1.55);
      orbit.add(m);
    }
    let tail: THREE.Group | undefined;
    if (isFire) {
      tail = new THREE.Group();
      const flameMat = new THREE.MeshBasicMaterial({ color: 0xff702e, transparent: true, opacity: 0.72, blending: THREE.AdditiveBlending, depthWrite: false });
      const hotFlameMat = new THREE.MeshBasicMaterial({ color: 0xffd06b, transparent: true, opacity: 0.72, blending: THREE.AdditiveBlending, depthWrite: false });
      for (let i = 0; i < 4; i++) {
        const tongue = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 16), i === 0 ? hotFlameMat : flameMat);
        const s = r * (i === 0 ? 0.22 : 0.28 + (i % 2) * 0.06);
        tongue.scale.set(s * 0.78, s * 0.82, s * (2.1 + (i % 2) * 0.7));
        const a = (i / 3) * Math.PI * 2;
        tongue.position.set(Math.cos(a) * r * 0.2, Math.sin(a) * r * 0.2, -r * (0.9 + (i % 2) * 0.22));
        tail.add(tongue);
      }
    }
    const glow = glowSprite(d.colors[0], r * 8, 0.85);
    if (isFire) glow.material.opacity = 0.65;
    group.add(spin, shell, orbit, glow);
    if (tail) group.add(tail);
    this.scene.add(group);
    return { group, spin, orbit, tail, glow, seen: true, p };
  }

  private makeWallVis(w: Wall): WallVis {
    const el = w.def.elements[0];
    const baseOpacity = { fire: 0.74, water: 0.62, wind: 0.42, earth: 0.96 }[el];
    const baseEmissive = el === "earth" ? 0.4 : 0.95;
    const geo = new RoundedBoxGeometry(w.hw * 2, w.h, w.hd * 2, 4, 0.12);
    const mat = new THREE.MeshStandardMaterial({ color: w.def.colors[0], emissive: w.def.colors[1], emissiveIntensity: baseEmissive, roughness: el === "earth" ? 0.9 : 0.25, metalness: 0.1, transparent: true, opacity: baseOpacity, flatShading: el === "earth" });
    const body = new THREE.Mesh(geo, mat);
    body.position.y = w.h / 2;
    const edgeMat = new THREE.LineBasicMaterial({ color: w.def.colors[1], transparent: true, opacity: 0.9 });
    const frameGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(w.hw * 2 + 0.025, w.h + 0.025, w.hd * 2 + 0.025));
    const edges = new THREE.LineSegments(frameGeo, edgeMat);
    edges.position.y = w.h / 2;
    const group = new THREE.Group();
    group.add(body, edges);
    const mats: THREE.Material[] = [mat, edgeMat];
    const scanBands: WallVis["scanBands"] = [];
    const bandGeo = new THREE.PlaneGeometry(w.hw * 1.84, 0.035);
    for (const side of [-1, 1]) {
      for (let i = 0; i < 3; i++) {
        const bandMat = new THREE.MeshBasicMaterial({ color: w.def.colors[1], transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
        const band = new THREE.Mesh(bandGeo, bandMat);
        band.position.set(0, 0.2 + ((i + 0.5) / 3) * (w.h - 0.4), side * (w.hd + 0.026));
        if (side < 0) band.rotation.y = Math.PI;
        group.add(band);
        mats.push(bandMat);
        scanBands.push({ mesh: band, phase: i / 3 + (side < 0 ? 0.16 : 0) });
      }
    }
    const n = Math.max(1, Math.round((w.hw * 2) / w.h));
    const size = w.h * 0.82;
    const runeGeo = new THREE.PlaneGeometry(size, size);
    for (let k = 0; k < n; k++) {
      const x = -w.hw + ((k + 0.5) * w.hw * 2) / n;
      for (const s of [1, -1]) {
        const rm = new THREE.MeshBasicMaterial({ map: runeTexture(), color: w.def.colors[1], transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
        const m = new THREE.Mesh(runeGeo, rm);
        m.position.set(x, w.h / 2, s * (w.hd + 0.02));
        if (s < 0) m.rotation.y = Math.PI;
        group.add(m);
        mats.push(rm);
      }
    }
    group.position.set(w.x, 0, w.z);
    group.rotation.y = w.yaw;
    group.scale.y = 0.05;
    this.scene.add(group);
    const wv: WallVis = { group, body, mats, scanBands, baseOpacity, baseEmissive, seen: true, w, acc: 0, gone: 0 };
    this.wallVis.set(w.id, wv);
    return wv;
  }

  private makeZoneVis(z: Zone): ZoneVis {
    const colorOf = { fire: 0xff6a1f, puddle: 0x2e8bff, ice: 0xc4f0ff, steam: 0xe8ecff, mud: 0x6b4a2a }[z.kind];
    const additive = z.kind === "fire" || z.kind === "steam";
    const mat = new THREE.MeshBasicMaterial({
      map: this.zoneTex(),
      color: colorOf,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    const mesh = new THREE.Mesh(new THREE.CircleGeometry(1, 36), mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(z.x, 0.04 + (z.id % 7) * 0.004, z.z);
    mesh.scale.setScalar(0.1);
    mesh.renderOrder = 2;
    this.scene.add(mesh);
    let fireRing: THREE.Mesh | undefined;
    let fireCore: THREE.Mesh | undefined;
    if (z.kind === "fire") {
      fireRing = new THREE.Mesh(
        new THREE.TorusGeometry(0.86, 0.035, 12, 96),
        new THREE.MeshBasicMaterial({ color: 0xffb33d, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }),
      );
      fireRing.rotation.x = -Math.PI / 2;
      fireRing.position.set(z.x, 0.075, z.z);
      this.scene.add(fireRing);
      fireCore = new THREE.Mesh(
        new THREE.TorusGeometry(0.58, 0.018, 8, 80),
        new THREE.MeshBasicMaterial({ color: 0xff5535, transparent: true, opacity: 0.68, blending: THREE.AdditiveBlending, depthWrite: false }),
      );
      fireCore.rotation.x = -Math.PI / 2;
      fireCore.position.set(z.x, 0.08, z.z);
      this.scene.add(fireCore);
    }
    const zv = { mesh, fireRing, fireCore, seen: true, z, acc: 0, fade: 0 };
    this.zoneVis.set(z.id, zv);
    return zv;
  }

  private zoneTexCache: THREE.Texture | null = null;
  private zoneTex() {
    if (!this.zoneTexCache) {
      const c = document.createElement("canvas");
      c.width = c.height = 128;
      const g = c.getContext("2d")!;
      const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
      gr.addColorStop(0, "rgba(255,255,255,0.95)");
      gr.addColorStop(0.7, "rgba(255,255,255,0.75)");
      gr.addColorStop(0.9, "rgba(255,255,255,0.35)");
      gr.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = gr;
      g.fillRect(0, 0, 128, 128);
      this.zoneTexCache = new THREE.CanvasTexture(c);
      (this.zoneTexCache as THREE.CanvasTexture).colorSpace = THREE.SRGBColorSpace;
    }
    return this.zoneTexCache;
  }

  private statusFx(c: typeof this.sim.enemy, dt: number) {
    if (!c.alive) return;
    const st = c.status;
    const px = c.pos.x;
    const pz = c.pos.z;
    const rate = dt * 60;
    const r = () => (Math.random() - 0.5) * 0.7;
    if (st.burn && Math.random() < 0.7 * rate) this.particles.emit(px + r(), 0.4 + Math.random() * 1.5, pz + r(), r() * 0.5, 1.5 + Math.random(), r() * 0.5, Math.random() < 0.5 ? 0xff7a2e : 0xffc060, 0.32, 0.6, -1, 0.5, 0, 1.4);
    if (st.chill && Math.random() < 0.4 * rate) this.particles.emit(px + r(), 0.5 + Math.random() * 1.6, pz + r(), r() * 0.3, -0.4, r() * 0.3, 0xbfefff, 0.14, 0.9, 0, 0.5, 0, 1.3);
    if (st.freeze && Math.random() < 0.8 * rate) this.particles.emit(px + r() * 1.3, 0.2 + Math.random() * 1.9, pz + r() * 1.3, 0, 0.2, 0, 0xe8fbff, 0.4, 0.5, 0, 0.5, 0, 1.6);
    if (st.stun && Math.random() < 0.6 * rate) {
      const a = this.clock * 8;
      this.particles.emit(px + Math.cos(a) * 0.5, 2.5, pz + Math.sin(a) * 0.5, 0, 0, 0, 0xffe14d, 0.22, 0.3, 0, 0, 0, 1.6);
    }
    if (st.wet && Math.random() < 0.25 * rate) this.particles.emit(px + r(), 1.5, pz + r(), 0, -1, 0, 0x6ab8ff, 0.12, 0.6, 6, 0, 0, 1.2);
    if (st.blind && Math.random() < 0.3 * rate) this.particles.emit(px + r(), 1.8, pz + r(), r(), 0.3, r(), 0xc9b48a, 0.35, 0.8, 0, 1, 0.5, 0.7);
    if (st.mud && Math.random() < 0.25 * rate) this.particles.emit(px + r(), 0.2, pz + r(), r(), 1, r(), 0x8a6a3a, 0.2, 0.6, 8, 0.5, 0, 0.9);
  }

  private syncVisuals(dt: number, t: number) {
    const sim = this.sim;
    const pl = sim.player;
    const en = sim.enemy;
    const P = this.particles;

    // equipped spell colours + page flip
    if (pl.selected !== this.lastSel) {
      const d = pl.loadout[pl.selected];
      this.rig.setColors(d.colors[0], d.colors[1]);
      if (this.lastSel >= 0) this.rig.flip();
      this.lastSel = pl.selected;
    }

    // ---- projectiles
    for (const v of this.projVis.values()) v.seen = false;
    let lightIdx = 0;
    for (let i = sim.projectiles.length - 1; i >= 0; i--) {
      const p = sim.projectiles[i];
      let v = this.projVis.get(p.id);
      if (!v) {
        v = this.makeProjVis(p);
        this.projVis.set(p.id, v);
      }
      v.seen = true;
      v.p = p;
      v.group.position.copy(p.pos);
      v.spin.rotation.x += dt * 5;
      v.spin.rotation.y += dt * 7;
      v.orbit.rotation.y += dt * 9;
      v.orbit.rotation.x += dt * 3;
      if (v.tail) {
        this.tmpDir.set(p.vel.x, p.vel.y, p.vel.z).normalize();
        if (this.tmpDir.lengthSq() > 0.01) v.tail.quaternion.setFromUnitVectors(this.forwardAxis, this.tmpDir);
        const flamePulse = 0.9 + Math.sin(t * 28 + p.id) * 0.12;
        v.tail.scale.setScalar(flamePulse);
      }
      v.glow.scale.setScalar(p.r * 8 * (1 + Math.sin(t * 20 + p.id) * 0.08));
      if (lightIdx < this.projLights.length) {
        const l = this.projLights[lightIdx++];
        l.position.copy(p.pos);
        l.color.setHex(p.def.colors[0]);
        l.intensity = 40 + p.power * 2;
      }
      // trail
      const nTrail = this.low ? 1 : 2;
      for (let k = 0; k < nTrail; k++) {
        const e = Math.random() < 0.5 ? p.def.elements[0] : p.def.elements[1];
        const col = e === p.def.elements[0] ? p.def.colors[0] : p.def.colors[1];
        const bx = p.pos.x - p.vel.x * Math.random() * dt * 2;
        const by = p.pos.y - p.vel.y * Math.random() * dt * 2;
        const bz = p.pos.z - p.vel.z * Math.random() * dt * 2;
        const rr = p.r * 0.7;
        const jx = (Math.random() - 0.5) * rr;
        const jy = (Math.random() - 0.5) * rr;
        const jz = (Math.random() - 0.5) * rr;
        if (e === "fire") P.emit(bx + jx, by + jy, bz + jz, jx * 2, 1.2 + Math.random(), jz * 2, Math.random() < 0.4 ? 0xffd27a : col, p.r * 1.1, 0.4, -1, 1, 0, 1.4);
        else if (e === "water") P.emit(bx + jx, by + jy, bz + jz, jx * 2, 0, jz * 2, col, p.r * 0.7, 0.5, 8, 0.5, 0, 1.3);
        else if (e === "wind") P.emit(bx + jx, by + jy, bz + jz, -p.vel.x * 0.12, -p.vel.y * 0.12, -p.vel.z * 0.12, col, p.r * 0.6, 0.3, 0, 2, 0, 1.3);
        else P.emit(bx + jx, by + jy, bz + jz, jx * 3, jy * 3, jz * 3, Math.random() < 0.5 ? col : 0x8b6b3a, p.r * 0.6, 0.55, 9, 0.5, 0, 1);
      }
    }
    for (const [id, v] of this.projVis) {
      if (!v.seen) {
        this.scene.remove(v.group);
        disposeTree(v.group);
        this.projVis.delete(id);
      }
    }
    for (let i = lightIdx; i < this.projLights.length; i++) this.projLights[i].intensity = 0;
    for (const f of this.flashLights) {
      f.life = Math.max(0, f.life - dt);
      f.l.intensity = f.life > 0 ? f.i * (f.life / f.max) : 0;
    }

    // ---- walls
    for (const v of this.wallVis.values()) v.seen = false;
    for (const w of sim.walls) {
      let v = this.wallVis.get(w.id);
      if (!v) v = this.makeWallVis(w);
      v.seen = true;
    }
    for (const [id, v] of this.wallVis) {
      const w = v.w;
      if (!v.seen) {
        // fading out after destruction
        v.gone += dt * 3;
        v.group.scale.y = Math.max(0.01, 1 - v.gone);
        for (const m of v.mats) (m as THREE.Material & { opacity: number }).opacity *= 0.8;
        if (v.gone >= 1) {
          this.scene.remove(v.group);
          disposeTree(v.group);
          this.wallVis.delete(id);
        }
        continue;
      }
      const rise = Math.min(1, w.age / 0.3);
      v.group.scale.y = 0.05 + 0.95 * (1 - Math.pow(1 - rise, 3));
      const left = w.life - w.age;
      const fade = left < 1 ? (Math.sin(t * 40) * 0.25 + 0.75) * Math.max(0, left) : 1;
      const hpK = Math.max(0, w.hp / w.maxHp);
      const bm = v.body.material as THREE.MeshStandardMaterial;
      bm.opacity = v.baseOpacity * fade * (0.55 + 0.45 * hpK);
      bm.emissiveIntensity = v.baseEmissive * (0.6 + 0.6 * hpK) + w.flash * 2.5;
      for (let i = 1; i < v.mats.length; i++) (v.mats[i] as THREE.Material & { opacity: number }).opacity = (i === 1 ? 0.9 : 0.55) * fade;
      for (const band of v.scanBands) {
        const phase = ((t * 0.24 + band.phase) % 1 + 1) % 1;
        band.mesh.position.y = 0.18 + phase * (w.h - 0.36);
        (band.mesh.material as THREE.MeshBasicMaterial).opacity = fade * (0.22 + (0.5 + Math.sin(t * 9 + band.phase * 8) * 0.5) * 0.34);
      }
      v.acc += dt;
      if (v.acc > (this.low ? 0.09 : 0.045)) {
        v.acc = 0;
        const ux = Math.cos(w.yaw);
        const uz = -Math.sin(w.yaw);
        const k = (Math.random() * 2 - 1) * w.hw;
        const e = Math.random() < 0.5 ? w.def.elements[0] : w.def.elements[1];
        const col = e === w.def.elements[0] ? w.def.colors[0] : w.def.colors[1];
        const y = Math.random() < 0.5 ? w.h * v.group.scale.y : Math.random() * w.h * 0.5;
        if (e === "fire") P.emit(w.x + ux * k, y, w.z + uz * k, 0, 1.5 + Math.random(), 0, col, 0.5, 0.8, -0.5, 0.5, 0, 1.4);
        else if (e === "water") P.emit(w.x + ux * k, y, w.z + uz * k, 0, -0.5, 0, col, 0.2, 0.9, 5, 0.5, 0, 1.3);
        else if (e === "wind") P.emit(w.x + ux * k, y, w.z + uz * k, ux * 2, 1, uz * 2, col, 0.25, 0.7, 0, 1, 0, 1.3);
        else P.emit(w.x + ux * k, y, w.z + uz * k, 0, 0.5, 0, col, 0.22, 0.9, 2, 0.5, 0, 1);
      }
    }

    // ---- zones
    for (const v of this.zoneVis.values()) v.seen = false;
    for (const z of sim.zones) {
      let v = this.zoneVis.get(z.id);
      if (!v) v = this.makeZoneVis(z);
      v.seen = true;
    }
    for (const [id, v] of this.zoneVis) {
      const z = v.z;
      const mat = v.mesh.material as THREE.MeshBasicMaterial;
      if (!v.seen) {
        v.fade += dt * 2.5;
        mat.opacity *= 0.85;
        if (v.fade >= 1) {
          this.scene.remove(v.mesh);
          v.mesh.geometry.dispose();
          mat.dispose();
        if (v.fireRing) { this.scene.remove(v.fireRing); disposeTree(v.fireRing); }
        if (v.fireCore) { this.scene.remove(v.fireCore); disposeTree(v.fireCore); }
          this.zoneVis.delete(id);
        }
        continue;
      }
      const left = z.life - z.age;
      const inK = Math.min(1, z.age / 0.25);
      const outK = Math.min(1, left / 1);
      const baseOp = { fire: 0.7, puddle: 0.62, ice: 0.75, steam: 0.3, mud: 0.8 }[z.kind];
      const flick = z.kind === "fire" ? 0.85 + Math.sin(t * 14 + z.id) * 0.15 : 1;
      mat.opacity = baseOp * inK * outK * flick;
      v.mesh.scale.setScalar(z.r * (0.6 + 0.4 * inK));
      if (v.fireRing) {
        const ringPulse = 0.94 + Math.sin(t * 8 + z.id) * 0.035;
        v.fireRing.scale.set(z.r * ringPulse, z.r * ringPulse, 1);
        (v.fireRing.material as THREE.MeshBasicMaterial).opacity = outK * (0.65 + flick * 0.25);
      }
      if (v.fireCore) {
        v.fireCore.scale.setScalar(z.r * (0.58 + Math.sin(t * 6 + z.id) * 0.018));
        (v.fireCore.material as THREE.MeshBasicMaterial).opacity = outK * 0.55 * flick;
      }
      v.acc += dt;
      const gap = this.low ? 0.07 : 0.035;
      while (v.acc > gap) {
        v.acc -= gap;
        const a = Math.random() * Math.PI * 2;
        const d = Math.sqrt(Math.random()) * z.r * 0.9;
        const x = z.x + Math.cos(a) * d;
        const zz = z.z + Math.sin(a) * d;
        if (z.kind === "fire") P.emit(x, 0.1, zz, (Math.random() - 0.5) * 0.55, 1.1 + Math.random() * 1.6, (Math.random() - 0.5) * 0.55, Math.random() < 0.42 ? 0xfff0aa : Math.random() < 0.6 ? 0xff9a32 : 0xff4b27, 0.3 + Math.random() * 0.2, 0.9, -0.8, 0.5, 0, 1.4);
        else if (z.kind === "steam") P.emit(x, 0.3, zz, (Math.random() - 0.5) * 0.4, 0.7, (Math.random() - 0.5) * 0.4, 0xdfe3ff, 1.5, 1.8, 0, 0.3, 2.8, 0.22);
        else if (z.kind === "puddle" && Math.random() < 0.08) this.rings.spawn(x, 0.06, zz, z.electrified > 0 ? 0xfff27a : 0x9fd8ff, 0.1, 0.8, 0.8, false, 0.5);
        else if (z.kind === "ice" && Math.random() < 0.12) P.emit(x, 0.2, zz, 0, 0.5, 0, 0xe8fbff, 0.14, 1, 0, 0.5, 0, 1.5);
        else if (z.kind === "mud" && Math.random() < 0.1) P.emit(x, 0.1, zz, 0, 1.2, 0, 0x8a6a3a, 0.22, 0.6, 5, 0.5, 0, 0.9);
        if (z.electrified > 0 && Math.random() < 0.5) {
          P.emit(x, 0.15 + Math.random() * 0.8, zz, (Math.random() - 0.5) * 5, Math.random() * 3, (Math.random() - 0.5) * 5, 0xfff27a, 0.18, 0.18, 0, 2, 0, 2);
        }
      }
    }

    // ---- slashes
    for (let i = this.slashes.length - 1; i >= 0; i--) {
      const s = this.slashes[i];
      s.age += dt;
      const k = s.age / 0.34;
      s.mat.uniforms.uSweep.value = Math.min(1.5, k * 2.4);
      s.mat.uniforms.uAlpha.value = 1 - Math.max(0, (k - 0.55) / 0.45);
      s.rimMat.uniforms.uSweep.value = s.mat.uniforms.uSweep.value;
      s.rimMat.uniforms.uAlpha.value = (1 - Math.max(0, (k - 0.4) / 0.6)) * 0.58;
      s.group.scale.setScalar(1 + k * 0.1);
      if (k >= 1) {
        this.scene.remove(s.group);
        s.geo.dispose();
        s.mat.dispose();
        s.rimMat.dispose();
        this.slashes.splice(i, 1);
      }
    }

    // ---- enemy mage
    const mg = this.mage;
    mg.group.position.set(en.pos.x, 0, en.pos.z);
    mg.group.rotation.y = en.yaw;
    const er = rgt(en.yaw);
    const spd = Math.hypot(en.vel.x, en.vel.z);
    const attuneOn = en.attuneT > 0 && en.attune.length > 0;
    const edef = en.cast ? en.loadout[en.cast.slot] : null;
    const auraCol = edef ? edef.colors[0] : attuneOn ? (en.attune[0] === "fire" ? 0xff6a2b : en.attune[0] === "water" ? 0x38a8ff : en.attune[0] === "wind" ? 0xc4f6ff : 0x98d95a) : 0xffd27a;
    mg.update(dt, {
      speed01: Math.min(1, spd / 7),
      charging: !!en.cast,
      charge01: en.cast ? Math.min(1, en.cast.charge / 3) : 0,
      flash: en.hitFlash,
      dead: !en.alive,
      auraColor: auraCol,
      auraOn: attuneOn ? 1 : 0,
      stunned: !!en.status.stun || !!en.status.freeze,
      t,
      strafe: (en.vel.x * er.x + en.vel.z * er.z) / 7,
    });
    this.statusFx(en, dt);
    this.statusFx(pl, dt * 0.5);
    // enemy charge particles
    if (en.cast && Math.random() < 0.8 && edef) {
      this.mage.orbObject.getWorldPosition(this.tmpV);
      const a = Math.random() * Math.PI * 2;
      const rr = 0.7;
      P.emit(this.tmpV.x + Math.cos(a) * rr, this.tmpV.y + (Math.random() - 0.5) * rr, this.tmpV.z + Math.sin(a) * rr, -Math.cos(a) * 3, 0, -Math.sin(a) * 3, edef.colors[Math.random() < 0.5 ? 0 : 1], 0.16, 0.25, 0, 0, 0, 1.4);
    }

    // ---- first-person rig
    const cast = pl.cast;
    const ch = cast ? Math.min(1, cast.charge / 3) : 0;
    this.rig.update(dt, {
      charge01: ch,
      charging: !!cast,
      speed01: Math.min(1, Math.hypot(pl.vel.x, pl.vel.z) / 7.6),
      dash: pl.dashT > 0 ? pl.dashT / DASH_TIME : 0,
      yawVel: this.yawVel,
      pitchVel: this.pitchVel,
      stunned: !!pl.status.stun || !!pl.status.freeze,
      t,
    });
    if (cast) {
      const d = pl.loadout[cast.slot];
      sfx.chargeUpdate(ch);
      this.rig.orbWorld(this.tmpV);
      const n = 1 + Math.floor(ch * 2.5);
      for (let i = 0; i < n; i++) {
        const u = Math.random() * 2 - 1;
        const th = Math.random() * Math.PI * 2;
        const s = Math.sqrt(1 - u * u);
        const rr = 0.45 + Math.random() * 0.3;
        P.emit(this.tmpV.x + s * Math.cos(th) * rr, this.tmpV.y + u * rr, this.tmpV.z + s * Math.sin(th) * rr, -s * Math.cos(th) * rr * 4, -u * rr * 4, -s * Math.sin(th) * rr * 4, d.colors[Math.random() < 0.5 ? 0 : 1], 0.045 + ch * 0.04, 0.22, 0, 0, 0, 1.6);
      }
      if (ch >= 0.99) {
        this.chargeFullT -= dt;
        if (this.chargeFullT <= 0) {
          this.chargeFullT = 0.45;
          this.rings.spawn(this.tmpV.x, this.tmpV.y, this.tmpV.z, d.colors[0], 0.05, 0.5, 0.35, true, 0.8);
        }
      }
    }
    // low-hp heartbeat sparks (cheap ambient feedback)
    this.sparkAcc += dt;
    void ARENA_R;
    void fwd;
  }

  // ---- teardown ----------------------------------------------------------------
  dispose() {
    this.stopCharge();
    this.input.detach();
    this.arena.dispose();
    for (const v of this.projVis.values()) disposeTree(v.group);
    for (const v of this.wallVis.values()) disposeTree(v.group);
    for (const s of this.slashes) {
      s.geo.dispose();
      s.mat.dispose();
    }
    for (const p of this.popups) p.el.remove();
    this.popups = [];
    this.mage.dispose();
    disposeTree(this.rig.group);
    this.particles.dispose();
    this.rings.dispose();
    this.zoneTexCache?.dispose();
    for (const v of this.zoneVis.values()) {
      v.mesh.geometry.dispose();
      (v.mesh.material as THREE.Material).dispose();
    }
    this.scene.clear();
  }
}
