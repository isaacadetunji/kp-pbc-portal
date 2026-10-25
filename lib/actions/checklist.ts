"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionUser } from "@/lib/auth";
import { parsePriority } from "@/lib/checklist-constants";
import { parseChecklistFile, parseFileClass, splitList, toBool } from "@/lib/checklist-io";
import type { MasterCategory, MasterFolder } from "@/lib/types";
import { friendlyError } from "@/lib/utils";
import type { ActionResult } from "./result";

/**
 * Master checklist actions. Writes use the signed-in user's session, so the
 * database (RLS + has_app_permission('manage_checklist')) decides; the check
 * below only gives a friendlier message.
 */
async function checklistUser() {
  const s = await actionUser(["admin", "super_admin", "staff"]);
  const { data: ok } = await s.supabase.rpc("has_app_permission", { p_perm: "manage_checklist" });
  if (!ok) throw new Error("You don't have permission to manage the master checklist.");
  return s;
}

function revalidateChecklist() {
  revalidatePath("/admin/checklist");
  revalidatePath("/admin/settings/checklist");
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------
const categorySchema = z.object({
  name: z.string().trim().min(2, "Enter a category name").max(80),
  code: z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9]{1,5}$/, "Code: 2 to 6 letters/digits, starting with a letter").optional().or(z.literal("")),
  description: z.string().trim().max(300).optional().or(z.literal("")),
});

/** Suggest a short unique code from a name, e.g. "Tests of journals" -> "TOJ". */
function suggestCode(name: string, taken: Set<string>): string {
  const words = name.toUpperCase().replace(/[^A-Z0-9 ]/g, " ").split(/\s+/).filter((w) => w && !["OF", "AND", "THE", "&"].includes(w));
  const bases = [
    words.map((w) => w[0]).join("").slice(0, 4),
    (words[0] ?? "CAT").slice(0, 3),
    (words.join("") || "CAT").slice(0, 4),
  ].filter((b) => /^[A-Z]/.test(b) && b.length >= 2);
  for (const b of bases) if (!taken.has(b)) return b;
  const base = (bases[0] ?? "CT").slice(0, 3);
  for (let i = 2; i < 100; i++) if (!taken.has(`${base}${i}`)) return `${base}${i}`;
  return `C${Date.now().toString(36).slice(-4).toUpperCase()}`;
}

export async function createCategory(input: z.infer<typeof categorySchema>): Promise<ActionResult<MasterCategory>> {
  try {
    const { supabase } = await checklistUser();
    const v = categorySchema.parse(input);
    const { data: cats } = await supabase.from("master_categories").select("code, name, sort_order");
    if ((cats ?? []).some((c) => c.name.toLowerCase() === v.name.toLowerCase())) return { ok: false, error: "A category with that name already exists." };
    const taken = new Set((cats ?? []).map((c) => c.code.toUpperCase()));
    const code = v.code || suggestCode(v.name, taken);
    if (taken.has(code)) return { ok: false, error: `The code ${code} is already used.` };
    const sort = Math.max(0, ...(cats ?? []).map((c) => c.sort_order)) + 10;
    const { data, error } = await supabase
      .from("master_categories")
      .insert({ code, name: v.name, description: v.description || null, sort_order: sort })
      .select("*")
      .single<MasterCategory>();
    if (error || !data) return { ok: false, error: friendlyError(error) };
    revalidateChecklist();
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: friendlyError(e) };
  }
}

const updateCategorySchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(2).max(80).optional(),
  description: z.string().trim().max(300).nullable().optional(),
  isActive: z.boolean().optional(),
});

export async function updateCategory(input: z.infer<typeof updateCategorySchema>): Promise<ActionResult> {
  try {
    const { supabase } = await checklistUser();
    const v = updateCategorySchema.parse(input);
    const patch: Record<string, unknown> = {};
    if (v.name !== undefined) patch.name = v.name;
    if (v.description !== undefined) patch.description = v.description || null;
    if (v.isActive !== undefined) patch.is_active = v.isActive;
    const { data, error } = await supabase.from("master_categories").update(patch).eq("id", v.id).select("id");
    if (error) return { ok: false, error: friendlyError(error) };
    if (!data?.length) return { ok: false, error: "You don't have permission to do that." };
    revalidateChecklist();
    return { ok: true, data: undefined };
  } catch (e) {
    return { ok: false, error: friendlyError(e) };
  }
}

async function reorder(table: "master_categories" | "master_folders", ids: string[]): Promise<ActionResult> {
  try {
    const { supabase } = await checklistUser();
    const list = z.array(z.string().uuid()).max(500).parse(ids);
    for (const [i, id] of list.entries()) {
      const { error } = await supabase.from(table).update({ sort_order: (i + 1) * 10 }).eq("id", id);
      if (error) return { ok: false, error: friendlyError(error) };
    }
    revalidateChecklist();
    return { ok: true, data: undefined };
  } catch (e) {
    return { ok: false, error: friendlyError(e) };
  }
}

export async function reorderCategories(ids: string[]): Promise<ActionResult> {
  return reorder("master_categories", ids);
}

// ---------------------------------------------------------------------------
// Default folders
// ---------------------------------------------------------------------------
const folderName = z.string().trim().min(1, "Enter a folder name").max(120);

export async function createFolder(name: string): Promise<ActionResult<MasterFolder>> {
  try {
    const { supabase } = await checklistUser();
    const n = folderName.parse(name).replace(/\s+/g, " ");
    const { data: all } = await supabase.from("master_folders").select("name, sort_order");
    if ((all ?? []).some((f) => f.name.toLowerCase() === n.toLowerCase())) return { ok: false, error: "A folder with that name already exists." };
    const sort = Math.max(0, ...(all ?? []).map((f) => f.sort_order)) + 10;
    const { data, error } = await supabase.from("master_folders").insert({ name: n, sort_order: sort }).select("*").single<MasterFolder>();
    if (error || !data) return { ok: false, error: friendlyError(error) };
    revalidateChecklist();
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: friendlyError(e) };
  }
}

export async function renameFolder(id: string, name: string): Promise<ActionResult> {
  try {
    const { supabase } = await checklistUser();
    const { error } = await supabase.rpc("rename_master_folder", { p_folder_id: z.string().uuid().parse(id), p_name: folderName.parse(name) });
    if (error) return { ok: false, error: friendlyError(error) };
    revalidateChecklist();
    return { ok: true, data: undefined };
  } catch (e) {
    return { ok: false, error: friendlyError(e) };
  }
}

export async function setFolderActive(id: string, isActive: boolean): Promise<ActionResult> {
  try {
    const { supabase } = await checklistUser();
    const { data, error } = await supabase.from("master_folders").update({ is_active: isActive }).eq("id", z.string().uuid().parse(id)).select("id");
    if (error) return { ok: false, error: friendlyError(error) };
    if (!data?.length) return { ok: false, error: "You don't have permission to do that." };
    revalidateChecklist();
    return { ok: true, data: undefined };
  } catch (e) {
    return { ok: false, error: friendlyError(e) };
  }
}

export async function reorderFolders(ids: string[]): Promise<ActionResult> {
  return reorder("master_folders", ids);
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------
export interface ImportReport {
  total: number;
  inserted: number;
  updated: number;
  skipped: { row: number; code: string; reason: string }[];
}

/** Import master checklist rows from CSV/XLSX. Upserts by code; never deletes. */
export async function importChecklist(formData: FormData): Promise<ActionResult<ImportReport>> {
  try {
    const { supabase } = await checklistUser();
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Choose a file to import" };
    if (file.size > 5 * 1024 * 1024) return { ok: false, error: "Import files must be under 5 MB" };
    const rows = await parseChecklistFile(file.name, await file.arrayBuffer());

    const [{ data: cats }, { data: types }, { data: existing }] = await Promise.all([
      supabase.from("master_categories").select("id, code"),
      supabase.from("engagement_types").select("id, code"),
      supabase.from("master_checklist_items").select("id, code"),
    ]);
    const catByCode = new Map((cats ?? []).map((c) => [c.code.toUpperCase(), c.id]));
    const typeByCode = new Map((types ?? []).map((t) => [t.code.toUpperCase(), t.id]));
    const existingByCode = new Map((existing ?? []).map((e) => [e.code.toUpperCase(), e.id]));

    const report: ImportReport = { total: rows.length, inserted: 0, updated: 0, skipped: [] };

    for (const [i, r] of rows.entries()) {
      const rowNo = i + 2;
      const code = r.code.toUpperCase();
      if (!code || !/^[A-Z0-9][A-Z0-9_.-]{1,30}$/.test(code)) {
        report.skipped.push({ row: rowNo, code: r.code, reason: "Missing or invalid code" });
        continue;
      }
      const categoryId = catByCode.get(r.category_code.toUpperCase());
      if (!categoryId) {
        report.skipped.push({ row: rowNo, code, reason: `Unknown category_code "${r.category_code}"` });
        continue;
      }
      if (!r.title) {
        report.skipped.push({ row: rowNo, code, reason: "Title is required" });
        continue;
      }
      const priority = parsePriority(r.default_priority);
      if (!priority) {
        report.skipped.push({ row: rowNo, code, reason: `Invalid priority "${r.default_priority}" (use Low, Normal, Important or Urgent)` });
        continue;
      }
      const fileClass = parseFileClass(r.file_class);
      if (fileClass === "invalid") {
        report.skipped.push({ row: rowNo, code, reason: `Invalid file_class "${r.file_class}" (use permanent or current)` });
        continue;
      }
      const typeCodes = splitList(r.engagement_types).map((t) => t.toUpperCase());
      const unknownType = typeCodes.find((t) => !typeByCode.has(t));
      if (unknownType) {
        report.skipped.push({ row: rowNo, code, reason: `Unknown engagement type "${unknownType}"` });
        continue;
      }

      let itemId = existingByCode.get(code);
      const payload: Record<string, unknown> = {
        code,
        category_id: categoryId,
        title: r.title,
        guidance: r.description || null,
        default_folder: r.default_folder || "14 Other",
        is_critical: toBool(r.is_critical),
        default_priority: priority,
        sort_order: Number.parseInt(r.sort_order, 10) || 0,
        is_active: toBool(r.is_active, true),
      };
      // Blank / missing file_class keeps the stored value on update
      if (fileClass) payload.file_class = fileClass;
      else if (!itemId) payload.file_class = null;
      // A file without a description column leaves descriptions untouched
      if (itemId && !r._present.has("description")) delete payload.guidance;

      if (itemId) {
        const { data, error } = await supabase.from("master_checklist_items").update(payload).eq("id", itemId).select("id");
        if (error || !data?.length) {
          report.skipped.push({ row: rowNo, code, reason: error ? friendlyError(error) : "You don't have permission to do that." });
          continue;
        }
        report.updated++;
      } else {
        const { data, error } = await supabase.from("master_checklist_items").insert(payload).select("id").single();
        if (error || !data) {
          report.skipped.push({ row: rowNo, code, reason: friendlyError(error) });
          continue;
        }
        itemId = data.id as string;
        existingByCode.set(code, itemId);
        report.inserted++;
      }

      if (typeCodes.length > 0) {
        await supabase.from("master_item_engagement_types").delete().eq("master_item_id", itemId!);
        await supabase
          .from("master_item_engagement_types")
          .insert(typeCodes.map((t) => ({ master_item_id: itemId!, engagement_type_id: typeByCode.get(t)! })));
      }
    }

    revalidateChecklist();
    return { ok: true, data: report };
  } catch (e) {
    return { ok: false, error: friendlyError(e) };
  }
}
