import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getClientDirectory, type DirectoryClient } from "./index";

export interface SyncResult {
  mode: string;
  fetched: number;
  inserted: number;
  updated: number;
  contactsUpserted: number;
  deactivated: number;
  errors: string[];
}

function toRow(c: DirectoryClient) {
  return {
    external_id: c.externalId,
    source: "api" as const,
    name: c.name,
    rc_number: c.rcNumber ?? null,
    tin: c.tin ?? null,
    industry: c.industry ?? null,
    nature_of_business: c.natureOfBusiness ?? null,
    address: c.address ?? null,
    year_end_month: c.yearEndMonth ?? null,
    year_end_day: c.yearEndDay ?? null,
    email: c.email ?? null,
    phone: c.phone ?? null,
    is_active: c.isActive,
    last_synced_at: new Date().toISOString(),
    raw: (c.raw ?? null) as never,
  };
}

/**
 * Pull clients from the client database into the portal. The directory is the
 * source of truth for master data; portal-only data (engagements, access) is
 * never overwritten. Must only be called after requireAdmin().
 */
export async function syncClientsFromDirectory(): Promise<SyncResult> {
  const directory = getClientDirectory();
  const admin = createAdminClient();
  const result: SyncResult = { mode: directory.mode, fetched: 0, inserted: 0, updated: 0, contactsUpserted: 0, deactivated: 0, errors: [] };

  const clients = await directory.listClients();
  result.fetched = clients.length;

  // Groups (by name) from the directory
  const groupIds = new Map<string, string>();
  const { data: existingGroups } = await admin.from("client_groups").select("id, name");
  (existingGroups ?? []).forEach((g) => groupIds.set(g.name.toLowerCase(), g.id));
  for (const name of new Set(clients.map((c) => c.groupName?.trim()).filter(Boolean) as string[])) {
    if (!groupIds.has(name.toLowerCase())) {
      const { data: g, error } = await admin.from("client_groups").insert({ name }).select("id").single();
      if (g) groupIds.set(name.toLowerCase(), g.id);
      else if (error) result.errors.push(`Group ${name}: ${error.message}`);
    }
  }

  const { data: existing } = await admin.from("clients").select("id, external_id").not("external_id", "is", null);
  const byExt = new Map((existing ?? []).map((r) => [r.external_id as string, r.id as string]));

  for (const c of clients) {
    const isNew = !byExt.has(c.externalId);
    const { data: row, error } = await admin
      .from("clients")
      .upsert({ ...toRow(c), ...(c.groupName ? { group_id: groupIds.get(c.groupName.trim().toLowerCase()) ?? null } : {}) }, { onConflict: "external_id" })
      .select("id")
      .single();
    if (error || !row) {
      result.errors.push(`${c.name}: ${error?.message ?? "upsert failed"}`);
      continue;
    }
    if (isNew) result.inserted++;
    else result.updated++;

    for (const ct of c.contacts) {
      const { error: cErr } = await admin.from("client_contacts").upsert(
        {
          client_id: row.id,
          external_id: ct.externalId ?? null,
          full_name: ct.fullName,
          email: ct.email.toLowerCase(),
          phone: ct.phone ?? null,
          position: ct.position ?? null,
          is_primary: Boolean(ct.isPrimary),
        },
        { onConflict: "client_id,email" },
      );
      if (cErr) result.errors.push(`${c.name} / ${ct.email}: ${cErr.message}`);
      else result.contactsUpserted++;
    }
  }
  return result;
}
