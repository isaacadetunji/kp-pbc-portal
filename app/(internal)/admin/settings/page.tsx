import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { requireAdmin } from "@/lib/auth";
import { serverEnv } from "@/lib/env";
import { getBrand, getUploadSettings } from "@/lib/settings";
import { SettingsForm } from "./settings-form";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const { supabase } = await requireAdmin();
  const [brand, uploads, { data: mfa }] = await Promise.all([
    getBrand(),
    getUploadSettings(),
    supabase.from("app_settings").select("value").eq("key", "security.mfa_required_for_staff").maybeSingle(),
  ]);
  const env = serverEnv();
  return (
    <div className="space-y-6">
      <PageHeader title="Settings" description="Branding, upload rules, security and integration status." />
      <SettingsForm
        brand={brand}
        uploads={uploads}
        mfaForStaff={mfa?.value === true}
        integrations={{
          storage: env.storageProvider,
          clientDirectory: env.clientDirectoryMode,
          email: env.emailProvider,
          sessionIdleMinutes: env.sessionIdleMinutes,
        }}
      />
    </div>
  );
}
