"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ChevronDown, ChevronRight, Lock, TableProperties } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { SampleInput } from "@/components/items/sample-input";
import { AssigneePicker, selectionFrom, type AssigneeSelection, type PersonWithRole } from "@/components/items/assignees";
import { FILE_CLASS, FILE_CLASS_ORDER } from "@/lib/checklist-constants";
import { MAX_SAMPLE_COLUMNS, MAX_SAMPLE_LINES, PRIORITY, PRIORITY_ORDER } from "@/lib/constants";
import { buildPreview } from "@/lib/sample-parse";
import { createClient } from "@/lib/supabase/client";
import type { FileClass, Folder, ItemAssignee, ItemPriority, Person, RequestItem } from "@/lib/types";
import { friendlyError } from "@/lib/utils";

const NONE = "__none";

export function ItemFormDialog({
  open,
  onOpenChange,
  engagementId,
  folders,
  team,
  clientUsers = [],
  assignees = [],
  canChangeAssignees = { firm: true, client: true, lock: true },
  item,
  defaultFolderId,
  defaultFolderName,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  engagementId: string;
  folders: Folder[];
  team: PersonWithRole[];
  /** Client users with access to the engagement (for "Assign to") */
  clientUsers?: Person[];
  /** Current assignees of the item being edited */
  assignees?: ItemAssignee[];
  /** What the user may change on this item (the database re-checks) */
  canChangeAssignees?: { firm: boolean; client: boolean; lock: boolean };
  item?: RequestItem | null;
  defaultFolderId?: string;
  /** Shown as "Adding to …"; lets a just-created folder be named before the folder list refreshes. */
  defaultFolderName?: string;
  onSaved: () => void;
}) {
  const supabase = createClient();
  const [title, setTitle] = useState("");
  const [guidance, setGuidance] = useState("");
  const [folderId, setFolderId] = useState("");
  const [due, setDue] = useState("");
  const [priority, setPriority] = useState<ItemPriority>("normal");
  const [assign, setAssign] = useState<AssigneeSelection>({ firm: [], client: [] });
  const [locked, setLocked] = useState(false);
  const [fileClass, setFileClass] = useState<string>(NONE);
  const [critical, setCritical] = useState(false);
  const [busy, setBusy] = useState(false);
  // Optional sample schedule (new requests only)
  const [samplesOpen, setSamplesOpen] = useState(false);
  const [sampleText, setSampleText] = useState("");
  const [sampleHeader, setSampleHeader] = useState(true);
  const [sampleTitle, setSampleTitle] = useState("");
  const [sampleInstr, setSampleInstr] = useState("");
  const samplePreview = useMemo(() => buildPreview(sampleText, sampleHeader), [sampleText, sampleHeader]);

  function reset(keepFolder?: string) {
    setTitle(item?.title ?? "");
    setGuidance(item?.guidance ?? "");
    setFolderId(keepFolder ?? item?.folder_id ?? defaultFolderId ?? folders[0]?.id ?? "");
    setDue(item?.due_date ?? "");
    setPriority(item?.priority ?? "normal");
    setAssign(item ? selectionFrom(assignees) : { firm: [], client: [] });
    setLocked(item?.is_locked ?? false);
    setFileClass(item?.file_class ?? NONE);
    setCritical(item?.is_critical ?? false);
    setSamplesOpen(false);
    setSampleText("");
    setSampleHeader(true);
    setSampleTitle("");
    setSampleInstr("");
  }

  // Reset only when the dialog opens or its target changes, not when the folder list refreshes mid-typing.
  useEffect(() => {
    if (open) reset();
  }, [open, item, defaultFolderId]);

  const folderName = folders.find((f) => f.id === folderId)?.name ?? (folderId === defaultFolderId ? defaultFolderName : undefined);
  const folderOptions = folders.some((f) => f.id === folderId) || !folderId
    ? folders
    : [...folders, { id: folderId, name: folderName ?? "New folder" } as Folder];
  const [again, setAgain] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !folderId) return;
    const withSamples = !item && samplesOpen && sampleText.trim() !== "";
    if (withSamples && samplePreview.body.length === 0) return toast.error("The sample schedule needs at least one line under the headings.");
    if (withSamples && samplePreview.body.length > MAX_SAMPLE_LINES) return toast.error(`A sample schedule takes at most ${MAX_SAMPLE_LINES.toLocaleString()} lines at a time.`);
    setBusy(true);
    const fc: FileClass | null = fileClass === NONE ? null : (fileClass as FileClass);
    let error;
    let newId: string | null = null;
    if (item) {
      ({ error } = await supabase
        .from("request_items")
        .update({
          title: title.trim(),
          guidance: guidance.trim() || null,
          folder_id: folderId,
          due_date: due || null,
          priority,
          is_critical: critical,
          file_class: fc,
        })
        .eq("id", item.id));
      if (!error) {
        // Assignees and the lock go through workflow functions that re-check who may change them.
        const before = selectionFrom(assignees);
        const same = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));
        // Unlock before reassigning (and lock after), so the stricter locked rules apply only once locked
        if (locked !== item.is_locked && !locked) ({ error } = await supabase.rpc("set_request_item_lock", { p_item_id: item.id, p_locked: false }));
        for (const side of ["firm", "client"] as const) {
          if (!error && !same(before[side], assign[side])) {
            ({ error } = await supabase.rpc("set_request_item_assignees", { p_item_id: item.id, p_side: side, p_user_ids: assign[side] }));
          }
        }
        if (!error && locked !== item.is_locked && locked) ({ error } = await supabase.rpc("set_request_item_lock", { p_item_id: item.id, p_locked: true }));
      }
    } else {
      let data: unknown;
      ({ error, data } = await supabase.rpc("add_request_item", {
        p_engagement_id: engagementId,
        p_folder_id: folderId,
        p_title: title.trim(),
        p_guidance: guidance.trim() || null,
        p_is_critical: critical,
        p_due_date: due || null,
        p_priority: priority,
        p_category_id: null,
        p_is_locked: locked,
        p_firm_assignee_ids: assign.firm,
        p_client_assignee_ids: assign.client,
      }));
      newId = typeof data === "string" ? data : null;
      if (!error && newId && fc) ({ error } = await supabase.from("request_items").update({ file_class: fc }).eq("id", newId));
    }
    if (error) {
      setBusy(false);
      onSaved();
      return toast.error(friendlyError(error));
    }
    let lines = 0;
    if (withSamples && newId) {
      const { error: sErr } = await supabase.rpc("create_sample_schedule", {
        p_item_id: newId,
        p_columns: samplePreview.header,
        p_rows: samplePreview.body.map((r) => r.slice(0, MAX_SAMPLE_COLUMNS)),
        p_title: sampleTitle.trim() || null,
        p_instructions: sampleInstr.trim() || null,
      });
      if (sErr) {
        setBusy(false);
        onSaved();
        return toast.error(`The request was added, but the sample schedule was not: ${friendlyError(sErr)}. Open the request to try again.`);
      }
      lines = samplePreview.body.length;
    }
    setBusy(false);
    toast.success(
      item
        ? "Request updated"
        : `Added to ${folderName ?? "the folder"}${critical ? " as a critical item" : ""}${lines ? ` with a ${lines}-line sample schedule` : ""}`,
    );
    onSaved();
    if (!item && again) {
      reset(folderId);
      setAgain(false);
      document.getElementById("it-title")?.focus();
      return;
    }
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={samplesOpen && !item ? "max-w-3xl grid-cols-[minmax(0,1fr)]" : "max-w-xl grid-cols-[minmax(0,1fr)]"}>
        <DialogHeader>
          <DialogTitle>{item ? `Edit ${item.code}` : "New request"}</DialogTitle>
          <DialogDescription>
            {item ? "Changes apply to this engagement only." : (
              <>Adding to <b className="text-foreground">{folderName ?? "…"}</b>. The client sees it once the list is approved and released.</>
            )}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="it-title">What do you need?</Label>
            <Input id="it-title" value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={300} placeholder="e.g. Sales invoices for the samples selected" autoFocus />
          </div>
          <div className="space-y-2">
            <Label htmlFor="it-guidance">Description</Label>
            <Textarea id="it-guidance" value={guidance} onChange={(e) => setGuidance(e.target.value)} rows={3} placeholder="Explain exactly what is needed, the period and the format" />
          </div>
          <label className="flex items-start gap-3 rounded-lg border p-3">
            <Checkbox checked={critical} onCheckedChange={(v) => setCritical(v === true)} disabled={item?.status === "not_applicable"} className="mt-0.5" aria-label="Critical item" />
            <span>
              <span className="block text-sm font-medium">Critical item</span>
              <span className="block text-xs text-muted-foreground">Needed before work starts. Must be accepted, or waived by the partner or team lead, before the engagement moves to execution.</span>
            </span>
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="it-folder">Folder</Label>
              <Select value={folderId} onValueChange={setFolderId}>
                <SelectTrigger id="it-folder"><SelectValue placeholder="Choose folder" /></SelectTrigger>
                <SelectContent>
                  {folderOptions.map((f) => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="it-due">Due date</Label>
              <Input id="it-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="it-priority">Priority</Label>
              <Select value={priority} onValueChange={(v) => setPriority(v as ItemPriority)}>
                <SelectTrigger id="it-priority"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PRIORITY_ORDER.map((p) => <SelectItem key={p} value={p}>{PRIORITY[p].label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="it-file-class">File</Label>
              <Select value={fileClass} onValueChange={setFileClass}>
                <SelectTrigger id="it-file-class"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Not set</SelectItem>
                  {FILE_CLASS_ORDER.map((c) => <SelectItem key={c} value={c}>{FILE_CLASS[c].label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="it-assign">Assign to</Label>
            <AssigneePicker
              id="it-assign"
              team={team}
              clientUsers={clientUsers}
              value={assign}
              onChange={setAssign}
              firmEditable={!item || canChangeAssignees.firm}
              clientEditable={!item || canChangeAssignees.client}
            />
            <p className="text-xs text-muted-foreground">Optional. Assignees see it under “Assigned to me” and are notified.</p>
          </div>
          <label className="flex items-start gap-3 rounded-lg border p-3">
            <Checkbox
              checked={locked}
              onCheckedChange={(v) => setLocked(v === true)}
              disabled={Boolean(item) && !canChangeAssignees.lock}
              className="mt-0.5"
              aria-describedby="it-lock-help"
            />
            <span>
              <span className="flex items-center gap-1.5 text-sm font-medium"><Lock className="size-3.5" aria-hidden /> Lock this request</span>
              <span id="it-lock-help" className="block text-xs text-muted-foreground">Only the people assigned (plus the partner, team lead and managers) can see it</span>
              {locked && assign.client.length === 0 ? (
                <span className="mt-1 block text-xs text-warning">No client user is assigned, so no one at the client will see it.</span>
              ) : null}
            </span>
          </label>
          {!item ? (
            <section className="min-w-0 rounded-lg border">
              <button
                type="button"
                className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm font-medium hover:bg-muted/40"
                onClick={() => setSamplesOpen((v) => !v)}
                aria-expanded={samplesOpen}
                aria-controls="it-samples"
              >
                {samplesOpen ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                <TableProperties className="size-4 text-muted-foreground" />
                Sample schedule <span className="font-normal text-muted-foreground">(optional)</span>
                {samplesOpen && samplePreview.body.length ? (
                  <span className="ml-auto text-xs font-normal text-muted-foreground tabular">{samplePreview.body.length} lines · {samplePreview.header.length} columns</span>
                ) : null}
              </button>
              {samplesOpen ? (
                <div id="it-samples" className="min-w-0 space-y-3 border-t p-3">
                  <p className="text-xs text-muted-foreground">
                    The client gets one line per sample to upload support against. Up to {MAX_SAMPLE_COLUMNS} columns and {MAX_SAMPLE_LINES.toLocaleString()} lines.
                  </p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="it-ss-title">Schedule name</Label>
                      <Input id="it-ss-title" value={sampleTitle} onChange={(e) => setSampleTitle(e.target.value)} placeholder="e.g. Revenue samples FY2025" />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="it-ss-instr">What to provide for each line</Label>
                      <Input id="it-ss-instr" value={sampleInstr} onChange={(e) => setSampleInstr(e.target.value)} placeholder="Invoice, delivery note, proof of payment" />
                    </div>
                  </div>
                  <SampleInput
                    idPrefix="it-ss"
                    text={sampleText}
                    onText={setSampleText}
                    hasHeader={sampleHeader}
                    onHasHeader={setSampleHeader}
                    preview={samplePreview}
                  />
                </div>
              ) : null}
            </section>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            {!item ? (
              <Button type="submit" variant="outline" disabled={busy} onClick={() => setAgain(true)}>Add &amp; add another</Button>
            ) : null}
            <Button type="submit" disabled={busy} onClick={() => setAgain(false)}>{item ? "Save changes" : "Add request"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
