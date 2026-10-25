"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, ClipboardCopy, ClipboardPaste, Download, FileText, MessageSquare, MessageSquareWarning, MinusCircle, Paperclip, RotateCcw, Send, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CommentThread } from "@/components/items/comment-thread";
import { SampleInput } from "@/components/items/sample-input";
import { FileUploader } from "@/components/items/file-uploader";
import { removeDraftFile } from "@/lib/actions/uploads";
import { createClient } from "@/lib/supabase/client";
import { MAX_SAMPLE_COLUMNS, MAX_SAMPLE_LINES, SAMPLE_STATUS } from "@/lib/constants";
import { buildPreview } from "@/lib/sample-parse";
import type { EngagementStatus, ItemFile, Person, SampleLine, SampleLineStatus, SampleSchedule as Schedule } from "@/lib/types";
import { cn, formatBytes, friendlyError } from "@/lib/utils";

const OPEN: EngagementStatus[] = ["pre_engagement", "acceptance_review", "accepted", "in_progress"];
type Filter = "all" | SampleLineStatus;

export function SampleSchedulePanel({
  itemId,
  audience,
  userId,
  team,
  engagementStatus,
  upload,
  canManageSchedule,
  canComment = true,
}: {
  itemId: string;
  audience: "team" | "client";
  userId: string;
  team: Person[];
  engagementStatus: EngagementStatus;
  upload: { allowedExtensions: string[]; maxFileMb: number };
  canManageSchedule: boolean;
  /** False for read-only viewers of the engagement */
  canComment?: boolean;
}) {
  const supabase = createClient();
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [lines, setLines] = useState<SampleLine[]>([]);
  const [files, setFiles] = useState<ItemFile[]>([]);
  const [commentCounts, setCommentCounts] = useState<Record<string, number>>({});
  const [loaded, setLoaded] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<string | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [hasHeader, setHasHeader] = useState(true);
  const [title, setTitle] = useState("");
  const [instructions, setInstructions] = useState("");
  const [noteDialog, setNoteDialog] = useState<{ status: SampleLineStatus; ids: string[]; required: boolean } | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const team_ = audience === "team";
  const open = OPEN.includes(engagementStatus);

  const load = useCallback(async () => {
    const { data: s } = await supabase.from("sample_schedules").select("*").eq("request_item_id", itemId).maybeSingle();
    setSchedule((s as Schedule) ?? null);
    if (s) {
      const [{ data: l }, { data: f }, { data: c }] = await Promise.all([
        supabase.from("sample_lines").select("*").eq("schedule_id", s.id).order("line_no"),
        supabase.from("request_item_files").select("*").eq("request_item_id", itemId).eq("kind", "sample_support").eq("upload_state", "stored").order("uploaded_at"),
        supabase.from("comments").select("sample_line_id").eq("request_item_id", itemId).not("sample_line_id", "is", null),
      ]);
      setLines((l as SampleLine[]) ?? []);
      setFiles((f as ItemFile[]) ?? []);
      setCommentCounts(((c as { sample_line_id: string }[]) ?? []).reduce<Record<string, number>>((a, r) => ((a[r.sample_line_id] = (a[r.sample_line_id] ?? 0) + 1), a), {}));
    } else {
      setLines([]);
    }
    setLoaded(true);
  }, [itemId, supabase]);

  useEffect(() => {
    load();
    const ch = supabase
      .channel(`samples:${itemId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "sample_lines", filter: `request_item_id=eq.${itemId}` }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "request_item_files", filter: `request_item_id=eq.${itemId}` }, () => load())
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [itemId, load, supabase]);

  const counts = useMemo(() => {
    const c: Record<SampleLineStatus, number> = { outstanding: 0, provided: 0, received: 0, queried: 0, not_applicable: 0 };
    lines.forEach((l) => c[l.status]++);
    return c;
  }, [lines]);
  const applicable = lines.length - counts.not_applicable;
  const visible = lines.filter((l) => filter === "all" || l.status === filter);
  const filesByLine = useMemo(() => {
    const m: Record<string, ItemFile[]> = {};
    files.forEach((f) => { if (f.sample_line_id) (m[f.sample_line_id] ??= []).push(f); });
    return m;
  }, [files]);

  const preview = useMemo(() => buildPreview(pasteText, hasHeader, schedule?.columns), [pasteText, hasHeader, schedule]);

  async function savePaste() {
    if (preview.body.length === 0) return toast.error("Nothing to add. Paste at least one line under the headings.");
    if (preview.body.length > MAX_SAMPLE_LINES) return toast.error(`At most ${MAX_SAMPLE_LINES.toLocaleString()} lines at a time`);
    setBusy(true);
    const rows = preview.body.map((r) => r.slice(0, MAX_SAMPLE_COLUMNS));
    const { error, data } = schedule
      ? await supabase.rpc("add_sample_lines", { p_schedule_id: schedule.id, p_rows: rows })
      : await supabase.rpc("create_sample_schedule", {
          p_item_id: itemId, p_columns: preview.header, p_rows: rows,
          p_title: title || null, p_instructions: instructions || null,
        });
    setBusy(false);
    if (error) return toast.error(friendlyError(error));
    toast.success(schedule ? `${data} line(s) added` : "Sample schedule created. The client can now see it.");
    setPasteOpen(false);
    setPasteText("");
    load();
  }

  async function setStatus(status: SampleLineStatus, ids: string[], text?: string) {
    setBusy(true);
    const { data, error } = await supabase.rpc("set_sample_line_status", { p_line_ids: ids, p_status: status, p_note: text || null });
    setBusy(false);
    if (error) return toast.error(friendlyError(error));
    toast.success(`${data} line(s) updated`);
    setSelected(new Set());
    setNoteDialog(null);
    setNote("");
    load();
  }

  async function deleteLine(id: string) {
    const { error } = await supabase.rpc("delete_sample_line", { p_line_id: id });
    if (error) return toast.error(friendlyError(error));
    load();
  }

  async function deleteSchedule() {
    if (!schedule) return;
    const { error } = await supabase.rpc("delete_sample_schedule", { p_schedule_id: schedule.id });
    if (error) return toast.error(friendlyError(error));
    toast.success("Sample schedule removed");
    load();
  }

  async function removeFile(id: string) {
    const res = await removeDraftFile(id);
    if (!res.ok) return toast.error(res.error);
    load();
  }

  async function copyTsv() {
    if (!schedule) return;
    const head = ["#", ...schedule.columns, "Status", "Files", "Comments", "Note"].join("\t");
    const body = lines.map((l) =>
      [l.line_no, ...l.cells, SAMPLE_STATUS[l.status].team, filesByLine[l.id]?.length ?? 0, commentCounts[l.id] ?? 0, l.status_note ?? ""].join("\t"),
    );
    try {
      await navigator.clipboard.writeText([head, ...body].join("\n"));
      toast.success("Copied. Paste into Excel.");
    } catch {
      toast.error("Your browser blocked copying");
    }
  }

  if (!loaded) return <p className="text-sm text-muted-foreground">Loading…</p>;

  if (!schedule) {
    return canManageSchedule ? (
      <div className="space-y-3 rounded-lg border border-dashed p-5 text-sm">
        <p className="font-medium">No sample schedule yet</p>
        <p className="text-muted-foreground">
          Paste the transactions you selected (e.g. revenue samples) straight from Excel. The client gets one line per transaction to upload
          support against, and each line has its own status and comments.
        </p>
        <Button onClick={() => setPasteOpen(true)}><ClipboardPaste /> Paste samples from Excel</Button>
        <p className="text-xs text-muted-foreground">You can also upload the selection as an Excel or CSV file in the next step.</p>
        {renderPasteDialog()}
      </div>
    ) : (
      <p className="text-sm text-muted-foreground">There is no sample schedule on this item.</p>
    );
  }

  function renderPasteDialog() {
    return (
      <Dialog open={pasteOpen} onOpenChange={setPasteOpen}>
        <DialogContent className="max-w-3xl grid-cols-[minmax(0,1fr)]">
          <DialogHeader>
            <DialogTitle>{schedule ? "Add lines to the schedule" : "Create sample schedule"}</DialogTitle>
            <DialogDescription>
              In Excel, select the rows (with the heading row) and copy, then paste below, or upload the Excel/CSV file. Up to {MAX_SAMPLE_COLUMNS} columns and {MAX_SAMPLE_LINES.toLocaleString()} lines.
            </DialogDescription>
          </DialogHeader>
          {!schedule ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="ss-title">Schedule name</Label>
                <Input id="ss-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Revenue samples FY2025" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ss-instr">What to provide for each line</Label>
                <Input id="ss-instr" value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="Invoice, delivery note, proof of payment" />
              </div>
            </div>
          ) : null}
          <SampleInput
            idPrefix="ss"
            text={pasteText}
            onText={setPasteText}
            hasHeader={hasHeader}
            onHasHeader={setHasHeader}
            preview={preview}
            fixedColumns={schedule?.columns}
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPasteOpen(false)}>Cancel</Button>
            <Button disabled={busy || preview.body.length === 0 || preview.body.length > MAX_SAMPLE_LINES} onClick={savePaste}>
              {schedule ? `Add ${preview.body.length} line(s)` : `Create with ${preview.body.length} line(s)`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  const filters: [Filter, string, number][] = [
    ["all", "All", lines.length],
    ["outstanding", "Outstanding", counts.outstanding],
    ["provided", team_ ? "Provided – to check" : "Provided", counts.provided],
    ["queried", team_ ? "Queried" : "Action needed", counts.queried],
    ["received", "Received", counts.received],
    ["not_applicable", "N/A", counts.not_applicable],
  ];
  const selectable = (l: SampleLine) => (team_ ? true : l.status === "outstanding" || l.status === "queried");
  const visibleSelectable = visible.filter(selectable).map((l) => l.id);
  const allSel = visibleSelectable.length > 0 && visibleSelectable.every((id) => selected.has(id));

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="font-semibold">{schedule.title}</div>
          <div className="flex gap-1">
            {team_ ? <Button size="sm" variant="ghost" onClick={copyTsv}><ClipboardCopy /> Copy for Excel</Button> : null}
            {canManageSchedule ? <Button size="sm" variant="ghost" onClick={() => setPasteOpen(true)}><ClipboardPaste /> Add lines / upload Excel</Button> : null}
            {canManageSchedule && files.length === 0 ? (
              <Button size="sm" variant="ghost" className="text-destructive" onClick={deleteSchedule} aria-label="Delete schedule"><Trash2 /></Button>
            ) : null}
          </div>
        </div>
        {schedule.instructions ? <p className="text-sm text-muted-foreground">For each line: {schedule.instructions}</p> : null}
        <div className="flex items-center gap-3 pt-1">
          <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-muted" role="img" aria-label={`${counts.received} of ${applicable} lines received`}>
            <div className="absolute inset-y-0 left-0 rounded-full bg-info/40" style={{ width: `${applicable ? ((counts.received + counts.provided) / applicable) * 100 : 0}%` }} />
            <div className="absolute inset-y-0 left-0 rounded-full bg-success" style={{ width: `${applicable ? (counts.received / applicable) * 100 : 0}%` }} />
          </div>
          <span className="text-xs whitespace-nowrap tabular text-muted-foreground">
            <b className="text-foreground">{counts.received}</b> of {applicable} received
          </span>
        </div>
      </div>

      <div className="flex flex-wrap gap-1">
        {filters.filter(([k, , n]) => k === "all" || n > 0).map(([k, label, n]) => (
          <button
            key={k}
            onClick={() => setFilter(k)}
            className={cn("rounded-full border px-2.5 py-1 text-xs", filter === k ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-muted")}
            aria-pressed={filter === k}
          >
            {label} <span className="tabular opacity-70">{n}</span>
          </button>
        ))}
      </div>

      {selected.size > 0 ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-accent px-3 py-2">
          <span className="text-sm font-medium">{selected.size} line(s)</span>
          <div className="flex-1" />
          {team_ ? (
            <>
              <Button size="sm" variant="success" disabled={busy} onClick={() => setStatus("received", [...selected])}><CheckCircle2 /> Received</Button>
              <Button size="sm" variant="warning" disabled={busy} onClick={() => setNoteDialog({ status: "queried", ids: [...selected], required: true })}><MessageSquareWarning /> Query</Button>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => setNoteDialog({ status: "not_applicable", ids: [...selected], required: false })}><MinusCircle /> N/A</Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => setStatus("outstanding", [...selected])}><RotateCcw /> Outstanding</Button>
            </>
          ) : (
            <Button size="sm" disabled={busy} onClick={() => setNoteDialog({ status: "provided", ids: [...selected], required: false })}><Send /> Mark provided</Button>
          )}
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-muted/60 text-xs">
            <tr>
              <th className="w-8 px-2 py-2">
                <Checkbox checked={allSel} onCheckedChange={(v) => setSelected(v === true ? new Set(visibleSelectable) : new Set())} aria-label="Select all visible lines" disabled={visibleSelectable.length === 0} />
              </th>
              <th className="w-10 px-2 py-2 text-left font-semibold">#</th>
              {schedule.columns.map((c, i) => <th key={i} className="px-2 py-2 text-left font-semibold whitespace-nowrap">{c}</th>)}
              <th className="px-2 py-2 text-left font-semibold">Status</th>
              <th className="px-2 py-2 text-left font-semibold"><Paperclip className="size-3.5" /></th>
              <th className="px-2 py-2 text-left font-semibold"><MessageSquare className="size-3.5" /></th>
            </tr>
          </thead>
          <tbody>
            {visible.map((l) => {
              const lf = filesByLine[l.id] ?? [];
              const isOpen = expanded === l.id;
              const canUpload = open && l.status !== "received" && l.status !== "not_applicable";
              return (
                <Fragment key={l.id}>
                  <tr className={cn("cursor-pointer border-t hover:bg-muted/30", isOpen && "bg-accent/40")} onClick={() => setExpanded(isOpen ? null : l.id)}>
                    <td className="px-2 py-2" onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={selected.has(l.id)}
                        disabled={!selectable(l)}
                        onCheckedChange={(v) => setSelected((s) => { const n = new Set(s); if (v === true) n.add(l.id); else n.delete(l.id); return n; })}
                        aria-label={`Select line ${l.line_no}`}
                      />
                    </td>
                    <td className="px-2 py-2 text-xs text-muted-foreground tabular">{l.line_no}</td>
                    {schedule.columns.map((_, i) => <td key={i} className="px-2 py-2 whitespace-nowrap">{l.cells[i]}</td>)}
                    <td className="px-2 py-2"><Badge variant={SAMPLE_STATUS[l.status].variant}>{team_ ? SAMPLE_STATUS[l.status].team : SAMPLE_STATUS[l.status].client}</Badge></td>
                    <td className="px-2 py-2 text-xs tabular">{lf.length || ""}</td>
                    <td className="px-2 py-2 text-xs tabular">{commentCounts[l.id] || ""}</td>
                  </tr>
                  {isOpen ? (
                    <tr className="border-t bg-muted/20">
                      <td colSpan={schedule.columns.length + 5} className="px-3 py-3">
                        <div className="sticky left-3 grid gap-4 lg:grid-cols-2" style={{ width: "min(56rem, calc(100vw - 3.5rem))" }}>
                          <div className="space-y-2">
                            {l.status === "queried" && l.status_note ? (
                              <p className="rounded-md bg-warning-soft px-2 py-1.5 text-xs text-warning">Query: {l.status_note}</p>
                            ) : null}
                            <div className="text-xs font-semibold text-muted-foreground uppercase">Supporting documents · line {l.line_no}</div>
                            {lf.length === 0 ? <p className="text-xs text-muted-foreground">No documents yet.</p> : null}
                            <ul className="space-y-1.5">
                              {lf.map((f) => (
                                <li key={f.id} className="flex items-center gap-2 rounded-md border bg-card px-2 py-1.5 text-xs">
                                  <FileText className="size-3.5 text-muted-foreground" />
                                  <span className="min-w-0 flex-1 truncate">{f.file_name}</span>
                                  <span className="text-muted-foreground">{formatBytes(f.size_bytes)}</span>
                                  <a className="text-primary" href={`/api/files/${f.id}`} aria-label={`Download ${f.file_name}`}><Download className="size-3.5" /></a>
                                  {f.uploaded_by === userId && l.status !== "received" ? (
                                    <button onClick={() => removeFile(f.id)} aria-label={`Remove ${f.file_name}`}><Trash2 className="size-3.5 text-destructive" /></button>
                                  ) : null}
                                </li>
                              ))}
                            </ul>
                            {canUpload ? (
                              <FileUploader
                                itemId={itemId}
                                kind="sample_support"
                                sampleLineId={l.id}
                                allowedExtensions={upload.allowedExtensions}
                                maxFileMb={upload.maxFileMb}
                                onUploaded={load}
                                compact
                                label={`Upload for line ${l.line_no}`}
                              />
                            ) : null}
                            {team_ ? (
                              <div className="flex flex-wrap gap-1.5 pt-1">
                                {l.status !== "received" ? <Button size="sm" variant="success" onClick={() => setStatus("received", [l.id])}><CheckCircle2 /> Received</Button> : null}
                                <Button size="sm" variant="warning" onClick={() => setNoteDialog({ status: "queried", ids: [l.id], required: true })}><MessageSquareWarning /> Query</Button>
                                {l.status !== "not_applicable" ? <Button size="sm" variant="outline" onClick={() => setNoteDialog({ status: "not_applicable", ids: [l.id], required: false })}>N/A</Button> : null}
                                {l.status !== "outstanding" ? <Button size="sm" variant="ghost" onClick={() => setStatus("outstanding", [l.id])}><RotateCcw /> Reset</Button> : null}
                                {canManageSchedule && lf.length === 0 ? <Button size="sm" variant="ghost" className="text-destructive" onClick={() => deleteLine(l.id)}><Trash2 /> Delete line</Button> : null}
                              </div>
                            ) : l.status === "outstanding" || l.status === "queried" ? (
                              <Button size="sm" onClick={() => setNoteDialog({ status: "provided", ids: [l.id], required: false })}><Send /> Mark provided</Button>
                            ) : null}
                          </div>
                          <div>
                            <div className="mb-2 text-xs font-semibold text-muted-foreground uppercase">Conversation on line {l.line_no}</div>
                            <CommentThread itemId={itemId} userId={userId} audience={audience} team={team} sampleLineId={l.id} compact canPost={canComment} />
                          </div>
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
            {visible.length === 0 ? (
              <tr><td colSpan={schedule.columns.length + 5} className="px-3 py-6 text-center text-sm text-muted-foreground">No lines with this status.</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {renderPasteDialog()}
      <Dialog open={Boolean(noteDialog)} onOpenChange={(o) => !o && setNoteDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {noteDialog?.status === "queried" ? "Query line(s)" : noteDialog?.status === "provided" ? "Mark as provided" : "Mark not applicable"}
            </DialogTitle>
            <DialogDescription>
              {noteDialog?.status === "queried"
                ? "The client sees this note on each line, e.g. \"Only 50% invoiced; provide the balance\" or \"Internal document; provide the third-party invoice\"."
                : "Optional note. It is added to each line's conversation."}
            </DialogDescription>
          </DialogHeader>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder={noteDialog?.required ? "Required" : "Optional"} autoFocus />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setNoteDialog(null)}>Cancel</Button>
            <Button disabled={busy || (noteDialog?.required && !note.trim())} onClick={() => noteDialog && setStatus(noteDialog.status, noteDialog.ids, note)}>
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
