import type { Intent } from "./sim";
import type { SpellDef } from "./elements";

export type MatchState = "waiting" | "ready" | "active" | "ended";
export interface MatchInfo {
  code: string;
  peer: string;
  state: MatchState;
  teamSize?: 1 | 2 | 3;
  host: boolean;
  opponentLoadout?: SpellDef[];
  opponentName?: string;
  input?: { intent: Intent; yaw: number; pitch: number; seq: number };
  snapshot?: string;
}

async function request<T>(body: Record<string, unknown>): Promise<T> {
  const res = await fetch("/api/matches", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), cache: "no-store",
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Could not reach the duel server.");
  return data as T;
}

export const createMatch = (peer: string, loadout: SpellDef[], teamSize: 1 | 2 | 3 = 1) => request<MatchInfo>({ action: "create", peer, loadout, teamSize });
export const joinMatch = (peer: string, code: string, loadout: SpellDef[], teamSize: 1 | 2 | 3 = 1) => request<MatchInfo>({ action: "join", peer, code, loadout, teamSize });
export const pollMatch = (peer: string, code: string) => request<MatchInfo>({ action: "poll", peer, code });
export const startMatch = (peer: string, code: string) => request<MatchInfo>({ action: "start", peer, code });
export const syncAsHost = (peer: string, code: string, snapshot: string) =>
  request<MatchInfo>({ action: "hostSync", peer, code, snapshot });
export const syncAsGuest = (peer: string, code: string, intent: Intent, yaw: number, pitch: number, seq: number) =>
  request<MatchInfo>({ action: "guestSync", peer, code, intent, yaw, pitch, seq });
export const leaveMatch = (peer: string, code: string) => request<MatchInfo>({ action: "leave", peer, code });

export const newPeerId = () => crypto.randomUUID();
export const PVP_AVAILABLE = true;
