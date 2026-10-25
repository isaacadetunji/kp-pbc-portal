/**
 * Demo data: users, one client and one engagement with activity.
 *
 *   npm run seed:demo            (reads .env.local)
 *
 * Creates (password for all: DemoPass#2026 unless DEMO_PASSWORD is set):
 *   super@demo.kp.test     Super Admin
 *   admin@demo.kp.test     Admin
 *   partner@demo.kp.test   Engagement partner (staff)
 *   lead@demo.kp.test      Team lead (staff)
 *   manager@demo.kp.test   Manager (staff)
 *   senior@demo.kp.test    Team member (staff)
 *   cfo@demo.client.test   Client user (Adebayo Foods Plc)
 *   fc@demo.client.test    Client user (Adebayo Foods Plc)
 *
 * Engagements: Adebayo Foods FY(last year) statutory audit (released, with
 * activity, calendar events and additional documents from both sides), a
 * FY(this year) DRAFT that the client users see as "Request in progress", plus two
 * group entities (one awaiting approval, one released). Requests are assigned
 * to firm and client people; one confidential request is locked (only its
 * assignees, the partner, the lead and managers see it).
 *
 * Safe to re-run: existing users are reused; the demo engagements are only
 * created if the client has no engagement yet.
 * NEVER run against production.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const bucket = process.env.SUPABASE_STORAGE_BUCKET ?? "pbc-files";
const PASSWORD = process.env.DEMO_PASSWORD ?? "DemoPass#2026";
if (!url || !anonKey || !serviceKey) throw new Error("Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY");

const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

const USERS = [
  { email: "super@demo.kp.test", name: "Funmi Akinola", role: "super_admin", title: "IT & Risk Partner" },
  { email: "admin@demo.kp.test", name: "Adaeze Admin", role: "admin", title: "Portal Administrator" },
  { email: "partner@demo.kp.test", name: "Kemi Adebayo-Lawal", role: "staff", title: "Engagement Partner" },
  { email: "lead@demo.kp.test", name: "Olumide Adeyemi", role: "staff", title: "Audit Senior Manager" },
  { email: "manager@demo.kp.test", name: "Ngozi Eze", role: "staff", title: "Audit Manager" },
  { email: "senior@demo.kp.test", name: "Bayo Ogunleye", role: "staff", title: "Audit Senior" },
  { email: "cfo@demo.client.test", name: "Chioma Okafor", role: "client", title: "Chief Financial Officer" },
  { email: "fc@demo.client.test", name: "Tunde Bakare", role: "client", title: "Financial Controller" },
] as const;

function must<T>(res: { data: T; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data;
}

async function ensureUser(u: (typeof USERS)[number]): Promise<string> {
  const { data: existing } = await admin.from("profiles").select("id").eq("email", u.email).maybeSingle();
  let id = existing?.id as string | undefined;
  if (!id) {
    const created = must(
      await admin.auth.admin.createUser({
        email: u.email,
        password: PASSWORD,
        email_confirm: true,
        user_metadata: { full_name: u.name },
        app_metadata: { app_role: u.role },
      }),
      `create ${u.email}`,
    );
    id = created.user!.id;
  }
  must(await admin.from("profiles").update({ app_role: u.role, full_name: u.name, job_title: u.title }).eq("id", id), "profile");
  return id;
}

async function signIn(email: string): Promise<SupabaseClient> {
  const c = createClient(url!, anonKey!, { auth: { persistSession: false, autoRefreshToken: false } });
  must(await c.auth.signInWithPassword({ email, password: PASSWORD }), `sign in ${email}`);
  return c;
}

function addDays(d: number) {
  const x = new Date();
  x.setDate(x.getDate() + d);
  return x.toISOString().slice(0, 10);
}

async function uploadAs(
  c: SupabaseClient, userId: string, itemId: string, name: string, body: string, mime = "application/pdf",
  kind: "client_submission" | "firm_document" | "sample_support" = "client_submission", lineId: string | null = null,
) {
  const { data, error } = await c
    .rpc("begin_upload", { p_item_id: itemId, p_file_name: name, p_mime_type: mime, p_size_bytes: Buffer.byteLength(body), p_kind: kind, p_sample_line_id: lineId })
    .single<{ file_id: string; storage_path: string }>();
  if (error || !data) throw new Error(`begin_upload ${name}: ${error?.message}`);
  must(await admin.storage.from(bucket).upload(data.storage_path, new Blob([body], { type: mime }), { contentType: mime }), `store ${name}`);
  must(await admin.rpc("complete_upload", { p_file_id: data.file_id, p_user_id: userId, p_sha256: null }), "complete_upload");
}

async function uploadDocAs(c: SupabaseClient, userId: string, engagementId: string, name: string, body: string, mime: string, description: string | null) {
  const { data, error } = await c
    .rpc("begin_document_upload", { p_engagement_id: engagementId, p_file_name: name, p_mime_type: mime, p_size_bytes: Buffer.byteLength(body), p_description: description })
    .single<{ document_id: string; storage_path: string }>();
  if (error || !data) throw new Error(`begin_document_upload ${name}: ${error?.message}`);
  must(await admin.storage.from(bucket).upload(data.storage_path, new Blob([body], { type: mime }), { contentType: mime }), `store ${name}`);
  must(await admin.rpc("complete_document_upload", { p_document_id: data.document_id, p_user_id: userId, p_sha256: null }), "complete_document_upload");
}

/** Contacts with portal accounts are granted on creation; this keeps re-runs and older DBs tidy. */
/** PostgREST bulk inserts fill missing keys with NULL, so give every row the same shape. */
type EventRow = { engagement_id: string; title: string; kind: string; starts_on: string; ends_on?: string | null; notes?: string | null; visible_to_client?: boolean };
const eventRows = (rows: EventRow[]) => rows.map((r) => ({ ends_on: null, notes: null, visible_to_client: true, ...r }));

async function grantAccess(c: SupabaseClient, engagementId: string, contactId: string) {
  must(
    await c.from("engagement_client_access").upsert({ engagement_id: engagementId, contact_id: contactId }, { onConflict: "engagement_id,contact_id", ignoreDuplicates: true }),
    "access",
  );
}

async function main() {
  const ids: Record<string, string> = {};
  for (const u of USERS) ids[u.email] = await ensureUser(u);
  console.log("✓ users");

  // Demo client (matches the mock client directory record KP-CL-0001)
  const client = must(
    await admin
      .from("clients")
      .upsert(
        {
          external_id: "KP-CL-0001",
          source: "api",
          name: "Adebayo Foods Plc",
          rc_number: "RC 104532",
          tin: "01234567-0001",
          industry: "Food & Beverage (FMCG)",
          nature_of_business: "Manufacture and distribution of packaged foods and beverages",
          address: "14 Industrial Avenue, Ikeja, Lagos",
          year_end_month: 12,
          year_end_day: 31,
          last_synced_at: new Date().toISOString(),
        },
        { onConflict: "external_id" },
      )
      .select("id")
      .single(),
    "client",
  );
  // Group with two more entities; the group CFO is a contact of all three
  let groupId = (await admin.from("client_groups").select("id").eq("name", "Adebayo Group").maybeSingle()).data?.id as string | undefined;
  if (!groupId) groupId = must(await admin.from("client_groups").insert({ name: "Adebayo Group" }).select("id").single(), "group").id;
  await admin.from("clients").update({ group_id: groupId }).eq("id", client.id);
  const siblings: { id: string; name: string }[] = [];
  for (const [ext, name, rc, industry, nature] of [
    ["KP-CL-0009", "Adebayo Agro Processing Ltd", "RC 1344210", "Agro-processing", "Cassava and maize processing"],
    ["KP-CL-0010", "Adebayo Distribution Ltd", "RC 1402277", "Distribution", "Distribution of packaged foods to retailers"],
  ] as const) {
    const row = must(
      await admin.from("clients").upsert(
        { external_id: ext, source: "api", name, rc_number: rc, industry, nature_of_business: nature, year_end_month: 12, year_end_day: 31, group_id: groupId, last_synced_at: new Date().toISOString() },
        { onConflict: "external_id" },
      ).select("id, name").single(),
      name,
    );
    siblings.push(row);
    must(await admin.from("client_contacts").upsert({ client_id: row.id, email: "cfo@demo.client.test", full_name: "Chioma Okafor", position: "Group CFO", is_primary: true }, { onConflict: "client_id,email" }), "contact");
  }
  for (const [email, name, pos, primary] of [
    ["cfo@demo.client.test", "Chioma Okafor", "Chief Financial Officer", true],
    ["fc@demo.client.test", "Tunde Bakare", "Financial Controller", false],
  ] as const) {
    must(
      await admin.from("client_contacts").upsert({ client_id: client.id, email, full_name: name, position: pos, is_primary: primary }, { onConflict: "client_id,email" }),
      "contact",
    );
  }
  console.log("✓ client");

  const { count } = await admin.from("engagements").select("id", { count: "exact", head: true }).eq("client_id", client.id);
  if (count && count > 0) {
    console.log("• demo engagement already exists; skipping");
    return;
  }

  const lead = await signIn("lead@demo.kp.test");
  const { data: sa } = await admin.from("engagement_types").select("id").eq("code", "SA").single();
  const { data: master } = await admin
    .from("master_item_engagement_types")
    .select("master_item_id")
    .eq("engagement_type_id", sa!.id);
  const year = new Date().getFullYear() - 1;
  const engId = must(
    await lead.rpc("create_engagement", {
      p_client_id: client.id,
      p_engagement_type_id: sa!.id,
      p_name: `Statutory audit — FY${year}`,
      p_period_start: `${year}-01-01`,
      p_period_end: `${year}-12-31`,
      p_lead_id: ids["lead@demo.kp.test"],
      p_master_item_ids: (master ?? []).map((m) => m.master_item_id),
      p_default_due_date: addDays(21),
      p_team: [
        { user_id: ids["partner@demo.kp.test"], team_role: "partner" },
        { user_id: ids["manager@demo.kp.test"], team_role: "manager" },
        { user_id: ids["senior@demo.kp.test"], team_role: "member" },
      ],
      p_planned_start: addDays(-14),
      p_documents_due: addDays(21),
      p_report_due: addDays(75),
    }),
    "create_engagement",
  ) as string;

  // Critical items due sooner; some overdue; assign reviewers
  const { data: items } = await lead.from("request_items").select("id, code, is_critical").eq("engagement_id", engId);
  const byCode = new Map((items ?? []).map((i) => [i.code, i]));
  const crit = (items ?? []).filter((i) => i.is_critical).map((i) => i.id);
  must(await lead.from("request_items").update({ due_date: addDays(7) }).in("id", crit), "critical due");
  const other = (items ?? []).filter((i) => !i.is_critical).map((i) => i.id);
  const assign = (itemId: string, side: "firm" | "client", users: string[]) =>
    lead.rpc("set_request_item_assignees", { p_item_id: itemId, p_side: side, p_user_ids: users });
  for (const r of await Promise.all(crit.map((id) => assign(id, "firm", [ids["manager@demo.kp.test"]!])))) must(r, "assign critical");
  for (const r of await Promise.all(other.map((id) => assign(id, "firm", [ids["senior@demo.kp.test"]!])))) must(r, "assign");
  must(await lead.from("request_items").update({ due_date: addDays(-3) }).in("code", ["CSH-01", "CSH-02", "FST-01"]), "overdue");

  // Client access, client-side assignees, a locked confidential request, then issue
  const { data: contacts } = await admin.from("client_contacts").select("id").eq("client_id", client.id);
  for (const c of contacts ?? []) await grantAccess(lead, engId, c.id);
  for (const code of ["CSH-01", "CSH-02", "FST-01"]) {
    const it = byCode.get(code);
    if (it) must(await assign(it.id, "client", [ids["fc@demo.client.test"]!]), "assign client");
  }
  const { data: hrFolder } = await lead.from("engagement_folders").select("id").eq("engagement_id", engId).order("sort_order").limit(1).single();
  if (hrFolder) {
    must(
      await lead.rpc("add_request_item", {
        p_engagement_id: engId,
        p_folder_id: hrFolder.id,
        p_title: "Directors' remuneration and benefits schedule",
        p_guidance: "Confidential: schedule of each director's emoluments, benefits in kind and bonuses for the year, agreed to payroll.",
        p_due_date: addDays(14),
        p_is_locked: true,
        p_firm_assignee_ids: [ids["manager@demo.kp.test"]],
        p_client_assignee_ids: [ids["cfo@demo.client.test"]],
      }),
      "locked request",
    );
  }
  must(await lead.rpc("issue_request_list", { p_engagement_id: engId }), "issue");
  console.log("✓ engagement issued");

  // Client activity
  const cfo = await signIn("cfo@demo.client.test");
  const cfoId = ids["cfo@demo.client.test"]!;
  const pdf = "%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n";
  for (const [code, file] of [
    ["GEN-01", "Certificate of Incorporation.pdf"],
    ["GEN-02", "CAC Status Report 2025.pdf"],
    ["GEN-03", "MEMART (amended 2021).pdf"],
    ["GEN-06", "Audited FS FY prior year.pdf"],
    ["FST-01", "Trial balance draft.pdf"],
  ] as const) {
    const it = byCode.get(code);
    if (!it) continue;
    await uploadAs(cfo, cfoId, it.id, file, pdf);
    must(await cfo.rpc("submit_item", { p_item_id: it.id, p_note: code === "GEN-03" ? "The 2021 amendment increased share capital; the special resolution is attached as page 12." : null }), `submit ${code}`);
  }
  console.log("✓ client uploads");

  // Team review
  const manager = await signIn("manager@demo.kp.test");
  must(await manager.rpc("review_item", { p_item_id: byCode.get("GEN-01")!.id, p_action: "accept", p_note: null }), "accept");
  must(await manager.rpc("review_item", { p_item_id: byCode.get("GEN-02")!.id, p_action: "accept", p_note: null }), "accept");
  must(
    await manager.rpc("review_item", {
      p_item_id: byCode.get("GEN-06")!.id,
      p_action: "query",
      p_note: "This is the draft. Please upload the signed version including the auditor's report.",
    }),
    "query",
  );
  must(
    await manager.from("comments").insert({
      request_item_id: byCode.get("GEN-03")!.id,
      author_id: ids["manager@demo.kp.test"],
      body: "Share capital per MEMART doesn't agree to the TB (N50m vs N75m). Checking the 2023 allotment return.",
      is_internal: true,
      mentions: [ids["lead@demo.kp.test"]],
    }),
    "internal comment",
  );
  if (byCode.get("GEN-09")) {
    must(await lead.rpc("waive_item", { p_item_id: byCode.get("GEN-09")!.id, p_reason: "Continuing client; we audited the prior year, so no predecessor clearance is needed." }), "waive");
  }
  must(await lead.rpc("review_item", { p_item_id: byCode.get("REV-05")!.id, p_action: "not_applicable", p_note: "Cut-off covered by analytics this year." }), "na");
  console.log("✓ team review");

  // Firm shares a sample selection and creates a sample schedule on REV-01
  const senior = await signIn("senior@demo.kp.test");
  const rev = byCode.get("REV-01");
  if (rev) {
    await uploadAs(senior, ids["senior@demo.kp.test"]!, rev.id, "Revenue samples selected.xlsx", "Date,Invoice,Customer,Amount\n", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "firm_document");
    const rows = [
      ["05/01/2025", "INV-1001", "Shoprite Nigeria", "1,250,000.00"],
      ["11/02/2025", "INV-1044", "Spar Lekki", "980,500.00"],
      ["20/03/2025", "INV-1102", "Justrite Superstores", "2,100,000.00"],
      ["02/04/2025", "INV-1150", "Ebeano Supermarket", "400,000.00"],
      ["17/05/2025", "INV-1211", "Market Square", "1,675,250.00"],
      ["09/07/2025", "INV-1307", "Hubmart Stores", "845,000.00"],
      ["28/08/2025", "INV-1388", "Prince Ebeano", "3,020,000.00"],
      ["14/10/2025", "INV-1460", "Shoprite Nigeria", "1,990,750.00"],
    ];
    const scheduleId = must(await senior.rpc("create_sample_schedule", {
      p_item_id: rev.id, p_columns: ["Invoice date", "Invoice no.", "Customer", "Amount (NGN)"], p_rows: rows,
      p_title: "Revenue samples FY" + year, p_instructions: "Sales invoice, signed delivery note/waybill and proof of payment (bank credit)",
    }), "schedule") as string;
    const { data: lines } = await admin.from("sample_lines").select("id, line_no").eq("schedule_id", scheduleId).order("line_no");
    const L = (n: number) => lines!.find((l) => l.line_no === n)!.id;
    await uploadAs(cfo, cfoId, rev.id, "INV-1001 pack.pdf", pdf, "application/pdf", "sample_support", L(1));
    await uploadAs(cfo, cfoId, rev.id, "INV-1044 invoice.pdf", pdf, "application/pdf", "sample_support", L(2));
    await uploadAs(cfo, cfoId, rev.id, "INV-1102 internal sales order.pdf", pdf, "application/pdf", "sample_support", L(3));
    must(await cfo.from("comments").insert({ request_item_id: rev.id, sample_line_id: L(2), author_id: cfoId, body: "Only 50% was invoiced in February; the balance was invoiced in March (INV-1120)." }), "line comment");
    must(await senior.rpc("set_sample_line_status", { p_line_ids: [L(1)], p_status: "received", p_note: null }), "received");
    must(await senior.rpc("set_sample_line_status", { p_line_ids: [L(3)], p_status: "queried", p_note: "This is an internal sales order. Please provide the third-party invoice and waybill." }), "query line");
  }
  console.log("✓ sample schedule");

  // Calendar: a regulatory filing, meetings, a milestone and a team-only reminder
  must(
    await manager.from("engagement_events").insert(eventRows([
      { engagement_id: engId, title: "Audit planning meeting with the CFO", kind: "meeting", starts_on: addDays(2), notes: "Agenda: timetable, key risks, inventory count, PBC list walkthrough. Microsoft Teams link to follow." },
      { engagement_id: engId, title: "Year-end inventory count observation", kind: "client_request", starts_on: addDays(9), ends_on: addDays(10), notes: "Ikeja factory and Apapa warehouse. Please share the count instructions a week before." },
      { engagement_id: engId, title: "Company income tax return filing (FIRS)", kind: "filing", starts_on: addDays(45), notes: "Self-assessment CIT and education tax returns, with the audited financial statements." },
      { engagement_id: engId, title: "Annual return filing (CAC)", kind: "filing", starts_on: addDays(60) },
      { engagement_id: engId, title: "Draft financial statements to the audit committee", kind: "milestone", starts_on: addDays(50) },
      { engagement_id: engId, title: "Engagement quality review", kind: "deadline", starts_on: addDays(65), visible_to_client: false, notes: "EQCR partner sign-off before the report is issued." },
    ])),
    "events",
  );
  // Additional documents from both sides
  await uploadDocAs(manager, ids["manager@demo.kp.test"]!, engId, `Engagement letter FY${year}.pdf`, pdf, "application/pdf", "Signed engagement letter and terms of business");
  await uploadDocAs(manager, ids["manager@demo.kp.test"]!, engId, `Audit timetable FY${year}.xlsx`, "Week,Activity\n1,Planning\n", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Key dates for fieldwork and reporting");
  await uploadDocAs(cfo, cfoId, engId, "Board resolution - appointment of auditors.pdf", pdf, "application/pdf", "Certified extract of the AGM resolution");
  await uploadDocAs(cfo, cfoId, engId, `Management accounts Dec ${year}.xlsx`, "Account,Amount\n", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", null);
  console.log("✓ calendar and additional documents");

  // Next year's audit: created as a DRAFT. The client users are granted by
  // default and see it as "Request in progress" (team + key dates, no requests).
  const next = year + 1;
  const eng4 = must(await lead.rpc("create_engagement", {
    p_client_id: client.id, p_engagement_type_id: sa!.id, p_name: `Statutory audit — FY${next}`,
    p_period_start: `${next}-01-01`, p_period_end: `${next}-12-31`, p_lead_id: ids["lead@demo.kp.test"],
    p_master_item_ids: (master ?? []).map((m) => m.master_item_id), p_default_due_date: null,
    p_team: [
      { user_id: ids["manager@demo.kp.test"], team_role: "manager" },
      { user_id: ids["senior@demo.kp.test"], team_role: "member" },
    ],
    p_planned_start: `${next}-10-01`, p_documents_due: `${next + 1}-01-31`, p_report_due: `${next + 1}-03-31`,
    p_client_contact_ids: null,
  }), "engagement FY next") as string;
  must(
    await lead.from("engagement_events").insert(eventRows([
      { engagement_id: eng4, title: `FY${next} audit planning meeting`, kind: "meeting", starts_on: addDays(20), notes: "Kick-off with the CFO and Financial Controller." },
      { engagement_id: eng4, title: "Interim audit fieldwork", kind: "milestone", starts_on: `${next}-11-03`, ends_on: `${next}-11-14` },
      { engagement_id: eng4, title: "Internal: budget and staffing review", kind: "other", starts_on: addDays(5), visible_to_client: false },
    ])),
    "events FY next",
  );
  console.log(`✓ FY${next} draft engagement (client sees "Request in progress")`);

  // Second entity: list prepared by the senior and waiting for approval
  const { data: tx } = await admin.from("engagement_types").select("id").eq("code", "TX").single();
  const { data: taxItems } = await admin.from("master_item_engagement_types").select("master_item_id").eq("engagement_type_id", tx!.id);
  const eng2 = must(await lead.rpc("create_engagement", {
    p_client_id: siblings[0]!.id, p_engagement_type_id: tx!.id, p_name: `Tax compliance review — FY${year}`,
    p_period_start: `${year}-01-01`, p_period_end: `${year}-12-31`, p_lead_id: ids["lead@demo.kp.test"],
    p_master_item_ids: (taxItems ?? []).map((m) => m.master_item_id), p_default_due_date: addDays(28),
    p_team: [{ user_id: ids["senior@demo.kp.test"], team_role: "member" }],
  }), "engagement 2") as string;
  must(await senior.rpc("submit_list_for_approval", { p_engagement_id: eng2, p_note: "Tax list tailored for the agro entity. Please review the TP items." }), "submit for approval");

  // Third entity: released, so the group summary shows two live entities
  const eng3 = must(await lead.rpc("create_engagement", {
    p_client_id: siblings[1]!.id, p_engagement_type_id: sa!.id, p_name: `Statutory audit — FY${year}`,
    p_period_start: `${year}-01-01`, p_period_end: `${year}-12-31`, p_lead_id: ids["lead@demo.kp.test"],
    p_master_item_ids: (master ?? []).map((m) => m.master_item_id).slice(0, 25), p_default_due_date: addDays(21),
    p_team: [{ user_id: ids["manager@demo.kp.test"], team_role: "manager" }],
  }), "engagement 3") as string;
  for (const [eid, cid] of [[eng2, siblings[0]!.id], [eng3, siblings[1]!.id]] as const) {
    const { data: ct } = await admin.from("client_contacts").select("id").eq("client_id", cid).eq("email", "cfo@demo.client.test").single();
    await grantAccess(lead, eid, ct!.id);
  }
  must(await lead.rpc("issue_request_list", { p_engagement_id: eng3 }), "issue 3");
  console.log("✓ group entities");
  console.log(`\nDone. Sign in at ${process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"} with any demo user and password ${PASSWORD}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
