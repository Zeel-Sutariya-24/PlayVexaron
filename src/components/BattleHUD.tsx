"use client";
import { ELEMENTS, STATUS_INFO, hex, type StatusId } from "@/game/elements";
import type { EndInfo, HudSnap } from "@/game/battle";
import { DIFFICULTY } from "@/game/ai";
import type { ScoreEntry } from "@/game/storage";
import { ElementIcon, SpellBadge } from "./icons";
import MusicVolumeControl from "./MusicVolumeControl";

interface Props {
  hud: HudSnap | null;
  touch: boolean;
  online?: boolean;
  onlineHost?: boolean;
  end: EndInfo | null;
  rank: number | null;
  name: string;
  scores: ScoreEntry[];
  onName: (n: string) => void;
  onPause: () => void;
  onResume: () => void;
  onRestart: () => void;
  onQuit: () => void;
  onLoadout: () => void;
  onSelect: (i: number) => void;
  musicVolume: number;
  onMusicVolume: (volume: number) => void;
}

function StatusRow({ list }: { list: StatusId[] }) {
  return (
    <div className="statuses">
      {list.map((s) => (
        <span key={s} className="chip st" style={{ color: STATUS_INFO[s].css, borderColor: STATUS_INFO[s].css }}>
          {STATUS_INFO[s].name}
        </span>
      ))}
    </div>
  );
}

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

export default function BattleHUD({ hud, touch, online = false, onlineHost = false, end, rank, name, scores, onName, onPause, onResume, onRestart, onQuit, onLoadout, onSelect, musicVolume, onMusicVolume }: Props) {
  if (!hud) return null;
  const hpPct = Math.max(0, hud.hp);
  const title = end ? (end.result === "win" ? "VICTORY" : end.result === "lose" ? (end.timedOut ? "TIME UP — DEFEAT" : "DEFEATED") : "DRAW") : "";
  const ci = Math.ceil(hud.countdown / 0.6);
  const ringBg = `conic-gradient(#ffd27a ${hud.charge * 360}deg, rgba(255,255,255,.15) 0deg)`;
  const selSlot = hud.slots.find((s) => s.selected);
  return (
    <div className={`hud ${touch ? "touch" : ""}`}>
      <div className={`vig vig-low ${hud.hp < 30 ? "on" : ""}`} />
      <div key={"h" + hud.lastHurt} className={`vig vig-hurt ${hud.lastHurt ? "go" : ""}`} />
      {hud.pStatus.includes("burn") && <div className="vig vig-burn" />}
      {(hud.pStatus.includes("chill") || hud.pStatus.includes("freeze")) && <div className="vig vig-frost" />}
      {hud.blind && <div className="vig vig-dust" />}
      {hud.pStatus.includes("stun") && <div className="vig vig-stun" />}

      <div className="hud-top">
        <div className="score-box">
          <small>{online ? "PLAYER DUEL" : "SCORE"}</small>
          <b>{online ? "ONLINE" : hud.score.toLocaleString()}</b>
          {!online && hud.combo > 1 && (
            <em key={hud.combo} className="combo">
              COMBO ×{hud.comboMult.toFixed(2)}
            </em>
          )}
        </div>
        <div className="enemy-box">
          <div className="en-name">
            {hud.enemyName}
            {hud.eAttune.length > 0 && (
              <span className="aura" title="Enemy attunement: hit with a counter-element for +20% damage">
                aura {hud.eAttune.map((e, i) => <ElementIcon key={i} el={e} size={14} />)}
              </span>
            )}
          </div>
          <div className="bar enemy">
            <i style={{ width: `${Math.max(0, hud.ehp)}%` }} />
            <span>{Math.ceil(Math.max(0, hud.ehp))}</span>
          </div>
          <StatusRow list={hud.eStatus} />
        </div>
        <div className="timer-box">
          <b className={hud.timeLeft < 20 ? "low" : ""}>{fmt(hud.timeLeft)}</b>
          <button className="icon-btn" onClick={onPause} aria-label={online && !onlineHost ? "Only the room host can pause" : "Pause"} disabled={online && !onlineHost}>
            ❚❚
          </button>
        </div>
      </div>

      <div className="crosshair" aria-hidden>
        <div className={`ring ${hud.charging ? "on" : ""} ${hud.charge >= 0.99 ? "full" : ""}`} style={{ background: ringBg }} />
        <div className="dot" />
        <div key={"m" + hud.lastHit} className={`hitmark ${hud.lastHit ? "go" : ""}`} />
        {selSlot && hud.charging && <div className="charge-label">{Math.round(hud.charge * 100)}%</div>}
      </div>

      <div className="toasts">
        {hud.toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            {t.text}
          </div>
        ))}
      </div>

      {hud.phase === "countdown" && (
        <div className="countdown" key={ci}>
          {ci >= 1 && ci <= 3 ? ci : "READY"}
        </div>
      )}

      <div className="hud-bars">
        <div className="bar hp">
          <i style={{ width: `${hpPct}%` }} />
          <span>♥ {Math.ceil(hpPct)}</span>
        </div>
        <div key={"mf" + hud.manaFlash} className={`bar mana ${hud.manaFlash > 0 ? "flash" : ""}`}>
          <i style={{ width: `${Math.max(0, hud.mana)}%` }} />
          <span>✦ {Math.floor(hud.mana)}</span>
        </div>
        <div className="dash-row">
          <div className={`dash ${hud.dashFrac >= 1 ? "ready" : ""}`}>
            <i style={{ width: `${hud.dashFrac * 100}%` }} />
            <span>DASH</span>
          </div>
          <StatusRow list={hud.pStatus} />
        </div>
      </div>

      <div className="hotbar">
        {hud.slots.map((s, i) => (
          <button
            key={s.id}
            className={`slot-btn ${s.selected ? "sel" : ""} ${s.cdFrac > 0 ? "cd" : ""} ${!s.afford ? "poor" : ""} ${s.adv > 0 ? "adv" : s.adv < 0 ? "dis" : ""}`}
            onPointerDown={(e) => {
              e.stopPropagation();
              onSelect(i);
            }}
            style={{ ["--c" as string]: hex(s.c1) }}
            title={s.name}
          >
            <span className="key">{i + 1}</span>
            <SpellBadge colors={[s.c1, s.c2]} type={s.type} size={touch ? 36 : 44} />
            <span className="nm">{s.name}</span>
            <span className="cost">{s.cost}</span>
            {s.adv !== 0 && <span className="advmark">{s.adv > 0 ? "▲ +20%" : "▼ −20%"}</span>}
            {s.cdFrac > 0 && (
              <span className="cdv" style={{ height: `${s.cdFrac * 100}%` }}>
                <b>{s.cdLeft.toFixed(1)}</b>
              </span>
            )}
          </button>
        ))}
      </div>

      {!touch && hud.phase === "playing" && !hud.locked && <div className="lock-hint">Click the arena to capture the mouse · Esc pauses</div>}

      {hud.phase === "paused" && online && !onlineHost && (
        <div className="overlay">
          <div className="modal panel">
            <h2>Duel paused</h2>
            <p className="hint">Waiting for the room host to resume the match.</p>
            <MusicVolumeControl compact value={musicVolume} onChange={onMusicVolume} />
            <div className="modal-btns"><button className="btn ghost" onClick={onQuit}>Leave duel</button></div>
          </div>
        </div>
      )}

      {hud.phase === "paused" && (!online || onlineHost) && (
        <div className="overlay">
          <div className="modal panel">
            <h2>Paused</h2>
            <div className="modal-btns">
              <button className="btn gold big" onClick={onResume}>
                Resume <em>Esc</em>
              </button>
              <button className="btn big" onClick={onRestart}>
                Restart duel <em>R</em>
              </button>
              <button className="btn" onClick={onLoadout}>
                Change spells
              </button>
              <button className="btn ghost" onClick={onQuit}>
                Quit to menu
              </button>
            </div>
            <MusicVolumeControl compact value={musicVolume} onChange={onMusicVolume} />
            <p className="hint">
              Charge spells up to 3s for power (costs extra mana). Dodge with Space. Elemental wheel: Water › Fire › Earth › Wind › Water.
            </p>
          </div>
        </div>
      )}

      {end && (
        <div className="overlay over">
          <div className={`modal panel result ${end.result}`}>
            <h1>{title}</h1>
            <div className="big-score">
              <small>FINAL SCORE</small>
              <b>{end.score.toLocaleString()}</b>
              <em>
                {DIFFICULTY[end.difficulty].label} ×{DIFFICULTY[end.difficulty].scoreMult}
              </em>
            </div>
            {rank !== null && (
              <div className="rank-box">
                <span>New high score — rank #{rank}</span>
                <input
                  value={name}
                  maxLength={14}
                  onChange={(e) => onName(e.target.value)}
                  placeholder="Your name"
                  aria-label="Name for the high-score table"
                />
              </div>
            )}
            <div className="breakdown">
              <div>
                <span>Damage dealt</span>
                <b>{Math.round(end.stats.damage)}</b>
              </div>
              <div>
                <span>Spells hit</span>
                <b>{end.stats.hits}</b>
              </div>
              <div>
                <span>Elemental counters</span>
                <b>{end.stats.counters}</b>
              </div>
              <div>
                <span>Dodges</span>
                <b>{end.stats.dodges}</b>
              </div>
              <div>
                <span>Deflects</span>
                <b>{end.stats.deflects}</b>
              </div>
              <div>
                <span>Wall blocks</span>
                <b>{end.stats.blocks}</b>
              </div>
              <div>
                <span>Environment combos</span>
                <b>{end.stats.env}</b>
              </div>
              <div>
                <span>Best combo</span>
                <b>×{end.stats.maxCombo}</b>
              </div>
              <div>
                <span>HP left</span>
                <b>{Math.ceil(end.hp)}</b>
              </div>
              <div>
                <span>Victory bonus</span>
                <b>{end.bonus ? `+${end.bonus.toLocaleString()}` : "—"}</b>
              </div>
            </div>
            {online ? (
              <div className="modal-btns"><p className="hint">The match is complete. Create a new room to duel again.</p><button className="btn gold big" onClick={onQuit}>Return to menu</button></div>
            ) : <div className="modal-btns row">
              <button className="btn gold big" onClick={onRestart} autoFocus>
                Rematch <em>R / Enter</em>
              </button>
              <button className="btn" onClick={onLoadout}>
                Change spells
              </button>
              <button className="btn ghost" onClick={onQuit}>
                Menu
              </button>
            </div>}
            {!online && scores.length > 0 && (
              <ol className="mini-scores">
                {scores.slice(0, 5).map((s, i) => (
                  <li key={s.date + "-" + i} className={rank === i + 1 ? "me" : ""}>
                    <span>{i + 1}</span>
                    <span>{s.name}</span>
                    <b>{s.score.toLocaleString()}</b>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      )}
      <span style={{ display: "none" }}>{ELEMENTS.fire.name}</span>
    </div>
  );
}
