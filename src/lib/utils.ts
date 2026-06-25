import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Tailwind-aware className combiner used by every UI primitive. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Short, collision-resistant id without pulling in a uuid dependency. */
export function genId(prefix = "id"): string {
  const rand = Math.random().toString(36).slice(2, 10);
  const time = Date.now().toString(36);
  return `${prefix}_${time}${rand}`;
}

/** Clamp a number into [min, max]. */
export function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

/** Format an ISO timestamp as a friendly date-time. */
export function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

/** Map a 0-100 score to a semantic color token. */
export function scoreColor(score: number): "success" | "warning" | "destructive" {
  if (score >= 90) return "success";
  if (score >= 75) return "warning";
  return "destructive";
}

/** Round to one decimal place. */
export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
