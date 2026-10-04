"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  CalendarDays, CheckCircle2, Download, Eye, FileText, FolderOpen, History, Loader2, MessageSquareWarning,
  MinusCircle, Pencil, RotateCcw, Send, ShieldAlert, ShieldOff, Trash2, User,
} from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { CriticalBadge, ItemStatusBadge, PriorityBadge } from "@/components/status-badge";
import { CommentThread } from "@/components/items/comment-thread";
import { FileUploader } from "@/components/items/file-uploader";
import { SampleSchedulePanel } from "@/components/items/sample-schedule";
import { removeDraftFile } from "@/lib/actions/uploads";
import { createClient } from "@/lib/supabase/client";
import { fmtDate, fmtDateTime, isOverdue } from "@/lib/dates";
import { ITEM_STATUS } from "@/lib/constants";
import type { EngagementStatus, Folder, ItemFile, ItemStatus, Person, RequestItem, ReviewAction, StatusHistory } from "@/lib/types";
import { cn, formatBytes, friendlyError } from "@/lib/utils";

const OPEN_ENGAGEMENT: EngagementStatus[] = ["pre_engagement", "acceptance_review", "accepted", "in_progress"];
const UPLOADABLE: ItemStatus[] = ["requested", "queried", "submitted"];
const PREVIEWABLE = /^(application\/pdf|image\/(png|jpe?g|gif|webp))$/i;

export interface ItemPerms {
  canManage: boolean;
  /** Edit the request list (lead/manager, or any team member while in draft) */
  canEdit?: boolean;
  canAccept: boolean;
  isLead: boolean;
}

type NoteAction = { action: ReviewAction | "waive"; title: string; description: string; required: boolean; cta: string } | null;

export function ItemDetailSheet({
  item,
  open,
  onOpenChange,
  audience,
  userId,
  engagementStatus,
  perms,
  team,
  folders,
  upload,
  onChanged,
  onEdit,
}: {
  item: RequestItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  audience: "team" | "client";
  userId: string;
  engagementStatus: EngagementStatus;
  perms: ItemPerms;
  team: Person[];
  folders: Folder[];
  upload: { allowedExtensions: string[]; maxFileMb: number };
  onChanged: () => void;
  onEdit?: (item: RequestItem) => void;
}) {
  const supabase = createClient();
  const [current, setCurrent] = useState<RequestItem | null>(item);
  const [files, setFiles] = useState<ItemFile[]>([]);
  const [hasSchedule, setHasSchedule] = useState(false);
  const [tab, setTab] = useState("files");
  const [history, setHistory] = useState<StatusHistory[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [submitNote, setSubmitNote] = useState("");
  const [noteAction, setNoteAction] = useState<NoteAction>(null);
  const [commentsKey, setCommentsKey] = useState(0);

  useEffect(() => setCurrent(item), [item]);

  const load = useCallback(async () => {
    if (!item) return;
    const [{ data: fresh }, { data: f }, h] = await Promise.all([
      supabase.from("request_items").select("*").eq("id", item.id).maybeSingle(),
      supabase.from("request_item_files").select("*").eq("request_item_id", item.id).order("version_no", { ascending: false }).order("uploaded_at"),
      audience === "team"
        ? supabase.from("status_history").select("*").eq("entity_type", "request_item").eq("entity_id", item.id).order("changed_at", { ascending: false })
        : Promise.resolve({ data: [] }),
    ]);
    if (fresh) setCurrent(fresh as RequestItem);
    setFiles((f as ItemFile[]) ?? []);
    setHistory((h.data as StatusHistory[]) ?? []);
    const { count } = await supabase.from("sample_schedules").select("id", { count: "exact", head: true }).eq("request_item_id", item.id);
    setHasSchedule((count ?? 0) > 0);
  }, [audience, item, supabase]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  useEffect(() => {
    if (!open || !item) return;
    const ch = supabase
      .channel(`item:${item.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "request_item_files", filter: `request_item_id=eq.${item.id}` }, () => load())
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "request_items", filter: `id=eq.${item.id}` }, () => load())
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [item, load, open, supabase]);

  const clientFiles = useMemo(() => files.filter((f) => f.kind === "client_submission"), [files]);
  const firmFiles = useMemo(() => files.filter((f) => f.kind === "firm_document" && f.upload_state === "stored"), [files]);
  const drafts = useMemo(() => clientFiles.filter((f) => !f.submitted_at && f.upload_state === "stored"), [clientFiles]);
  const versions = useMemo(() => {
    const map = new Map<number, ItemFile[]>();
    clientFiles.filter((f) => f.submitted_at).forEach((f) => map.set(f.version_no, [...(map.get(f.version_no) ?? []), f]));
    return [...map.entries()].sort((a, b) => b[0] - a[0]);
  }, [clientFiles]);

  if (!current) return null;
  const it = current;
  const people = new Map(team.map((t) => [t.id, t]));
  const folder = folders.find((f) => f.id === it.folder_id);
  const engagementOpen = OPEN_ENGAGEMENT.includes(engagementStatus);
  const canUpload = engagementOpen && UPLOADABLE.includes(it.status);
  const overdue = isOverdue(it.due_date, it.status);

  async function refreshAll() {
    await load();
    setCommentsKey((k) => k + 1);
    onChanged();
  }

  async function review(action: ReviewAction, text?: string) {
    setBusy(true);
    const { error } = await supabase.rpc("review_item", { p_item_id: it.id, p_action: action, p_note: text || null });
    setBusy(false);
    if (error) return toast.error(friendlyError(error));
    toast.success(
      { start_review: "Marked as under review", accept: "Item accepted", query: "Query sent to client", not_applicable: "Marked not applicable", reopen: "Item reopened" }[action],
    );
    setNoteAction(null);
    setNote("");
    refreshAll();
  }

  async function waive(reason: string) {
    setBusy(true);
    const { error } = await supabase.rpc("waive_item", { p_item_id: it.id, p_reason: reason });
    setBusy(false);
    if (error) return toast.error(friendlyError(error));
    toast.success("Critical item waived");
    setNoteAction(null);
    setNote("");
    refreshAll();
  }

  async function unwaive() {
    setBusy(true);
    const { error } = await supabase.rpc("unwaive_item", { p_item_id: it.id });
    setBusy(false);
    if (error) return toast.error(friendlyError(error));
    toast.success("Waiver removed");
    refreshAll();
  }

  async function submit() {
    setBusy(true);
    const { data, error } = await supabase.rpc("submit_item", { p_item_id: it.id, p_note: submitNote.trim() || null });
    setBusy(false);
    if (error) return toast.error(friendlyError(error));
    toast.success(audience === "client" ? "Submitted to the engagement team. Thank you!" : `Submitted as version ${data}`);
    setSubmitNote("");
    refreshAll();
  }

  async function removeDraft(fileId: string) {
    const res = await removeDraftFile(fileId);
    if (!res.ok) return toast.error(res.error);
    load();
  }

  async function del() {
    if (!confirm(`Delete ${it.code} "${it.title}"? This cannot be undone.`)) return;
    const { error } = await supabase.rpc("delete_request_item", { p_item_id: it.id });
    if (error) return toast.error(friendlyError(error));
    toast.success("Item deleted");
    onOpenChange(false);
    onChanged();
  }

  const fileRow = (f: ItemFile, draft = false) => (
    <li key={f.id} className="flex items-center gap-3 rounded-md border bg-card px-3 py-2">
      <FileText className="size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{f.file_name}</div>
        <div className="text-xs text-muted-foreground">
          {formatBytes(f.size_bytes)} · {fmtDateTime(f.uploaded_at)}
          {audience === "team" && people.get(f.uploaded_by) ? ` · ${people.get(f.uploaded_by)!.full_name}` : ""}
        </div>
      </div>
      {PREVIEWABLE.test(f.mime_type ?? "") && !draft ? (
        <Button asChild variant="ghost" size="icon-sm" aria-label={`Preview ${f.file_name}`}>
          <a href={`/api/files/${f.id}?inline=1`} target="_blank" rel="noopener">
            <Eye />
          </a>
        </Button>
      ) : null}
      <Button asChild variant="ghost" size="icon-sm" aria-label={`Download ${f.file_name}`}>
        <a href={`/api/files/${f.id}`}>
          <Download />
        </a>
      </Button>
      {draft ? (
        <Button variant="ghost" size="icon-sm" onClick={() => removeDraft(f.id)} aria-label={`Remove ${f.file_name}`}>
          <Trash2 className="text-destructive" />
        </Button>
      ) : null}
    </li>
  );

  const teamActions = audience === "team" && engagementStatus !== "archived" ? (
    <div className="flex flex-wrap gap-2">
      {it.status === "submitted" ? (
        <Button size="sm" variant="outline" disabled={busy} onClick={() => review("start_review")}>
          <Eye /> Start review
        </Button>
      ) : null}
      {(it.status === "submitted" || it.status === "under_review") && perms.canAccept ? (
        <Button size="sm" variant="success" disabled={busy} onClick={() => review("accept")}>
          <CheckCircle2 /> Accept
        </Button>
      ) : null}
      {["submitted", "under_review", "accepted"].includes(it.status) ? (
        <Button
          size="sm"
          variant="warning"
          disabled={busy}
          onClick={() =>
            setNoteAction({
              action: "query",
              title: "Query this item",
              description: "The item goes back to the client with your note, which they will see. Be specific about what is missing.",
              required: true,
              cta: "Send query",
            })
          }
        >
          <MessageSquareWarning /> Query
        </Button>
      ) : null}
      {!it.is_critical && it.status !== "not_applicable" && perms.canAccept ? (
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() =>
            setNoteAction({
              action: "not_applicable",
              title: "Mark as not applicable",
              description: "The item is excluded from completion percentages. The reason is shared with the client.",
              required: false,
              cta: "Mark N/A",
            })
          }
        >
          <MinusCircle /> Not applicable
        </Button>
      ) : null}
      {(it.status === "not_applicable" || it.status === "accepted") && perms.canAccept ? (
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => review("reopen")}>
          <RotateCcw /> Reopen
        </Button>
      ) : null}
      {it.is_critical && perms.isLead ? (
        it.is_waived ? (
          <Button size="sm" variant="ghost" disabled={busy} onClick={unwaive}>
            <ShieldAlert /> Remove waiver
          </Button>
        ) : it.status !== "accepted" ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() =>
              setNoteAction({
                action: "waive",
                title: "Waive critical item",
                description: "Waiving lets the engagement pass the acceptance gate without this item. A reason is mandatory and is recorded in the audit trail.",
                required: true,
                cta: "Waive item",
              })
            }
          >
            <ShieldOff /> Waive
          </Button>
        ) : null
      ) : null}
    </div>
  ) : null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-2xl">
        <SheetHeader>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="font-mono">{it.code}</span>
            <ItemStatusBadge status={it.status} audience={audience} />
            {it.is_critical ? <CriticalBadge waived={it.is_waived} audience={audience} /> : null}
            {audience === "team" && !(it.is_critical && it.priority === "high") ? <PriorityBadge priority={it.priority} /> : null}
            {overdue ? <Badge variant="danger">Overdue</Badge> : null}
          </div>
          <SheetTitle className="text-lg leading-snug">{it.title}</SheetTitle>
          <SheetDescription className="sr-only">Request item details, files and comments</SheetDescription>
          <div className="flex flex-wrap gap-x-5 gap-y-1 pt-1 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <FolderOpen className="size-3.5" /> {folder?.name ?? "—"}
            </span>
            <span className={cn("flex items-center gap-1", overdue && "font-medium text-destructive")}>
              <CalendarDays className="size-3.5" /> Due {fmtDate(it.due_date)}
            </span>
            {audience === "team" ? (
              <span className="flex items-center gap-1">
                <User className="size-3.5" /> {it.assignee_id ? people.get(it.assignee_id)?.full_name ?? "Assigned" : "Unassigned"}
              </span>
            ) : null}
          </div>
        </SheetHeader>

        <div className="flex-1 space-y-5 overflow-y-auto p-5">
          {it.guidance ? (
            <div className="rounded-lg bg-muted/60 p-3 text-sm">
              <div className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">What we need</div>
              <p className="whitespace-pre-wrap">{it.guidance}</p>
              {it.expected_file_types.length ? (
                <p className="mt-2 text-xs text-muted-foreground">Expected format: {it.expected_file_types.map((t) => t.toUpperCase()).join(", ")}</p>
              ) : null}
            </div>
          ) : null}

          {it.status === "queried" && audience === "client" ? (
            <Alert variant="warning">
              <MessageSquareWarning />
              <div>The engagement team has a query on this item. See the comments below, then upload the updated documents and submit again.</div>
            </Alert>
          ) : null}
          {it.is_waived && audience === "team" ? (
            <Alert variant="info">
              <ShieldOff />
              <div>
                <div className="font-medium">Waived by the engagement lead</div>
                <div className="text-xs">{it.waiver_reason}</div>
              </div>
            </Alert>
          ) : null}

          {teamActions}
          {audience === "team" && (perms.canEdit ?? perms.canManage) ? (
            <div className="flex gap-2">
              {onEdit ? (
                <Button size="sm" variant="ghost" onClick={() => onEdit(it)}>
                  <Pencil /> Edit details
                </Button>
              ) : null}
              <Button size="sm" variant="ghost" className="text-destructive" onClick={del}>
                <Trash2 /> Delete
              </Button>
            </div>
          ) : null}

          <Separator />

          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="flex-wrap">
              <TabsTrigger value="files">Files {clientFiles.filter((f) => f.submitted_at).length ? `(${clientFiles.filter((f) => f.submitted_at).length})` : ""}</TabsTrigger>
              {audience === "team" || hasSchedule ? <TabsTrigger value="samples">Sample schedule</TabsTrigger> : null}
              <TabsTrigger value="comments">Comments</TabsTrigger>
              {audience === "team" ? (
                <TabsTrigger value="history">
                  <History className="size-3.5" /> History
                </TabsTrigger>
              ) : null}
            </TabsList>

            <TabsContent value="files" className="space-y-4 pt-4">
              {firmFiles.length || (audience === "team" && engagementStatus !== "archived") ? (
                <div className="space-y-2 rounded-lg border bg-accent/30 p-3">
                  <div className="text-sm font-semibold">{audience === "team" ? "Shared with the client by the firm" : "From the engagement team"}</div>
                  {audience === "team" ? (
                    <p className="text-xs text-muted-foreground">e.g. your sample selection or a template to complete. The client sees these as soon as the list is released.</p>
                  ) : null}
                  {firmFiles.length ? <ul className="space-y-2">{firmFiles.map((f) => fileRow(f, audience === "team"))}</ul> : null}
                  {audience === "team" ? (
                    <FileUploader itemId={it.id} kind="firm_document" allowedExtensions={upload.allowedExtensions} maxFileMb={upload.maxFileMb} onUploaded={load} compact label="Share a document with the client" />
                  ) : null}
                </div>
              ) : null}
              {canUpload ? (
                <div className="space-y-3">
                  <FileUploader itemId={it.id} allowedExtensions={upload.allowedExtensions} maxFileMb={upload.maxFileMb} onUploaded={load} />
                  {drafts.length ? (
                    <div className="space-y-2 rounded-lg border border-info/30 bg-info-soft/40 p-3">
                      <div className="text-sm font-medium">Ready to submit ({drafts.length})</div>
                      <ul className="space-y-2">{drafts.map((f) => fileRow(f, true))}</ul>
                      <Textarea
                        value={submitNote}
                        onChange={(e) => setSubmitNote(e.target.value)}
                        rows={2}
                        placeholder="Optional note for the engagement team (e.g. why a document differs from what was requested)"
                      />
                      <Button onClick={submit} disabled={busy} className="w-full sm:w-auto">
                        {busy ? <Loader2 className="animate-spin" /> : <Send />}
                        {it.status === "submitted" ? "Add to current submission" : "Submit to engagement team"}
                      </Button>
                    </div>
                  ) : null}
                </div>
              ) : !engagementOpen ? (
                <p className="text-sm text-muted-foreground">Uploads are closed for this engagement.</p>
              ) : it.status === "under_review" ? (
                <p className="text-sm text-muted-foreground">The engagement team is reviewing this item. You can still add comments.</p>
              ) : null}

              {versions.length === 0 ? (
                <p className="text-sm text-muted-foreground">No files submitted yet.</p>
              ) : (
                versions.map(([v, list], idx) => (
                  <div key={v} className="space-y-2">
                    <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                      Version {v}
                      {idx === 0 ? <Badge variant="info">Latest</Badge> : <Badge variant="muted">Superseded</Badge>}
                      <span className="font-normal">· submitted {fmtDateTime(list[0]!.submitted_at)}</span>
                    </div>
                    <ul className={cn("space-y-2", idx > 0 && "opacity-75")}>{list.map((f) => fileRow(f))}</ul>
                  </div>
                ))
              )}
            </TabsContent>

            <TabsContent value="samples" className="pt-4">
              {tab === "samples" ? (
                <SampleSchedulePanel
                  itemId={it.id}
                  audience={audience}
                  userId={userId}
                  team={team}
                  engagementStatus={engagementStatus}
                  upload={upload}
                  canManageSchedule={audience === "team" && engagementStatus !== "archived"}
                />
              ) : null}
            </TabsContent>

            <TabsContent value="comments" className="pt-4">
              <CommentThread itemId={it.id} userId={userId} audience={audience} team={team} refreshKey={commentsKey} />
            </TabsContent>

            {audience === "team" ? (
              <TabsContent value="history" className="pt-4">
                <ol className="space-y-3 border-l pl-4">
                  {history.map((h) => (
                    <li key={h.id} className="relative text-sm">
                      <span className="absolute top-1.5 -left-[21px] size-2.5 rounded-full border-2 border-card bg-primary" />
                      <div>
                        <span className="font-medium">{ITEM_STATUS[h.to_status as ItemStatus]?.label ?? h.to_status}</span>
                        {h.from_status ? <span className="text-muted-foreground"> from {ITEM_STATUS[h.from_status as ItemStatus]?.label ?? h.from_status}</span> : null}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {fmtDateTime(h.changed_at)}
                        {h.changed_by ? ` · ${people.get(h.changed_by)?.full_name ?? "Client"}` : ""}
                      </div>
                      {h.note ? <div className="mt-1 text-xs whitespace-pre-wrap">{h.note}</div> : null}
                    </li>
                  ))}
                </ol>
              </TabsContent>
            ) : null}
          </Tabs>
        </div>

        <Dialog open={Boolean(noteAction)} onOpenChange={(o) => !o && setNoteAction(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{noteAction?.title}</DialogTitle>
              <DialogDescription>{noteAction?.description}</DialogDescription>
            </DialogHeader>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={4}
              placeholder={noteAction?.required ? "Required" : "Optional"}
              autoFocus
            />
            <DialogFooter>
              <Button variant="ghost" onClick={() => setNoteAction(null)}>
                Cancel
              </Button>
              <Button
                disabled={busy || (noteAction?.required && !note.trim())}
                onClick={() => (noteAction?.action === "waive" ? waive(note) : review(noteAction!.action as ReviewAction, note))}
              >
                {noteAction?.cta}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </SheetContent>
    </Sheet>
  );
}
