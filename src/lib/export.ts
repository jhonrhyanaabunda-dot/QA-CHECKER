// ───────────────────────────────────────────────────────────────────────────
// Export helpers — serialize an Audit to CSV (opens in Excel) or JSON.
// PDF export is handled in the UI via a print-optimized report view
// (window.print → "Save as PDF"), which needs no server-side rendering deps.
// ───────────────────────────────────────────────────────────────────────────

import type { Audit } from "./audit/types";

function esc(v: unknown): string {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** A flat, reviewer-friendly CSV: one row per claim, link, and finding. */
export function auditToCsv(audit: Audit): string {
  const rows: string[][] = [];
  rows.push(["Section", "Status", "Type", "Item", "Detail", "Suggested correction", "Source", "Source URL", "Confidence"]);

  for (const p of audit.paragraphs) {
    for (const c of p.claims) {
      rows.push([
        `Paragraph ${p.index + 1}`,
        c.status,
        c.type,
        c.value || c.text.slice(0, 80),
        c.verification + (c.answer ? ` | ANSWER: ${c.answer.answer} (${c.answer.basis})` : ""),
        c.suggestedCorrection || "",
        c.source || "",
        c.sourceUrl || c.answer?.sourceUrl || "",
        String(c.confidence),
      ]);
    }
    for (const i of p.issues) {
      rows.push([`Paragraph ${p.index + 1}`, i.severity, i.kind, i.message, i.excerpt || "", i.suggestion || "", "", "", ""]);
    }
  }
  for (const c of audit.pageLevelClaims) {
    rows.push(["Page-level", c.status, c.type, c.value || c.text.slice(0, 80), c.verification, c.suggestedCorrection || "", c.source || "", c.sourceUrl || "", String(c.confidence)]);
  }
  for (const l of audit.links) {
    rows.push(["Link", l.status, "link", l.url, l.error || `HTTP ${l.httpStatus ?? ""}`, l.redirectedTo || "", "", l.url, ""]);
  }
  for (const c of audit.compliance) {
    rows.push(["Compliance", c.severity, c.rule, c.phrase, c.excerpt, c.recommendation, "FTC guidance", c.sourceUrl || "", ""]);
  }
  for (const r of audit.ratings) {
    rows.push(["Rating", r.status, "rating", `${r.displayedRating ?? "?"}★ / ${r.displayedReviewCount ?? "?"} reviews`, r.currentRating ? `Live: ${r.currentRating}★ / ${r.currentReviewCount}` : "", r.recommendation || "", r.source, r.sourceUrl || "", ""]);
  }

  return rows.map((r) => r.map(esc).join(",")).join("\n");
}

export function auditToJson(audit: Audit): string {
  return JSON.stringify(audit, null, 2);
}

export function exportFilename(audit: Audit, ext: string): string {
  const slug =
    audit.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 50) || "audit";
  return `dealerqa-${slug}-${audit.id.slice(-6)}.${ext}`;
}
