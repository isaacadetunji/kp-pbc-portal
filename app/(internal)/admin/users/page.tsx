import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { requireAdmin } from "@/lib/auth";
import type { Profile } from "@/lib/types";
import { UsersAdmin } from "./users-admin";

export const metadata: Metadata = { title: "Users & access" };

export default async function UsersPage() {
  const { supabase, profile } = await requireAdmin();
  const { data } = await supabase.from("profiles").select("*").order("app_role").order("full_name");
  return (
    <div className="space-y-6">
      <PageHeader title="Users & access" description="Super Admins manage administrators. Admins manage staff, clients and client users. Staff only see engagements they are assigned to." />
      <UsersAdmin users={(data as Profile[]) ?? []} me={profile.id} myRole={profile.app_role} />
    </div>
  );
}
