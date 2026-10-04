import { NextResponse, type NextRequest } from "next/server";
import { Zip, ZipPassThrough, strToU8 } from "fflate";
import { loadAttachments, ZIP_MAX_BYTES, zipSegment, type AttachmentRow, type AttachmentSide } from "@/lib/attachments";
import { createClient } from "@/lib/supabase/server";
import { getStorageProvider } from "@/lib/storage";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function csvCell(v: unknown) {
  const s = v === null || v === undefined ? "" : String(v);
  // neutralise spreadsheet formulas and quote
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
}

function manifest(rows: AttachmentRow[], missing: Set<string>) {
  const head = ["Path in ZIP", "File name", "Type", "Folder", "Request", "Request title", "Version", "Latest", "Sample line", "Uploaded by", "Uploaded at", "Size (bytes)", "SHA-256", "Description", "Status"];
  const type = { submission: "Client submission", sample: "Sample support", firm_document: "Firm document", additional: "Additional document" } as const;
  const lines = rows.map((r) =>
    [r.zip_path, r.file_name, type[r.kind], r.folder_name, r.item_code, r.item_title, r.version_no, r.latest ? "yes" : "no", r.line_no,
      r.uploaded_by_name, r.uploaded_at, r.size_bytes, r.sha256, r.description, missing.has(r.id) ? "MISSING FROM STORAGE" : "ok"].map(csvCell).join(","),
  );
  return "﻿" + [head.map(csvCell).join(","), ...lines].join("\r\n") + "\r\n";
}

/**
 * ZIP of the files one side has shared on an engagement.
 *   ?side=client  everything the client uploaded (for the team)
 *   ?side=firm    everything the firm shared (for the client)
 *   &ids=a,b,c    optional subset
 * Rows are read with the USER's session (RLS decides what is included); the
 * objects are then streamed from storage with the service role and zipped on
 * the fly (stored, no recompression), with a manifest.csv.
 */
export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const side = request.nextUrl.searchParams.get("side") as AttachmentSide | null;
  if (side !== "client" && side !== "firm") return NextResponse.json({ error: "side must be client or firm" }, { status: 400 });
  const idsParam = request.nextUrl.searchParams.get("ids");
  const ids = idsParam ? idsParam.split(",").map((s) => s.trim()).filter((s) => UUID.test(s)) : null;
  if (ids && ids.length === 0) return NextResponse.json({ error: "No valid ids" }, { status: 400 });

  const supabase = await createClient();
  const { data: eng } = await supabase.from("engagements").select("id, code, status").eq("id", id).maybeSingle();
  if (!eng) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let rows = await loadAttachments(supabase, id, side);
  if (ids) {
    const want = new Set(ids);
    rows = rows.filter((r) => want.has(r.id));
  }
  if (rows.length === 0) return NextResponse.json({ error: "Nothing to download" }, { status: 404 });
  const total = rows.reduce((n, r) => n + r.size_bytes, 0);
  if (total > ZIP_MAX_BYTES) {
    return NextResponse.json(
      { error: `The selection is ${Math.round(total / 1048576)} MB; the ZIP limit is ${ZIP_MAX_BYTES / 1048576} MB. Select fewer files.` },
      { status: 413 },
    );
  }

  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  let chain: Promise<void> = Promise.resolve();
  const zip = new Zip((err, chunk, final) => {
    if (err) {
      chain = chain.then(() => writer.abort(err));
      return;
    }
    chain = chain.then(() => writer.write(chunk));
    if (final) chain = chain.then(() => writer.close());
  });

  (async () => {
    const missing = new Set<string>();
    for (const r of rows) {
      const entry = new ZipPassThrough(r.zip_path);
      entry.mtime = new Date(r.uploaded_at);
      zip.add(entry);
      try {
        const handle = await getStorageProvider(r.storage_provider).openDownload(r.storage_path);
        const reader = handle.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value?.length) entry.push(value);
          await chain; // backpressure: wait until the browser has taken the bytes
        }
      } catch (e) {
        console.error("zip: object unavailable", r.id, e);
        missing.add(r.id);
      }
      entry.push(new Uint8Array(0), true);
      await chain;
    }
    const m = new ZipPassThrough("manifest.csv");
    zip.add(m);
    m.push(strToU8(manifest(rows, missing)), true);
    zip.end();
    await chain;
  })().catch((e) => {
    console.error("zip failed", id, e);
    writer.abort(e).catch(() => undefined);
  });

  const name = `${zipSegment(eng.code)} ${side === "client" ? "client uploads" : "documents from the firm"}${ids ? " (selection)" : ""}.zip`;
  return new Response(readable, {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${name.replace(/[^\x20-\x7E]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
