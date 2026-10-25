import { PageHeader } from "@/components/page-header";
import { requireSettingsAccess } from "@/lib/settings";
import { SettingsNav } from "./settings-nav";

/**
 * Settings is a Super-admin-only area. Every sub-page is also protected by
 * the database (app_settings writes require is_super_admin()).
 */
export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  await requireSettingsAccess();
  return (
    <div className="space-y-6">
      <PageHeader title="Settings" description="Firm-wide configuration. Only Super admins can see and change these settings." />
      <div className="flex flex-col gap-6 lg:flex-row">
        <SettingsNav />
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
