// ───────────────────────────────────────────────────────────────────────────
// Supabase adapter (optional). Activated when NEXT_PUBLIC_SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY are set. Uses the Supabase REST endpoint directly
// (no SDK dependency) so the app stays lightweight. Apply ./schema.sql to your
// project first. The whole `audit` JSON is stored in a `data` jsonb column,
// with a few promoted columns for cheap list/dashboard queries.
// ───────────────────────────────────────────────────────────────────────────

import type { Audit, AuditSummaryRow, ReviewChecklist } from "../audit/types";

// Read the project URL from SUPABASE_URL first (a plain server env var read at
// RUNTIME), falling back to NEXT_PUBLIC_SUPABASE_URL. The NEXT_PUBLIC_ value is
// inlined at BUILD time, so on its own it fails if the var was added after the
// build — SUPABASE_URL avoids that gotcha. Trailing slashes are stripped.
function supabaseUrl(): string {
  return (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "")
    .trim()
    .replace(/\/+$/, "");
}

export function isSupabaseEnabled(): boolean {
  return Boolean(supabaseUrl() && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

/** Project host, for diagnostics. Never the key. */
export function supabaseHost(): string | undefined {
  try {
    return new URL(supabaseUrl()).host;
  } catch {
    return undefined;
  }
}

/**
 * Live reachability check. Having the env vars set says nothing about whether
 * the project actually answers — a paused free-tier project keeps its vars and
 * fails every request with a bare "fetch failed". This separates the cases:
 *   network error -> project paused, deleted, or URL wrong
 *   401/403       -> service role key wrong
 *   404           -> schema.sql never applied (no `audits` table)
 */
export async function supabasePing(): Promise<{
  ok: boolean;
  status?: number;
  error?: string;
  hint?: string;
}> {
  if (!isSupabaseEnabled()) return { ok: false, error: "not configured" };
  try {
    const res = await fetch(`${base()}/audits?select=id&limit=1`, {
      headers: headers(),
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) return { ok: true, status: res.status };
    const body = await res.text().catch(() => "");
    return {
      status: res.status,
      ok: false,
      error: body.slice(0, 200) || `HTTP ${res.status}`,
      hint:
        res.status === 404
          ? "No `audits` table — apply src/lib/db/schema.sql in the Supabase SQL editor."
          : res.status === 401 || res.status === 403
            ? "SUPABASE_SERVICE_ROLE_KEY is wrong. Copy the service_role key (not anon) from Project Settings > API."
            : undefined,
    };
  } catch (e) {
    return {
      ok: false,
      error: (e as Error).message,
      hint:
        "Could not reach the project at all. A free-tier Supabase project auto-pauses after ~1 week idle; open the Supabase dashboard and Restore it. Otherwise check SUPABASE_URL is the Project URL (https://<ref>.supabase.co).",
    };
  }
}

function base() {
  return `${supabaseUrl()}/rest/v1`;
}

function headers(extra: Record<string, string> = {}) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return {
    apikey: key,
    authorization: `Bearer ${key}`,
    "content-type": "application/json",
    ...extra,
  };
}

function rowFromAudit(a: Audit) {
  return {
    id: a.id,
    url: a.url,
    title: a.title,
    status: a.status,
    created_at: a.createdAt,
    reviewer: a.reviewer,
    overall: a.score.overall,
    fail: a.summary.fail + a.links.filter((l) => l.status === "fail").length,
    warning: a.summary.warning,
    approved: a.review.approved,
    data: a,
  };
}

export async function supabaseSave(audit: Audit): Promise<void> {
  await fetch(`${base()}/audits`, {
    method: "POST",
    headers: headers({ prefer: "resolution=merge-duplicates" }),
    body: JSON.stringify(rowFromAudit(audit)),
  });
}

export async function supabaseGet(id: string): Promise<Audit | null> {
  const res = await fetch(`${base()}/audits?id=eq.${id}&select=data`, {
    headers: headers(),
  });
  if (!res.ok) return null;
  const rows = await res.json();
  return rows[0]?.data ?? null;
}

export async function supabaseList(): Promise<AuditSummaryRow[]> {
  const res = await fetch(
    `${base()}/audits?select=id,url,title,status,created_at,reviewer,overall,fail,warning,approved&order=created_at.desc`,
    { headers: headers() },
  );
  if (!res.ok) return [];
  const rows = await res.json();
  return rows.map((r: any) => ({
    id: r.id,
    url: r.url,
    title: r.title,
    status: r.status,
    createdAt: r.created_at,
    reviewer: r.reviewer,
    overall: r.overall,
    fail: r.fail,
    warning: r.warning,
    approved: r.approved,
  }));
}

export async function supabaseUpdateReview(
  id: string,
  review: ReviewChecklist,
): Promise<Audit | null> {
  const current = await supabaseGet(id);
  if (!current) return null;
  current.review = review;
  await fetch(`${base()}/audits?id=eq.${id}`, {
    method: "PATCH",
    headers: headers(),
    body: JSON.stringify({ approved: review.approved, data: current }),
  });
  return current;
}
