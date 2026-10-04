import Link from "next/link";
import { AlertTriangle, CheckCircle2, Clock, Hourglass, ShieldAlert, TrendingDown } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { fmtDate } from "@/lib/dates";
import type { EngagementProgress, FolderProgress, RequestItem } from "@/lib/types";
import { cn, pct } from "@/lib/utils";

function Stat({
  label, value, sub, meter, tone = "primary", emphasis,
}: {
  label: string; value: string; sub?: string; meter?: number; tone?: "primary" | "accent" | "success" | "warning"; emphasis?: boolean;
}) {
  return (
    <Card className={cn(emphasis && "border-brand-accent/60 ring-1 ring-brand-accent/30")}>
      <CardContent className="space-y-2 py-4">
        <div className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</div>
        <div className={cn("tabular font-semibold tracking-tight", emphasis ? "text-4xl" : "text-3xl")}>{value}</div>
        {meter !== undefined ? <Progress value={meter} tone={tone} label={label} /> : null}
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
          <span className="ml-auto rounded-full bg-muted px-2 py-0.5 text-xs tabular">{items.length}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-3">
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{empty}</p>
        ) : (
          <ul className="divide-y">
            {items.slice(0, 8).map((i) => (
              <li key={i.id}>
                <Link href={hrefFor(i)} className="flex items-center gap-2 py-2 text-sm hover:text-primary">
                  <span className="font-mono text-xs text-muted-foreground">{i.code}</span>
                  <span className="min-w-0 flex-1 truncate">{i.title}</span>
                  <span className="text-xs text-muted-foreground">{fmtDate(i.due_date, "d MMM")}</span>
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
        <Card className="border-warning/40 bg-warning-soft/40">
          <CardHeader className="pb-0">
            <CardTitle className="flex items-center gap-2 text-sm"><TrendingDown className="size-4 text-warning" /> Where you&apos;re behind</CardTitle>
          </CardHeader>
          <CardContent className="pt-3">
            <ul className="grid gap-3 md:grid-cols-3">
              {behind.map((f) => (
                <li key={f.folder_id} className="rounded-lg border bg-card p-3">
                  <div className="truncate text-sm font-medium">{f.folder_name}</div>
                  <div className="mt-1 flex items-baseline justify-between text-xs text-muted-foreground">
                    <span>{f.applicable_items - f.submitted_items} still to provide{f.overdue_items ? ` · ${f.overdue_items} overdue` : ""}</span>
                    <span className="font-semibold text-foreground tabular">{pct(f.pct_submitted)}</span>
                  </div>
                  <Progress className="mt-2" value={f.pct_submitted} tone="warning" label={`${f.folder_name} provided`} />
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
          tone="accent"
          emphasis
        />
        <Stat
          label="Information provided"
          value={pct(p?.pct_provided ?? 0)}
          sub={`${p?.accepted_items ?? 0} of ${p?.applicable_items ?? 0} items accepted`}
          meter={p?.pct_provided ?? 0}
          tone="success"
        />
        <Stat
          label="Submitted"
          value={pct(p?.pct_submitted ?? 0)}
          sub={`${p?.submitted_items ?? 0} of ${p?.applicable_items ?? 0} items received`}
          meter={p?.pct_submitted ?? 0}
        />
        <Stat
          label={audience === "client" ? "Needs your action" : "Outstanding"}
          value={String((p?.requested_items ?? 0) + (p?.queried_items ?? 0))}
          sub={`${p?.overdue_items ?? 0} overdue · ${p?.queried_items ?? 0} queried${p?.na_items ? ` · ${p.na_items} N/A` : ""}`}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Completion by folder</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 pt-3">
            {folders.length === 0 ? <p className="text-sm text-muted-foreground">No folders yet.</p> : null}
            {folders
              .filter((f) => f.total_items > 0)
              .sort((a, b) => a.sort_order - b.sort_order)
              .map((f) => (
                <div key={f.folder_id} className="grid grid-cols-1 items-center gap-x-3 gap-y-1 sm:grid-cols-[minmax(0,1fr)_auto]">
                  <div className="truncate text-sm">{f.folder_name}</div>
                  <div className="tabular text-xs text-muted-foreground">
                    {audience === "client"
                      ? `${f.accepted_items} of ${f.applicable_items} complete · ${f.applicable_items - f.submitted_items} to provide · `
                      : `${f.accepted_items}/${f.applicable_items} · `}
                    <span className="font-medium text-foreground">{pct(f.pct_provided)}</span>
                  </div>
                  <div className="relative col-span-full h-2 overflow-hidden rounded-full bg-muted" role="img" aria-label={`${f.folder_name}: ${pct(f.pct_provided)} accepted, ${pct(f.pct_submitted)} submitted`}>
                    <div className="absolute inset-y-0 left-0 rounded-full bg-primary/25" style={{ width: `${f.pct_submitted}%` }} />
                    <div className="absolute inset-y-0 left-0 rounded-full bg-success" style={{ width: `${f.pct_provided}%` }} />
                  </div>
                </div>
              ))}
            <div className="flex gap-4 pt-1 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-success" /> Accepted</span>
              <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-primary/25" /> Submitted, awaiting review</span>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          {criticalOpen.length ? (
            <ItemList title={audience === "client" ? "Needed first: still to provide" : "Critical items outstanding"} icon={ShieldAlert} tone="text-destructive" items={criticalOpen} empty="" hrefFor={hrefFor} />
          ) : null}
          <ItemList title="Overdue" icon={Clock} tone="text-destructive" items={overdue} empty="Nothing overdue." hrefFor={hrefFor} />
          {audience === "team" ? (
            <ItemList title="Awaiting review" icon={Hourglass} tone="text-info" items={awaiting} empty="Nothing waiting for review." hrefFor={hrefFor} />
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
