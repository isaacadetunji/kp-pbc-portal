"use server";

import ExcelJS from "exceljs";
import Papa from "papaparse";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionUser } from "@/lib/auth";
import { publicEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { friendlyError } from "@/lib/utils";
import type { ActionResult } from "./result";

/**
 * Bulk staff upload (Users & access). Requires the manage_users permission;
 * Admin / Super admin rows only for a Super admin. Invitations use the same
 * mechanism as a single invite (Auth admin invite + role in app_metadata and
 * on the profile), so the profile audit trail is the same, plus one summary
 * audit entry per upload.
 */
const MAX_BULK_ROWS = 200;

export type BulkRole = "staff" | "admin" | "super_admin";

export interface BulkRow {
  row: number;
  fullName: string;
  email: string;
  jobTitle: string;
  role: string;
  phone: string;
}

export interface ValidatedRow extends BulkRow {
  roleValue: BulkRole | null;
  errors: string[];
}

export interface BulkResult {
  invited: { row: number; email: string; fullName: string; role: BulkRole }[];
  skipped: { row: number; email: string; reason: string }[];
}

const emailSchema = z.string().email();

const HEADERS: Record<string, keyof Omit<BulkRow, "row">> = {
  full_name: "fullName", name: "fullName", fullname: "fullName", staff_name: "fullName",
  email: "email", email_address: "email", work_email: "email", e_mail: "email",
  job_title: "jobTitle", title: "jobTitle", position: "jobTitle", designation: "jobTitle",
  role: "role", portal_role: "role", access: "role",
  phone: "phone", phone_number: "phone", mobile: "phone", telephone: "phone",
};

function headerKey(h: string) {
  return HEADERS[h.replace(/^﻿/, "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "")];
}

function parseRole(v: string): BulkRole | null {
  const s = v.trim().toLowerCase().replace(/[^a-z]/g, "");
  if (!s || s === "staff" || s === "firmstaff" || s === "user") return "staff";
  if (s === "admin" || s === "administrator") return "admin";
  if (s === "superadmin" || s === "superadministrator") return "super_admin";
  return null;
}

async function bulkUser() {
  const s = await actionUser(["super_admin", "admin", "staff"]);
  const { data: ok } = await s.supabase.rpc("has_app_permission", { p_perm: "manage_users" });
  if (!ok) throw new Error("You don't have permission to manage users.");
  return s;
}

async function parseFile(file: File): Promise<BulkRow[]> {
  const name = file.name.toLowerCase();
  const buf = await file.arrayBuffer();
  const records: Record<string, string>[] = [];
  if (name.endsWith(".csv")) {
    const text = new TextDecoder("utf-8").decode(buf);
    const parsed = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: "greedy" });
    records.push(...parsed.data);
  } else if (name.endsWith(".xlsx")) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const ws = wb.worksheets.find((w) => w.name.toLowerCase().startsWith("staff")) ?? wb.worksheets[0];
    if (!ws) return [];
    const headers: string[] = [];
    ws.getRow(1).eachCell((cell, col) => (headers[col] = String(cell.text ?? "")));
    ws.eachRow((row, idx) => {
      if (idx === 1) return;
      const rec: Record<string, string> = {};
      headers.forEach((h, col) => {
        if (h) rec[h] = String(row.getCell(col).text ?? "");
      });
      records.push(rec);
    });
  } else {
    throw new Error("Upload an .xlsx or .csv file");
  }
  const rows: BulkRow[] = [];
  records.forEach((rec, i) => {
    const r: BulkRow = { row: i + 2, fullName: "", email: "", jobTitle: "", role: "", phone: "" };
    for (const [h, v] of Object.entries(rec)) {
      const k = headerKey(h);
      if (k) r[k] = String(v ?? "").trim();
    }
    if (r.fullName || r.email || r.jobTitle || r.phone) rows.push(r);
  });
  return rows;
}

async function validate(rows: BulkRow[], myRole: string): Promise<ValidatedRow[]> {
  const admin = createAdminClient();
  const emails = [...new Set(rows.map((r) => r.email.trim().toLowerCase()).filter(Boolean))];
  const existing = new Map<string, string>();
  const contacts = new Set<string>();
  for (let i = 0; i < emails.length; i += 100) {
    const chunk = emails.slice(i, i + 100);
    const [{ data: profs }, { data: cts }] = await Promise.all([
      admin.from("profiles").select("email, app_role").in("email", chunk),
      admin.from("client_contacts").select("email").in("email", chunk),
    ]);
    for (const p of profs ?? []) existing.set(String(p.email).toLowerCase(), p.app_role);
    for (const c of cts ?? []) contacts.add(String(c.email).toLowerCase());
  }
  const seen = new Map<string, number>();
  return rows.map((r) => {
    const email = r.email.trim().toLowerCase();
    const errors: string[] = [];
    if (r.fullName.length < 2) errors.push("Full name is missing");
    else if (r.fullName.length > 120) errors.push("Full name is too long");
    if (!email) errors.push("Email is missing");
    else if (!emailSchema.safeParse(email).success) errors.push("Email is not valid");
    else {
      if (seen.has(email)) errors.push(`Duplicate of row ${seen.get(email)}`);
      else seen.set(email, r.row);
      const role = existing.get(email);
      if (role === "client") errors.push("Belongs to a client account");
      else if (role) errors.push("Already a firm user");
      else if (contacts.has(email)) errors.push("Belongs to a client contact");
    }
    const roleValue = parseRole(r.role);
    if (!roleValue) errors.push(`Unknown role "${r.role}" (use Staff, Admin or Super admin)`);
    else if (roleValue !== "staff" && myRole !== "super_admin") errors.push("Only a Super admin can add Admins or Super admins");
    if (r.jobTitle.length > 120) errors.push("Job title is too long");
    if (r.phone.length > 40) errors.push("Phone is too long");
    return { ...r, email, roleValue, errors };
  });
}

/** Step 1: parse the file and validate every row (nothing is sent). */
export async function previewBulkStaff(formData: FormData): Promise<ActionResult<{ rows: ValidatedRow[] }>> {
  try {
    const { profile } = await bulkUser();
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Choose a file" };
    if (file.size > 2 * 1024 * 1024) return { ok: false, error: "The file must be under 2 MB" };
    const rows = await parseFile(file);
    if (rows.length === 0) return { ok: false, error: "No rows found. Use the template: Full name, Email, Job title, Role, Phone." };
    if (rows.length > MAX_BULK_ROWS) return { ok: false, error: `At most ${MAX_BULK_ROWS} rows per upload (this file has ${rows.length}).` };
    return { ok: true, data: { rows: await validate(rows, profile.app_role) } };
  } catch (e) {
    return { ok: false, error: friendlyError(e) };
  }
}

const rowSchema = z.object({
  row: z.number().int(),
  fullName: z.string().max(200),
  email: z.string().max(320),
  jobTitle: z.string().max(200),
  role: z.string().max(60),
  phone: z.string().max(60),
});

/** Step 2: re-validate on the server and send the invitations for valid rows. */
export async function inviteBulkStaff(input: BulkRow[]): Promise<ActionResult<BulkResult>> {
  try {
    const { profile: me } = await bulkUser();
    const rows = z.array(rowSchema).max(MAX_BULK_ROWS).parse(input);
    const checked = await validate(rows, me.app_role);
    const admin = createAdminClient();
    const result: BulkResult = { invited: [], skipped: [] };

    for (const r of checked) {
      if (r.errors.length || !r.roleValue) {
        result.skipped.push({ row: r.row, email: r.email, reason: r.errors.join("; ") || "Invalid row" });
        continue;
      }
      try {
        const { data, error } = await admin.auth.admin.inviteUserByEmail(r.email, {
          data: { full_name: r.fullName },
          redirectTo: `${publicEnv.siteUrl}/auth/confirm?next=/auth/set-password`,
        });
        if (error || !data.user) {
          result.skipped.push({ row: r.row, email: r.email, reason: `Could not send invitation: ${error?.message ?? "unknown error"}` });
          continue;
        }
        await admin.auth.admin.updateUserById(data.user.id, { app_metadata: { app_role: r.roleValue } });
        const { error: pErr } = await admin
          .from("profiles")
          .update({ app_role: r.roleValue, full_name: r.fullName, job_title: r.jobTitle || null, phone: r.phone || null })
          .eq("id", data.user.id);
        if (pErr) {
          result.skipped.push({ row: r.row, email: r.email, reason: `Invited, but the profile could not be updated: ${friendlyError(pErr)}` });
          continue;
        }
        result.invited.push({ row: r.row, email: r.email, fullName: r.fullName, role: r.roleValue });
      } catch (e) {
        result.skipped.push({ row: r.row, email: r.email, reason: friendlyError(e) });
      }
    }

    // One summary entry with the uploader as actor (profile rows are audited by trigger too)
    try {
      await admin.from("audit_log").insert({
        actor_id: me.id,
        actor_role: me.app_role,
        action: "user.bulk_invited",
        entity_type: "user",
        entity_id: null,
        after: {
          invited: result.invited.map((x) => ({ email: x.email, role: x.role })),
          skipped: result.skipped.map((x) => ({ row: x.row, email: x.email, reason: x.reason })),
        },
      });
    } catch {
      // auditing the summary must never undo invitations already sent
    }

    revalidatePath("/admin/users");
    return { ok: true, data: result };
  } catch (e) {
    return { ok: false, error: friendlyError(e) };
  }
}

/** The .xlsx template (base64), with the roles this user may assign. */
export async function bulkStaffTemplate(): Promise<ActionResult<{ fileName: string; base64: string }>> {
  try {
    const { profile } = await bulkUser();
    const roles = profile.app_role === "super_admin" ? ["Staff", "Admin", "Super admin"] : ["Staff"];
    const wb = new ExcelJS.Workbook();
    wb.creator = "PBC Portal";
    const ws = wb.addWorksheet("Staff");
    ws.columns = [
      { header: "Full name", key: "name", width: 30 },
      { header: "Email", key: "email", width: 34 },
      { header: "Job title", key: "title", width: 26 },
      { header: "Role", key: "role", width: 14 },
      { header: "Phone", key: "phone", width: 18 },
    ];
    ws.addRow({ name: "Adaeze Okafor", email: "adaeze.okafor@krestonpedabo.com", title: "Audit Senior", role: "Staff", phone: "+234 801 234 5678" });
    ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F77AD" } };
    ws.views = [{ state: "frozen", ySplit: 1 }];
    for (let r = 2; r <= MAX_BULK_ROWS + 1; r++) {
      ws.getCell(`D${r}`).dataValidation = {
        type: "list", allowBlank: true, formulae: [`"${roles.join(",")}"`],
        showErrorMessage: true, errorTitle: "Role", error: `Choose ${roles.join(", ")}`,
      };
    }
    const guide = wb.addWorksheet("How to use");
    [
      "One row per firm user, up to 200 rows. Replace the example row.",
      "Full name and Email are required. Job title and Phone are optional.",
      `Role: ${roles.join(", ")}. Blank means Staff.${profile.app_role === "super_admin" ? "" : " Only a Super admin can add Admins."}`,
      "Each person receives an invitation e-mail to set a password.",
      "Rows for people who already have an account (firm or client) are skipped.",
    ].forEach((t) => guide.addRow([t]));
    guide.getColumn(1).width = 100;
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    return { ok: true, data: { fileName: "staff-upload-template.xlsx", base64: buf.toString("base64") } };
  } catch (e) {
    return { ok: false, error: friendlyError(e) };
  }
}
