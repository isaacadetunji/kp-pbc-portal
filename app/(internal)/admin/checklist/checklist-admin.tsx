"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Download, Pencil, Plus, Search, ShieldAlert, Upload } from "lucide-react";
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
import { importChecklist, type ImportReport } from "@/lib/actions/checklist";
import { createClient } from "@/lib/supabase/client";
import type { EngagementType, ItemPriority, MasterCategory, MasterItem } from "@/lib/types";
import { friendlyError } from "@/lib/utils";

const ALL = "__all";
type Draft = {
  id?: string; code: string; category_id: string; title: string; guidance: string; default_folder: string;
  expected_file_types: string; is_critical: boolean; default_priority: ItemPriority; sort_order: string; is_active: boolean; types: Set<string>;
};

export function ChecklistAdmin({ items, categories, types }: { items: MasterItem[]; categories: MasterCategory[]; types: EngagementType[] }) {
  const router = useRouter();
  const supabase = createClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState(ALL);
  const [typeFilter, setTypeFilter] = useState(ALL);
  const [showInactive, setShowInactive] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [busy, setBusy] = useState(false);

  const catById = new Map(categories.map((c) => [c.id, c]));
  const typeById = new Map(types.map((t) => [t.id, t]));
  const folders = [...new Set(items.map((i) => i.default_folder))].sort();

  const rows = useMemo(
    () =>
      items
        .filter((i) => showInactive || i.is_active)
        .filter((i) => cat === ALL || i.category_id === cat)
        .filter((i) => typeFilter === ALL || (i.master_item_engagement_types ?? []).some((x) => x.engagement_type_id === typeFilter))
        .filter((i) => !q || `${i.code} ${i.title} ${i.guidance ?? ""}`.toLowerCase().includes(q.toLowerCase()))
        .sort((a, b) => (catById.get(a.category_id)?.sort_order ?? 0) - (catById.get(b.category_id)?.sort_order ?? 0) || a.sort_order - b.sort_order),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, q, cat, typeFilter, showInactive],
  );

  function edit(i?: MasterItem) {
    setDraft(
      i
        ? {
            id: i.id, code: i.code, category_id: i.category_id, title: i.title, guidance: i.guidance ?? "", default_folder: i.default_folder,
            expected_file_types: i.expected_file_types.join(", "), is_critical: i.is_critical, default_priority: i.default_priority,
            sort_order: String(i.sort_order), is_active: i.is_active, types: new Set((i.master_item_engagement_types ?? []).map((x) => x.engagement_type_id)),
          }
        : {
            code: "", category_id: cat !== ALL ? cat : categories[0]?.id ?? "", title: "", guidance: "", default_folder: folders[0] ?? "", expected_file_types: "pdf",
            is_critical: false, default_priority: "normal", sort_order: "100", is_active: true, types: new Set(types.map((t) => t.id)),
          },
    );
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!draft) return;
    setBusy(true);
    const payload = {
      code: draft.code.trim().toUpperCase(),
      category_id: draft.category_id,
      title: draft.title.trim(),
      guidance: draft.guidance.trim() || null,
      default_folder: draft.default_folder.trim(),
      expected_file_types: draft.expected_file_types.split(/[,;\s]+/).map((s) => s.replace(/^\./, "").toLowerCase()).filter(Boolean),
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
    id = res.data.id;
    await supabase.from("master_item_engagement_types").delete().eq("master_item_id", id);
    if (draft.types.size) {
      await supabase.from("master_item_engagement_types").insert([...draft.types].map((t) => ({ master_item_id: id!, engagement_type_id: t })));
    }
    setBusy(false);
    toast.success(draft.id ? "Item updated (new revision)" : "Item added");
    setDraft(null);
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

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
        <div className="relative flex-1">
          <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search code, title or guidance" className="pl-9" />
        </div>
        <div className="flex flex-wrap gap-2">
          <Select value={cat} onValueChange={setCat}>
            <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All categories</SelectItem>
              {categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All engagement types</SelectItem>
              {types.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <label className="flex items-center gap-2 text-sm"><Switch checked={showInactive} onCheckedChange={setShowInactive} /> Inactive</label>
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
              <TableHead>Types</TableHead>
              <TableHead>Files</TableHead>
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
                  <div className="flex flex-wrap gap-1">
                    {(i.master_item_engagement_types ?? []).map((x) => <Badge key={x.engagement_type_id} variant="secondary">{typeById.get(x.engagement_type_id)?.code}</Badge>)}
                  </div>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">{i.expected_file_types.join(", ")}</TableCell>
                <TableCell className="text-xs tabular">{i.revision}</TableCell>
                <TableCell><Button size="icon-sm" variant="ghost" onClick={() => edit(i)} aria-label={`Edit ${i.code}`}><Pencil /></Button></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={Boolean(draft)} onOpenChange={(o) => !o && setDraft(null)}>
        <DialogContent className="max-w-2xl">
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
                <Select value={draft.category_id} onValueChange={(v) => setDraft({ ...draft, category_id: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="m-title">Title</Label>
                <Input id="m-title" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} required />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="m-guid">Guidance for the client</Label>
                <Textarea id="m-guid" rows={3} value={draft.guidance} onChange={(e) => setDraft({ ...draft, guidance: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="m-folder">Default folder</Label>
                <Input id="m-folder" list="folder-options" value={draft.default_folder} onChange={(e) => setDraft({ ...draft, default_folder: e.target.value })} required />
                <datalist id="folder-options">{folders.map((f) => <option key={f} value={f} />)}</datalist>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="m-types">Expected file types</Label>
                <Input id="m-types" value={draft.expected_file_types} onChange={(e) => setDraft({ ...draft, expected_file_types: e.target.value })} placeholder="pdf, xlsx" />
              </div>
              <div className="space-y-1.5">
                <Label>Default priority</Label>
                <Select value={draft.default_priority} onValueChange={(v) => setDraft({ ...draft, default_priority: v as ItemPriority })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{(["low", "normal", "high", "urgent"] as const).map((p) => <SelectItem key={p} value={p} className="capitalize">{p}</SelectItem>)}</SelectContent>
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
