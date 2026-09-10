// ───────────────────────────────────────────────────────────────────────────
// Export helpers — serialize an Audit to CSV (opens in Excel) or JSON.
// PDF export is handled in the UI via a print-optimized report view
// (window.print → "Save as PDF"), which needs no server-side rendering deps.
// ───────────────────────────────────────────────────────────────────────────

import type { Audit, ParagraphAudit } from "./audit/types";
import { explainParagraph } from "./audit/scoring";

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

/**
 * A full reviewer/client-facing QA document. Unlike the CSV (one row per
 * finding) this walks the page in order and, for EVERY paragraph, states why
 * it carries its status and which checks produced that verdict — including
 * the paragraphs that passed, which a findings-only export leaves invisible.
 */
export function auditToMarkdown(audit: Audit): string {
  const L: string[] = [];
  const s = audit.summary;
  const badge = (st: string) => st.toUpperCase();

  L.push(`# QA review — ${audit.title}`);
  L.push("");
  L.push(`- **Page:** ${audit.finalUrl}`);
  L.push(`- **Dealership:** ${audit.dealership?.name || "—"}${audit.dealership?.website ? ` (${audit.dealership.website})` : ""}`);
  L.push(`- **Reviewer:** ${audit.reviewer}`);
  L.push(`- **Audited:** ${new Date(audit.createdAt).toLocaleString()}`);
  L.push(`- **Analyzer:** ${audit.llmProvider}`);
  L.push(`- **Overall score:** ${audit.score.overall}/100 — facts ${audit.score.facts}, grammar ${audit.score.grammar}, links ${audit.score.links}, compliance ${audit.score.compliance}, SEO ${audit.score.seo}`);
  L.push(`- **Findings:** ${s.pass} pass · ${s.warning} warning · ${s.fail} fail · ${s.brokenLinks}/${s.totalLinks} links broken · ${s.wordCount} words`);
  L.push("");
  L.push("## How to read this");
  L.push("");
  L.push("Every paragraph below lists the checks that ran against it and the reason for its verdict.");
  L.push("");
  L.push("A **PASS** means one of two different things, and the reason line says which:");
  L.push("");
  L.push("- *checked against an authoritative source and matched* — a figure was verified.");
  L.push("- *nothing here states a checkable fact* — there was nothing to verify. This is **not** the same as verified.");
  L.push("");
  L.push("Where an automated check could not settle a claim, an **Answer** is given with the source it rests on. Cited sources are fetched before publication; any that did not resolve were removed and are marked as such.");
  L.push("");
  L.push("## Paragraph-by-paragraph review");

  for (const p of audit.paragraphs as ParagraphAudit[]) {
    const comp = audit.compliance.filter((c) => c.paragraphIndex === p.index);
    const { headline, checks } = explainParagraph(p, comp.length);
    L.push("");
    L.push(`### Paragraph ${p.index + 1} — ${badge(p.status)}`);
    L.push("");
    L.push(`> ${p.content}`);
    L.push("");
    L.push(`**Verdict:** ${headline}`);
    L.push("");
    L.push(`**Checks run:**`);
    for (const c of checks) L.push(`- ${c}`);

    for (const c of p.claims) {
      L.push("");
      L.push(`**Claim (${badge(c.status)}) — ${c.type.replace(/_/g, " ")}${c.value ? ` \`${c.value}\`` : ""}**`);
      L.push(`- ${c.verification}`);
      if (c.officialValue) L.push(`- Authoritative value: **${c.officialValue}**`);
      if (c.suggestedCorrection) L.push(`- Suggested correction: ${c.suggestedCorrection}`);
      if (c.answer) {
        L.push(`- **${c.answer.unresolved ? "Needs a human" : "Answer"}:** ${c.answer.answer}`);
        L.push(`  - Basis: ${c.answer.basis}`);
        if (c.answer.sourceUrl) L.push(`  - Source (verified live): ${c.answer.sourceUrl}`);
        L.push(`  - Confidence: ${Math.round(c.answer.confidence * 100)}%`);
      }
      if (c.sourceUrl) L.push(`- Source: ${c.sourceUrl}`);
    }

    for (const i of p.issues) {
      L.push("");
      L.push(`**${i.kind.replace(/_/g, " ")} (${badge(i.severity)}):** ${i.message}`);
      if (i.excerpt) L.push(`- Excerpt: "${i.excerpt}"`);
      if (i.suggestion) L.push(`- Suggestion: ${i.suggestion}`);
    }

    for (const c of comp) {
      L.push("");
      L.push(`**Compliance (${badge(c.severity)}):** "${c.phrase}" — ${c.rule}`);
      L.push(`- ${c.recommendation}`);
      if (c.sourceUrl) L.push(`- Guidance: ${c.sourceUrl}`);
    }
  }

  const bad = audit.links.filter((l) => l.status !== "pass");
  L.push("");
  L.push(`## Links (${audit.links.length} checked, ${bad.length} with issues)`);
  if (!bad.length) {
    L.push("");
    L.push("All links resolved cleanly.");
  } else {
    for (const l of bad) {
      L.push("");
      L.push(`- **${badge(l.status)}** ${l.url}`);
      if (l.error) L.push(`  - ${l.error}`);
      if (l.httpStatus) L.push(`  - HTTP ${l.httpStatus}`);
      if (l.redirectedTo) L.push(`  - Redirects to: ${l.redirectedTo}`);
    }
  }

  if (audit.ratings.length) {
    L.push("");
    L.push("## Rating / reviews");
    for (const r of audit.ratings) {
      L.push("");
      L.push(`- **${badge(r.status)}** displayed ${r.displayedRating ?? "?"}★ / ${r.displayedReviewCount ?? "?"} reviews`);
      if (r.currentRating != null) L.push(`  - Live: ${r.currentRating}★ / ${r.currentReviewCount ?? "?"} reviews`);
      if (r.recommendation) L.push(`  - ${r.recommendation}`);
      if (r.sourceUrl) L.push(`  - Profile: ${r.sourceUrl}`);
    }
  }

  L.push("");
  L.push("## Reviewer sign-off");
  L.push("");
  const rv = audit.review;
  const tick = (b: boolean) => (b ? "x" : " ");
  L.push(`- [${tick(rv.factVerified)}] Facts verified`);
  L.push(`- [${tick(rv.grammarChecked)}] Grammar checked`);
  L.push(`- [${tick(rv.linksChecked)}] Links checked`);
  L.push(`- [${tick(rv.complianceChecked)}] Compliance checked`);
  L.push(`- [${tick(rv.approved)}] Approved for publication`);
  L.push("");
  L.push(`---`);
  L.push(`_Generated by DealerQA AI for ${audit.reviewer}._`);
  return L.join("\n");
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
