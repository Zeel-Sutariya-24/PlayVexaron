"use client";

interface Props {
  value: number;
  onChange: (value: number) => void;
  compact?: boolean;
}

export default function MusicVolumeControl({ value, onChange, compact = false }: Props) {
  return (
    <label className={`music-control ${compact ? "compact" : ""}`}>
      <span className="music-control-label">Music volume</span>
      <input
        aria-label="Music volume"
        type="range"
        min="0"
        max="1"
        step="0.01"
        value={value}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
      />
      <output>{Math.round(value * 100)}%</output>
    </label>
  );
}
