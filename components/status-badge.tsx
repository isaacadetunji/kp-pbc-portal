import { AlertTriangle, CheckCircle2, Circle, Clock, Eye, MinusCircle, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { BEING_PREPARED, ENGAGEMENT_STATUS, ITEM_STATUS, PRIORITY } from "@/lib/constants";
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
    return <Badge variant="info">{BEING_PREPARED}</Badge>;
  }
  const s = ENGAGEMENT_STATUS[status];
  return <Badge variant={s.variant}>{s.label}</Badge>;
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
        Needed first
      </Badge>
    );
  }
  return (
    <Badge variant={waived ? "muted" : "danger"} title={waived ? "Critical item — waived by engagement lead" : "Critical: needed before fieldwork starts"}>
      <ShieldAlert />
      {waived ? "Critical · waived" : "Critical"}
    </Badge>
  );
}
