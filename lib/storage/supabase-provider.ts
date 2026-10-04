import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { DownloadHandle, StorageProvider, UploadTarget } from "./types";

/** Private Supabase Storage bucket, accessed only with the service role. */
export class SupabaseStorageProvider implements StorageProvider {
  readonly id = "supabase" as const;
  constructor(private readonly bucket: string) {}

  private get store() {
    return createAdminClient().storage.from(this.bucket);
  }

  async createUploadTarget(path: string): Promise<UploadTarget> {
    const { data, error } = await this.store.createSignedUploadUrl(path);
    if (error || !data) throw new Error(`Could not prepare upload: ${error?.message ?? "unknown error"}`);
    return { kind: "supabase-signed", bucket: this.bucket, path: data.path, token: data.token };
  }

  async stat(path: string) {
    const slash = path.lastIndexOf("/");
    const dir = path.slice(0, slash);
    const name = path.slice(slash + 1);
    const { data, error } = await this.store.list(dir, { search: name, limit: 100 });
    if (error) throw new Error(error.message);
    const hit = (data ?? []).find((o) => o.name === name);
    return { exists: Boolean(hit), size: (hit?.metadata as { size?: number } | undefined)?.size ?? null };
  }

  async openDownload(path: string): Promise<DownloadHandle> {
    // Short-lived signed URL fetched server-side, then streamed to the user,
    // so the storage URL is never exposed and large files are not buffered.
    const { data, error } = await this.store.createSignedUrl(path, 60);
    if (error || !data) throw new Error(error?.message ?? "File not available");
    const res = await fetch(data.signedUrl, { cache: "no-store" });
    if (!res.ok || !res.body) throw new Error(`Storage returned ${res.status}`);
    return {
      body: res.body,
      contentType: res.headers.get("content-type"),
      contentLength: Number(res.headers.get("content-length")) || null,
    };
  }

  async remove(path: string) {
    const { error } = await this.store.remove([path]);
    if (error) throw new Error(error.message);
  }

  async ensureFolder() {
    // Object storage has no real folders.
  }
}
