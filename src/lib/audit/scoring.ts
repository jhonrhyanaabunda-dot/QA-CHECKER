// ───────────────────────────────────────────────────────────────────────────
// Scoring — rolls the audit findings into the five QA dimensions plus an
// overall weighted score (0-100). Each dimension penalizes fails more than
// warnings, normalized by the number of relevant items so a long page isn't
// unfairly punished. SEO is a heuristic based on structure (title, meta,
// headings, word count, image alt-text).
// ───────────────────────────────────────────────────────────────────────────

import { clamp, round1 } from "../utils";
import type {
  Claim,
  ComplianceFinding,
  ContentIssue,
  ExtractedContent,
  LinkCheck,
  ParagraphAudit,
  RatingCheck,
  ScoreBreakdown,
  Status,
} from "./types";

const WEIGHTS = { facts: 0.3, grammar: 0.2, links: 0.2, compliance: 0.2, seo: 0.1 };

function tally(items: { status: Status }[]) {
  let pass = 0, warning = 0, fail = 0;
  for (const it of items) {
    if (it.status === "pass") pass++;
    else if (it.status === "warning") warning++;
    else fail++;
  }
  return { pass, warning, fail, total: items.length };
}

/** Score a set of statuses: each fail costs full, each warning costs a third. */
function scoreFromStatuses(items: { status: Status }[]): number {
  const { fail, warning, total } = tally(items);
  if (total === 0) return 100;
  const penalty = (fail + warning / 3) / total;
  return round1(clamp(100 - penalty * 100, 0, 100));
}

function scoreSeo(content: ExtractedContent): number {
  let score = 100;
  if (!content.title || content.title.length < 15) score -= 15;
  if (!content.metaDescription) score -= 15;
  if (content.metaDescription && (content.metaDescription.length < 70 || content.metaDescription.length > 165))
    score -= 5;
  const h1s = content.headings.filter((h) => h.level === 1).length;
  if (h1s === 0) score -= 15;
  if (h1s > 1) score -= 8;
  if (content.headings.length < 3) score -= 10;
  if (content.wordCount < 300) score -= 15;
  const imgsMissingAlt = content.images.filter((i) => !i.alt).length;
  if (content.images.length && imgsMissingAlt / content.images.length > 0.3) score -= 10;
  return round1(clamp(score, 0, 100));
}

export function computeScore(input: {
  claims: Claim[];
  links: LinkCheck[];
  compliance: ComplianceFinding[];
  contentIssues: ContentIssue[];
  ratings: RatingCheck[];
  content: ExtractedContent;
}): ScoreBreakdown {
  const facts = scoreFromStatuses([...input.claims, ...input.ratings]);
  const links = scoreFromStatuses(input.links);
  // Compliance: map findings to statuses (no findings = perfect).
  const compliance = scoreFromStatuses(
    input.compliance.map((c) => ({ status: c.severity })),
  );
  const grammar = scoreFromStatuses(
    input.contentIssues.map((c) => ({ status: c.severity })),
  );
  const seo = scoreSeo(input.content);

  const overall = round1(
    facts * WEIGHTS.facts +
      grammar * WEIGHTS.grammar +
      links * WEIGHTS.links +
      compliance * WEIGHTS.compliance +
      seo * WEIGHTS.seo,
  );

  return { overall, facts, grammar, links, compliance, seo };
}

/** Roll a paragraph's claims + issues into a single status & confidence. */
/**
 * Why a paragraph carries the status it does, in the reviewer's terms.
 *
 * A green badge on its own is ambiguous in a way that matters for sign-off:
 * a paragraph containing no checkable claim and one whose figures were
 * confirmed against the EPA both render as PASS, and those are very different
 * things to put your name to. This states which of the two it is, and lists
 * every check that ran.
 */
export function explainParagraph(
  p: Pick<ParagraphAudit, "claims" | "issues" | "status">,
  complianceCount = 0,
): { headline: string; checks: string[] } {
  const verified = p.claims.filter((c) => c.status === "pass");
  const warning = p.claims.filter((c) => c.status === "warning");
  const failing = p.claims.filter((c) => c.status === "fail");

  const checks: string[] = [];
  if (!p.claims.length) {
    checks.push(
      "Factual claims — none detected: no figures, prices, ratings, specs or dates to check against a source.",
    );
  } else {
    const parts = [`${p.claims.length} detected`];
    if (verified.length) parts.push(`${verified.length} verified`);
    if (warning.length) parts.push(`${warning.length} flagged`);
    if (failing.length) parts.push(`${failing.length} incorrect`);
    checks.push(`Factual claims — ${parts.join(", ")}.`);
  }
  checks.push(
    p.issues.length
      ? `Grammar & style — ${p.issues.length} issue(s) found.`
      : "Grammar & style — no spelling, readability or AI-tone issues found.",
  );
  checks.push(
    complianceCount
      ? `Compliance — ${complianceCount} unsupported claim(s) flagged.`
      : "Compliance — no unsupported superlatives or absolute guarantees.",
  );

  let headline: string;
  if (p.status === "pass") {
    headline = verified.length
      ? `Passed — ${verified.length} claim${verified.length === 1 ? "" : "s"} checked against an authoritative source and matched.`
      : "Passed — nothing here states a checkable fact, and no grammar or compliance issues were found. Not the same as verified.";
  } else if (p.status === "warning") {
    headline = "Needs review — see the findings below.";
  } else {
    headline = "Failed — see the findings below.";
  }
  return { headline, checks };
}

export function paragraphStatus(p: Omit<ParagraphAudit, "status" | "confidence">): {
  status: Status;
  confidence: number;
} {
  const all: Status[] = [
    ...p.claims.map((c) => c.status),
    ...p.issues.map((i) => i.severity),
  ];
  let status: Status = "pass";
  if (all.includes("fail")) status = "fail";
  else if (all.includes("warning")) status = "warning";

  const confidences = p.claims.map((c) => c.confidence);
  const confidence = confidences.length
    ? round1(confidences.reduce((a, b) => a + b, 0) / confidences.length)
    : status === "pass"
      ? 0.9
      : 0.6;
  return { status, confidence };
}
