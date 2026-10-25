import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { requirePermission } from "@/lib/auth";
import type { Profile } from "@/lib/types";
import { UsersAdmin } from "./users-admin";

export const metadata: Metadata = { title: "Users & access" };

export default async function UsersPage() {
  const { supabase, profile } = await requirePermission("manage_users");
  const { data } = await supabase.from("profiles").select("*").order("app_role").order("full_name");
  return (
    <div className="space-y-6">
      <PageHeader title="Users & access" description="Super admins manage administrators. People with the Users &amp; access permission manage staff and client users. Firm users see the engagements they are on or created (unless they may see every engagement)." />
      <UsersAdmin users={(data as Profile[]) ?? []} me={profile.id} myRole={profile.app_role} />
    </div>
  );
}
