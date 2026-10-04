import Link from "next/link";
import { Check } from "lucide-react";
import { ActiveTabScroller } from "@/components/engagement/active-tab-scroller";
import { EngagementStatusBadge } from "@/components/status-badge";
import { ENGAGEMENT_STATUS, MONTHS } from "@/lib/constants";
import { fmtDate } from "@/lib/dates";
import type { Client, Engagement, EngagementType } from "@/lib/types";
import { cn } from "@/lib/utils";

const STEPS = [
  { key: "draft", label: "Draft" },
  { key: "awaiting_approval", label: "Approval" },
  { key: "pre_engagement", label: "Pre-engagement" },
  { key: "acceptance_review", label: "Acceptance" },
  { key: "in_progress", label: "Fieldwork" },
  { key: "completed", label: "Completed" },
];

export function StageStepper({ status }: { status: Engagement["status"] }) {
  const step = ENGAGEMENT_STATUS[status].step;
  // steps: 0 draft, 1 approval, 2 pre-engagement, 3 acceptance (3 review, 4 accepted/declined), 5 fieldwork, 6 completed
  const stepIndex = step <= 3 ? step : step === 4 ? 3 : step === 5 ? 4 : 5;
  return (
    <ol className="flex items-center gap-1 overflow-x-auto text-xs" aria-label="Engagement stage">
      {STEPS.map((s, i) => {
        const done = i < stepIndex || status === "archived";
        const current = i === stepIndex && status !== "archived";
        return (
          <li key={s.key} className="flex items-center gap-1">
            <span
              className={cn(
                "flex items-center gap-1.5 rounded-full px-2.5 py-1 whitespace-nowrap",
                done && "bg-success-soft text-success",
                current && "bg-primary text-primary-foreground",
                !done && !current && "bg-muted text-muted-foreground",
                current && status === "declined" && "bg-danger-soft text-destructive",
              )}
              aria-current={current ? "step" : undefined}
            >
              {done ? <Check className="size-3" /> : null}
              {current && status === "declined" ? "Declined" : s.label}
            </span>
            {i < STEPS.length - 1 ? <span className="h-px w-3 bg-border" /> : null}
          </li>
        );
      })}
    </ol>
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
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="font-mono">{engagement.code}</span>
            <span>·</span>
            <span>{type?.name}</span>
            <EngagementStatusBadge status={engagement.status} />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">{engagement.name}</h1>
          <div className="text-sm text-muted-foreground">
            {client.name}
            {client.rc_number ? ` · ${client.rc_number}` : ""}
            {` · Period ${fmtDate(engagement.period_start)} – ${fmtDate(engagement.period_end)}`}
            {client.year_end_month ? ` · Year end ${client.year_end_day ?? ""} ${MONTHS[client.year_end_month - 1]}` : ""}
          </div>
          {engagement.planned_start || engagement.documents_due || engagement.report_due ? (
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              {engagement.planned_start ? <span>Planned start <b className="font-medium text-foreground">{fmtDate(engagement.planned_start)}</b></span> : null}
              {engagement.documents_due ? <span>Documents due <b className="font-medium text-foreground">{fmtDate(engagement.documents_due)}</b></span> : null}
              {engagement.report_due ? <span>Report due <b className="font-medium text-foreground">{fmtDate(engagement.report_due)}</b></span> : null}
            </div>
          ) : null}
        </div>
        {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
      </div>
      <StageStepper status={engagement.status} />
      <ActiveTabScroller />
      <nav className="flex gap-1 overflow-x-auto border-b" aria-label="Engagement sections">
        {tabs.map((t) => (
          <Link
            key={t.key}
            href={`${basePath}?tab=${t.key}`}
            scroll={false}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors",
              tab === t.key ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
            aria-current={tab === t.key ? "page" : undefined}
          >
            {t.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
