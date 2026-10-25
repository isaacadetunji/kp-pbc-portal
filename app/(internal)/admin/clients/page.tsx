import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { requirePermission } from "@/lib/auth";
import { serverEnv } from "@/lib/env";
import type { Client, ClientContact, ClientGroup } from "@/lib/types";
import { ClientsAdmin, type ClientEngagement } from "./clients-admin";

export const metadata: Metadata = { title: "Clients" };

export default async function ClientsPage() {
  const { supabase, perms } = await requirePermission("manage_clients");
  const [{ data: clients }, { data: contacts }, { data: engs }, { data: groups }] = await Promise.all([
    supabase.from("clients").select("*").order("name"),
    supabase.from("client_contacts").select("*").order("full_name"),
    supabase.from("engagements").select("id, code, name, status, period_end, client_id, engagement_types(name)").order("period_end", { ascending: false }),
    supabase.from("client_groups").select("id, name").order("name"),
  ]);
  const engagements = ((engs ?? []) as unknown as (ClientEngagement & { engagement_types: { name: string } | null })[]).map((e) => ({
    id: e.id, code: e.code, name: e.name, status: e.status, period_end: e.period_end, client_id: e.client_id, type_name: e.engagement_types?.name ?? "",
  }));
  const engCount = engagements.reduce<Record<string, number>>((a, e) => ((a[e.client_id] = (a[e.client_id] ?? 0) + 1), a), {});
  return (
    <div className="space-y-6">
      <PageHeader title="Clients" description="Client master data synced from the firm's client database. Group related entities so one client login can cover several of them." />
      <ClientsAdmin
        clients={(clients as Client[]) ?? []}
        contacts={(contacts as ClientContact[]) ?? []}
        engagementCounts={engCount}
        engagements={engagements}
        groups={(groups as ClientGroup[]) ?? []}
        mode={serverEnv().clientDirectoryMode}
        canCreateEngagements={perms.create_engagements}
      />
    </div>
  );
}
