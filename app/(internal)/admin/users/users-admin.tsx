"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Mail, Search, UserPlus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { inviteStaffUser, updateUser } from "@/lib/actions/admin";
import { fmtDateTime } from "@/lib/dates";
import type { AppRole, Profile } from "@/lib/types";

export function UsersAdmin({ users, me, myRole }: { users: Profile[]; me: string; myRole: AppRole }) {
  const isSuper = myRole === "super_admin";
  const [view, setView] = useState<"firm" | "client">("firm");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ fullName: "", email: "", role: "staff" as "staff" | "admin" | "super_admin", jobTitle: "" });
  const [busy, setBusy] = useState(false);

  const rows = useMemo(
    () =>
      users
        .filter((u) => (view === "firm" ? u.app_role !== "client" : u.app_role === "client"))
        .filter((u) => !q || `${u.full_name} ${u.email}`.toLowerCase().includes(q.toLowerCase())),
    [users, view, q],
  );

  async function patch(userId: string, p: Parameters<typeof updateUser>[0]) {
    const res = await updateUser({ ...p, userId });
    if (!res.ok) toast.error(res.error);
    else toast.success("Saved");
  }

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const res = await inviteStaffUser(form);
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    toast.success(`Invitation sent to ${form.email}`);
    setOpen(false);
    setForm({ fullName: "", email: "", role: "staff", jobTitle: "" });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Tabs value={view} onValueChange={(v) => setView(v as "firm" | "client")}>
          <TabsList>
            <TabsTrigger value="firm">Firm users ({users.filter((u) => u.app_role !== "client").length})</TabsTrigger>
            <TabsTrigger value="client">Client users ({users.filter((u) => u.app_role === "client").length})</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="relative flex-1">
          <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or email" className="pl-9" />
        </div>
        <Button onClick={() => setOpen(true)}><UserPlus /> Invite firm user</Button>
      </div>
      {view === "client" ? (
        <p className="text-sm text-muted-foreground">Client users are invited from an engagement&apos;s Team & client access tab. Here you can deactivate them or require MFA.</p>
      ) : null}
      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>User</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>MFA required</TableHead>
              <TableHead>Active</TableHead>
              <TableHead>Last seen</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((u) => (
              <TableRow key={u.id}>
                <TableCell>
                  <div className="font-medium">{u.full_name || "—"}</div>
                  <div className="text-xs text-muted-foreground">{u.email}{u.job_title ? ` · ${u.job_title}` : ""}</div>
                </TableCell>
                <TableCell>
                  {u.app_role === "client" ? (
                    <Badge variant="info">Client</Badge>
                  ) : (
                    <Select
                      defaultValue={u.app_role}
                      onValueChange={(v) => patch(u.id, { userId: u.id, role: v as AppRole })}
                      disabled={u.id === me || (!isSuper && u.app_role !== "staff")}
                    >
                      <SelectTrigger className="h-8 w-36"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {isSuper || u.app_role === "super_admin" ? <SelectItem value="super_admin">Super admin</SelectItem> : null}
                        {isSuper || u.app_role === "admin" ? <SelectItem value="admin">Admin</SelectItem> : null}
                        <SelectItem value="staff">Firm staff</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                </TableCell>
                <TableCell>
                  <Switch defaultChecked={u.mfa_required} onCheckedChange={(v) => patch(u.id, { userId: u.id, mfaRequired: v })} aria-label="Require MFA" />
                </TableCell>
                <TableCell>
                  <Switch defaultChecked={u.is_active} disabled={u.id === me} onCheckedChange={(v) => patch(u.id, { userId: u.id, isActive: v })} aria-label="Active" />
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">{u.last_seen_at ? fmtDateTime(u.last_seen_at) : "—"}</TableCell>
              </TableRow>
            ))}
            {rows.length === 0 ? (
              <TableRow><TableCell colSpan={5} className="py-8 text-center text-muted-foreground">No users.</TableCell></TableRow>
            ) : null}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite firm user</DialogTitle>
            <DialogDescription>They&apos;ll get an email to set a password, and can also sign in with an emailed link. Staff only see engagements they are assigned to. {isSuper ? "Admins manage staff, clients and settings; Super Admins also manage administrators." : "Only the Super Admin can add administrators."}</DialogDescription>
          </DialogHeader>
          <form onSubmit={invite} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="u-name">Full name</Label>
              <Input id="u-name" required value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="u-email">Work email</Label>
              <Input id="u-email" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Role</Label>
                <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v as "staff" | "admin" | "super_admin" })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="staff">Firm staff</SelectItem>
                    {isSuper ? <SelectItem value="admin">Admin</SelectItem> : null}
                    {isSuper ? <SelectItem value="super_admin">Super admin</SelectItem> : null}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="u-title">Job title</Label>
                <Input id="u-title" value={form.jobTitle} onChange={(e) => setForm({ ...form, jobTitle: e.target.value })} placeholder="e.g. Audit Senior" />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={busy}><Mail /> Send invitation</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
