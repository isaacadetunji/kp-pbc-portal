import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getStorageProvider } from "@/lib/storage";

export const dynamic = "force-dynamic";

const INLINE_TYPES = /^(application\/pdf|image\/(png|jpe?g|gif|webp))$/i;

/**
 * Permission-checked download of an additional (engagement-level) document.
 * The row is read with the USER's session, so RLS decides: the team sees
 * every document; a client sees non-deleted documents on released
 * engagements they were granted. Only then is the object streamed with the
 * service role.
 */
export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const supabase = await createClient();
  const { data: doc } = await supabase
    .from("engagement_documents")
    .select("id, file_name, mime_type, storage_path, storage_provider, upload_state")
    .eq("id", id)
    .maybeSingle();
  if (!doc || doc.upload_state !== "stored") return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    const handle = await getStorageProvider(doc.storage_provider).openDownload(doc.storage_path);
    const inline = request.nextUrl.searchParams.get("inline") === "1" && INLINE_TYPES.test(doc.mime_type ?? "");
    const safeName = doc.file_name.replace(/["\r\n]/g, "");
    const headers = new Headers({
      "Content-Type": inline ? (doc.mime_type as string) : doc.mime_type || handle.contentType || "application/octet-stream",
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${safeName.replace(/[^\x20-\x7E]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(safeName)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    });
    if (handle.contentLength) headers.set("Content-Length", String(handle.contentLength));
    return new Response(handle.body, { status: 200, headers });
  } catch (e) {
    console.error("document download failed", id, e);
    return NextResponse.json({ error: "File is temporarily unavailable" }, { status: 502 });
  }
}
