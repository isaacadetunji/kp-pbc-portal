import "server-only";
import ExcelJS from "exceljs";
import Papa from "papaparse";

/** Export/import columns. "description" is stored in master_checklist_items.guidance. */
export const CHECKLIST_COLUMNS = [
  "code",
  "category_code",
  "title",
  "description",
  "default_folder",
  "file_class",
  "is_critical",
  "default_priority",
  "engagement_types",
  "sort_order",
  "is_active",
] as const;

export type ChecklistColumn = (typeof CHECKLIST_COLUMNS)[number];
export type ChecklistRow = Record<ChecklistColumn, string>;
/** A parsed row plus which columns the file actually had. */
export type ParsedChecklistRow = ChecklistRow & { _present: Set<ChecklistColumn> };

/** Old / human headers accepted on import. */
const HEADER_ALIASES: Record<string, ChecklistColumn> = {
  guidance: "description",
  guidance_for_the_client: "description",
  description_for_the_client: "description",
  category: "category_code",
  folder: "default_folder",
  file_classification: "file_class",
  classification: "file_class",
  critical: "is_critical",
  priority: "default_priority",
  types: "engagement_types",
  sort: "sort_order",
  active: "is_active",
};

export function normaliseHeader(h: string): string {
  const k = h.replace(/^﻿/, "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  return HEADER_ALIASES[k] ?? k;
}

export async function parseChecklistFile(name: string, buf: ArrayBuffer): Promise<ParsedChecklistRow[]> {
  const lower = name.toLowerCase();
  if (lower.endsWith(".csv")) {
    const text = new TextDecoder("utf-8").decode(buf).replace(/^﻿/, "");
    const parsed = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true, transformHeader: normaliseHeader });
    return parsed.data.map(normalise);
  }
  if (lower.endsWith(".xlsx")) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const ws = wb.worksheets[0];
    if (!ws) return [];
    const headers: string[] = [];
    ws.getRow(1).eachCell((cell, col) => (headers[col] = normaliseHeader(String(cell.text ?? ""))));
    const rows: ParsedChecklistRow[] = [];
    ws.eachRow((row, idx) => {
      if (idx === 1) return;
      const rec: Record<string, string> = {};
      headers.forEach((h, col) => {
        if (h) rec[h] = String(row.getCell(col).text ?? "").trim();
      });
      if (Object.values(rec).some((v) => v)) rows.push(normalise(rec));
    });
    return rows;
  }
  throw new Error("Upload a .csv or .xlsx file");
}

function normalise(r: Record<string, string>): ParsedChecklistRow {
  const out = { _present: new Set<ChecklistColumn>() } as ParsedChecklistRow;
  for (const c of CHECKLIST_COLUMNS) {
    if (c in r) out._present.add(c);
    out[c] = (r[c] ?? "").toString().trim();
  }
  return out;
}

export function toBool(v: string, dflt = false): boolean {
  if (!v) return dflt;
  return /^(y|yes|true|1|x)$/i.test(v.trim());
}

export function splitList(v: string): string[] {
  return v
    .split(/[;,|\s]+/)
    .map((s) => s.trim().replace(/^\./, "").toLowerCase())
    .filter(Boolean);
}

/** "Permanent", "Permanent file", "P" → permanent; "Current", "C" → current; blank → null. */
export function parseFileClass(v: string): "permanent" | "current" | null | "invalid" {
  const s = v.trim().toLowerCase().replace(/\s+file$/, "");
  if (!s) return null;
  if (s === "permanent" || s === "p" || s === "perm") return "permanent";
  if (s === "current" || s === "c" || s === "curr") return "current";
  return "invalid";
}

export function rowsToCsv(rows: ChecklistRow[]): string {
  return "﻿" + Papa.unparse({ fields: [...CHECKLIST_COLUMNS], data: rows.map((r) => CHECKLIST_COLUMNS.map((c) => r[c])) });
}

export async function rowsToXlsx(rows: ChecklistRow[], categoryCodes: string[] = []): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "PBC Portal";
  const ws = wb.addWorksheet("Master checklist");
  ws.columns = CHECKLIST_COLUMNS.map((c) => ({
    header: c,
    key: c,
    width: c === "description" ? 70 : c === "title" ? 48 : c === "default_folder" ? 26 : 16,
  }));
  rows.forEach((r) => ws.addRow(r));
  ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F77AD" } };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  ws.autoFilter = { from: "A1", to: `${String.fromCharCode(64 + CHECKLIST_COLUMNS.length)}${rows.length + 1}` };
  ws.getColumn("description").alignment = { wrapText: true, vertical: "top" };
  const guide = wb.addWorksheet("How to use");
  [
    "code: unique item code, e.g. GEN-01 (existing codes are updated, new codes are added)",
    `category_code: ${categoryCodes.length ? categoryCodes.join(", ") : "see Settings > Checklist"}`,
    "description: what the client should provide (shown to the client). The old header \"guidance\" is also accepted.",
    "default_folder: a folder name from Settings > Checklist; a new name is added to the folder list",
    "file_class: permanent (always relevant, carried year to year) or current (needed for the current year); blank keeps the current value",
    "is_critical / is_active: yes or no",
    "default_priority: low, normal, important or urgent (\"high\" is read as important)",
    "engagement_types: codes separated by ; e.g. SA;TX;AD;DD",
    "Rows are never deleted by import. Deactivate items by setting is_active = no.",
    "Editing an item creates a new revision; live engagements are not changed until the lead pulls the update.",
  ].forEach((t) => guide.addRow([t]));
  guide.getColumn(1).width = 120;
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}
