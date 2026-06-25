"use client";

// Auto-Fix & Developer Handoff — generates corrected revisions for an audit's
// errors and lets the reviewer send them straight to the developer (email,
// copy, or download a Markdown revision sheet).

import { useState } from "react";
import {
  Wand2, Loader2, Copy, Download, Mail, Check, ArrowRight, ExternalLink,
} from "lucide-react";
import {
  Button, Card, CardContent, CardHeader, CardTitle, Badge, Separator, Input,
} from "@/components/ui/primitives";
import type { AutoFixResult } from "@/lib/audit/autofix";

interface FixResponse {
  result: AutoFixResult;
  markdown: string;
  title: string;
}

export function AutoFixPanel({ auditId }: { auditId: string }) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<FixResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [copied, setCopied] = useState(false);

  async function generate() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/audit/${auditId}/fix`, { method: "POST" });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      setData(await res.json());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  function copy() {
    if (!data) return;
    navigator.clipboard.writeText(data.markdown);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function download() {
    if (!data) return;
    const blob = new Blob([data.markdown], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `revisions-${auditId.slice(-6)}.md`;
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
            {r.counts.changes} fixes · {r.counts.manual} to confirm
          </Badge>
        )}
      </CardHeader>
      <CardContent>
        {!r && (
          <div className="flex flex-col items-start gap-3">
            <p className="text-sm text-muted-foreground">
              Automatically generate corrected revisions for every detected error — wrong MPG
              figures swapped for the EPA value, spelling fixed, unsupported superlatives
              neutralized — then send the corrections straight to the developer.
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
                {copied ? <Check className="text-success" /> : <Copy />} {copied ? "Copied" : "Copy"}
              </Button>
              <Button size="sm" variant="outline" onClick={download}><Download /> Download .md</Button>
              <span className="ml-auto text-xs text-muted-foreground">by {r.generatedBy}</span>
            </div>

            {/* Paragraph corrections */}
            {r.paragraphFixes.length > 0 && (
              <div className="space-y-3">
                <h4 className="text-sm font-semibold">Corrected paragraphs ({r.paragraphFixes.length})</h4>
                {r.paragraphFixes.map((f) => (
                  <div key={f.paragraphIndex} className="rounded-lg border p-3">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <span className="grid size-6 place-items-center rounded bg-secondary text-xs font-semibold">
                        {f.paragraphIndex + 1}
                      </span>
                      {f.changes.map((c, i) => (
                        <Badge key={i} variant="outline" className="text-xs">
                          {c.kind}: {c.from} <ArrowRight className="mx-0.5 inline size-3" /> {c.to}
                          {c.sourceUrl && (
                            <a href={c.sourceUrl} target="_blank" rel="noreferrer" className="ml-1 text-primary" title="Source on dealership site">
                              <ExternalLink className="inline size-3" />
                            </a>
                          )}
                        </Badge>
                      ))}
                    </div>
                    <p className="rounded bg-destructive/10 p-2 text-sm text-muted-foreground line-through decoration-destructive/50">
                      {f.original}
                    </p>
                    <p className="mt-1 rounded bg-success/10 p-2 text-sm">{f.corrected}</p>
                  </div>
                ))}
              </div>
            )}

            {/* Link & rating actions */}
            {(r.linkActions.length > 0 || r.ratingActions.length > 0) && (
              <div className="space-y-2">
                <Separator />
                <h4 className="text-sm font-semibold">Other fixes</h4>
                {r.linkActions.map((l, i) => (
                  <div key={i} className="text-sm">
                    <span className="text-muted-foreground">{l.action}</span>{" "}
                    <code className="rounded bg-secondary px-1 text-xs">{l.url}</code>
                  </div>
                ))}
                {r.ratingActions.map((a, i) => (
                  <div key={i} className="text-sm text-muted-foreground">{a}</div>
                ))}
              </div>
            )}

            {/* Needs confirmation */}
            {r.needsConfirmation.length > 0 && (
              <div className="space-y-2">
                <Separator />
                <h4 className="text-sm font-semibold">Needs developer confirmation ({r.needsConfirmation.length})</h4>
                <p className="text-xs text-muted-foreground">
                  No safe auto-fix (the correct value isn’t known) — the developer should confirm these against the dealership’s live site.
                </p>
                {r.needsConfirmation.map((n, i) => (
                  <div key={i} className="flex items-start gap-2 text-sm">
                    <Badge variant="warning" className="shrink-0">{n.location}</Badge>
                    <span className="text-muted-foreground">{n.issue}</span>
                    {n.verifyUrl && (
                      <a href={n.verifyUrl} target="_blank" rel="noreferrer" className="shrink-0 text-primary hover:underline">
                        <ExternalLink className="inline size-3" />
                      </a>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
