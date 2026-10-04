import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { requireStaff } from "@/lib/auth";
import type { Client, ClientContact, EngagementType, MasterCategory, MasterItem, Person } from "@/lib/types";
import { NewEngagementWizard } from "./wizard";

export const metadata: Metadata = { title: "New engagement" };

export default async function NewEngagementPage({ searchParams }: { searchParams: Promise<{ client?: string }> }) {
  const { supabase, profile } = await requireStaff();
  const { client } = await searchParams;
  const [clients, contacts, types, staff, cats, items] = await Promise.all([
    supabase.from("clients").select("*").eq("is_active", true).order("name"),
    supabase.from("client_contacts").select("*").order("is_primary", { ascending: false }),
    supabase.from("engagement_types").select("*").eq("is_active", true).order("sort_order"),
    supabase.from("profiles").select("id, full_name, email, app_role").in("app_role", ["super_admin", "admin", "staff"]).eq("is_active", true).order("full_name"),
    supabase.from("master_categories").select("*").eq("is_active", true).order("sort_order"),
    supabase.from("master_checklist_items").select("*, master_item_engagement_types(engagement_type_id)").eq("is_active", true).order("sort_order"),
  ]);
  return (
    <div className="space-y-6">
      <PageHeader title="New engagement" description="Pick the client, set the scope, then tailor the request list proposed from the master checklist." />
      <NewEngagementWizard
        me={profile.id}
        initialClientId={client}
        clients={(clients.data as Client[]) ?? []}
        contacts={(contacts.data as ClientContact[]) ?? []}
        types={(types.data as EngagementType[]) ?? []}
        staff={(staff.data as Person[]) ?? []}
        categories={(cats.data as MasterCategory[]) ?? []}
        masterItems={(items.data as MasterItem[]) ?? []}
      />
    </div>
  );
}
