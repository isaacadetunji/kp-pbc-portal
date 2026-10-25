"use client";

import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Briefcase, ChevronDown, ChevronRight, Layers, Mail, Phone, Plug, Plus, RefreshCw, Search, UserPlus } from "lucide-react";
import { EngagementStatusBadge } from "@/components/status-badge";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { addClientContact, checkClientDirectory, createClientGroup, createManualClient, setClientActive, setClientGroup, syncClients } from "@/lib/actions/admin";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MONTHS } from "@/lib/constants";
import { fmtDateTime } from "@/lib/dates";
import type { Client, ClientContact, ClientGroup, EngagementStatus } from "@/lib/types";

export interface ClientEngagement {
  id: string;
  code: string;
  name: string;
  status: EngagementStatus;
  period_end: string;
  client_id: string;
  type_name: string;
}

export function ClientsAdmin({
  clients, contacts, engagementCounts, engagements = [], mode, groups, canCreateEngagements = false,
}: {
  clients: Client[]; contacts: ClientContact[]; engagementCounts: Record<string, number>; engagements?: ClientEngagement[]; mode: string; groups: ClientGroup[];
  /** create_engagements permission (Settings > Access) */
  canCreateEngagements?: boolean;
}) {
  const [detail, setDetail] = useState<Client | null>(null);
  const NONE = "__none";
  const [groupFilter, setGroupFilter] = useState("__all");
  const [groupDialog, setGroupDialog] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [contactFor, setContactFor] = useState<Client | null>(null);
  const [contactForm, setContactForm] = useState({ fullName: "", email: "", position: "", phone: "" });
  const [contactEntities, setContactEntities] = useState<Set<string>>(new Set());
  const groupName_ = (id: string | null) => groups.find((g) => g.id === id)?.name;

  async function changeGroup(clientId: string, v: string) {
    const res = await setClientGroup(clientId, v === NONE ? null : v);
    if (!res.ok) return toast.error(res.error);
    toast.success("Group updated");
    router.refresh();
  }
  async function newGroup(e: React.FormEvent) {
    e.preventDefault();
    const res = await createClientGroup(groupName);
    if (!res.ok) return toast.error(res.error);
    toast.success("Group created. Now assign entities to it.");
    setGroupDialog(false);
    setGroupName("");
    router.refresh();
  }
  function openContact(c: Client) {
    setContactFor(c);
    setContactForm({ fullName: "", email: "", position: "", phone: "" });
    setContactEntities(new Set([c.id]));
  }
  async function saveContact(e: React.FormEvent) {
    e.preventDefault();
    const res = await addClientContact({ ...contactForm, clientIds: [...contactEntities] });
    if (!res.ok) return toast.error(res.error);
    toast.success(`Contact added to ${res.data.added} entit${res.data.added === 1 ? "y" : "ies"}. Grant engagement access from each engagement.`);
    setContactFor(null);
    router.refresh();
  }
  const router = useRouter();
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", rcNumber: "", tin: "", industry: "", natureOfBusiness: "", address: "", yearEndMonth: "12", yearEndDay: "31", email: "", phone: "" });
  const [health, setHealth] = useState<string | null>(null);

  const rows = useMemo(
    () =>
      clients
        .filter((c) => groupFilter === "__all" || (groupFilter === NONE ? !c.group_id : c.group_id === groupFilter))
        .filter((c) => !q || `${c.name} ${c.rc_number ?? ""} ${c.tin ?? ""} ${c.external_id ?? ""}`.toLowerCase().includes(q.toLowerCase())),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [clients, q, groupFilter],
  );
  const lastSync = clients.map((c) => c.last_synced_at).filter(Boolean).sort().at(-1);

  async function sync() {
    setBusy(true);
    const res = await syncClients();
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    const r = res.data;
    toast.success(`Synced ${r.fetched} clients: ${r.inserted} new, ${r.updated} updated, ${r.contactsUpserted} contacts`);
    if (r.errors.length) toast.warning(`${r.errors.length} issue(s): ${r.errors.slice(0, 3).join("; ")}`);
    router.refresh();
  }
  async function check() {
    const res = await checkClientDirectory();
    setHealth(res.ok ? `${res.data.ok ? "Connected" : "Not reachable"} (${res.data.mode}): ${res.data.message}` : res.error);
  }
  async function create(e: React.FormEvent) {
    e.preventDefault();
    const res = await createManualClient({ ...form, yearEndMonth: Number(form.yearEndMonth), yearEndDay: Number(form.yearEndDay) });
    if (!res.ok) return toast.error(res.error);
    toast.success("Manual client added");
    setOpen(false);
    router.refresh();
  }
  async function toggleActive(id: string, v: boolean) {
    const res = await setClientActive(id, v);
    if (!res.ok) toast.error(res.error);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <Alert variant={mode === "mock" ? "warning" : "info"} className="items-center">
        <Plug />
        <div className="flex-1 text-sm">
          {mode === "mock"
            ? "Client database: MOCK adapter with sample data. Set CLIENT_DIRECTORY_MODE=rest and the CLIENT_API_* variables to connect the real API."
            : "Client database: connected through the REST adapter."}
          {lastSync ? ` Last sync ${fmtDateTime(lastSync)}.` : " Not synced yet."}
          {health ? <div className="mt-1 text-xs">{health}</div> : null}
        </div>
        <Button size="sm" variant="ghost" onClick={check}>Test connection</Button>
      </Alert>
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, RC, TIN or client code" className="pl-9" />
        </div>
        <Select value={groupFilter} onValueChange={setGroupFilter}>
          <SelectTrigger className="sm:w-48" aria-label="Filter by group"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">All groups</SelectItem>
            <SelectItem value={NONE}>Not in a group</SelectItem>
            {groups.map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button variant="outline" onClick={() => setGroupDialog(true)}><Layers /> New group</Button>
        <Button variant="outline" onClick={() => setOpen(true)}><Plus /> Manual client</Button>
        <Button onClick={sync} disabled={busy}><RefreshCw className={busy ? "animate-spin" : ""} /> Sync from client database</Button>
      </div>
      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8" />
              <TableHead>Client</TableHead>
              <TableHead>RC / TIN</TableHead>
              <TableHead>Group</TableHead>
              <TableHead>Year end</TableHead>
              <TableHead>Engagements</TableHead>
              <TableHead>Active</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((c) => {
              const cc = contacts.filter((x) => x.client_id === c.id);
              return (
                <Fragment key={c.id}>
                  <TableRow>
                    <TableCell>
                      <button onClick={() => setExpanded(expanded === c.id ? null : c.id)} aria-label="Show contacts">
                        {expanded === c.id ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                      </button>
                    </TableCell>
                    <TableCell>
                      <div className="font-medium">
                        <button type="button" className="text-left hover:text-primary hover:underline focus-visible:underline focus-visible:outline-none" onClick={() => setDetail(c)} aria-label={`Open ${c.name}`}>
                          {c.name}
                        </button>
                        {c.source === "manual" ? <Badge variant="warning" className="ml-1">Manual</Badge> : null}
                      </div>
                      <div className="text-xs text-muted-foreground">{c.external_id ?? "No client code"} · {cc.length} contact(s)</div>
                    </TableCell>
                    <TableCell className="text-xs">{c.rc_number ?? "—"}<br />{c.tin ?? "—"}</TableCell>
                    <TableCell>
                      <Select value={c.group_id ?? NONE} onValueChange={(v) => changeGroup(c.id, v)}>
                        <SelectTrigger className="h-8 w-44" aria-label={`Group for ${c.name}`}><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NONE}>No group</SelectItem>
                          {groups.map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="text-sm whitespace-nowrap">{c.year_end_month ? `${c.year_end_day} ${MONTHS[c.year_end_month - 1]!.slice(0, 3)}` : "—"}</TableCell>
                    <TableCell>
                      <Link className="text-sm text-primary hover:underline" href={`/engagements/new?client=${c.id}`}>{engagementCounts[c.id] ?? 0} · New</Link>
                    </TableCell>
                    <TableCell><Switch defaultChecked={c.is_active} onCheckedChange={(v) => toggleActive(c.id, v)} aria-label="Active" /></TableCell>
                  </TableRow>
                  {expanded === c.id ? (
                    <TableRow className="bg-muted/30 hover:bg-muted/30">
                      <TableCell />
                      <TableCell colSpan={6}>
                        <div className="grid gap-4 py-2 text-sm md:grid-cols-2">
                          <div>
                            <div className="text-xs font-semibold text-muted-foreground uppercase">Details</div>
                            <div>{c.nature_of_business ?? "—"}</div>
                            <div className="text-muted-foreground">{c.address ?? ""}</div>
                          </div>
                          <div>
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-semibold text-muted-foreground uppercase">Contacts</span>
                              <Button size="sm" variant="ghost" onClick={() => openContact(c)}><UserPlus /> Add contact</Button>
                            </div>
                            {cc.length === 0 ? "—" : cc.map((x) => (
                              <div key={x.id}>
                                {x.full_name}{x.position ? `, ${x.position}` : ""} <span className="text-muted-foreground">{x.email}</span>
                                {x.user_id ? <Badge variant="success" className="ml-2">Portal user</Badge> : null}
                              </div>
                            ))}
                          </div>
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : null}
                </Fragment>
              );
            })}
            {rows.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="py-10 text-center text-muted-foreground">No clients yet. Run a sync to pull them from the client database.</TableCell></TableRow>
            ) : null}
          </TableBody>
        </Table>
      </Card>

      <Sheet open={Boolean(detail)} onOpenChange={(o) => !o && setDetail(null)}>
        <SheetContent className="sm:max-w-xl">
          {detail ? (() => {
            const cc = contacts.filter((x) => x.client_id === detail.id);
            const ee = engagements.filter((e) => e.client_id === detail.id);
            return (
              <>
                <SheetHeader>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span>{detail.external_id ?? "No client code"}</span>
                    {detail.group_id ? <Badge variant="secondary"><Layers /> {groupName_(detail.group_id)}</Badge> : null}
                    {detail.source === "manual" ? <Badge variant="warning">Manual</Badge> : null}
                    {!detail.is_active ? <Badge variant="muted">Inactive</Badge> : null}
                  </div>
                  <SheetTitle className="text-lg">{detail.name}</SheetTitle>
                  <SheetDescription>
                    {[detail.rc_number, detail.tin, detail.industry].filter(Boolean).join(" · ") || "No registration details"}
                    {detail.year_end_month ? ` · Year end ${detail.year_end_day} ${MONTHS[detail.year_end_month - 1]}` : ""}
                  </SheetDescription>
                  <div className="flex flex-wrap gap-2 pt-2">
                    {canCreateEngagements ? (
                      <Button asChild size="sm">
                        <Link href={`/engagements/new?client=${detail.id}`}><Plus /> New engagement</Link>
                      </Button>
                    ) : null}
                    <Button size="sm" variant="outline" onClick={() => openContact(detail)}><UserPlus /> Add contact</Button>
                  </div>
                </SheetHeader>
                <div className="flex-1 space-y-6 overflow-y-auto p-5">
                  {detail.nature_of_business || detail.address ? (
                    <section className="space-y-1 text-sm">
                      <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Details</h3>
                      {detail.nature_of_business ? <p>{detail.nature_of_business}</p> : null}
                      {detail.address ? <p className="text-muted-foreground">{detail.address}</p> : null}
                    </section>
                  ) : null}
                  <section className="space-y-2">
                    <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Users ({cc.length})</h3>
                    {cc.length === 0 ? (
                      <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">No contacts yet. Add one, then grant access from an engagement.</p>
                    ) : (
                      <ul className="divide-y rounded-lg border" aria-label="Client users">
                        {cc.map((x) => (
                          <li key={x.id} className="space-y-0.5 px-3 py-2.5">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-sm font-medium">{x.full_name}</span>
                              {x.position ? <span className="text-sm text-muted-foreground">· {x.position}</span> : null}
                              {x.is_primary ? <Badge variant="info">Primary</Badge> : null}
                              {x.user_id ? <Badge variant="success">Portal user</Badge> : <Badge variant="muted">No account</Badge>}
                            </div>
                            <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
                              <a href={`mailto:${x.email}`} className="flex items-center gap-1 hover:text-primary"><Mail className="size-3" /> {x.email}</a>
                              {x.phone ? <span className="flex items-center gap-1"><Phone className="size-3" /> {x.phone}</span> : null}
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                  <section className="space-y-2">
                    <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Engagements ({ee.length})</h3>
                    {ee.length === 0 ? (
                      <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">No engagements yet.</p>
                    ) : (
                      <ul className="divide-y rounded-lg border" aria-label="Engagements">
                        {ee.map((e) => (
                          <li key={e.id}>
                            <Link href={`/engagements/${e.id}`} className="flex items-center gap-3 px-3 py-2.5 hover:bg-muted/40">
                              <Briefcase className="size-4 shrink-0 text-muted-foreground" />
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-sm font-medium">FY{e.period_end.slice(0, 4)} · {e.type_name}</span>
                                <span className="block truncate text-xs text-muted-foreground">{e.code} · {e.name}</span>
                              </span>
                              <EngagementStatusBadge status={e.status} />
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                </div>
              </>
            );
          })() : null}
        </SheetContent>
      </Sheet>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Add manual client</DialogTitle>
            <DialogDescription>Use only when the client is not yet in the client database. Manual clients are flagged until they are.</DialogDescription>
          </DialogHeader>
          <form onSubmit={create} className="grid gap-3 sm:grid-cols-2">
            {([
              ["name", "Company name", true, "sm:col-span-2"],
              ["rcNumber", "RC number"],
              ["tin", "TIN"],
              ["industry", "Industry"],
              ["email", "Email"],
              ["natureOfBusiness", "Nature of business", false, "sm:col-span-2"],
              ["address", "Address", false, "sm:col-span-2"],
            ] as [keyof typeof form, string, boolean?, string?][]).map(([k, label, req, cls]) => (
              <div key={k} className={`space-y-1.5 ${cls ?? ""}`}>
                <Label htmlFor={`mc-${k}`}>{label}</Label>
                <Input id={`mc-${k}`} required={req} value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
              </div>
            ))}
            <div className="space-y-1.5">
              <Label htmlFor="mc-m">Year-end month (1-12)</Label>
              <Input id="mc-m" type="number" min={1} max={12} value={form.yearEndMonth} onChange={(e) => setForm({ ...form, yearEndMonth: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mc-d">Year-end day</Label>
              <Input id="mc-d" type="number" min={1} max={31} value={form.yearEndDay} onChange={(e) => setForm({ ...form, yearEndDay: e.target.value })} />
            </div>
            <DialogFooter className="sm:col-span-2">
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit">Add client</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={groupDialog} onOpenChange={setGroupDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New client group</DialogTitle>
            <DialogDescription>Group related entities (e.g. a parent and its subsidiaries). One contact can then be given access to several entities and see a combined summary.</DialogDescription>
          </DialogHeader>
          <form onSubmit={newGroup} className="space-y-4">
            <Input value={groupName} onChange={(e) => setGroupName(e.target.value)} placeholder="e.g. Adebayo Group" required autoFocus />
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setGroupDialog(false)}>Cancel</Button>
              <Button type="submit">Create group</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(contactFor)} onOpenChange={(o) => !o && setContactFor(null)}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Add client contact</DialogTitle>
            <DialogDescription>One person, one login. Tick every entity they work on. Access to each engagement is then granted by its engagement team.</DialogDescription>
          </DialogHeader>
          <form onSubmit={saveContact} className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="ct-name">Full name</Label>
              <Input id="ct-name" required value={contactForm.fullName} onChange={(e) => setContactForm({ ...contactForm, fullName: e.target.value })} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="ct-email">Email</Label>
              <Input id="ct-email" type="email" required value={contactForm.email} onChange={(e) => setContactForm({ ...contactForm, email: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ct-pos">Position</Label>
              <Input id="ct-pos" value={contactForm.position} onChange={(e) => setContactForm({ ...contactForm, position: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ct-phone">Phone</Label>
              <Input id="ct-phone" value={contactForm.phone} onChange={(e) => setContactForm({ ...contactForm, phone: e.target.value })} />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label>Entities</Label>
              <div className="max-h-48 space-y-1 overflow-y-auto rounded-md border p-2">
                {clients
                  .filter((x) => x.id === contactFor?.id || (contactFor?.group_id && x.group_id === contactFor.group_id))
                  .map((x) => (
                    <label key={x.id} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={contactEntities.has(x.id)}
                        onCheckedChange={(v) => setContactEntities((s) => { const n = new Set(s); if (v === true) n.add(x.id); else n.delete(x.id); return n; })}
                      />
                      {x.name}
                    </label>
                  ))}
              </div>
              {contactFor?.group_id ? (
                <p className="text-xs text-muted-foreground">Showing entities in {groupName_(contactFor.group_id)}.</p>
              ) : (
                <p className="text-xs text-muted-foreground">Put this client in a group to add the contact to several entities at once.</p>
              )}
            </div>
            <DialogFooter className="sm:col-span-2">
              <Button type="button" variant="ghost" onClick={() => setContactFor(null)}>Cancel</Button>
              <Button type="submit" disabled={contactEntities.size === 0}>Add contact</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
