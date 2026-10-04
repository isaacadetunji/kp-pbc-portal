import { MAX_SAMPLE_COLUMNS } from "@/lib/constants";

/** Parse text copied from Excel (tab-separated) or CSV into rows of cells. */
export function parsePaste(text: string): string[][] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n").filter((l) => l.trim() !== "");
  const tab = lines.some((l) => l.includes("\t"));
  return lines.map((l) => {
    if (tab) return l.split("\t").map((c) => c.trim());
    // simple CSV with quotes
    const out: string[] = [];
    let cur = "", q = false;
    for (let i = 0; i < l.length; i++) {
      const ch = l[i];
      if (ch === '"') { if (q && l[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
      else if (ch === "," && !q) { out.push(cur.trim()); cur = ""; }
      else cur += ch;
    }
    out.push(cur.trim());
    return out;
  });
}

/** Rows (from a CSV/XLSX file) to tab-separated text, so they can be reviewed and edited like a paste. */
export function rowsToTsv(rows: string[][]): string {
  return rows
    .map((r) => r.map((c) => String(c ?? "").replace(/[\t\r\n]+/g, " ").trim()))
    .filter((r) => r.some((c) => c !== ""))
    .map((r) => r.join("\t"))
    .join("\n");
}

export interface SamplePreview {
  header: string[];
  body: string[][];
  /** widest row in the input */
  width: number;
  tooWide: boolean;
}

/** Header + body for a new schedule (or for lines added to an existing one with fixed columns). */
export function buildPreview(text: string, hasHeader: boolean, fixedColumns?: string[] | null): SamplePreview {
  const rows = parsePaste(text);
  const width = rows.reduce((n, r) => Math.max(n, r.length), 0);
  const header = fixedColumns
    ? fixedColumns
    : hasHeader
      ? Array.from({ length: Math.min(width, MAX_SAMPLE_COLUMNS) }, (_, i) => rows[0]?.[i] || `Column ${i + 1}`)
      : Array.from({ length: Math.min(width, MAX_SAMPLE_COLUMNS) }, (_, i) => `Column ${i + 1}`);
  const body = (hasHeader ? rows.slice(1) : rows).map((r) => r.slice(0, MAX_SAMPLE_COLUMNS));
  return { header: header.slice(0, MAX_SAMPLE_COLUMNS), body, width, tooWide: width > MAX_SAMPLE_COLUMNS };
}
