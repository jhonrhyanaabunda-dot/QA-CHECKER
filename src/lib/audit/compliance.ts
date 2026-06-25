// ───────────────────────────────────────────────────────────────────────────
// Compliance checker — flags unsupported superlative / absolute claims that
// dealership advertising guidelines (and FTC truth-in-advertising rules)
// require be substantiated or removed: "best dealership", "lowest prices",
// "#1 dealer", "industry leading", etc. Each finding includes the rule it
// trips and a concrete remediation.
// ───────────────────────────────────────────────────────────────────────────

import { genId } from "../utils";
import { ftcGuidanceUrl } from "../verifiers/sources";
import type { ComplianceFinding, Status } from "./types";

interface Rule {
  re: RegExp;
  rule: string;
  severity: Status;
  recommendation: string;
}

const RULES: Rule[] = [
  {
    re: /\bbest\s+(?:dealer(?:ship)?|prices?|deals?|selection|service)\b/gi,
    rule: "Unsupported superlative",
    severity: "fail",
    recommendation: 'Remove "best" or substantiate with a cited, verifiable source and date.',
  },
  {
    re: /\blowest\s+(?:prices?|rates?)\b/gi,
    rule: "Unsupported price claim",
    severity: "fail",
    recommendation: 'Replace "lowest prices" with a specific, verifiable offer or remove.',
  },
  {
    re: /\b(?:#\s?1|number\s+one|no\.\s?1|top[-\s]?rated)\b/gi,
    rule: "Unsupported ranking claim",
    severity: "fail",
    recommendation: 'Cite the ranking source, period, and market, or remove the "#1" claim.',
  },
  {
    re: /\bindustry[-\s]?leading\b/gi,
    rule: "Vague superiority claim",
    severity: "warning",
    recommendation: 'Quantify what makes it "industry-leading" or remove.',
  },
  {
    re: /\bgame[-\s]?chang(?:ing|er)\b/gi,
    rule: "Hyperbolic marketing language",
    severity: "warning",
    recommendation: "Replace hyperbole with a concrete benefit.",
  },
  {
    re: /\b(?:guaranteed?\s+(?:lowest|best)|unbeatable|cheapest)\b/gi,
    rule: "Absolute guarantee claim",
    severity: "fail",
    recommendation: "Avoid absolute guarantees unless backed by a written, honored policy.",
  },
  {
    re: /\b(?:everyone|nobody|always|never)\s+(?:approved|qualifies|beats)\b/gi,
    rule: "Absolute credit/qualification claim",
    severity: "fail",
    recommendation: "Credit approval is conditional — add qualifying disclosures.",
  },
];

export function checkCompliance(paragraphs: string[]): ComplianceFinding[] {
  const findings: ComplianceFinding[] = [];
  paragraphs.forEach((para, paragraphIndex) => {
    for (const r of RULES) {
      for (const m of para.matchAll(r.re)) {
        const idx = m.index ?? 0;
        findings.push({
          id: genId("comp"),
          phrase: m[0],
          excerpt: excerpt(para, idx, m[0].length),
          paragraphIndex,
          severity: r.severity,
          rule: r.rule,
          recommendation: r.recommendation,
          sourceUrl: ftcGuidanceUrl(r.rule),
        });
      }
    }
  });
  return findings;
}

function excerpt(text: string, index: number, len: number): string {
  const start = Math.max(0, index - 40);
  const end = Math.min(text.length, index + len + 40);
  return (start > 0 ? "…" : "") + text.slice(start, end).trim() + (end < text.length ? "…" : "");
}
