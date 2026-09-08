"use client";

// Auto-Fix & Developer Handoff — generates corrected revisions for an audit's
// errors and lets the reviewer send them straight to the developer (email,
// copy, or download a Markdown revision sheet).
//
// Every warning carries its own analysis (what the page says, what the source
// says, why it matters) and, where one is known, the corrected link. Fixes are
// applied automatically by default; the reviewer can untick any single one and
// the corrected page rebuilds live.

import { useMemo, useState } from "react";
import {
  Wand2, Loader2, Copy, Download, Mail, Check, ArrowRight, ExternalLink, FileText,
} from "lucide-react";
import {
  Button, Card, CardContent, CardHeader, CardTitle, Badge, Separator, Input,
} from "@/components/ui/primitives";
import type { AutoFixResult, ParagraphFix } from "@/lib/audit/autofix";

interface FixResponse {
  result: AutoFixResult;
  markdown: string;
  title: string;
  allParagraphs: string[];
}

export function AutoFixPanel({ auditId }: { auditId: string }) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<FixResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [copied, setCopied] = useState(false);
  const [copiedDoc, setCopiedDoc] = useState(false);
  // Which paragraph fixes are applied. Everything auto-applies by default —
  // unticking is the reviewer's override, not an extra step to opt in.
  const [applied, setApplied] = useState<Set<number>>(new Set());
  const [applyLinks, setApplyLinks] = useState(true);

  async function generate() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/audit/${auditId}/fix`, { method: "POST" });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      const json: FixResponse = await res.json();
      setData(json);
      setApplied(new Set(json.result.paragraphFixes.map((f) => f.paragraphIndex)));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  function toggle(index: number) {
    setApplied((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  // The corrected page, rebuilt from whichever fixes are currently ticked.
  const correctedDoc = useMemo(() => {
    if (!data) return "";
    const byIndex = new Map<number, ParagraphFix>(
      data.result.paragraphFixes.map((f) => [f.paragraphIndex, f]),
    );
    return data.allParagraphs
      .map((p, i) => {
        const f = byIndex.get(i);
        return f && applied.has(i) ? f.corrected : p;
      })
      .join("\n\n");
  }, [data, applied]);

  const autoLinks = (data?.result.linkActions ?? []).filter((l) => l.autoApplicable);
  const appliedCount =
    (data?.result.paragraphFixes ?? [])
      .filter((f) => applied.has(f.paragraphIndex))
      .reduce((n, f) => n + f.changes.length, 0) + (applyLinks ? autoLinks.length : 0);

  function copy() {
    if (!data) return;
    navigator.clipboard.writeText(data.markdown);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function copyDoc() {
    navigator.clipboard.writeText(correctedDoc);
    setCopiedDoc(true);
    setTimeout(() => setCopiedDoc(false), 1500);
  }

  function saveAs(text: string, name: string, type: string) {
    const blob = new Blob([text], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  }

  function mailto() {
    if (!data) return "#";
    const subject = `Content revisions: ${data.title}`;
    // Keep the body within common mail-client limits; full sheet via download.
    const body =
      data.markdown.length > 1800
        ? data.markdown.slice(0, 1800) + "\n\n…(truncated — full revision sheet attached/downloaded)"
        : data.markdown;
    return `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  }

  const r = data?.result;

  return (
    <Card className="border-primary/30 print-break">
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <Wand2 className="size-5 text-primary" />
          Auto-Fix & Developer Handoff
        </CardTitle>
        {r && (
          <Badge variant="secondary">
            {appliedCount} applied · {r.counts.manual} to confirm
          </Badge>
        )}
      </CardHeader>
      <CardContent>
        {!r && (
          <div className="flex flex-col items-start gap-3">
            <p className="text-sm text-muted-foreground">
              Automatically generate corrected revisions for every detected error — wrong MPG
              figures swapped for the EPA value, spelling fixed, unsupported superlatives
              neutralized, redirecting links repointed. Each correction comes with an analysis
              of why it was flagged and a link to the source it was verified against.
            </p>
            <Button onClick={generate} disabled={loading}>
              {loading ? <Loader2 className="animate-spin" /> : <Wand2 />}
              {loading ? "Generating corrections…" : "Generate corrected revisions"}
            </Button>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
        )}

        {r && (
          <div className="space-y-5">
            {/* Handoff actions */}
            <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-secondary/40 p-3">
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="developer@email.com"
                className="h-9 w-56 bg-background"
              />
              <a href={mailto()}>
                <Button size="sm" disabled={!email}><Mail /> Email to developer</Button>
              </a>
              <Button size="sm" variant="outline" onClick={copy}>
                {copied ? <Check className="text-success" /> : <Copy />} {copied ? "Copied" : "Copy sheet"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => saveAs(data!.markdown, `revisions-${auditId.slice(-6)}.md`, "text/markdown")}
              >
                <Download /> Download .md
              </Button>
              <span className="ml-auto text-xs text-muted-foreground">by {r.generatedBy}</span>
            </div>

            {/* Paragraph corrections */}
            {r.paragraphFixes.length > 0 && (
              <div className="space-y-3">
                <h4 className="text-sm font-semibold">
                  Corrected paragraphs ({r.paragraphFixes.length})
                </h4>
                {r.paragraphFixes.map((f) => {
                  const on = applied.has(f.paragraphIndex);
                  return (
                    <div
                      key={f.paragraphIndex}
                      className={`rounded-lg border p-3 ${on ? "" : "opacity-60"}`}
                    >
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <span className="grid size-6 place-items-center rounded bg-secondary text-xs font-semibold">
                          {f.paragraphIndex + 1}
                        </span>
                        {f.changes.map((c, i) => (
                          <Badge key={i} variant="outline" className="text-xs">
                            {c.kind}: {c.from} <ArrowRight className="mx-0.5 inline size-3" /> {c.to}
                            {c.sourceUrl && (
                              <a
                                href={c.sourceUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="ml-1 text-primary"
                                title="Verify against source"
                              >
                                <ExternalLink className="inline size-3" />
                              </a>
                            )}
                          </Badge>
                        ))}
                        <label className="ml-auto flex cursor-pointer items-center gap-1.5 text-xs">
                          <input
                            type="checkbox"
                            checked={on}
                            onChange={() => toggle(f.paragraphIndex)}
                            className="size-4 rounded border-input accent-[hsl(var(--primary))]"
                          />
                          Apply
                        </label>
                      </div>

                      {/* Why each change was made */}
                      {f.changes.some((c) => c.analysis) && (
                        <ul className="mb-2 space-y-1">
                          {f.changes.map(
                            (c, i) =>
                              c.analysis && (
                                <li key={i} className="text-xs leading-relaxed text-muted-foreground">
                                  <span className="font-medium uppercase">{c.kind}</span> — {c.analysis}
                                </li>
                              ),
                          )}
                        </ul>
                      )}

                      <p className="rounded bg-destructive/10 p-2 text-sm text-muted-foreground line-through decoration-destructive/50">
                        {f.original}
                      </p>
                      <p className="mt-1 rounded bg-success/10 p-2 text-sm">{f.corrected}</p>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Link fixes */}
            {r.linkActions.length > 0 && (
              <div className="space-y-2">
                <Separator />
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold">Link fixes ({r.linkActions.length})</h4>
                  {autoLinks.length > 0 && (
                    <label className="flex cursor-pointer items-center gap-1.5 text-xs">
                      <input
                        type="checkbox"
                        checked={applyLinks}
                        onChange={(e) => setApplyLinks(e.target.checked)}
                        className="size-4 rounded border-input accent-[hsl(var(--primary))]"
                      />
                      Apply {autoLinks.length} automatic link fix{autoLinks.length === 1 ? "" : "es"}
                    </label>
                  )}
                </div>
                {r.linkActions.map((l, i) => (
                  <div key={i} className="rounded-lg border p-3">
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      <Badge variant={l.status === "fail" ? "destructive" : "warning"}>{l.status}</Badge>
                      {l.autoApplicable ? (
                        <Badge variant="secondary" className="text-xs">auto-applicable</Badge>
                      ) : (
                        <Badge variant="outline" className="text-xs">needs a human</Badge>
                      )}
                    </div>
                    <p className="text-sm">{l.action}</p>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{l.analysis}</p>
                    <div className="mt-1.5 space-y-0.5 text-xs">
                      <div className="break-all">
                        <span className="text-muted-foreground">Current: </span>
                        <code className="rounded bg-secondary px-1">{l.url}</code>
                      </div>
                      {l.replacementUrl && (
                        <div className="break-all">
                          <span className="text-muted-foreground">Corrected: </span>
                          <code className="rounded bg-success/15 px-1">{l.replacementUrl}</code>
                          <a
                            href={l.replacementUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="ml-1 text-primary"
                          >
                            <ExternalLink className="inline size-3" />
                          </a>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Rating / reviews */}
            {r.ratingActions.length > 0 && (
              <div className="space-y-2">
                <Separator />
                <h4 className="text-sm font-semibold">Rating / reviews</h4>
                {r.ratingActions.map((a, i) => (
                  <div key={i} className="rounded-lg border p-3">
                    <p className="text-sm">
                      {a.issue}
                      {a.sourceUrl && (
                        <a
                          href={a.sourceUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="ml-1 text-primary hover:underline"
                        >
                          <ExternalLink className="inline size-3" /> live profile
                        </a>
                      )}
                    </p>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{a.analysis}</p>
                  </div>
                ))}
              </div>
            )}

            {/* Needs confirmation */}
            {r.needsConfirmation.length > 0 && (
              <div className="space-y-2">
                <Separator />
                <h4 className="text-sm font-semibold">
                  Needs developer confirmation ({r.needsConfirmation.length})
                </h4>
                <p className="text-xs text-muted-foreground">
                  No safe auto-fix — the correct value isn’t known, so these are left for a human to
                  confirm against the dealership’s live site.
                </p>
                {r.needsConfirmation.map((n, i) => (
                  <div key={i} className="rounded-lg border p-3">
                    <div className="flex items-start gap-2 text-sm">
                      <Badge variant="warning" className="shrink-0">{n.location}</Badge>
                      <span>{n.issue}</span>
                      {n.verifyUrl && (
                        <a
                          href={n.verifyUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="shrink-0 text-primary hover:underline"
                        >
                          <ExternalLink className="inline size-3" />
                        </a>
                      )}
                    </div>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{n.analysis}</p>
                  </div>
                ))}
              </div>
            )}

            {/* Applied output — the corrected page, ready to publish */}
            <div className="space-y-2">
              <Separator />
              <div className="flex flex-wrap items-center gap-2">
                <h4 className="text-sm font-semibold">
                  <FileText className="mr-1 inline size-4" />
                  Corrected content ({appliedCount} fix{appliedCount === 1 ? "" : "es"} applied)
                </h4>
                <div className="ml-auto flex gap-2">
                  <Button size="sm" variant="outline" onClick={copyDoc}>
                    {copiedDoc ? <Check className="text-success" /> : <Copy />}
                    {copiedDoc ? "Copied" : "Copy corrected page"}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => saveAs(correctedDoc, `corrected-${auditId.slice(-6)}.txt`, "text/plain")}
                  >
                    <Download /> Download
                  </Button>
                </div>
              </div>
              {applyLinks && autoLinks.length > 0 && (
                <div className="rounded-lg border bg-secondary/30 p-3 text-xs">
                  <p className="mb-1 font-medium">Link replacements to apply:</p>
                  {autoLinks.map((l, i) => (
                    <div key={i} className="break-all text-muted-foreground">
                      <code>{l.url}</code> <ArrowRight className="inline size-3" />{" "}
                      <code className="text-foreground">{l.replacementUrl}</code>
                    </div>
                  ))}
                </div>
              )}
              <textarea
                readOnly
                value={correctedDoc}
                className="h-64 w-full rounded-lg border bg-background p-3 font-mono text-xs leading-relaxed"
              />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
