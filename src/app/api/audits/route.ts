// GET /api/audits — list audit summary rows (history + dashboard feed)

import { listAudits } from "@/lib/db/store";

export const runtime = "nodejs";

export async function GET() {
  const rows = await listAudits();
  return Response.json(rows);
}
