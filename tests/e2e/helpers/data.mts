/**
 * Direct, service-role access to the local PostgREST (through the gateway) for test
 * setup and assertions. Never used by the app; never point this at a real project.
 */
import { serviceRoleKey, supabaseUrl, seedYear } from "./env.mts";

export async function rest<T = unknown>(pathAndQuery: string, init: RequestInit = {}): Promise<T> {
  if (!serviceRoleKey) throw new Error("SERVICE_ROLE_KEY not found (is the stack running? see $KP_E2E_STATE/keys.env)");
  const res = await fetch(`${supabaseUrl}/rest/v1/${pathAndQuery}`, {
    ...init,
    headers: {
      apikey: serviceRoleKey,
      authorization: `Bearer ${serviceRoleKey}`,
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`REST ${pathAndQuery} -> ${res.status}: ${body}`);
  return (body ? JSON.parse(body) : null) as T;
}

export interface EngagementRow { id: string; code: string; name: string; status: string; clients: { name: string } | null }

export async function engagements(): Promise<EngagementRow[]> {
  return rest<EngagementRow[]>("engagements?select=id,code,name,status,clients(name)&order=code");
}

/** The seeded, released Adebayo Foods statutory audit for last year (the one with activity). */
export async function mainEngagement(): Promise<EngagementRow> {
  const all = await engagements();
  const e = all.find((x) => x.clients?.name === "Adebayo Foods Plc" && x.name.includes(`FY${seedYear}`) && x.status !== "draft");
  if (!e) throw new Error(`seeded FY${seedYear} Adebayo Foods engagement not found; run npm run seed:demo`);
  return e;
}

export interface ItemRow { id: string; code: string; title: string; status: string; is_critical: boolean }

export async function items(engagementId: string, filter = ""): Promise<ItemRow[]> {
  return rest<ItemRow[]>(`request_items?select=id,code,title,status,is_critical&engagement_id=eq.${engagementId}${filter}&order=code`);
}

export async function item(id: string): Promise<ItemRow> {
  const [row] = await rest<ItemRow[]>(`request_items?select=id,code,title,status,is_critical&id=eq.${id}`);
  if (!row) throw new Error(`item ${id} not found`);
  return row;
}
