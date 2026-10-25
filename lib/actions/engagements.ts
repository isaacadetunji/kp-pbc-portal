"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionUser } from "@/lib/auth";
import { publicEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { friendlyError } from "@/lib/utils";
import type { ActionResult } from "./result";

const inviteSchema = z.object({
  engagementId: z.string().uuid(),
  contactId: z.string().uuid().optional(),
  fullName: z.string().trim().min(2).max(120).optional(),
  email: z.string().trim().toLowerCase().email().optional(),
  phone: z.string().trim().max(40).optional().or(z.literal("")),
  position: z.string().trim().max(120).optional().or(z.literal("")),
});

/**
 * Grant a client contact access to an engagement and send them a sign-in
 * email: an invitation (new user) or a magic link (existing user).
 */
export async function inviteClientContact(
  input: z.infer<typeof inviteSchema>,
): Promise<ActionResult<{ invited: "new_user" | "magic_link" | "access_only"; email: string }>> {
  try {
    const parsed = inviteSchema.parse(input);
    const { supabase } = await actionUser(["super_admin", "admin", "staff"]);

    const { data: canManage } = await supabase.rpc("can_manage_engagement", { p_engagement_id: parsed.engagementId });
    if (!canManage) return { ok: false, error: "Only a partner, the team lead or a manager can invite client users." };

    const { data: eng } = await supabase
      .from("engagements")
      .select("id, client_id, status, code, name")
      .eq("id", parsed.engagementId)
      .single();
    if (!eng) return { ok: false, error: "Engagement not found" };

    // Find or create the contact on this client
    let contact: { id: string; email: string; full_name: string; user_id: string | null } | null = null;
    if (parsed.contactId) {
      const { data } = await supabase
        .from("client_contacts")
        .select("id, email, full_name, user_id, client_id")
        .eq("id", parsed.contactId)
        .single();
      if (!data || data.client_id !== eng.client_id) return { ok: false, error: "Contact does not belong to this client" };
      contact = data;
    } else {
      if (!parsed.email || !parsed.fullName) return { ok: false, error: "Name and email are required" };
      const { data, error } = await supabase
        .from("client_contacts")
        .upsert(
          {
            client_id: eng.client_id,
            full_name: parsed.fullName,
            email: parsed.email,
            phone: parsed.phone || null,
            position: parsed.position || null,
          },
          { onConflict: "client_id,email" },
        )
        .select("id, email, full_name, user_id")
        .single();
      if (error || !data) return { ok: false, error: friendlyError(error) };
      contact = data;
    }

    const admin = createAdminClient();
    const redirectTo = `${publicEnv.siteUrl}/auth/confirm?next=/portal`;
    let invited: "new_user" | "magic_link" | "access_only" = "access_only";

    // Make sure a portal account exists (role defaults to "client")
    const { data: existingProfile } = await admin
      .from("profiles")
      .select("id, app_role")
      .eq("email", contact.email)
      .maybeSingle();

    if (existingProfile && existingProfile.app_role !== "client") {
      return { ok: false, error: "That email belongs to a firm user. Client access needs a client email address." };
    }

    if (!existingProfile) {
      const { error } = await admin.auth.admin.inviteUserByEmail(contact.email, {
        data: { full_name: contact.full_name },
        redirectTo: `${publicEnv.siteUrl}/auth/confirm?next=/auth/set-password`,
      });
      if (error) return { ok: false, error: `Could not send invitation: ${error.message}` };
      invited = "new_user";
    }

    // Grant (or restore) access
    const { data: existingAccess } = await supabase
      .from("engagement_client_access")
      .select("id, revoked_at")
      .eq("engagement_id", eng.id)
      .eq("contact_id", contact.id)
      .maybeSingle();
    if (existingAccess) {
      if (existingAccess.revoked_at) {
        const { error } = await supabase
          .from("engagement_client_access")
          .update({ revoked_at: null, invited_at: new Date().toISOString() })
          .eq("id", existingAccess.id);
        if (error) return { ok: false, error: friendlyError(error) };
      }
    } else {
      const { data: me } = await supabase.auth.getUser();
      const { error } = await supabase
        .from("engagement_client_access")
        .insert({ engagement_id: eng.id, contact_id: contact.id, invited_by: me.user?.id });
      if (error) return { ok: false, error: friendlyError(error) };
    }

    // Existing users get a magic link, but only once the list has been issued
    if (existingProfile && eng.status !== "draft") {
      const { error } = await admin.auth.signInWithOtp({
        email: contact.email,
        options: { shouldCreateUser: false, emailRedirectTo: redirectTo },
      });
      if (!error) invited = "magic_link";
    }

    revalidatePath(`/engagements/${eng.id}`);
    return { ok: true, data: { invited, email: contact.email } };
  } catch (e) {
    return { ok: false, error: friendlyError(e) };
  }
}
