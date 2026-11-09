import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getClientDirectory, type DirectoryClient } from "./index";

export interface SyncResult {
  mode: string;
  fetched: number;
  inserted: number;
  updated: number;
  /** Manual clients matched by name and merged into synced clients (dedupe). */
  merged: number;
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
  const result: SyncResult = { mode: directory.mode, fetched: 0, inserted: 0, updated: 0, merged: 0, contactsUpserted: 0, deactivated: 0, errors: [] };

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

  // Match incoming records to existing clients first by external_id, then by
  // case-insensitive name. Matching by name lets a MANUAL client be merged in
  // place (its external_id / source / details are filled from the directory and
  // the "Manual" flag disappears) instead of creating a duplicate.
  const { data: existing } = await admin.from("clients").select("id, external_id, name, source");
  const byExt = new Map<string, string>();
  const byName = new Map<string, { id: string; source: string }>();
  (existing ?? []).forEach((r) => {
    if (r.external_id) byExt.set(r.external_id as string, r.id as string);
    byName.set((r.name as string).trim().toLowerCase(), { id: r.id as string, source: r.source as string });
  });

  for (const c of clients) {
    const nameKey = c.name.trim().toLowerCase();
    const matchById = byExt.get(c.externalId);
    const matchByName = byName.get(nameKey);
    const existingId = matchById ?? matchByName?.id;
    const isNew = !existingId;
    const mergedManual = !matchById && matchByName?.source === "manual";
    const groupPatch = c.groupName ? { group_id: groupIds.get(c.groupName.trim().toLowerCase()) ?? null } : {};
    // Update in place when we matched an existing row (by id or by name);
    // otherwise insert. A name match on a manual client turns it into a synced
    // client (external_id set, source='api').
    const { data: row, error } = existingId
      ? await admin.from("clients").update({ ...toRow(c), ...groupPatch }).eq("id", existingId).select("id").single()
      : await admin.from("clients").insert({ ...toRow(c), ...groupPatch }).select("id").single();
    if (error || !row) {
      result.errors.push(`${c.name}: ${error?.message ?? "upsert failed"}`);
      continue;
    }
    // Keep the in-memory maps current so two incoming rows can't both merge onto
    // (or re-create) the same client within one sync.
    byExt.set(c.externalId, row.id as string);
    byName.set(nameKey, { id: row.id as string, source: "api" });
    if (isNew) result.inserted++;
    else result.updated++;
    if (mergedManual) result.merged++;

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
