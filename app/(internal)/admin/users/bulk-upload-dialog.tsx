"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckCircle2, Download, FileSpreadsheet, Mail, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { bulkStaffTemplate, inviteBulkStaff, previewBulkStaff, type BulkResult, type ValidatedRow } from "@/lib/actions/bulk-users";

const ROLE_LABEL: Record<string, string> = { staff: "Staff", admin: "Admin", super_admin: "Super admin" };

export function BulkUploadDialog({ open, onOpenChange, isSuper }: { open: boolean; onOpenChange: (o: boolean) => void; isSuper: boolean }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<ValidatedRow[] | null>(null);
  const [fileName, setFileName] = useState("");
  const [result, setResult] = useState<BulkResult | null>(null);
  const [busy, setBusy] = useState(false);

  const valid = rows?.filter((r) => r.errors.length === 0) ?? [];
  const invalid = rows?.filter((r) => r.errors.length > 0) ?? [];

  function reset() {
    setRows(null);
    setResult(null);
    setFileName("");
    if (fileRef.current) fileRef.current.value = "";
  }

  async function downloadTemplate() {
    setBusy(true);
    const res = await bulkStaffTemplate();
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    const bytes = Uint8Array.from(atob(res.data.base64), (c) => c.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = res.data.fileName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function onFile(file: File) {
    const fd = new FormData();
    fd.append("file", file);
    setBusy(true);
    setResult(null);
    const res = await previewBulkStaff(fd);
    setBusy(false);
    if (fileRef.current) fileRef.current.value = "";
    if (!res.ok) return toast.error(res.error);
    setFileName(file.name);
    setRows(res.data.rows);
  }

  async function send() {
    if (!valid.length) return;
    setBusy(true);
    const res = await inviteBulkStaff(valid.map(({ row, fullName, email, jobTitle, role, phone }) => ({ row, fullName, email, jobTitle, role, phone })));
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    setResult({ ...res.data, skipped: [...invalid.map((r) => ({ row: r.row, email: r.email, reason: r.errors.join("; ") })), ...res.data.skipped].sort((a, b) => a.row - b.row) });
    toast.success(`${res.data.invited.length} invitation(s) sent`);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent className="max-h-[90dvh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Bulk upload firm users</DialogTitle>
          <DialogDescription>
            Upload an Excel (.xlsx) or CSV file with the columns Full name, Email, Job title, Role ({isSuper ? "Staff, Admin or Super admin" : "Staff"}) and optional Phone. Up to 200 rows. You&apos;ll see every row checked before anything is sent.
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-3">
              <Badge variant="success"><CheckCircle2 /> {result.invited.length} invited</Badge>
              <Badge variant={result.skipped.length ? "warning" : "muted"}><TriangleAlert /> {result.skipped.length} skipped</Badge>
            </div>
            {result.invited.length ? (
              <div>
                <h3 className="mb-1 text-sm font-semibold">Invited</h3>
                <ul className="space-y-0.5 text-sm">
                  {result.invited.map((r) => <li key={r.email}>{r.fullName} · <span className="text-muted-foreground">{r.email}</span> · {ROLE_LABEL[r.role]}</li>)}
                </ul>
              </div>
            ) : null}
            {result.skipped.length ? (
              <div>
                <h3 className="mb-1 text-sm font-semibold">Skipped</h3>
                <ul className="space-y-0.5 text-sm">
                  {result.skipped.map((r) => <li key={`${r.row}-${r.email}`}><span className="font-mono text-xs">Row {r.row}</span> {r.email || "(no email)"}: <span className="text-destructive">{r.reason}</span></li>)}
                </ul>
              </div>
            ) : null}
            <DialogFooter>
              <Button variant="outline" onClick={reset}>Upload another file</Button>
              <Button onClick={() => { reset(); onOpenChange(false); }}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={downloadTemplate} disabled={busy}><Download /> Download template</Button>
              <Button onClick={() => fileRef.current?.click()} disabled={busy}><FileSpreadsheet /> {rows ? "Choose another file" : "Choose file"}</Button>
              <input ref={fileRef} type="file" accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
            </div>
            {rows ? (
              <>
                <p className="text-sm">
                  <span className="font-medium">{fileName}</span>: {rows.length} row(s) ·{" "}
                  <span className="text-emerald-700">{valid.length} ready</span> ·{" "}
                  <span className={invalid.length ? "text-destructive" : "text-muted-foreground"}>{invalid.length} with problems (will be skipped)</span>
                </p>
                <div className="max-h-[45dvh] overflow-auto rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Row</TableHead>
                        <TableHead>Full name</TableHead>
                        <TableHead>Email</TableHead>
                        <TableHead>Job title</TableHead>
                        <TableHead>Role</TableHead>
                        <TableHead>Phone</TableHead>
                        <TableHead>Check</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map((r) => (
                        <TableRow key={r.row} className={r.errors.length ? "bg-danger-soft/40" : ""}>
                          <TableCell className="font-mono text-xs">{r.row}</TableCell>
                          <TableCell>{r.fullName || "—"}</TableCell>
                          <TableCell className="text-xs">{r.email || "—"}</TableCell>
                          <TableCell className="text-xs">{r.jobTitle || "—"}</TableCell>
                          <TableCell className="text-xs">{r.roleValue ? ROLE_LABEL[r.roleValue] : r.role}</TableCell>
                          <TableCell className="text-xs">{r.phone || "—"}</TableCell>
                          <TableCell className="text-xs">
                            {r.errors.length ? <span className="text-destructive">{r.errors.join("; ")}</span> : <span className="text-emerald-700">OK</span>}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </>
            ) : (
              <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">No file chosen yet. Start from the template to get the columns right.</p>
            )}
            <DialogFooter>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button onClick={send} disabled={busy || valid.length === 0}><Mail /> Send {valid.length || ""} invitation{valid.length === 1 ? "" : "s"}</Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
