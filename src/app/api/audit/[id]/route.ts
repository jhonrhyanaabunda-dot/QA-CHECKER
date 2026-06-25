// GET    /api/audit/[id]  — fetch one full audit
// PATCH  /api/audit/[id]  — update the reviewer checklist

import { NextRequest } from "next/server";
import { getAudit, updateReview } from "@/lib/db/store";
import type { ReviewChecklist } from "@/lib/audit/types";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const audit = await getAudit(id);
  if (!audit) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  return Response.json(audit);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as Partial<ReviewChecklist>;
  const current = await getAudit(id);
  if (!current) return Response.json({ error: "Not found" }, { status: 404 });

  const review: ReviewChecklist = { ...current.review, ...body };
  const updated = await updateReview(id, review);
  return Response.json(updated);
}
