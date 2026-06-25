import { notFound } from "next/navigation";
import { getAudit } from "@/lib/db/store";
import { AuditReport } from "@/components/audit-report";

export const dynamic = "force-dynamic";

export default async function AuditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const audit = await getAudit(id);
  if (!audit) notFound();
  return <AuditReport audit={audit} />;
}
