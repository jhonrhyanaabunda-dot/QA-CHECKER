// ───────────────────────────────────────────────────────────────────────────
// Audit pipeline — the orchestrator. Given a URL it runs the full QA sweep and
// yields ProgressEvent values along the way (consumed by the SSE route for
// real-time progress). The final yield carries the completed `Audit`.
//
//   crawl → extract → claim detection → fact verification → links →
//   compliance → grammar/style → ratings → screenshot → score → assemble
// ───────────────────────────────────────────────────────────────────────────

import { genId } from "../utils";
import { providerLabel } from "../llm";
import { crawl, captureScreenshot } from "./crawler";
import { extract } from "./extractor";
import { detectDealership } from "./dealership";
import { detectClaims, detectUncitedStats, toClaim } from "./claims";
import { verifyClaim } from "./fact-check";
import { checkLinks } from "./link-check";
import { checkCompliance } from "./compliance";
import { analyzeContent, enrichWithLlm } from "./grammar";
import { answerUnresolvedClaims } from "./answer";
import { checkRatings } from "./ratings";
import { computeScore, paragraphStatus } from "./scoring";
import type {
  Audit,
  Claim,
  ParagraphAudit,
  ProgressEvent,
} from "./types";

export interface PipelineOptions {
  reviewer: string;
  screenshot?: boolean;
}

export async function* runAudit(
  rawUrl: string,
  opts: PipelineOptions,
): AsyncGenerator<ProgressEvent, Audit, unknown> {
  const id = genId("audit");
  const createdAt = new Date().toISOString();

  yield { step: "crawl", label: "Fetching page…", progress: 5 };
  const crawled = await crawl(rawUrl);
  if (!crawled.html || crawled.status >= 400) {
    throw new Error(
      `Could not fetch page (HTTP ${crawled.status || "error"}). Check the URL is publicly reachable.`,
    );
  }

  yield { step: "extract", label: "Extracting content structure…", progress: 15 };
  const content = extract(crawled.html, crawled.finalUrl);

  // Identify the dealership + its main website — the target for verify links.
  const dealership = detectDealership(content);

  // ── Claim detection (per paragraph) ──────────────────────────────────────
  yield { step: "claims", label: "Detecting factual claims…", progress: 25 };
  const paragraphAudits: ParagraphAudit[] = content.paragraphs.map((text, index) => {
    const raw = [...detectClaims(text), ...detectUncitedStats(text)];
    return {
      index,
      content: text,
      claims: raw.map((r) => toClaim(r, index)),
      status: "pass",
      confidence: 0.9,
      issues: [],
    };
  });

  // Page-level claims found outside <p> blocks (CTAs, hero, lists, tables).
  const extraText = [
    ...content.ctas,
    ...content.buttons,
    ...content.lists.flatMap((l) => l.items),
    ...content.tables.flatMap((t) => t.rows.flat()),
    ...content.headings.map((h) => h.text),
  ].join(". ");
  const pageLevelClaims: Claim[] = detectClaims(extraText).map((r) => toClaim(r, -1));

  // ── Fact verification ────────────────────────────────────────────────────
  yield { step: "verify", label: "Verifying claims against EPA / NHTSA…", progress: 40 };
  const allParagraphClaims = paragraphAudits.flatMap((p) => p.claims);
  const verifiedParagraphClaims = await mapLimit(allParagraphClaims, 6, (c) =>
    verifyClaim(c, dealership),
  );
  // re-attach verified claims to paragraphs
  let cursor = 0;
  for (const p of paragraphAudits) {
    p.claims = p.claims.map(() => verifiedParagraphClaims[cursor++]);
  }
  const verifiedPageClaims = await mapLimit(pageLevelClaims, 6, (c) =>
    verifyClaim(c, dealership),
  );

  // ── Answers ──────────────────────────────────────────────────────────────
  // A warning the verifiers could not settle is useless to a reviewer on its
  // own. Answer those: what the right figure is, and what that rests on.
  yield { step: "answer", label: "Answering unresolved warnings…", progress: 50 };
  await answerUnresolvedClaims([...verifiedParagraphClaims, ...verifiedPageClaims], {
    dealerName: dealership?.name,
  });

  // ── Links ────────────────────────────────────────────────────────────────
  // Cap at MAX_LINKS so a pathological page (e.g. a wiki with 1000+ links) can't
  // stall an audit. Dealership blog pages are well under this; if a page exceeds
  // it, the overflow is surfaced in the progress label rather than checked silently.
  const MAX_LINKS = 300;
  const linksToCheck = content.links.slice(0, MAX_LINKS);
  const capped = content.links.length - linksToCheck.length;
  yield {
    step: "links",
    label:
      `Checking ${linksToCheck.length} links…` +
      (capped > 0 ? ` (${capped} beyond the ${MAX_LINKS}-link cap were skipped)` : ""),
    progress: 58,
  };
  const links = await checkLinks(linksToCheck);

  // ── Compliance ───────────────────────────────────────────────────────────
  yield { step: "compliance", label: "Scanning for compliance issues…", progress: 68 };
  const compliance = checkCompliance(content.paragraphs);

  // ── Grammar / style ──────────────────────────────────────────────────────
  yield { step: "grammar", label: "Running grammar & style QA…", progress: 76 };
  const { perParagraph } = analyzeContent(content.paragraphs);
  paragraphAudits.forEach((p, i) => {
    p.issues = perParagraph[i] || [];
  });
  const llmIssues = await enrichWithLlm(content.paragraphs);
  const contentIssues = [...perParagraph.flat(), ...llmIssues];

  // ── Ratings ──────────────────────────────────────────────────────────────
  yield { step: "ratings", label: "Cross-checking Google rating…", progress: 84 };
  const ratings = await checkRatings(content, dealership);

  // Roll up paragraph statuses now that claims + issues are attached.
  for (const p of paragraphAudits) {
    const { status, confidence } = paragraphStatus(p);
    p.status = status;
    p.confidence = confidence;
    const correction =
      p.claims.find((c) => c.suggestedCorrection)?.suggestedCorrection ||
      p.issues.find((i) => i.suggestion)?.suggestion;
    if (correction) p.suggestedCorrection = correction;
  }

  // ── Screenshot (optional) ────────────────────────────────────────────────
  let screenshot: string | undefined;
  if (opts.screenshot) {
    yield { step: "screenshot", label: "Capturing full-page screenshot…", progress: 90 };
    screenshot = (await captureScreenshot(crawled.finalUrl)) || undefined;
  }

  // ── Score & assemble ─────────────────────────────────────────────────────
  yield { step: "score", label: "Scoring audit…", progress: 95 };
  const allClaims = [...verifiedParagraphClaims, ...verifiedPageClaims];
  const score = computeScore({
    claims: allClaims,
    links,
    compliance,
    contentIssues,
    ratings,
    content,
  });

  const statusTally = (() => {
    let pass = 0, warning = 0, fail = 0;
    for (const c of allClaims) {
      if (c.status === "pass") pass++;
      else if (c.status === "warning") warning++;
      else fail++;
    }
    return { pass, warning, fail };
  })();

  const audit: Audit = {
    id,
    url: rawUrl,
    finalUrl: crawled.finalUrl,
    title: content.title || crawled.finalUrl,
    status: "complete",
    createdAt,
    completedAt: new Date().toISOString(),
    reviewer: opts.reviewer,
    llmProvider: providerLabel(),
    dealership,
    score,
    summary: {
      ...statusTally,
      totalClaims: allClaims.length,
      totalLinks: links.length,
      brokenLinks: links.filter((l) => l.status === "fail").length,
      wordCount: content.wordCount,
    },
    content,
    paragraphs: paragraphAudits,
    pageLevelClaims: verifiedPageClaims,
    links,
    compliance,
    ratings,
    contentIssues,
    review: {
      factVerified: false,
      grammarChecked: false,
      linksChecked: false,
      complianceChecked: false,
      approved: false,
    },
    screenshot,
  };

  yield { step: "done", label: "Audit complete", progress: 100, done: true, auditId: id };
  return audit;
}

/** Run an async mapper with bounded concurrency, preserving order. */
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
