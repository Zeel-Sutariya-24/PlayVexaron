import { buildSpell, specOf, type Difficulty, type SpellDef, type SpellSpec } from "./elements";

const SPELLS_KEY = "arcana.spellbook.v1";
const SCORES_KEY = "arcana.scores.v1";
const LOADOUT_KEY = "arcana.loadout.v1";
const SETTINGS_KEY = "arcana.settings.v1";

export interface ScoreEntry {
  name: string;
  score: number;
  result: "win" | "lose" | "draw";
  difficulty: Difficulty;
  date: number;
}

export interface Settings {
  muted: boolean;
  difficulty: Difficulty;
  sensitivity: number;
  musicVolume: number;
}

const DEFAULT_SETTINGS: Settings = { muted: false, difficulty: "adept", sensitivity: 1, musicVolume: 0.8 };

function read<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable (private mode / quota) - game still works for this session */
  }
}

export function loadSpells(): SpellDef[] {
  const specs = read<SpellSpec[]>(SPELLS_KEY, []);
  const out: SpellDef[] = [];
  const seen = new Set<string>();
  for (const s of Array.isArray(specs) ? specs : []) {
    try {
      const def = buildSpell(s);
      if (!seen.has(def.id)) {
        seen.add(def.id);
        out.push(def);
      }
    } catch {
      /* skip corrupt entries */
    }
  }
  return out;
}

export function saveSpells(spells: SpellDef[]) {
  write(SPELLS_KEY, spells.map(specOf));
}

export function loadLoadout(): string[] {
  const ids = read<string[]>(LOADOUT_KEY, []);
  return Array.isArray(ids) ? ids : [];
}

export function saveLoadout(ids: string[]) {
  write(LOADOUT_KEY, ids);
}

export function loadScores(): ScoreEntry[] {
  const list = read<ScoreEntry[]>(SCORES_KEY, []);
  return Array.isArray(list) ? list.slice(0, 10) : [];
}

export function qualifiesForTable(score: number): boolean {
  if (score <= 0) return false;
  const list = loadScores();
  return list.length < 10 || score > list[list.length - 1].score;
}

export function addScore(entry: ScoreEntry): ScoreEntry[] {
  const list = [...loadScores(), entry].sort((a, b) => b.score - a.score).slice(0, 10);
  write(SCORES_KEY, list);
  return list;
}

export function clearScores() {
  write(SCORES_KEY, []);
}

export function renameScore(date: number, name: string): ScoreEntry[] {
  const list = loadScores().map((s) => (s.date === date ? { ...s, name: name.trim() || "Wizard" } : s));
  write(SCORES_KEY, list);
  return list;
}

export function loadName(): string {
  return read<string>("arcana.name.v1", "Wizard") || "Wizard";
}

export function saveName(n: string) {
  write("arcana.name.v1", n);
}

export function loadSettings(): Settings {
  const settings = { ...DEFAULT_SETTINGS, ...read<Partial<Settings>>(SETTINGS_KEY, {}) };
  settings.musicVolume = Number.isFinite(settings.musicVolume) ? Math.max(0, Math.min(1, settings.musicVolume)) : DEFAULT_SETTINGS.musicVolume;
  return settings;
}

export function saveSettings(s: Settings) {
  write(SETTINGS_KEY, s);
}
