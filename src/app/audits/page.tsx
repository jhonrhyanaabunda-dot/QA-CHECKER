import Link from "next/link";
import { listAudits } from "@/lib/db/store";
import { Card, CardContent, Badge, Button } from "@/components/ui/primitives";
import { formatDate, scoreColor } from "@/lib/utils";
import { ScanSearch } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function HistoryPage() {
  const rows = await listAudits();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Audit History</h1>
          <p className="text-muted-foreground">{rows.length} audit{rows.length === 1 ? "" : "s"} on record.</p>
        </div>
        <Link href="/">
          <Button><ScanSearch /> New Audit</Button>
        </Link>
      </div>

      {rows.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <p className="text-muted-foreground">No audits yet.</p>
            <Link href="/" className="mt-3 inline-block">
              <Button>Run your first audit</Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="divide-y">
              {rows.map((r) => (
                <Link
                  key={r.id}
                  href={`/audits/${r.id}`}
                  className="flex items-center gap-4 p-4 hover:bg-accent"
                >
                  <div className="grid size-12 shrink-0 place-items-center rounded-lg border text-lg font-bold tabular-nums">
                    <span className={
                      scoreColor(r.overall) === "success" ? "text-success"
                      : scoreColor(r.overall) === "warning" ? "text-warning dark:text-warning"
                      : "text-destructive"
                    }>
                      {Math.round(r.overall)}
                    </span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{r.title}</p>
                    <p className="truncate text-sm text-muted-foreground">{r.url}</p>
                    <p className="text-xs text-muted-foreground">{formatDate(r.createdAt)} · {r.reviewer}</p>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                    {r.fail > 0 && <Badge variant="destructive">{r.fail} fail</Badge>}
                    {r.warning > 0 && <Badge variant="warning">{r.warning} warn</Badge>}
                    {r.approved && <Badge variant="success">Approved</Badge>}
                  </div>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
