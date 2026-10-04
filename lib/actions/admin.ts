"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionUser } from "@/lib/auth";
import { publicEnv } from "@/lib/env";
import { syncClientsFromDirectory, type SyncResult } from "@/lib/integrations/client-directory/sync";
import { getClientDirectory } from "@/lib/integrations/client-directory";
import { createAdminClient } from "@/lib/supabase/admin";
import { friendlyError } from "@/lib/utils";
import type { ActionResult } from "./result";

async function requireAdminAction() {
  return actionUser(["admin", "super_admin"]);
}

const ADMIN_ROLES = ["admin", "super_admin"];

const inviteStaffSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email(),
  role: z.enum(["super_admin", "admin", "staff"]),
  jobTitle: z.string().trim().max(120).optional().or(z.literal("")),
});

export async function inviteStaffUser(input: z.infer<typeof inviteStaffSchema>): Promise<ActionResult<{ userId: string }>> {
  try {
    const { profile: me } = await requireAdminAction();
    const v = inviteStaffSchema.parse(input);
    if (ADMIN_ROLES.includes(v.role) && me.app_role !== "super_admin") {
      return { ok: false, error: "Only the Super Admin can add administrators." };
    }
    const admin = createAdminClient();
    const { data: exists } = await admin.from("profiles").select("id").eq("email", v.email).maybeSingle();
    if (exists) return { ok: false, error: "A user with that email already exists." };

    const { data, error } = await admin.auth.admin.inviteUserByEmail(v.email, {
      data: { full_name: v.fullName },
      redirectTo: `${publicEnv.siteUrl}/auth/confirm?next=/auth/set-password`,
    });
    if (error || !data.user) return { ok: false, error: `Could not send invitation: ${error?.message}` };

    // Role lives in app_metadata (not user-editable) and on the profile
    await admin.auth.admin.updateUserById(data.user.id, { app_metadata: { app_role: v.role } });
    const { error: pErr } = await admin
      .from("profiles")
      .update({ app_role: v.role, full_name: v.fullName, job_title: v.jobTitle || null })
      .eq("id", data.user.id);
    if (pErr) return { ok: false, error: friendlyError(pErr) };
    revalidatePath("/admin/users");
    return { ok: true, data: { userId: data.user.id } };
  } catch (e) {
    return { ok: false, error: friendlyError(e) };
  }
}

const updateUserSchema = z.object({
  userId: z.string().uuid(),
  role: z.enum(["super_admin", "admin", "staff", "client"]).optional(),
  isActive: z.boolean().optional(),
  mfaRequired: z.boolean().optional(),
  fullName: z.string().trim().min(1).max(120).optional(),
  jobTitle: z.string().trim().max(120).optional().nullable(),
});

export async function updateUser(input: z.infer<typeof updateUserSchema>): Promise<ActionResult> {
  try {
    const { profile: me } = await requireAdminAction();
    const v = updateUserSchema.parse(input);
    if (v.userId === me.id && ((v.role && v.role !== me.app_role) || v.isActive === false)) {
      return { ok: false, error: "You cannot change your own role or deactivate yourself." };
    }
    const admin = createAdminClient();
    const { data: target } = await admin.from("profiles").select("app_role").eq("id", v.userId).single();
    if (!target) return { ok: false, error: "User not found" };
    const touchesAdmin = ADMIN_ROLES.includes(target.app_role) || (v.role && ADMIN_ROLES.includes(v.role));
    if (touchesAdmin && me.app_role !== "super_admin") {
      return { ok: false, error: "Only the Super Admin can change administrators." };
    }
    if (v.role && (v.role === "client") !== (target.app_role === "client")) {
      return { ok: false, error: "Firm users and client users can't be converted into each other." };
    }
    if (target.app_role === "super_admin" && ((v.role && v.role !== "super_admin") || v.isActive === false)) {
      const { count } = await admin.from("profiles").select("id", { count: "exact", head: true })
        .eq("app_role", "super_admin").eq("is_active", true);
      if ((count ?? 0) <= 1) return { ok: false, error: "There must always be at least one active Super Admin." };
    }
    const patch: Record<string, unknown> = {};
    if (v.role) patch.app_role = v.role;
    if (v.isActive !== undefined) patch.is_active = v.isActive;
    if (v.mfaRequired !== undefined) patch.mfa_required = v.mfaRequired;
    if (v.fullName !== undefined) patch.full_name = v.fullName;
    if (v.jobTitle !== undefined) patch.job_title = v.jobTitle;
    const { error } = await admin.from("profiles").update(patch).eq("id", v.userId);
    if (error) return { ok: false, error: friendlyError(error) };
    if (v.role) await admin.auth.admin.updateUserById(v.userId, { app_metadata: { app_role: v.role } });
    if (v.isActive === false) {
      // Block sign-in immediately (ban for ~100 years); reactivation lifts it
      await admin.auth.admin.updateUserById(v.userId, { ban_duration: "876000h" });
    } else if (v.isActive === true) {
      await admin.auth.admin.updateUserById(v.userId, { ban_duration: "none" });
    }
    revalidatePath("/admin/users");
    return { ok: true, data: undefined };
  } catch (e) {
    return { ok: false, error: friendlyError(e) };
  }
}

export async function syncClients(): Promise<ActionResult<SyncResult>> {
  try {
    await requireAdminAction();
    const result = await syncClientsFromDirectory();
    revalidatePath("/admin/clients");
    return { ok: true, data: result };
  } catch (e) {
    return { ok: false, error: friendlyError(e) };
  }
}

export async function checkClientDirectory(): Promise<ActionResult<{ mode: string; ok: boolean; message: string }>> {
  try {
    await requireAdminAction();
    const d = getClientDirectory();
    const h = await d.healthCheck();
    return { ok: true, data: { mode: d.mode, ...h } };
  } catch (e) {
    return { ok: false, error: friendlyError(e) };
  }
}

const manualClientSchema = z.object({
  name: z.string().trim().min(2).max(200),
  rcNumber: z.string().trim().max(40).optional().or(z.literal("")),
  tin: z.string().trim().max(40).optional().or(z.literal("")),
  industry: z.string().trim().max(120).optional().or(z.literal("")),
  natureOfBusiness: z.string().trim().max(500).optional().or(z.literal("")),
  address: z.string().trim().max(500).optional().or(z.literal("")),
  yearEndMonth: z.coerce.number().int().min(1).max(12).optional(),
  yearEndDay: z.coerce.number().int().min(1).max(31).optional(),
  email: z.string().trim().email().optional().or(z.literal("")),
  phone: z.string().trim().max(40).optional().or(z.literal("")),
});

/** Manual clients are flagged (source = manual) until they exist in the client database. */
export async function createManualClient(input: z.infer<typeof manualClientSchema>): Promise<ActionResult<{ id: string }>> {
  try {
    await requireAdminAction();
    const v = manualClientSchema.parse(input);
    const { data, error } = await createAdminClient()
      .from("clients")
      .insert({
        source: "manual",
        name: v.name,
        rc_number: v.rcNumber || null,
        tin: v.tin || null,
        industry: v.industry || null,
        nature_of_business: v.natureOfBusiness || null,
        address: v.address || null,
        year_end_month: v.yearEndMonth ?? 12,
        year_end_day: v.yearEndDay ?? 31,
        email: v.email || null,
        phone: v.phone || null,
      })
      .select("id")
      .single();
    if (error || !data) return { ok: false, error: friendlyError(error) };
    revalidatePath("/admin/clients");
    return { ok: true, data: { id: data.id } };
  } catch (e) {
    return { ok: false, error: friendlyError(e) };
  }
}

export async function setClientActive(clientId: string, isActive: boolean): Promise<ActionResult> {
  try {
    await requireAdminAction();
    const { error } = await createAdminClient().from("clients").update({ is_active: isActive }).eq("id", clientId);
    if (error) return { ok: false, error: friendlyError(error) };
    revalidatePath("/admin/clients");
    return { ok: true, data: undefined };
  } catch (e) {
    return { ok: false, error: friendlyError(e) };
  }
}

// ---------------------------------------------------------------------------
// Client groups & contacts
// ---------------------------------------------------------------------------
export async function createClientGroup(name: string): Promise<ActionResult<{ id: string }>> {
  try {
    await requireAdminAction();
    const n = z.string().trim().min(2).max(200).parse(name);
    const { data, error } = await createAdminClient().from("client_groups").insert({ name: n }).select("id").single();
    if (error || !data) return { ok: false, error: /duplicate/i.test(error?.message ?? "") ? "A group with that name exists" : friendlyError(error) };
    revalidatePath("/admin/clients");
    return { ok: true, data: { id: data.id } };
  } catch (e) {
    return { ok: false, error: friendlyError(e) };
  }
}

export async function setClientGroup(clientId: string, groupId: string | null): Promise<ActionResult> {
  try {
    await requireAdminAction();
    const { error } = await createAdminClient().from("clients").update({ group_id: groupId }).eq("id", clientId);
    if (error) return { ok: false, error: friendlyError(error) };
    revalidatePath("/admin/clients");
    return { ok: true, data: undefined };
  } catch (e) {
    return { ok: false, error: friendlyError(e) };
  }
}

const contactSchema = z.object({
  clientIds: z.array(z.string().uuid()).min(1),
  fullName: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email(),
  phone: z.string().trim().max(40).optional().or(z.literal("")),
  position: z.string().trim().max(120).optional().or(z.literal("")),
});

/** Add one person as a contact of one or more entities (e.g. a group CFO).
 *  Engagement access is still granted per engagement by the engagement team. */
export async function addClientContact(input: z.infer<typeof contactSchema>): Promise<ActionResult<{ added: number }>> {
  try {
    await requireAdminAction();
    const v = contactSchema.parse(input);
    const admin = createAdminClient();
    const { data: staff } = await admin.from("profiles").select("app_role").eq("email", v.email).maybeSingle();
    if (staff && staff.app_role !== "client") return { ok: false, error: "That email belongs to a firm user." };
    const { error } = await admin.from("client_contacts").upsert(
      v.clientIds.map((clientId) => ({
        client_id: clientId, full_name: v.fullName, email: v.email, phone: v.phone || null, position: v.position || null,
      })),
      { onConflict: "client_id,email" },
    );
    if (error) return { ok: false, error: friendlyError(error) };
    revalidatePath("/admin/clients");
    return { ok: true, data: { added: v.clientIds.length } };
  } catch (e) {
    return { ok: false, error: friendlyError(e) };
  }
}
