// ───────────────────────────────────────────────────────────────────────────
// Core domain types for the DealerQA AI audit engine.
//
// The audit pipeline turns a URL into a fully-structured `Audit` record:
//   crawl → extract → detect claims → verify → score → persist
// Every layer reads/writes the types declared here so the UI, API, exports and
// persistence all share one contract.
// ───────────────────────────────────────────────────────────────────────────

/** Status applied to any individual check or to a whole section. */
export type Status = "pass" | "warning" | "fail";

/** The five scored QA dimensions, plus the rolled-up overall score. */
export interface ScoreBreakdown {
  overall: number; // 0-100
  facts: number;
  grammar: number;
  links: number;
  compliance: number;
  seo: number;
}

/** A category of factual claim the engine knows how to reason about. */
export type ClaimType =
  | "mpg"
  | "fuel_economy"
  | "warranty"
  | "lease"
  | "pricing"
  | "rating"
  | "review_count"
  | "vehicle_spec"
  | "incentive"
  | "manufacturer_claim"
  | "phone"
  | "statistic";

/** A single detected factual claim with its verification outcome. */
export interface Claim {
  id: string;
  type: ClaimType;
  /** Verbatim text fragment that triggered detection. */
  text: string;
  /** Normalized numeric/string value extracted from the text, when applicable. */
  value?: string;
  /** Index of the paragraph this claim was found in (-1 if page-level). */
  paragraphIndex: number;
  status: Status;
  confidence: number; // 0-1
  /** Human-readable explanation of the verification result. */
  verification: string;
  /** Authoritative value the engine compared against, if found. */
  officialValue?: string;
  /** Suggested correction text when status is warning/fail. */
  suggestedCorrection?: string;
  /** Source(s) used to verify, or flagged missing. */
  source?: string;
  /** Direct, clickable URL to the authoritative source for verification. */
  sourceUrl?: string;
  sourceMissing?: boolean;
}

/** One paragraph in the paragraph-by-paragraph audit. */
export interface ParagraphAudit {
  index: number;
  content: string;
  claims: Claim[];
  status: Status;
  confidence: number;
  /** Grammar / style / readability notes for this paragraph. */
  issues: ContentIssue[];
  suggestedCorrection?: string;
}

/** Grammar, style, readability, AI-tone or keyword-stuffing finding. */
export interface ContentIssue {
  id: string;
  kind:
    | "grammar"
    | "spelling"
    | "readability"
    | "ai_tone"
    | "keyword_stuffing"
    | "repetition";
  severity: Status;
  message: string;
  excerpt?: string;
  suggestion?: string;
}

/** Result of checking a single hyperlink. */
export interface LinkCheck {
  id: string;
  url: string;
  text: string;
  status: Status;
  httpStatus?: number;
  /** Final URL after following redirects, if it differs. */
  redirectedTo?: string;
  redirectChain?: number;
  error?: string;
}

/** Compliance finding for unsupported/superlative claims. */
export interface ComplianceFinding {
  id: string;
  phrase: string;
  excerpt: string;
  paragraphIndex: number;
  severity: Status;
  rule: string;
  recommendation: string;
  /** Direct link to substantiation guidance (FTC / dealer advertising rules). */
  sourceUrl?: string;
}

/** A detected Google rating + review-count pair and its cross-check. */
export interface RatingCheck {
  id: string;
  displayedRating?: number;
  displayedReviewCount?: number;
  currentRating?: number;
  currentReviewCount?: number;
  status: Status;
  source: string;
  /** Direct link to the dealership's live Google profile for verification. */
  sourceUrl?: string;
  recommendation?: string;
}

/** Structured content pulled out of the crawled page. */
export interface ExtractedContent {
  url: string;
  finalUrl: string;
  title: string;
  metaDescription?: string;
  headings: { level: number; text: string }[];
  paragraphs: string[];
  lists: { ordered: boolean; items: string[] }[];
  tables: { rows: string[][] }[];
  buttons: string[];
  ctas: string[];
  phones: string[];
  links: { url: string; text: string }[];
  images: { src: string; alt: string; caption?: string }[];
  /** Raw visible text, used for page-level claim sweeps. */
  text: string;
  wordCount: number;
}

/** Live progress event streamed to the client during an audit. */
export interface ProgressEvent {
  step: string;
  label: string;
  progress: number; // 0-100
  done?: boolean;
  auditId?: string;
}

export type AuditStatus = "queued" | "running" | "complete" | "error";

/** Reviewer sign-off checklist. */
export interface ReviewChecklist {
  factVerified: boolean;
  grammarChecked: boolean;
  linksChecked: boolean;
  complianceChecked: boolean;
  approved: boolean;
}

/** The complete persisted audit record. */
export interface Audit {
  id: string;
  url: string;
  finalUrl: string;
  title: string;
  status: AuditStatus;
  createdAt: string;
  completedAt?: string;
  reviewer: string;
  llmProvider: string;
  /** The dealership this page belongs to + its main website (verify-link target). */
  dealership: { name: string; website?: string; domain?: string };
  score: ScoreBreakdown;
  summary: {
    pass: number;
    warning: number;
    fail: number;
    totalClaims: number;
    totalLinks: number;
    brokenLinks: number;
    wordCount: number;
  };
  content: ExtractedContent;
  paragraphs: ParagraphAudit[];
  pageLevelClaims: Claim[];
  links: LinkCheck[];
  compliance: ComplianceFinding[];
  ratings: RatingCheck[];
  contentIssues: ContentIssue[];
  review: ReviewChecklist;
  /** Optional full-page screenshot (data URL or path) when Playwright present. */
  screenshot?: string;
  error?: string;
}

/** Lightweight audit row for history/dashboard lists. */
export interface AuditSummaryRow {
  id: string;
  url: string;
  title: string;
  status: AuditStatus;
  createdAt: string;
  reviewer: string;
  overall: number;
  fail: number;
  warning: number;
  approved: boolean;
}
