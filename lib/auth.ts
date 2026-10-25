import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { normaliseRolePermissions, permissionsFor, type AppPermission, type Permissions } from "@/lib/permissions";
import { normaliseStageLabels, type StageLabels } from "@/lib/stages";
import type { Profile } from "@/lib/types";

/** Current user + profile for this request (memoised per request). */
export const getSession = cache(async () => {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub as string | undefined;
  if (!userId) return { supabase, profile: null as Profile | null, aal: null as string | null };
  const { data: profile } = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle<Profile>();
  const aal = (claimsData?.claims?.aal as string | undefined) ?? "aal1";
  return { supabase, profile: profile ?? null, aal };
});

/** Enforce MFA for internal users where required (profile flag or firm setting). */
async function enforceMfa(profile: Profile, aal: string | null) {
  const { supabase } = await getSession();
  const { data: factors } = await supabase.auth.mfa.listFactors();
  const verified = (factors?.totp ?? []).filter((f) => f.status === "verified");
  if (verified.length > 0 && aal !== "aal2") redirect("/mfa");

  let required = profile.mfa_required;
  if (!required && profile.app_role !== "client") {
    const { data } = await supabase.from("app_settings").select("value").eq("key", "security.mfa_required_for_staff").maybeSingle();
    required = data?.value === true;
  }
  if (required && verified.length === 0) redirect("/mfa?enroll=1");
}

export async function requireUser() {
  const s = await getSession();
  if (!s.profile) redirect("/login");
  if (!s.profile.is_active) redirect("/login?reason=inactive");
  await enforceMfa(s.profile, s.aal);
  const last = s.profile.last_seen_at ? Date.parse(s.profile.last_seen_at) : 0;
  if (Date.now() - last > 10 * 60_000) {
    await s.supabase.from("profiles").update({ last_seen_at: new Date().toISOString() }).eq("id", s.profile.id);
  }
  return s as typeof s & { profile: Profile };
}

export async function requireStaff() {
  const s = await requireUser();
  if (s.profile.app_role === "client") redirect("/portal");
  return s;
}

/** @deprecated Admin areas are permission based now: use requirePermission() or requireSuperAdmin(). */
export async function requireAdmin() {
  const s = await requireStaff();
  if (s.profile.app_role !== "admin" && s.profile.app_role !== "super_admin") redirect("/dashboard");
  return s;
}

/**
 * The signed-in user's app permissions (Settings > Access matrix; Super admin
 * has all). Mirrors public.has_app_permission(); the database still enforces
 * every permission, this only decides what the UI shows.
 */
export const getPermissions = cache(async (): Promise<Permissions> => {
  const { supabase, profile } = await getSession();
  if (!profile || !profile.is_active) return permissionsFor(null, normaliseRolePermissions(null));
  if (profile.app_role === "super_admin" || profile.app_role === "client") return permissionsFor(profile.app_role, normaliseRolePermissions(null));
  const { data } = await supabase.from("app_settings").select("value").eq("key", "role_permissions").maybeSingle();
  return permissionsFor(profile.app_role, normaliseRolePermissions(data?.value));
});

/** Page guard: firm user holding the permission (else back to the dashboard). */
export async function requirePermission(perm: AppPermission) {
  const s = await requireStaff();
  const perms = await getPermissions();
  if (!perms[perm]) redirect("/dashboard");
  return { ...s, perms };
}

/** Page guard: Super admin only (Settings). */
export async function requireSuperAdmin() {
  const s = await requireStaff();
  if (s.profile.app_role !== "super_admin") redirect("/dashboard");
  return s;
}

/** For server actions: throws unless the user holds the permission. */
export async function actionPermission(perm: AppPermission) {
  const s = await actionUser(["super_admin", "admin", "staff"]);
  const perms = await getPermissions();
  if (!perms[perm]) throw new Error("You don't have permission to do that.");
  return { ...s, perms };
}

/** For server actions: throws unless the user is a Super admin. */
export async function actionSuperAdmin() {
  return actionUser(["super_admin"]);
}

/** Stage display names (Settings > Engagements). Readable by every signed-in user. */
export const getStageLabels = cache(async (): Promise<StageLabels> => {
  const { supabase } = await getSession();
  const { data } = await supabase.from("app_settings").select("value").eq("key", "stage_labels").maybeSingle();
  return normaliseStageLabels(data?.value);
});

export async function requireClient() {
  const s = await requireUser();
  if (s.profile.app_role !== "client") redirect("/dashboard");
  return s;
}

/** For server actions: returns the profile or throws (no redirect). */
export async function actionUser(roles?: Profile["app_role"][]) {
  const s = await getSession();
  if (!s.profile || !s.profile.is_active) throw new Error("You are not signed in");
  if (roles && !roles.includes(s.profile.app_role)) throw new Error("You don't have permission to do that.");
  return s as typeof s & { profile: Profile };
}
