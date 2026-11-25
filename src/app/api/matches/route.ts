import { randomInt } from "node:crypto";
import { pool } from "@/db";
import type { SpellDef } from "@/game/elements";
import type { Intent } from "@/game/sim";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type MatchState = "waiting" | "ready" | "active" | "ended";
type MatchRow = {
  code: string;
  host_peer: string;
  guest_peer: string | null;
  host_loadout: SpellDef[];
  guest_loadout: SpellDef[];
  state: MatchState;
  team_size: 1 | 2 | 3;
  input: { intent: Intent; yaw: number; pitch: number; seq: number } | null;
  snapshot: string | null;
  host_seen: Date;
  guest_seen: Date | null;
};

const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
let tableReady: Promise<unknown> | null = null;
function ensureTable() {
  tableReady ??= pool.query(`
  CREATE TABLE IF NOT EXISTS arcana_matches (
    code text PRIMARY KEY,
    host_peer text NOT NULL,
    guest_peer text,
    host_loadout jsonb NOT NULL,
    guest_loadout jsonb NOT NULL DEFAULT '[]'::jsonb,
    state text NOT NULL CHECK (state IN ('waiting', 'ready', 'active', 'ended')),
    input jsonb,
    snapshot text,
    host_seen timestamptz NOT NULL DEFAULT now(),
    guest_seen timestamptz,
    team_size integer NOT NULL DEFAULT 1 CHECK (team_size IN (1, 2, 3)),
    updated_at timestamptz NOT NULL DEFAULT now()
  );
  ALTER TABLE arcana_matches ADD COLUMN IF NOT EXISTS host_seen timestamptz NOT NULL DEFAULT now();
  ALTER TABLE arcana_matches ADD COLUMN IF NOT EXISTS guest_seen timestamptz;
  ALTER TABLE arcana_matches ADD COLUMN IF NOT EXISTS team_size integer NOT NULL DEFAULT 1;
  CREATE INDEX IF NOT EXISTS arcana_matches_updated_at_idx ON arcana_matches (updated_at);
  `).catch((error) => {
    tableReady = null;
    throw error;
  });
  return tableReady;
}

const elementIds = new Set(["fire", "water", "earth", "wind"]);
const spellTypes = new Set(["ball", "slash", "wall"]);
const bands = new Set(["frozen", "chilled", "temperate", "heated", "scorching"]);
const zones = new Set(["fire", "puddle", "ice", "steam", "mud"]);
const statuses = new Set(["burn", "chill", "freeze", "wet", "stun", "blind", "mud"]);
const spellNumbers = ["temp", "damage", "manaCost", "cooldown", "castTime", "speed", "radius", "life", "range", "arc", "wallHp", "wallWidth", "knock", "createdAt"];

function validSpell(value: unknown): value is SpellDef {
  if (!value || typeof value !== "object") return false;
  const spell = value as Record<string, unknown>;
  if (typeof spell.id !== "string" || !spell.id || spell.id.length > 100 || typeof spell.name !== "string" || spell.name.length > 100) return false;
  if (!Array.isArray(spell.elements) || spell.elements.length !== 2 || spell.elements.some((el) => typeof el !== "string" || !elementIds.has(el))) return false;
  if (typeof spell.type !== "string" || !spellTypes.has(spell.type) || typeof spell.band !== "string" || !bands.has(spell.band)) return false;
  if (typeof spell.combo !== "string" || spell.combo.length > 40 || typeof spell.comboName !== "string" || spell.comboName.length > 80) return false;
  if (typeof spell.desc !== "string" || spell.desc.length > 500 || !Array.isArray(spell.traits) || spell.traits.length > 12 || !spell.traits.every((trait) => typeof trait === "string" && trait.length <= 80)) return false;
  if (spellNumbers.some((key) => !Number.isFinite(spell[key]))) return false;
  if (Number(spell.temp) < -100 || Number(spell.temp) > 100 || Number(spell.damage) < 0 || Number(spell.damage) > 200 || Number(spell.manaCost) < 0 || Number(spell.manaCost) > 200) return false;
  if (!Array.isArray(spell.colors) || spell.colors.length !== 2 || spell.colors.some((color) => !Number.isInteger(color) || Number(color) < 0 || Number(color) > 0xffffff)) return false;
  if (spell.zone !== null && (typeof spell.zone !== "string" || !zones.has(spell.zone))) return false;
  if (!Array.isArray(spell.effects) || spell.effects.length > 8 || !spell.effects.every((effect) => {
    if (!effect || typeof effect !== "object") return false;
    const e = effect as Record<string, unknown>;
    return typeof e.id === "string" && statuses.has(e.id) && Number.isFinite(e.duration) && Number.isFinite(e.power) && Number.isFinite(e.chance);
  })) return false;
  return true;
}

function validLoadout(value: unknown): value is SpellDef[] {
  return Array.isArray(value) && value.length === 5 && new Set(value.map((spell) => (spell as SpellDef | null)?.id)).size === 5 && value.every(validSpell);
}

function cleanIntent(value: unknown): Intent | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (!Number.isFinite(raw.mx) || !Number.isFinite(raw.mz) || typeof raw.fire !== "boolean" || typeof raw.dash !== "boolean") return null;
  const select = raw.select;
  if (select !== null && (!Number.isInteger(select) || Number(select) < 0 || Number(select) > 4)) return null;
  return {
    mx: Math.max(-1, Math.min(1, Number(raw.mx))),
    mz: Math.max(-1, Math.min(1, Number(raw.mz))),
    fire: raw.fire,
    dash: raw.dash,
    select: select === null ? null : Number(select),
  };
}

function toMatchInfo(row: MatchRow, peer: string) {
  const host = peer === row.host_peer;
  return {
    code: row.code,
    peer,
    state: row.state,
    teamSize: row.team_size,
    host,
    opponentLoadout: host ? row.guest_loadout : row.host_loadout,
    input: host ? row.input ?? undefined : undefined,
    snapshot: host ? undefined : row.snapshot ?? undefined,
  };
}

async function roomFor(code: string, peer: string) {
  const result = await pool.query<MatchRow>(
    `UPDATE arcana_matches SET updated_at = now(),
       host_seen = CASE WHEN host_peer = $2 THEN now() ELSE host_seen END,
       guest_seen = CASE WHEN guest_peer = $2 THEN now() ELSE guest_seen END
     WHERE code = $1 AND (host_peer = $2 OR guest_peer = $2)
       AND updated_at > now() - interval '30 minutes'
     RETURNING code, host_peer, guest_peer, host_loadout, guest_loadout, state, input, snapshot, host_seen, guest_seen, team_size`,
    [code, peer],
  );
  return result.rows[0] ?? null;
}

function failure(message: string, status: number) {
  return Response.json({ error: message }, { status, headers: { "cache-control": "no-store" } });
}

export async function POST(req: Request) {
  try {
    await ensureTable();
    const contentLength = Number(req.headers.get("content-length") ?? 0);
    if (contentLength > 300_000) return failure("Duel update is too large.", 413);

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return failure("Invalid request.", 400);
    }

    const peer = typeof body.peer === "string" && body.peer.length <= 80 ? body.peer : "";
    if (!peer) return failure("Missing player session.", 400);

    if (body.action === "create") {
      if (!validLoadout(body.loadout)) return failure("Choose exactly five spells first.", 400);
      const teamSize = body.teamSize === 2 || body.teamSize === 3 ? body.teamSize : 1;
      await pool.query("DELETE FROM arcana_matches WHERE updated_at < now() - interval '30 minutes'");
      for (let attempt = 0; attempt < 4; attempt++) {
        const code = Array.from({ length: 8 }, () => alphabet[randomInt(alphabet.length)]).join("");
        const inserted = await pool.query<MatchRow>(
          `INSERT INTO arcana_matches (code, host_peer, host_loadout, state, host_seen, team_size)
           VALUES ($1, $2, $3::jsonb, 'waiting', now(), $4)
           ON CONFLICT (code) DO NOTHING
           RETURNING code, host_peer, guest_peer, host_loadout, guest_loadout, state, input, snapshot, host_seen, guest_seen, team_size`,
          [code, peer, JSON.stringify(body.loadout), teamSize],
        );
        if (inserted.rows[0]) return Response.json(toMatchInfo(inserted.rows[0], peer), { headers: { "cache-control": "no-store" } });
      }
      return failure("Could not reserve a duel room. Please try again.", 503);
    }

    if (body.action === "join") {
      if (!validLoadout(body.loadout)) return failure("Choose exactly five spells first.", 400);
      const teamSize = body.teamSize === 2 || body.teamSize === 3 ? body.teamSize : 1;
      const code = typeof body.code === "string" ? body.code.toUpperCase() : "";
      if (!/^[A-HJ-NP-Z2-9]{8}$/.test(code)) return failure("Enter the 8-character room code.", 400);
      const joined = await pool.query<MatchRow>(
        `UPDATE arcana_matches
         SET guest_peer = $2, guest_loadout = $3::jsonb, state = 'ready', updated_at = now(), guest_seen = now()
         WHERE code = $1 AND state = 'waiting' AND host_peer <> $2
           AND updated_at > now() - interval '30 minutes'
         AND team_size = $4
         RETURNING code, host_peer, guest_peer, host_loadout, guest_loadout, state, input, snapshot, host_seen, guest_seen, team_size`,
        [code, peer, JSON.stringify(body.loadout), teamSize],
      );
      if (joined.rows[0]) return Response.json(toMatchInfo(joined.rows[0], peer), { headers: { "cache-control": "no-store" } });
      const exists = await pool.query<{ host_peer: string; state: MatchState; team_size: number }>("SELECT host_peer, state, team_size FROM arcana_matches WHERE code = $1", [code]);
      if (!exists.rows[0]) return failure("That room is unavailable. Check the code or create a new duel.", 404);
      if (exists.rows[0].team_size !== teamSize) return failure("That room uses a different team size.", 409);
      if (exists.rows[0].host_peer === peer) return failure("Open the room in a second browser to join it.", 400);
      return failure("That room already has two players or the duel has started.", 409);
    }

    const code = typeof body.code === "string" ? body.code.toUpperCase() : "";
    if (!/^[A-HJ-NP-Z2-9]{8}$/.test(code)) return failure("Invalid room code.", 400);
    const room = await roomFor(code, peer);
    if (!room) return failure("Room not found, expired, or this player is no longer in it.", 404);

    if (body.action === "poll") {
      if (peer !== room.host_peer && room.state === "ready" && Date.now() - new Date(room.host_seen).getTime() > 8_000)
        return failure("The room host disconnected. Go back and create or join another room.", 410);
      return Response.json(toMatchInfo(room, peer), { headers: { "cache-control": "no-store" } });
    }

    if (body.action === "start") {
      if (peer !== room.host_peer || room.state !== "ready") return failure("Waiting for another player to join.", 409);
      const started = await pool.query<MatchRow>(
        `UPDATE arcana_matches SET state = 'active', updated_at = now()
         WHERE code = $1 AND host_peer = $2 AND state = 'ready'
         RETURNING code, host_peer, guest_peer, host_loadout, guest_loadout, state, input, snapshot, host_seen, guest_seen, team_size`,
        [code, peer],
      );
      if (!started.rows[0]) return failure("The room changed before the duel could start.", 409);
      return Response.json(toMatchInfo(started.rows[0], peer), { headers: { "cache-control": "no-store" } });
    }

    if (body.action === "hostSync") {
      if (peer !== room.host_peer || room.state !== "active" || typeof body.snapshot !== "string" || body.snapshot.length > 250_000)
        return failure("Invalid duel update.", 400);
      const synced = await pool.query<MatchRow>(
        `UPDATE arcana_matches SET snapshot = $3, updated_at = now(), host_seen = now()
         WHERE code = $1 AND host_peer = $2 AND state = 'active'
           AND guest_seen > now() - interval '8 seconds'
         RETURNING code, host_peer, guest_peer, host_loadout, guest_loadout, state, input, snapshot, host_seen, guest_seen, team_size`,
        [code, peer, body.snapshot],
      );
      if (!synced.rows[0]) {
        const presence = await pool.query<{ state: MatchState; guest_seen: Date | null }>("SELECT state, guest_seen FROM arcana_matches WHERE code = $1 AND host_peer = $2", [code, peer]);
        if (presence.rows[0]?.state === "active" && (!presence.rows[0].guest_seen || Date.now() - new Date(presence.rows[0].guest_seen).getTime() > 8_000))
          return failure("Your rival disconnected. Leave the duel and create a new room to continue.", 410);
        return failure("The duel room has ended.", 409);
      }
      return Response.json(toMatchInfo(synced.rows[0], peer), { headers: { "cache-control": "no-store" } });
    }

    if (body.action === "guestSync") {
      if (peer !== room.guest_peer || room.state !== "active") return failure("Duel is not active.", 409);
      const intent = cleanIntent(body.intent);
      const yaw = Number(body.yaw);
      const pitch = Number(body.pitch);
      const seq = Number(body.seq);
      if (!intent || !Number.isFinite(yaw) || !Number.isFinite(pitch) || !Number.isSafeInteger(seq) || seq < 1)
        return failure("Invalid player input.", 400);
      const synced = await pool.query<MatchRow>(
        `UPDATE arcana_matches
         SET input = jsonb_build_object('intent', $3::jsonb, 'yaw', $4::float8, 'pitch', $5::float8, 'seq', $6::bigint), updated_at = now(), guest_seen = now()
         WHERE code = $1 AND guest_peer = $2 AND state = 'active'
           AND host_seen > now() - interval '8 seconds'
           AND (input IS NULL OR (input->>'seq')::bigint < $6::bigint)
         RETURNING code, host_peer, guest_peer, host_loadout, guest_loadout, state, input, snapshot, host_seen, guest_seen, team_size`,
        [code, peer, JSON.stringify(intent), yaw, Math.max(-1.1, Math.min(1.1, pitch)), seq],
      );
      const current = synced.rows[0] ?? await roomFor(code, peer);
      if (!current) return failure("The duel room has ended.", 409);
      if (Date.now() - new Date(current.host_seen).getTime() > 8_000) return failure("Your rival disconnected. Leave the duel and create a new room to continue.", 410);
      return Response.json(toMatchInfo(current, peer), { headers: { "cache-control": "no-store" } });
    }

    if (body.action === "leave") {
      if (peer === room.host_peer) await pool.query("DELETE FROM arcana_matches WHERE code = $1 AND host_peer = $2", [code, peer]);
      else await pool.query(
        `UPDATE arcana_matches SET guest_peer = NULL, guest_loadout = '[]'::jsonb, state = 'waiting', input = NULL, snapshot = NULL, updated_at = now()
         WHERE code = $1 AND guest_peer = $2`,
        [code, peer],
      );
      return Response.json({ code, peer, state: "ended", host: peer === room.host_peer }, { headers: { "cache-control": "no-store" } });
    }

    return failure("Unknown match action.", 400);
  } catch (error) {
    console.error("Arcana match request failed", error);
    return failure("The duel service is temporarily unavailable. Check the database connection and try again.", 503);
  }
}
