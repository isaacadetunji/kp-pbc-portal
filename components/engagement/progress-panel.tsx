import Link from "next/link";
import { AlertTriangle, CheckCircle2, Clock, Hourglass, ShieldAlert, TrendingDown } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress, ProgressLegend } from "@/components/ui/progress";
import { fmtDate } from "@/lib/dates";
import type { EngagementProgress, FolderProgress, RequestItem } from "@/lib/types";
import { progressBarClass, progressTextClass } from "@/lib/progress";
import { cn, pct } from "@/lib/utils";

/** KPI card. With a meter, the figure and bar follow the shared red / amber / green rule. */
function Stat({
  label, value, sub, meter, emphasis, icon: Icon,
}: {
  label: string; value: string; sub?: string; meter?: number; emphasis?: boolean; icon?: React.ComponentType<{ className?: string }>;
}) {
  return (
    <Card className={cn("relative overflow-hidden", emphasis && "border-primary/25 ring-1 ring-primary/10")}>
      {emphasis ? <span aria-hidden className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-brand-accent to-brand-blue" /> : null}
      <CardContent className="space-y-2.5 py-5">
        <div className="flex items-center justify-between gap-2">
          <div className="eyebrow">{label}</div>
          {Icon ? <Icon className="size-4 text-subtle-foreground" /> : null}
        </div>
        <div className={cn("font-display leading-none font-bold tracking-[-0.02em] tabular", emphasis ? "text-[40px]" : "text-[34px]", meter !== undefined && progressTextClass(meter))}>{value}</div>
        {meter !== undefined ? <Progress value={meter} tone="auto" label={label} /> : null}
        {sub ? <div className="text-xs text-muted-foreground">{sub}</div> : null}
      </CardContent>
    </Card>
  );
}

function ItemList({
  title, icon: Icon, items, empty, hrefFor, tone,
}: {
  title: string; icon: React.ComponentType<{ className?: string }>; items: RequestItem[]; empty: string; hrefFor: (i: RequestItem) => string; tone: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-0">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Icon className={cn("size-4", tone)} /> {title}
          <span className="ml-auto rounded-full border bg-muted/60 px-2 text-xs leading-5 font-semibold tabular">{items.length}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-3">
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{empty}</p>
        ) : (
          <ul className="divide-y">
            {items.slice(0, 8).map((i) => (
              <li key={i.id}>
                <Link href={hrefFor(i)} className="-mx-2 flex items-center gap-2.5 rounded-md px-2 py-2 text-sm transition-colors hover:bg-accent/40 hover:text-primary">
                  <span className="w-14 shrink-0 font-mono text-[11px] text-muted-foreground">{i.code}</span>
                  <span className="min-w-0 flex-1 truncate">{i.title}</span>
                  <span className="text-xs text-muted-foreground tabular">{fmtDate(i.due_date, "d MMM")}</span>
                </Link>
              </li>
            ))}
            {items.length > 8 ? <li className="pt-2 text-xs text-muted-foreground">+{items.length - 8} more</li> : null}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export function ProgressPanel({
  progress, folders, items, audience, hrefFor,
}: {
  progress: EngagementProgress | null;
  folders: FolderProgress[];
  items: RequestItem[];
  audience: "team" | "client";
  hrefFor: (i: RequestItem) => string;
}) {
  const p = progress;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos" }).format(new Date());
  const overdue = items.filter((i) => (i.status === "requested" || i.status === "queried") && i.due_date && i.due_date < today);
  const awaiting = items.filter((i) => i.status === "submitted" || i.status === "under_review");
  const queried = items.filter((i) => i.status === "queried");
  const criticalOpen = items.filter((i) =>
    i.is_critical && !i.is_waived && (audience === "client" ? i.status === "requested" || i.status === "queried" : i.status !== "accepted"));
  // Client view: the folders with the lowest completion that still need something from them
  const behind = folders
    .filter((f) => f.applicable_items > 0 && f.submitted_items < f.applicable_items)
    .sort((a, b) => a.pct_submitted - b.pct_submitted || (b.applicable_items - b.submitted_items) - (a.applicable_items - a.submitted_items))
    .slice(0, 3);

  return (
    <div className="space-y-6">
      {audience === "client" && behind.length ? (
        <Card className="border-warning/25 bg-warning-soft/50">
          <CardHeader className="pb-0">
            <CardTitle className="flex items-center gap-2 text-sm"><TrendingDown className="size-4 text-warning" /> Where you&apos;re behind</CardTitle>
          </CardHeader>
          <CardContent className="pt-3">
            <ul className="grid gap-3 md:grid-cols-3">
              {behind.map((f) => (
                <li key={f.folder_id} className="rounded-lg border bg-card p-3 shadow-xs">
                  <div className="truncate text-sm font-medium">{f.folder_name}</div>
                  <div className="mt-1 flex items-baseline justify-between text-xs text-muted-foreground">
                    <span>{f.applicable_items - f.submitted_items} still to provide{f.overdue_items ? ` · ${f.overdue_items} overdue` : ""}</span>
                    <span className={cn("font-semibold tabular", progressTextClass(f.pct_submitted))}>{pct(f.pct_submitted)}</span>
                  </div>
                  <Progress className="mt-2" value={f.pct_submitted} tone="auto" label={`${f.folder_name} provided`} />
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Critical items"
          value={p?.pct_critical === null || p?.pct_critical === undefined ? "None" : pct(p.pct_critical)}
          sub={p?.critical_total ? `${p.critical_satisfied} of ${p.critical_total} accepted or waived` : "No pre-engagement items"}
          meter={p?.pct_critical ?? undefined}
          icon={ShieldAlert}
          emphasis
        />
        <Stat
          label="Information provided"
          value={pct(p?.pct_provided ?? 0)}
          sub={`${p?.accepted_items ?? 0} of ${p?.applicable_items ?? 0} items accepted`}
          meter={p?.pct_provided ?? 0}
          icon={CheckCircle2}
        />
        <Stat
          label="Submitted"
          value={pct(p?.pct_submitted ?? 0)}
          sub={`${p?.submitted_items ?? 0} of ${p?.applicable_items ?? 0} items received`}
          meter={p?.pct_submitted ?? 0}
          icon={Hourglass}
        />
        <Stat
          label={audience === "client" ? "Needs your action" : "Outstanding"}
          value={String((p?.requested_items ?? 0) + (p?.queried_items ?? 0))}
          sub={`${p?.overdue_items ?? 0} overdue · ${p?.queried_items ?? 0} queried${p?.na_items ? ` · ${p.na_items} N/A` : ""}`}
          icon={AlertTriangle}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
        <Card>
          <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 border-b pb-4">
            <CardTitle>Completion by folder</CardTitle>
            <ProgressLegend />
          </CardHeader>
          <CardContent className="space-y-4 pt-4">
            {folders.length === 0 ? <p className="text-sm text-muted-foreground">No folders yet.</p> : null}
            {folders
              .filter((f) => f.total_items > 0)
              .sort((a, b) => a.sort_order - b.sort_order)
              .map((f) => (
                <div key={f.folder_id} className="grid grid-cols-1 items-center gap-x-3 gap-y-1 sm:grid-cols-[minmax(0,1fr)_auto]">
                  <div className="truncate text-sm font-medium">{f.folder_name}</div>
                  <div className="tabular text-xs text-muted-foreground">
                    {audience === "client"
                      ? `${f.accepted_items} of ${f.applicable_items} complete · ${f.applicable_items - f.submitted_items} to provide · `
                      : `${f.accepted_items}/${f.applicable_items} · `}
                    <span className={cn("font-semibold", progressTextClass(f.pct_provided))}>{pct(f.pct_provided)}</span>
                  </div>
                  <div className="relative col-span-full h-2 overflow-hidden rounded-full bg-[#e3e8ef]" role="img" aria-label={`${f.folder_name}: ${pct(f.pct_provided)} accepted, ${pct(f.pct_submitted)} submitted`}>
                    <div className="absolute inset-y-0 left-0 rounded-full bg-[repeating-linear-gradient(135deg,#b9c4d2_0_3px,#cfd7e2_3px_6px)]" style={{ width: `${f.pct_submitted}%` }} />
                    <div className={cn("absolute inset-y-0 left-0 rounded-full", progressBarClass(f.pct_provided), f.pct_provided > 0 && "min-w-1.5")} style={{ width: `${f.pct_provided}%` }} />
                  </div>
                </div>
              ))}
            <div className="flex flex-wrap gap-x-4 gap-y-1 border-t pt-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5"><span className="h-2 w-4 rounded-full bg-gradient-to-r from-danger-bar via-warning-bar to-success-bar" /> Accepted (colour shows how far along)</span>
              <span className="flex items-center gap-1.5"><span className="h-2 w-4 rounded-full bg-[repeating-linear-gradient(135deg,#b9c4d2_0_3px,#cfd7e2_3px_6px)]" /> Submitted, awaiting review</span>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          {criticalOpen.length ? (
            <ItemList title={audience === "client" ? "Critical: still to provide" : "Critical items outstanding"} icon={ShieldAlert} tone="text-danger" items={criticalOpen} empty="" hrefFor={hrefFor} />
          ) : null}
          <ItemList title="Overdue" icon={Clock} tone="text-danger" items={overdue} empty="Nothing overdue." hrefFor={hrefFor} />
          {audience === "team" ? (
            <ItemList title="Awaiting review" icon={Hourglass} tone="text-review" items={awaiting} empty="Nothing waiting for review." hrefFor={hrefFor} />
          ) : null}
          <ItemList
            title={audience === "client" ? "Queries to respond to" : "Queried (with client)"}
            icon={AlertTriangle}
            tone="text-warning"
            items={queried}
            empty="No open queries."
            hrefFor={hrefFor}
          />
          {audience === "client" && overdue.length === 0 && queried.length === 0 && (p?.requested_items ?? 0) === 0 ? (
            <div className="flex items-center gap-2 text-sm text-success">
              <CheckCircle2 className="size-4" /> You&apos;re up to date. Thank you!
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
