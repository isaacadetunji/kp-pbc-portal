/**
 * Document storage contract. Phase 1 ships the Supabase Storage provider;
 * Phase 2 adds SharePoint (Microsoft Graph) behind the same interface, so the
 * upload UI, download route and database do not change.
 */
export type UploadTarget =
  | {
      kind: "supabase-signed";
      bucket: string;
      path: string;
      token: string;
    }
  | {
      /** Microsoft Graph resumable upload session (Phase 2) */
      kind: "graph-upload-session";
      uploadUrl: string;
      /** bytes per chunk; must be a multiple of 320 KiB */
      chunkSize: number;
    };

export interface DownloadHandle {
  body: ReadableStream<Uint8Array>;
  contentType?: string | null;
  contentLength?: number | null;
}

export interface StorageProvider {
  readonly id: "supabase" | "sharepoint";
  /** Pre-authorised, short-lived target the browser uploads straight into. */
  createUploadTarget(path: string, opts: { contentType?: string | null; size: number }): Promise<UploadTarget>;
  /** Confirms the object exists; returns its size if known. */
  stat(path: string): Promise<{ exists: boolean; size?: number | null }>;
  openDownload(path: string): Promise<DownloadHandle>;
  remove(path: string): Promise<void>;
  /** Create a folder (no-op for flat object stores). */
  ensureFolder(path: string): Promise<void>;
}
