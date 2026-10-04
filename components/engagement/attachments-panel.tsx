"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Download, FileArchive, FileText, Search, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { AttachmentKind, PublicAttachment } from "@/lib/attachments";
import { fmtDateTime } from "@/lib/dates";
import { cn, formatBytes } from "@/lib/utils";

const ALL = "__all";
const KIND_LABEL: Record<AttachmentKind, string> = {
  submission: "Request submission",
  sample: "Sample support",
  firm_document: "Shared on a request",
  additional: "Additional document",
};
const MAX_IDS_IN_URL = 150;
const ZIP_LIMIT = 500 * 1024 * 1024;

export function AttachmentsPanel({
  engagementId,
  side,
  rows,
  itemHref,
}: {
  engagementId: string;
  /** whose uploads are listed: the client's (team view) or the firm's (client view) */
  side: "client" | "firm";
  rows: PublicAttachment[];
  itemHref: string;
}) {
  const [q, setQ] = useState("");
  const [folder, setFolder] = useState(ALL);
  const [kind, setKind] = useState(ALL);
  const [latestOnly, setLatestOnly] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const folders = useMemo(() => [...new Set(rows.map((r) => r.folder_name))], [rows]);
  const kinds = useMemo(() => [...new Set(rows.map((r) => r.kind))], [rows]);
  const filtered = useMemo(() => {
    const n = q.trim().toLowerCase();
    return rows.filter(
      (r) =>
        (folder === ALL || r.folder_name === folder) &&
        (kind === ALL || r.kind === kind) &&
        (!latestOnly || r.latest) &&
        (!n || `${r.file_name} ${r.item_code ?? ""} ${r.item_title ?? ""} ${r.folder_name} ${r.uploaded_by_name} ${r.description ?? ""}`.toLowerCase().includes(n)),
    );
  }, [rows, q, folder, kind, latestOnly]);

  const filteredIds = filtered.map((r) => r.id);
  const allSel = filteredIds.length > 0 && filteredIds.every((id) => selected.has(id));
  const someSel = filteredIds.some((id) => selected.has(id));
  const selRows = rows.filter((r) => selected.has(r.id));
  const selBytes = selRows.reduce((n, r) => n + r.size_bytes, 0);
  const totalBytes = rows.reduce((n, r) => n + r.size_bytes, 0);
  const base = `/api/engagements/${engagementId}/attachments?side=${side}`;
  const filtersOn = q || folder !== ALL || kind !== ALL || latestOnly;

  function toggle(id: string, on: boolean) {
    setSelected((s) => {
      const n = new Set(s);
      if (on) n.add(id);
      else n.delete(id);
      return n;
    });
  }

  function downloadSelected(e: React.MouseEvent) {
    if (selBytes > ZIP_LIMIT) {
      e.preventDefault();
      toast.error(`The selection is ${formatBytes(selBytes)}; a ZIP can hold up to 500 MB. Select fewer files.`);
    } else if (selected.size > MAX_IDS_IN_URL && selected.size !== rows.length) {
      e.preventDefault();
      toast.error(`Select up to ${MAX_IDS_IN_URL} files at a time, or use Download all.`);
    }
  }

  const selectedHref = selected.size === rows.length ? base : `${base}&ids=${[...selected].join(",")}`;

  return (
    <Card>
      <CardHeader className="gap-3">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <CardTitle>{side === "client" ? "Everything the client has uploaded" : "Everything the engagement team has shared with you"}</CardTitle>
            <CardDescription>
              {rows.length} file{rows.length === 1 ? "" : "s"} · {formatBytes(totalBytes)}.{" "}
              {side === "client"
                ? "Submissions (every version), sample support and additional documents. The ZIP is laid out by folder and request, with a manifest."
                : "Templates and samples attached to requests, plus additional documents."}
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            {selected.size ? (
              <Button asChild variant="outline">
                <a href={selectedHref} onClick={downloadSelected} download>
                  <Download /> Download selected ({selected.size})
                </a>
              </Button>
            ) : null}
            <Button asChild disabled={rows.length === 0}>
              <a
                href={base}
                download
                aria-disabled={rows.length === 0}
                onClick={(e) => {
                  if (rows.length === 0) e.preventDefault();
                  else if (totalBytes > ZIP_LIMIT) {
                    e.preventDefault();
                    toast.error("Everything together is over the 500 MB ZIP limit. Filter and download a selection instead.");
                  }
                }}
              >
                <FileArchive /> Download all as ZIP
              </a>
            </Button>
          </div>
        </div>
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
          <div className="relative flex-1">
            <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search file, request or uploader" className="pl-9" aria-label="Search attachments" />
          </div>
          <div className="grid grid-cols-2 gap-2 sm:flex">
            <Select value={folder} onValueChange={setFolder}>
              <SelectTrigger className="sm:w-52" aria-label="Filter by folder"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All folders</SelectItem>
                {folders.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={kind} onValueChange={setKind}>
              <SelectTrigger className="sm:w-48" aria-label="Filter by type"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All types</SelectItem>
                {kinds.map((k) => <SelectItem key={k} value={k}>{KIND_LABEL[k]}</SelectItem>)}
              </SelectContent>
            </Select>
            {side === "client" ? (
              <label className="col-span-2 flex items-center gap-2 text-sm whitespace-nowrap sm:col-span-1">
                <Checkbox checked={latestOnly} onCheckedChange={(v) => setLatestOnly(v === true)} /> Latest versions only
              </label>
            ) : null}
            {filtersOn ? (
              <Button variant="ghost" size="sm" className="h-9" onClick={() => { setQ(""); setFolder(ALL); setKind(ALL); setLatestOnly(false); }}>
                <X /> Clear
              </Button>
            ) : null}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
            {side === "client" ? "The client hasn't uploaded anything yet." : "Nothing has been shared with you yet."}
          </p>
        ) : (
          <div className="overflow-hidden rounded-lg border">
            <div className="flex items-center gap-3 border-b bg-muted/40 px-3 py-2 text-xs font-semibold text-muted-foreground">
              <Checkbox
                checked={allSel ? true : someSel ? "indeterminate" : false}
                onCheckedChange={(v) => setSelected((s) => { const n = new Set(s); filteredIds.forEach((id) => (v === true ? n.add(id) : n.delete(id))); return n; })}
                aria-label="Select all shown"
                disabled={filteredIds.length === 0}
              />
              <span className="flex-1">{filtered.length} shown{selected.size ? ` · ${selected.size} selected (${formatBytes(selBytes)})` : ""}</span>
              {selected.size ? <button type="button" className="font-medium text-primary hover:underline" onClick={() => setSelected(new Set())}>Clear selection</button> : null}
            </div>
            <ul className="divide-y" aria-label="Attachments">
              {filtered.map((r) => (
                <li key={r.id} className={cn("flex items-start gap-3 px-3 py-2.5", selected.has(r.id) && "bg-accent/50")}>
                  <Checkbox className="mt-1" checked={selected.has(r.id)} onCheckedChange={(v) => toggle(r.id, v === true)} aria-label={`Select ${r.file_name}`} />
                  <FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <div className="grid min-w-0 flex-1 gap-x-4 gap-y-0.5 md:grid-cols-[minmax(0,2fr)_minmax(0,1.5fr)_9rem_3.5rem] md:items-center">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{r.file_name}</div>
                      <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                        <Badge variant={r.kind === "additional" ? "secondary" : r.kind === "sample" ? "info" : "outline"}>{KIND_LABEL[r.kind]}</Badge>
                        {r.version_no ? <Badge variant={r.latest ? "success" : "muted"}>v{r.version_no}{r.latest ? " · latest" : " · superseded"}</Badge> : null}
                        {r.line_no ? <Badge variant="muted">Line {r.line_no}</Badge> : null}
                      </div>
                    </div>
                    <div className="min-w-0 text-xs text-muted-foreground">
                      <div className="truncate">{r.folder_name}</div>
                      {r.item_id ? (
                        <a href={`${itemHref}${itemHref.includes("?") ? "&" : "?"}item=${r.item_id}`} className="block truncate text-foreground hover:text-primary hover:underline">
                          {r.item_code} {r.item_title}
                        </a>
                      ) : r.description ? <div className="truncate">{r.description}</div> : null}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      <div className="truncate">{r.uploaded_by_name || "—"}</div>
                      <div>{fmtDateTime(r.uploaded_at)}</div>
                    </div>
                    <div className="text-xs text-muted-foreground tabular md:text-right">{formatBytes(r.size_bytes)}</div>
                  </div>
                  <Button asChild variant="ghost" size="icon-sm" aria-label={`Download ${r.file_name}`}>
                    <a href={r.source === "document" ? `/api/documents/${r.id}` : `/api/files/${r.id}`}><Download /></a>
                  </Button>
                </li>
              ))}
              {filtered.length === 0 ? <li className="px-3 py-8 text-center text-sm text-muted-foreground">No files match these filters.</li> : null}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
