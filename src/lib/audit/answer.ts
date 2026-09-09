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

import { completeJsonDetailed, activeProvider } from "../llm";
import { urlResolves } from "./link-check";
import type { Claim, ClaimAnswer, ClaimType } from "./types";

/** Cap the work so one pathological page can't blow the function timeout. */
const MAX_ANSWERS = 24;
/**
 * Items per request. One big request truncates: the model hits the output cap
 * mid-JSON, the parse fails, and every answer is silently lost. Small batches
 * keep each response comfortably inside the limit.
 */
const BATCH = 10;
/**
 * The answer pass shares a 60s serverless budget with the rest of the audit,
 * so it stops waiting on rate limits past this point and reports the remaining
 * claims honestly instead of timing the whole audit out.
 */
const TIME_BUDGET_MS = 28_000;

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

/**
 * Why no answer came back. These have to be distinguishable: "nothing is
 * configured" and "the model was asked and returned nothing" need different
 * fixes, and a message that blames the wrong one sends the reviewer hunting in
 * the wrong place.
 */
function fallback(
  c: Claim,
  reason: "no-provider" | "no-response" | "rate-limited",
): ClaimAnswer {
  return {
    answer:
      reason === "no-provider"
        ? "Not answered automatically — no AI provider is configured."
        : reason === "rate-limited"
          ? "Not answered — the AI provider's rate limit was hit while answering this page. Re-run the audit in a minute and this should resolve."
          : "The AI check ran but returned no answer for this claim.",
    basis: `Check "${c.value ?? c.text.slice(0, 60)}" against ${SOURCE_HINT[c.type]}.`,
    confidence: 0,
    unresolved: true,
  };
}

/** Ask for one batch. Returns answers by claim id; empty map on any failure. */
async function askBatch(
  batch: Claim[],
): Promise<{ answers: Map<string, LlmAnswer>; rateLimited: boolean }> {
  const payload = batch.map((c) => ({
    id: c.id,
    type: c.type,
    published_value: c.value ?? "",
    sentence: c.text,
    why_flagged: c.verification,
    authoritative_source: SOURCE_HINT[c.type],
  }));

  const { data: result, error } = await completeJsonDetailed<{ answers: LlmAnswer[] }>({
    system:
      "You are a QA fact-checker for dealership content. The reviewer signs off on this page and is personally accountable for every published figure. Each item below was flagged by an automated check that could not settle it, so the reviewer has a warning and no answer. Answer it.\n\n" +
      "For each item say whether the published figure is correct and what the correct figure is. Ground the answer in the authoritative source named for that item. Be specific: give the figure, the model year and trim it applies to, and any condition attached to it (properly equipped, on select trims, with approved credit).\n\n" +
      "Never invent, guess or approximate a URL. Only give sourceUrl when you are confident a page exists at exactly that address; otherwise omit the field entirely. If you cannot determine the answer, set unresolved to true and say what the reviewer should check instead — never fill the gap with a plausible-sounding number. A wrong figure stated confidently is far worse than an admitted gap.",
    prompt:
      `Answer each item. Return JSON {"answers":[{"id":"<id>","answer":"...","basis":"...","sourceUrl":"...","confidence":0.0,"unresolved":false}]}. ` +
      `"answer" is the direct answer in at most two sentences. "basis" is what it rests on. "confidence" is 0-1. ` +
      `Return one entry for every id given.\n\n` +
      JSON.stringify(payload),
    maxTokens: 3000,
  });

  return {
    answers: new Map((result?.answers ?? []).filter((a) => a?.id).map((a) => [a.id, a])),
    rateLimited: /\b429\b|RESOURCE_EXHAUSTED|rate limit/i.test(error ?? ""),
  };
}

/**
 * Drop cited sources that do not resolve. The instruction not to invent URLs
 * is not enough on its own — observed output cited vw.com pages that 404 — and
 * a dead citation is worse than none, because it looks verified.
 */
async function verifySources(claims: Claim[]): Promise<void> {
  const urls = [
    ...new Set(claims.map((c) => c.answer?.sourceUrl).filter((u): u is string => !!u)),
  ];
  if (!urls.length) return;
  const live = new Map<string, boolean>();
  await Promise.all(
    urls.map(async (u) => {
      live.set(u, await urlResolves(u));
    }),
  );
  for (const c of claims) {
    const a = c.answer;
    if (!a?.sourceUrl || live.get(a.sourceUrl)) continue;
    a.basis = `${a.basis} (The cited source did not resolve and was removed — confirm against ${SOURCE_HINT[c.type]}.)`;
    a.sourceUrl = undefined;
    a.confidence = Math.min(a.confidence, 0.4);
  }
}

/**
 * Attach an answer to every unresolved claim. Mutates the claims in place —
 * the pipeline re-attaches these same objects to their paragraphs.
 */
export async function answerUnresolvedClaims(
  claims: Claim[],
  ctx: { dealerName?: string } = {},
): Promise<void> {
  void ctx;
  const targets = claims.filter(isUnresolved).slice(0, MAX_ANSWERS);
  if (!targets.length) return;

  if (activeProvider() === "rules") {
    for (const c of targets) c.answer = fallback(c, "no-provider");
    return;
  }

  const startedAt = Date.now();
  for (let i = 0; i < targets.length; i += BATCH) {
    const batch = targets.slice(i, i + BATCH);

    // Out of budget: say so rather than stalling the whole audit.
    if (Date.now() - startedAt > TIME_BUDGET_MS) {
      for (const c of batch) c.answer = fallback(c, "rate-limited");
      continue;
    }
    // Free-tier keys limit requests per minute; a small gap between batches
    // costs a second and avoids losing a whole batch to a 429.
    if (i > 0) await new Promise((r) => setTimeout(r, 1200));

    const { answers, rateLimited } = await askBatch(batch);
    for (const c of batch) {
      const a = answers.get(c.id);
      if (!a || !a.answer) {
        c.answer = fallback(c, rateLimited ? "rate-limited" : "no-response");
        continue;
      }
      c.answer = {
        answer: a.answer,
        basis: a.basis || `Checked against ${SOURCE_HINT[c.type]}.`,
        // Only keep a source we can actually treat as a link.
        sourceUrl: /^https?:\/\//i.test(a.sourceUrl ?? "") ? a.sourceUrl : undefined,
        confidence:
          typeof a.confidence === "number" ? Math.min(1, Math.max(0, a.confidence)) : 0.5,
        unresolved: Boolean(a.unresolved),
      };
    }
  }

  await verifySources(targets);
}
