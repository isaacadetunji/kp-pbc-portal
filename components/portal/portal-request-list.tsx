"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CalendarDays, ChevronDown, ChevronRight, MessageSquare, Paperclip, Search, ShieldAlert, UserCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { CriticalBadge, ItemStatusBadge } from "@/components/status-badge";
import { ItemDetailSheet } from "@/components/items/item-detail-sheet";
import { AssigneeAvatars, LockBadge } from "@/components/items/assignees";
import { fmtDate, isOverdue } from "@/lib/dates";
import type { EngagementProgress, EngagementStatus, Folder, ItemAssignee, Person, RequestItem } from "@/lib/types";
import { progressTextClass } from "@/lib/progress";
import { cn, pct } from "@/lib/utils";

type View = "todo" | "submitted" | "complete" | "all";
const VIEWS: { key: View; label: string; match: (i: RequestItem) => boolean }[] = [
  { key: "todo", label: "Outstanding", match: (i) => i.status === "requested" || i.status === "queried" },
  { key: "submitted", label: "Submitted", match: (i) => i.status === "submitted" || i.status === "under_review" },
  { key: "complete", label: "Complete", match: (i) => i.status === "accepted" || i.status === "not_applicable" },
  { key: "all", label: "All", match: () => true },
];

export function PortalRequestList({
  engagementId, engagementStatus, items, folders, team, clientUsers = [], assignees = {}, progress, fileCounts, commentCounts, userId, upload,
}: {
  engagementId: string;
  engagementStatus: EngagementStatus;
  items: RequestItem[];
  folders: Folder[];
  team: Person[];
  /** Client users with access (for "Assigned to" on unlocked requests) */
  clientUsers?: Person[];
  assignees?: Record<string, ItemAssignee[]>;
  progress: EngagementProgress | null;
  fileCounts: Record<string, number>;
  commentCounts: Record<string, number>;
  userId: string;
  upload: { allowedExtensions: string[]; maxFileMb: number };
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const todoCount = items.filter(VIEWS[0]!.match).length;
  const [view, setView] = useState<View>(todoCount > 0 ? "todo" : "all");
  const [q, setQ] = useState("");
  const [mineOnly, setMineOnly] = useState(false);
  const people = useMemo(() => new Map<string, Person>([...team, ...clientUsers].map((p) => [p.id, p])), [team, clientUsers]);
  const isMine = (i: RequestItem) => (assignees[i.id] ?? []).some((a) => a.user_id === userId);
  const mineCount = items.filter(isMine).length;
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [openId, setOpenId] = useState<string | null>(params.get("item"));

  useEffect(() => setOpenId(params.get("item")), [params]);

  function openItem(id: string | null) {
    const next = new URLSearchParams(params.toString());
    if (id) next.set("item", id);
    else next.delete("item");
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    setOpenId(id);
  }

  const match = VIEWS.find((v) => v.key === view)!.match;
  const groups = useMemo(() => {
    const n = q.trim().toLowerCase();
    return folders
      .map((f) => ({
        folder: f,
        items: items.filter((i) => i.folder_id === f.id && match(i) && (!mineOnly || isMine(i)) && (!n || `${i.code} ${i.title}`.toLowerCase().includes(n))),
        all: items.filter((i) => i.folder_id === f.id),
      }))
      .filter((g) => g.items.length > 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folders, items, match, q, mineOnly, assignees, userId]);

  const open = items.find((i) => i.id === openId) ?? null;
  const critical = items.filter((i) => i.is_critical && !i.is_waived && (i.status === "requested" || i.status === "queried"));

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="grid gap-4 rounded-xl border bg-card p-5 shadow-sm sm:grid-cols-3 sm:gap-6">
        <div className="space-y-2 sm:col-span-2">
          <div className="flex items-baseline justify-between">
            <span className="eyebrow">Overall progress</span>
            <span className={cn("font-display text-[28px] leading-8 font-bold tabular", progressTextClass(progress?.pct_provided ?? 0))}>{pct(progress?.pct_provided ?? 0)}</span>
          </div>
          <Progress value={progress?.pct_provided ?? 0} tone="auto" size="lg" label="Overall progress" />
          <div className="text-xs text-muted-foreground">
            {progress?.accepted_items ?? 0} of {progress?.applicable_items ?? 0} items complete · {progress?.submitted_items ?? 0} submitted
          </div>
        </div>
        <div className={cn("flex flex-col justify-center rounded-xl border px-4 py-3", progress?.overdue_items ? "border-danger/15 bg-danger-soft/60" : "bg-muted/50")}>
          <div className="text-xs font-medium text-muted-foreground">Still needed from you</div>
          <div className="font-display text-[28px] leading-9 font-bold tabular">{todoCount}</div>
          {progress?.overdue_items ? <div className="text-xs font-semibold text-danger">{progress.overdue_items} overdue</div> : null}
        </div>
      </div>

      {critical.length ? (
        <div className="overflow-hidden rounded-xl border border-danger/20 bg-card shadow-sm">
          <div className="flex items-start gap-3 border-b border-danger/15 bg-danger-soft px-4 py-3">
            <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg bg-card text-danger shadow-xs"><ShieldAlert className="size-4" /></span>
            <div>
              <div className="text-sm font-semibold text-danger">Critical ({critical.length})</div>
              <p className="text-xs text-danger/90">We need these before the engagement can start. Please provide them as soon as possible.</p>
            </div>
          </div>
          <ul className="divide-y">
            {critical.map((i) => (
              <li key={i.id}>
                <button onClick={() => openItem(i.id)} className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm font-medium transition-colors hover:bg-danger-soft/40 hover:text-danger">
                  <span className="size-1.5 shrink-0 rounded-full bg-danger-bar" aria-hidden />
                  <span className="min-w-0 flex-1">{i.title}</span>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex gap-1 overflow-x-auto rounded-lg border bg-muted/70 p-[3px]" role="tablist">
          {VIEWS.map((v) => {
            const count = items.filter(v.match).length;
            return (
              <button
                key={v.key}
                role="tab"
                aria-selected={view === v.key}
                onClick={() => setView(v.key)}
                className={cn("rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors", view === v.key ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
              >
                {v.label} <span className={cn("ml-0.5 rounded-full px-1.5 text-xs leading-[18px] tabular", view === v.key ? "bg-accent text-accent-foreground" : "bg-card/70")}>{count}</span>
              </button>
            );
          })}
        </div>
        <div className="relative flex-1">
          <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search requests" className="pl-9" aria-label="Search requests" />
        </div>
        <Button
          type="button"
          size="sm"
          variant={mineOnly ? "default" : "outline"}
          className="h-9"
          aria-pressed={mineOnly}
          onClick={() => setMineOnly((v) => !v)}
        >
          <UserCheck /> Assigned to me <span className="text-xs tabular opacity-70">{mineCount}</span>
        </Button>
      </div>

      {groups.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border-strong bg-card p-10 text-center text-sm text-muted-foreground">
          {mineOnly ? "Nothing here is assigned to you." : view === "todo" ? "Nothing outstanding. Thank you!" : "No items here."}
        </div>
      ) : null}

      {groups.map(({ folder, items: rows, all }) => {
        const isCollapsed = collapsed.has(folder.id);
        const done = all.filter((i) => i.status === "accepted").length;
        const applicable = all.filter((i) => i.status !== "not_applicable").length;
        return (
          <section key={folder.id} className="overflow-hidden rounded-xl border bg-card shadow-sm">
            <button
              className="flex w-full items-center gap-3 border-b bg-muted/50 px-4 py-3 text-left transition-colors hover:bg-muted"
              onClick={() => setCollapsed((s) => { const n = new Set(s); if (n.has(folder.id)) n.delete(folder.id); else n.add(folder.id); return n; })}
              aria-expanded={!isCollapsed}
            >
              {isCollapsed ? <ChevronRight className="size-4 text-muted-foreground" /> : <ChevronDown className="size-4 text-muted-foreground" />}
              <span className="flex-1 font-display text-sm font-semibold">{folder.name}</span>
              <span className="rounded-full border bg-card px-2 text-xs leading-5 font-medium text-muted-foreground tabular">{done}/{applicable} complete</span>
            </button>
            {!isCollapsed ? (
              <ul className="divide-y">
                {rows.map((i) => {
                  const overdue = isOverdue(i.due_date, i.status);
                  return (
                    <li key={i.id}>
                      <button onClick={() => openItem(i.id)} className="group flex w-full items-start gap-3 px-4 py-3.5 text-left transition-colors hover:bg-accent/40">
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            {i.is_locked ? <LockBadge /> : null}
                            <span className="text-sm font-semibold text-foreground group-hover:text-primary">{i.title}</span>
                            {i.is_critical && !i.is_waived ? <CriticalBadge audience="client" /> : null}
                          </div>
                          {i.guidance ? <p className="line-clamp-2 text-xs text-muted-foreground">{i.guidance}</p> : null}
                          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                            <ItemStatusBadge status={i.status} audience="client" />
                            {i.due_date ? (
                              <span className={cn("flex items-center gap-1 tabular", overdue && "font-semibold text-danger")}>
                                <CalendarDays className="size-3" /> {overdue ? "Overdue · " : "Due "}{fmtDate(i.due_date)}
                              </span>
                            ) : null}
                            {fileCounts[i.id] ? <span className="flex items-center gap-1"><Paperclip className="size-3" />{fileCounts[i.id]}</span> : null}
                            {commentCounts[i.id] ? <span className="flex items-center gap-1"><MessageSquare className="size-3" />{commentCounts[i.id]}</span> : null}
                            {assignees[i.id]?.length ? <AssigneeAvatars assignees={assignees[i.id]} people={people} /> : null}
                          </div>
                        </div>
                        <ChevronRight className="mt-1 size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </section>
        );
      })}

      <ItemDetailSheet
        item={open}
        open={Boolean(open)}
        onOpenChange={(o) => !o && openItem(null)}
        audience="client"
        userId={userId}
        engagementStatus={engagementStatus}
        perms={{ canManage: false, canAccept: false, isLead: false }}
        team={team}
        clientUsers={clientUsers}
        folders={folders}
        upload={upload}
        onChanged={() => router.refresh()}
      />
    </div>
  );
}
