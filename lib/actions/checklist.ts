"use server";

import { revalidatePath } from "next/cache";
import { actionUser } from "@/lib/auth";
import { parseChecklistFile, splitList, toBool } from "@/lib/checklist-io";
import { friendlyError } from "@/lib/utils";
import type { ActionResult } from "./result";

const PRIORITIES = ["low", "normal", "high", "urgent"];

export interface ImportReport {
  total: number;
  inserted: number;
  updated: number;
  skipped: { row: number; code: string; reason: string }[];
}

/** Import master checklist rows from CSV/XLSX. Upserts by code; never deletes. */
export async function importChecklist(formData: FormData): Promise<ActionResult<ImportReport>> {
  try {
    const { supabase } = await actionUser(["admin", "super_admin"]);
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
      const priority = (r.default_priority || "normal").toLowerCase();
      if (!PRIORITIES.includes(priority)) {
        report.skipped.push({ row: rowNo, code, reason: `Invalid priority "${r.default_priority}"` });
        continue;
      }
      const typeCodes = splitList(r.engagement_types).map((t) => t.toUpperCase());
      const unknownType = typeCodes.find((t) => !typeByCode.has(t));
      if (unknownType) {
        report.skipped.push({ row: rowNo, code, reason: `Unknown engagement type "${unknownType}"` });
        continue;
      }

      const payload = {
        code,
        category_id: categoryId,
        title: r.title,
        guidance: r.guidance || null,
        default_folder: r.default_folder || "Other",
        expected_file_types: splitList(r.expected_file_types),
        is_critical: toBool(r.is_critical),
        default_priority: priority,
        sort_order: Number.parseInt(r.sort_order, 10) || 0,
        is_active: toBool(r.is_active, true),
      };

      let itemId = existingByCode.get(code);
      if (itemId) {
        const { error } = await supabase.from("master_checklist_items").update(payload).eq("id", itemId);
        if (error) {
          report.skipped.push({ row: rowNo, code, reason: friendlyError(error) });
          continue;
        }
        report.updated++;
      } else {
        const { data, error } = await supabase.from("master_checklist_items").insert(payload).select("id").single();
        if (error || !data) {
          report.skipped.push({ row: rowNo, code, reason: friendlyError(error) });
          continue;
        }
        itemId = data.id;
        existingByCode.set(code, data.id);
        report.inserted++;
      }

      if (typeCodes.length > 0) {
        await supabase.from("master_item_engagement_types").delete().eq("master_item_id", itemId!);
        await supabase
          .from("master_item_engagement_types")
          .insert(typeCodes.map((t) => ({ master_item_id: itemId!, engagement_type_id: typeByCode.get(t)! })));
      }
    }

    revalidatePath("/admin/checklist");
    return { ok: true, data: report };
  } catch (e) {
    return { ok: false, error: friendlyError(e) };
  }
}
