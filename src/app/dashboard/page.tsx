import Link from "next/link";
import { dashboardStats } from "@/lib/db/store";
import { Stat, Card, CardContent, CardHeader, CardTitle, Badge } from "@/components/ui/primitives";
import { formatDate, scoreColor } from "@/lib/utils";
import { Users, ShieldCheck } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const s = await dashboardStats();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Admin Dashboard</h1>
        <p className="text-muted-foreground">QA throughput, quality, and reviewer performance.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Total audits" value={s.total} accent="primary" />
        <Stat label="Failed audits" value={s.failed} hint="had ≥1 failing check" accent={s.failed ? "destructive" : "success"} />
        <Stat label="Average QA score" value={`${s.avgScore}`} hint="across all audits" accent={scoreColor(s.avgScore)} />
        <Stat label="Approved" value={s.approved} hint="signed off for publishing" accent="success" />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-center gap-2 space-y-0">
            <Users className="size-5 text-primary" />
            <CardTitle className="text-base">Reviewer Performance</CardTitle>
          </CardHeader>
          <CardContent>
            {s.reviewers.length ? (
              <div className="space-y-2">
                {s.reviewers.map((r) => (
                  <div key={r.name} className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm">
                    <span className="font-medium">{r.name}</span>
                    <div className="flex items-center gap-4 text-muted-foreground">
                      <span>{r.audits} audits</span>
                      <span>{r.approved} approved</span>
                      <Badge variant={scoreColor(r.avgScore) === "success" ? "success" : scoreColor(r.avgScore) === "warning" ? "warning" : "destructive"}>
                        avg {r.avgScore}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No audits yet.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center gap-2 space-y-0">
            <ShieldCheck className="size-5 text-primary" />
            <CardTitle className="text-base">Recent Audits</CardTitle>
          </CardHeader>
          <CardContent>
            {s.recent.length ? (
              <div className="space-y-2">
                {s.recent.map((r) => (
                  <Link
                    key={r.id}
                    href={`/audits/${r.id}`}
                    className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm hover:bg-accent"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium">{r.title}</p>
                      <p className="text-xs text-muted-foreground">{formatDate(r.createdAt)} · {r.reviewer}</p>
                    </div>
                    <Badge variant={scoreColor(r.overall) === "success" ? "success" : scoreColor(r.overall) === "warning" ? "warning" : "destructive"}>
                      {Math.round(r.overall)}
                    </Badge>
                  </Link>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No audits yet — run your first from the New Audit tab.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
