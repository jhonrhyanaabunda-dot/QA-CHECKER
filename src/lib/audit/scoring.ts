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
/** A reference whose URL was confirmed to resolve. */
export interface CheckSource {
  label: string;
  url: string;
}

/** One check that ran against a paragraph, with the evidence behind it. */
export interface ParagraphCheck {
  label: string;
  detail: string;
  /**
   * True when a source was actually fetched for THIS paragraph. False means
   * the listed references are the standard the check applies, not something
   * consulted — a distinction that matters when nothing was checkable.
   */
  consulted: boolean;
  sources: CheckSource[];
}

// Authorities each check answers to. Every URL here was confirmed to return
// HTTP 200; none are model-generated.
const EPA: CheckSource = { label: "EPA FuelEconomy.gov", url: "https://www.fueleconomy.gov/feg/findacar.shtml" };
const NHTSA: CheckSource = { label: "NHTSA vPIC", url: "https://vpic.nhtsa.dot.gov/api/" };
const FTC: CheckSource = { label: "FTC advertising guidance", url: "https://www.ftc.gov/business-guidance/advertising-marketing" };

/**
 * The authorities these checks answer to. Listed once in the report and in the
 * exported document rather than repeated under every paragraph, where the same
 * three links appeared hundreds of times and buried the sources that were
 * actually fetched.
 */
export const CHECK_AUTHORITIES: CheckSource[] = [EPA, NHTSA, FTC];

/**
 * Why a paragraph carries the status it does, in the reviewer's terms.
 *
 * A green badge on its own is ambiguous in a way that matters for sign-off:
 * a paragraph containing no checkable claim and one whose figures were
 * confirmed against the EPA both render as PASS, and those are very different
 * things to put your name to. This states which of the two it is, lists every
 * check that ran, and carries the source behind each one.
 */
export function explainParagraph(
  p: Pick<ParagraphAudit, "claims" | "issues" | "status">,
  complianceCount = 0,
  opts: { analyzer?: string; complianceSources?: string[] } = {},
): { headline: string; checks: ParagraphCheck[] } {
  const verified = p.claims.filter((c) => c.status === "pass");
  const warning = p.claims.filter((c) => c.status === "warning");
  const failing = p.claims.filter((c) => c.status === "fail");

  const checks: ParagraphCheck[] = [];

  // ── Facts ────────────────────────────────────────────────────────────────
  // Prefer the exact pages claims were actually verified against; fall back to
  // naming the authorities the check would have used.
  const claimSources: CheckSource[] = [];
  const seen = new Set<string>();
  for (const c of p.claims) {
    if (!c.sourceUrl || seen.has(c.sourceUrl)) continue;
    seen.add(c.sourceUrl);
    claimSources.push({ label: c.source || "source", url: c.sourceUrl });
  }
  if (!p.claims.length) {
    checks.push({
      label: "Factual claims",
      detail:
        "None detected — no figures, prices, ratings, specs or dates in this text to check against a source, so none was consulted.",
      consulted: false,
      sources: [],
    });
  } else {
    const parts = [`${p.claims.length} detected`];
    if (verified.length) parts.push(`${verified.length} verified`);
    if (warning.length) parts.push(`${warning.length} flagged`);
    if (failing.length) parts.push(`${failing.length} incorrect`);
    checks.push({
      label: "Factual claims",
      detail: `${parts.join(", ")}.`,
      consulted: claimSources.length > 0,
      sources: claimSources,
    });
  }

  // ── Grammar / style ──────────────────────────────────────────────────────
  // No external authority exists for this one; the honest provenance is which
  // analyzer produced the verdict.
  checks.push({
    label: "Grammar & style",
    detail: p.issues.length
      ? `${p.issues.length} issue(s) found.`
      : `No spelling, readability or AI-tone issues found. Checked by ${opts.analyzer || "the rule-based analyzer"}.`,
    consulted: true,
    sources: [],
  });

  // ── Compliance ───────────────────────────────────────────────────────────
  const compSources: CheckSource[] = (opts.complianceSources ?? [])
    .filter(Boolean)
    .slice(0, 3)
    .map((url) => ({ label: "FTC guidance", url }));
  checks.push({
    label: "Compliance",
    detail: complianceCount
      ? `${complianceCount} unsupported claim(s) flagged.`
      : "No unsupported superlatives or absolute guarantees found.",
    consulted: complianceCount > 0,
    sources: compSources,
  });

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
