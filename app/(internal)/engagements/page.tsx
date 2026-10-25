import type { Metadata } from "next";
import Link from "next/link";
import { Briefcase, Plus, Search } from "lucide-react";
import { EngagementNavList } from "@/components/engagement/engagement-nav";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { getPermissions, getStageLabels, requireStaff } from "@/lib/auth";
import { groupByClient, loadEngagementNav } from "@/lib/engagement-data";
import { STAGE_KEYS, statusesForStage, type StageKey } from "@/lib/stages";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Engagements" };

export default async function EngagementsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; scope?: string }>;
}) {
  const { supabase, profile } = await requireStaff();
  const { q = "", status: statusParam = "", scope: scopeParam } = await searchParams;
  const [perms, labels] = await Promise.all([getPermissions(), getStageLabels()]);
  // RLS only returns engagements the user is on, created, or may all see.
  // People who may see every engagement can switch between theirs and all.
  const canSeeAll = perms.view_all_engagements;
  const scope = canSeeAll && scopeParam === "all" ? "all" : "mine";
  const stage = (STAGE_KEYS as string[]).includes(statusParam) ? (statusParam as StageKey) : null;

  const rows = await loadEngagementNav(supabase, { userId: profile.id, scope, includeArchived: stage === "archived" });
  const needle = q.trim().toLowerCase();
  const wanted = stage ? new Set<string>(statusesForStage(stage)) : null;
  const filtered = rows.filter(
    (r) =>
      (!wanted || wanted.has(r.status)) &&
      (!needle || `${r.code} ${r.name} ${r.client_name} ${r.type_name} FY${r.period_end.slice(0, 4)}`.toLowerCase().includes(needle)),
  );
  const groups = groupByClient(filtered);
  const qs = (patch: Record<string, string>) => {
    const p = new URLSearchParams({ ...(q ? { q } : {}), ...(stage ? { status: stage } : {}), ...(scope === "all" ? { scope } : {}), ...patch });
    [...p.entries()].forEach(([k, v]) => !v && p.delete(k));
    return `/engagements${p.size ? `?${p}` : ""}`;
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Engagements"
        description={scope === "all" ? "Every engagement in the firm, grouped by client." : "Engagements you are on or created, grouped by client."}
        actions={
          perms.create_engagements ? (
            <Button asChild>
              <Link href="/engagements/new"><Plus /> New engagement</Link>
            </Button>
          ) : null
        }
      />
      {canSeeAll ? (
        <div className="inline-flex rounded-lg border bg-muted/70 p-[3px] text-sm" role="group" aria-label="Which engagements">
          {(["mine", "all"] as const).map((s) => (
            <Link
              key={s}
              href={qs({ scope: s === "all" ? "all" : "" })}
              aria-current={scope === s ? "page" : undefined}
              className={cn("rounded-md px-3 py-1.5 font-medium transition-colors", scope === s ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
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
        <select name="status" defaultValue={stage ?? ""} className="h-9 rounded-md border border-input bg-card px-3 text-sm shadow-xs hover:border-border-strong focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none" aria-label="Stage">
          <option value="">All active stages</option>
          {STAGE_KEYS.map((k) => <option key={k} value={k}>{labels[k]}</option>)}
        </select>
        <Button type="submit" variant="outline">Filter</Button>
      </form>

      {rows.length === 0 && scope === "mine" && !stage ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <span className="grid size-12 place-items-center rounded-full bg-accent text-primary"><Briefcase className="size-6" /></span>
            <p className="max-w-sm text-sm text-muted-foreground">You haven&apos;t been added to an engagement yet. A partner, team lead or manager will add you to the team.</p>
            {canSeeAll ? <Link href={qs({ scope: "all" })} className="text-sm text-primary hover:underline">Show all engagements</Link> : null}
          </CardContent>
        </Card>
      ) : groups.length === 0 ? (
        <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">No engagements match these filters.</CardContent></Card>
      ) : (
        <Card>
          <CardContent className="px-3 py-3 sm:px-4">
            <EngagementNavList groups={groups} hrefBase="/engagements" showHeader={false} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
