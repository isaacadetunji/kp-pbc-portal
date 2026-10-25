import type { Metadata } from "next";
import { requireSuperAdmin } from "@/lib/auth";
import { normaliseRolePermissions } from "@/lib/permissions";
import { AccessMatrix } from "./access-matrix";

export const metadata: Metadata = { title: "Settings · Access" };

export default async function AccessSettingsPage() {
  const { supabase } = await requireSuperAdmin();
  const { data } = await supabase.from("app_settings").select("value, updated_at").eq("key", "role_permissions").maybeSingle();
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Access</h2>
        <p className="text-sm text-muted-foreground">
          Choose what Admins and Staff can do. Super admins can always do everything, and only Super admins see Settings.
        </p>
      </div>
      <AccessMatrix initial={normaliseRolePermissions(data?.value)} updatedAt={(data?.updated_at as string | undefined) ?? null} />
    </div>
  );
}
