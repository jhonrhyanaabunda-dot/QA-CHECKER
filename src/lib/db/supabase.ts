// ───────────────────────────────────────────────────────────────────────────
// Supabase adapter (optional). Activated when NEXT_PUBLIC_SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY are set. Uses the Supabase REST endpoint directly
// (no SDK dependency) so the app stays lightweight. Apply ./schema.sql to your
// project first. The whole `audit` JSON is stored in a `data` jsonb column,
// with a few promoted columns for cheap list/dashboard queries.
// ───────────────────────────────────────────────────────────────────────────

import type { Audit, AuditSummaryRow, ReviewChecklist } from "../audit/types";

export function isSupabaseEnabled(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.SUPABASE_SERVICE_ROLE_KEY,
  );
}

function base() {
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1`;
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
