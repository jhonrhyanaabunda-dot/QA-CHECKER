"use client";

// ───────────────────────────────────────────────────────────────────────────
// AuditReport — the full report view. Header with overall + dimension scores,
// reviewer sign-off checklist, exports, and tabbed sections (paragraph audit,
// fact claims, links, compliance, content structure, visual QA).
// ───────────────────────────────────────────────────────────────────────────

import { useState } from "react";
import Link from "next/link";
import {
  ArrowLeft, Download, FileJson, FileSpreadsheet, Printer, ExternalLink,
  ListChecks, FileText, Link2, ShieldAlert, LayoutPanelTop, Image as ImageIcon,
  Phone, Star, ChevronDown,
} from "lucide-react";
import {
  Button, Card, CardContent, CardHeader, CardTitle, Badge, StatusBadge,
  Separator, Checkbox, Progress,
} from "@/components/ui/primitives";
import { ScoreRing } from "@/components/score-ring";
import { AutoFixPanel } from "@/components/auto-fix-panel";
import { cn, formatDate, scoreColor } from "@/lib/utils";
import type {
  Audit, Claim, ClaimAnswer, ContentIssue, ParagraphAudit, ReviewChecklist, Status,
} from "@/lib/audit/types";

const TABS = [
  { key: "paragraphs", label: "Paragraph Audit", icon: FileText },
  { key: "facts", label: "Fact Claims", icon: ListChecks },
  { key: "links", label: "Links", icon: Link2 },
  { key: "compliance", label: "Compliance", icon: ShieldAlert },
  { key: "content", label: "Content & SEO", icon: LayoutPanelTop },
  { key: "visual", label: "Visual QA", icon: ImageIcon },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export function AuditReport({ audit: initial }: { audit: Audit }) {
  const [audit, setAudit] = useState(initial);
  const [tab, setTab] = useState<TabKey>("paragraphs");

  const dims = [
    { label: "Facts", value: audit.score.facts },
    { label: "Grammar", value: audit.score.grammar },
    { label: "Links", value: audit.score.links },
    { label: "Compliance", value: audit.score.compliance },
    { label: "SEO", value: audit.score.seo },
  ];

  async function patchReview(patch: Partial<ReviewChecklist>) {
    setAudit((a) => ({ ...a, review: { ...a.review, ...patch } }));
    await fetch(`/api/audit/${audit.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
  }

  const tabCounts: Record<TabKey, number> = {
    paragraphs: audit.paragraphs.length,
    facts: audit.summary.totalClaims,
    links: audit.links.length,
    compliance: audit.compliance.length,
    content: audit.content.headings.length,
    visual: audit.content.images.length,
  };

  return (
    <div className="space-y-6">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-4 no-print">
        <Link href="/audits" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" /> Back to history
        </Link>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => window.print()}>
            <Printer /> Print / PDF
          </Button>
          <a href={`/api/export/${audit.id}?format=csv`}>
            <Button variant="outline" size="sm"><FileSpreadsheet /> CSV / Excel</Button>
          </a>
          <a href={`/api/export/${audit.id}?format=json`}>
            <Button variant="outline" size="sm"><FileJson /> JSON</Button>
          </a>
        </div>
      </div>

      <Card className="print-break">
        <CardContent className="grid gap-6 pt-6 md:grid-cols-[auto_1fr]">
          <div className="flex flex-col items-center gap-3">
            <ScoreRing score={audit.score.overall} />
            <Badge variant={scoreColor(audit.score.overall) === "success" ? "success" : scoreColor(audit.score.overall) === "warning" ? "warning" : "destructive"}>
              {audit.score.overall >= 90 ? "Excellent" : audit.score.overall >= 75 ? "Needs review" : "Action required"}
            </Badge>
          </div>

          <div className="min-w-0">
            <h1 className="truncate text-2xl font-bold">{audit.title}</h1>
            <a
              href={audit.finalUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-1 inline-flex items-center gap-1 text-sm text-primary hover:underline"
            >
              <span className="truncate">{audit.finalUrl}</span>
              <ExternalLink className="size-3.5 shrink-0" />
            </a>

            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span>Reviewed by <b className="text-foreground">{audit.reviewer}</b></span>
              <span>{formatDate(audit.createdAt)}</span>
              <span>{audit.summary.wordCount.toLocaleString()} words</span>
              <span>AI: {audit.llmProvider}</span>
            </div>

            {audit.dealership?.name && (
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                <Badge variant="secondary">Dealership: {audit.dealership.name}</Badge>
                {audit.dealership.website ? (
                  <a
                    href={audit.dealership.website}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-primary hover:underline"
                  >
                    {audit.dealership.domain} — verify-link target
                    <ExternalLink className="size-3" />
                  </a>
                ) : (
                  <span className="text-muted-foreground">main website not detected — verify links search by name</span>
                )}
              </div>
            )}

            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
              {dims.map((d) => (
                <div key={d.label}>
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">{d.label}</span>
                    <span className="font-semibold tabular-nums">{Math.round(d.value)}%</span>
                  </div>
                  <Progress value={d.value} />
                </div>
              ))}
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <Badge variant="success">{audit.summary.pass} pass</Badge>
              <Badge variant="warning">{audit.summary.warning} warnings</Badge>
              <Badge variant="destructive">{audit.summary.fail} fails</Badge>
              <Badge variant="secondary">{audit.summary.brokenLinks} broken links</Badge>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Reviewer sign-off ──────────────────────────────────────────── */}
      <ReviewChecklistCard review={audit.review} onChange={patchReview} />

      {/* ── Auto-fix & developer handoff ───────────────────────────────── */}
      <AutoFixPanel auditId={audit.id} />

      {/* ── Tabs ───────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-1 border-b no-print">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors",
              tab === t.key
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            <t.icon className="size-4" />
            {t.label}
            <span className="rounded-full bg-secondary px-1.5 text-xs tabular-nums">{tabCounts[t.key]}</span>
          </button>
        ))}
      </div>

      <div>
        {tab === "paragraphs" && <ParagraphsTab audit={audit} />}
        {tab === "facts" && <FactsTab audit={audit} />}
        {tab === "links" && <LinksTab audit={audit} />}
        {tab === "compliance" && <ComplianceTab audit={audit} />}
        {tab === "content" && <ContentTab audit={audit} />}
        {tab === "visual" && <VisualTab audit={audit} />}
      </div>
    </div>
  );
}

// ── Reviewer checklist ───────────────────────────────────────────────────────
function ReviewChecklistCard({
  review,
  onChange,
}: {
  review: ReviewChecklist;
  onChange: (p: Partial<ReviewChecklist>) => void;
}) {
  const items: { key: keyof ReviewChecklist; label: string }[] = [
    { key: "factVerified", label: "Fact Verified" },
    { key: "grammarChecked", label: "Grammar Checked" },
    { key: "linksChecked", label: "Links Checked" },
    { key: "complianceChecked", label: "Compliance Checked" },
  ];
  return (
    <Card className="print-break">
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">Reviewer Sign-off</CardTitle>
        {review.approved ? (
          <Badge variant="success">Approved</Badge>
        ) : (
          <Badge variant="secondary">Pending approval</Badge>
        )}
      </CardHeader>
      <CardContent>
        <div className="grid gap-x-8 gap-y-1 sm:grid-cols-2 lg:grid-cols-4">
          {items.map((it) => (
            <Checkbox
              key={it.key}
              id={it.key}
              checked={review[it.key]}
              onChange={(v) => onChange({ [it.key]: v })}
              label={it.label}
            />
          ))}
        </div>
        <Separator className="my-3" />
        <Checkbox
          id="approved"
          checked={review.approved}
          onChange={(v) => onChange({ approved: v })}
          label={<span className="font-semibold">Approve this audit for publishing</span>}
        />
      </CardContent>
    </Card>
  );
}

// ── Paragraph audit tab ──────────────────────────────────────────────────────
function ParagraphsTab({ audit }: { audit: Audit }) {
  if (!audit.paragraphs.length)
    return <Empty msg="No paragraph content was extracted from this page." />;
  return (
    <div className="space-y-3">
      {audit.paragraphs.map((p) => (
        <ParagraphCard key={p.index} p={p} />
      ))}
    </div>
  );
}

function ParagraphCard({ p }: { p: ParagraphAudit }) {
  const [open, setOpen] = useState(p.status !== "pass");
  const hasDetail = p.claims.length > 0 || p.issues.length > 0;
  return (
    <Card className={cn("print-break", borderForStatus(p.status))}>
      <button
        className="flex w-full items-start gap-3 p-4 text-left"
        onClick={() => hasDetail && setOpen((o) => !o)}
      >
        <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-md bg-secondary text-xs font-semibold tabular-nums">
          {p.index + 1}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm leading-relaxed">{p.content}</p>
          {hasDetail && (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {p.claims.length > 0 && <span>{p.claims.length} claim(s)</span>}
              {p.issues.length > 0 && <span>{p.issues.length} content issue(s)</span>}
              <span>· confidence {Math.round(p.confidence * 100)}%</span>
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <StatusBadge status={p.status} />
          {hasDetail && <ChevronDown className={cn("size-4 text-muted-foreground transition-transform", open && "rotate-180")} />}
        </div>
      </button>

      {open && hasDetail && (
        <CardContent className="space-y-3 pt-0">
          <Separator />
          {p.claims.map((c) => <ClaimRow key={c.id} claim={c} />)}
          {p.issues.map((i) => <IssueRow key={i.id} issue={i} />)}
          {p.suggestedCorrection && (
            <div className="rounded-lg bg-success/10 p-3 text-sm">
              <span className="font-medium text-success">Suggested correction: </span>
              {p.suggestedCorrection}
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}

function ClaimRow({ claim }: { claim: Claim }) {
  return (
    <div className="rounded-lg border bg-background/50 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={claim.status} />
        <Badge variant="outline" className="uppercase">{claim.type.replace(/_/g, " ")}</Badge>
        {claim.value && <code className="rounded bg-secondary px-1.5 py-0.5 text-xs">{claim.value}</code>}
        <span className="ml-auto text-xs text-muted-foreground">conf {Math.round(claim.confidence * 100)}%</span>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">{claim.verification}</p>
      {claim.answer && <ClaimAnswerBlock answer={claim.answer} />}
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {claim.officialValue && (
          <span>Official: <b>{claim.officialValue}</b></span>
        )}
        {claim.suggestedCorrection && (
          <span className="text-success">Fix: {claim.suggestedCorrection}</span>
        )}
        {claim.source && !claim.sourceUrl && (
          <span className={cn("text-muted-foreground", claim.sourceMissing && "text-destructive")}>
            Source: {claim.source}
          </span>
        )}
        {claim.sourceUrl && <SourceLink label={claim.source || "source"} url={claim.sourceUrl} />}
      </div>
    </div>
  );
}

/**
 * The resolution for a warning the automated checks could not settle. An
 * admitted gap is rendered differently from a real answer so the reviewer is
 * never left thinking a "could not determine" is a verified figure.
 */
function ClaimAnswerBlock({ answer }: { answer: ClaimAnswer }) {
  return (
    <div
      className={cn(
        "mt-2 rounded-md border-l-2 p-2",
        answer.unresolved ? "border-warning bg-warning/5" : "border-primary bg-primary/5",
      )}
    >
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "text-[11px] font-semibold uppercase tracking-wide",
            answer.unresolved ? "text-warning" : "text-primary",
          )}
        >
          {answer.unresolved ? "Needs a human" : "Answer"}
        </span>
        <span className="ml-auto text-[11px] text-muted-foreground">
          conf {Math.round(answer.confidence * 100)}%
        </span>
      </div>
      <p className="mt-1 text-sm">{answer.answer}</p>
      <p className="mt-1 text-xs text-muted-foreground">{answer.basis}</p>
      {answer.sourceUrl && (
        <div className="mt-1.5 text-xs">
          <SourceLink label="verify" url={answer.sourceUrl} />
        </div>
      )}
    </div>
  );
}

/** A direct, clickable link to the authoritative source for a correction. */
function SourceLink({ label, url }: { label: string; url: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
      title={url}
    >
      Verify: {label}
      <ExternalLink className="size-3" />
    </a>
  );
}

function IssueRow({ issue }: { issue: ContentIssue }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border bg-background/50 p-3 text-sm">
      <StatusBadge status={issue.severity} />
      <div className="min-w-0">
        <Badge variant="outline" className="mb-1 uppercase">{issue.kind.replace(/_/g, " ")}</Badge>
        <p>{issue.message}</p>
        {issue.excerpt && <p className="mt-1 text-xs italic text-muted-foreground">“{issue.excerpt}”</p>}
        {issue.suggestion && <p className="mt-1 text-xs text-success">→ {issue.suggestion}</p>}
      </div>
    </div>
  );
}

// ── Fact claims tab ──────────────────────────────────────────────────────────
function FactsTab({ audit }: { audit: Audit }) {
  const all = [...audit.paragraphs.flatMap((p) => p.claims), ...audit.pageLevelClaims];
  if (!all.length) return <Empty msg="No factual claims were detected." />;
  return (
    <div className="space-y-4">
      <RatingsSection audit={audit} />
      <div className="space-y-2">
        {all.map((c) => (
          <Card key={c.id} className="print-break">
            <CardContent className="pt-4">
              <ClaimRow claim={c} />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function RatingsSection({ audit }: { audit: Audit }) {
  if (!audit.ratings.length) return null;
  return (
    <div className="space-y-2">
      {audit.ratings.map((r) => (
        <Card key={r.id} className={cn(borderForStatus(r.status))}>
          <CardContent className="flex flex-wrap items-center gap-4 pt-4">
            <Star className="size-5 text-warning" />
            <div className="flex-1">
              <p className="text-sm font-medium">Google Rating Verification</p>
              <p className="text-xs text-muted-foreground">{r.source}</p>
            </div>
            <div className="flex gap-6 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">Displayed</p>
                <p className="font-semibold">{r.displayedRating ?? "—"}★ · {r.displayedReviewCount?.toLocaleString() ?? "—"} reviews</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Live</p>
                <p className="font-semibold">{r.currentRating ? `${r.currentRating}★ · ${r.currentReviewCount?.toLocaleString()} reviews` : "—"}</p>
              </div>
            </div>
            <StatusBadge status={r.status} />
            {r.recommendation && <p className="w-full text-xs text-muted-foreground">{r.recommendation}</p>}
            {r.sourceUrl && (
              <p className="w-full text-xs"><SourceLink label="live Google reviews" url={r.sourceUrl} /></p>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ── Links tab ────────────────────────────────────────────────────────────────
function LinksTab({ audit }: { audit: Audit }) {
  if (!audit.links.length) return <Empty msg="No hyperlinks found on this page." />;
  return (
    <Card>
      <CardContent className="p-0">
        <div className="divide-y">
          {audit.links.map((l) => (
            <div key={l.id} className="flex items-center gap-3 p-3 text-sm">
              <StatusBadge status={l.status} />
              <div className="min-w-0 flex-1">
                <a href={l.url} target="_blank" rel="noreferrer" className="block truncate text-primary hover:underline">
                  {l.url}
                </a>
                {(l.error || l.redirectedTo) && (
                  <p className="truncate text-xs text-muted-foreground">
                    {l.error}{l.redirectedTo && ` → ${l.redirectedTo}`}
                  </p>
                )}
              </div>
              {l.httpStatus && (
                <code className="shrink-0 rounded bg-secondary px-1.5 py-0.5 text-xs">{l.httpStatus}</code>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Compliance tab ───────────────────────────────────────────────────────────
function ComplianceTab({ audit }: { audit: Audit }) {
  if (!audit.compliance.length)
    return <Empty msg="No compliance issues detected — no unsupported superlatives found." />;
  return (
    <div className="space-y-2">
      {audit.compliance.map((c) => (
        <Card key={c.id} className={cn(borderForStatus(c.severity), "print-break")}>
          <CardContent className="pt-4">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={c.severity} />
              <span className="font-medium">{c.rule}</span>
              <code className="rounded bg-destructive/10 px-1.5 py-0.5 text-xs text-destructive">{c.phrase}</code>
              <span className="ml-auto text-xs text-muted-foreground">¶ {c.paragraphIndex + 1}</span>
            </div>
            <p className="mt-2 text-sm italic text-muted-foreground">“{c.excerpt}”</p>
            <p className="mt-2 text-sm text-success">→ {c.recommendation}</p>
            {c.sourceUrl && (
              <p className="mt-1 text-xs"><SourceLink label="FTC advertising guidance" url={c.sourceUrl} /></p>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ── Content & SEO tab ────────────────────────────────────────────────────────
function ContentTab({ audit }: { audit: Audit }) {
  const c = audit.content;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader><CardTitle className="text-base">Heading Outline</CardTitle></CardHeader>
        <CardContent className="space-y-1">
          {c.headings.length ? c.headings.map((h, i) => (
            <div key={i} className="text-sm" style={{ paddingLeft: (h.level - 1) * 14 }}>
              <span className="mr-2 text-xs font-mono text-muted-foreground">H{h.level}</span>
              {h.text}
            </div>
          )) : <Empty msg="No headings found." inline />}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Page Metadata</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          <Meta label="Title" value={c.title} />
          <Meta label="Meta description" value={c.metaDescription || "— missing —"} ok={!!c.metaDescription} />
          <Meta label="Word count" value={c.wordCount.toLocaleString()} />
          <Meta label="Paragraphs" value={String(c.paragraphs.length)} />
          <Meta label="Images" value={`${c.images.length} (${c.images.filter(i => !i.alt).length} missing alt)`} />
          <Meta label="Tables" value={String(c.tables.length)} />
        </CardContent>
      </Card>

      {c.ctas.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">CTAs & Buttons</CardTitle></CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {[...new Set([...c.ctas, ...c.buttons])].slice(0, 24).map((t, i) => (
              <Badge key={i} variant="secondary">{t}</Badge>
            ))}
          </CardContent>
        </Card>
      )}

      {c.phones.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Phone Numbers</CardTitle></CardHeader>
          <CardContent className="space-y-1">
            {c.phones.map((p, i) => (
              <div key={i} className="flex items-center gap-2 text-sm">
                <Phone className="size-4 text-muted-foreground" /> {p}
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ── Visual QA tab ────────────────────────────────────────────────────────────
function VisualTab({ audit }: { audit: Audit }) {
  return (
    <div className="space-y-4">
      {audit.screenshot ? (
        <Card>
          <CardHeader><CardTitle className="text-base">Full-page screenshot</CardTitle></CardHeader>
          <CardContent>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={audit.screenshot} alt="Full page screenshot" className="w-full rounded-lg border" />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">
            No screenshot captured. Re-run with “Capture full-page screenshot” enabled
            (requires <code className="rounded bg-secondary px-1 py-0.5">npx playwright install chromium</code>).
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle className="text-base">Images & captions ({audit.content.images.length})</CardTitle></CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {audit.content.images.length ? audit.content.images.slice(0, 24).map((img, i) => (
            <div key={i} className="overflow-hidden rounded-lg border">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={img.src} alt={img.alt} className="aspect-video w-full bg-secondary object-cover" />
              <div className="p-2">
                <p className={cn("truncate text-xs", img.alt ? "text-muted-foreground" : "text-destructive")}>
                  {img.alt || "⚠ Missing alt text"}
                </p>
                {img.caption && <p className="truncate text-xs italic">{img.caption}</p>}
              </div>
            </div>
          )) : <Empty msg="No images found." inline />}
        </CardContent>
      </Card>
    </div>
  );
}

// ── helpers ──────────────────────────────────────────────────────────────────
function Meta({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("text-right font-medium", ok === false && "text-destructive")}>{value}</span>
    </div>
  );
}

function borderForStatus(status: Status): string {
  return status === "fail"
    ? "border-l-4 border-l-destructive"
    : status === "warning"
      ? "border-l-4 border-l-warning"
      : "border-l-4 border-l-success";
}

function Empty({ msg, inline }: { msg: string; inline?: boolean }) {
  if (inline) return <p className="text-sm text-muted-foreground">{msg}</p>;
  return (
    <Card>
      <CardContent className="py-10 text-center text-sm text-muted-foreground">{msg}</CardContent>
    </Card>
  );
}
