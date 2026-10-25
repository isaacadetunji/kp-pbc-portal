import type { Metadata } from "next";
import { serverEnv } from "@/lib/env";
import { getBrand, getUploadSettings, requireSettingsAccess } from "@/lib/settings";
import { SettingsForm } from "./settings-form";

export const metadata: Metadata = { title: "Settings · General" };

export default async function SettingsPage() {
  const { supabase } = await requireSettingsAccess();
  const [brand, uploads, { data: mfa }] = await Promise.all([
    getBrand(),
    getUploadSettings(),
    supabase.from("app_settings").select("value").eq("key", "security.mfa_required_for_staff").maybeSingle(),
  ]);
  const env = serverEnv();
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">General</h2>
        <p className="text-sm text-muted-foreground">Branding, upload rules, security and integration status.</p>
      </div>
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
