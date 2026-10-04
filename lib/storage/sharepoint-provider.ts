import "server-only";
import type { DownloadHandle, StorageProvider, UploadTarget } from "./types";

/**
 * SharePoint / OneDrive provider via Microsoft Graph — PHASE 2.
 *
 * Planned implementation (app-only auth, client-credentials flow):
 *  - token:   POST https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token (scope https://graph.microsoft.com/.default)
 *  - folders: POST /drives/{drive-id}/root:/{parent}:/children  { name, folder: {}, "@microsoft.graph.conflictBehavior": "fail" }
 *  - upload:  POST /drives/{drive-id}/root:/{path}:/createUploadSession -> uploadUrl (browser PUTs chunks directly)
 *  - stat:    GET  /drives/{drive-id}/root:/{path}
 *  - download GET  /drives/{drive-id}/items/{item-id}/content (streamed through the app route)
 *  - delete:  DELETE /drives/{drive-id}/items/{item-id}
 * Required application permission: Sites.Selected (granted to the PBC site only).
 */
export class SharePointStorageProvider implements StorageProvider {
  readonly id = "sharepoint" as const;

  private notYet(): never {
    throw new Error("SharePoint storage is scheduled for Phase 2. Set STORAGE_PROVIDER=supabase for now.");
  }
  async createUploadTarget(): Promise<UploadTarget> { return this.notYet(); }
  async stat(): Promise<{ exists: boolean; size?: number | null }> { return this.notYet(); }
  async openDownload(): Promise<DownloadHandle> { return this.notYet(); }
  async remove(): Promise<void> { return this.notYet(); }
  async ensureFolder(): Promise<void> { return this.notYet(); }
}
