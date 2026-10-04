"use server";

import { actionUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStorageProvider, type UploadTarget } from "@/lib/storage";
import { friendlyError } from "@/lib/utils";
import type { ActionResult } from "./result";

/**
 * Step 1 of an upload. The database (begin_upload) checks the user may upload
 * to this item, validates file type and size, and reserves the storage path.
 * We then hand back a short-lived, single-object upload target.
 */
export async function requestUpload(input: {
  itemId: string;
  fileName: string;
  mimeType: string;
  size: number;
  kind?: "client_submission" | "firm_document" | "sample_support";
  sampleLineId?: string | null;
}): Promise<ActionResult<{ fileId: string; version: number; target: UploadTarget }>> {
  try {
    const { supabase } = await actionUser();
    const { data, error } = await supabase
      .rpc("begin_upload", {
        p_item_id: input.itemId,
        p_file_name: input.fileName,
        p_mime_type: input.mimeType || "application/octet-stream",
        p_size_bytes: input.size,
        p_kind: input.kind ?? "client_submission",
        p_sample_line_id: input.sampleLineId ?? null,
      })
      .single<{ file_id: string; storage_path: string; version_no: number }>();
    if (error || !data) return { ok: false, error: friendlyError(error) };
    const target = await getStorageProvider().createUploadTarget(data.storage_path, {
      contentType: input.mimeType,
      size: input.size,
    });
    return { ok: true, data: { fileId: data.file_id, version: data.version_no, target } };
  } catch (e) {
    return { ok: false, error: friendlyError(e) };
  }
}

/**
 * Step 2: after the browser has uploaded the bytes, verify the object exists
 * (and its size matches) before marking the file as stored.
 */
export async function confirmUpload(input: { fileId: string; sha256?: string | null }): Promise<ActionResult> {
  try {
    const { supabase, profile } = await actionUser();
    // RLS: uploader (or team) can see their pending file
    const { data: file } = await supabase
      .from("request_item_files")
      .select("id, storage_path, size_bytes, uploaded_by, upload_state")
      .eq("id", input.fileId)
      .maybeSingle();
    if (!file || file.uploaded_by !== profile.id) return { ok: false, error: "Upload not found" };
    if (file.upload_state === "stored") return { ok: true, data: undefined };

    const stat = await getStorageProvider().stat(file.storage_path);
    if (!stat.exists) return { ok: false, error: "The file did not reach storage. Please try again." };
    if (stat.size && Number(stat.size) !== Number(file.size_bytes)) {
      return { ok: false, error: "The uploaded file is incomplete. Please try again." };
    }
    const sha = input.sha256 && /^[a-f0-9]{64}$/i.test(input.sha256) ? input.sha256.toLowerCase() : null;
    const { error } = await createAdminClient().rpc("complete_upload", {
      p_file_id: input.fileId,
      p_user_id: profile.id,
      p_sha256: sha,
    });
    if (error) return { ok: false, error: friendlyError(error) };
    return { ok: true, data: undefined };
  } catch (e) {
    return { ok: false, error: friendlyError(e) };
  }
}

/** Remove a file that has not been submitted yet (DB enforces the rules). */
export async function removeDraftFile(fileId: string): Promise<ActionResult> {
  try {
    const { supabase } = await actionUser();
    const { data: path, error } = await supabase.rpc("remove_draft_file", { p_file_id: fileId });
    if (error) return { ok: false, error: friendlyError(error) };
    if (typeof path === "string" && path) {
      await getStorageProvider()
        .remove(path)
        .catch(() => undefined); // row is gone; an orphaned object is harmless and can be swept
    }
    return { ok: true, data: undefined };
  } catch (e) {
    return { ok: false, error: friendlyError(e) };
  }
}
