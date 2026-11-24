// Deterministic-ish combat simulation. Pure logic (no rendering) so that any "InputSource"
// (local player, AI, or a future network peer) can drive a Combatant through an Intent.
import * as THREE from "three";
import {
  ADV_MULT,
  DIS_MULT,
  MAX_CHARGE,
  ZONE_INFO,
  matchup,
  type ElementId,
  type SpellDef,
  type StatusId,
  type ZoneKind,
} from "./elements";

export const ARENA_R = 24;
export const EYE_H = 1.7;
export const PLAYER_R = 0.55;
export const PLAYER_H = 2.0;
export const MANA_REGEN = 9;
export const DASH_COST = 8;
export const DASH_SPEED = 21;
export const DASH_TIME = 0.24;
export const DASH_INVULN = 0.22;
export const WALL_LIFE = 7;
export const MATCH_TIME = 150;

export const OBSTACLES: { x: number; z: number; r: number; h: number }[] = [
  { x: -7, z: -3.5, r: 1.1, h: 6 },
  { x: 7, z: 3.5, r: 1.1, h: 6 },
  { x: 7, z: -3.5, r: 1.1, h: 6 },
  { x: -7, z: 3.5, r: 1.1, h: 6 },
  { x: 0, z: 0, r: 1.4, h: 1.0 },
  { x: -14, z: 0, r: 1.3, h: 1.1 },
  { x: 14, z: 0, r: 1.3, h: 1.1 },
];

export type Side = "player" | "enemy";
export type Result = "win" | "lose" | "draw";
type V3 = THREE.Vector3;

export interface Intent {
  mx: number; // strafe right (-1..1)
  mz: number; // forward (-1..1)
  fire: boolean;
  dash: boolean;
  select: number | null;
}

export interface StatusState {
  time: number;
  power: number;
  src: Side;
}

export interface CastState {
  slot: number;
  charge: number;
  releasing: boolean;
  elapsed: number;
}

export interface Combatant {
  side: Side;
  name: string;
  pos: V3;
  vel: V3;
  kb: V3;
  yaw: number;
  pitch: number;
  hp: number;
  maxHp: number;
  mana: number;
  maxMana: number;
  loadout: SpellDef[];
  cd: number[];
  cdMax: number[];
  selected: number;
  cast: CastState | null;
  gcd: number;
  dashT: number;
  dashDir: V3;
  dashCd: number;
  invuln: number;
  status: Partial<Record<StatusId, StatusState>>;
  freezeImmune: number;
  attune: ElementId[];
  attuneT: number;
  speed: number;
  hitFlash: number;
  alive: boolean;
  slide: number;
  fireHeld: boolean;
  fireAge: number;
  shockT: number;
  burnAcc: number;
  slashAlt: number;
  lastHitAt: number;
}

export interface Projectile {
  id: number;
  owner: Side;
  def: SpellDef;
  pos: V3;
  vel: V3;
  r: number;
  power: number;
  charge: number;
  age: number;
  life: number;
  dead: boolean;
  dodged: boolean;
  reflected: boolean;
}

export interface Wall {
  id: number;
  owner: Side;
  def: SpellDef;
  x: number;
  z: number;
  yaw: number;
  hw: number;
  hd: number;
  h: number;
  hp: number;
  maxHp: number;
  age: number;
  life: number;
  dead: boolean;
  flash: number;
  auraT: number;
  charge: number;
}

export interface Zone {
  id: number;
  kind: ZoneKind;
  x: number;
  z: number;
  r: number;
  age: number;
  life: number;
  owner: Side;
  electrified: number;
  tickT: number;
  power: number;
}

export interface Stats {
  damage: number;
  damageTaken: number;
  hits: number;
  casts: number;
  counters: number;
  dodges: number;
  deflects: number;
  blocks: number;
  env: number;
  maxCombo: number;
}

export type SimEvent =
  | { t: "select"; side: Side }
  | { t: "castStart"; side: Side; slot: number }
  | { t: "cast"; side: Side; def: SpellDef; cf: number; alt: number }
  | { t: "interrupt"; side: Side }
  | { t: "noMana"; side: Side }
  | { t: "hit"; side: Side; amount: number; tag: string; x: number; y: number; z: number; def: SpellDef | null; kind: string }
  | { t: "impact"; x: number; y: number; z: number; def: SpellDef; where: string; r: number; owner: Side; power: number }
  | { t: "slash"; side: Side; def: SpellDef; cf: number; x: number; z: number; fx: number; fz: number; range: number; arc: number; alt: number }
  | { t: "wallSpawn"; wall: Wall }
  | { t: "wallHit"; wall: Wall; amount: number }
  | { t: "wallBreak"; wall: Wall; reason: string }
  | { t: "deflect"; side: Side; x: number; y: number; z: number }
  | { t: "dodge"; side: Side; x: number; y: number; z: number }
  | { t: "dash"; side: Side; dx: number; dz: number }
  | { t: "status"; side: Side; id: StatusId }
  | { t: "zone"; zone: Zone; spawned: boolean }
  | { t: "env"; text: string; x: number; y: number; z: number }
  | { t: "clash"; x: number; y: number; z: number; a: SpellDef; b: SpellDef }
  | { t: "score"; pts: number; label: string }
  | { t: "end"; result: Result };

export const fwd = (yaw: number) => ({ x: -Math.sin(yaw), z: -Math.cos(yaw) });
export const rgt = (yaw: number) => ({ x: Math.cos(yaw), z: -Math.sin(yaw) });
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function emptyStats(): Stats {
  return { damage: 0, damageTaken: 0, hits: 0, casts: 0, counters: 0, dodges: 0, deflects: 0, blocks: 0, env: 0, maxCombo: 0 };
}

export function makeCombatant(side: Side, name: string, loadout: SpellDef[], x: number, z: number, yaw: number, speed: number): Combatant {
  return {
    side,
    name,
    pos: new THREE.Vector3(x, 0, z),
    vel: new THREE.Vector3(),
    kb: new THREE.Vector3(),
    yaw,
    pitch: 0,
    hp: 100,
    maxHp: 100,
    mana: 100,
    maxMana: 100,
    loadout,
    cd: loadout.map(() => 0),
    cdMax: loadout.map(() => 1),
    selected: 0,
    cast: null,
    gcd: 0,
    dashT: 0,
    dashDir: new THREE.Vector3(),
    dashCd: 0,
    invuln: 0,
    status: {},
    freezeImmune: 0,
    attune: [],
    attuneT: 0,
    speed,
    hitFlash: 0,
    alive: true,
    slide: 0,
    fireHeld: false,
    fireAge: 99,
    shockT: 0,
    burnAcc: 0,
    slashAlt: 1,
    lastHitAt: -99,
  };
}

// ---- wall geometry helpers ---------------------------------------------
function wallLocal(w: Wall, x: number, z: number) {
  const dx = x - w.x;
  const dz = z - w.z;
  return { u: dx * Math.cos(w.yaw) - dz * Math.sin(w.yaw), v: dx * Math.sin(w.yaw) + dz * Math.cos(w.yaw) };
}

function segHitsWall(ax: number, az: number, bx: number, bz: number, w: Wall, margin: number): boolean {
  const a = wallLocal(w, ax, az);
  const b = wallLocal(w, bx, bz);
  let t0 = 0;
  let t1 = 1;
  const axes: [number, number, number][] = [
    [a.u, b.u - a.u, w.hw + margin],
    [a.v, b.v - a.v, w.hd + margin],
  ];
  for (const [p, d, h] of axes) {
    if (Math.abs(d) < 1e-9) {
      if (Math.abs(p) > h) return false;
    } else {
      let ta = (-h - p) / d;
      let tb = (h - p) / d;
      if (ta > tb) [ta, tb] = [tb, ta];
      t0 = Math.max(t0, ta);
      t1 = Math.min(t1, tb);
      if (t0 > t1) return false;
    }
  }
  return true;
}

function wallClosest(w: Wall, x: number, z: number) {
  const l = wallLocal(w, x, z);
  const cu = clamp(l.u, -w.hw, w.hw);
  const cv = clamp(l.v, -w.hd, w.hd);
  const d = Math.hypot(l.u - cu, l.v - cv);
  return { d, x: w.x + cu * Math.cos(w.yaw) + cv * Math.sin(w.yaw), z: w.z - cu * Math.sin(w.yaw) + cv * Math.cos(w.yaw) };
}

export function wallDistance(w: Wall, x: number, z: number) {
  return wallClosest(w, x, z).d;
}

export interface SimOptions {
  playerLoadout: SpellDef[];
  enemyLoadout: SpellDef[];
  enemySpeed: number;
  scoreMult: number;
  assist: number;
  enemyName: string;
  playerName?: string;
  timeLimit?: number;
  enemyDmg?: number;
}

export class Sim {
  time = 0;
  timeLimit: number;
  over = false;
  result: Result | null = null;
  timedOut = false;
  postTime = 0;
  player: Combatant;
  enemy: Combatant;
  projectiles: Projectile[] = [];
  walls: Wall[] = [];
  zones: Zone[] = [];
  events: SimEvent[] = [];
  intents: Record<Side, Intent> = {
    player: { mx: 0, mz: 0, fire: false, dash: false, select: null },
    enemy: { mx: 0, mz: 0, fire: false, dash: false, select: null },
  };
  stats: Record<Side, Stats> = { player: emptyStats(), enemy: emptyStats() };
  score = 0;
  scoreMult: number;
  combo = 0;
  comboT = 0;
  bonus = 0;
  assist: number;
  enemyDmg: number;
  private nextId = 1;

  constructor(o: SimOptions) {
    this.timeLimit = o.timeLimit ?? MATCH_TIME;
    this.scoreMult = o.scoreMult;
    this.assist = o.assist;
    this.enemyDmg = o.enemyDmg ?? 1;
    this.player = makeCombatant("player", o.playerName ?? "You", o.playerLoadout, 0, 11, 0, 7.6);
    this.enemy = makeCombatant("enemy", o.enemyName, o.enemyLoadout, 0, -11, Math.PI, o.enemySpeed);
  }

  serialize() { return JSON.stringify(this); }

  applyNetworkSnapshot(serialized: string, mirrored = false) {
    const data = JSON.parse(serialized) as Record<string, unknown>;
    const combatant = (raw: unknown) => {
      const c = raw as Record<string, unknown>;
      const v = (key: string) => { const n = c[key] as { x: number; y: number; z: number }; return new THREE.Vector3(n.x, n.y, n.z); };
      return { ...c, pos: v("pos"), vel: v("vel"), kb: v("kb"), dashDir: v("dashDir"), yaw: Number(c.yaw) + (mirrored ? Math.PI : 0), side: mirrored ? (c.side === "player" ? "enemy" : "player") : c.side };
    };
    const sourcePlayer = data.player as Record<string, unknown>;
    const sourceEnemy = data.enemy as Record<string, unknown>;
    const p = mirrored ? sourceEnemy : sourcePlayer;
    const e = mirrored ? sourcePlayer : sourceEnemy;
    const scalarState = { ...data };
    delete scalarState.player; delete scalarState.enemy;
    Object.assign(this, scalarState);
    Object.assign(this.player, combatant(p));
    Object.assign(this.enemy, combatant(e));
    if (mirrored) {
      for (const c of [this.player, this.enemy]) for (const v of [c.pos, c.vel, c.kb, c.dashDir]) { v.x *= -1; v.z *= -1; }
    }
    if (mirrored) {
      this.projectiles = ((data.projectiles ?? []) as Record<string, unknown>[]).map((p) => ({ ...p, owner: p.owner === "player" ? "enemy" : "player", pos: new THREE.Vector3(-Number((p.pos as Record<string, number>).x), Number((p.pos as Record<string, number>).y), -Number((p.pos as Record<string, number>).z)), vel: new THREE.Vector3(-Number((p.vel as Record<string, number>).x), Number((p.vel as Record<string, number>).y), -Number((p.vel as Record<string, number>).z)) })) as Projectile[];
      this.walls = ((data.walls ?? []) as Wall[]).map((w) => ({ ...w, x: -w.x, z: -w.z, yaw: w.yaw + Math.PI, owner: w.owner === "player" ? "enemy" : "player" }));
      this.zones = ((data.zones ?? []) as Zone[]).map((z) => ({ ...z, x: -z.x, z: -z.z, owner: z.owner === "player" ? "enemy" : "player" }));
      this.stats = { player: data.stats && (data.stats as Record<string, Stats>).enemy, enemy: data.stats && (data.stats as Record<string, Stats>).player } as Record<Side, Stats>;
      this.score = 0;
      if (this.result === "win") this.result = "lose";
      else if (this.result === "lose") this.result = "win";
    } else {
      const vecArray = (key: "projectiles") => ((data[key] ?? []) as Record<string, unknown>[]).map((p) => ({ ...p, pos: new THREE.Vector3((p.pos as Record<string, number>).x, (p.pos as Record<string, number>).y, (p.pos as Record<string, number>).z), vel: new THREE.Vector3((p.vel as Record<string, number>).x, (p.vel as Record<string, number>).y, (p.vel as Record<string, number>).z) }));
      this.projectiles = vecArray("projectiles") as unknown as Projectile[];
      this.walls = data.walls as Wall[];
      this.zones = data.zones as Zone[];
    }
    this.events = [];
  }

  foeOf(c: Combatant) {
    return c.side === "player" ? this.enemy : this.player;
  }
  private owner(side: Side) {
    return side === "player" ? this.player : this.enemy;
  }

  get comboMult() {
    return Math.min(3, 1 + 0.25 * Math.max(0, this.combo - 1));
  }

  look(c: Combatant, dyaw: number, dpitch: number) {
    c.yaw += dyaw;
    c.pitch = clamp(c.pitch + dpitch, -1.1, 1.1);
  }

  step(dt: number) {
    const n = Math.max(1, Math.ceil(dt / (1 / 60)));
    const h = dt / n;
    for (let i = 0; i < n; i++) this.tick(h);
  }

  private addScore(pts: number, label: string) {
    const v = Math.round(pts * this.scoreMult);
    if (v <= 0) return;
    this.score += v;
    this.events.push({ t: "score", pts: v, label });
  }

  private tick(h: number) {
    if (this.over) {
      this.postTime += h;
      for (const c of [this.player, this.enemy]) {
        c.hitFlash = Math.max(0, c.hitFlash - h * 3);
        c.pos.x += c.kb.x * h;
        c.pos.z += c.kb.z * h;
        c.kb.multiplyScalar(Math.exp(-5 * h));
        c.vel.multiplyScalar(0.9);
      }
      this.updateProjectiles(h * 0.5);
      return;
    }
    this.time += h;
    this.comboT -= h;
    if (this.comboT <= 0) this.combo = 0;
    this.updateCombatant(this.player, h);
    this.updateCombatant(this.enemy, h);
    this.updateProjectiles(h);
    this.updateWalls(h);
    this.updateZones(h);
    this.resolveCollisions(this.player);
    this.resolveCollisions(this.enemy);
    this.checkEnd();
  }

  // ---- combatants -------------------------------------------------------
  private speedMult(c: Combatant) {
    let m = 1;
    const wet = c.status.wet;
    const chill = c.status.chill;
    if (chill) m *= 1 - Math.min(0.6, chill.power * (wet ? 1.25 : 1));
    if (c.status.mud) m *= 1 - c.status.mud.power;
    if (wet) m *= 0.93;
    return Math.max(0.3, m);
  }

  private updateCombatant(c: Combatant, h: number) {
    if (!c.alive) return;
    const it = this.intents[c.side];
    for (let i = 0; i < c.cd.length; i++) c.cd[i] = Math.max(0, c.cd[i] - h);
    c.gcd = Math.max(0, c.gcd - h);
    c.dashCd = Math.max(0, c.dashCd - h);
    c.invuln = Math.max(0, c.invuln - h);
    c.hitFlash = Math.max(0, c.hitFlash - h * 4);
    c.freezeImmune = Math.max(0, c.freezeImmune - h);
    c.shockT = Math.max(0, c.shockT - h);
    c.slide = Math.max(0, c.slide - h);
    if (c.attuneT > 0) {
      c.attuneT -= h;
      if (c.attuneT <= 0 && !c.cast) c.attune = [];
    }
    this.tickStatus(c, h);
    const stunned = !!c.status.stun;
    const frozen = !!c.status.freeze;

    if (it.select !== null) {
      if (!c.cast && it.select >= 0 && it.select < c.loadout.length && it.select !== c.selected) {
        c.selected = it.select;
        this.events.push({ t: "select", side: c.side });
      }
      it.select = null;
    }

    this.updateCasting(c, it, h, stunned);

    if (it.dash) {
      it.dash = false;
      this.tryDash(c, it, stunned || frozen);
    }

    let tx = 0;
    let tz = 0;
    if (!stunned && !frozen && c.dashT <= 0) {
      const f = fwd(c.yaw);
      const r = rgt(c.yaw);
      let mx = it.mx;
      let mz = it.mz;
      const len = Math.hypot(mx, mz);
      if (len > 1) {
        mx /= len;
        mz /= len;
      }
      let sp = c.speed * this.speedMult(c);
      if (c.cast) sp *= 0.62;
      tx = (f.x * mz + r.x * mx) * sp;
      tz = (f.z * mz + r.z * mx) * sp;
    }
    if (c.dashT > 0) {
      c.dashT -= h;
      c.vel.set(c.dashDir.x * DASH_SPEED, 0, c.dashDir.z * DASH_SPEED);
    } else {
      const k = Math.min(1, (c.slide > 0 ? 3.2 : 38) * h);
      c.vel.x += (tx - c.vel.x) * k;
      c.vel.z += (tz - c.vel.z) * k;
    }
    c.pos.x += (c.vel.x + c.kb.x) * h;
    c.pos.z += (c.vel.z + c.kb.z) * h;
    c.kb.multiplyScalar(Math.exp(-5.5 * h));

    if (!c.cast) c.mana = Math.min(c.maxMana, c.mana + MANA_REGEN * h);
  }

  private tickStatus(c: Combatant, h: number) {
    for (const id of Object.keys(c.status) as StatusId[]) {
      const st = c.status[id];
      if (!st) continue;
      st.time -= h;
      if (id === "burn") this.dealDot(c, st.power * h * 0.6, st.src);
      if (st.time <= 0) delete c.status[id];
    }
  }

  private dealDot(victim: Combatant, amount: number, src: Side) {
    if (this.over || !victim.alive) return;
    if (src === "enemy") amount *= this.enemyDmg;
    victim.hp = Math.max(0, victim.hp - amount);
    this.stats[src].damage += amount;
    this.stats[victim.side].damageTaken += amount;
    victim.burnAcc += amount;
    if (src === "player" && victim.side === "enemy") this.addScoreQuiet(amount * 5);
    if (victim.burnAcc >= 3) {
      this.events.push({ t: "hit", side: victim.side, amount: victim.burnAcc, tag: "dot", x: victim.pos.x, y: 1.9, z: victim.pos.z, def: null, kind: "dot" });
      victim.burnAcc = 0;
    }
  }

  private pendingQuiet = 0;
  private addScoreQuiet(pts: number) {
    this.pendingQuiet += pts * this.scoreMult;
    if (this.pendingQuiet >= 1) {
      const v = Math.floor(this.pendingQuiet);
      this.score += v;
      this.pendingQuiet -= v;
    }
  }

  private updateCasting(c: Combatant, it: Intent, h: number, stunned: boolean) {
    if (it.fire && !c.fireHeld) c.fireAge = 0;
    if (it.fire) c.fireAge += h;
    c.fireHeld = it.fire;

    if (c.cast) {
      const def = c.loadout[c.cast.slot];
      if (stunned) {
        this.interrupt(c);
        return;
      }
      c.cast.elapsed += h;
      if (it.fire && !c.cast.releasing) {
        if (c.cast.charge < MAX_CHARGE) {
          const drain = (def.manaCost / MAX_CHARGE) * h;
          if (c.mana >= drain) {
            c.mana -= drain;
            c.cast.charge = Math.min(MAX_CHARGE, c.cast.charge + h);
          } else c.cast.releasing = true;
        }
      } else {
        c.cast.releasing = true;
        if (c.cast.charge < def.castTime) c.cast.charge += h;
      }
      if (c.cast.releasing && c.cast.charge >= def.castTime) this.resolveCast(c);
      return;
    }
    if (it.fire && c.fireAge < 0.35 && !stunned && c.gcd <= 0) {
      const def = c.loadout[c.selected];
      if (c.cd[c.selected] <= 0) {
        if (c.mana >= def.manaCost) {
          c.mana -= def.manaCost;
          c.cast = { slot: c.selected, charge: 0, releasing: false, elapsed: 0 };
          c.attune = [...def.elements];
          c.attuneT = 6;
          this.events.push({ t: "castStart", side: c.side, slot: c.selected });
        } else if (c.fireAge <= h * 1.5) {
          this.events.push({ t: "noMana", side: c.side });
        }
      }
    }
  }

  interrupt(c: Combatant) {
    if (!c.cast) return;
    const slot = c.cast.slot;
    c.cd[slot] = Math.max(c.cd[slot], c.loadout[slot].cooldown * 0.5);
    c.cdMax[slot] = c.cd[slot];
    c.cast = null;
    c.gcd = 0.3;
    this.events.push({ t: "interrupt", side: c.side });
  }

  private tryDash(c: Combatant, it: Intent, blocked: boolean) {
    if (blocked || c.dashCd > 0 || c.mana < DASH_COST || c.dashT > 0) return;
    c.mana -= DASH_COST;
    c.dashCd = 1.4;
    c.dashT = DASH_TIME;
    c.invuln = DASH_INVULN;
    let mx = it.mx;
    let mz = it.mz;
    if (Math.hypot(mx, mz) < 0.15) {
      mx = 0;
      mz = -1;
    }
    const f = fwd(c.yaw);
    const r = rgt(c.yaw);
    let dx = f.x * mz + r.x * mx;
    let dz = f.z * mz + r.z * mx;
    const l = Math.hypot(dx, dz) || 1;
    dx /= l;
    dz /= l;
    c.dashDir.set(dx, 0, dz);
    c.kb.multiplyScalar(0.3);
    this.events.push({ t: "dash", side: c.side, dx, dz });
  }

  private aimDir(c: Combatant, def: SpellDef): V3 {
    const cp = Math.cos(c.pitch);
    const d = new THREE.Vector3(-Math.sin(c.yaw) * cp, Math.sin(c.pitch), -Math.cos(c.yaw) * cp);
    if (c.side === "player" && this.assist > 0 && def.type !== "wall" && this.enemy.alive) {
      const foe = this.enemy;
      const origin = new THREE.Vector3(c.pos.x, EYE_H, c.pos.z);
      const dist = origin.distanceTo(foe.pos);
      const tLead = def.type === "ball" ? dist / Math.max(8, def.speed) : 0;
      const target = new THREE.Vector3(foe.pos.x + foe.vel.x * tLead * 0.55, 1.15, foe.pos.z + foe.vel.z * tLead * 0.55);
      const to = target.sub(origin).normalize();
      const ang = Math.acos(clamp(d.dot(to), -1, 1));
      const maxAng = 0.12 + 0.14 * this.assist;
      if (ang < maxAng) {
        const k = (0.5 + 0.4 * this.assist) * (1 - (ang / maxAng) * 0.4);
        d.lerp(to, k).normalize();
      }
    }
    return d;
  }

  private resolveCast(c: Combatant) {
    if (!c.cast) return;
    const slot = c.cast.slot;
    const def = c.loadout[slot];
    const cf = clamp((c.cast.charge - 0.2) / (MAX_CHARGE - 0.2), 0, 1);
    c.cd[slot] = def.cooldown;
    c.cdMax[slot] = def.cooldown;
    c.gcd = 0.28;
    c.cast = null;
    c.attune = [...def.elements];
    c.attuneT = 6;
    this.stats[c.side].casts++;
    const dir = this.aimDir(c, def);
    c.slashAlt = -c.slashAlt;
    this.events.push({ t: "cast", side: c.side, def, cf, alt: c.slashAlt });
    if (def.type === "ball") this.spawnBall(c, def, cf, dir);
    else if (def.type === "slash") this.doSlash(c, def, cf, dir);
    else this.spawnWall(c, def, cf, dir);
  }

  private spawnBall(c: Combatant, def: SpellDef, cf: number, dir: V3) {
    const f = fwd(c.yaw);
    const r = rgt(c.yaw);
    const origin = new THREE.Vector3(c.pos.x + f.x * 0.7 + r.x * 0.28, 1.45, c.pos.z + f.z * 0.7 + r.z * 0.28);
    const eye = new THREE.Vector3(c.pos.x, c.side === "player" ? EYE_H : 1.5, c.pos.z);
    const target = eye.clone().addScaledVector(dir, 40);
    const v = target.sub(origin).normalize().multiplyScalar(def.speed * (1 - 0.1 * cf));
    this.projectiles.push({
      id: this.nextId++,
      owner: c.side,
      def,
      pos: origin,
      vel: v,
      r: def.radius * (1 + 0.5 * cf),
      power: def.damage * (1 + cf),
      charge: cf,
      age: 0,
      life: def.life,
      dead: false,
      dodged: false,
      reflected: false,
    });
  }

  private doSlash(c: Combatant, def: SpellDef, cf: number, dir: V3) {
    let fx = dir.x;
    let fz = dir.z;
    const fl = Math.hypot(fx, fz);
    if (fl < 0.05) {
      const f = fwd(c.yaw);
      fx = f.x;
      fz = f.z;
    } else {
      fx /= fl;
      fz /= fl;
    }
    const range = def.range * (1 + 0.35 * cf);
    const arc = ((def.arc * Math.PI) / 180) * (1 + 0.25 * cf);
    const power = def.damage * (1 + cf);
    c.kb.x += fx * 7;
    c.kb.z += fz * 7;
    this.events.push({ t: "slash", side: c.side, def, cf, x: c.pos.x, z: c.pos.z, fx, fz, range, arc, alt: c.slashAlt });
    const inArc = (dx: number, dz: number, extra: number) => {
      const l = Math.hypot(dx, dz);
      if (l < 0.01) return true;
      const ang = Math.acos(clamp((dx * fx + dz * fz) / l, -1, 1));
      return ang <= arc / 2 + extra;
    };
    for (const w of this.walls) {
      if (w.dead) continue;
      const cl = wallClosest(w, c.pos.x, c.pos.z);
      if (cl.d <= range && inArc(cl.x - c.pos.x, cl.z - c.pos.z, 0.15)) {
        this.damageWall(w, power * 1.4 * this.wallMult(def, w), c.side, "slash");
      }
    }
    const foe = this.foeOf(c);
    if (foe.alive) {
      const dx = foe.pos.x - c.pos.x;
      const dz = foe.pos.z - c.pos.z;
      const dist = Math.hypot(dx, dz);
      if (dist <= range + PLAYER_R && inArc(dx, dz, Math.atan2(PLAYER_R, Math.max(dist, 0.1))) && !this.segBlocked(c.pos, foe.pos)) {
        if (foe.invuln > 0) this.registerDodge(foe);
        else this.applyHit(c, foe, power, def, cf, "slash", new THREE.Vector3(foe.pos.x, 1.2, foe.pos.z), c.pos);
      }
    }
    for (const p of this.projectiles) {
      if (p.dead || p.owner === c.side) continue;
      const dx = p.pos.x - c.pos.x;
      const dz = p.pos.z - c.pos.z;
      if (Math.hypot(dx, dz) <= range + p.r && inArc(dx, dz, 0.2)) {
        if (power >= p.power * 0.75) {
          p.owner = c.side;
          p.reflected = true;
          p.age = 0;
          const tgt = foe.alive ? new THREE.Vector3(foe.pos.x, 1.2, foe.pos.z) : p.pos.clone().add(new THREE.Vector3(fx, 0, fz).multiplyScalar(10));
          p.vel = tgt.sub(p.pos).normalize().multiplyScalar(p.vel.length() * 1.2);
          p.power *= 1.15;
          this.stats[c.side].deflects++;
          if (c.side === "player") this.addScore(80, "DEFLECT!");
          this.events.push({ t: "deflect", side: c.side, x: p.pos.x, y: p.pos.y, z: p.pos.z });
        } else {
          p.dead = true;
          this.events.push({ t: "impact", x: p.pos.x, y: p.pos.y, z: p.pos.z, def: p.def, where: "clash", r: p.r, owner: p.owner, power: p.power });
          if (c.side === "player") this.addScore(30, "SLASHED!");
        }
      }
    }
    this.envImpact(def, new THREE.Vector3(c.pos.x + fx * range * 0.65, 0.5, c.pos.z + fz * range * 0.65), 0.6 + 0.3 * cf, c.side);
  }

  private spawnWall(c: Combatant, def: SpellDef, cf: number, dir: V3) {
    let fx = dir.x;
    let fz = dir.z;
    const fl = Math.hypot(fx, fz);
    if (fl < 0.05) {
      const f = fwd(c.yaw);
      fx = f.x;
      fz = f.z;
    } else {
      fx /= fl;
      fz /= fl;
    }
    let x = c.pos.x + fx * 4.2;
    let z = c.pos.z + fz * 4.2;
    const d = Math.hypot(x, z);
    if (d > ARENA_R - 2.5) {
      x *= (ARENA_R - 2.5) / d;
      z *= (ARENA_R - 2.5) / d;
    }
    const mine = this.walls.filter((w) => w.owner === c.side && !w.dead);
    if (mine.length >= 2) {
      const old = mine[0];
      old.dead = true;
      this.events.push({ t: "wallBreak", wall: old, reason: "replaced" });
    }
    const hp = def.wallHp * (1 + cf);
    const wall: Wall = {
      id: this.nextId++,
      owner: c.side,
      def,
      x,
      z,
      yaw: Math.atan2(-fx, -fz),
      hw: (def.wallWidth / 2) * (1 + 0.35 * cf),
      hd: 0.45,
      h: 3.2,
      hp,
      maxHp: hp,
      age: 0,
      life: WALL_LIFE,
      dead: false,
      flash: 0,
      auraT: 0.3,
      charge: cf,
    };
    this.walls.push(wall);
    this.events.push({ t: "wallSpawn", wall });
  }

  private wallMult(def: SpellDef, w: Wall) {
    const rel = matchup(def.elements, w.def.elements);
    return rel > 0 ? ADV_MULT : rel < 0 ? DIS_MULT : 1;
  }

  private damageWall(w: Wall, amount: number, src: Side, kind: string) {
    if (w.dead) return;
    w.hp -= amount;
    w.flash = 1;
    this.events.push({ t: "wallHit", wall: w, amount });
    if (kind === "proj" && src !== w.owner) {
      this.stats[w.owner].blocks++;
      if (w.owner === "player") this.addScore(25, "BLOCKED");
    }
    if (w.hp <= 0) {
      w.dead = true;
      this.events.push({ t: "wallBreak", wall: w, reason: "hp" });
    }
  }

  segBlocked(a: V3, b: V3): boolean {
    for (const w of this.walls) if (!w.dead && segHitsWall(a.x, a.z, b.x, b.z, w, 0)) return true;
    return false;
  }

  private registerDodge(c: Combatant) {
    this.stats[c.side].dodges++;
    if (c.side === "player") this.addScore(30, "DODGE");
    this.events.push({ t: "dodge", side: c.side, x: c.pos.x, y: 1.2, z: c.pos.z });
  }

  // ---- damage -----------------------------------------------------------
  private applyHit(src: Combatant, victim: Combatant, rawPower: number, def: SpellDef, cf: number, kind: string, pos: V3, from: V3) {
    if (this.over || !victim.alive) return;
    const side = src.side;
    let mult = 1;
    let tag = "";
    const rel = matchup(def.elements, victim.attune);
    if (rel > 0) {
      mult *= ADV_MULT;
      tag = "adv";
    } else if (rel < 0) {
      mult *= DIS_MULT;
      tag = "res";
    }
    const hasEl = (e: ElementId) => def.elements.includes(e);
    if (def.combo === "fire+wind" && victim.status.wet) {
      mult *= 1.35;
      tag = "conduct";
      this.applyStatus(victim, "stun", 0.6, 1, side);
      delete victim.status.wet;
      this.events.push({ t: "env", text: "CONDUCTED!", x: victim.pos.x, y: 2.2, z: victim.pos.z });
      if (side === "player") {
        this.stats.player.env++;
        this.addScore(50, "CONDUCTED!");
      }
    }
    if (victim.status.freeze && hasEl("fire")) {
      mult *= 1.25;
      tag = "shatter";
      delete victim.status.freeze;
      victim.freezeImmune = 3;
      this.events.push({ t: "env", text: "SHATTERED!", x: victim.pos.x, y: 2.2, z: victim.pos.z });
      if (side === "player") {
        this.stats.player.env++;
        this.addScore(50, "SHATTER!");
      }
    }
    if (kind === "splash") mult *= 0.5;
    const dmg = rawPower * mult * (side === "enemy" ? this.enemyDmg : 1);
    victim.hp = Math.max(0, victim.hp - dmg);
    victim.hitFlash = 1;
    victim.lastHitAt = this.time;
    this.stats[side].damage += dmg;
    this.stats[side].hits++;
    this.stats[victim.side].damageTaken += dmg;
    if (rel > 0 && kind !== "splash") {
      this.stats[side].counters++;
      if (side === "player") this.addScore(40, "COUNTER +20%");
    }
    if (hasEl("water") && victim.status.burn) {
      delete victim.status.burn;
      this.events.push({ t: "env", text: "DOUSED!", x: victim.pos.x, y: 2.2, z: victim.pos.z });
    }
    if (kind !== "splash") this.interrupt(victim);
    for (const e of def.effects) {
      if (kind === "splash" && e.id !== "burn" && e.id !== "wet") continue;
      if (Math.random() < e.chance) this.applyStatus(victim, e.id, e.duration * (1 + 0.4 * cf), e.power * (1 + 0.3 * cf), side);
    }
    if (def.knock > 0 && kind !== "splash") {
      let kx = victim.pos.x - from.x;
      let kz = victim.pos.z - from.z;
      const l = Math.hypot(kx, kz) || 1;
      kx /= l;
      kz /= l;
      const f = def.knock * (1 + 0.5 * cf) * 1.7;
      victim.kb.x += kx * f;
      victim.kb.z += kz * f;
    }
    this.events.push({ t: "hit", side: victim.side, amount: dmg, tag, x: pos.x, y: pos.y, z: pos.z, def, kind });
    if (side === "player") {
      this.comboT = 3.5;
      this.combo++;
      this.stats.player.maxCombo = Math.max(this.stats.player.maxCombo, this.combo);
      this.addScore(dmg * 10 * this.comboMult, this.combo > 1 ? `x${this.comboMult.toFixed(2)}` : "HIT");
    } else {
      this.combo = 0;
      this.comboT = 0;
    }
  }

  private directDamage(victim: Combatant, amount: number, src: Side, label: string) {
    if (this.over || !victim.alive) return;
    if (src === "enemy") amount *= this.enemyDmg;
    victim.hp = Math.max(0, victim.hp - amount);
    victim.hitFlash = 1;
    this.stats[src].damage += amount;
    this.stats[victim.side].damageTaken += amount;
    this.events.push({ t: "hit", side: victim.side, amount, tag: "conduct", x: victim.pos.x, y: 1.6, z: victim.pos.z, def: null, kind: "zone" });
    this.events.push({ t: "env", text: label, x: victim.pos.x, y: 2.3, z: victim.pos.z });
    if (src === "player" && victim.side === "enemy") {
      this.stats.player.env++;
      this.addScore(amount * 10 + 50, label);
    }
  }

  applyStatus(c: Combatant, id: StatusId, dur: number, power: number, src: Side) {
    if (id === "freeze") {
      if (c.freezeImmune > 0 || c.status.freeze) return;
      c.freezeImmune = dur + 3.5;
    }
    if (id === "burn" && c.status.wet) return;
    if (id === "wet" && c.status.burn) {
      delete c.status.burn;
      this.events.push({ t: "env", text: "DOUSED!", x: c.pos.x, y: 2.2, z: c.pos.z });
    }
    const ex = c.status[id];
    if (ex) {
      ex.time = Math.max(ex.time, dur);
      ex.power = Math.max(ex.power, power);
      ex.src = src;
    } else {
      c.status[id] = { time: dur, power, src };
      this.events.push({ t: "status", side: c.side, id });
    }
    if (id === "stun" || id === "freeze") this.interrupt(c);
  }

  // ---- projectiles --------------------------------------------------------
  private updateProjectiles(h: number) {
    const list = this.projectiles;
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      if (p.dead) continue;
      p.age += h;
      if (p.age > p.life) {
        this.impact(p, "expire", false);
        continue;
      }
      const px = p.pos.x;
      const pz = p.pos.z;
      p.pos.addScaledVector(p.vel, h);
      if (Math.hypot(p.pos.x, p.pos.z) > ARENA_R + 8 || p.pos.y > 40) {
        p.dead = true;
        continue;
      }
      if (p.pos.y < 0.15) {
        this.impact(p, "ground", false);
        continue;
      }
      for (const o of OBSTACLES) {
        const dx = p.pos.x - o.x;
        const dz = p.pos.z - o.z;
        if (p.pos.y < o.h && dx * dx + dz * dz < (o.r + p.r) * (o.r + p.r)) {
          this.impact(p, "pillar", false);
          break;
        }
      }
      if (p.dead) continue;
      for (const w of this.walls) {
        if (!w.dead && p.pos.y < w.h && segHitsWall(px, pz, p.pos.x, p.pos.z, w, p.r)) {
          this.damageWall(w, p.power * this.wallMult(p.def, w), p.owner, "proj");
          this.impact(p, "wall", true);
          break;
        }
      }
      if (p.dead) continue;
      const target = p.owner === "player" ? this.enemy : this.player;
      if (target.alive && p.pos.y < PLAYER_H + 0.2) {
        const dx = p.pos.x - target.pos.x;
        const dz = p.pos.z - target.pos.z;
        const rr = PLAYER_R + p.r * 0.85;
        if (dx * dx + dz * dz < rr * rr) {
          if (target.invuln > 0) {
            if (!p.dodged) {
              p.dodged = true;
              this.registerDodge(target);
            }
          } else {
            this.applyHit(this.owner(p.owner), target, p.power, p.def, p.charge, "proj", p.pos.clone(), p.pos.clone().sub(p.vel.clone().setLength(1)));
            this.impact(p, "player", true);
            continue;
          }
        }
      }
      for (let j = 0; j < list.length; j++) {
        const q = list[j];
        if (q.id <= p.id || q.dead || q.owner === p.owner) continue;
        if (p.pos.distanceToSquared(q.pos) < (p.r + q.r + 0.1) * (p.r + q.r + 0.1)) {
          this.clash(p, q);
          if (p.dead) break;
        }
      }
    }
    if (list.length > 0 && list.some((p) => p.dead)) this.projectiles = list.filter((p) => !p.dead);
  }

  private impact(p: Projectile, where: string, direct: boolean) {
    p.dead = true;
    this.events.push({ t: "impact", x: p.pos.x, y: p.pos.y, z: p.pos.z, def: p.def, where, r: p.r, owner: p.owner, power: p.power });
    const target = p.owner === "player" ? this.enemy : this.player;
    if (!direct && where !== "expire" && target.alive && target.invuln <= 0) {
      const dx = p.pos.x - target.pos.x;
      const dz = p.pos.z - target.pos.z;
      if (Math.hypot(dx, dz) < 1.4 + p.r && p.pos.y < PLAYER_H) {
        this.applyHit(this.owner(p.owner), target, p.power, p.def, p.charge, "splash", new THREE.Vector3(target.pos.x, 1.3, target.pos.z), p.pos);
      }
    }
    if (where !== "expire") {
      const ex = where === "player" ? target.pos.x : p.pos.x;
      const ez = where === "player" ? target.pos.z : p.pos.z;
      this.envImpact(p.def, new THREE.Vector3(ex, 0.3, ez), 0.8 + 0.6 * p.charge, p.owner);
    }
  }

  private clash(p: Projectile, q: Projectile) {
    const rel = matchup(p.def.elements, q.def.elements);
    this.events.push({ t: "clash", x: (p.pos.x + q.pos.x) / 2, y: (p.pos.y + q.pos.y) / 2, z: (p.pos.z + q.pos.z) / 2, a: p.def, b: q.def });
    if (rel > 0) {
      q.dead = true;
      p.power -= q.power * 0.5;
    } else if (rel < 0) {
      p.dead = true;
      q.power -= p.power * 0.5;
    } else {
      const d = p.power - q.power;
      if (Math.abs(d) < 2) {
        p.dead = true;
        q.dead = true;
      } else if (d > 0) {
        q.dead = true;
        p.power = d;
      } else {
        p.dead = true;
        q.power = -d;
      }
    }
    if (p.power < 3) p.dead = true;
    if (q.power < 3) q.dead = true;
    const mine = p.owner === "player" ? p : q;
    if (!mine.dead) this.addScore(20, "CLASH WON");
    const fw = (p.def.elements.includes("fire") && q.def.elements.includes("water")) || (p.def.elements.includes("water") && q.def.elements.includes("fire"));
    if (fw) {
      this.spawnZone("steam", (p.pos.x + q.pos.x) / 2, (p.pos.z + q.pos.z) / 2, 2.2, p.owner, 1);
      this.events.push({ t: "env", text: "STEAM!", x: p.pos.x, y: p.pos.y + 0.6, z: p.pos.z });
    }
  }

  // ---- walls / zones ------------------------------------------------------
  private updateWalls(h: number) {
    for (const w of this.walls) {
      if (w.dead) continue;
      w.age += h;
      w.flash = Math.max(0, w.flash - h * 4);
      if (w.age >= w.life) {
        w.dead = true;
        this.events.push({ t: "wallBreak", wall: w, reason: "timeout" });
        continue;
      }
      w.auraT -= h;
      if (w.auraT <= 0) {
        w.auraT = 0.3;
        const heat = w.def.temp / 100;
        const foe = w.owner === "player" ? this.enemy : this.player;
        if (foe.alive && (heat >= 0.4 || heat <= -0.4) && wallDistance(w, foe.pos.x, foe.pos.z) < 1.9) {
          if (heat >= 0.4) this.applyStatus(foe, "burn", 1.2, 2.5 + 3 * heat, w.owner);
          else this.applyStatus(foe, "chill", 1.4, 0.2 + 0.2 * Math.abs(heat), w.owner);
        }
      }
    }
    if (this.walls.some((w) => w.dead)) this.walls = this.walls.filter((w) => !w.dead);
  }

  spawnZone(kind: ZoneKind, x: number, z: number, r: number, owner: Side, power: number) {
    const ex = this.zones.find((zn) => zn.kind === kind && Math.hypot(zn.x - x, zn.z - z) < 1.4);
    if (ex) {
      ex.age = Math.min(ex.age, ex.life * 0.3);
      ex.r = Math.max(ex.r, r);
      return ex;
    }
    if (this.zones.length >= 14) {
      const old = this.zones.shift();
      if (old) this.events.push({ t: "zone", zone: old, spawned: false });
    }
    const zone: Zone = { id: this.nextId++, kind, x, z, r, age: 0, life: ZONE_INFO[kind].life, owner, electrified: 0, tickT: 0.1, power };
    this.zones.push(zone);
    this.events.push({ t: "zone", zone, spawned: true });
    return zone;
  }

  private removeZone(z: Zone) {
    this.zones = this.zones.filter((q) => q !== z);
    this.events.push({ t: "zone", zone: z, spawned: false });
  }

  private envImpact(def: SpellDef, pos: V3, scale: number, owner: Side) {
    const els = def.elements;
    const has = (e: ElementId) => els.includes(e);
    const heat = def.temp / 100;
    const hot = has("fire") && heat > -0.45;
    const lightning = def.combo === "fire+wind";
    let steamed = false;
    const say = (text: string, x: number, z: number) => {
      this.events.push({ t: "env", text, x, y: 1.4, z });
      if (owner === "player") {
        this.stats.player.env++;
        this.addScore(40, text);
      }
    };
    for (const z of [...this.zones]) {
      const d = Math.hypot(z.x - pos.x, z.z - pos.z);
      if (d > z.r + 1.6) continue;
      if (lightning && z.kind === "puddle") {
        z.electrified = 2.6;
        say("CONDUCTED!", z.x, z.z);
      } else if (hot && z.kind === "puddle") {
        this.removeZone(z);
        this.spawnZone("steam", z.x, z.z, z.r, owner, 1);
        steamed = true;
        say("STEAM BURST!", z.x, z.z);
      } else if (hot && z.kind === "ice") {
        this.removeZone(z);
        this.spawnZone("puddle", z.x, z.z, z.r, owner, 1);
        say("MELTED!", z.x, z.z);
      } else if (has("water") && z.kind === "fire") {
        this.removeZone(z);
        this.spawnZone("steam", z.x, z.z, z.r * 0.8, owner, 1);
        steamed = true;
        say("EXTINGUISHED!", z.x, z.z);
      } else if (has("wind") && z.kind === "steam") {
        this.removeZone(z);
        say("STEAM BLOWN AWAY", z.x, z.z);
      } else if (has("wind") && z.kind === "fire") {
        z.r = Math.min(z.r * 1.35, 5.5);
        z.life += 2;
        z.power *= 1.25;
        say("FLAMES FANNED!", z.x, z.z);
      }
    }
    if (def.zone && !(steamed && def.zone === "fire")) {
      const base = def.zone === "steam" ? 2.7 : 2.1;
      this.spawnZone(def.zone, pos.x, pos.z, base * scale, owner, 1 + Math.max(0, heat) * 0.5);
    }
  }

  private updateZones(h: number) {
    let removed = false;
    for (const z of this.zones) {
      z.age += h;
      z.electrified = Math.max(0, z.electrified - h);
      z.tickT -= h;
      if (z.age >= z.life) {
        this.events.push({ t: "zone", zone: z, spawned: false });
        removed = true;
        continue;
      }
      if (z.tickT <= 0) {
        z.tickT = 0.25;
        for (const c of [this.player, this.enemy]) {
          if (!c.alive) continue;
          if (Math.hypot(c.pos.x - z.x, c.pos.z - z.z) < z.r) this.zoneEffect(z, c);
        }
      }
    }
    if (removed) this.zones = this.zones.filter((z) => z.age < z.life);
  }

  private zoneEffect(z: Zone, c: Combatant) {
    switch (z.kind) {
      case "fire":
        this.applyStatus(c, "burn", 2, 3 * z.power, z.owner);
        break;
      case "puddle":
        this.applyStatus(c, "wet", 5, 1, z.owner);
        if (z.electrified > 0 && c.shockT <= 0) {
          c.shockT = 1.3;
          this.directDamage(c, 5, z.owner, "SHOCKED!");
          this.applyStatus(c, "stun", 0.55, 1, z.owner);
        }
        break;
      case "ice":
        c.slide = 0.45;
        this.applyStatus(c, "chill", 1.2, 0.2, z.owner);
        break;
      case "steam":
        this.applyStatus(c, "blind", 0.7, 1, z.owner);
        this.dealDot(c, 0.5, z.owner);
        break;
      case "mud":
        this.applyStatus(c, "mud", 0.8, 0.42, z.owner);
        break;
    }
  }

  // ---- collisions -----------------------------------------------------------
  private resolveCollisions(c: Combatant) {
    if (!c.alive) return;
    for (const o of OBSTACLES) {
      let dx = c.pos.x - o.x;
      let dz = c.pos.z - o.z;
      let d = Math.hypot(dx, dz);
      const min = o.r + PLAYER_R;
      if (d < min) {
        if (d < 1e-4) {
          dx = 1;
          dz = 0;
          d = 1;
        }
        const push = min - d;
        c.pos.x += (dx / d) * push;
        c.pos.z += (dz / d) * push;
        c.kb.multiplyScalar(0.7);
      }
    }
    for (const w of this.walls) {
      if (w.dead) continue;
      const l = wallLocal(w, c.pos.x, c.pos.z);
      const cu = clamp(l.u, -w.hw, w.hw);
      const cv = clamp(l.v, -w.hd, w.hd);
      let pu = 0;
      let pv = 0;
      const du = l.u - cu;
      const dv = l.v - cv;
      const d = Math.hypot(du, dv);
      if (d > 1e-5) {
        if (d < PLAYER_R) {
          pu = (du / d) * (PLAYER_R - d);
          pv = (dv / d) * (PLAYER_R - d);
        }
      } else {
        const penU = w.hw + PLAYER_R - Math.abs(l.u);
        const penV = w.hd + PLAYER_R - Math.abs(l.v);
        if (penV <= penU) pv = (l.v >= 0 ? 1 : -1) * penV;
        else pu = (l.u >= 0 ? 1 : -1) * penU;
      }
      if (pu !== 0 || pv !== 0) {
        c.pos.x += pu * Math.cos(w.yaw) + pv * Math.sin(w.yaw);
        c.pos.z += -pu * Math.sin(w.yaw) + pv * Math.cos(w.yaw);
        c.kb.multiplyScalar(0.7);
      }
    }
    const foe = this.foeOf(c);
    if (foe.alive) {
      const dx = c.pos.x - foe.pos.x;
      const dz = c.pos.z - foe.pos.z;
      const d = Math.hypot(dx, dz);
      const min = PLAYER_R * 2;
      if (d < min && d > 1e-4) {
        const push = (min - d) / 2;
        c.pos.x += (dx / d) * push;
        c.pos.z += (dz / d) * push;
      }
    }
    const d = Math.hypot(c.pos.x, c.pos.z);
    const lim = ARENA_R - PLAYER_R;
    if (d > lim) {
      c.pos.x *= lim / d;
      c.pos.z *= lim / d;
    }
  }

  // ---- end of match -----------------------------------------------------------
  private checkEnd() {
    const p = this.player;
    const e = this.enemy;
    if (p.hp <= 0 || e.hp <= 0) {
      this.end(p.hp <= 0 && e.hp <= 0 ? "draw" : e.hp <= 0 ? "win" : "lose");
    } else if (this.time >= this.timeLimit) {
      this.timedOut = true;
      const diff = p.hp - e.hp;
      this.end(Math.abs(diff) < 0.5 ? "draw" : diff > 0 ? "win" : "lose");
    }
  }

  private end(result: Result) {
    this.over = true;
    this.result = result;
    if (this.player.hp <= 0) this.player.alive = false;
    if (this.enemy.hp <= 0) this.enemy.alive = false;
    for (const c of [this.player, this.enemy]) {
      if (c.cast) this.interrupt(c);
      c.fireHeld = false;
    }
    if (result === "win") {
      const left = Math.max(0, this.timeLimit - this.time);
      const bonus = Math.round((1000 + this.player.hp * 10 + left * 6) * this.scoreMult);
      this.bonus = bonus;
      this.score += bonus;
      this.events.push({ t: "score", pts: bonus, label: "VICTORY BONUS" });
    }
    this.score = Math.round(this.score);
    this.events.push({ t: "end", result });
  }
}
