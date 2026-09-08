// POST /api/audit/[id]/fix — generate corrected revisions (auto-fix) for an
// audit's errors and return a developer-ready result + Markdown handoff.

import { NextRequest } from "next/server";
import { getAudit } from "@/lib/db/store";
import { generateAutoFix, fixesToMarkdown } from "@/lib/audit/autofix";

export const runtime = "nodejs";
// Within the Vercel Hobby 60s ceiling (raise on Pro if needed).
export const maxDuration = 60;

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const audit = await getAudit(id);
  if (!audit) return Response.json({ error: "Not found" }, { status: 404 });

  const result = await generateAutoFix(audit);
  const markdown = fixesToMarkdown(audit, result);
  // Every paragraph, so the panel can rebuild the corrected page as the
  // reviewer toggles individual fixes on and off.
  const allParagraphs = audit.paragraphs.map((p) => p.content);
  return Response.json({ result, markdown, title: audit.title, allParagraphs });
}
