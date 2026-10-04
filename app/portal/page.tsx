import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { EngagementNavList } from "@/components/engagement/engagement-nav";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { requireClient } from "@/lib/auth";
import { groupByClient, isReleased, loadEngagementNav, type NavEngagement } from "@/lib/engagement-data";

export const metadata: Metadata = { title: "My requests" };

export default async function PortalHome() {
  const { supabase, profile } = await requireClient();
  const [rows, { data: groupRows }] = await Promise.all([
    loadEngagementNav(supabase, { userId: profile.id, scope: "all" }),
    supabase.from("client_groups").select("id, name"),
  ]);
  if (rows.length === 1) redirect(`/portal/${rows[0]!.id}`);
  const groupNames = new Map(((groupRows as { id: string; name: string }[]) ?? []).map((g) => [g.id, g.name]));
  const byGroup = new Map<string, NavEngagement[]>();
  rows.forEach((r) => {
    const k = r.group_id ?? "__none";
    byGroup.set(k, [...(byGroup.get(k) ?? []), r]);
  });
  const sections = [...byGroup.entries()]
    .sort(([a], [b]) => (a === "__none" ? 1 : b === "__none" ? -1 : 0))
    .map(([k, rs]) => ({ key: k, group: k === "__none" ? null : groupNames.get(k) ?? "Group", rows: rs }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Welcome{profile.full_name ? `, ${profile.full_name.split(" ")[0]}` : ""}</h1>
        <p className="text-sm text-muted-foreground">Choose a company and engagement to see what the team needs from you.</p>
      </div>
      {rows.length === 0 ? (
        <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">There are no open information requests for you right now. We&apos;ll email you when there are.</CardContent></Card>
      ) : (
        sections.map((sec) => {
          const live = sec.rows.filter((r) => isReleased(r.status));
          const acc = live.reduce((a, p) => a + p.accepted, 0);
          const app = live.reduce((a, p) => a + p.applicable, 0);
          const todo = live.reduce((a, p) => a + p.open_items, 0);
          const overdue = live.reduce((a, p) => a + p.overdue, 0);
          const entities = new Set(sec.rows.map((r) => r.client_id)).size;
          const preparing = sec.rows.length - live.length;
          return (
            <section key={sec.key} className="space-y-3" aria-label={sec.group ?? "Other companies"}>
              {sec.group ? (
                <Card className="border-brand-accent/50">
                  <CardContent className="grid gap-3 py-4 sm:grid-cols-[1fr_auto] sm:items-center">
                    <div className="space-y-1.5">
                      <div className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Group summary · {entities} entit{entities === 1 ? "y" : "ies"}</div>
                      <div className="text-lg font-semibold">{sec.group}</div>
                      <Progress value={app ? (acc / app) * 100 : 0} tone="success" label="Group progress" />
                      <div className="text-xs text-muted-foreground">
                        {acc} of {app} items complete across all entities{preparing ? ` · ${preparing} engagement${preparing === 1 ? "" : "s"} being prepared` : ""}
                      </div>
                    </div>
                    <div className="flex gap-4 text-center">
                      <div><div className="text-2xl font-semibold tabular">{todo}</div><div className="text-xs text-muted-foreground">to provide</div></div>
                      <div><div className={`text-2xl font-semibold tabular ${overdue ? "text-destructive" : ""}`}>{overdue}</div><div className="text-xs text-muted-foreground">overdue</div></div>
                    </div>
                  </CardContent>
                </Card>
              ) : sections.length > 1 ? (
                <h2 className="text-sm font-semibold text-muted-foreground">Other companies</h2>
              ) : null}
              <Card>
                <CardContent className="py-3">
                  <EngagementNavList groups={groupByClient(sec.rows)} hrefBase="/portal" audience="client" showHeader={false} />
                </CardContent>
              </Card>
            </section>
          );
        })
      )}
    </div>
  );
}
