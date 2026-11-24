// Elements, the 10 elemental combinations, temperature bands and spell generation.

export type ElementId = "fire" | "water" | "wind" | "earth";
export type SpellType = "ball" | "slash" | "wall";
export type StatusId = "burn" | "chill" | "freeze" | "wet" | "stun" | "blind" | "mud";
export type ZoneKind = "fire" | "puddle" | "ice" | "steam" | "mud";
export type BandId = "frozen" | "chilled" | "temperate" | "heated" | "scorching";
export type Difficulty = "apprentice" | "adept" | "archmage";

export const ELEMENT_ORDER: ElementId[] = ["fire", "water", "wind", "earth"];

export interface ElementInfo {
  id: ElementId;
  name: string;
  color: number;
  css: string;
  dark: string;
  beats: ElementId;
  blurb: string;
}

export const ELEMENTS: Record<ElementId, ElementInfo> = {
  fire: { id: "fire", name: "Fire", color: 0xff5a1f, css: "#ff6a2b", dark: "#7a1d05", beats: "earth", blurb: "Burns Earth" },
  water: { id: "water", name: "Water", color: 0x2e9bff, css: "#38a8ff", dark: "#0b3a7a", beats: "fire", blurb: "Douses Fire" },
  wind: { id: "wind", name: "Wind", color: 0xbff7ff, css: "#c4f6ff", dark: "#2f6b78", beats: "water", blurb: "Scatters Water" },
  earth: { id: "earth", name: "Earth", color: 0x8fd14f, css: "#98d95a", dark: "#2f5a14", beats: "wind", blurb: "Smothers Wind" },
};

/** key beats value: Water>Fire, Fire>Earth, Earth>Wind, Wind>Water */
export const COUNTERS: Record<ElementId, ElementId> = { water: "fire", fire: "earth", earth: "wind", wind: "water" };
export const ADV_MULT = 1.2;
export const DIS_MULT = 0.8;

/** +1 if `att` elements have the advantage over `def` elements, -1 if at a disadvantage, otherwise 0. */
export function matchup(att: readonly ElementId[], def: readonly ElementId[]): number {
  let score = 0;
  for (const a of att) {
    for (const d of def) {
      if (COUNTERS[a] === d) score++;
      else if (COUNTERS[d] === a) score--;
    }
  }
  return score > 0 ? 1 : score < 0 ? -1 : 0;
}

export const STATUS_INFO: Record<StatusId, { name: string; css: string; desc: string }> = {
  burn: { name: "Burn", css: "#ff7a2e", desc: "Takes fire damage over time" },
  chill: { name: "Chill", css: "#8fe3ff", desc: "Movement slowed" },
  freeze: { name: "Freeze", css: "#d9f6ff", desc: "Rooted in ice (fire shatters it)" },
  wet: { name: "Soaked", css: "#4aa9ff", desc: "Douses burns, conducts lightning" },
  stun: { name: "Stun", css: "#ffe14d", desc: "Cannot act" },
  blind: { name: "Blind", css: "#c9b48a", desc: "Vision and aim obscured" },
  mud: { name: "Bogged", css: "#a57c4b", desc: "Heavily slowed" },
};

export const ZONE_INFO: Record<ZoneKind, { name: string; css: string; color: number; life: number }> = {
  fire: { name: "Flames", css: "#ff7a2e", color: 0xff6a1f, life: 5 },
  puddle: { name: "Puddle", css: "#4aa9ff", color: 0x2e8bff, life: 7 },
  ice: { name: "Ice", css: "#bfefff", color: 0xaee8ff, life: 6.5 },
  steam: { name: "Steam", css: "#e6e6f5", color: 0xdfe3ff, life: 4.5 },
  mud: { name: "Mire", css: "#a57c4b", color: 0x7a5530, life: 6 },
};

export interface BandInfo {
  id: BandId;
  label: string;
  prefix: string;
  css: string;
  desc: string;
}

export const BANDS: BandInfo[] = [
  { id: "frozen", label: "Frozen", prefix: "Frozen", css: "#b8f0ff", desc: "Freezes and slows. Sturdier walls, but weaker, slower spells." },
  { id: "chilled", label: "Chilled", prefix: "Chilled", css: "#7fd0ff", desc: "Chills targets. Walls frost nearby foes." },
  { id: "temperate", label: "Temperate", prefix: "", css: "#d8cfff", desc: "Stable and efficient: cheapest mana cost." },
  { id: "heated", label: "Heated", prefix: "Heated", css: "#ffb066", desc: "Burns targets. Faster and stronger, pricier mana." },
  { id: "scorching", label: "Scorching", prefix: "Scorching", css: "#ff6a3d", desc: "Blazing power and fast recast. Walls sear attackers." },
];

export function tempBand(temp: number): BandInfo {
  if (temp <= -60) return BANDS[0];
  if (temp <= -20) return BANDS[1];
  if (temp < 20) return BANDS[2];
  if (temp < 60) return BANDS[3];
  return BANDS[4];
}

export interface SpellEffect {
  id: StatusId;
  duration: number;
  power: number;
  chance: number;
}

interface ComboInfo {
  name: string;
  tag: string;
  dmg: number;
  speed: number;
  cd: number;
  mana: number;
  size: number;
  knock: number;
  effects: SpellEffect[];
  zone: ZoneKind | null;
}

export function comboKey(a: ElementId, b: ElementId): string {
  const [x, y] = sortPair(a, b);
  return `${x}+${y}`;
}

export function sortPair(a: ElementId, b: ElementId): [ElementId, ElementId] {
  return ELEMENT_ORDER.indexOf(a) <= ELEMENT_ORDER.indexOf(b) ? [a, b] : [b, a];
}

export const COMBOS: Record<string, ComboInfo> = {
  "fire+fire": { name: "Inferno", tag: "Roaring flames that sear and ignite the ground.", dmg: 1.12, speed: 1.05, cd: 1, mana: 1, size: 1, knock: 0, zone: "fire", effects: [{ id: "burn", duration: 3, power: 3.2, chance: 0.75 }] },
  "water+water": { name: "Deluge", tag: "A crushing surge that soaks foes and floods the ground.", dmg: 1.0, speed: 0.9, cd: 1, mana: 1, size: 1.25, knock: 1.5, zone: "puddle", effects: [{ id: "wet", duration: 6, power: 1, chance: 1 }] },
  "wind+wind": { name: "Tempest", tag: "A blisteringly fast gale that hurls foes back.", dmg: 0.82, speed: 1.35, cd: 0.85, mana: 0.95, size: 0.9, knock: 7, zone: null, effects: [] },
  "earth+earth": { name: "Quake", tag: "A slow, titanic force that staggers and breaks casts.", dmg: 1.35, speed: 0.72, cd: 1.2, mana: 1.1, size: 1.3, knock: 3.5, zone: null, effects: [{ id: "stun", duration: 0.5, power: 1, chance: 0.7 }] },
  "fire+water": { name: "Steam", tag: "Scalding vapour that blinds and clouds the field.", dmg: 0.9, speed: 1.0, cd: 1, mana: 1, size: 1.15, knock: 0, zone: "steam", effects: [{ id: "burn", duration: 2, power: 2, chance: 0.4 }, { id: "blind", duration: 2.2, power: 1, chance: 0.7 }] },
  "fire+wind": { name: "Lightning", tag: "A near-instant bolt that stuns. Devastating to the soaked.", dmg: 1.0, speed: 1.45, cd: 0.95, mana: 1.05, size: 0.8, knock: 0, zone: null, effects: [{ id: "stun", duration: 0.4, power: 1, chance: 0.4 }] },
  "fire+earth": { name: "Magma", tag: "Molten rock that burns deep and pools as lava.", dmg: 1.28, speed: 0.8, cd: 1.15, mana: 1.1, size: 1.2, knock: 1.5, zone: "fire", effects: [{ id: "burn", duration: 3.6, power: 4, chance: 0.85 }] },
  "water+wind": { name: "Blizzard", tag: "Biting winds that chill and glaze the ground with ice.", dmg: 0.92, speed: 1.12, cd: 1, mana: 1, size: 1, knock: 2.5, zone: "puddle", effects: [{ id: "chill", duration: 3, power: 0.28, chance: 0.9 }] },
  "water+earth": { name: "Mire", tag: "Heavy sludge that bogs down its victims.", dmg: 1.0, speed: 0.85, cd: 1, mana: 1, size: 1.2, knock: 0, zone: "mud", effects: [{ id: "mud", duration: 3.5, power: 0.45, chance: 1 }, { id: "wet", duration: 4, power: 1, chance: 0.6 }] },
  "wind+earth": { name: "Sandstorm", tag: "Scouring grit that blinds and shoves foes aside.", dmg: 0.95, speed: 1.1, cd: 1, mana: 1, size: 1.1, knock: 3.5, zone: null, effects: [{ id: "blind", duration: 3, power: 1, chance: 0.85 }] },
};

export const MAX_CHARGE = 3;

const BASE = {
  ball: { dmg: 9.5, mana: 16, cd: 1.5, cast: 0.16, speed: 22, radius: 0.42, life: 3.4 },
  slash: { dmg: 13, mana: 11, cd: 1.0, cast: 0.12, range: 4.6, arc: 115 },
  wall: { dmg: 0, mana: 24, cd: 9, cast: 0.28, hp: 46, width: 6 },
};

export interface SpellDef {
  id: string;
  name: string;
  elements: [ElementId, ElementId];
  temp: number;
  type: SpellType;
  combo: string;
  comboName: string;
  band: BandId;
  damage: number;
  manaCost: number;
  cooldown: number;
  castTime: number;
  speed: number;
  radius: number;
  life: number;
  range: number;
  arc: number;
  wallHp: number;
  wallWidth: number;
  knock: number;
  effects: SpellEffect[];
  zone: ZoneKind | null;
  colors: [number, number];
  desc: string;
  traits: string[];
  createdAt: number;
}

export interface SpellSpec {
  a: ElementId;
  b: ElementId;
  temp: number;
  type: SpellType;
  createdAt?: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const r1 = (v: number) => Math.round(v * 10) / 10;

function lerpColor(c: number, to: number, t: number): number {
  const r = ((c >> 16) & 255) * (1 - t) + ((to >> 16) & 255) * t;
  const g = ((c >> 8) & 255) * (1 - t) + ((to >> 8) & 255) * t;
  const b = (c & 255) * (1 - t) + (to & 255) * t;
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b);
}

export function hex(n: number): string {
  return "#" + n.toString(16).padStart(6, "0");
}

export function spellKey(a: ElementId, b: ElementId, temp: number, type: SpellType): string {
  return `${comboKey(a, b)}|${type}|${tempBand(temp).id}`;
}

export function buildSpell(spec: SpellSpec): SpellDef {
  const [a, b] = sortPair(spec.a, spec.b);
  const temp = clamp(Math.round(spec.temp), -100, 100);
  const type = spec.type;
  const h = temp / 100;
  const ah = Math.abs(h);
  const ck = comboKey(a, b);
  const combo = COMBOS[ck];
  const band = tempBand(temp);
  const base = BASE[type];
  const has = (e: ElementId) => a === e || b === e;

  const dmgMult = (1 + 0.3 * h) * combo.dmg;
  const speedMult = (1 + 0.25 * h) * combo.speed;
  const cdMult = (1 - 0.15 * h) * combo.cd;
  const manaMult = (0.9 + 0.35 * ah) * combo.mana;

  const effects: SpellEffect[] = combo.effects.map((e) => ({ ...e }));
  const addEffect = (e: SpellEffect) => {
    const ex = effects.find((x) => x.id === e.id);
    if (ex) {
      ex.duration = Math.max(ex.duration, e.duration);
      ex.power = Math.max(ex.power, e.power);
      ex.chance = Math.min(1, Math.max(ex.chance, e.chance) + 0.1);
    } else effects.push(e);
  };
  if (h >= 0.25) addEffect({ id: "burn", duration: 2 + 2 * h, power: 2 + 3 * h, chance: clamp(0.4 + 0.6 * h, 0, 1) });
  if (h <= -0.25) addEffect({ id: "chill", duration: 2.5 + 2 * ah, power: 0.15 + 0.25 * ah, chance: clamp(0.5 + 0.5 * ah, 0, 1) });
  if (h <= -0.75) addEffect({ id: "freeze", duration: 0.9 + 2 * (ah - 0.75), power: 1, chance: 0.22 + 0.5 * (ah - 0.75) });
  if (type === "slash") for (const e of effects) e.chance = Math.min(1, e.chance + 0.1);

  let zone: ZoneKind | null = combo.zone;
  if (!zone && h >= 0.6 && has("fire") && !has("water")) zone = "fire";
  if (zone === "fire" && h < -0.4) zone = null;
  if (zone === "puddle" && h <= -0.3) zone = "ice";
  if (type === "wall") zone = null;

  const name = `${band.prefix ? band.prefix + " " : ""}${combo.name} ${type === "ball" ? "Orb" : type === "slash" ? "Slash" : "Wall"}`;
  const colors: [number, number] = [ELEMENTS[a].color, ELEMENTS[b].color];
  if (h > 0) {
    colors[0] = lerpColor(colors[0], 0xff7a2a, 0.22 * h);
    colors[1] = lerpColor(colors[1], 0xffc070, 0.2 * h);
  } else if (h < 0) {
    colors[0] = lerpColor(colors[0], 0x9ee8ff, 0.3 * ah);
    colors[1] = lerpColor(colors[1], 0xe8fbff, 0.3 * ah);
  }
  // Keep the element identity, but give each cast shape a recognizable color signature.
  if (type === "ball") colors[1] = lerpColor(colors[1], 0xffe3a2, 0.14);
  else if (type === "slash") colors[1] = lerpColor(colors[1], 0x62e4ff, 0.32);
  else {
    colors[0] = lerpColor(colors[0], 0x1d3442, 0.12);
    colors[1] = lerpColor(colors[1], 0xff5369, 0.3);
  }

  const traits: string[] = [];
  for (const e of effects) traits.push(STATUS_INFO[e.id].name + (e.chance < 1 ? ` ${Math.round(e.chance * 100)}%` : ""));
  if (combo.knock >= 3) traits.push("Knockback");
  if (zone) traits.push(`Leaves ${ZONE_INFO[zone].name}`);
  if (ck === "fire+wind") traits.push("Conducts through water");
  if (type === "wall") {
    if (h >= 0.4) traits.push("Sears attackers");
    if (h <= -0.4) traits.push("Frosts nearby foes");
  }

  const spec2: SpellDef = {
    id: spellKey(a, b, temp, type),
    name,
    elements: [a, b],
    temp,
    type,
    combo: ck,
    comboName: combo.name,
    band: band.id,
    damage: type === "wall" ? 0 : r1(base.dmg * dmgMult),
    manaCost: Math.round(base.mana * manaMult),
    cooldown: r1(clamp(base.cd * cdMult, 0.5, 14)),
    castTime: base.cast,
    speed: type === "ball" ? clamp(r1(BASE.ball.speed * speedMult), 11, 38) : 0,
    radius: type === "ball" ? r1(BASE.ball.radius * Math.sqrt(combo.size) * 100) / 100 : 0,
    life: BASE.ball.life,
    range: type === "slash" ? r1(BASE.slash.range * (0.9 + 0.2 * combo.size)) : 0,
    arc: BASE.slash.arc,
    wallHp: type === "wall" ? Math.round(BASE.wall.hp * (1 - 0.25 * h) * (0.9 + 0.2 * combo.size)) : 0,
    wallWidth: BASE.wall.width,
    knock: combo.knock * (type === "slash" ? 0.8 : 1),
    effects,
    zone,
    colors,
    desc: `${combo.tag}`,
    traits,
    createdAt: spec.createdAt ?? Date.now(),
  };
  return spec2;
}

export function specOf(s: SpellDef): SpellSpec {
  return { a: s.elements[0], b: s.elements[1], temp: s.temp, type: s.type, createdAt: s.createdAt };
}

export function randomSpec(rng: () => number = Math.random, forceType?: SpellType): SpellSpec {
  const a = ELEMENT_ORDER[Math.floor(rng() * 4)];
  const b = ELEMENT_ORDER[Math.floor(rng() * 4)];
  const t = rng();
  const type: SpellType = forceType ?? (t < 0.45 ? "ball" : t < 0.75 ? "slash" : "wall");
  return { a, b, temp: Math.round(rng() * 200 - 100), type };
}

/** A varied set of specs used by the "quick-forge" shortcut so each of the 10 combos appears. */
export const STARTER_SPECS: SpellSpec[] = [
  { a: "fire", b: "fire", temp: 65, type: "ball" },
  { a: "water", b: "fire", temp: 25, type: "ball" },
  { a: "wind", b: "fire", temp: 40, type: "ball" },
  { a: "earth", b: "fire", temp: 70, type: "slash" },
  { a: "water", b: "water", temp: -45, type: "ball" },
  { a: "water", b: "wind", temp: -80, type: "slash" },
  { a: "water", b: "earth", temp: 0, type: "wall" },
  { a: "wind", b: "wind", temp: 10, type: "slash" },
  { a: "wind", b: "earth", temp: -10, type: "ball" },
  { a: "earth", b: "earth", temp: -30, type: "wall" },
  { a: "fire", b: "fire", temp: 90, type: "wall" },
  { a: "earth", b: "earth", temp: 30, type: "ball" },
];

export function aiLoadout(difficulty: Difficulty, rng: () => number = Math.random): SpellDef[] {
  const plan: SpellType[] = ["ball", "ball", "slash", "wall", rng() < 0.6 ? "ball" : "slash"];
  const out: SpellDef[] = [];
  const keys = new Set<string>();
  const tempSpread = difficulty === "apprentice" ? 0.6 : 1;
  for (const type of plan) {
    for (let tries = 0; tries < 40; tries++) {
      const spec = randomSpec(rng, type);
      spec.temp = Math.round(spec.temp * tempSpread);
      const def = buildSpell(spec);
      if (!keys.has(def.id)) {
        keys.add(def.id);
        out.push(def);
        break;
      }
    }
  }
  return out;
}

export function spellMainElement(s: SpellDef): ElementId {
  return s.elements[0];
}
