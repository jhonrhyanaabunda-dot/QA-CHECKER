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
  /**
   * Reviewer-facing explanation: what the page says, what the authoritative
   * source says, and why it matters. A bare "X → Y" isn't enough to sign off on.
   */
  analysis?: string;
  /** Dealer-site page the correct value came from, when applicable. */
  sourceUrl?: string;
}

export interface ParagraphFix {
  paragraphIndex: number;
  original: string;
  corrected: string;
  changes: FixChange[];
}

export interface LinkAction {
  url: string;
  status: string;
  action: string;
  /** The corrected URL to swap in, when it is known. */
  replacementUrl?: string;
  analysis: string;
  /** True when replacementUrl is known and the swap is safe to apply as-is. */
  autoApplicable: boolean;
}

export interface RatingAction {
  issue: string;
  analysis: string;
  /** Live Google profile to verify against. */
  sourceUrl?: string;
}

export interface ConfirmationItem {
  location: string;
  issue: string;
  analysis: string;
  verifyUrl?: string;
}

export interface AutoFixResult {
  paragraphFixes: ParagraphFix[];
  linkActions: LinkAction[];
  ratingActions: RatingAction[];
  needsConfirmation: ConfirmationItem[];
  counts: {
    paragraphs: number;
    changes: number;
    links: number;
    manual: number;
    /** Fixes that can be applied without a human deciding anything. */
    autoApplicable: number;
  };
  generatedBy: string;
}

// ── Why each correction matters ────────────────────────────────────────────
// The reviewer is personally accountable for every published sentence, so each
// warning explains itself: what is on the page, what the source says, and the
// risk of leaving it. These are deterministic — they hold with zero AI setup.

const RISK: Record<FixChange["kind"], string> = {
  fact: "Published vehicle figures are the highest-risk claims on a dealership page: a stale MPG, price or warranty number is both a customer-trust problem and an advertising-compliance exposure.",
  offer: "Lease and finance figures expire. Publishing an offer that is no longer live invites a bait-and-switch complaint even when the figure was accurate the day it was written.",
  compliance: "FTC advertising guidance requires an objective superlative to be substantiated at the moment it is published. Unsupported absolutes are the most common dealer-advertising violation.",
  contact: "Inconsistent name, address or phone details break click-to-call and degrade local search ranking.",
  spelling: "Spelling errors on a pillar page undermine credibility and are picked up by search quality raters.",
  grammar: "Awkward or incorrect phrasing hurts readability and reads as unedited AI output.",
};

function analyzeChange(c: FixChange): string {
  let head: string;
  if (c.kind === "compliance")
    head = `The page claims "${c.from}" — a superlative the content does not substantiate.`;
  else if (c.kind === "spelling" || c.kind === "grammar")
    head = `The page reads "${c.from}", which is incorrect.`;
  else
    head = `The page publishes "${c.from}", but the authoritative value is "${c.to}".`;
  const src = c.sourceUrl ? ` Verify at ${c.sourceUrl}` : "";
  return `${head} ${RISK[c.kind]} ${c.reason}. Applying this replaces "${c.from}" with "${c.to}".${src}`;
}

/** Attach an explanation to every change once the fixes are final. */
function attachAnalysis(fixes: ParagraphFix[]): void {
  for (const f of fixes) for (const c of f.changes) c.analysis = analyzeChange(c);
}

/** True when a redirect dumps a deep link on the bare site root (a soft 404). */
function isSoftRootRedirect(from: string, to: string): boolean {
  try {
    const a = new URL(from);
    const b = new URL(to);
    const fromIsDeep = a.pathname.replace(/\/+$/, "") !== "";
    const toIsRoot = b.pathname.replace(/\/+$/, "") === "" && !b.search;
    return fromIsDeep && toIsRoot;
  } catch {
    return false;
  }
}

/** Turn one failed/redirecting link into an action with its corrected URL. */
function buildLinkAction(l: Audit["links"][number]): LinkAction {
  const detail = l.error || `HTTP ${l.httpStatus ?? "error"}`;
  if (l.status === "warning" && l.redirectedTo && isSoftRootRedirect(l.url, l.redirectedTo)) {
    return {
      url: l.url,
      status: l.status,
      action: "Replace this link — it no longer resolves to a real page.",
      analysis: `This link redirects to ${l.redirectedTo}, the site root, rather than to a replacement for the page it was pointing at. That is a catch-all redirect standing in for a page that no longer exists, so the reader silently lands on the homepage instead of the content the sentence promised. Swapping the root URL in automatically would keep the link alive while destroying its meaning, so a real destination has to be chosen by hand.`,
      autoApplicable: false,
    };
  }
  if (l.status === "warning" && l.redirectedTo) {
    return {
      url: l.url,
      status: l.status,
      action: `Point this link directly at its final destination: ${l.redirectedTo}`,
      replacementUrl: l.redirectedTo,
      analysis: `This link only resolves after ${l.redirectChain ?? 1} redirect hop(s), ending at ${l.redirectedTo}. Redirect chains slow the page, dilute link equity, and break silently if the intermediate rule is ever removed. The final destination is already known, so this swap is safe to apply automatically.`,
      autoApplicable: true,
    };
  }
  if (l.status === "fail") {
    return {
      url: l.url,
      status: l.status,
      action: `Remove or replace this link (${detail}).`,
      analysis: `This link does not resolve (${detail}). A dead link on a pillar page sends the reader nowhere and is a crawl-quality signal. No replacement can be inferred safely, so a destination has to be confirmed by hand before this one can be applied.`,
      autoApplicable: false,
    };
  }
  return {
    url: l.url,
    status: l.status,
    action: "Review this link.",
    analysis: `This link returned an unclean result (${detail}). Confirm the destination still supports the sentence linking to it.`,
    autoApplicable: false,
  };
}

/**
 * The page content with the selected paragraph fixes applied — this is what
 * "apply automatically" actually produces.
 */
export function buildCorrectedDocument(
  allParagraphs: string[],
  fixes: ParagraphFix[],
  selected?: number[],
): string {
  const pick = selected ? new Set(selected) : null;
  const byIndex = new Map(fixes.map((f) => [f.paragraphIndex, f]));
  return allParagraphs
    .map((p, i) => {
      const f = byIndex.get(i);
      if (!f || (pick && !pick.has(i))) return p;
      return f.corrected;
    })
    .join("\n\n");
}

const tidy = (s: string) =>
  s.replace(/\s{2,}/g, " ").replace(/\s+([.,!?;:])/g, "$1").replace(/\(\s+/g, "(").trim();

/**
 * Repair prose after a phrase has been cut out of it: drop orphaned punctuation
 * and re-capitalize sentence starts. Without this, removing a leading
 * superlative leaves ". per year the longer you keep it." — which auto-apply
 * would publish verbatim.
 */
function repairProse(s: string): string {
  let out = tidy(s);
  out = out.replace(/([.!?])\s*[,;:]/g, "$1");
  out = out.replace(/\s+([.,!?;:])/g, "$1");
  out = out.replace(/([.!?]\s+)([a-z])/g, (_m, punct: string, ch: string) => punct + ch.toUpperCase());
  out = out.replace(/^\s*([a-z])/, (_m, ch: string) => ch.toUpperCase());
  return tidy(out);
}

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
      corrected = repairProse(corrected.replace(c.phrase, replacement));
      changes.push({
        kind: "compliance",
        from: c.phrase,
        to: replacement || "(removed)",
        reason: c.rule,
      });
    }
  }

  corrected = repairProse(corrected);
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
      "You are a senior automotive copy editor. Apply the required changes to each paragraph and return clean, publish-ready text. Preserve meaning and tone. Never invent facts, prices, figures, or URLs, and never drop a qualifier that limits a claim - keep \"up to\", \"on select trims\", \"with approved credit\", EPA-estimate wording, and any disclaimer exactly as written.",
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
  attachAnalysis(paragraphFixes);

  // Link actions
  const linkActions: LinkAction[] = audit.links
    .filter((l) => l.status !== "pass")
    .map(buildLinkAction);

  // Rating actions — only when we couldn't resolve a correct rating value
  // (otherwise the correction shows inline in the paragraph fixes).
  const haveRatingValue = dealerValues.some((v) => v.type === "rating" || v.type === "review_count");
  const ratingActions: RatingAction[] = [];
  if (!haveRatingValue) {
    for (const r of audit.ratings) {
      if (r.status === "pass") continue;
      ratingActions.push({
        issue: `Displayed ${r.displayedRating ?? "?"}★ / ${r.displayedReviewCount?.toLocaleString() ?? "?"} reviews could not be confirmed.`,
        analysis: `The page hard-codes a star rating and review count that could not be matched against the live Google Business Profile. Both figures drift daily, so a hard-coded number goes stale quietly and is one of the easiest claims for a customer to disprove. Confirm both against the live profile and update them, or remove the hard-coded numbers entirely.`,
        sourceUrl: r.sourceUrl,
      });
    }
  }

  // Anything still not corrected (the right value wasn't found on the dealer
  // site and there's no authoritative value) — send to the developer to confirm.
  const fixByIndex = new Map(paragraphFixes.map((f) => [f.paragraphIndex, f]));
  const needsConfirmation: ConfirmationItem[] = [];
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
        analysis:
          `This ${c.type.replace(/_/g, " ")} figure is time-sensitive and no authoritative current value could be resolved` +
          (suggestion
            ? `; the closest match on ${dealerName}'s own site is "${suggestion.value}", which may refer to a different trim, term or model year.`
            : `, and nothing matching it was found on ${dealerName}'s site.`) +
          ` Auto-applying a figure here would swap one unverified number for another, so it is deliberately left for a human to confirm against the live source.`,
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
      autoApplicable: changeCount + linkActions.filter((l) => l.autoApplicable).length,
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
      for (const c of f.changes) {
        lines.push(`- **${c.kind}:** \`${c.from}\` → \`${c.to}\`${c.sourceUrl ? ` · [verify source](${c.sourceUrl})` : ""}`);
        if (c.analysis) lines.push(`  - _Analysis:_ ${c.analysis}`);
      }
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
    for (const l of fix.linkActions) {
      lines.push(`- [ ] ${l.action}${l.autoApplicable ? " _(auto-applied)_" : ""}`);
      lines.push(`  - Current: \`${l.url}\``);
      if (l.replacementUrl) lines.push(`  - Corrected: \`${l.replacementUrl}\``);
      lines.push(`  - _Analysis:_ ${l.analysis}`);
    }
    lines.push("");
  }

  if (fix.ratingActions.length) {
    lines.push(`## Rating / reviews`);
    for (const r of fix.ratingActions) {
      lines.push(`- [ ] ${r.issue}${r.sourceUrl ? ` · [live profile](${r.sourceUrl})` : ""}`);
      lines.push(`  - _Analysis:_ ${r.analysis}`);
    }
    lines.push("");
  }

  if (fix.needsConfirmation.length) {
    lines.push(`## Needs developer confirmation (no auto-fix — value not known)`);
    for (const n of fix.needsConfirmation) {
      lines.push(`- [ ] **${n.location}:** ${n.issue}`);
      lines.push(`  - _Analysis:_ ${n.analysis}`);
      if (n.verifyUrl) lines.push(`  - Verify: ${n.verifyUrl}`);
    }
    lines.push("");
  }

  lines.push(`---`);
  lines.push(`_Generated by DealerQA AI._`);
  return lines.join("\n");
}
