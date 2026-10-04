"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Building2, Download, Eye, FileText, Landmark, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FileUploader } from "@/components/items/file-uploader";
import { deleteDocument } from "@/lib/actions/documents";
import { fmtDateTime } from "@/lib/dates";
import type { EngagementDocument } from "@/lib/types";
import { cn, formatBytes } from "@/lib/utils";

const PREVIEWABLE = /^(application\/pdf|image\/(png|jpe?g|gif|webp))$/i;
type Filter = "all" | "firm" | "client";

export function AdditionalDocuments({
  engagementId,
  audience,
  userId,
  documents,
  names,
  canManage,
  canUpload,
  upload,
  closedReason,
}: {
  engagementId: string;
  audience: "team" | "client";
  userId: string;
  documents: EngagementDocument[];
  names: Record<string, string>;
  /** lead / manager / admin: may delete any document */
  canManage: boolean;
  canUpload: boolean;
  upload: { allowedExtensions: string[]; maxFileMb: number };
  closedReason?: string;
}) {
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>("all");
  const [description, setDescription] = useState("");
  const [showDeleted, setShowDeleted] = useState(false);

  const live = useMemo(() => documents.filter((d) => !d.deleted_at && d.upload_state === "stored"), [documents]);
  const deleted = useMemo(() => documents.filter((d) => d.deleted_at), [documents]);
  const visible = live.filter((d) => filter === "all" || d.side === filter);
  const counts = { all: live.length, firm: live.filter((d) => d.side === "firm").length, client: live.filter((d) => d.side === "client").length };
  const sideLabel = (s: "firm" | "client") =>
    s === "firm" ? (audience === "team" ? "From the firm" : "From the engagement team") : audience === "team" ? "From the client" : "From your team";

  async function remove(d: EngagementDocument) {
    if (!confirm(`Delete "${d.file_name}"? It will no longer be visible to ${audience === "team" ? "the client" : "the engagement team"}.`)) return;
    const res = await deleteDocument(d.id);
    if (!res.ok) return toast.error(res.error);
    toast.success("Document deleted");
    router.refresh();
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <Card className="order-2 xl:order-1">
        <CardHeader className="gap-3">
          <div>
            <CardTitle>Additional documents</CardTitle>
            <CardDescription>
              Documents that don&apos;t belong to a single request: engagement letters, timetables, board papers, management accounts. Both sides see everything here.
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-1" role="group" aria-label="Filter documents">
            {(["all", "firm", "client"] as Filter[]).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setFilter(k)}
                aria-pressed={filter === k}
                className={cn("rounded-full border px-3 py-1 text-xs font-medium", filter === k ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-muted")}
              >
                {k === "all" ? "All" : sideLabel(k)} <span className="tabular opacity-70">{counts[k]}</span>
              </button>
            ))}
          </div>
        </CardHeader>
        <CardContent>
          {visible.length === 0 ? (
            <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">No documents yet.</p>
          ) : (
            <ul className="divide-y rounded-lg border" aria-label="Documents">
              {visible.map((d) => {
                const mine = d.uploaded_by === userId;
                return (
                  <li key={d.id} className="flex items-start gap-3 px-3 py-3">
                    <span className={cn("mt-0.5 grid size-8 shrink-0 place-items-center rounded-md", d.side === "firm" ? "bg-accent text-primary" : "bg-cyan-50 text-cyan-800")}>
                      {d.side === "firm" ? <Landmark className="size-4" /> : <Building2 className="size-4" />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="min-w-0 truncate text-sm font-medium">{d.file_name}</span>
                        <Badge variant={d.side === "firm" ? "info" : "secondary"}>{sideLabel(d.side)}</Badge>
                      </div>
                      {d.description ? <p className="mt-0.5 text-sm text-muted-foreground">{d.description}</p> : null}
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {formatBytes(d.size_bytes)} · {fmtDateTime(d.created_at)} · {mine ? "you" : names[d.uploaded_by] ?? (d.side === "firm" ? "Engagement team" : "Client")}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center">
                      {PREVIEWABLE.test(d.mime_type ?? "") ? (
                        <Button asChild variant="ghost" size="icon-sm" aria-label={`Preview ${d.file_name}`}>
                          <a href={`/api/documents/${d.id}?inline=1`} target="_blank" rel="noopener"><Eye /></a>
                        </Button>
                      ) : null}
                      <Button asChild variant="ghost" size="icon-sm" aria-label={`Download ${d.file_name}`}>
                        <a href={`/api/documents/${d.id}`}><Download /></a>
                      </Button>
                      {mine || canManage ? (
                        <Button variant="ghost" size="icon-sm" onClick={() => remove(d)} aria-label={`Delete ${d.file_name}`}>
                          <Trash2 className="text-destructive" />
                        </Button>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          {audience === "team" && deleted.length ? (
            <div className="mt-4">
              <button type="button" className="text-xs text-muted-foreground underline-offset-2 hover:underline" onClick={() => setShowDeleted((v) => !v)} aria-expanded={showDeleted}>
                {showDeleted ? "Hide" : "Show"} deleted documents ({deleted.length})
              </button>
              {showDeleted ? (
                <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                  {deleted.map((d) => (
                    <li key={d.id} className="flex items-center gap-2">
                      <FileText className="size-3.5" />
                      <span className="line-through">{d.file_name}</span>
                      <span>· deleted {fmtDateTime(d.deleted_at)}{d.deleted_by ? ` by ${names[d.deleted_by] ?? "a user"}` : ""}</span>
                      <a className="text-primary" href={`/api/documents/${d.id}`}>Download</a>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card className="order-1 h-fit xl:order-2">
        <CardHeader>
          <CardTitle className="text-base">{audience === "team" ? "Share with the client" : "Send to the engagement team"}</CardTitle>
          <CardDescription>
            {audience === "team"
              ? "The client sees these once the request list is released, and is notified."
              : "The engagement team is notified when you add a document."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {canUpload ? (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="doc-desc">Description (optional)</Label>
                <Input id="doc-desc" value={description} maxLength={500} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Signed engagement letter" />
              </div>
              <FileUploader
                document={{ engagementId, description }}
                allowedExtensions={upload.allowedExtensions}
                maxFileMb={upload.maxFileMb}
                onUploaded={() => {
                  setDescription("");
                  router.refresh();
                }}
                compact
              />
            </>
          ) : (
            <p className="text-sm text-muted-foreground">{closedReason ?? "Uploads are closed for this engagement."}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
