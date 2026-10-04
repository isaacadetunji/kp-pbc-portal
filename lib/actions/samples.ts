"use server";

import ExcelJS from "exceljs";
import { actionUser } from "@/lib/auth";
import { friendlyError } from "@/lib/utils";
import type { ActionResult } from "./result";

const MAX_ROWS = 1001; // heading + 1,000 lines
const MAX_COLS = 200; // read a little wider than allowed so the UI can warn

/**
 * Read the first worksheet of an .xlsx sample selection into rows of text
 * (as displayed in Excel). Team only. CSV files are parsed in the browser.
 */
export async function parseSampleWorkbook(formData: FormData): Promise<ActionResult<{ rows: string[][]; sheet: string; truncated: boolean }>> {
  try {
    const { profile } = await actionUser(["super_admin", "admin", "staff"]);
    void profile;
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Choose a file" };
    if (file.size > 8 * 1024 * 1024) return { ok: false, error: "Sample files must be under 8 MB" };
    const lower = file.name.toLowerCase();
    if (!lower.endsWith(".xlsx") && !lower.endsWith(".xlsm")) {
      return { ok: false, error: "Upload an .xlsx file (or save the workbook as .xlsx / .csv first)" };
    }
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await file.arrayBuffer());
    const ws = wb.worksheets.find((w) => w.state === "visible" && w.actualRowCount > 0) ?? wb.worksheets[0];
    if (!ws) return { ok: false, error: "The workbook has no worksheets" };
    const rows: string[][] = [];
    let truncated = false;
    ws.eachRow({ includeEmpty: false }, (row) => {
      if (rows.length >= MAX_ROWS) {
        truncated = true;
        return;
      }
      const cells: string[] = [];
      const last = Math.min(row.cellCount, MAX_COLS);
      for (let c = 1; c <= last; c++) cells.push(String(row.getCell(c).text ?? "").trim());
      while (cells.length && cells[cells.length - 1] === "") cells.pop();
      if (cells.some((v) => v !== "")) rows.push(cells);
    });
    return { ok: true, data: { rows, sheet: ws.name, truncated } };
  } catch (e) {
    return { ok: false, error: friendlyError(e) };
  }
}
