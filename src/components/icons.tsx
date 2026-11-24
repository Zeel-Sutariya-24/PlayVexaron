"use client";
import type { ReactNode } from "react";
import { ELEMENTS, hex, type ElementId, type SpellDef, type SpellType } from "@/game/elements";

export function ElementIcon({ el, size = 20, color }: { el: ElementId; size?: number; color?: string }) {
  const c = color ?? ELEMENTS[el].css;
  let body: ReactNode;
  switch (el) {
    case "fire":
      body = <path d="M12 2c1 4 5 6 5 11a5 5 0 0 1-10 0c0-2 1-3.5 2-4.5 0 2 1 3 2 3 0-4-1-6 1-9.5z" fill={c} />;
      break;
    case "water":
      body = <path d="M12 2.5c3 4.5 6 7.5 6 11a6 6 0 0 1-12 0c0-3.5 3-6.5 6-11z" fill={c} />;
      break;
    case "wind":
      body = (
        <g fill="none" stroke={c} strokeWidth="2.2" strokeLinecap="round">
          <path d="M3 8h10a3 3 0 1 0-3-3" />
          <path d="M3 12h15a3 3 0 1 1-3 3" />
          <path d="M3 16h7a2.5 2.5 0 1 1-2.5 2.5" />
        </g>
      );
      break;
    default:
      body = <path d="M2 20 9 7l4 6 3-4 6 11z" fill={c} />;
  }
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} style={{ filter: `drop-shadow(0 0 4px ${c})`, flex: "none" }} aria-hidden>
      {body}
    </svg>
  );
}

export function TypeIcon({ type, size = 18, color = "#fff" }: { type: SpellType; size?: number; color?: string }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ flex: "none" }}>
      {type === "ball" && (
        <>
          <circle cx="12" cy="12" r="5" fill={color} fillOpacity=".35" />
          <path d="M3 12h3M18 12h3M12 3v3M12 18v3" opacity=".6" />
        </>
      )}
      {type === "slash" && (
        <>
          <path d="M4 20C8 8 14 4 21 3" strokeWidth="3" />
          <path d="M7 21C11 12 15 8 21 7" opacity=".5" />
        </>
      )}
      {type === "wall" && (
        <>
          <rect x="3" y="5" width="18" height="14" rx="1.5" fill={color} fillOpacity=".2" />
          <path d="M3 12h18M9 5v7M15 12v7" />
        </>
      )}
    </svg>
  );
}

export function SpellBadge({ def, size = 44, elements, colors, type }: { def?: SpellDef; size?: number; elements?: [ElementId, ElementId]; colors?: [number, number]; type?: SpellType }) {
  const cols = def?.colors ?? colors ?? [ELEMENTS[elements?.[0] ?? "fire"].color, ELEMENTS[elements?.[1] ?? "water"].color];
  const t = def?.type ?? type ?? "ball";
  const c1 = hex(cols[0]);
  const c2 = hex(cols[1]);
  return (
    <div
      className="badge"
      style={{
        width: size,
        height: size,
        border: `2px solid ${c1}`,
        background: `radial-gradient(circle at 30% 28%, rgba(255,255,255,.75), transparent 38%), conic-gradient(from 20deg, ${c1}, ${c2}, ${c1})`,
        boxShadow: `0 0 ${size * 0.35}px ${c1}88, inset 0 0 ${size * 0.25}px #0006`,
      }}
    >
      <TypeIcon type={t} size={size * 0.5} />
    </div>
  );
}
