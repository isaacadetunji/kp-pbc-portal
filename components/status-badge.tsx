"use client";

import { AlertTriangle, CheckCircle2, Circle, Clock, Eye, Hourglass, MinusCircle, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useStageLabel } from "@/components/stage-labels";
import { REQUEST_IN_PROGRESS, ENGAGEMENT_STATUS, ITEM_STATUS, PRIORITY } from "@/lib/constants";
import type { EngagementStatus, ItemPriority, ItemStatus } from "@/lib/types";

const ICON: Record<ItemStatus, React.ComponentType<{ className?: string }>> = {
  requested: Circle,
  submitted: Clock,
  under_review: Eye,
  accepted: CheckCircle2,
  queried: AlertTriangle,
  not_applicable: MinusCircle,
};

export function ItemStatusBadge({ status, audience = "team" }: { status: ItemStatus; audience?: "team" | "client" }) {
  const s = ITEM_STATUS[status];
  const Icon = ICON[status];
  return (
    <Badge variant={s.variant}>
      <Icon />
      {audience === "client" ? s.clientLabel : s.label}
    </Badge>
  );
}

export function EngagementStatusBadge({ status, audience = "team" }: { status: EngagementStatus; audience?: "team" | "client" }) {
  if (audience === "client" && (status === "draft" || status === "awaiting_approval")) {
    return (
      <Badge variant="info">
        <Hourglass />
        {REQUEST_IN_PROGRESS}
      </Badge>
    );
  }
  return <StageBadge status={status} />;
}

function StageBadge({ status }: { status: EngagementStatus }) {
  const label = useStageLabel(status);
  return (
    <Badge variant={ENGAGEMENT_STATUS[status].variant}>
      <span aria-hidden className="size-1.5 rounded-full bg-current opacity-80" />
      {label}
    </Badge>
  );
}

export function PriorityBadge({ priority }: { priority: ItemPriority }) {
  if (priority === "normal") return null;
  return <Badge variant={PRIORITY[priority].variant}>{PRIORITY[priority].label}</Badge>;
}

export function CriticalBadge({ waived, audience = "team" }: { waived?: boolean; audience?: "team" | "client" }) {
  if (audience === "client") {
    if (waived) return null;
    return (
      <Badge variant="danger" title="We need this before the engagement can start">
        <ShieldAlert />
        Critical
      </Badge>
    );
  }
  return (
    <Badge variant={waived ? "muted" : "danger"} title={waived ? "Critical item — waived by the partner or team lead" : "Critical: needed before the engagement moves to execution"}>
      <ShieldAlert />
      {waived ? "Critical · waived" : "Critical"}
    </Badge>
  );
}
