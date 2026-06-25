// GET /api/export/[id]?format=csv|json — download an audit report.
// CSV opens directly in Excel; JSON is the full structured record.
// PDF export is done client-side via the print-optimized report view.

import { NextRequest } from "next/server";
import { getAudit } from "@/lib/db/store";
import { auditToCsv, auditToJson, exportFilename } from "@/lib/export";

export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const format = new URL(req.url).searchParams.get("format") || "csv";
  const audit = await getAudit(id);
  if (!audit) return Response.json({ error: "Not found" }, { status: 404 });

  if (format === "json") {
    return new Response(auditToJson(audit), {
      headers: {
        "content-type": "application/json",
        "content-disposition": `attachment; filename="${exportFilename(audit, "json")}"`,
      },
    });
  }

  return new Response(auditToCsv(audit), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${exportFilename(audit, "csv")}"`,
    },
  });
}
