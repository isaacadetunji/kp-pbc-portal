import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Briefcase, Clock, Hourglass, MessageSquareWarning, Plus } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { EngagementStatusBadge, ItemStatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { requireStaff } from "@/lib/auth";
import { fmtDate, lagosToday } from "@/lib/dates";
import type { EngagementProgress, EngagementStatus, ItemStatus } from "@/lib/types";
import { pct } from "@/lib/utils";

export const metadata: Metadata = { title: "Dashboard" };

type Eng = { id: string; code: string; name: string; status: EngagementStatus; clients: { name: string } | null };
type Item = { id: string; code: string; title: string; status: ItemStatus; due_date: string | null; engagement_id: string; last_submitted_at: string | null };

function Kpi({ label, value, icon: Icon, tone }: { label: string; value: number; icon: React.ComponentType<{ className?: string }>; tone: string }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-4 py-4">
        <span className={`grid size-10 place-items-center rounded-lg ${tone}`}><Icon className="size-5" /></span>
        <div>
          <div className="text-2xl font-semibold tabular">{value}</div>
          <div className="text-xs text-muted-foreground">{label}</div>
        </div>
      </CardContent>
    </Card>
  );
}

export default async function DashboardPage() {
  const { supabase, profile } = await requireStaff();
  const today = lagosToday();

  const [{ data: teamRows }, { data: prog }, { data: mine }] = await Promise.all([
    supabase.from("engagement_team").select("engagement_id").eq("user_id", profile.id),
    supabase.from("v_engagement_progress").select("*"),
    supabase
      .from("request_items")
      .select("id, code, title, status, due_date, engagement_id, last_submitted_at")
      .eq("assignee_id", profile.id)
      .in("status", ["submitted", "under_review", "requested", "queried"])
      .order("last_submitted_at", { ascending: true, nullsFirst: false })
      .limit(200),
  ]);
  const myIds = (teamRows ?? []).map((t) => t.engagement_id as string);
  const { data: engs } = myIds.length
    ? await supabase.from("engagements").select("id, code, name, status, clients(name)").in("id", myIds).not("status", "in", "(archived,completed)").order("updated_at", { ascending: false })
    : { data: [] };
  const progress = new Map(((prog as EngagementProgress[]) ?? []).map((p) => [p.engagement_id, p]));
  const engagements = (engs as unknown as Eng[]) ?? [];
  const engName = new Map(engagements.map((e) => [e.id, e.clients?.name ?? e.name]));
  const items = (mine as Item[]) ?? [];
  const toReview = items.filter((i) => i.status === "submitted" || i.status === "under_review");
  const overdue = items.filter((i) => (i.status === "requested" || i.status === "queried") && i.due_date && i.due_date < today);
  const queried = items.filter((i) => i.status === "queried");

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Good day, ${profile.full_name.split(" ")[0] || "there"}`}
        description="Your engagements and the items waiting on you."
        actions={<Button asChild><Link href="/engagements/new"><Plus /> New engagement</Link></Button>}
      />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Active engagements" value={engagements.length} icon={Briefcase} tone="bg-accent text-primary" />
        <Kpi label="Assigned to me, awaiting review" value={toReview.length} icon={Hourglass} tone="bg-info-soft text-info" />
        <Kpi label="My items overdue with client" value={overdue.length} icon={Clock} tone="bg-danger-soft text-destructive" />
        <Kpi label="My items queried" value={queried.length} icon={MessageSquareWarning} tone="bg-warning-soft text-warning" />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader><CardTitle>My engagements</CardTitle></CardHeader>
          <CardContent className="pt-3">
            {engagements.length === 0 ? (
              <p className="text-sm text-muted-foreground">You&apos;re not on any active engagement yet.</p>
            ) : (
              <ul className="divide-y">
                {engagements.map((e) => {
                  const p = progress.get(e.id);
                  return (
                    <li key={e.id}>
                      <Link href={`/engagements/${e.id}`} className="grid gap-2 py-3 hover:text-primary sm:grid-cols-[minmax(0,1fr)_9rem_9rem] sm:items-center sm:gap-4">
                        <div className="min-w-0">
                          <div className="truncate font-medium">{e.clients?.name}</div>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">{e.code} <EngagementStatusBadge status={e.status} /></div>
                        </div>
                        <div className="space-y-1">
                          <div className="text-xs text-muted-foreground">Critical {p?.critical_total ? pct(p.pct_critical) : "—"}</div>
                          <Progress value={p?.pct_critical ?? 0} tone="accent" label="Critical" />
                        </div>
                        <div className="space-y-1">
                          <div className="text-xs text-muted-foreground">Provided {pct(p?.pct_provided ?? 0)}</div>
                          <Progress value={p?.pct_provided ?? 0} tone="success" label="Provided" />
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Awaiting my review</CardTitle></CardHeader>
          <CardContent className="pt-3">
            {toReview.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing waiting for you. Unassigned submissions go to the engagement lead.</p>
            ) : (
              <ul className="divide-y">
                {toReview.slice(0, 12).map((i) => (
                  <li key={i.id}>
                    <Link href={`/engagements/${i.engagement_id}?item=${i.id}`} className="flex items-center gap-3 py-2.5 hover:text-primary">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{i.code} · {i.title}</div>
                        <div className="text-xs text-muted-foreground">{engName.get(i.engagement_id) ?? ""} · submitted {fmtDate(i.last_submitted_at)}</div>
                      </div>
                      <ItemStatusBadge status={i.status} />
                      <ArrowRight className="size-4 text-muted-foreground" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
