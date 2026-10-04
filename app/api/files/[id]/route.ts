import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getStorageProvider } from "@/lib/storage";

export const dynamic = "force-dynamic";

const INLINE_TYPES = /^(application\/pdf|image\/(png|jpe?g|gif|webp))$/i;

/**
 * Permission-checked download. The file row is read with the USER's session,
 * so RLS decides access (clients only see submitted files on their own
 * engagements, never other clients'). Only then is the object streamed from
 * storage with the service role. Storage URLs are never exposed.
 */
export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const supabase = await createClient();
  const { data: file } = await supabase
    .from("request_item_files")
    .select("id, file_name, mime_type, size_bytes, storage_path, storage_provider, upload_state, engagement_id")
    .eq("id", id)
    .maybeSingle();
  if (!file || file.upload_state !== "stored") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const handle = await getStorageProvider(file.storage_provider).openDownload(file.storage_path);
    const inline = request.nextUrl.searchParams.get("inline") === "1" && INLINE_TYPES.test(file.mime_type ?? "");
    const safeName = file.file_name.replace(/["\r\n]/g, "");
    const headers = new Headers({
      "Content-Type": inline ? (file.mime_type as string) : file.mime_type || handle.contentType || "application/octet-stream",
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${safeName.replace(/[^\x20-\x7E]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(safeName)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    });
    if (handle.contentLength) headers.set("Content-Length", String(handle.contentLength));
    return new Response(handle.body, { status: 200, headers });
  } catch (e) {
    console.error("download failed", id, e);
    return NextResponse.json({ error: "File is temporarily unavailable" }, { status: 502 });
  }
}
