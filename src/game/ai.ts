// AI opponent. It drives a Combatant purely through the same Intent interface a human (or a
// future network peer) would use: that is the seam where PvP plugs in later.
import * as THREE from "three";
import { matchup, type Difficulty } from "./elements";
import { ARENA_R, DASH_COST, PLAYER_R, fwd, rgt, type Combatant, type Sim } from "./sim";

export interface AIParams {
  label: string;
  desc: string;
  enemyName: string;
  reaction: number;
  dodge: number;
  aimErr: number;
  lead: number;
  maxCharge: number;
  speed: number;
  castGap: number;
  turn: number;
  scoreMult: number;
  assist: number;
  damage: number;
}

export const DIFFICULTY: Record<Difficulty, AIParams> = {
  apprentice: { label: "Apprentice", desc: "Slow reflexes, loose aim. Learn the ropes.", enemyName: "Novice Orin", reaction: 0.55, dodge: 0.18, aimErr: 0.16, lead: 0.25, maxCharge: 0.8, speed: 6.0, castGap: 1.9, turn: 3.2, scoreMult: 1, assist: 1, damage: 0.6 },
  adept: { label: "Adept", desc: "Dodges, counters and walls. A fair duel.", enemyName: "Magus Vael", reaction: 0.35, dodge: 0.42, aimErr: 0.08, lead: 0.6, maxCharge: 1.5, speed: 6.9, castGap: 1.25, turn: 4.6, scoreMult: 1.5, assist: 0.7, damage: 0.85 },
  archmage: { label: "Archmage", desc: "Precise leading shots and ruthless dodging.", enemyName: "Archmage Zephyra", reaction: 0.2, dodge: 0.68, aimErr: 0.035, lead: 0.9, maxCharge: 2.4, speed: 7.5, castGap: 0.8, turn: 7, scoreMult: 2.2, assist: 0.4, damage: 1 },
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const angDiff = (a: number, b: number) => {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
};

export class AIController {
  private strafeDir = 1;
  private strafeT = 1.2;
  private thinkT = 1.1;
  private wantSlot = -1;
  private wantT = 0;
  private chargeTarget = 0;
  private aimOffYaw = 0;
  private aimOffPitch = 0;
  private seen = new Map<number, { t: number; roll: boolean; done: boolean }>();
  private stuckT = 0;
  private lastPos = new THREE.Vector3();
  private jitterT = 0;
  private meleeT = 3;
  private melee = false;
  private pruneT = 1;
  private preferred = 10;
  private threat = 0;

  constructor(private sim: Sim, private me: Combatant, private foe: Combatant, private p: AIParams) {
    const balls = me.loadout.filter((s) => s.type === "ball").length;
    this.preferred = balls >= 3 ? 11 : balls === 2 ? 9 : 7;
    this.lastPos.copy(me.pos);
  }

  private choose(d: number): number {
    const { me, foe, sim } = this;
    let best = -1;
    let bestScore = 0.55;
    const myWalls = sim.walls.filter((w) => w.owner === "enemy" && !w.dead).length;
    for (let i = 0; i < me.loadout.length; i++) {
      const def = me.loadout[i];
      if (me.cd[i] > 0 || me.mana < def.manaCost + (def.type === "slash" ? 0 : 5)) continue;
      let s = 0;
      if (def.type === "ball") {
        s = d > 3 ? 1.0 : 0.45;
        if (d > 30) s *= 0.5;
        s *= 0.8 + def.damage / 40;
      } else if (def.type === "slash") {
        s = d < def.range * 1.05 + 0.6 ? 2.3 : d < 7 ? 0.1 : 0;
        s *= 0.8 + def.damage / 50;
      } else {
        s = 0.12;
        if (this.threat > 0) s += 1.3;
        if (me.hp < 45) s += 0.8;
        if (foe.cast && foe.cast.charge > 1.1) s += 1.5;
        if (myWalls >= 1) s -= 1.0;
        if (d < 6) s -= 0.7;
      }
      const rel = matchup(def.elements, foe.attune);
      if (def.type !== "wall") {
        if (rel > 0) s *= 1.4;
        else if (rel < 0) s *= 0.75;
        if (def.combo === "fire+wind" && foe.status.wet) s *= 1.7;
        if (def.elements.includes("fire") && foe.status.freeze) s *= 1.5;
      }
      s += Math.random() * 0.35;
      if (s > bestScore) {
        bestScore = s;
        best = i;
      }
    }
    return best;
  }

  update(dt: number) {
    const it = this.sim.intents.enemy;
    const { me, foe, sim, p } = this;
    it.mx = 0;
    it.mz = 0;
    it.dash = false;
    it.select = null;
    if (sim.over || !me.alive) {
      it.fire = false;
      return;
    }
    const dx = foe.pos.x - me.pos.x;
    const dz = foe.pos.z - me.pos.z;
    const d = Math.hypot(dx, dz) || 0.01;
    const blind = !!me.status.blind;
    const stunned = !!me.status.stun || !!me.status.freeze;

    // threat assessment (incoming enemy projectiles)
    this.threat = 0;
    for (const pr of sim.projectiles) {
      if (pr.dead || pr.owner !== "player") continue;
      const rx = pr.pos.x - me.pos.x;
      const rz = pr.pos.z - me.pos.z;
      if (rx * pr.vel.x + rz * pr.vel.z < 0) this.threat += pr.power;
    }

    // spell selection / casting
    if (this.wantSlot < 0 && !me.cast) {
      this.thinkT -= dt;
      if (this.thinkT <= 0 && !stunned) {
        const slot = this.choose(d);
        if (slot >= 0) {
          const def = me.loadout[slot];
          this.wantSlot = slot;
          this.wantT = 0;
          this.chargeTarget = def.type === "ball" ? Math.random() * p.maxCharge * (d > 10 ? 1 : 0.45) : def.type === "wall" ? 0 : Math.random() * 0.25;
          const err = p.aimErr * (blind ? 3.2 : 1);
          this.aimOffYaw = (Math.random() - 0.5) * 2 * err;
          this.aimOffPitch = (Math.random() - 0.5) * err;
        }
        this.thinkT = p.castGap * (0.5 + Math.random() * 0.9);
      }
    }

    // aiming
    const aimDef = this.wantSlot >= 0 ? me.loadout[this.wantSlot] : me.loadout[me.selected];
    const speed = aimDef.type === "ball" ? Math.max(8, aimDef.speed) : 30;
    const tLead = d / speed;
    const fvx = clamp(foe.vel.x, -8, 8);
    const fvz = clamp(foe.vel.z, -8, 8);
    const ax = foe.pos.x + fvx * tLead * p.lead - me.pos.x;
    const az = foe.pos.z + fvz * tLead * p.lead - me.pos.z;
    const wobble = Math.sin(sim.time * 3.1) * p.aimErr * 0.3;
    const desiredYaw = Math.atan2(-ax, -az) + this.aimOffYaw + wobble;
    const desiredPitch = Math.atan2(1.15 - 1.5, Math.hypot(ax, az)) + this.aimOffPitch;
    if (!stunned) {
      const diff = angDiff(desiredYaw, me.yaw);
      const maxTurn = p.turn * dt * (me.cast ? 0.8 : 1);
      me.yaw += clamp(diff, -maxTurn, maxTurn);
      me.pitch += (desiredPitch - me.pitch) * Math.min(1, dt * 8);
    }
    const yawErr = Math.abs(angDiff(desiredYaw, me.yaw));

    if (this.wantSlot >= 0) {
      const def = me.loadout[this.wantSlot];
      if (!me.cast) {
        this.wantT += dt;
        if (me.cd[this.wantSlot] > 0 || me.mana < def.manaCost || this.wantT > 0.5) {
          this.wantSlot = -1;
          it.fire = false;
        } else {
          it.select = this.wantSlot;
          it.fire = true;
        }
      } else {
        const ready = me.cast.charge >= Math.max(this.chargeTarget, def.castTime);
        const aimed = yawErr < 0.09 || def.type === "wall";
        if ((ready && aimed) || me.cast.charge > this.chargeTarget + 1.2) {
          it.fire = false;
          this.wantSlot = -1;
        } else it.fire = true;
      }
    } else it.fire = false;

    // movement
    this.strafeT -= dt;
    this.meleeT -= dt;
    this.jitterT = Math.max(0, this.jitterT - dt);
    if (this.strafeT <= 0) {
      this.strafeT = 0.9 + Math.random() * 1.8;
      if (Math.random() < 0.65) this.strafeDir *= -1;
    }
    if (this.meleeT <= 0) {
      this.meleeT = 3 + Math.random() * 4;
      this.melee = me.loadout.some((s) => s.type === "slash") && Math.random() < 0.4;
    }
    let pref = this.melee ? 3.4 : this.preferred;
    if (me.hp < 30 && !this.melee) pref += 3;
    const radial = clamp((d - pref) / 4, -1, 1);
    const tx = -dz / d;
    const tz = dx / d;
    let wmx = (dx / d) * radial + tx * this.strafeDir * 0.85;
    let wmz = (dz / d) * radial + tz * this.strafeDir * 0.85;
    const cd = Math.hypot(me.pos.x, me.pos.z);
    if (cd > ARENA_R - 4) {
      const k = (cd - (ARENA_R - 4)) / 4;
      wmx -= (me.pos.x / cd) * k * 2;
      wmz -= (me.pos.z / cd) * k * 2;
    }
    if (this.jitterT > 0) {
      wmx += tx * this.strafeDir * 0.6;
      wmz += tz * this.strafeDir * 0.6;
    }
    this.stuckT += dt;
    if (this.stuckT >= 0.7) {
      if (me.pos.distanceTo(this.lastPos) < 0.35 && !stunned) {
        this.strafeDir *= -1;
        this.jitterT = 0.8;
      }
      this.lastPos.copy(me.pos);
      this.stuckT = 0;
    }
    const f = fwd(me.yaw);
    const r = rgt(me.yaw);
    it.mz = wmx * f.x + wmz * f.z;
    it.mx = wmx * r.x + wmz * r.z;

    // dodge incoming projectiles
    this.pruneT -= dt;
    if (this.pruneT <= 0) {
      this.pruneT = 1;
      const ids = new Set(sim.projectiles.map((q) => q.id));
      for (const k of this.seen.keys()) if (!ids.has(k)) this.seen.delete(k);
    }
    if (me.dashCd <= 0 && me.mana >= DASH_COST && !stunned) {
      for (const pr of sim.projectiles) {
        if (pr.dead || pr.owner !== "player") continue;
        let rec = this.seen.get(pr.id);
        if (!rec) {
          rec = { t: sim.time, roll: Math.random() < p.dodge, done: false };
          this.seen.set(pr.id, rec);
        }
        if (rec.done || !rec.roll || sim.time - rec.t < p.reaction) continue;
        const rx = pr.pos.x - me.pos.x;
        const rz = pr.pos.z - me.pos.z;
        const vv = pr.vel.x * pr.vel.x + pr.vel.z * pr.vel.z;
        if (vv < 1) continue;
        const tca = -(rx * pr.vel.x + rz * pr.vel.z) / vv;
        if (tca < 0.02 || tca > 0.55) continue;
        const cx = rx + pr.vel.x * tca;
        const cz = rz + pr.vel.z * tca;
        const miss = Math.hypot(cx, cz);
        if (miss > PLAYER_R + pr.r + 0.7) continue;
        let ddx: number;
        let ddz: number;
        if (miss < 0.15) {
          const vl = Math.sqrt(vv);
          ddx = (-pr.vel.z / vl) * this.strafeDir;
          ddz = (pr.vel.x / vl) * this.strafeDir;
        } else {
          ddx = -cx / miss;
          ddz = -cz / miss;
        }
        it.mz = ddx * f.x + ddz * f.z;
        it.mx = ddx * r.x + ddz * r.z;
        it.dash = true;
        rec.done = true;
        break;
      }
    }
  }
}
