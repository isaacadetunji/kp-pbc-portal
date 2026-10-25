"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Download, FolderTree, Pencil, Plus, Search, ShieldAlert, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { createCategory, createFolder, importChecklist, type ImportReport } from "@/lib/actions/checklist";
import { FILE_CLASS, FILE_CLASS_ORDER, PRIORITY_LABEL, PRIORITY_VALUES, type PriorityValue } from "@/lib/checklist-constants";
import { createClient } from "@/lib/supabase/client";
import type { EngagementType, FileClass, MasterCategory, MasterFolder, MasterItemWithClass } from "@/lib/types";
import { friendlyError } from "@/lib/utils";
import { TaxonomyManager } from "./taxonomy-manager";

const ALL = "__all";
const NONE = "__none";
const NEW = "__new";

type Draft = {
  id?: string; code: string; category_id: string; title: string; description: string; default_folder: string;
  file_class: FileClass | typeof NONE; is_critical: boolean; default_priority: PriorityValue; sort_order: string;
  is_active: boolean; types: Set<string>;
};

function priorityOf(v: string): PriorityValue {
  if (v === "high") return "important";
  return (PRIORITY_VALUES as readonly string[]).includes(v) ? (v as PriorityValue) : "normal";
}

export function ChecklistAdmin({
  items, categories, folders, types,
}: { items: MasterItemWithClass[]; categories: MasterCategory[]; folders: MasterFolder[]; types: EngagementType[] }) {
  const router = useRouter();
  const supabase = createClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState(ALL);
  const [typeFilter, setTypeFilter] = useState(ALL);
  const [classFilter, setClassFilter] = useState(ALL);
  const [showInactive, setShowInactive] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [taxonomyOpen, setTaxonomyOpen] = useState(false);
  // "+ New category" / "+ New folder" from the item editor
  const [newKind, setNewKind] = useState<"category" | "folder" | null>(null);
  const [newName, setNewName] = useState("");
  const [extraCats, setExtraCats] = useState<MasterCategory[]>([]);
  const [extraFolders, setExtraFolders] = useState<MasterFolder[]>([]);

  const allCats = useMemo(
    () => [...categories, ...extraCats.filter((x) => !categories.some((c) => c.id === x.id))].sort((a, b) => a.sort_order - b.sort_order),
    [categories, extraCats],
  );
  const allFolders = useMemo(
    () => [...folders, ...extraFolders.filter((x) => !folders.some((f) => f.id === x.id))].sort((a, b) => a.sort_order - b.sort_order),
    [folders, extraFolders],
  );
  const catById = new Map(allCats.map((c) => [c.id, c]));
  const typeById = new Map(types.map((t) => [t.id, t]));

  const itemCountByCategory = useMemo(() => {
    const m: Record<string, number> = {};
    for (const i of items) m[i.category_id] = (m[i.category_id] ?? 0) + 1;
    return m;
  }, [items]);
  const itemCountByFolder = useMemo(() => {
    const m: Record<string, number> = {};
    for (const i of items) m[i.default_folder.toLowerCase()] = (m[i.default_folder.toLowerCase()] ?? 0) + 1;
    return m;
  }, [items]);

  const rows = useMemo(
    () =>
      items
        .filter((i) => showInactive || i.is_active)
        .filter((i) => cat === ALL || i.category_id === cat)
        .filter((i) => typeFilter === ALL || (i.master_item_engagement_types ?? []).some((x) => x.engagement_type_id === typeFilter))
        .filter((i) => classFilter === ALL || (classFilter === NONE ? !i.file_class : i.file_class === classFilter))
        .filter((i) => !q || `${i.code} ${i.title} ${i.guidance ?? ""}`.toLowerCase().includes(q.toLowerCase()))
        .sort((a, b) => (catById.get(a.category_id)?.sort_order ?? 0) - (catById.get(b.category_id)?.sort_order ?? 0) || a.sort_order - b.sort_order),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, q, cat, typeFilter, classFilter, showInactive, allCats],
  );

  function edit(i?: MasterItemWithClass) {
    const activeFolders = allFolders.filter((f) => f.is_active);
    setDraft(
      i
        ? {
            id: i.id, code: i.code, category_id: i.category_id, title: i.title, description: i.guidance ?? "", default_folder: i.default_folder,
            file_class: i.file_class ?? NONE, is_critical: i.is_critical, default_priority: priorityOf(i.default_priority),
            sort_order: String(i.sort_order), is_active: i.is_active, types: new Set((i.master_item_engagement_types ?? []).map((x) => x.engagement_type_id)),
          }
        : {
            code: "", category_id: cat !== ALL ? cat : allCats.find((c) => c.is_active)?.id ?? "", title: "", description: "",
            default_folder: activeFolders[0]?.name ?? "", file_class: "current",
            is_critical: false, default_priority: "normal", sort_order: "100", is_active: true, types: new Set(types.map((t) => t.id)),
          },
    );
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!draft) return;
    if (!draft.category_id) return toast.error("Choose a category");
    if (!draft.default_folder.trim()) return toast.error("Choose a default folder");
    setBusy(true);
    const payload = {
      code: draft.code.trim().toUpperCase(),
      category_id: draft.category_id,
      title: draft.title.trim(),
      guidance: draft.description.trim() || null,
      default_folder: draft.default_folder.trim(),
      file_class: draft.file_class === NONE ? null : draft.file_class,
      is_critical: draft.is_critical,
      default_priority: draft.default_priority,
      sort_order: Number(draft.sort_order) || 0,
      is_active: draft.is_active,
    };
    let id = draft.id;
    const res = id
      ? await supabase.from("master_checklist_items").update(payload).eq("id", id).select("id").single()
      : await supabase.from("master_checklist_items").insert(payload).select("id").single();
    if (res.error) {
      setBusy(false);
      return toast.error(/duplicate/i.test(res.error.message) ? "That code is already used" : friendlyError(res.error));
    }
    id = res.data.id as string;
    await supabase.from("master_item_engagement_types").delete().eq("master_item_id", id);
    if (draft.types.size) {
      await supabase.from("master_item_engagement_types").insert([...draft.types].map((t) => ({ master_item_id: id!, engagement_type_id: t })));
    }
    setBusy(false);
    toast.success(draft.id ? "Item updated (new revision)" : "Item added");
    setDraft(null);
    router.refresh();
  }

  async function addNew(e: React.FormEvent) {
    e.preventDefault();
    if (!newKind || !draft) return;
    setBusy(true);
    if (newKind === "category") {
      const res = await createCategory({ name: newName });
      setBusy(false);
      if (!res.ok) return toast.error(res.error);
      setExtraCats((x) => [...x, res.data]);
      setDraft({ ...draft, category_id: res.data.id });
      toast.success(`Category “${res.data.name}” added (code ${res.data.code})`);
    } else {
      const res = await createFolder(newName);
      setBusy(false);
      if (!res.ok) return toast.error(res.error);
      setExtraFolders((x) => [...x, res.data]);
      setDraft({ ...draft, default_folder: res.data.name });
      toast.success(`Folder “${res.data.name}” added`);
    }
    setNewKind(null);
    setNewName("");
    router.refresh();
  }

  async function onImport(file: File) {
    const fd = new FormData();
    fd.append("file", file);
    setBusy(true);
    const res = await importChecklist(fd);
    setBusy(false);
    if (fileRef.current) fileRef.current.value = "";
    if (!res.ok) return toast.error(res.error);
    setReport(res.data);
    router.refresh();
  }

  // Options for the editor: active ones, plus the item's current value if inactive
  const catOptions = draft ? allCats.filter((c) => c.is_active || c.id === draft.category_id) : [];
  const folderOptions = draft
    ? [
        ...allFolders.filter((f) => f.is_active || f.name.toLowerCase() === draft.default_folder.toLowerCase()),
        ...(draft.default_folder && !allFolders.some((f) => f.name.toLowerCase() === draft.default_folder.toLowerCase())
          ? [{ id: "legacy", name: draft.default_folder, sort_order: 0, is_active: true }]
          : []),
      ]
    : [];

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
        <div className="relative flex-1">
          <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search code, title or description" className="pl-9" />
        </div>
        <div className="flex flex-wrap gap-2">
          <Select value={cat} onValueChange={setCat}>
            <SelectTrigger className="w-56" aria-label="Filter by category"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All categories</SelectItem>
              {allCats.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}{c.is_active ? "" : " (inactive)"}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-44" aria-label="Filter by engagement type"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All engagement types</SelectItem>
              {types.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={classFilter} onValueChange={setClassFilter}>
            <SelectTrigger className="w-44" aria-label="Filter by file class"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Permanent &amp; current</SelectItem>
              {FILE_CLASS_ORDER.map((c) => <SelectItem key={c} value={c}>{FILE_CLASS[c].label}</SelectItem>)}
              <SelectItem value={NONE}>Not classified</SelectItem>
            </SelectContent>
          </Select>
          <label className="flex items-center gap-2 text-sm"><Switch checked={showInactive} onCheckedChange={setShowInactive} /> Inactive</label>
          <Button variant="outline" onClick={() => setTaxonomyOpen(true)}><FolderTree /> Categories &amp; folders</Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="outline"><Download /> Export</Button></DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem asChild><a href="/api/admin/checklist/export?format=xlsx">Excel (.xlsx)</a></DropdownMenuItem>
              <DropdownMenuItem asChild><a href="/api/admin/checklist/export?format=csv">CSV</a></DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="outline" disabled={busy} onClick={() => fileRef.current?.click()}><Upload /> Import</Button>
          <input ref={fileRef} type="file" accept=".csv,.xlsx" className="hidden" onChange={(e) => e.target.files?.[0] && onImport(e.target.files[0])} />
          <Button onClick={() => edit()}><Plus /> New item</Button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{rows.length} item(s). Tip: export to Excel, edit in bulk, and import. Rows are matched by code; nothing is deleted by import.</p>
      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Code</TableHead>
              <TableHead>Item</TableHead>
              <TableHead>Category / folder</TableHead>
              <TableHead>File</TableHead>
              <TableHead>Priority</TableHead>
              <TableHead>Types</TableHead>
              <TableHead>Rev</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((i) => (
              <TableRow key={i.id} className={i.is_active ? "" : "opacity-50"}>
                <TableCell className="font-mono text-xs">{i.code}</TableCell>
                <TableCell className="max-w-md">
                  <div className="flex items-center gap-2 font-medium">
                    {i.title}
                    {i.is_critical ? <Badge variant="danger"><ShieldAlert /> Critical</Badge> : null}
                    {!i.is_active ? <Badge variant="muted">Inactive</Badge> : null}
                  </div>
                  {i.guidance ? <div className="line-clamp-1 text-xs text-muted-foreground">{i.guidance}</div> : null}
                </TableCell>
                <TableCell className="text-xs">{catById.get(i.category_id)?.name}<br /><span className="text-muted-foreground">{i.default_folder}</span></TableCell>
                <TableCell>
                  {i.file_class ? (
                    <Badge variant={i.file_class === "permanent" ? "info" : "outline"} title={FILE_CLASS[i.file_class].description}>{FILE_CLASS[i.file_class].short}</Badge>
                  ) : <span className="text-xs text-muted-foreground">—</span>}
                </TableCell>
                <TableCell className="text-xs">{PRIORITY_LABEL[priorityOf(i.default_priority)]}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {(i.master_item_engagement_types ?? []).map((x) => <Badge key={x.engagement_type_id} variant="secondary">{typeById.get(x.engagement_type_id)?.code}</Badge>)}
                  </div>
                </TableCell>
                <TableCell className="text-xs tabular">{i.revision}</TableCell>
                <TableCell><Button size="icon-sm" variant="ghost" onClick={() => edit(i)} aria-label={`Edit ${i.code}`}><Pencil /></Button></TableCell>
              </TableRow>
            ))}
            {rows.length === 0 ? (
              <TableRow><TableCell colSpan={8} className="py-8 text-center text-muted-foreground">No items match.</TableCell></TableRow>
            ) : null}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={Boolean(draft)} onOpenChange={(o) => !o && setDraft(null)}>
        <DialogContent className="max-h-[90dvh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{draft?.id ? `Edit ${draft.code}` : "New master item"}</DialogTitle>
            <DialogDescription>Saving an existing item creates a new revision. Existing engagements are not changed.</DialogDescription>
          </DialogHeader>
          {draft ? (
            <form onSubmit={save} className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="m-code">Code</Label>
                <Input id="m-code" value={draft.code} onChange={(e) => setDraft({ ...draft, code: e.target.value })} required pattern="[A-Za-z0-9][A-Za-z0-9_.\-]{1,30}" />
              </div>
              <div className="space-y-1.5">
                <Label>Category</Label>
                <Select value={draft.category_id} onValueChange={(v) => (v === NEW ? (setNewKind("category"), setNewName("")) : setDraft({ ...draft, category_id: v }))}>
                  <SelectTrigger aria-label="Category"><SelectValue placeholder="Choose a category" /></SelectTrigger>
                  <SelectContent>
                    {catOptions.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}{c.is_active ? "" : " (inactive)"}</SelectItem>)}
                    <div role="separator" className="-mx-1 my-1 h-px bg-border" />
                    <SelectItem value={NEW}>+ New category…</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="m-title">Title</Label>
                <Input id="m-title" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} required />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="m-desc">Description</Label>
                <Textarea id="m-desc" rows={3} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} placeholder="What the client should provide: the document, the period it covers and any format needed." />
                <p className="text-xs text-muted-foreground">Shown to the client with the request.</p>
              </div>
              <div className="space-y-1.5">
                <Label>Default folder</Label>
                <Select value={draft.default_folder} onValueChange={(v) => (v === NEW ? (setNewKind("folder"), setNewName("")) : setDraft({ ...draft, default_folder: v }))}>
                  <SelectTrigger aria-label="Default folder"><SelectValue placeholder="Choose a folder" /></SelectTrigger>
                  <SelectContent>
                    {folderOptions.map((f) => <SelectItem key={f.id} value={f.name}>{f.name}{f.is_active ? "" : " (inactive)"}</SelectItem>)}
                    <div role="separator" className="-mx-1 my-1 h-px bg-border" />
                    <SelectItem value={NEW}>+ New folder…</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>File classification</Label>
                <Select value={draft.file_class} onValueChange={(v) => setDraft({ ...draft, file_class: v as Draft["file_class"] })}>
                  <SelectTrigger aria-label="File classification"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {FILE_CLASS_ORDER.map((c) => <SelectItem key={c} value={c}>{FILE_CLASS[c].label} — {FILE_CLASS[c].description.toLowerCase()}</SelectItem>)}
                    <SelectItem value={NONE}>Not classified</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Default priority</Label>
                <Select value={draft.default_priority} onValueChange={(v) => setDraft({ ...draft, default_priority: v as PriorityValue })}>
                  <SelectTrigger aria-label="Default priority"><SelectValue /></SelectTrigger>
                  <SelectContent>{PRIORITY_VALUES.map((p) => <SelectItem key={p} value={p}>{PRIORITY_LABEL[p]}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="m-sort">Sort order</Label>
                <Input id="m-sort" type="number" value={draft.sort_order} onChange={(e) => setDraft({ ...draft, sort_order: e.target.value })} />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label>Applies to engagement types</Label>
                <div className="flex flex-wrap gap-4">
                  {types.map((t) => (
                    <label key={t.id} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={draft.types.has(t.id)}
                        onCheckedChange={(v) => { const n = new Set(draft.types); if (v === true) n.add(t.id); else n.delete(t.id); setDraft({ ...draft, types: n }); }}
                      />
                      {t.name}
                    </label>
                  ))}
                </div>
              </div>
              <label className="flex items-center justify-between gap-3 rounded-lg border p-3 sm:col-span-2">
                <span>
                  <span className="block text-sm font-medium">Critical / pre-engagement</span>
                  <span className="block text-xs text-muted-foreground">Must be accepted or waived before fieldwork starts.</span>
                </span>
                <Switch checked={draft.is_critical} onCheckedChange={(v) => setDraft({ ...draft, is_critical: v })} />
              </label>
              <label className="flex items-center justify-between gap-3 rounded-lg border p-3 sm:col-span-2">
                <span className="text-sm font-medium">Active (offered for new engagements)</span>
                <Switch checked={draft.is_active} onCheckedChange={(v) => setDraft({ ...draft, is_active: v })} />
              </label>
              <DialogFooter className="sm:col-span-2">
                <Button type="button" variant="ghost" onClick={() => setDraft(null)}>Cancel</Button>
                <Button type="submit" disabled={busy}>Save</Button>
              </DialogFooter>
            </form>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={newKind !== null} onOpenChange={(o) => !o && setNewKind(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{newKind === "category" ? "New category" : "New default folder"}</DialogTitle>
            <DialogDescription>
              {newKind === "category"
                ? "A short code is generated from the name; you can manage categories under Categories & folders."
                : "Use the numbering of the other folders, e.g. 19 Investments."}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={addNew} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="new-name">Name</Label>
              <Input id="new-name" value={newName} onChange={(e) => setNewName(e.target.value)} required autoFocus />
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setNewKind(null)}>Cancel</Button>
              <Button type="submit" disabled={busy}><Plus /> Add</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={taxonomyOpen} onOpenChange={setTaxonomyOpen}>
        <DialogContent className="max-h-[90dvh] max-w-5xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Categories &amp; default folders</DialogTitle>
            <DialogDescription>Add, rename, reorder and deactivate. Changes apply to new engagements.</DialogDescription>
          </DialogHeader>
          <TaxonomyManager categories={allCats} folders={allFolders} itemCountByCategory={itemCountByCategory} itemCountByFolder={itemCountByFolder} />
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(report)} onOpenChange={(o) => !o && setReport(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Import complete</DialogTitle>
            <DialogDescription>{report?.total} row(s) read · {report?.inserted} added · {report?.updated} updated · {report?.skipped.length} skipped</DialogDescription>
          </DialogHeader>
          {report?.skipped.length ? (
            <ul className="max-h-64 space-y-1 overflow-y-auto text-sm">
              {report.skipped.map((s) => <li key={`${s.row}-${s.code}`}><span className="font-mono">Row {s.row} {s.code}</span>: {s.reason}</li>)}
            </ul>
          ) : null}
          <DialogFooter><Button onClick={() => setReport(null)}>Close</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
