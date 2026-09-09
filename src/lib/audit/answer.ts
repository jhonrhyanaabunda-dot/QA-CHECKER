// ───────────────────────────────────────────────────────────────────────────
// Answer pass — the deterministic checkers can only say "I could not verify
// this", which leaves the reviewer holding a warning and no answer. This pass
// takes every unresolved claim and answers the question the reviewer actually
// has: is the published figure right, what is the right one, and what is that
// based on.
//
// With no AI provider configured it still returns a next step (which
// authoritative source settles this claim type) rather than a dead end.
// ───────────────────────────────────────────────────────────────────────────

import { completeJson, activeProvider } from "../llm";
import type { Claim, ClaimAnswer, ClaimType } from "./types";

/** Cap the batch so one pathological page can't blow the function timeout. */
const MAX_ANSWERS = 25;

/** Where the answer for each claim type actually lives. */
const SOURCE_HINT: Record<ClaimType, string> = {
  mpg: "FuelEconomy.gov for the exact year, model and trim",
  fuel_economy: "FuelEconomy.gov for the exact year, model and trim",
  vehicle_spec: "the manufacturer's official model page (specs / towing capacity)",
  warranty: "the manufacturer's official warranty page",
  lease: "the current offers page, including the offer's expiration date",
  pricing: "the dealership's own inventory or offers page",
  incentive: "the manufacturer's current incentives page for this region",
  rating: "the dealership's live Google Business Profile",
  review_count: "the dealership's live Google Business Profile",
  phone: "the dealership's contact page",
  manufacturer_claim: "the manufacturer's own press or model page",
  statistic: "the primary source the statistic is attributed to",
};

/**
 * A claim the deterministic pass flagged but could not settle — it has no
 * authoritative value attached, so the reviewer has nothing to act on.
 */
export function isUnresolved(c: Claim): boolean {
  return c.status !== "pass" && !c.officialValue;
}

interface LlmAnswer {
  id: string;
  answer: string;
  basis: string;
  sourceUrl?: string;
  confidence?: number;
  unresolved?: boolean;
}

function fallback(c: Claim): ClaimAnswer {
  return {
    answer: "Not answered automatically — no AI provider is configured.",
    basis: `Check "${c.value ?? c.text.slice(0, 60)}" against ${SOURCE_HINT[c.type]}.`,
    confidence: 0,
    unresolved: true,
  };
}

/**
 * Attach an answer to every unresolved claim. Mutates the claims in place —
 * the pipeline re-attaches these same objects to their paragraphs.
 */
export async function answerUnresolvedClaims(
  claims: Claim[],
  ctx: { dealerName?: string } = {},
): Promise<void> {
  const targets = claims.filter(isUnresolved).slice(0, MAX_ANSWERS);
  if (!targets.length) return;

  if (activeProvider() === "rules") {
    for (const c of targets) c.answer = fallback(c);
    return;
  }

  const payload = targets.map((c) => ({
    id: c.id,
    type: c.type,
    published_value: c.value ?? "",
    sentence: c.text,
    why_flagged: c.verification,
    authoritative_source: SOURCE_HINT[c.type],
  }));

  const result = await completeJson<{ answers: LlmAnswer[] }>({
    system:
      "You are a QA fact-checker for dealership content. The reviewer signs off on this page and is personally accountable for every published figure. Each item below was flagged by an automated check that could not settle it, so the reviewer has a warning and no answer. Answer it.\n\n" +
      "For each item say whether the published figure is correct and what the correct figure is. Ground the answer in the authoritative source named for that item. Be specific: give the figure, the model year and trim it applies to, and any condition attached to it (properly equipped, on select trims, with approved credit).\n\n" +
      "Never invent, guess or approximate a URL. Only give sourceUrl when you are confident a page exists at exactly that address; otherwise omit the field entirely. If you cannot determine the answer, set unresolved to true and say what the reviewer should check instead — never fill the gap with a plausible-sounding number. A wrong figure stated confidently is far worse than an admitted gap.",
    prompt:
      `Answer each item. Return JSON {"answers":[{"id":"<id>","answer":"...","basis":"...","sourceUrl":"...","confidence":0.0,"unresolved":false}]}. ` +
      `"answer" is the direct answer in at most two sentences. "basis" is what it rests on. "confidence" is 0-1.\n\n` +
      JSON.stringify(payload),
    maxTokens: 2500,
  });

  const byId = new Map((result?.answers ?? []).map((a) => [a.id, a]));
  for (const c of targets) {
    const a = byId.get(c.id);
    if (!a || !a.answer) {
      c.answer = fallback(c);
      continue;
    }
    c.answer = {
      answer: a.answer,
      basis: a.basis || `Checked against ${SOURCE_HINT[c.type]}.`,
      // Only keep a source we can actually treat as a link.
      sourceUrl: /^https?:\/\//i.test(a.sourceUrl ?? "") ? a.sourceUrl : undefined,
      confidence: typeof a.confidence === "number" ? Math.min(1, Math.max(0, a.confidence)) : 0.5,
      unresolved: Boolean(a.unresolved),
    };
  }
}
