"use client";

import { useId, useState } from "react";
import { ChevronsUpDown, Lock, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { TEAM_ROLE } from "@/lib/constants";
import type { AssigneeSide, ItemAssignee, Person, TeamRole } from "@/lib/types";
import { cn, initials } from "@/lib/utils";

export type PersonWithRole = Person & { team_role?: TeamRole };

/** Selected assignees, split by side. */
export interface AssigneeSelection {
  firm: string[];
  client: string[];
}

export function selectionFrom(rows: ItemAssignee[] | undefined): AssigneeSelection {
  return {
    firm: (rows ?? []).filter((a) => a.side === "firm").map((a) => a.user_id),
    client: (rows ?? []).filter((a) => a.side === "client").map((a) => a.user_id),
  };
}

/** Small overlapping avatars for a request row; firm in brand blue, client in accent. */
export function AssigneeAvatars({
  assignees, people, max = 3, className,
}: { assignees: ItemAssignee[] | undefined; people: Map<string, Person>; max?: number; className?: string }) {
  const rows = assignees ?? [];
  if (rows.length === 0) return <span className={cn("text-xs text-muted-foreground", className)}>—</span>;
  const names = rows.map((a) => people.get(a.user_id)?.full_name || "Someone");
  return (
    <span className={cn("flex items-center", className)} title={`Assigned to ${names.join(", ")}`}>
      <span className="sr-only">Assigned to {names.join(", ")}</span>
      <span className="flex -space-x-1.5" aria-hidden>
        {rows.slice(0, max).map((a, i) => (
          <span
            key={a.user_id}
            className={cn(
              "grid size-6 place-items-center rounded-full border-2 border-card text-[10px] font-semibold",
              a.side === "firm" ? "bg-primary text-primary-foreground" : "bg-client-soft text-client",
            )}
          >
            {initials(names[i])}
          </span>
        ))}
        {rows.length > max ? (
          <span className="grid size-6 place-items-center rounded-full border-2 border-card bg-muted text-[10px] font-semibold text-muted-foreground">
            +{rows.length - max}
          </span>
        ) : null}
      </span>
    </span>
  );
}

export function LockBadge({ className }: { className?: string }) {
  return (
    <span className={cn("inline-grid size-5 shrink-0 place-items-center rounded-md bg-neutral-soft text-neutral ring-1 ring-neutral/15", className)} title="Locked: only the people assigned (plus the partner, team lead and managers) can see it">
      <Lock className="size-3" aria-hidden />
      <span className="sr-only">Locked request</span>
    </span>
  );
}

/**
 * "Assign to" multi-select with two groups: Engagement team and Client team.
 * Each group can be read-only (the database enforces who may change what).
 */
export function AssigneePicker({
  team, clientUsers, value, onChange, firmEditable = true, clientEditable = true, label = "Assign to", id,
}: {
  team: PersonWithRole[];
  clientUsers: Person[];
  value: AssigneeSelection;
  onChange: (v: AssigneeSelection) => void;
  firmEditable?: boolean;
  clientEditable?: boolean;
  label?: string;
  id?: string;
}) {
  const auto = useId();
  const triggerId = id ?? `assign-${auto}`;
  const [open, setOpen] = useState(false);
  const people = new Map<string, Person>([...team, ...clientUsers].map((p) => [p.id, p]));
  const selected = [...value.firm.map((u) => ({ u, side: "firm" as AssigneeSide })), ...value.client.map((u) => ({ u, side: "client" as AssigneeSide }))];

  const toggle = (side: AssigneeSide, userId: string, on: boolean) => {
    const cur = new Set(value[side]);
    if (on) cur.add(userId);
    else cur.delete(userId);
    onChange({ ...value, [side]: [...cur] });
  };

  const group = (side: AssigneeSide, title: string, list: PersonWithRole[], editable: boolean, empty: string) => (
    <div role="group" aria-labelledby={`${triggerId}-${side}`} className="space-y-1">
      <div id={`${triggerId}-${side}`} className="px-1 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
        {title}{!editable ? <span className="ml-1 font-normal normal-case">(you can&apos;t change these)</span> : null}
      </div>
      {list.length === 0 ? <p className="px-1 text-xs text-muted-foreground">{empty}</p> : null}
      <ul className="space-y-0.5">
        {list.map((p) => {
          const checked = value[side].includes(p.id);
          return (
            <li key={p.id}>
              <label className={cn("flex items-center gap-2 rounded-md px-1.5 py-1.5 text-sm", editable ? "cursor-pointer hover:bg-muted/60" : "opacity-70")}>
                <Checkbox checked={checked} disabled={!editable} onCheckedChange={(v) => toggle(side, p.id, v === true)} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{p.full_name || p.email}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {[p.team_role ? TEAM_ROLE[p.team_role] : null, p.job_title].filter(Boolean).join(" · ") || p.email}
                  </span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );

  return (
    <div className="space-y-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button id={triggerId} type="button" variant="outline" className="h-auto min-h-9 w-full justify-between py-1.5 font-normal" aria-label={`${label}: ${selected.length ? selected.map((s) => people.get(s.u)?.full_name).join(", ") : "nobody"}`}>
            <span className="truncate text-left">
              {selected.length === 0 ? <span className="text-muted-foreground">Nobody yet (optional)</span> : `${selected.length} ${selected.length === 1 ? "person" : "people"}`}
            </span>
            <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="max-h-[22rem] w-[min(22rem,calc(100vw-2rem))] space-y-3 overflow-y-auto p-2">
          {group("firm", "Engagement team", team, firmEditable, "No one on the team yet.")}
          {group("client", "Client team", clientUsers, clientEditable, "No client users have access yet.")}
        </PopoverContent>
      </Popover>
      {selected.length ? (
        <ul className="flex flex-wrap gap-1.5" aria-label="Assigned">
          {selected.map(({ u, side }) => {
            const editable = side === "firm" ? firmEditable : clientEditable;
            const name = people.get(u)?.full_name || "Someone";
            return (
              <li key={`${side}-${u}`} className={cn("inline-flex items-center gap-1 rounded-full border py-0.5 pr-1 pl-2 text-xs", side === "firm" ? "border-primary/30 bg-accent" : "border-client/20 bg-client-soft/60 text-client")}>
                <span>{name}</span>
                <span className="text-muted-foreground">· {side === "firm" ? "Firm" : "Client"}</span>
                {editable ? (
                  <button type="button" className="rounded-full p-0.5 hover:bg-muted" onClick={() => toggle(side, u, false)} aria-label={`Remove ${name}`}>
                    <X className="size-3" />
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
