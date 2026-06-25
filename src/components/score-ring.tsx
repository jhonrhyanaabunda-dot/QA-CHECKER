"use client";

import { scoreColor } from "@/lib/utils";

/** Circular score gauge (0-100) used on the report and dashboard. */
export function ScoreRing({
  score,
  size = 132,
  label = "Overall",
}: {
  score: number;
  size?: number;
  label?: string;
}) {
  const stroke = size * 0.09;
  const radius = (size - stroke) / 2;
  const circ = 2 * Math.PI * radius;
  const offset = circ - (score / 100) * circ;
  const color = scoreColor(score);
  const colorVar =
    color === "success" ? "hsl(var(--success))"
    : color === "warning" ? "hsl(var(--warning))"
    : "hsl(var(--destructive))";

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="hsl(var(--secondary))"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={colorVar}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={offset}
          className="transition-all duration-700"
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className="text-3xl font-bold tabular-nums">{Math.round(score)}</span>
        <span className="text-xs text-muted-foreground">{label}</span>
      </div>
    </div>
  );
}
