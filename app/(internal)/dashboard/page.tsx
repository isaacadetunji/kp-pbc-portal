import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Briefcase, CheckCircle2, Clock, Hourglass, MessageSquareWarning, Plus } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { EngagementStatusBadge, ItemStatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { getPermissions, requireStaff } from "@/lib/auth";
import { fmtDate, lagosToday } from "@/lib/dates";
import type { EngagementProgress, EngagementStatus, ItemStatus } from "@/lib/types";
import { progressTextClass } from "@/lib/progress";
import { cn, pct } from "@/lib/utils";

export const metadata: Metadata = { title: "Dashboard" };

type Eng = { id: string; code: string; name: string; status: EngagementStatus; clients: { name: string } | null };
type Item = { id: string; code: string; title: string; status: ItemStatus; due_date: string | null; engagement_id: string; last_submitted_at: string | null };

function Kpi({ label, value, icon: Icon, tone }: { label: string; value: number; icon: React.ComponentType<{ className?: string }>; tone: string }) {
  return (
    <Card className="transition-shadow hover:shadow-md">
      <CardContent className="flex items-start justify-between gap-4 py-5">
        <div className="min-w-0 space-y-1">
          <div className="text-[13px] leading-5 font-medium text-muted-foreground">{label}</div>
          <div className="font-display text-3xl leading-9 font-bold tracking-[-0.02em] tabular">{value}</div>
        </div>
        <span className={`grid size-10 shrink-0 place-items-center rounded-xl ${tone}`}><Icon className="size-5" /></span>
      </CardContent>
    </Card>
  );
}

function Meter({ label, value, shown }: { label: string; value: number; shown: string }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className={cn("font-semibold tabular", shown === "—" ? "text-subtle-foreground" : progressTextClass(value))}>{shown}</span>
      </div>
      <Progress value={value} tone="auto" size="sm" label={label} />
    </div>
  );
}

export default async function DashboardPage() {
  const { supabase, profile } = await requireStaff();
  const today = lagosToday();

  const [{ data: teamRows }, { data: prog }, { data: mine }, perms] = await Promise.all([
    supabase.from("engagement_team").select("engagement_id").eq("user_id", profile.id),
    supabase.from("v_engagement_progress").select("*"),
    // Items assigned to me (request_item_assignees; RLS hides anything I may not see)
    supabase
      .from("request_items")
      .select("id, code, title, status, due_date, engagement_id, last_submitted_at, request_item_assignees!inner(user_id)")
      .eq("request_item_assignees.user_id", profile.id)
      .in("status", ["submitted", "under_review", "requested", "queried"])
      .order("last_submitted_at", { ascending: true, nullsFirst: false })
      .limit(200),
    getPermissions(),
  ]);
  const myIds = (teamRows ?? []).map((t) => t.engagement_id as string);
  const { data: engs } = myIds.length
    ? await supabase.from("engagements").select("id, code, name, status, clients(name)").in("id", myIds).not("status", "in", "(archived,completed)").order("updated_at", { ascending: false })
    : { data: [] };
  const progress = new Map(((prog as EngagementProgress[]) ?? []).map((p) => [p.engagement_id, p]));
  const engagements = (engs as unknown as Eng[]) ?? [];
  const engName = new Map(engagements.map((e) => [e.id, e.clients?.name ?? e.name]));
  const items = (mine as unknown as Item[]) ?? [];
  const toReview = items.filter((i) => i.status === "submitted" || i.status === "under_review");
  const overdue = items.filter((i) => (i.status === "requested" || i.status === "queried") && i.due_date && i.due_date < today);
  const queried = items.filter((i) => i.status === "queried");

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Good day, ${profile.full_name.split(" ")[0] || "there"}`}
        description="Your engagements and the items waiting on you."
        actions={perms.create_engagements ? <Button asChild><Link href="/engagements/new"><Plus /> New engagement</Link></Button> : null}
      />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Active engagements" value={engagements.length} icon={Briefcase} tone="bg-accent text-primary ring-1 ring-primary/10" />
        <Kpi label="Assigned to me, awaiting review" value={toReview.length} icon={Hourglass} tone="bg-review-soft text-review ring-1 ring-review/10" />
        <Kpi label="My items overdue with client" value={overdue.length} icon={Clock} tone="bg-danger-soft text-danger ring-1 ring-danger/10" />
        <Kpi label="My items queried" value={queried.length} icon={MessageSquareWarning} tone="bg-warning-soft text-warning ring-1 ring-warning/10" />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader className="flex-row items-center justify-between border-b pb-4">
            <CardTitle>My engagements</CardTitle>
            <Link href="/engagements" className="text-[13px] font-medium text-primary hover:underline">View all</Link>
          </CardHeader>
          <CardContent className="pt-1">
            {engagements.length === 0 ? (
              <p className="text-sm text-muted-foreground">You&apos;re not on any active engagement yet.</p>
            ) : (
              <ul className="divide-y">
                {engagements.map((e) => {
                  const p = progress.get(e.id);
                  return (
                    <li key={e.id}>
                      <Link href={`/engagements/${e.id}`} className="group -mx-2 grid gap-3 rounded-lg px-2 py-3.5 transition-colors hover:bg-accent/40 sm:grid-cols-[minmax(0,1fr)_9.5rem_9.5rem] sm:items-center sm:gap-6">
                        <div className="min-w-0">
                          <div className="truncate font-semibold text-foreground group-hover:text-primary">{e.clients?.name}</div>
                          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                            <span className="font-mono text-[11px]">{e.code}</span>
                            <EngagementStatusBadge status={e.status} />
                          </div>
                        </div>
                        <Meter label="Critical" value={p?.pct_critical ?? 0} shown={p?.critical_total ? pct(p.pct_critical) : "—"} />
                        <Meter label="Provided" value={p?.pct_provided ?? 0} shown={pct(p?.pct_provided ?? 0)} />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="border-b pb-4"><CardTitle>Awaiting my review</CardTitle></CardHeader>
          <CardContent className="pt-1">
            {toReview.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-8 text-center">
                <span className="grid size-10 place-items-center rounded-full bg-success-soft text-success"><CheckCircle2 className="size-5" /></span>
                <p className="max-w-xs text-sm text-muted-foreground">Nothing waiting for you. Unassigned submissions go to the team lead.</p>
              </div>
            ) : (
              <ul className="divide-y">
                {toReview.slice(0, 12).map((i) => (
                  <li key={i.id}>
                    <Link href={`/engagements/${i.engagement_id}?item=${i.id}`} className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-3 transition-colors hover:bg-accent/40 hover:text-primary">
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
