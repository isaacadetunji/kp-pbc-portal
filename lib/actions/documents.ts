"use server";

import { actionUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStorageProvider, type UploadTarget } from "@/lib/storage";
import { friendlyError } from "@/lib/utils";
import type { ActionResult } from "./result";

/**
 * Additional documents, step 1. begin_document_upload() checks the caller is
 * on the team or a client of a released engagement, validates type and size,
 * derives the side (firm / client) from the caller's role and reserves the
 * storage path. We then return a single-use upload target.
 */
export async function requestDocumentUpload(input: {
  engagementId: string;
  fileName: string;
  mimeType: string;
  size: number;
  description?: string | null;
}): Promise<ActionResult<{ fileId: string; target: UploadTarget }>> {
  try {
    const { supabase } = await actionUser();
    const { data, error } = await supabase
      .rpc("begin_document_upload", {
        p_engagement_id: input.engagementId,
        p_file_name: input.fileName,
        p_mime_type: input.mimeType || "application/octet-stream",
        p_size_bytes: input.size,
        p_description: input.description?.trim() || null,
      })
      .single<{ document_id: string; storage_path: string }>();
    if (error || !data) return { ok: false, error: friendlyError(error) };
    const target = await getStorageProvider().createUploadTarget(data.storage_path, { contentType: input.mimeType, size: input.size });
    return { ok: true, data: { fileId: data.document_id, target } };
  } catch (e) {
    return { ok: false, error: friendlyError(e) };
  }
}

/** Step 2: verify the object reached storage, then mark it stored (service role). */
export async function confirmDocumentUpload(input: { fileId: string; sha256?: string | null }): Promise<ActionResult> {
  try {
    const { supabase, profile } = await actionUser();
    // RLS: the uploader can read their own pending row
    const { data: doc } = await supabase
      .from("engagement_documents")
      .select("id, storage_path, size_bytes, uploaded_by, upload_state")
      .eq("id", input.fileId)
      .maybeSingle();
    if (!doc || doc.uploaded_by !== profile.id) return { ok: false, error: "Upload not found" };
    if (doc.upload_state === "stored") return { ok: true, data: undefined };
    const stat = await getStorageProvider().stat(doc.storage_path);
    if (!stat.exists) return { ok: false, error: "The file did not reach storage. Please try again." };
    if (stat.size && Number(stat.size) !== Number(doc.size_bytes)) {
      return { ok: false, error: "The uploaded file is incomplete. Please try again." };
    }
    const sha = input.sha256 && /^[a-f0-9]{64}$/i.test(input.sha256) ? input.sha256.toLowerCase() : null;
    const { error } = await createAdminClient().rpc("complete_document_upload", {
      p_document_id: input.fileId,
      p_user_id: profile.id,
      p_sha256: sha,
    });
    if (error) return { ok: false, error: friendlyError(error) };
    return { ok: true, data: undefined };
  } catch (e) {
    return { ok: false, error: friendlyError(e) };
  }
}

/** Soft delete (uploader, or lead/manager). The stored object is kept for the record. */
export async function deleteDocument(id: string): Promise<ActionResult> {
  try {
    const { supabase } = await actionUser();
    const { error } = await supabase.rpc("delete_engagement_document", { p_document_id: id });
    if (error) return { ok: false, error: friendlyError(error) };
    return { ok: true, data: undefined };
  } catch (e) {
    return { ok: false, error: friendlyError(e) };
  }
}
