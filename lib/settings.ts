import "server-only";
import { cache } from "react";
import { createAdminClient } from "@/lib/supabase/admin";
import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { normaliseNotificationSettings } from "@/lib/checklist-constants";
import { DEFAULT_ALLOWED_EXTENSIONS } from "@/lib/constants";

export interface BrandSettings {
  firm_name: string;
  portal_name: string;
  primary: string;
  accent: string;
  logo_url: string | null;
}

const DEFAULT_BRAND: BrandSettings = {
  firm_name: process.env.NEXT_PUBLIC_FIRM_NAME ?? "Kreston Pedabo",
  portal_name: "PBC Portal",
  primary: "#0F77AD",
  accent: "#43BBC7",
  logo_url: "/kreston-pedabo-logo.png",
};

const HEX = /^#[0-9a-fA-F]{6}$/;

/** Branding is needed before sign-in (login page), so it is read with the
 *  service role. It contains no sensitive data. */
export const getBrand = cache(async (): Promise<BrandSettings> => {
  try {
    const { data } = await createAdminClient().from("app_settings").select("value").eq("key", "brand").maybeSingle();
    const v = { ...DEFAULT_BRAND, ...((data?.value as Partial<BrandSettings>) ?? {}) };
    if (!HEX.test(v.primary)) v.primary = DEFAULT_BRAND.primary;
    if (!HEX.test(v.accent)) v.accent = DEFAULT_BRAND.accent;
    return v;
  } catch {
    return DEFAULT_BRAND;
  }
});

export const getUploadSettings = cache(async () => {
  const { data } = await createAdminClient()
    .from("app_settings")
    .select("key, value")
    .in("key", ["uploads.max_file_mb", "uploads.allowed_extensions"]);
  const map = Object.fromEntries((data ?? []).map((r) => [r.key, r.value]));
  return {
    maxFileMb: Number(map["uploads.max_file_mb"] ?? 100),
    allowedExtensions: (map["uploads.allowed_extensions"] as string[] | undefined) ?? DEFAULT_ALLOWED_EXTENSIONS,
  };
});

/** Guard for Settings pages (Super admin only). Layouts are not re-run on
 *  every navigation, so each settings page calls this too. */
export async function requireSettingsAccess() {
  const s = await requireStaff();
  if (s.profile.app_role !== "super_admin") notFound();
  return s;
}

/** Firm-wide notification defaults (Settings > Notifications). */
export async function getNotificationDefaults() {
  const { data } = await createAdminClient().from("app_settings").select("value").eq("key", "notifications.defaults").maybeSingle();
  return normaliseNotificationSettings((data?.value as Record<string, unknown> | null) ?? null);
}
