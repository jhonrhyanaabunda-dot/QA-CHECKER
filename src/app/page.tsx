"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { ScanSearch, Sparkles, Loader2, AlertCircle, CheckCircle2 } from "lucide-react";
import { Button, Card, CardContent, Input, Progress, Checkbox } from "@/components/ui/primitives";
import { useReviewer } from "@/components/reviewer";
import type { ProgressEvent } from "@/lib/audit/types";

const FEATURES = [
  "Paragraph-by-paragraph factual audit",
  "MPG & specs verified vs EPA / NHTSA",
  "Live link checking (404s & redirects)",
  "Compliance & superlative-claim flags",
  "Grammar, AI-tone & readability QA",
  "Google rating cross-check & scoring",
];

// A bundled, offline-friendly dealership post so the demo always works. Swap in
// any real Vercel preview URL (e.g. https://dt-july-toyota-prius-leasing-deals.vercel.app/).
const EXAMPLE =
  typeof window !== "undefined"
    ? `${window.location.origin}/sample-dealership-post.html`
    : "/sample-dealership-post.html";

export default function NewAuditPage() {
  const router = useRouter();
  const { reviewer } = useReviewer();
  const [url, setUrl] = useState("");
  const [screenshot, setScreenshot] = useState(false);
  const [running, setRunning] = useState(false);
  const [events, setEvents] = useState<ProgressEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  const current = events[events.length - 1];

  async function start() {
    if (!url.trim() || running) return;
    setRunning(true);
    setError(null);
    setEvents([]);

    try {
      const res = await fetch("/api/audit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url, reviewer, screenshot }),
      });
      if (!res.body) throw new Error("No response stream");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() || "";
        for (const part of parts) {
          const line = part.replace(/^data:\s*/, "").trim();
          if (!line) continue;
          const msg = JSON.parse(line);
          if (msg.type === "error") {
            setError(msg.error);
            setRunning(false);
            return;
          }
          if (msg.type === "complete") {
            router.push(`/audits/${msg.auditId}`);
            return;
          }
          setEvents((prev) => [...prev, msg as ProgressEvent]);
          requestAnimationFrame(() => logRef.current?.scrollTo({ top: 9e9 }));
        }
      }
    } catch (e) {
      setError((e as Error).message);
      setRunning(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-8 text-center">
        <div className="mb-3 inline-flex items-center gap-2 rounded-full border bg-card px-3 py-1 text-xs text-muted-foreground">
          <Sparkles className="size-3.5 text-primary" />
          AI-powered QA for dealership content
        </div>
        <h1 className="text-balance text-4xl font-bold tracking-tight">
          Audit any dealership page in seconds
        </h1>
        <p className="mx-auto mt-3 max-w-xl text-muted-foreground">
          Paste a page URL (e.g. a Vercel preview). DealerQA AI crawls the page and runs a full
          factual, compliance, link, and content audit — paragraph by paragraph.
        </p>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="relative flex-1">
              <ScanSearch className="pointer-events-none absolute left-3 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && start()}
                placeholder="https://your-dealership-page.vercel.app"
                className="pl-10"
                disabled={running}
              />
            </div>
            <Button size="lg" onClick={start} disabled={running || !url.trim()}>
              {running ? <Loader2 className="animate-spin" /> : <ScanSearch />}
              {running ? "Auditing…" : "Run Audit"}
            </Button>
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <button
              className="text-xs text-muted-foreground hover:text-foreground"
              onClick={() => setUrl(EXAMPLE)}
              disabled={running}
            >
              Try an example URL →
            </button>
            <Checkbox
              id="screenshot"
              checked={screenshot}
              onChange={setScreenshot}
              label="Capture full-page screenshot (needs Playwright)"
            />
          </div>

          {error && (
            <div className="mt-4 flex items-start gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {running && (
            <div className="mt-6">
              <div className="mb-2 flex items-center justify-between text-sm">
                <span className="font-medium">{current?.label || "Starting…"}</span>
                <span className="tabular-nums text-muted-foreground">{current?.progress ?? 0}%</span>
              </div>
              <Progress value={current?.progress ?? 0} />
              <div ref={logRef} className="mt-4 max-h-44 space-y-1 overflow-y-auto text-sm">
                {events.map((e, i) => (
                  <div key={i} className="flex items-center gap-2 text-muted-foreground">
                    <CheckCircle2 className="size-3.5 text-success" />
                    {e.label}
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="mt-6 grid gap-2 sm:grid-cols-2">
        {FEATURES.map((f) => (
          <div key={f} className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2.5 text-sm">
            <CheckCircle2 className="size-4 shrink-0 text-success" />
            {f}
          </div>
        ))}
      </div>
    </div>
  );
}
