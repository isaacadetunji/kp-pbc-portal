import type { Metadata } from "next";
import Link from "next/link";
import { Briefcase, Plus, Search } from "lucide-react";
import { EngagementNavList } from "@/components/engagement/engagement-nav";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { requireStaff } from "@/lib/auth";
import { ENGAGEMENT_STATUS, isAdminRole } from "@/lib/constants";
import { groupByClient, loadEngagementNav } from "@/lib/engagement-data";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Engagements" };

export default async function EngagementsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; scope?: string }>;
}) {
  const { supabase, profile } = await requireStaff();
  const { q = "", status = "", scope: scopeParam } = await searchParams;
  const isAdmin = isAdminRole(profile.app_role);
  // Staff only ever see their own engagements (RLS). Admins can switch to all.
  const scope = isAdmin && scopeParam === "all" ? "all" : "mine";

  const rows = await loadEngagementNav(supabase, { userId: profile.id, scope, includeArchived: status === "archived" });
  const needle = q.trim().toLowerCase();
  const filtered = rows.filter(
    (r) =>
      (!status || !(status in ENGAGEMENT_STATUS) || r.status === status) &&
      (!needle || `${r.code} ${r.name} ${r.client_name} ${r.type_name} FY${r.period_end.slice(0, 4)}`.toLowerCase().includes(needle)),
  );
  const groups = groupByClient(filtered);
  const qs = (patch: Record<string, string>) => {
    const p = new URLSearchParams({ ...(q ? { q } : {}), ...(status ? { status } : {}), ...(scope === "all" ? { scope } : {}), ...patch });
    [...p.entries()].forEach(([k, v]) => !v && p.delete(k));
    return `/engagements${p.size ? `?${p}` : ""}`;
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Engagements"
        description={scope === "all" ? "Every engagement in the firm, grouped by client (administrator view)." : "Engagements you are assigned to, grouped by client."}
        actions={
          <Button asChild>
            <Link href="/engagements/new"><Plus /> New engagement</Link>
          </Button>
        }
      />
      {isAdmin ? (
        <div className="inline-flex rounded-lg bg-muted p-1 text-sm" role="group" aria-label="Which engagements">
          {(["mine", "all"] as const).map((s) => (
            <Link
              key={s}
              href={qs({ scope: s === "all" ? "all" : "" })}
              aria-current={scope === s ? "page" : undefined}
              className={cn("rounded-md px-3 py-1.5 font-medium", scope === s ? "bg-card shadow-sm" : "text-muted-foreground hover:text-foreground")}
            >
              {s === "mine" ? "My engagements" : "All engagements"}
            </Link>
          ))}
        </div>
      ) : null}
      <form className="flex flex-col gap-2 sm:flex-row" role="search">
        {scope === "all" ? <input type="hidden" name="scope" value="all" /> : null}
        <div className="relative flex-1">
          <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input name="q" defaultValue={q} placeholder="Search client, code, year or type" className="pl-9" aria-label="Search engagements" />
        </div>
        <select name="status" defaultValue={status} className="h-9 rounded-md border border-input bg-card px-3 text-sm" aria-label="Status">
          <option value="">All active</option>
          {Object.entries(ENGAGEMENT_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <Button type="submit" variant="outline">Filter</Button>
      </form>

      {rows.length === 0 && scope === "mine" ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <span className="grid size-12 place-items-center rounded-full bg-accent text-primary"><Briefcase className="size-6" /></span>
            <p className="max-w-sm text-sm text-muted-foreground">You haven&apos;t been added to an engagement yet. An administrator will assign you.</p>
            {isAdmin ? <Link href={qs({ scope: "all" })} className="text-sm text-primary hover:underline">Show all engagements</Link> : null}
          </CardContent>
        </Card>
      ) : groups.length === 0 ? (
        <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">No engagements match these filters.</CardContent></Card>
      ) : (
        <Card className="max-w-3xl">
          <CardContent className="py-3">
            <EngagementNavList groups={groups} hrefBase="/engagements" showHeader={false} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
