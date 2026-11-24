"use client";
import { useMemo, useState } from "react";
import { ELEMENTS, tempBand, type Difficulty, type SpellDef } from "@/game/elements";
import { DIFFICULTY } from "@/game/ai";
import { ElementIcon, SpellBadge } from "./icons";
import { SpellStats, Traits } from "./LabPanel";

interface Props {
  mode: "browse" | "loadout";
  spells: SpellDef[];
  loadout: string[];
  difficulty: Difficulty;
  onToggle: (id: string) => void;
  onAuto: () => void;
  onDifficulty: (d: Difficulty) => void;
  onDelete: (id: string) => void;
  onQuickForge: () => void;
  onLab: () => void;
  onBack: () => void;
  onFight: () => void;
}

export default function BookPanel({ mode, spells, loadout, difficulty, onToggle, onAuto, onDifficulty, onDelete, onQuickForge, onLab, onBack, onFight }: Props) {
  const [sel, setSel] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "ball" | "slash" | "wall">("all");
  const shown = useMemo(() => spells.filter((s) => filter === "all" || s.type === filter), [spells, filter]);
  const cur = spells.find((s) => s.id === sel) ?? null;
  const unlocked = spells.length >= 10;
  const load = mode === "loadout";

  return (
    <div className="book-wrap">
      <div className={`book-spread ${load ? "load-mode" : "browse-mode"}`}>
        <section className="book-leaf book-controls" aria-label="Spellbook controls">
          <div className="book-imprint"><span>VEXARON</span><i>FIELD GRIMOIRE · 01</i></div>
          <header className="book-page-heading">
            <button className="btn ghost sm book-back" onClick={onBack}>‹ Menu</button>
            <span className="book-overline">{load ? "SELECT YOUR ARSENAL" : "SPELL ARCHIVE"}</span>
            <h2>{load ? "Choose your five" : "Magic Book"}</h2>
            <span className="book-page-count">{load ? `${loadout.length} / 5 EQUIPPED` : `${spells.length} ENTRIES`}</span>
          </header>

          {load ? (
            <p className="book-intro">Choose five spells for your next duel. Your selected leaves glow in the archive.</p>
          ) : (
            <p className="book-intro">Every spell you forge is bound here. Select a leaf to study its properties.</p>
          )}

          {!unlocked && !load && (
            <div className="locked-note">
              Battle mode unlocks at <b>10 unique spells</b> — you have {spells.length}.
              <button className="btn sm gold" onClick={onLab}>Go to the Lab</button>
              <button className="btn sm" onClick={onQuickForge}>Quick-forge to 10</button>
            </div>
          )}

          <div className="book-rule"><span>ARRANGE LEAVES</span><i /></div>
          <div className="filters" aria-label="Filter spells by type">
            {(["all", "ball", "slash", "wall"] as const).map((f) => (
              <button key={f} className={`btn sm ${filter === f ? "gold" : "ghost"}`} aria-pressed={filter === f} onClick={() => setFilter(f)}>
                {f === "all" ? "All spells" : f[0].toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>

          <div className="book-side-mark" aria-hidden>
            <span>✦</span><i>FIRE · WATER · WIND · EARTH</i><span>✦</span>
          </div>

          {!load && (
            <div className="book-actions">
              <button className="btn gold" onClick={onLab}>✦ Forge more</button>
              <button className="btn sm" onClick={onQuickForge}>Quick-forge random spells</button>
            </div>
          )}
          <span className="book-folio">VEXARON FIELD NOTES <b>01</b></span>
        </section>

        <section className="book-leaf book-index-page" aria-label="Spell pages">
          <div className="book-page-top"><span>BOUND INCANTATIONS</span><span>FOLIO 02 <i>✦</i></span></div>
          <div className="book-section-heading">
            <div><span>THE COLLECTION</span><h3>{filter === "all" ? "Spell leaves" : `${filter} spells`}</h3></div>
            <span className="index-count">{shown.length.toString().padStart(2, "0")} / {spells.length.toString().padStart(2, "0")}</span>
          </div>
          <div className="spell-grid">
            {shown.length === 0 && <p className="empty book-empty">No spells yet. Visit the Magic Lab to forge your first one.</p>}
            {shown.map((s, index) => {
              const on = loadout.includes(s.id);
              const band = tempBand(s.temp);
              return (
                <button
                  key={s.id}
                  className={`spell-card ${on ? "equipped" : ""} ${sel === s.id ? "sel" : ""}`}
                  onClick={() => {
                    setSel(s.id);
                    if (load) onToggle(s.id);
                  }}
                  aria-pressed={load ? on : sel === s.id}
                  style={{ ["--c1" as string]: "#" + s.colors[0].toString(16).padStart(6, "0"), ["--c2" as string]: "#" + s.colors[1].toString(16).padStart(6, "0") }}
                >
                  <span className="leaf-index">{(index + 1).toString().padStart(2, "0")}</span>
                  <SpellBadge def={s} size={42} />
                  <div className="sc-body">
                    <div className="sc-name">{s.name}</div>
                    <div className="sc-meta">
                      <ElementIcon el={s.elements[0]} size={13} />
                      <ElementIcon el={s.elements[1]} size={13} />
                      <span>{s.type}</span>
                      <span style={{ color: band.css }}>{s.temp > 0 ? "+" : ""}{s.temp}°</span>
                    </div>
                    <div className="sc-meta dim">
                      {s.type === "wall" ? `HP ${s.wallHp}` : `DMG ${s.damage}`} · {s.manaCost} mana · {s.cooldown}s
                    </div>
                  </div>
                  {load && <i className="check">{on ? "✓" : ""}</i>}
                </button>
              );
            })}
          </div>
          <div className="book-page-bottom"><span>MAGIC IS MADE, NOT FOUND</span><span>02</span></div>
        </section>

        <section className="book-leaf book-detail-page" aria-label={load ? "Loadout and spell details" : "Selected spell details"}>
          <div className="book-page-top"><span>{load ? "DUEL LOADOUT" : "STUDY THE SPELL"}</span><span>FOLIO 03 <i>✦</i></span></div>
          {cur ? (
            <div className="detail book-detail">
              <div className="pv-head">
                <SpellBadge def={cur} size={52} />
                <div>
                  <div className="pv-name">{cur.name}</div>
                  <div className="pv-sub">{cur.desc}</div>
                </div>
                {!load && <button className="btn ghost sm danger" onClick={() => { onDelete(cur.id); setSel(null); }} title="Remove from book">✕</button>}
              </div>
              <SpellStats def={cur} />
              <Traits def={cur} />
              <p className="hint">Elements: {ELEMENTS[cur.elements[0]].name} + {ELEMENTS[cur.elements[1]].name} · {tempBand(cur.temp).label}</p>
            </div>
          ) : (
            <div className="book-detail-empty">
              <span className="detail-rune">✧</span>
              <b>{load ? "Choose a spell leaf" : "Select a spell"}</b>
              <p>{load ? "Its details will appear here as you build your loadout." : "Its traits and combat details will appear here."}</p>
            </div>
          )}

          {load ? (
            <div className="loadout-foot">
              <div className="book-rule"><span>DUEL DIFFICULTY</span><i /></div>
              <div className="diff-row">
                {(Object.keys(DIFFICULTY) as Difficulty[]).map((d) => (
                  <button key={d} className={`diff ${difficulty === d ? "on" : ""}`} onClick={() => onDifficulty(d)}>
                    <b>{DIFFICULTY[d].label}</b>
                    <small>{DIFFICULTY[d].desc}</small>
                    <em>×{DIFFICULTY[d].scoreMult} score</em>
                  </button>
                ))}
              </div>
              <button className="btn sm" onClick={onAuto}>Auto-pick balanced 5</button>
              <button className="btn gold big" disabled={loadout.length !== 5} onClick={onFight}>⚔ Begin Duel</button>
              {loadout.length !== 5 && <p className="hint center">Select exactly 5 spells ({loadout.length}/5).</p>}
            </div>
          ) : (
            <div className="book-detail-prompt"><span>✦</span><i>Touch a spell leaf to reveal its secrets.</i></div>
          )}
          <span className="book-folio">VEXARON FIELD NOTES <b>03</b></span>
        </section>
      </div>
    </div>
  );
}
