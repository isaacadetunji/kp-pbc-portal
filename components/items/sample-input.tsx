"use client";

import { useRef, useState } from "react";
import Papa from "papaparse";
import { toast } from "sonner";
import { FileSpreadsheet, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { parseSampleWorkbook } from "@/lib/actions/samples";
import { MAX_SAMPLE_COLUMNS, MAX_SAMPLE_LINES } from "@/lib/constants";
import { rowsToTsv, type SamplePreview } from "@/lib/sample-parse";

/**
 * Paste-from-Excel box with an "Upload Excel/CSV" alternative. Files are
 * converted to tab-separated text in the box, so the user reviews and edits
 * the same way as a paste. Used by the item sample-schedule panel and the
 * New request dialog.
 */
export function SampleInput({
  text,
  onText,
  hasHeader,
  onHasHeader,
  preview,
  fixedColumns,
  idPrefix,
}: {
  text: string;
  onText: (t: string) => void;
  hasHeader: boolean;
  onHasHeader: (v: boolean) => void;
  preview: SamplePreview;
  /** columns of an existing schedule (adding lines) */
  fixedColumns?: string[] | null;
  idPrefix: string;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);

  async function onFile(file: File | undefined) {
    if (!file) return;
    const lower = file.name.toLowerCase();
    setReading(true);
    try {
      let rows: string[][] = [];
      if (lower.endsWith(".csv") || lower.endsWith(".txt") || lower.endsWith(".tsv")) {
        const parsed = Papa.parse<string[]>((await file.text()).replace(/^﻿/, ""), { skipEmptyLines: "greedy" });
        rows = parsed.data.map((r) => r.map((c) => String(c ?? "")));
      } else if (lower.endsWith(".xlsx") || lower.endsWith(".xlsm")) {
        const fd = new FormData();
        fd.set("file", file);
        const res = await parseSampleWorkbook(fd);
        if (!res.ok) throw new Error(res.error);
        rows = res.data.rows;
        if (res.data.truncated) toast.warning(`Only the first ${MAX_SAMPLE_LINES.toLocaleString()} lines were read.`);
      } else {
        throw new Error("Upload a .csv or .xlsx file");
      }
      if (rows.length === 0) throw new Error("The file has no rows");
      onText(rowsToTsv(rows.slice(0, MAX_SAMPLE_LINES + 1)));
      toast.success(`Read ${rows.length} row(s) from ${file.name}. Check the preview, then save.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not read the file");
    } finally {
      setReading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const tooMany = preview.body.length > MAX_SAMPLE_LINES;

  return (
    <div className="min-w-0 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">Paste from Excel below, or</span>
        <input
          ref={fileRef}
          id={`${idPrefix}-file`}
          type="file"
          accept=".csv,.xlsx,.xlsm,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="sr-only"
          onChange={(e) => onFile(e.target.files?.[0])}
          aria-label="Upload Excel or CSV file"
        />
        <Button type="button" size="sm" variant="outline" disabled={reading} onClick={() => fileRef.current?.click()}>
          {reading ? <Loader2 className="animate-spin" /> : <FileSpreadsheet />} Upload Excel/CSV
        </Button>
      </div>
      <Textarea
        id={`${idPrefix}-rows`}
        value={text}
        onChange={(e) => onText(e.target.value)}
        rows={6}
        placeholder={"Date\tInvoice no.\tCustomer\tAmount\n05/01/2025\tINV-1001\tShoprite\t1,250,000"}
        className="max-h-60 font-mono text-xs [field-sizing:fixed]"
        aria-label="Pasted rows"
        wrap="off"
      />
      <label className="flex items-center gap-2 text-sm">
        <Checkbox checked={hasHeader} onCheckedChange={(v) => onHasHeader(v === true)} />
        {fixedColumns ? "First row is the heading row (skip it)" : "First row contains the column headings"}
      </label>
      {preview.tooWide ? (
        <p className="text-xs text-warning">The data has {preview.width} columns; only the first {MAX_SAMPLE_COLUMNS} will be kept.</p>
      ) : null}
      {tooMany ? <p className="text-xs text-destructive">At most {MAX_SAMPLE_LINES.toLocaleString()} lines at a time. Split the selection.</p> : null}
      {fixedColumns && preview.body[0] && preview.body[0].length !== fixedColumns.length ? (
        <p className="text-xs text-warning">
          This schedule has {fixedColumns.length} columns; the data has {preview.body[0].length}. Extra cells are dropped and missing ones left blank.
        </p>
      ) : null}
      {preview.body.length ? (
        <div className="rounded-md border">
          <div className="max-h-56 overflow-auto">
            <table className="w-max min-w-full text-xs">
              <thead className="sticky top-0 bg-muted">
                <tr>{preview.header.map((h, i) => <th key={i} className="px-2 py-1.5 text-left font-semibold whitespace-nowrap">{h}</th>)}</tr>
              </thead>
              <tbody>
                {preview.body.slice(0, 6).map((r, i) => (
                  <tr key={i} className="border-t">{preview.header.map((_, j) => <td key={j} className="max-w-48 truncate px-2 py-1 whitespace-nowrap">{r[j] ?? ""}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="border-t px-2 py-1 text-xs text-muted-foreground">
            {preview.body.length} line(s) · {preview.header.length} column(s) ready
          </p>
        </div>
      ) : null}
    </div>
  );
}
