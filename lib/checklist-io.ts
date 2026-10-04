import "server-only";
import ExcelJS from "exceljs";
import Papa from "papaparse";

export const CHECKLIST_COLUMNS = [
  "code",
  "category_code",
  "title",
  "guidance",
  "default_folder",
  "expected_file_types",
  "is_critical",
  "default_priority",
  "engagement_types",
  "sort_order",
  "is_active",
] as const;

export type ChecklistRow = Record<(typeof CHECKLIST_COLUMNS)[number], string>;

export async function parseChecklistFile(name: string, buf: ArrayBuffer): Promise<ChecklistRow[]> {
  const lower = name.toLowerCase();
  if (lower.endsWith(".csv")) {
    const text = new TextDecoder("utf-8").decode(buf).replace(/^﻿/, "");
    const parsed = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true, transformHeader: (h) => h.trim().toLowerCase() });
    return parsed.data.map(normalise);
  }
  if (lower.endsWith(".xlsx")) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const ws = wb.worksheets[0];
    if (!ws) return [];
    const headers: string[] = [];
    ws.getRow(1).eachCell((cell, col) => (headers[col] = String(cell.text ?? "").trim().toLowerCase()));
    const rows: ChecklistRow[] = [];
    ws.eachRow((row, idx) => {
      if (idx === 1) return;
      const rec: Record<string, string> = {};
      row.eachCell({ includeEmpty: true }, (cell, col) => {
        if (headers[col]) rec[headers[col]] = String(cell.text ?? "").trim();
      });
      if (Object.values(rec).some((v) => v)) rows.push(normalise(rec));
    });
    return rows;
  }
  throw new Error("Upload a .csv or .xlsx file");
}

function normalise(r: Record<string, string>): ChecklistRow {
  const out = {} as ChecklistRow;
  for (const c of CHECKLIST_COLUMNS) out[c] = (r[c] ?? "").toString().trim();
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

export function rowsToCsv(rows: ChecklistRow[]): string {
  return "﻿" + Papa.unparse({ fields: [...CHECKLIST_COLUMNS], data: rows.map((r) => CHECKLIST_COLUMNS.map((c) => r[c])) });
}

export async function rowsToXlsx(rows: ChecklistRow[]): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "PBC Portal";
  const ws = wb.addWorksheet("Master checklist");
  ws.columns = CHECKLIST_COLUMNS.map((c) => ({
    header: c,
    key: c,
    width: c === "guidance" ? 70 : c === "title" ? 48 : c === "default_folder" ? 26 : 16,
  }));
  rows.forEach((r) => ws.addRow(r));
  ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F77AD" } };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  ws.autoFilter = { from: "A1", to: `K${rows.length + 1}` };
  ws.getColumn("guidance").alignment = { wrapText: true, vertical: "top" };
  const guide = wb.addWorksheet("How to use");
  [
    "code: unique item code, e.g. GEN-01 (existing codes are updated, new codes are added)",
    "category_code: GEN, FST, REV, REC, INV, PPE, PAY, CSH, BOR, HR, TAX, LEG, RPT, OTH (see Admin > Checklist)",
    "expected_file_types: separated by ; e.g. pdf;xlsx",
    "is_critical / is_active: yes or no",
    "default_priority: low, normal, high or urgent",
    "engagement_types: codes separated by ; e.g. SA;TX;AD;DD",
    "Rows are never deleted by import. Deactivate items by setting is_active = no.",
    "Editing an item creates a new revision; live engagements are not changed until the lead pulls the update.",
  ].forEach((t) => guide.addRow([t]));
  guide.getColumn(1).width = 110;
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}
