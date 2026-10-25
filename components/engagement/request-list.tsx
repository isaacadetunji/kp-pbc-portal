"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  CalendarDays, CheckCircle2, ChevronDown, ChevronRight, FolderPlus, ListPlus, MessageSquare, MinusCircle,
  MoreHorizontal, Paperclip, Pencil, Plus, RefreshCw, Search, Trash2, UserPlus, X,
  ListChecks,
} from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CriticalBadge, ItemStatusBadge, PriorityBadge } from "@/components/status-badge";
import { ItemDetailSheet, type ItemPerms } from "@/components/items/item-detail-sheet";
import { ItemFormDialog } from "@/components/items/item-form-dialog";
import { AssigneeAvatars, LockBadge, selectionFrom, type PersonWithRole } from "@/components/items/assignees";
import { FILE_CLASS } from "@/lib/checklist-constants";
import { createClient } from "@/lib/supabase/client";
import { ITEM_STATUS, ITEM_STATUS_ORDER, PRIORITY, PRIORITY_ORDER } from "@/lib/constants";
import { fmtDate, isOverdue } from "@/lib/dates";
import type { EngagementStatus, Folder, ItemAssignee, ItemStatus, Person, RequestItem } from "@/lib/types";
import { cn, friendlyError } from "@/lib/utils";

const ALL = "__all";

export interface MasterOption {
  id: string;
  code: string;
  title: string;
  category: string;
  is_critical: boolean;
}

export function RequestList({
  engagementId,
  engagementStatus,
  items,
  folders,
  team,
  clientUsers = [],
  assignees = {},
  fileCounts,
  commentCounts,
  perms,
  userId,
  upload,
  masterUpdates,
  masterOptions,
  approval,
  sampleProgress = {},
}: {
  engagementId: string;
  engagementStatus: EngagementStatus;
  items: RequestItem[];
  folders: Folder[];
  team: PersonWithRole[];
  /** Client users with access (assignable on the client side) */
  clientUsers?: Person[];
  /** Assignees per item */
  assignees?: Record<string, ItemAssignee[]>;
  fileCounts: Record<string, number>;
  commentCounts: Record<string, number>;
  perms: ItemPerms;
  userId: string;
  upload: { allowedExtensions: string[]; maxFileMb: number };
  masterUpdates: number;
  masterOptions: MasterOption[];
  approval?: { requestedByName?: string; requestedAt?: string | null };
  sampleProgress?: Record<string, { received: number; total: number }>;
}) {
  const canEdit = perms.canEdit ?? perms.canManage;
  const [approvalDialog, setApprovalDialog] = useState<"submit" | "return" | null>(null);
  const [approvalNote, setApprovalNote] = useState("");
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const supabase = createClient();

  const [q, setQ] = useState("");
  const [status, setStatus] = useState<string>(ALL);
  const [folderFilter, setFolderFilter] = useState<string>(ALL);
  const [assignee, setAssignee] = useState<string>(ALL);
  const [criticalOnly, setCriticalOnly] = useState(false);
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [openItemId, setOpenItemId] = useState<string | null>(params.get("item"));
  const [editItem, setEditItem] = useState<RequestItem | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addFolderId, setAddFolderId] = useState<string | undefined>();
  const [addFolderName, setAddFolderName] = useState<string | undefined>();
  const [thenAdd, setThenAdd] = useState(true);
  const [folderDialog, setFolderDialog] = useState<{ mode: "add" | "rename"; folder?: Folder } | null>(null);
  const [folderName, setFolderName] = useState("");
  const [bulkDue, setBulkDue] = useState("");
  const [masterOpen, setMasterOpen] = useState(false);
  const [masterPick, setMasterPick] = useState<Set<string>>(new Set());
  const [masterQ, setMasterQ] = useState("");

  useEffect(() => {
    setOpenItemId(params.get("item"));
  }, [params]);

  const refresh = () => router.refresh();
  const people = useMemo(() => new Map<string, Person>([...team, ...clientUsers].map((t) => [t.id, t])), [team, clientUsers]);
  const isTeam = perms.isTeam ?? true;

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return items.filter((i) => {
      if (status !== ALL && i.status !== status) return false;
      if (folderFilter !== ALL && i.folder_id !== folderFilter) return false;
      const who = (assignees[i.id] ?? []).map((a) => a.user_id);
      if (assignee !== ALL && (assignee === "__unassigned" ? who.length > 0 : !who.includes(assignee))) return false;
      if (criticalOnly && !i.is_critical) return false;
      if (overdueOnly && !isOverdue(i.due_date, i.status)) return false;
      if (needle && !`${i.code} ${i.title} ${i.guidance ?? ""}`.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [items, q, status, folderFilter, assignee, criticalOnly, overdueOnly, assignees]);

  const grouped = useMemo(
    () =>
      folders
        .map((f) => ({ folder: f, items: filtered.filter((i) => i.folder_id === f.id) }))
        .filter((g) => g.items.length > 0 || (folderFilter === ALL && !q && status === ALL && !criticalOnly && !overdueOnly && assignee === ALL)),
    [folders, filtered, folderFilter, q, status, criticalOnly, overdueOnly, assignee],
  );

  const openItem = items.find((i) => i.id === openItemId) ?? null;
  const filtersActive = q || status !== ALL || folderFilter !== ALL || assignee !== ALL || criticalOnly || overdueOnly;

  function setItemParam(id: string | null) {
    const next = new URLSearchParams(params.toString());
    if (id) next.set("item", id);
    else next.delete("item");
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    setOpenItemId(id);
  }

  function toggle(id: string) {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }
  function toggleMany(ids: string[], on: boolean) {
    setSelected((s) => {
      const n = new Set(s);
      ids.forEach((id) => (on ? n.add(id) : n.delete(id)));
      return n;
    });
  }

  /** Add one firm person to (or clear the firm assignees of) the selected items. Locked items follow the locked rules. */
  async function bulkAssign(userId: string | null, label: string) {
    const ids = [...selected];
    const results = await Promise.all(
      ids.map((id) => {
        const firm = selectionFrom(assignees[id]).firm;
        const next = userId ? [...new Set([...firm, userId])] : [];
        return supabase.rpc("set_request_item_assignees", { p_item_id: id, p_side: "firm", p_user_ids: next });
      }),
    );
    const failed = results.filter((r) => r.error);
    if (failed.length === ids.length) return toast.error(friendlyError(failed[0]!.error));
    toast.success(`${label}: ${ids.length - failed.length} item(s)${failed.length ? `, ${failed.length} skipped (locked or not permitted)` : ""}`);
    setSelected(new Set());
    refresh();
  }

  async function bulkUpdate(patch: Record<string, unknown>, label: string) {
    const ids = [...selected];
    const { error, count } = await supabase.from("request_items").update(patch, { count: "exact" }).in("id", ids);
    if (error) return toast.error(friendlyError(error));
    toast.success(`${label}: ${count ?? ids.length} item(s)`);
    setSelected(new Set());
    refresh();
  }

  async function bulkReview(action: "accept" | "not_applicable" | "start_review") {
    const ids = [...selected];
    const { data, error } = await supabase.rpc("bulk_review_items", { p_item_ids: ids, p_action: action, p_note: null });
    if (error) return toast.error(friendlyError(error));
    const skipped = ids.length - Number(data ?? 0);
    toast.success(`${data} item(s) updated${skipped ? `, ${skipped} skipped (not eligible)` : ""}`);
    setSelected(new Set());
    refresh();
  }

  async function issue() {
    if (!confirm("Approve and release the request list to the client? Invited client users will be notified and can start uploading.")) return;
    const { error } = await supabase.rpc("issue_request_list", { p_engagement_id: engagementId });
    if (error) return toast.error(friendlyError(error));
    toast.success("Approved and released to the client");
    refresh();
  }

  async function pullMaster() {
    const { data, error } = await supabase.rpc("pull_master_changes", { p_engagement_id: engagementId, p_item_ids: null });
    if (error) return toast.error(friendlyError(error));
    toast.success(`${data} item(s) updated from the master checklist`);
    refresh();
  }

  function addRequestTo(folderId: string, name: string) {
    setAddFolderId(folderId);
    setAddFolderName(name);
    setAddOpen(true);
  }

  /** Next folder number, e.g. "12 " after "11 Tax", so new folders sort after the template ones. */
  function suggestFolderName() {
    const nums = folders.map((f) => parseInt(f.name, 10)).filter((n) => !Number.isNaN(n));
    return nums.length ? `${String(Math.max(...nums) + 1).padStart(2, "0")} ` : "";
  }

  async function saveFolder(e: React.FormEvent) {
    e.preventDefault();
    const name = folderName.trim();
    if (/^\d+$/.test(name)) return toast.error("Give the folder a name, e.g. 12 Employee Costs");
    if (!name) return;
    const renaming = folderDialog?.mode === "rename" && folderDialog.folder;
    let newId: string | undefined;
    let error;
    if (renaming) {
      ({ error } = await supabase.from("engagement_folders").update({ name }).eq("id", folderDialog!.folder!.id));
    } else {
      const res = await supabase
        .from("engagement_folders")
        .insert({ engagement_id: engagementId, name, sort_order: Math.max(0, ...folders.map((f) => f.sort_order ?? 0)) + 10 })
        .select("id")
        .single();
      error = res.error;
      newId = (res.data as { id: string } | null)?.id;
    }
    if (error) return toast.error(/duplicate|unique/i.test(error.message) ? "A folder with that name already exists" : friendlyError(error));
    setFolderDialog(null);
    toast.success(renaming ? "Folder renamed" : `Folder "${name}" created`);
    refresh();
    if (!renaming && newId && thenAdd) addRequestTo(newId, name);
  }

  async function deleteFolder(f: Folder) {
    if (!confirm(`Delete folder "${f.name}"? It must be empty.`)) return;
    const { error } = await supabase.from("engagement_folders").delete().eq("id", f.id);
    if (error) return toast.error(/foreign key/i.test(error.message) ? "Move or delete the items in this folder first" : friendlyError(error));
    refresh();
  }

  async function addMaster() {
    const { data, error } = await supabase.rpc("add_master_items_to_engagement", {
      p_engagement_id: engagementId,
      p_master_item_ids: [...masterPick],
      p_due_date: null,
    });
    if (error) return toast.error(friendlyError(error));
    toast.success(`${data} standard item(s) added`);
    setMasterOpen(false);
    setMasterPick(new Set());
    refresh();
  }

  const closed = ["completed", "archived", "declined"].includes(engagementStatus);
  const editPerms = (it: RequestItem | null) => ({
    firm: it ? (it.is_locked ? perms.canManage : isTeam) : true,
    client: it ? (it.is_locked ? perms.canManage : canEdit) : true,
    lock: it ? perms.canManage || (it.created_by === userId && isTeam) : true,
  });

  async function submitForApproval(note: string) {
    const { error } = await supabase.rpc("submit_list_for_approval", { p_engagement_id: engagementId, p_note: note || null });
    if (error) return toast.error(friendlyError(error));
    toast.success("Sent to the partner, team lead and managers for approval");
    setApprovalDialog(null);
    refresh();
  }
  async function returnToPreparer(note: string) {
    const { error } = await supabase.rpc("return_list_to_preparer", { p_engagement_id: engagementId, p_note: note });
    if (error) return toast.error(friendlyError(error));
    toast.success("Returned to the preparer with your comments");
    setApprovalDialog(null);
    refresh();
  }

  return (
    <div className="space-y-4">
      {engagementStatus === "draft" ? (
        <Alert variant="info" className="items-center">
          <ListPlus />
          <div className="flex-1">
            <div className="font-medium">Draft request list: preparing</div>
            <div className="text-xs">
              Tailor the items, critical flags, folders, due dates and assignees. When it&apos;s ready, submit it for approval. The client sees nothing until a partner, the team lead or a manager approves and releases it.
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {isTeam ? <Button size="sm" variant={perms.canManage ? "outline" : "default"} onClick={() => setApprovalDialog("submit")}>Submit for approval</Button> : null}
            {perms.canManage ? <Button size="sm" onClick={issue}>Approve &amp; release</Button> : null}
          </div>
        </Alert>
      ) : null}
      {engagementStatus === "awaiting_approval" ? (
        <Alert variant="warning" className="items-center">
          <ListPlus />
          <div className="flex-1">
            <div className="font-medium">Awaiting approval</div>
            <div className="text-xs">
              Submitted{approval?.requestedByName ? ` by ${approval.requestedByName}` : ""}{approval?.requestedAt ? ` on ${fmtDate(approval.requestedAt)}` : ""}.
              {perms.canManage ? " Review the list, then approve to release it to the client or return it with comments." : " A partner, the team lead or a manager will review it."}
            </div>
          </div>
          {perms.canManage ? (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => setApprovalDialog("return")}>Return with comments</Button>
              <Button size="sm" onClick={issue}>Approve &amp; release to client</Button>
            </div>
          ) : null}
        </Alert>
      ) : null}
      {masterUpdates > 0 && canEdit ? (
        <Alert variant="warning" className="items-center">
          <RefreshCw />
          <div className="flex-1 text-sm">
            The master checklist has been updated since this list was created ({masterUpdates} item{masterUpdates === 1 ? "" : "s"} affected). Pulling updates changes titles and descriptions only, never statuses or files.
          </div>
          <Button size="sm" variant="outline" onClick={pullMaster}>Pull changes</Button>
        </Alert>
      ) : null}

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-card p-3 shadow-sm">
        <div className="relative min-w-0 flex-[1_1_16rem]">
          <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search code, title or description" className="pl-9" aria-label="Search items" />
        </div>
        <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap">
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="sm:w-40" aria-label="Filter by status"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All statuses</SelectItem>
              {ITEM_STATUS_ORDER.map((s) => <SelectItem key={s} value={s}>{ITEM_STATUS[s].label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={folderFilter} onValueChange={setFolderFilter}>
            <SelectTrigger className="sm:w-44" aria-label="Filter by folder"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All folders</SelectItem>
              {folders.map((f) => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={assignee} onValueChange={setAssignee}>
            <SelectTrigger className="sm:w-40" aria-label="Filter by assignee"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Anyone</SelectItem>
              <SelectItem value={userId}>Assigned to me</SelectItem>
              <SelectItem value="__unassigned">Unassigned</SelectItem>
              {team.filter((t) => t.id !== userId).map((t) => <SelectItem key={t.id} value={t.id}>{t.full_name}</SelectItem>)}
              {clientUsers.map((t) => <SelectItem key={t.id} value={t.id}>{t.full_name} (client)</SelectItem>)}
            </SelectContent>
          </Select>
          <Button variant={criticalOnly ? "default" : "outline"} size="sm" className="h-9" onClick={() => setCriticalOnly((v) => !v)}>Critical</Button>
          <Button variant={overdueOnly ? "default" : "outline"} size="sm" className="h-9" onClick={() => setOverdueOnly((v) => !v)}>Overdue</Button>
          {filtersActive ? (
            <Button variant="ghost" size="sm" className="h-9" onClick={() => { setQ(""); setStatus(ALL); setFolderFilter(ALL); setAssignee(ALL); setCriticalOnly(false); setOverdueOnly(false); }}>
              <X /> Clear
            </Button>
          ) : null}
        </div>
        {canEdit && !closed ? (
          <div className="flex gap-2">
            <Button size="sm" variant="outline" className="h-9" onClick={() => setMasterOpen(true)} title="Add standard requests from the master checklist">
              <ListPlus /> From template
            </Button>
            <Button size="sm" className="h-9" onClick={() => { setFolderName(suggestFolderName()); setThenAdd(true); setFolderDialog({ mode: "add" }); }}>
              <FolderPlus /> New folder
            </Button>
          </div>
        ) : null}
      </div>

      {/* Bulk bar */}
      {selected.size > 0 ? (
        <div className="sticky top-16 z-20 flex flex-wrap items-center gap-2 rounded-xl border border-primary/25 bg-accent px-3 py-2 shadow-md">
          <span className="text-sm font-semibold text-accent-foreground">{selected.size} selected</span>
          <div className="flex-1" />
          {isTeam ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild><Button size="sm" variant="outline"><UserPlus /> Assign</Button></DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuLabel>Add from the engagement team</DropdownMenuLabel>
                {team.map((t) => (
                  <DropdownMenuItem key={t.id} onSelect={() => bulkAssign(t.id, `Assigned to ${t.full_name}`)}>{t.full_name}</DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => bulkAssign(null, "Firm assignees removed")}>Remove firm assignees</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
          {canEdit ? (
            <>
              <DropdownMenu>
                <DropdownMenuTrigger asChild><Button size="sm" variant="outline"><CalendarDays /> Due date</Button></DropdownMenuTrigger>
                <DropdownMenuContent className="p-3">
                  <DropdownMenuLabel className="px-0">Set due date</DropdownMenuLabel>
                  <div className="flex gap-2" onKeyDown={(e) => e.stopPropagation()}>
                    <Input type="date" value={bulkDue} onChange={(e) => setBulkDue(e.target.value)} />
                    <Button size="sm" disabled={!bulkDue} onClick={() => bulkUpdate({ due_date: bulkDue }, "Due date set")}>Apply</Button>
                  </div>
                </DropdownMenuContent>
              </DropdownMenu>
              <DropdownMenu>
                <DropdownMenuTrigger asChild><Button size="sm" variant="outline">Priority</Button></DropdownMenuTrigger>
                <DropdownMenuContent>
                  {PRIORITY_ORDER.map((p) => (
                    <DropdownMenuItem key={p} onSelect={() => bulkUpdate({ priority: p }, `Priority ${PRIORITY[p].label}`)}>{PRIORITY[p].label}</DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <DropdownMenu>
                <DropdownMenuTrigger asChild><Button size="sm" variant="outline">Move to folder</Button></DropdownMenuTrigger>
                <DropdownMenuContent>
                  {folders.map((f) => (
                    <DropdownMenuItem key={f.id} onSelect={() => bulkUpdate({ folder_id: f.id }, `Moved to ${f.name}`)}>{f.name}</DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          ) : null}
          {perms.canAccept ? (
            <>
              <Button size="sm" variant="outline" onClick={() => bulkReview("not_applicable")}><MinusCircle /> Mark N/A</Button>
              <Button size="sm" variant="success" onClick={() => bulkReview("accept")}><CheckCircle2 /> Accept</Button>
            </>
          ) : isTeam ? (
            <Button size="sm" variant="outline" onClick={() => bulkReview("start_review")}>Start review</Button>
          ) : null}
          <Button size="icon-sm" variant="ghost" onClick={() => setSelected(new Set())} aria-label="Clear selection"><X /></Button>
        </div>
      ) : null}

      {/* Groups */}
      <div className="space-y-3">
        {grouped.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border-strong bg-card p-10 text-center text-sm text-muted-foreground">No items match these filters.</div>
        ) : null}
        {grouped.map(({ folder, items: rows }) => {
          const isCollapsed = collapsed.has(folder.id);
          const ids = rows.map((r) => r.id);
          const allSel = ids.length > 0 && ids.every((id) => selected.has(id));
          const someSel = ids.some((id) => selected.has(id));
          const done = rows.filter((r) => r.status === "accepted").length;
          const applicable = rows.filter((r) => r.status !== "not_applicable").length;
          return (
            <section key={folder.id} className="overflow-hidden rounded-xl border bg-card shadow-sm">
              <header className="flex items-center gap-3 border-b bg-muted/50 px-3 py-2.5">
                <Checkbox
                  checked={allSel ? true : someSel ? "indeterminate" : false}
                  onCheckedChange={(v) => toggleMany(ids, v === true)}
                  aria-label={`Select all in ${folder.name}`}
                  disabled={ids.length === 0}
                />
                <button
                  className="flex min-w-0 flex-1 items-center gap-2 text-left font-display text-sm font-semibold text-foreground"
                  onClick={() => setCollapsed((s) => { const n = new Set(s); if (n.has(folder.id)) n.delete(folder.id); else n.add(folder.id); return n; })}
                  aria-expanded={!isCollapsed}
                >
                  {isCollapsed ? <ChevronRight className="size-4 shrink-0 text-muted-foreground" /> : <ChevronDown className="size-4 shrink-0 text-muted-foreground" />}
                  <span className="min-w-0">{folder.name}</span>
                  <span className="shrink-0 rounded-full border bg-card px-2 font-sans text-xs leading-5 font-medium text-muted-foreground tabular">{done}/{applicable} accepted</span>
                </button>
                {canEdit && !closed ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 bg-card"
                    onClick={() => addRequestTo(folder.id, folder.name)}
                    aria-label={`Add a request to ${folder.name}`}
                  >
                    <Plus /> <span>Add<span className="hidden sm:inline"> request</span></span>
                  </Button>
                ) : null}
                {canEdit && !closed ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button size="icon-sm" variant="ghost" aria-label={`Folder actions for ${folder.name}`}><MoreHorizontal /></Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => { setFolderName(folder.name); setFolderDialog({ mode: "rename", folder }); }}><Pencil /> Rename</DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem variant="destructive" onSelect={() => deleteFolder(folder)}><Trash2 /> Delete folder</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : null}
              </header>
              {!isCollapsed ? (
                rows.length === 0 ? (
                  <div className="flex flex-wrap items-center gap-3 px-4 py-4 text-sm text-muted-foreground">
                    No requests in this folder yet.
                    {canEdit && !closed ? (
                      <Button size="sm" onClick={() => addRequestTo(folder.id, folder.name)}><Plus /> Add the first request</Button>
                    ) : null}
                  </div>
                ) : (
                  <ul className="divide-y">
                    <li aria-hidden className="hidden items-center gap-3 bg-card px-3 py-1.5 md:flex">
                      <span className="w-4 shrink-0" />
                      <span className="eyebrow grid flex-1 gap-3 text-[10px] text-subtle-foreground md:grid-cols-[5.5rem_minmax(0,1fr)_8.5rem_7rem_6.5rem_4.5rem]">
                        <span>Code</span><span>Request</span><span>Status</span><span>Assigned</span><span>Due</span><span>Activity</span>
                      </span>
                    </li>
                    {rows.map((i) => {
                      const overdue = isOverdue(i.due_date, i.status);
                      const rowAssignees = assignees[i.id];
                      return (
                        <li key={i.id} className={cn("flex items-start gap-3 px-3 py-3 transition-colors hover:bg-accent/30 md:items-center", selected.has(i.id) && "bg-accent/60 hover:bg-accent/60")}>
                          <Checkbox className="mt-1 md:mt-0" checked={selected.has(i.id)} onCheckedChange={() => toggle(i.id)} aria-label={`Select ${i.code}`} />
                          <button className="grid min-w-0 flex-1 gap-1 text-left md:grid-cols-[5.5rem_minmax(0,1fr)_8.5rem_7rem_6.5rem_4.5rem] md:items-center md:gap-3" onClick={() => setItemParam(i.id)}>
                            <span className="font-mono text-[11px] font-medium text-muted-foreground">{i.code}</span>
                            <span className="min-w-0">
                              <span className="flex min-w-0 items-center gap-1.5">
                                {i.is_locked ? <LockBadge /> : null}
                                <span className="truncate text-sm font-medium text-foreground">{i.title}</span>
                              </span>
                              <span className="mt-1 flex flex-wrap gap-1 md:hidden">
                                <ItemStatusBadge status={i.status} />
                                {i.is_critical ? <CriticalBadge waived={i.is_waived} /> : null}
                              </span>
                              {sampleProgress[i.id] ? (
                                <Badge variant="info" className="mt-1 rounded-md">
                                  <ListChecks />
                                  Samples {sampleProgress[i.id]!.received}/{sampleProgress[i.id]!.total} received
                                </Badge>
                              ) : null}
                              {i.is_critical || i.priority !== "normal" || i.file_class ? (
                                <span className="mt-1 hidden flex-wrap gap-1 md:flex">
                                  {i.is_critical ? <CriticalBadge waived={i.is_waived} /> : null}
                                  {!(i.is_critical && i.priority === "important") ? <PriorityBadge priority={i.priority} /> : null}
                                  {i.file_class ? (
                                    <Badge variant="outline" title={FILE_CLASS[i.file_class].description}>
                                      {FILE_CLASS[i.file_class].short}
                                    </Badge>
                                  ) : null}
                                </span>
                              ) : null}
                            </span>
                            <span className="hidden md:block"><ItemStatusBadge status={i.status} /></span>
                            <span className="hidden items-center gap-2 text-xs md:flex">
                              <AssigneeAvatars assignees={rowAssignees} people={people} />
                            </span>
                            <span className={cn("text-xs tabular", overdue ? "font-semibold text-danger" : "text-muted-foreground")}>
                              {i.due_date ? `${overdue ? "Overdue · " : ""}${fmtDate(i.due_date, "d MMM yy")}` : "No due date"}
                            </span>
                            <span className="hidden items-center gap-3 text-xs text-muted-foreground md:flex">
                              <span className="flex items-center gap-1" title="Submitted files"><Paperclip className="size-3.5" />{fileCounts[i.id] ?? 0}</span>
                              <span className="flex items-center gap-1" title="Comments"><MessageSquare className="size-3.5" />{commentCounts[i.id] ?? 0}</span>
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )
              ) : null}
            </section>
          );
        })}
      </div>

      <ItemDetailSheet
        item={openItem}
        open={Boolean(openItem)}
        onOpenChange={(o) => !o && setItemParam(null)}
        audience="team"
        userId={userId}
        engagementStatus={engagementStatus}
        perms={perms}
        team={team}
        clientUsers={clientUsers}
        folders={folders}
        upload={upload}
        onChanged={refresh}
        onEdit={(it) => setEditItem(it)}
      />

      <ItemFormDialog
        open={addOpen || Boolean(editItem)}
        onOpenChange={(o) => { if (!o) { setAddOpen(false); setEditItem(null); setAddFolderId(undefined); setAddFolderName(undefined); } }}
        engagementId={engagementId}
        folders={folders}
        team={team}
        clientUsers={clientUsers}
        assignees={editItem ? assignees[editItem.id] : []}
        canChangeAssignees={editPerms(editItem)}
        item={editItem}
        defaultFolderId={addFolderId}
        defaultFolderName={addFolderName}
        onSaved={refresh}
      />

      <Dialog open={Boolean(approvalDialog)} onOpenChange={(o) => { if (!o) { setApprovalDialog(null); setApprovalNote(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{approvalDialog === "submit" ? "Submit for approval" : "Return to preparer"}</DialogTitle>
            <DialogDescription>
              {approvalDialog === "submit"
                ? "The partners, the team lead and managers are notified. The list is locked for editing until they approve it or return it."
                : "Tell the preparer what to change. The list goes back to draft so they can edit it."}
            </DialogDescription>
          </DialogHeader>
          <Textarea value={approvalNote} onChange={(e) => setApprovalNote(e.target.value)} rows={3} placeholder={approvalDialog === "submit" ? "Optional note for the reviewer" : "Required"} autoFocus />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setApprovalDialog(null)}>Cancel</Button>
            <Button
              disabled={approvalDialog === "return" && !approvalNote.trim()}
              onClick={() => (approvalDialog === "submit" ? submitForApproval(approvalNote) : returnToPreparer(approvalNote))}
            >
              {approvalDialog === "submit" ? "Submit for approval" : "Return with comments"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(folderDialog)} onOpenChange={(o) => !o && setFolderDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{folderDialog?.mode === "rename" ? "Rename folder" : "New folder"}</DialogTitle>
            <DialogDescription>
              Folders are the main sections of the request list, such as Permanent File, Revenue or Employee Costs. You add the individual requests under each folder.
              They also set the document storage structure.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={saveFolder} className="space-y-4">
            <Input value={folderName} onChange={(e) => setFolderName(e.target.value)} placeholder="e.g. 12 Employee Costs" autoFocus maxLength={100} aria-label="Folder name" />
            {folderDialog?.mode === "add" ? (
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={thenAdd} onCheckedChange={(v) => setThenAdd(v === true)} /> Add a request to it now
              </label>
            ) : null}
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setFolderDialog(null)}>Cancel</Button>
              <Button type="submit">{folderDialog?.mode === "add" ? "Create folder" : "Save"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={masterOpen} onOpenChange={setMasterOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Add standard items</DialogTitle>
            <DialogDescription>Items from the master checklist that are not yet on this request list.</DialogDescription>
          </DialogHeader>
          <Input value={masterQ} onChange={(e) => setMasterQ(e.target.value)} placeholder="Search master checklist" />
          <ul className="max-h-[50vh] divide-y overflow-y-auto rounded-md border">
            {masterOptions
              .filter((m) => `${m.code} ${m.title} ${m.category}`.toLowerCase().includes(masterQ.toLowerCase()))
              .map((m) => (
                <li key={m.id}>
                  <label className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-muted/40">
                    <Checkbox
                      checked={masterPick.has(m.id)}
                      onCheckedChange={(v) => setMasterPick((s) => { const n = new Set(s); if (v === true) n.add(m.id); else n.delete(m.id); return n; })}
                    />
                    <span className="w-16 font-mono text-xs text-muted-foreground">{m.code}</span>
                    <span className="min-w-0 flex-1 truncate text-sm">{m.title}</span>
                    {m.is_critical ? <CriticalBadge /> : null}
                    <span className="hidden text-xs text-muted-foreground sm:block">{m.category}</span>
                  </label>
                </li>
              ))}
            {masterOptions.length === 0 ? <li className="p-4 text-sm text-muted-foreground">Every master item is already on this list.</li> : null}
          </ul>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setMasterOpen(false)}>Cancel</Button>
            <Button disabled={masterPick.size === 0} onClick={addMaster}>Add {masterPick.size || ""} item{masterPick.size === 1 ? "" : "s"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
