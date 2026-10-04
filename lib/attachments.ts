import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { FileKind } from "@/lib/types";

export type AttachmentSide = "client" | "firm";
export type AttachmentKind = "submission" | "sample" | "firm_document" | "additional";

export interface AttachmentRow {
  id: string;
  source: "item_file" | "document";
  kind: AttachmentKind;
  file_name: string;
  mime_type: string | null;
  size_bytes: number;
  sha256: string | null;
  storage_path: string;
  storage_provider: "supabase" | "sharepoint";
  uploaded_at: string;
  uploaded_by: string;
  uploaded_by_name: string;
  folder_name: string;
  item_id: string | null;
  item_code: string | null;
  item_title: string | null;
  version_no: number | null;
  latest: boolean;
  line_no: number | null;
  description: string | null;
  /** Path inside the ZIP */
  zip_path: string;
}

export const ADDITIONAL_FOLDER = "Additional documents";
export const ZIP_MAX_BYTES = 500 * 1024 * 1024;

/** Safe ZIP path segment (Windows-safe, no separators, bounded length). */
export function zipSegment(s: string, max = 80) {
  const clean = s.replace(/[\\/:*?"<>|\x00-\x1f]+/g, " ").replace(/\s+/g, " ").trim().replace(/^\.+/, "");
  return (clean || "file").slice(0, max).trim();
}

/**
 * Every file one side has shared on an engagement, read with the CALLER's
 * session so RLS decides what is returned:
 *   side=client: client submissions (all versions) + sample support + client-side additional documents
 *   side=firm:   documents the firm attached to items + firm-side additional documents
 */
export async function loadAttachments(supabase: SupabaseClient, engagementId: string, side: AttachmentSide): Promise<AttachmentRow[]> {
  const kinds: FileKind[] = side === "client" ? ["client_submission", "sample_support"] : ["firm_document"];
  const [{ data: files }, { data: docs }, { data: items }, { data: folders }, { data: lines }] = await Promise.all([
    supabase
      .from("request_item_files")
      .select("id, request_item_id, version_no, file_name, mime_type, size_bytes, sha256, storage_path, storage_provider, uploaded_by, uploaded_at, submitted_at, kind, sample_line_id")
      .eq("engagement_id", engagementId)
      .eq("upload_state", "stored")
      .in("kind", kinds)
      .not("submitted_at", "is", null)
      .order("uploaded_at"),
    supabase
      .from("engagement_documents")
      .select("id, file_name, mime_type, size_bytes, sha256, storage_path, storage_provider, uploaded_by, created_at, description")
      .eq("engagement_id", engagementId)
      .eq("side", side)
      .eq("upload_state", "stored")
      .is("deleted_at", null)
      .order("created_at"),
    supabase.from("request_items").select("id, code, title, folder_id, current_version, sort_order").eq("engagement_id", engagementId),
    supabase.from("engagement_folders").select("id, name, sort_order").eq("engagement_id", engagementId),
    side === "client"
      ? supabase.from("sample_lines").select("id, line_no").eq("engagement_id", engagementId)
      : Promise.resolve({ data: [] as { id: string; line_no: number }[] }),
  ]);

  type F = { id: string; request_item_id: string; version_no: number; file_name: string; mime_type: string | null; size_bytes: number; sha256: string | null; storage_path: string; storage_provider: "supabase" | "sharepoint"; uploaded_by: string; uploaded_at: string; kind: FileKind; sample_line_id: string | null };
  type D = { id: string; file_name: string; mime_type: string | null; size_bytes: number; sha256: string | null; storage_path: string; storage_provider: "supabase" | "sharepoint"; uploaded_by: string; created_at: string; description: string | null };
  const itemMap = new Map(((items ?? []) as { id: string; code: string; title: string; folder_id: string; current_version: number; sort_order: number }[]).map((i) => [i.id, i]));
  const folderMap = new Map(((folders ?? []) as { id: string; name: string; sort_order: number }[]).map((f) => [f.id, f]));
  const lineMap = new Map(((lines ?? []) as { id: string; line_no: number }[]).map((l) => [l.id, l.line_no]));
  const fileRows = (files ?? []) as F[];
  const docRows = (docs ?? []) as D[];

  const uploaderIds = [...new Set([...fileRows.map((f) => f.uploaded_by), ...docRows.map((d) => d.uploaded_by)])];
  const names = new Map<string, string>();
  if (uploaderIds.length) {
    const [{ data: profs }, { data: contacts }] = await Promise.all([
      supabase.from("profiles").select("id, full_name, email").in("id", uploaderIds),
      supabase.from("client_contacts").select("user_id, full_name").in("user_id", uploaderIds),
    ]);
    for (const c of (contacts ?? []) as { user_id: string; full_name: string }[]) names.set(c.user_id, c.full_name);
    for (const p of (profs ?? []) as { id: string; full_name: string; email: string }[]) names.set(p.id, p.full_name || p.email);
  }

  const used = new Set<string>();
  const unique = (path: string) => {
    let p = path;
    for (let n = 2; used.has(p.toLowerCase()); n++) p = path.replace(/(\.[^./]+)?$/, (ext) => ` (${n})${ext}`);
    used.add(p.toLowerCase());
    return p;
  };

  const out: AttachmentRow[] = [];
  const sortKey: number[] = [];
  for (const f of fileRows) {
    const item = itemMap.get(f.request_item_id);
    const folder = item ? folderMap.get(item.folder_id) : undefined;
    const folderName = folder?.name ?? "Unfiled";
    const itemDir = `${zipSegment(folderName)}/${zipSegment(`${item?.code ?? "Item"} ${item?.title ?? ""}`)}`;
    const kind: AttachmentKind = f.kind === "client_submission" ? "submission" : f.kind === "sample_support" ? "sample" : "firm_document";
    const lineNo = f.sample_line_id ? lineMap.get(f.sample_line_id) ?? null : null;
    const name = zipSegment(f.file_name, 120);
    const zipPath =
      kind === "submission" ? `${itemDir}/v${f.version_no} ${name}`
        : kind === "sample" ? `${itemDir}/Samples/L${lineNo ?? "?"} ${name}`
          : `${itemDir}/${name}`;
    out.push({
      id: f.id, source: "item_file", kind, file_name: f.file_name, mime_type: f.mime_type, size_bytes: Number(f.size_bytes), sha256: f.sha256,
      storage_path: f.storage_path, storage_provider: f.storage_provider, uploaded_at: f.uploaded_at, uploaded_by: f.uploaded_by,
      uploaded_by_name: names.get(f.uploaded_by) ?? "", folder_name: folderName, item_id: f.request_item_id,
      item_code: item?.code ?? null, item_title: item?.title ?? null,
      version_no: kind === "submission" ? f.version_no : null,
      latest: kind !== "submission" || (item ? f.version_no === item.current_version : true),
      line_no: lineNo, description: null, zip_path: unique(zipPath),
    });
    sortKey.push((folder?.sort_order ?? 9999) * 1e6 + (item?.sort_order ?? 0));
  }
  const ordered = out.map((r, i) => [r, sortKey[i]!] as const).sort((a, b) => a[1] - b[1] || a[0].zip_path.localeCompare(b[0].zip_path)).map(([r]) => r);
  for (const d of docRows) {
    ordered.push({
      id: d.id, source: "document", kind: "additional", file_name: d.file_name, mime_type: d.mime_type, size_bytes: Number(d.size_bytes), sha256: d.sha256,
      storage_path: d.storage_path, storage_provider: d.storage_provider, uploaded_at: d.created_at, uploaded_by: d.uploaded_by,
      uploaded_by_name: names.get(d.uploaded_by) ?? "", folder_name: ADDITIONAL_FOLDER, item_id: null, item_code: null, item_title: null,
      version_no: null, latest: true, line_no: null, description: d.description,
      zip_path: unique(`${ADDITIONAL_FOLDER}/${zipSegment(d.file_name, 120)}`),
    });
  }
  return ordered;
}

/** Strip server-only fields before sending rows to the browser. */
export function publicAttachment(r: AttachmentRow) {
  const { storage_path: _p, storage_provider: _s, ...rest } = r;
  void _p; void _s;
  return rest;
}
export type PublicAttachment = ReturnType<typeof publicAttachment>;
