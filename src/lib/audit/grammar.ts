// ───────────────────────────────────────────────────────────────────────────
// Grammar & style QA — deterministic heuristics for grammar/spelling slips,
// readability, AI-generated tone, keyword stuffing and repetition. When an LLM
// provider is configured, `enrichWithLlm` augments these with model-found issues
// (it never replaces the deterministic pass, so results stay reproducible).
// ───────────────────────────────────────────────────────────────────────────

import { genId } from "../utils";
import { completeJson } from "../llm";
import type { ContentIssue } from "./types";

const COMMON_MISSPELLINGS: Record<string, string> = {
  recieve: "receive",
  seperate: "separate",
  definately: "definitely",
  occured: "occurred",
  accomodate: "accommodate",
  wich: "which",
  alot: "a lot",
  untill: "until",
  buisness: "business",
  maintainance: "maintenance",
  warrenty: "warranty",
  millage: "mileage",
  vehical: "vehicle",
  garantee: "guarantee",
  financed: "financed",
};

// Phrases that read as AI-generated filler.
const AI_TONE = [
  "in today's fast-paced world",
  "in the realm of",
  "when it comes to",
  "look no further",
  "it's worth noting that",
  "in conclusion",
  "elevate your",
  "unlock the",
  "a testament to",
  "the perfect blend of",
  "whether you're",
  "rest assured",
  "navigating the",
  "in the world of",
];

export function analyzeContent(paragraphs: string[]): {
  issues: ContentIssue[];
  perParagraph: ContentIssue[][];
} {
  const perParagraph: ContentIssue[][] = paragraphs.map(() => []);
  const all: ContentIssue[] = [];

  const push = (pIdx: number, issue: ContentIssue) => {
    perParagraph[pIdx].push(issue);
    all.push(issue);
  };

  paragraphs.forEach((para, i) => {
    const lower = para.toLowerCase();

    // Spelling
    for (const [bad, good] of Object.entries(COMMON_MISSPELLINGS)) {
      if (new RegExp(`\\b${bad}\\b`, "i").test(para)) {
        push(i, {
          id: genId("iss"),
          kind: "spelling",
          severity: "fail",
          message: `Possible misspelling: "${bad}"`,
          suggestion: good,
        });
      }
    }

    // Doubled words ("the the")
    const dbl = para.match(/\b(\w+)\s+\1\b/i);
    if (dbl) {
      push(i, {
        id: genId("iss"),
        kind: "grammar",
        severity: "warning",
        message: `Repeated word: "${dbl[1]} ${dbl[1]}"`,
        excerpt: dbl[0],
        suggestion: dbl[1],
      });
    }

    // Double spaces / spacing before punctuation
    if (/\s{2,}\S/.test(para) || /\s[.,!?]/.test(para)) {
      push(i, {
        id: genId("iss"),
        kind: "grammar",
        severity: "warning",
        message: "Spacing issue (double space or space before punctuation).",
      });
    }

    // Readability — long sentences
    const sentences = para.split(/(?<=[.!?])\s+/);
    const longSentence = sentences.find((s) => s.split(/\s+/).length > 40);
    if (longSentence) {
      push(i, {
        id: genId("iss"),
        kind: "readability",
        severity: "warning",
        message: `Very long sentence (${longSentence.split(/\s+/).length} words) — consider splitting.`,
        excerpt: longSentence.slice(0, 120) + "…",
      });
    }

    // AI tone
    for (const phrase of AI_TONE) {
      if (lower.includes(phrase)) {
        push(i, {
          id: genId("iss"),
          kind: "ai_tone",
          severity: "warning",
          message: `AI-generated-sounding phrase: "${phrase}"`,
          suggestion: "Rewrite in a specific, dealership-authentic voice.",
        });
        break;
      }
    }

    // Keyword stuffing — a non-stopword repeated heavily in one paragraph
    const words = lower.match(/\b[a-z]{4,}\b/g) || [];
    const freq = new Map<string, number>();
    for (const w of words) freq.set(w, (freq.get(w) || 0) + 1);
    for (const [w, count] of freq) {
      if (count >= 4 && words.length > 20 && !STOPWORDS.has(w)) {
        push(i, {
          id: genId("iss"),
          kind: "keyword_stuffing",
          severity: "warning",
          message: `"${w}" appears ${count}× in one paragraph — possible keyword stuffing.`,
        });
        break;
      }
    }
  });

  // Cross-paragraph repetition — near-duplicate paragraphs.
  for (let i = 0; i < paragraphs.length; i++) {
    for (let j = i + 1; j < paragraphs.length; j++) {
      if (similarity(paragraphs[i], paragraphs[j]) > 0.85) {
        push(j, {
          id: genId("iss"),
          kind: "repetition",
          severity: "warning",
          message: `Paragraph ${j + 1} is highly similar to paragraph ${i + 1} (duplicate content).`,
        });
        break;
      }
    }
  }

  return { issues: all, perParagraph };
}

const STOPWORDS = new Set([
  "this", "that", "with", "your", "from", "have", "more", "they", "will",
  "their", "what", "when", "which", "there", "about", "would", "these",
  "other", "into", "than", "then", "them", "also", "been", "were", "such",
]);

/** Jaccard similarity over word sets — cheap near-duplicate detector. */
function similarity(a: string, b: string): number {
  const sa = new Set(a.toLowerCase().split(/\s+/));
  const sb = new Set(b.toLowerCase().split(/\s+/));
  if (sa.size < 6 || sb.size < 6) return 0;
  let inter = 0;
  for (const w of sa) if (sb.has(w)) inter++;
  return inter / (sa.size + sb.size - inter);
}

/** Optional LLM pass — returns extra issues, or [] if no provider configured. */
export async function enrichWithLlm(paragraphs: string[]): Promise<ContentIssue[]> {
  if (!paragraphs.length) return [];
  const sample = paragraphs.slice(0, 30).map((p, i) => `[${i}] ${p}`).join("\n\n");
  const result = await completeJson<{ issues: { paragraph: number; kind: string; severity: string; message: string; excerpt?: string; suggestion?: string }[] }>({
    system:
      "You are a QA fact-checker reviewing a dealership pillar page. The reviewer signs off on this content and is accountable for every sentence, so work one sentence at a time. Beyond grammar and spelling, your priority is paraphrase fidelity: flag any sentence whose rewrite changed the meaning of the source it came from - a dropped qualifier (\"up to\", \"on select trims\", \"with approved credit\"), a range collapsed into a single number, an EPA estimate stated as fact, or a manufacturer claim widened into a dealership promise. Never invent figures, prices, or URLs. Only report real issues.",
    prompt:
      `Review these paragraphs sentence by sentence and return JSON {"issues":[{"paragraph":<index>,"kind":"grammar|spelling|readability|ai_tone|paraphrase","severity":"warning|fail","message":"...","excerpt":"<the exact sentence>","suggestion":"<the corrected sentence>"}]}. Max 12 issues.\n\n${sample}`,
    maxTokens: 1200,
  });
  if (!result?.issues) return [];
  return result.issues.slice(0, 12).map((it) => ({
    id: genId("iss"),
    kind: (["grammar", "spelling", "readability", "ai_tone", "keyword_stuffing", "repetition", "paraphrase"].includes(it.kind) ? it.kind : "grammar") as ContentIssue["kind"],
    severity: (it.severity === "fail" ? "fail" : "warning") as ContentIssue["severity"],
    message: it.message,
    excerpt: it.excerpt,
    suggestion: it.suggestion,
  }));
}
