// GET /api/health — deployment diagnostics. Visit this on your live site to
// confirm whether Supabase persistence is active (the thing that makes audits
// survive on Vercel). No secrets are exposed — only booleans and the provider.

import { isSupabaseEnabled, supabasePing, supabaseHost } from "@/lib/db/supabase";
import { providerLabel, llmPing } from "@/lib/llm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  // The LLM probe spends real quota (the Gemini free tier allows 20 requests a
  // minute), so it is opt-in: a monitor or a refresh loop hitting this endpoint
  // must not drain the budget the audits need. Use /api/health?llm=1.
  const testLlm = new URL(req.url).searchParams.get("llm") === "1";
  const serverless = !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
  const supabase = isSupabaseEnabled();
  // Configured != working. Actually call the project so a paused or
  // mis-keyed database is visible here instead of surfacing as a bare
  // "fetch failed" when someone runs an audit.
  const ping = supabase ? await supabasePing() : null;
  // Same reasoning as the Supabase probe: "a provider is configured" says
  // nothing about whether calls to it actually succeed.
  const llm = testLlm ? await llmPing() : null;
  // JSON mode is what every real caller uses, so probe it separately.
  const llmJson = llm?.ok ? await llmPing({ json: true }) : null;
  return Response.json({
    ok: true,
    serverless,
    supabaseConfigured: supabase,
    // Which URL var was picked up (without revealing the value).
    supabaseUrlSource: process.env.SUPABASE_URL
      ? "SUPABASE_URL"
      : process.env.NEXT_PUBLIC_SUPABASE_URL
        ? "NEXT_PUBLIC_SUPABASE_URL"
        : "none",
    serviceKeyPresent: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    supabaseHost: supabaseHost(),
    supabaseReachable: ping ? ping.ok : undefined,
    supabaseStatus: ping?.status,
    supabaseError: ping?.ok ? undefined : ping?.error,
    supabaseHint: ping?.ok ? undefined : ping?.hint,
    persistence: supabase
      ? ping?.ok
        ? "supabase"
        : "supabase (CONFIGURED BUT UNREACHABLE)"
      : serverless
        ? "ephemeral-tmp (NOT durable)"
        : "local-file",
    llm: providerLabel(),
    llmReachable: llm ? llm.ok : undefined,
    llmError: llm && !llm.ok ? llm.error : undefined,
    llmNote: testLlm ? undefined : "add ?llm=1 to actually call the provider (spends quota)",
    llmJsonOk: llmJson ? llmJson.ok : undefined,
    llmJsonError: llmJson && !llmJson.ok ? llmJson.error : undefined,
    note: serverless && !supabase
      ? "Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Vercel, then REDEPLOY."
      : undefined,
  });
}
