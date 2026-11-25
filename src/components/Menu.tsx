"use client";
import type { ScoreEntry } from "@/game/storage";
import { DIFFICULTY } from "@/game/ai";
import MusicVolumeControl from "./MusicVolumeControl";

interface Props {
  spellCount: number;
  scores: ScoreEntry[];
  muted: boolean;
  musicVolume: number;
  touch: boolean;
  onLab: () => void;
  onBook: () => void;
  onDuel: () => void;
  onPvp: () => void;
  onTeamBattle: () => void;
  onMute: () => void;
  onMusicVolume: (volume: number) => void;
  onClearScores: () => void;
}

export default function Menu({ spellCount, scores, muted, musicVolume, touch, onLab, onBook, onDuel, onPvp, onTeamBattle, onMute, onMusicVolume, onClearScores }: Props) {
  const unlocked = spellCount >= 10;
  const remain = Math.max(0, 10 - spellCount);
  return (
    <div className="menu">
      <div className="menu-card panel">
        <div className="menu-topline"><span>VEXARON</span><span>ELEMENTAL ARENA / 01</span></div>
        <div className="brand-lockup">
          <img className="brand-logo" src="/vexaron-mark.png" alt="Vexaron emblem" />
          <div className="brand-copy">
            <p className="brand-kicker">FORGE YOUR ELEMENTAL LEGACY</p>
            <h1>VEXARON</h1>
          </div>
        </div>
        <p className="tag">Build your loadout. Read the field. Own the next round.</p>

        <div className="menu-btns">
          <button className="btn gold big" onClick={onLab}>
            ⚗ {spellCount === 0 ? "Enter the Magic Lab" : "Magic Lab"}
          </button>
          <button className="btn big" onClick={onBook}>
            ❖ Magic Book <em>{spellCount}/10</em>
          </button>
          <button className={`btn big ${unlocked ? "duel" : "locked"}`} onClick={onDuel}>
            {unlocked ? "⚔ Duel the AI" : `⚿ Duel the AI — forge ${remain} more`}
          </button>
          <button className="btn big" onClick={onTeamBattle}>✧ Squad Battles · 2v2 / 3v3</button>
          <button className="btn big ghost" onClick={onPvp}>
            ⚔ Duel a Player <em>online</em>
          </button>
        </div>

        <div className="unlock-bar" aria-hidden>
          <div style={{ width: `${Math.min(100, spellCount * 10)}%` }} />
        </div>

        <MusicVolumeControl value={musicVolume} onChange={onMusicVolume} />

        <div className="menu-foot">
          <button className="btn ghost sm" onClick={onMute}>
            {muted ? "✕ Sound off" : "♪ Sound on"}
          </button>
          <span className="hint">{touch ? "Touch: stick to move · drag to look · hold CAST to charge" : "WASD move · Mouse aim · Hold Click to charge · Space dash · 1-5 / Q E / wheel spells"}</span>
        </div>
      </div>

      <div className="menu-side">
        <div className="scores panel">
          <div className="panel-head">
            <h2>Field Record</h2>
            {scores.length > 0 && (
              <button className="btn ghost sm" onClick={onClearScores}>
                Clear
              </button>
            )}
          </div>
          {scores.length === 0 ? (
            <p className="empty">No match data yet. Your first result will appear here.</p>
          ) : (
            <ol>
              {scores.map((s, i) => (
                <li key={s.date + "-" + i} className={s.result}>
                  <span className="rank">{i + 1}</span>
                  <span className="nm">{s.name}</span>
                  <span className="df">{DIFFICULTY[s.difficulty].label}</span>
                  <b>{s.score.toLocaleString()}</b>
                </li>
              ))}
            </ol>
          )}
        </div>
        <div className="rules panel">
          <h3>Elemental Wheel</h3>
          <div className="wheel">
            <span style={{ color: "#38a8ff" }}>Water</span> › <span style={{ color: "#ff6a2b" }}>Fire</span> › <span style={{ color: "#98d95a" }}>Earth</span> › <span style={{ color: "#c4f6ff" }}>Wind</span> › <span style={{ color: "#38a8ff" }}>Water</span>
          </div>
          <p className="hint">Hit an enemy whose aura your element counters for +20% damage.</p>
        </div>
      </div>
    </div>
  );
}
