"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Check, FolderPlus, Pencil, Plus, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  createCategory, createFolder, renameFolder, reorderCategories, reorderFolders, setFolderActive, updateCategory,
} from "@/lib/actions/checklist";
import type { MasterCategory, MasterFolder } from "@/lib/types";

type Row = { id: string; name: string; sub?: string | null; is_active: boolean; count: number };

function OrderedList({
  rows, onRename, onToggle, onReorder, emptyText, renameLabel,
}: {
  rows: Row[];
  onRename: (id: string, name: string) => Promise<boolean>;
  onToggle: (id: string, active: boolean) => Promise<boolean>;
  onReorder: (ids: string[]) => Promise<boolean>;
  emptyText: string;
  renameLabel: string;
}) {
  const [list, setList] = useState(rows);
  const [editing, setEditing] = useState<string | null>(null);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => setList(rows), [rows]);

  async function move(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    const next = [...list];
    [next[i], next[j]] = [next[j]!, next[i]!];
    setList(next);
    setBusy(true);
    const ok = await onReorder(next.map((r) => r.id));
    setBusy(false);
    if (!ok) setList(list);
  }

  if (!list.length) return <p className="py-4 text-sm text-muted-foreground">{emptyText}</p>;
  return (
    <ul className="divide-y rounded-lg border">
      {list.map((r, i) => (
        <li key={r.id} className={`flex items-center gap-2 px-3 py-2 ${r.is_active ? "" : "bg-muted/40"}`}>
          <div className="flex flex-col">
            <Button type="button" size="icon-sm" variant="ghost" disabled={busy || i === 0} onClick={() => move(i, -1)} aria-label={`Move ${r.name} up`}><ArrowUp /></Button>
            <Button type="button" size="icon-sm" variant="ghost" disabled={busy || i === list.length - 1} onClick={() => move(i, 1)} aria-label={`Move ${r.name} down`}><ArrowDown /></Button>
          </div>
          <div className="min-w-0 flex-1">
            {editing === r.id ? (
              <form
                className="flex items-center gap-1"
                onSubmit={async (e) => {
                  e.preventDefault();
                  setBusy(true);
                  const ok = await onRename(r.id, value);
                  setBusy(false);
                  if (ok) setEditing(null);
                }}
              >
                <Input value={value} onChange={(e) => setValue(e.target.value)} className="h-8" autoFocus aria-label={renameLabel} />
                <Button type="submit" size="icon-sm" variant="ghost" disabled={busy} aria-label="Save name"><Check /></Button>
                <Button type="button" size="icon-sm" variant="ghost" onClick={() => setEditing(null)} aria-label="Cancel"><X /></Button>
              </form>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <span className={`text-sm font-medium ${r.is_active ? "" : "text-muted-foreground line-through"}`}>{r.name}</span>
                {r.sub ? <span className="font-mono text-xs text-muted-foreground">{r.sub}</span> : null}
                <Badge variant="secondary">{r.count} item{r.count === 1 ? "" : "s"}</Badge>
                {!r.is_active ? <Badge variant="muted">Inactive</Badge> : null}
              </div>
            )}
          </div>
          {editing !== r.id ? (
            <Button type="button" size="icon-sm" variant="ghost" onClick={() => { setEditing(r.id); setValue(r.name); }} aria-label={`Rename ${r.name}`}><Pencil /></Button>
          ) : null}
          <Switch
            checked={r.is_active}
            disabled={busy}
            aria-label={`${r.name} active`}
            onCheckedChange={async (v) => {
              setList((l) => l.map((x) => (x.id === r.id ? { ...x, is_active: v } : x)));
              setBusy(true);
              const ok = await onToggle(r.id, v);
              setBusy(false);
              if (!ok) setList((l) => l.map((x) => (x.id === r.id ? { ...x, is_active: !v } : x)));
            }}
          />
        </li>
      ))}
    </ul>
  );
}

/** Categories and default folders of the master checklist (add, rename, reorder, deactivate). */
export function TaxonomyManager({
  categories, folders, itemCountByCategory, itemCountByFolder,
}: {
  categories: MasterCategory[];
  folders: MasterFolder[];
  itemCountByCategory: Record<string, number>;
  itemCountByFolder: Record<string, number>;
}) {
  const router = useRouter();
  const [catName, setCatName] = useState("");
  const [catCode, setCatCode] = useState("");
  const [folderName, setFolderName] = useState("");
  const [busy, setBusy] = useState(false);
  const catRows = useMemo<Row[]>(
    () => [...categories].sort((a, b) => a.sort_order - b.sort_order).map((c) => ({
      id: c.id, name: c.name, sub: c.code, is_active: c.is_active, count: itemCountByCategory[c.id] ?? 0,
    })),
    [categories, itemCountByCategory],
  );
  const folderRows = useMemo<Row[]>(
    () => [...folders].sort((a, b) => a.sort_order - b.sort_order).map((f) => ({
      id: f.id, name: f.name, is_active: f.is_active, count: itemCountByFolder[f.name.toLowerCase()] ?? 0,
    })),
    [folders, itemCountByFolder],
  );

  const done = (res: { ok: boolean; error?: string }, msg?: string) => {
    if (!res.ok) {
      toast.error(res.error ?? "Something went wrong");
      return false;
    }
    if (msg) toast.success(msg);
    router.refresh();
    return true;
  };

  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Categories</CardTitle>
          <CardDescription>Group master items. The order here is the order of folders on new engagements. Inactive categories are hidden from the item editor; their items stay as they are.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <OrderedList
            rows={catRows}
            renameLabel="Category name"
            emptyText="No categories yet."
            onRename={async (id, name) => done(await updateCategory({ id, name }), "Category renamed")}
            onToggle={async (id, isActive) => done(await updateCategory({ id, isActive }), isActive ? "Category activated" : "Category deactivated")}
            onReorder={async (ids) => done(await reorderCategories(ids))}
          />
          <form
            className="flex flex-col gap-2 sm:flex-row"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              const ok = done(await createCategory({ name: catName, code: catCode }), "Category added");
              setBusy(false);
              if (ok) { setCatName(""); setCatCode(""); }
            }}
          >
            <Input value={catName} onChange={(e) => setCatName(e.target.value)} placeholder="New category name" aria-label="New category name" required minLength={2} />
            <Input value={catCode} onChange={(e) => setCatCode(e.target.value.toUpperCase())} placeholder="Code (optional)" aria-label="New category code" className="sm:w-36" maxLength={6} />
            <Button type="submit" disabled={busy}><Plus /> Add</Button>
          </form>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Default folders</CardTitle>
          <CardDescription>The folders master items are filed under on new engagements. Renaming updates the master items that use the folder; live engagements keep their own folders.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <OrderedList
            rows={folderRows}
            renameLabel="Folder name"
            emptyText="No folders yet."
            onRename={async (id, name) => done(await renameFolder(id, name), "Folder renamed")}
            onToggle={async (id, active) => done(await setFolderActive(id, active), active ? "Folder activated" : "Folder deactivated")}
            onReorder={async (ids) => done(await reorderFolders(ids))}
          />
          <form
            className="flex gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              const ok = done(await createFolder(folderName), "Folder added");
              setBusy(false);
              if (ok) setFolderName("");
            }}
          >
            <Input value={folderName} onChange={(e) => setFolderName(e.target.value)} placeholder="e.g. 19 Investments" aria-label="New folder name" required />
            <Button type="submit" disabled={busy}><FolderPlus /> Add</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
