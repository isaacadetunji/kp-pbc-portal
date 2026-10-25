"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Archive, CheckCircle2, ChevronDown, Loader2, PlayCircle, RotateCcw } from "lucide-react";
import { useStageLabels } from "@/components/stage-labels";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createClient } from "@/lib/supabase/client";
import { stageKey } from "@/lib/stages";
import type { EngagementStatus } from "@/lib/types";
import { friendlyError } from "@/lib/utils";

type Move = { to: EngagementStatus; title: string; description: string; needsReason: boolean; cta: string };

/**
 * Stage moves after release (the database re-checks every rule):
 *  Pre-execution -> Execution: partner / lead / manager, once every critical item is accepted or waived
 *  Execution -> Completed: partner / lead / manager when nothing is open; otherwise partner / lead with a reason
 */
export function StageActions({
  engagementId, status, canManage, isLead, isSuperAdmin, criticalOpen, openItems,
}: {
  engagementId: string;
  status: EngagementStatus;
  canManage: boolean;
  isLead: boolean;
  isSuperAdmin: boolean;
  /** Critical items not yet accepted or waived (as visible to the user) */
  criticalOpen: number;
  /** Items not accepted, waived or N/A (as visible to the user) */
  openItems: number;
}) {
  const router = useRouter();
  const labels = useStageLabels();
  const [move, setMove] = useState<Move | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const key = stageKey(status);

  async function run(m: Move, note?: string) {
    setBusy(true);
    const { error } = await createClient().rpc("transition_engagement", { p_engagement_id: engagementId, p_to: m.to, p_note: note?.trim() || null });
    setBusy(false);
    if (error) return toast.error(friendlyError(error));
    toast.success(`Moved to ${labels[stageKey(m.to)]}`);
    setMove(null);
    setReason("");
    router.refresh();
  }

  const primary: React.ReactNode[] = [];
  const more: Move[] = [];

  if (key === "pre_engagement" && status !== "declined" && canManage) {
    const blocked = criticalOpen > 0;
    primary.push(
      <Button
        key="exec"
        size="sm"
        disabled={busy || blocked}
        title={blocked ? `${criticalOpen} critical item(s) must be accepted or waived first` : undefined}
        aria-describedby={blocked ? "stage-gate-help" : undefined}
        onClick={() => setMove({ to: "in_progress", title: `Move to ${labels.in_progress}`, description: "Every critical item is accepted or waived. The client can keep providing information.", needsReason: false, cta: `Move to ${labels.in_progress}` })}
      >
        <PlayCircle /> Move to {labels.in_progress}
      </Button>,
    );
    if (blocked) {
      primary.push(
        <span key="gate" id="stage-gate-help" className="self-center text-xs text-muted-foreground">
          {criticalOpen} critical item{criticalOpen === 1 ? "" : "s"} to accept or waive first
        </span>,
      );
    }
  }
  if (status === "in_progress" && canManage) {
    const forced = openItems > 0;
    if (!forced || isLead) {
      primary.push(
        <Button
          key="complete"
          size="sm"
          variant={forced ? "outline" : "success"}
          disabled={busy}
          onClick={() =>
            setMove({
              to: "completed",
              title: `Mark as ${labels.completed}`,
              description: forced
                ? `${openItems} item${openItems === 1 ? " is" : "s are"} not yet accepted or N/A. As partner or team lead you can still complete the engagement; the reason is recorded in the audit trail.`
                : "Every item is accepted, waived or N/A.",
              needsReason: forced,
              cta: `Mark as ${labels.completed}`,
            })
          }
        >
          <CheckCircle2 /> Mark as {labels.completed}
        </Button>,
      );
    } else {
      primary.push(
        <span key="open" className="self-center text-xs text-muted-foreground">
          {openItems} open item{openItems === 1 ? "" : "s"} before {labels.completed}
        </span>,
      );
    }
    if (isLead) more.push({ to: "pre_engagement", title: `Back to ${labels.pre_engagement}`, description: "Use this if fieldwork started too early.", needsReason: false, cta: "Move back" });
  }
  if (status === "completed" && isLead) {
    more.push({ to: "in_progress", title: `Reopen (${labels.in_progress})`, description: "The engagement goes back to execution.", needsReason: false, cta: "Reopen" });
    more.push({ to: "archived", title: labels.archived, description: "Archived engagements are closed for uploads and kept for the record.", needsReason: false, cta: labels.archived });
  }
  if (status === "declined" && isLead) {
    more.push({ to: "archived", title: labels.archived, description: "Archive this engagement.", needsReason: false, cta: labels.archived });
  }
  if (status === "archived" && isSuperAdmin) {
    more.push({ to: "completed", title: `Restore to ${labels.completed}`, description: "Bring the engagement back from the archive.", needsReason: false, cta: "Restore" });
  }

  if (primary.length === 0 && more.length === 0) return null;

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {primary}
        {more.length ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline" disabled={busy}>Stage <ChevronDown /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {more.map((m) => (
                <DropdownMenuItem key={m.to} onSelect={() => setMove(m)}>
                  {m.to === "archived" ? <Archive /> : <RotateCcw />} {m.title}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
      <Dialog open={Boolean(move)} onOpenChange={(o) => { if (!o) { setMove(null); setReason(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{move?.title}</DialogTitle>
            <DialogDescription>{move?.description}</DialogDescription>
          </DialogHeader>
          {move?.needsReason ? (
            <div className="space-y-2">
              <Label htmlFor="stage-reason">Reason (required)</Label>
              <Textarea id="stage-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setMove(null)}>Cancel</Button>
            <Button disabled={busy || (move?.needsReason && !reason.trim())} onClick={() => move && run(move, reason)}>
              {busy ? <Loader2 className="animate-spin" /> : null} {move?.cta}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
