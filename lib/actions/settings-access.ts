"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionSuperAdmin } from "@/lib/auth";
import { APP_PERMISSIONS, normaliseRolePermissions, type RolePermissions } from "@/lib/permissions";
import { STAGE_KEYS, normaliseStageLabels, validCodeFormat, type StageLabels } from "@/lib/stages";
import { friendlyError } from "@/lib/utils";
import type { ActionResult } from "./result";

/**
 * Settings > Access and Settings > Engagements. Super admin only. Writes use
 * the signed-in user's session, so RLS (app_settings / engagement_types:
 * is_super_admin()) is the real check; the guard gives a clear message.
 */
async function upsertSetting(key: string, value: unknown) {
  const { supabase, profile } = await actionSuperAdmin();
  const { error } = await supabase
    .from("app_settings")
    .upsert({ key, value, updated_by: profile.id, updated_at: new Date().toISOString() }, { onConflict: "key" });
  return error;
}

const permRow = z.object(Object.fromEntries(APP_PERMISSIONS.map((p) => [p.key, z.boolean()])) as Record<string, z.ZodBoolean>);
const matrixSchema = z.object({ admin: permRow, staff: permRow });

export async function saveRolePermissions(input: RolePermissions): Promise<ActionResult<RolePermissions>> {
  try {
    const v = normaliseRolePermissions(matrixSchema.parse(input));
    const error = await upsertSetting("role_permissions", v);
    if (error) return { ok: false, error: friendlyError(error) };
    revalidatePath("/", "layout");
    return { ok: true, data: v };
  } catch (e) {
    return { ok: false, error: friendlyError(e) };
  }
}

const labelsSchema = z.object(
  Object.fromEntries(STAGE_KEYS.map((k) => [k, z.string().trim().min(1, "Every stage needs a name").max(40, "Stage names are at most 40 characters")])) as Record<string, z.ZodString>,
);

export async function saveStageLabels(input: StageLabels): Promise<ActionResult<StageLabels>> {
  try {
    const v = normaliseStageLabels(labelsSchema.parse(input));
    const error = await upsertSetting("stage_labels", v);
    if (error) return { ok: false, error: friendlyError(error) };
    revalidatePath("/", "layout");
    return { ok: true, data: v };
  } catch (e) {
    return { ok: false, error: friendlyError(e) };
  }
}

export async function saveCodeFormat(format: string): Promise<ActionResult> {
  try {
    const f = z.string().trim().parse(format);
    if (!validCodeFormat(f)) {
      return { ok: false, error: "Use 3 to 40 characters: letters, digits, - _ . and the tokens shown, including a {SEQ…} running number." };
    }
    const error = await upsertSetting("engagement_code_format", f);
    if (error) return { ok: false, error: friendlyError(error) };
    revalidatePath("/admin/settings/engagements");
    return { ok: true, data: undefined };
  } catch (e) {
    return { ok: false, error: friendlyError(e) };
  }
}

const typeSchema = z.object({
  id: z.string().uuid().optional(),
  code: z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9]{1,9}$/, "Type code: 2 to 10 letters or digits, starting with a letter"),
  name: z.string().trim().min(2, "Enter a name").max(80),
  codePrefix: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{1,10}$/, "Code prefix: 1 to 10 letters or digits"),
  isActive: z.boolean(),
});

export async function saveEngagementType(input: z.infer<typeof typeSchema>): Promise<ActionResult<{ id: string }>> {
  try {
    const v = typeSchema.parse(input);
    const { supabase } = await actionSuperAdmin();
    if (v.id) {
      const { error } = await supabase
        .from("engagement_types")
        .update({ name: v.name, code_prefix: v.codePrefix, is_active: v.isActive })
        .eq("id", v.id);
      if (error) return { ok: false, error: friendlyError(error) };
      revalidatePath("/admin/settings/engagements");
      return { ok: true, data: { id: v.id } };
    }
    const { data: existing } = await supabase.from("engagement_types").select("sort_order, code");
    if ((existing ?? []).some((t) => t.code.toUpperCase() === v.code)) return { ok: false, error: `The type code ${v.code} is already used.` };
    const sort = Math.max(0, ...(existing ?? []).map((t) => t.sort_order as number)) + 10;
    const { data, error } = await supabase
      .from("engagement_types")
      .insert({ code: v.code, name: v.name, code_prefix: v.codePrefix, is_active: v.isActive, sort_order: sort })
      .select("id")
      .single();
    if (error || !data) return { ok: false, error: friendlyError(error) };
    revalidatePath("/admin/settings/engagements");
    return { ok: true, data: { id: data.id as string } };
  } catch (e) {
    return { ok: false, error: friendlyError(e) };
  }
}
