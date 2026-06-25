// GET /api/health — deployment diagnostics. Visit this on your live site to
// confirm whether Supabase persistence is active (the thing that makes audits
// survive on Vercel). No secrets are exposed — only booleans and the provider.

import { isSupabaseEnabled } from "@/lib/db/supabase";
import { providerLabel } from "@/lib/llm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const serverless = !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
  const supabase = isSupabaseEnabled();
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
    persistence: supabase ? "supabase" : serverless ? "ephemeral-tmp (NOT durable)" : "local-file",
    llm: providerLabel(),
    note: serverless && !supabase
      ? "Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Vercel, then REDEPLOY."
      : undefined,
  });
}
