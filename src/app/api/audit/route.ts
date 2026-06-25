// POST /api/audit — start an audit and stream progress as Server-Sent Events.
// Each event is `data: {ProgressEvent|{type:"complete",audit}}\n\n`. The final
// event carries the persisted audit so the client can navigate to the report.

import { NextRequest } from "next/server";
import { runAudit } from "@/lib/audit/pipeline";
import { saveAudit } from "@/lib/db/store";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const url: string = (body.url || "").trim();
  const reviewer: string = (body.reviewer || "Unassigned").trim();
  const screenshot: boolean = Boolean(body.screenshot);

  if (!url) {
    return new Response(JSON.stringify({ error: "Missing url" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));

      try {
        const gen = runAudit(url, { reviewer, screenshot });
        let result = await gen.next();
        while (!result.done) {
          send(result.value);
          result = await gen.next();
        }
        const audit = result.value;
        await saveAudit(audit);
        send({ type: "complete", auditId: audit.id });
      } catch (err) {
        send({ type: "error", error: (err as Error).message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
