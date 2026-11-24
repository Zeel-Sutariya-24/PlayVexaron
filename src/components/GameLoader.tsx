"use client";
import dynamic from "next/dynamic";

const Game = dynamic(() => import("./Game"), {
  ssr: false,
  loading: () => <div className="loading">Summoning the arena…</div>,
});

export default function GameLoader() {
  return <Game />;
}
