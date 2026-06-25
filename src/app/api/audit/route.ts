// POST /api/audit — start an audit and stream progress as Server-Sent Events.
// Each event is `data: {ProgressEvent|{type:"complete",audit}}\n\n`. The final
// event carries the persisted audit so the client can navigate to the report.

import { NextRequest } from "next/server";
import { runAudit } from "@/lib/audit/pipeline";
import { saveAudit } from "@/lib/db/store";
import { isSupabaseEnabled } from "@/lib/db/supabase";

export const runtime = "nodejs";
// 60s is the Vercel Hobby plan ceiling; real dealer-page audits finish in a few
// seconds. Raise this on Vercel Pro (up to 300) if you audit very large pages.
export const maxDuration = 60;

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
        // On serverless (Vercel) the filesystem is read-only and /tmp is
        // per-instance, so audits would save but vanish on the next request
        // ("Audit not found"). Require Supabase there and say so clearly.
        const serverless = !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
        if (serverless && !isSupabaseEnabled()) {
          send({
            type: "error",
            error:
              "Storage isn't configured for this deployment. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in your Vercel project's Environment Variables, then redeploy. (Check /api/health to verify.)",
          });
          controller.close();
          return;
        }

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
