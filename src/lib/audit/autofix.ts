// ───────────────────────────────────────────────────────────────────────────
// Auto-fix engine — turns detected errors into concrete CORRECTED revisions a
// developer can apply directly. It rewrites each flagged paragraph (swapping a
// wrong MPG figure for the EPA value, fixing spelling, neutralizing unsupported
// superlatives, etc.) and lists the actions needed for links and ratings.
//
// Deterministic by default (works with zero AI setup); when an LLM provider is
// configured it additionally polishes the corrected prose. Anything that can't
// be auto-corrected (time-sensitive offers with no known-correct value, broken
// link targets) is listed under "needs developer confirmation" with a verify
// link rather than guessed at.
// ───────────────────────────────────────────────────────────────────────────

import { completeJson, activeProvider, providerLabel } from "../llm";
import { resolveFromDealerSite, pickCorrectValue, type CorrectValue } from "./resolve-correct";
import type { Audit, ComplianceFinding, ParagraphAudit, Claim } from "./types";

export interface FixChange {
  kind: "fact" | "spelling" | "grammar" | "compliance" | "offer" | "contact";
  from: string;
  to: string;
  reason: string;
  /** Dealer-site page the correct value came from, when applicable. */
  sourceUrl?: string;
}

export interface ParagraphFix {
  paragraphIndex: number;
  original: string;
  corrected: string;
  changes: FixChange[];
}

export interface AutoFixResult {
  paragraphFixes: ParagraphFix[];
  linkActions: { url: string; status: string; action: string }[];
  ratingActions: string[];
  needsConfirmation: { location: string; issue: string; verifyUrl?: string }[];
  counts: { paragraphs: number; changes: number; links: number; manual: number };
  generatedBy: string;
}

const tidy = (s: string) =>
  s.replace(/\s{2,}/g, " ").replace(/\s+([.,!?;:])/g, "$1").replace(/\(\s+/g, "(").trim();

/** Remove/neutralize an unsupported superlative phrase. */
function neutralizeCompliance(phrase: string): string {
  let p = phrase;
  p = p.replace(/\bthe\s+best\s+/gi, "a ");
  p = p.replace(/\bbest\s+/gi, "");
  p = p.replace(/\blowest\s+(prices?|rates?)\b/gi, "competitive $1");
  p = p.replace(/\b(?:#\s?1|number\s+one|no\.\s?1|top[-\s]?rated)\b/gi, "");
  p = p.replace(/\bindustry[-\s]?leading\b/gi, "");
  p = p.replace(/\bgame[-\s]?chang(?:ing|er)\b/gi, "notable");
  p = p.replace(/\b(?:guaranteed?\s+(?:lowest|best)|unbeatable|cheapest)\b/gi, "");
  p = p.replace(/\bnobody\s+beats\b/gi, "");
  p = p.replace(/\b(?:everyone|nobody)\s+(?:approved|qualifies|beats)\b/gi, "financing options available");
  return tidy(p);
}

const DEALER_FIXABLE = ["pricing", "lease", "incentive", "warranty", "phone", "rating", "review_count"];

function withCommas(n: string): string {
  const digits = n.replace(/[^\d]/g, "");
  return digits ? Number(digits).toLocaleString() : n;
}

/**
 * Correct a wrong value on the audited page to the right value found on the
 * dealership's own website. Returns the new text and the change, or null if the
 * value couldn't be located/replaced. Returns the text unchanged (no change)
 * when the page already matches the dealer site (resolved, nothing to edit).
 */
function applyDealerFix(
  text: string,
  claim: Claim,
  cv: CorrectValue,
  dealerName: string,
): { text: string; change?: FixChange } | null {
  const reason = `Corrected to the current value on ${dealerName}'s website`;
  const sourceUrl = cv.sourceUrl;

  switch (claim.type) {
    case "lease": {
      // Swap only the monthly price token so "/mo for 36 months" is preserved.
      const claimPrice = claim.value?.match(/\$[\d,]+/)?.[0];
      const cvPrice = cv.value.match(/\$[\d,]+/)?.[0];
      if (!claimPrice || !cvPrice || !text.includes(claimPrice)) return null;
      if (claimPrice === cvPrice) return { text };
      return { text: text.replace(claimPrice, cvPrice), change: { kind: "offer", from: `${claimPrice}/mo`, to: `${cvPrice}/mo`, reason, sourceUrl } };
    }
    case "incentive": {
      const old = claim.value;
      if (!old || !text.includes(old)) return null;
      if (cv.value === old) return { text };
      return { text: text.replace(old, cv.value), change: { kind: "offer", from: old, to: cv.value, reason, sourceUrl } };
    }
    case "phone": {
      const old = claim.value;
      if (!old || !text.includes(old)) return null;
      if (cv.value === old) return { text };
      return { text: text.replace(old, cv.value), change: { kind: "contact", from: old, to: cv.value, reason, sourceUrl } };
    }
    case "rating": {
      const re = /(\d(?:\.\d)?)(\s*(?:out of 5|\/\s*5|stars?))/i;
      const m = text.match(re);
      if (!m) return null;
      if (m[1] === cv.value) return { text };
      return { text: text.replace(re, `${cv.value}$2`), change: { kind: "fact", from: `${m[1]}★`, to: `${cv.value}★`, reason, sourceUrl } };
    }
    case "review_count": {
      const re = /([\d,]{2,})(\+?\s*(?:google\s+)?reviews?)/i;
      const m = text.match(re);
      if (!m) return null;
      if (m[1].replace(/,/g, "") === cv.value.replace(/,/g, "")) return { text };
      const correct = withCommas(cv.value);
      return { text: text.replace(re, `${correct}$2`), change: { kind: "fact", from: `${m[1]} reviews`, to: `${correct} reviews`, reason, sourceUrl } };
    }
    default:
      return null;
  }
}

/** Build the deterministic corrected text + change list for one paragraph. */
function fixParagraph(
  p: ParagraphAudit,
  compliance: ComplianceFinding[],
  dealerValues: CorrectValue[],
  dealerName: string,
  correctedIds: Set<string>,
): ParagraphFix | null {
  let corrected = p.content;
  const changes: FixChange[] = [];

  // 1) Factual corrections we can compute (MPG / fuel economy → EPA value).
  for (const c of p.claims) {
    if (c.status === "pass" || !c.suggestedCorrection) continue;
    if (c.type === "mpg" || c.type === "fuel_economy") {
      const claimed = (c.value || "").match(/\d{1,3}/)?.[0];
      const official = c.suggestedCorrection.match(/\d{1,3}/)?.[0];
      if (claimed && official && claimed !== official) {
        const re = new RegExp(`\\b${claimed}(\\s*(?:mpg|miles per gallon))`, "gi");
        if (re.test(corrected)) {
          corrected = corrected.replace(re, `${official}$1`);
          changes.push({
            kind: "fact",
            from: `${claimed} MPG`,
            to: `${official} MPG`,
            reason: c.verification,
            sourceUrl: c.sourceUrl,
          });
          correctedIds.add(c.id);
        }
      }
    }
  }

  // 1b) Dealer-specific corrections — fix wrong values to the ones on the
  // dealership's own website (pricing, lease, incentives, warranty, phone,
  // rating, reviews). Only applied when a confident match is found.
  for (const c of p.claims) {
    if (c.status === "pass" || !DEALER_FIXABLE.includes(c.type)) continue;
    const cv = pickCorrectValue(c, dealerValues);
    if (!cv) continue;
    const res = applyDealerFix(corrected, c, cv, dealerName);
    if (!res) continue;
    corrected = res.text;
    if (res.change) changes.push(res.change);
    correctedIds.add(c.id); // resolved against the dealer site (changed or already-matching)
  }

  // 2) Spelling & grammar with a concrete suggestion.
  for (const i of p.issues) {
    if (i.kind === "spelling" && i.suggestion) {
      const bad = i.message.match(/"([^"]+)"/)?.[1];
      if (bad) {
        const re = new RegExp(`\\b${bad}\\b`, "gi");
        if (re.test(corrected)) {
          corrected = corrected.replace(re, i.suggestion);
          changes.push({ kind: "spelling", from: bad, to: i.suggestion, reason: "Spelling correction" });
        }
      }
    }
    if (i.kind === "grammar" && i.excerpt && i.suggestion && corrected.includes(i.excerpt)) {
      corrected = corrected.replace(i.excerpt, i.suggestion);
      changes.push({ kind: "grammar", from: i.excerpt, to: i.suggestion, reason: i.message });
    }
  }

  // 3) Compliance — neutralize unsupported superlatives.
  for (const c of compliance) {
    if (corrected.includes(c.phrase)) {
      const replacement = neutralizeCompliance(c.phrase);
      corrected = tidy(corrected.replace(c.phrase, replacement));
      changes.push({
        kind: "compliance",
        from: c.phrase,
        to: replacement || "(removed)",
        reason: c.rule,
      });
    }
  }

  corrected = tidy(corrected);
  if (!changes.length || corrected === p.content) return null;
  return { paragraphIndex: p.index, original: p.content, corrected, changes };
}

/** Optional LLM polish — rewrite flagged paragraphs into cleaner final prose. */
async function llmPolish(fixes: ParagraphFix[]): Promise<void> {
  if (activeProvider() === "rules" || !fixes.length) return;
  const payload = fixes.map((f) => ({
    index: f.paragraphIndex,
    original: f.original,
    requiredChanges: f.changes.map((c) => `${c.kind}: "${c.from}" → "${c.to}" (${c.reason})`),
  }));
  const result = await completeJson<{ fixes: { index: number; corrected: string }[] }>({
    system:
      "You are a senior automotive copy editor. Apply the required changes to each paragraph and return clean, publish-ready text. Preserve meaning and tone; never invent facts, prices, or figures.",
    prompt:
      `Rewrite each paragraph applying its required changes. Return JSON {"fixes":[{"index":<n>,"corrected":"..."}]}.\n\n${JSON.stringify(payload)}`,
    maxTokens: 1800,
  });
  if (!result?.fixes) return;
  const byIndex = new Map(result.fixes.map((f) => [f.index, f.corrected]));
  for (const f of fixes) {
    const polished = byIndex.get(f.paragraphIndex);
    if (polished && polished.trim()) f.corrected = polished.trim();
  }
}

export async function generateAutoFix(audit: Audit): Promise<AutoFixResult> {
  // Pull the authoritative current values from the dealership's own website so
  // we can correct wrong figures to the right ones (not just flag them).
  const dealerValues = await resolveFromDealerSite(audit.dealership);
  // Prefer live Google rating/review numbers when we have them.
  for (const r of audit.ratings) {
    if (r.currentRating != null)
      dealerValues.unshift({ type: "rating", value: String(r.currentRating), sourceUrl: r.sourceUrl || audit.dealership?.website || "" });
    if (r.currentReviewCount != null)
      dealerValues.unshift({ type: "review_count", value: String(r.currentReviewCount), sourceUrl: r.sourceUrl || "" });
  }

  const dealerName = audit.dealership?.name || "the dealership";
  const correctedIds = new Set<string>();
  const paragraphFixes: ParagraphFix[] = [];
  for (const p of audit.paragraphs) {
    const comp = audit.compliance.filter((c) => c.paragraphIndex === p.index);
    const fix = fixParagraph(p, comp, dealerValues, dealerName, correctedIds);
    if (fix) paragraphFixes.push(fix);
  }

  await llmPolish(paragraphFixes);

  // Link actions
  const linkActions = audit.links
    .filter((l) => l.status !== "pass")
    .map((l) => ({
      url: l.url,
      status: l.status,
      action:
        l.status === "fail"
          ? `Remove or fix this link (${l.error || "broken"}).`
          : `Point link directly at its final destination${l.redirectedTo ? `: ${l.redirectedTo}` : ""}.`,
    }));

  // Rating actions — only when we couldn't resolve a correct rating value
  // (otherwise the correction shows inline in the paragraph fixes).
  const haveRatingValue = dealerValues.some((v) => v.type === "rating" || v.type === "review_count");
  const ratingActions: string[] = [];
  if (!haveRatingValue) {
    for (const r of audit.ratings) {
      if (r.status === "pass") continue;
      ratingActions.push(
        `Confirm displayed ${r.displayedRating ?? "?"}★ / ${r.displayedReviewCount?.toLocaleString() ?? "?"} reviews against the live Google profile and update if stale.`,
      );
    }
  }

  // Anything still not corrected (the right value wasn't found on the dealer
  // site and there's no authoritative value) — send to the developer to confirm.
  const fixByIndex = new Map(paragraphFixes.map((f) => [f.paragraphIndex, f]));
  const needsConfirmation: AutoFixResult["needsConfirmation"] = [];
  for (const p of audit.paragraphs) {
    const applied = fixByIndex.get(p.index)?.changes ?? [];
    for (const c of p.claims) {
      if (c.status === "pass" || correctedIds.has(c.id)) continue;
      const isTimeSensitive = ["pricing", "lease", "warranty", "incentive", "rating", "review_count"].includes(c.type);
      if (!isTimeSensitive) continue;
      // Skip values already handled by an applied correction in this paragraph
      // (e.g. the "$329" token of an already-fixed "$329/mo" lease).
      const token = c.value?.match(/\$[\d,]+|\d[\d,]*\.?\d*/)?.[0];
      if (token && applied.some((ch) => ch.from.includes(token) || ch.to.includes(token))) continue;
      const suggestion = pickCorrectValue(c, dealerValues);
      needsConfirmation.push({
        location: `Paragraph ${p.index + 1}`,
        issue:
          `${c.type.replace(/_/g, " ")} "${c.value ?? c.text.slice(0, 50)}" — ` +
          (suggestion
            ? `${dealerName}'s site shows "${suggestion.value}"; confirm which figure this refers to before applying.`
            : `value not found on ${dealerName}'s site; confirm the current offer.`),
        verifyUrl: suggestion?.sourceUrl || c.sourceUrl,
      });
    }
  }

  const changeCount = paragraphFixes.reduce((n, f) => n + f.changes.length, 0);
  return {
    paragraphFixes,
    linkActions,
    ratingActions,
    needsConfirmation,
    counts: {
      paragraphs: paragraphFixes.length,
      changes: changeCount,
      links: linkActions.length,
      manual: needsConfirmation.length,
    },
    generatedBy: providerLabel(),
  };
}

/** Render the auto-fix result as a developer-ready Markdown handoff document. */
export function fixesToMarkdown(audit: Audit, fix: AutoFixResult): string {
  const lines: string[] = [];
  lines.push(`# Content revisions — ${audit.title}`);
  lines.push("");
  lines.push(`- **Page:** ${audit.finalUrl}`);
  lines.push(`- **Dealership:** ${audit.dealership?.name || "—"}${audit.dealership?.website ? ` (${audit.dealership.website})` : ""}`);
  lines.push(`- **QA score:** ${audit.score.overall}/100 · ${audit.summary.fail} fails · ${audit.summary.warning} warnings`);
  lines.push(`- **Reviewer:** ${audit.reviewer}`);
  lines.push(`- **Auto-fix by:** ${fix.generatedBy}`);
  lines.push("");
  lines.push(`Apply the corrected text below. ${fix.counts.changes} change(s) across ${fix.counts.paragraphs} paragraph(s).`);
  lines.push("");

  if (fix.paragraphFixes.length) {
    lines.push(`## Paragraph corrections`);
    for (const f of fix.paragraphFixes) {
      lines.push("");
      lines.push(`### Paragraph ${f.paragraphIndex + 1}`);
      lines.push(`**Changes:** ${f.changes.map((c) => `${c.kind} ("${c.from}" → "${c.to}")${c.sourceUrl ? ` [source](${c.sourceUrl})` : ""}`).join("; ")}`);
      lines.push("");
      lines.push(`**Before:**`);
      lines.push(`> ${f.original}`);
      lines.push("");
      lines.push(`**After (apply this):**`);
      lines.push(`> ${f.corrected}`);
    }
    lines.push("");
  }

  if (fix.linkActions.length) {
    lines.push(`## Link fixes`);
    for (const l of fix.linkActions) lines.push(`- [ ] ${l.action}\n  - \`${l.url}\``);
    lines.push("");
  }

  if (fix.ratingActions.length) {
    lines.push(`## Rating / reviews`);
    for (const r of fix.ratingActions) lines.push(`- [ ] ${r}`);
    lines.push("");
  }

  if (fix.needsConfirmation.length) {
    lines.push(`## Needs developer confirmation (no auto-fix — value not known)`);
    for (const n of fix.needsConfirmation)
      lines.push(`- [ ] **${n.location}:** ${n.issue}${n.verifyUrl ? `\n  - Verify: ${n.verifyUrl}` : ""}`);
    lines.push("");
  }

  lines.push(`---`);
  lines.push(`_Generated by DealerQA AI._`);
  return lines.join("\n");
}
