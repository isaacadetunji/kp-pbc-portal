"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CalendarDays, ChevronDown, ChevronRight, MessageSquare, Paperclip, Search, ShieldAlert } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { ItemStatusBadge } from "@/components/status-badge";
import { ItemDetailSheet } from "@/components/items/item-detail-sheet";
import { fmtDate, isOverdue } from "@/lib/dates";
import type { EngagementProgress, EngagementStatus, Folder, Person, RequestItem } from "@/lib/types";
import { cn, pct } from "@/lib/utils";

type View = "todo" | "submitted" | "complete" | "all";
const VIEWS: { key: View; label: string; match: (i: RequestItem) => boolean }[] = [
  { key: "todo", label: "To do", match: (i) => i.status === "requested" || i.status === "queried" },
  { key: "submitted", label: "Submitted", match: (i) => i.status === "submitted" || i.status === "under_review" },
  { key: "complete", label: "Complete", match: (i) => i.status === "accepted" || i.status === "not_applicable" },
  { key: "all", label: "All", match: () => true },
];

export function PortalRequestList({
  engagementId, engagementStatus, items, folders, team, progress, fileCounts, commentCounts, userId, upload,
}: {
  engagementId: string;
  engagementStatus: EngagementStatus;
  items: RequestItem[];
  folders: Folder[];
  team: Person[];
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
        items: items.filter((i) => i.folder_id === f.id && match(i) && (!n || `${i.code} ${i.title}`.toLowerCase().includes(n))),
        all: items.filter((i) => i.folder_id === f.id),
      }))
      .filter((g) => g.items.length > 0);
  }, [folders, items, match, q]);

  const open = items.find((i) => i.id === openId) ?? null;
  const critical = items.filter((i) => i.is_critical && !i.is_waived && (i.status === "requested" || i.status === "queried"));

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="grid gap-3 rounded-xl border bg-card p-4 sm:grid-cols-3">
        <div className="space-y-1.5 sm:col-span-2">
          <div className="flex items-baseline justify-between">
            <span className="text-sm font-medium">Overall progress</span>
            <span className="text-2xl font-semibold tabular">{pct(progress?.pct_provided ?? 0)}</span>
          </div>
          <Progress value={progress?.pct_provided ?? 0} tone="success" label="Overall progress" />
          <div className="text-xs text-muted-foreground">
            {progress?.accepted_items ?? 0} of {progress?.applicable_items ?? 0} items complete · {progress?.submitted_items ?? 0} submitted
          </div>
        </div>
        <div className="flex flex-col justify-center rounded-lg bg-muted/60 p-3">
          <div className="text-xs text-muted-foreground">Still needed from you</div>
          <div className="text-2xl font-semibold tabular">{todoCount}</div>
          {progress?.overdue_items ? <div className="text-xs font-medium text-destructive">{progress.overdue_items} overdue</div> : null}
        </div>
      </div>

      {critical.length ? (
        <div className="rounded-xl border border-destructive/25 bg-danger-soft p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-destructive">
            <ShieldAlert className="size-4" /> Needed first ({critical.length})
          </div>
          <p className="mt-1 text-xs text-destructive/90">We need these before the engagement can start. Please provide them as soon as possible.</p>
          <ul className="mt-2 space-y-1">
            {critical.map((i) => (
              <li key={i.id}>
                <button onClick={() => openItem(i.id)} className="text-left text-sm underline-offset-2 hover:underline">
                  {i.title}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex gap-1 overflow-x-auto rounded-lg bg-muted p-1" role="tablist">
          {VIEWS.map((v) => {
            const count = items.filter(v.match).length;
            return (
              <button
                key={v.key}
                role="tab"
                aria-selected={view === v.key}
                onClick={() => setView(v.key)}
                className={cn("rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap", view === v.key ? "bg-card shadow-sm" : "text-muted-foreground")}
              >
                {v.label} <span className="text-xs tabular opacity-70">{count}</span>
              </button>
            );
          })}
        </div>
        <div className="relative flex-1">
          <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search requests" className="pl-9" aria-label="Search requests" />
        </div>
      </div>

      {groups.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-card p-10 text-center text-sm text-muted-foreground">
          {view === "todo" ? "Nothing outstanding. Thank you!" : "No items here."}
        </div>
      ) : null}

      {groups.map(({ folder, items: rows, all }) => {
        const isCollapsed = collapsed.has(folder.id);
        const done = all.filter((i) => i.status === "accepted").length;
        const applicable = all.filter((i) => i.status !== "not_applicable").length;
        return (
          <section key={folder.id} className="overflow-hidden rounded-xl border bg-card">
            <button
              className="flex w-full items-center gap-3 border-b bg-muted/40 px-4 py-3 text-left"
              onClick={() => setCollapsed((s) => { const n = new Set(s); if (n.has(folder.id)) n.delete(folder.id); else n.add(folder.id); return n; })}
              aria-expanded={!isCollapsed}
            >
              {isCollapsed ? <ChevronRight className="size-4" /> : <ChevronDown className="size-4" />}
              <span className="flex-1 text-sm font-semibold">{folder.name}</span>
              <span className="text-xs text-muted-foreground tabular">{done}/{applicable} complete</span>
            </button>
            {!isCollapsed ? (
              <ul className="divide-y">
                {rows.map((i) => {
                  const overdue = isOverdue(i.due_date, i.status);
                  return (
                    <li key={i.id}>
                      <button onClick={() => openItem(i.id)} className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-muted/30">
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-medium">{i.title}</span>
                            {i.is_critical && !i.is_waived ? (
                              <span className="inline-flex items-center gap-1 text-xs font-medium text-destructive"><ShieldAlert className="size-3" /> Needed first</span>
                            ) : null}
                          </div>
                          {i.guidance ? <p className="line-clamp-2 text-xs text-muted-foreground">{i.guidance}</p> : null}
                          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                            <ItemStatusBadge status={i.status} audience="client" />
                            {i.due_date ? (
                              <span className={cn("flex items-center gap-1", overdue && "font-medium text-destructive")}>
                                <CalendarDays className="size-3" /> {overdue ? "Overdue · " : "Due "}{fmtDate(i.due_date)}
                              </span>
                            ) : null}
                            {fileCounts[i.id] ? <span className="flex items-center gap-1"><Paperclip className="size-3" />{fileCounts[i.id]}</span> : null}
                            {commentCounts[i.id] ? <span className="flex items-center gap-1"><MessageSquare className="size-3" />{commentCounts[i.id]}</span> : null}
                          </div>
                        </div>
                        <ChevronRight className="mt-1 size-4 shrink-0 text-muted-foreground" />
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
        folders={folders}
        upload={upload}
        onChanged={() => router.refresh()}
      />
    </div>
  );
}
