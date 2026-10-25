"use client";

import Link from "next/link";
import { ArrowLeft, CalendarDays, Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ActiveTabScroller } from "@/components/engagement/active-tab-scroller";
import { EngagementStatusBadge } from "@/components/status-badge";
import { useStageLabels } from "@/components/stage-labels";
import { MONTHS } from "@/lib/constants";
import { STAGE_FLOW, stageKey } from "@/lib/stages";
import { tabClass } from "@/lib/tab-class";
import { fmtDate } from "@/lib/dates";
import type { Client, Engagement, EngagementType } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Fixed main flow: Draft -> Approval -> Pre-execution -> Execution -> Completed.
 * Done steps are green with a check, the current step is the brand action
 * blue, upcoming steps are neutral grey, with connectors between them. Names
 * come from Settings > Engagements (stage_labels).
 */
export function StageStepper({ status, className }: { status: Engagement["status"]; className?: string }) {
  const labels = useStageLabels();
  const key = stageKey(status);
  const archived = status === "archived";
  const current = archived ? STAGE_FLOW.length : STAGE_FLOW.indexOf(key);
  return (
    // `relative` keeps the sr-only text inside the scroll container (no page overflow on phones)
    <div className={cn("relative overflow-x-auto", className)}>
      <ol className="flex min-w-max items-center lg:min-w-0" aria-label="Engagement stage">
        {STAGE_FLOW.map((k, i) => {
          const done = i < current || (k === "completed" && status === "completed");
          const isCurrent = i === current && !done;
          return (
            <li key={k} className={cn("flex items-center", i > 0 && "flex-1")} aria-current={isCurrent ? "step" : undefined}>
              {i > 0 ? (
                <span
                  aria-hidden
                  className={cn(
                    "mx-2.5 h-0.5 min-w-6 flex-1 rounded-full sm:mx-3",
                    i < current || done ? "bg-success-bar" : i === current ? "bg-gradient-to-r from-success-bar to-primary" : "bg-border-strong/70",
                  )}
                />
              ) : null}
              <span className="flex items-center gap-2">
                <span
                  aria-hidden
                  className={cn(
                    "grid size-7 shrink-0 place-items-center rounded-full text-xs font-semibold tabular-nums transition-colors",
                    done && "bg-success-solid text-white shadow-[0_1px_2px_rgb(19_105_63/0.3)]",
                    isCurrent && "bg-primary text-primary-foreground shadow-[0_0_0_4px_color-mix(in_oklab,var(--brand-primary)_16%,transparent)]",
                    !done && !isCurrent && "border-[1.5px] border-border-strong bg-card text-muted-foreground",
                  )}
                >
                  {done ? <Check className="size-3.5" strokeWidth={3} /> : i + 1}
                </span>
                <span className="flex flex-col leading-tight">
                  <span className={cn("text-[13px] whitespace-nowrap", isCurrent ? "font-semibold text-primary" : done ? "font-medium text-foreground" : "text-muted-foreground")}>
                    {labels[k]}
                    <span className="sr-only">{done ? " (done)" : isCurrent ? " (current stage)" : " (upcoming)"}</span>
                  </span>
                  <span aria-hidden className={cn("hidden text-2xs whitespace-nowrap sm:block", isCurrent ? "text-primary/80" : done ? "text-success" : "text-subtle-foreground")}>
                    {done ? "Done" : isCurrent ? "Current stage" : "Upcoming"}
                  </span>
                </span>
              </span>
            </li>
          );
        })}
        {archived ? (
          <li className="ml-4"><Badge variant="muted">{labels.archived}</Badge></li>
        ) : null}
      </ol>
    </div>
  );
}

function KeyDate({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <CalendarDays className="size-3.5 text-subtle-foreground" aria-hidden />
      {label} <b className="font-semibold text-foreground">{value}</b>
    </span>
  );
}

export function EngagementHeader({
  engagement, client, type, basePath, tab, tabs, actions,
}: {
  engagement: Engagement; client: Client; type: EngagementType; basePath: string; tab: string;
  tabs: { key: string; label: string }[]; actions?: React.ReactNode;
}) {
  return (
    <div className="space-y-4">
      <Link href="/engagements" className="inline-flex items-center gap-1 rounded text-[13px] font-medium text-muted-foreground hover:text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
        <ArrowLeft className="size-4" aria-hidden /> All engagements
      </Link>
      <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
        <div className="surface-brand flex flex-col gap-4 p-5 sm:p-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span className="rounded-md border bg-card px-1.5 py-px font-mono text-[11px] font-medium text-foreground/80">{engagement.code}</span>
              <span className="font-medium">{type?.name}</span>
              <EngagementStatusBadge status={engagement.status} />
            </div>
            <h1 className="text-2xl leading-8 font-bold text-foreground sm:text-[26px]">{engagement.name}</h1>
            <div className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground/90">{client.name}</span>
              {client.rc_number ? ` · ${client.rc_number}` : ""}
              {` · Period ${fmtDate(engagement.period_start)} – ${fmtDate(engagement.period_end)}`}
              {client.year_end_month ? ` · Year end ${client.year_end_day ?? ""} ${MONTHS[client.year_end_month - 1]}` : ""}
            </div>
            {engagement.planned_start || engagement.documents_due || engagement.report_due ? (
              <div className="flex flex-wrap gap-x-5 gap-y-1 pt-1 text-xs text-muted-foreground">
                {engagement.planned_start ? <KeyDate label="Planned start" value={fmtDate(engagement.planned_start)} /> : null}
                {engagement.documents_due ? <KeyDate label="Documents due" value={fmtDate(engagement.documents_due)} /> : null}
                {engagement.report_due ? <KeyDate label="Report due" value={fmtDate(engagement.report_due)} /> : null}
              </div>
            ) : null}
          </div>
          {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
        </div>
        <div className="border-t bg-muted/40 px-5 py-3.5 sm:px-6">
          <StageStepper status={engagement.status} />
        </div>
      </div>
      <ActiveTabScroller />
      <nav className="relative flex gap-1 overflow-x-auto border-b" aria-label="Engagement sections">
        {tabs.map((t) => (
          <Link
            key={t.key}
            href={`${basePath}?tab=${t.key}`}
            scroll={false}
            className={tabClass(tab === t.key)}
            aria-current={tab === t.key ? "page" : undefined}
          >
            {t.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
