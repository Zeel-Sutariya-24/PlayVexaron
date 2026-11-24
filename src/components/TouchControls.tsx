"use client";
import { useRef, useState } from "react";
import type { InputManager } from "@/game/input";

interface Props {
  getInput: () => InputManager | null;
}

const RADIUS = 58;

export default function TouchControls({ getInput }: Props) {
  const [stick, setStick] = useState<{ ox: number; oy: number; dx: number; dy: number } | null>(null);
  const joyId = useRef<number | null>(null);
  const lookId = useRef<number | null>(null);
  const lastLook = useRef({ x: 0, y: 0 });
  const [firing, setFiring] = useState(false);

  const joyDown = (e: React.PointerEvent) => {
    if (joyId.current !== null) return;
    joyId.current = e.pointerId;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setStick({ ox: e.clientX, oy: e.clientY, dx: 0, dy: 0 });
  };
  const joyMove = (e: React.PointerEvent) => {
    if (e.pointerId !== joyId.current || !stick) return;
    let dx = e.clientX - stick.ox;
    let dy = e.clientY - stick.oy;
    const l = Math.hypot(dx, dy);
    if (l > RADIUS) {
      dx = (dx / l) * RADIUS;
      dy = (dy / l) * RADIUS;
    }
    setStick({ ...stick, dx, dy });
    const inp = getInput();
    if (inp) {
      inp.joyX = Math.abs(dx) < 6 ? 0 : dx / RADIUS;
      inp.joyY = Math.abs(dy) < 6 ? 0 : -dy / RADIUS;
    }
  };
  const joyUp = (e: React.PointerEvent) => {
    if (e.pointerId !== joyId.current) return;
    joyId.current = null;
    setStick(null);
    const inp = getInput();
    if (inp) inp.joyX = inp.joyY = 0;
  };

  const lookDown = (e: React.PointerEvent) => {
    if (lookId.current !== null) return;
    lookId.current = e.pointerId;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    lastLook.current = { x: e.clientX, y: e.clientY };
  };
  const lookMove = (e: React.PointerEvent) => {
    if (e.pointerId !== lookId.current) return;
    const dx = e.clientX - lastLook.current.x;
    const dy = e.clientY - lastLook.current.y;
    lastLook.current = { x: e.clientX, y: e.clientY };
    getInput()?.addTouchLook(dx, dy);
  };
  const lookUp = (e: React.PointerEvent) => {
    if (e.pointerId === lookId.current) lookId.current = null;
  };

  const fireDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const inp = getInput();
    if (inp) inp.touchFire = true;
    setFiring(true);
  };
  const fireUp = (e: React.PointerEvent) => {
    e.stopPropagation();
    const inp = getInput();
    if (inp) inp.touchFire = false;
    setFiring(false);
  };
  const dash = (e: React.PointerEvent) => {
    e.stopPropagation();
    const inp = getInput();
    if (inp) inp.dashQueued = true;
  };

  return (
    <div className="touch-layer" onContextMenu={(e) => e.preventDefault()}>
      <div className="touch-joy" onPointerDown={joyDown} onPointerMove={joyMove} onPointerUp={joyUp} onPointerCancel={joyUp}>
        {!stick && <div className="joy-hint">MOVE</div>}
      </div>
      <div className="touch-look" onPointerDown={lookDown} onPointerMove={lookMove} onPointerUp={lookUp} onPointerCancel={lookUp}>
        <div className="look-hint">DRAG TO LOOK</div>
      </div>
      {stick && (
        <div className="joy-base" style={{ left: stick.ox - RADIUS, top: stick.oy - RADIUS }}>
          <div className="joy-knob" style={{ transform: `translate(${stick.dx}px, ${stick.dy}px)` }} />
        </div>
      )}
      <button className={`cast-btn ${firing ? "down" : ""}`} onPointerDown={fireDown} onPointerUp={fireUp} onPointerCancel={fireUp} aria-label="Cast spell (hold to charge)">
        <span>CAST</span>
        <small>hold to charge</small>
      </button>
      <button className="dash-btn" onPointerDown={dash} aria-label="Dash">
        DASH
      </button>
    </div>
  );
}
