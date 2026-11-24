"use client";
import { useMemo } from "react";
import { BANDS, COMBOS, ELEMENTS, ELEMENT_ORDER, STATUS_INFO, buildSpell, tempBand, type ElementId, type SpellDef, type SpellType } from "@/game/elements";
import type { LabConfig } from "@/game/lab";
import { ElementIcon, SpellBadge, TypeIcon } from "./icons";

const TYPES: { id: SpellType; name: string; blurb: string }[] = [
  { id: "ball", name: "Ball", blurb: "Long-range projectile. Dodgeable." },
  { id: "slash", name: "Slash", blurb: "Close arc. Deflects balls." },
  { id: "wall", name: "Wall", blurb: "Blocks for 7s. Destructible." },
];

interface Props {
  config: LabConfig;
  spells: SpellDef[];
  notice: { text: string; kind: "good" | "bad" | "info"; n: number } | null;
  onPick: (e: ElementId) => void;
  onClear: (slot: number) => void;
  onTemp: (v: number) => void;
  onType: (t: SpellType) => void;
  onForge: () => void;
  onSurprise: () => void;
  onBook: () => void;
  onBack: () => void;
}

export function SpellStats({ def }: { def: SpellDef }) {
  const rows: [string, string][] = [];
  if (def.type === "ball") rows.push(["Damage", String(def.damage)], ["Speed", `${def.speed} m/s`]);
  else if (def.type === "slash") rows.push(["Damage", String(def.damage)], ["Range", `${def.range} m`]);
  else rows.push(["Wall HP", String(def.wallHp)], ["Lifetime", "7 s"]);
  rows.push(["Mana", String(def.manaCost)], ["Cooldown", `${def.cooldown}s`]);
  return (
    <div className="stats">
      {rows.map(([k, v]) => (
        <div key={k} className="stat">
          <span>{k}</span>
          <b>{v}</b>
        </div>
      ))}
    </div>
  );
}

export function Traits({ def }: { def: SpellDef }) {
  return (
    <div className="traits">
      {def.effects.map((e) => (
        <span key={e.id} className="chip" style={{ borderColor: STATUS_INFO[e.id].css, color: STATUS_INFO[e.id].css }} title={STATUS_INFO[e.id].desc}>
          {STATUS_INFO[e.id].name}
          {e.chance < 1 ? ` ${Math.round(e.chance * 100)}%` : ""}
        </span>
      ))}
      {def.traits
        .filter((t) => !def.effects.some((e) => t.startsWith(STATUS_INFO[e.id].name)))
        .map((t) => (
          <span key={t} className="chip">
            {t}
          </span>
        ))}
    </div>
  );
}

export default function LabPanel({ config, spells, notice, onPick, onClear, onTemp, onType, onForge, onSurprise, onBook, onBack }: Props) {
  const { picks, temp, type } = config;
  const preview = useMemo(() => (picks.length ? buildSpell({ a: picks[0], b: picks[1] ?? picks[0], temp, type }) : null), [picks, temp, type]);
  const dup = preview ? spells.some((s) => s.id === preview.id) : false;
  const band = tempBand(temp);
  const count = spells.length;
  const slotEl = (i: number): ElementId | null => picks[i] ?? (i === 1 && picks.length === 1 ? picks[0] : null);

  return (
    <aside className="lab-panel panel">
      <div className="panel-head">
        <button className="btn ghost sm" onClick={onBack} aria-label="Back to menu">
          ‹ Menu
        </button>
        <h2>Crystal Interface</h2>
        <button className="btn ghost sm" onClick={onBook}>
          Book {count}/10
        </button>
      </div>

      <section>
        <h3>1 · Elements <small>choose two sources in the lab or here</small></h3>
        <div className="el-row">
          {ELEMENT_ORDER.map((id) => {
            const n = picks.filter((p) => p === id).length;
            return (
              <button key={id} className={`el-btn ${n ? "on" : ""}`} style={{ ["--c" as string]: ELEMENTS[id].css }} onClick={() => onPick(id)}>
                <ElementIcon el={id} size={26} />
                <span>{ELEMENTS[id].name}</span>
                <small>{ELEMENTS[id].blurb}</small>
                {n > 0 && <i className="count">{n}</i>}
              </button>
            );
          })}
        </div>
        <div className="slots">
          {[0, 1].map((i) => {
            const el = slotEl(i);
            const ghost = i === 1 && picks.length === 1;
            return (
              <button key={i} className={`slot ${el ? "full" : ""} ${ghost ? "ghost" : ""}`} onClick={() => el && !ghost && onClear(i)} style={el ? { ["--c" as string]: ELEMENTS[el].css } : undefined} title={el && !ghost ? "Click to remove" : ""}>
                {el ? <ElementIcon el={el} size={22} /> : <span className="plus">+</span>}
                <span>{el ? ELEMENTS[el].name : `Element ${i + 1}`}</span>
                {ghost && <em>pure</em>}
              </button>
            );
          })}
          <div className="combo-name">{preview ? preview.comboName : "—"}</div>
        </div>
      </section>

      <section>
        <h3>
          2 · Temperature <b style={{ color: band.css }}>{temp > 0 ? "+" : ""}{temp}°</b> <span className="band" style={{ color: band.css }}>{band.label}</span>
        </h3>
        <div className="temp-wrap">
          <button className="btn ghost sm" onClick={() => onTemp(Math.max(-100, temp - 10))} aria-label="Colder">
            −
          </button>
          <input type="range" min={-100} max={100} step={1} value={temp} onChange={(e) => onTemp(Number(e.target.value))} className="temp-range" aria-label="Temperature" />
          <button className="btn ghost sm" onClick={() => onTemp(Math.min(100, temp + 10))} aria-label="Hotter">
            +
          </button>
        </div>
        <div className="bands">
          {BANDS.map((b) => (
            <span key={b.id} className={b.id === band.id ? "cur" : ""} style={{ color: b.css }} onClick={() => onTemp(b.id === "frozen" ? -80 : b.id === "chilled" ? -40 : b.id === "temperate" ? 0 : b.id === "heated" ? 40 : 80)}>
              {b.label}
            </span>
          ))}
        </div>
        <p className="hint">{band.desc}</p>
      </section>

      <section>
        <h3>3 · Spell type</h3>
        <div className="type-row">
          {TYPES.map((t) => (
            <button key={t.id} className={`type-btn ${type === t.id ? "on" : ""}`} onClick={() => onType(t.id)}>
              <TypeIcon type={t.id} size={22} />
              <b>{t.name}</b>
              <small>{t.blurb}</small>
            </button>
          ))}
        </div>
      </section>

      <section className="preview">
        {preview ? (
          <>
            <div className="pv-head">
              <SpellBadge def={preview} size={52} />
              <div>
                <div className="pv-name">{preview.name}</div>
                <div className="pv-sub">{COMBOS[preview.combo].tag}</div>
              </div>
            </div>
            <SpellStats def={preview} />
            <Traits def={preview} />
            <div className={`dupe ${dup ? "bad" : "good"}`}>{dup ? "Already in your Magic Book — change type or cross a temperature band." : "New spell — ready to forge!"}</div>
          </>
        ) : (
          <div className="pv-empty">Pick an element to see what the crystal can make.</div>
        )}
      </section>

      <div className="forge-row">
        <button className="btn gold big" disabled={!preview || dup} onClick={onForge}>
          ✦ Forge Spell
        </button>
        <button className="btn sm" onClick={onSurprise} title="Forge a random new spell">
          ✧ Surprise me
        </button>
      </div>
      <div className="progress" aria-label={`${count} of 10 spells forged`}>
        <div style={{ width: `${Math.min(100, count * 10)}%` }} />
        <span>{count >= 10 ? "Battle mode unlocked!" : `${count}/10 spells to unlock battle`}</span>
      </div>
      {notice && (
        <div key={notice.n} className={`notice ${notice.kind}`}>
          {notice.text}
        </div>
      )}
      <p className="keys">Drag to look · A/D orbit · Wheel = temperature · Click the crystal to forge · Q/E temp</p>
    </aside>
  );
}
