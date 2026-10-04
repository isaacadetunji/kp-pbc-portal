"use client";

import { useCallback, useState } from "react";
import { useDropzone } from "react-dropzone";
import { toast } from "sonner";
import { CloudUpload, Loader2 } from "lucide-react";
import { confirmDocumentUpload, requestDocumentUpload } from "@/lib/actions/documents";
import { confirmUpload, requestUpload } from "@/lib/actions/uploads";
import type { UploadTarget } from "@/lib/storage/types";
import { cn, formatBytes } from "@/lib/utils";

interface Progress {
  name: string;
  pct: number;
  error?: string;
}

async function sha256Hex(file: File): Promise<string | null> {
  if (file.size > 200 * 1024 * 1024 || !crypto?.subtle) return null;
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function putToSupabase(target: Extract<UploadTarget, { kind: "supabase-signed" }>, file: File, onPct: (n: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const base = process.env.NEXT_PUBLIC_SUPABASE_URL!.replace(/\/$/, "");
    const url = new URL(`${base}/storage/v1/object/upload/sign/${target.bucket}/${target.path}`);
    url.searchParams.set("token", target.token);
    const form = new FormData();
    form.append("cacheControl", "3600");
    form.append("", file);
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url.toString());
    xhr.setRequestHeader("x-upsert", "false");
    // The API gateway requires the public anon key; the one-time token authorises the write.
    xhr.setRequestHeader("apikey", process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
    xhr.upload.onprogress = (e) => e.lengthComputable && onPct(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed (${xhr.status})`)));
    xhr.onerror = () => reject(new Error("Network error during upload"));
    xhr.send(form);
  });
}

async function putToGraph(target: Extract<UploadTarget, { kind: "graph-upload-session" }>, file: File, onPct: (n: number) => void) {
  // Phase 2: chunked PUTs to a Microsoft Graph upload session
  for (let start = 0; start < file.size; start += target.chunkSize) {
    const end = Math.min(start + target.chunkSize, file.size);
    const res = await fetch(target.uploadUrl, {
      method: "PUT",
      headers: { "Content-Range": `bytes ${start}-${end - 1}/${file.size}` },
      body: file.slice(start, end),
    });
    if (!res.ok) throw new Error(`Upload failed (${res.status})`);
    onPct(Math.round((end / file.size) * 100));
  }
}

export function FileUploader({
  itemId,
  allowedExtensions,
  maxFileMb,
  onUploaded,
  compact,
  kind = "client_submission",
  sampleLineId,
  label,
  document: docTarget,
}: {
  /** Request item to upload against (not needed for engagement documents) */
  itemId?: string;
  allowedExtensions: string[];
  maxFileMb: number;
  onUploaded: () => void;
  compact?: boolean;
  kind?: "client_submission" | "firm_document" | "sample_support";
  sampleLineId?: string;
  label?: string;
  /** Upload an engagement-level "additional document" instead of an item file */
  document?: { engagementId: string; description?: string };
}) {
  const [progress, setProgress] = useState<Progress[]>([]);
  const busy = progress.some((p) => p.pct < 100 && !p.error);

  const onDrop = useCallback(
    async (files: File[]) => {
      const accepted: File[] = [];
      for (const f of files) {
        const ext = f.name.split(".").pop()?.toLowerCase() ?? "";
        if (!allowedExtensions.includes(ext)) {
          toast.error(`${f.name}: .${ext} files are not accepted`);
          continue;
        }
        if (f.size > maxFileMb * 1024 * 1024) {
          toast.error(`${f.name} is larger than ${maxFileMb} MB`);
          continue;
        }
        if (f.size === 0) {
          toast.error(`${f.name} is empty`);
          continue;
        }
        accepted.push(f);
      }
      if (!accepted.length) return;
      setProgress(accepted.map((f) => ({ name: f.name, pct: 0 })));

      await Promise.all(
        accepted.map(async (file, idx) => {
          const set = (patch: Partial<Progress>) =>
            setProgress((prev) => prev.map((p, i) => (i === idx ? { ...p, ...patch } : p)));
          try {
            const [req, hash] = await Promise.all([
              docTarget
                ? requestDocumentUpload({ engagementId: docTarget.engagementId, fileName: file.name, mimeType: file.type, size: file.size, description: docTarget.description })
                : requestUpload({ itemId: itemId!, fileName: file.name, mimeType: file.type, size: file.size, kind, sampleLineId }),
              sha256Hex(file),
            ]);
            if (!req.ok) throw new Error(req.error);
            const t = req.data.target;
            if (t.kind === "supabase-signed") await putToSupabase(t, file, (pct) => set({ pct: Math.min(pct, 99) }));
            else await putToGraph(t, file, (pct) => set({ pct: Math.min(pct, 99) }));
            const conf = docTarget
              ? await confirmDocumentUpload({ fileId: req.data.fileId, sha256: hash })
              : await confirmUpload({ fileId: req.data.fileId, sha256: hash });
            if (!conf.ok) throw new Error(conf.error);
            set({ pct: 100 });
          } catch (e) {
            const msg = e instanceof Error ? e.message : "Upload failed";
            set({ error: msg });
            toast.error(`${file.name}: ${msg}`);
          }
        }),
      );
      onUploaded();
      setTimeout(() => setProgress((p) => p.filter((x) => x.error)), 1500);
    },
    [allowedExtensions, itemId, maxFileMb, onUploaded, kind, sampleLineId, docTarget],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop, multiple: true, disabled: busy });

  return (
    <div className="space-y-2">
      <div
        {...getRootProps()}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-input bg-muted/30 px-4 text-center transition-colors hover:border-ring hover:bg-accent/40",
          compact ? "py-4" : "py-7",
          isDragActive && "border-ring bg-accent/60",
          busy && "pointer-events-none opacity-60",
        )}
      >
        <input {...getInputProps()} aria-label="Upload files" />
        {busy ? <Loader2 className="size-6 animate-spin text-primary" /> : <CloudUpload className="size-6 text-primary" />}
        <p className="text-sm font-medium">
          {isDragActive ? "Drop files to upload" : (
            <>
              {label ? <span className="text-primary">{label}</span> : (
                <>
                  <span className="hidden sm:inline">Drag files here or </span>
                  <span className="text-primary">choose files</span>
                </>
              )}
            </>
          )}
        </p>
        <p className="text-xs text-muted-foreground">
          {allowedExtensions.map((e) => e.toUpperCase()).join(", ")} · up to {formatBytes(maxFileMb * 1024 * 1024)} each
        </p>
      </div>
      {progress.map((p) => (
        <div key={p.name} className="rounded-md border bg-card px-3 py-2 text-xs">
          <div className="flex justify-between gap-2">
            <span className="truncate">{p.name}</span>
            <span className={cn("tabular", p.error ? "text-destructive" : "text-muted-foreground")}>{p.error ? "Failed" : `${p.pct}%`}</span>
          </div>
          {!p.error ? (
            <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted">
              <div className="h-full bg-primary transition-all" style={{ width: `${p.pct}%` }} />
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}
