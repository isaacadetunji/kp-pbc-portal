"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Building2, Check, ChevronLeft, ChevronRight, ChevronsUpDown, Loader2, Search, ShieldAlert, UserCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createClient } from "@/lib/supabase/client";
import { MONTHS, TEAM_ROLE } from "@/lib/constants";
import type { Client, ClientContact, EngagementType, MasterCategory, MasterItem, Person, TeamRole } from "@/lib/types";
import { cn, friendlyError } from "@/lib/utils";

const STEPS = ["Client", "Scope & team", "Request list", "Review"];

function isoDate(y: number, m: number, d: number) {
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${y}-${String(m).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

/** Most recent year end on or before today; start = day after previous year end. */
function defaultPeriod(c: Client | undefined) {
  const m = c?.year_end_month ?? 12;
  const d = c?.year_end_day ?? 31;
  const now = new Date();
  let y = now.getFullYear();
  if (isoDate(y, m, d) > now.toISOString().slice(0, 10)) y -= 1;
  const end = isoDate(y, m, d);
  const prev = new Date(`${isoDate(y - 1, m, d)}T00:00:00Z`);
  prev.setUTCDate(prev.getUTCDate() + 1);
  return { start: prev.toISOString().slice(0, 10), end };
}

type PickRole = "partner" | "manager" | "member";

/** Multi-select of firm users for one team role (shows job titles). */
function StaffPicker({
  id, label, help, staff, value, taken, onChange,
}: {
  id: string; label: string; help?: string; staff: Person[]; value: string[];
  /** Users already chosen for another role (shown with that role, not selectable) */
  taken: Map<string, string>;
  onChange: (ids: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const names = value.map((v) => staff.find((s) => s.id === v)?.full_name ?? "").filter(Boolean);
  const list = staff.filter((s) => !q || `${s.full_name} ${s.email} ${s.job_title ?? ""}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button id={id} type="button" variant="outline" className="h-auto min-h-9 w-full justify-between py-1.5 font-normal" aria-describedby={help ? `${id}-help` : undefined}>
            <span className="truncate text-left">{names.length ? names.join(", ") : <span className="text-muted-foreground">Nobody</span>}</span>
            <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[min(24rem,calc(100vw-2rem))] space-y-2 p-2">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search people" aria-label={`Search ${label}`} className="h-8" />
          <ul className="max-h-72 space-y-0.5 overflow-y-auto">
            {list.map((s) => {
              const other = taken.get(s.id);
              const checked = value.includes(s.id);
              return (
                <li key={s.id}>
                  <label className={cn("flex items-center gap-2 rounded-md px-1.5 py-1.5 text-sm", other ? "opacity-60" : "cursor-pointer hover:bg-muted/60")}>
                    <Checkbox
                      checked={checked}
                      disabled={Boolean(other)}
                      onCheckedChange={(v) => onChange(v === true ? [...value, s.id] : value.filter((x) => x !== s.id))}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{s.full_name || s.email}</span>
                      <span className="block truncate text-xs text-muted-foreground">{[s.job_title, other ? `already ${other}` : null].filter(Boolean).join(" · ") || s.email}</span>
                    </span>
                  </label>
                </li>
              );
            })}
            {list.length === 0 ? <li className="p-2 text-sm text-muted-foreground">No one matches.</li> : null}
          </ul>
        </PopoverContent>
      </Popover>
      {help ? <p id={`${id}-help`} className="text-xs text-muted-foreground">{help}</p> : null}
    </div>
  );
}

export function NewEngagementWizard({
  me, initialClientId, clients, contacts, types, staff, categories, masterItems,
}: {
  me: string; initialClientId?: string; clients: Client[]; contacts: ClientContact[]; types: EngagementType[];
  staff: Person[]; categories: MasterCategory[]; masterItems: MasterItem[];
}) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [clientQ, setClientQ] = useState("");
  const [clientId, setClientId] = useState<string | undefined>(initialClientId);
  const [typeId, setTypeId] = useState(types[0]?.id ?? "");
  const client = clients.find((c) => c.id === clientId);
  const type = types.find((t) => t.id === typeId);
  const period = defaultPeriod(client);
  const [start, setStart] = useState(period.start);
  const [end, setEnd] = useState(period.end);
  const [name, setName] = useState("");
  // The creator is not made lead or added to the team automatically.
  const [leadId, setLeadId] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [team, setTeam] = useState<{ user_id: string; team_role: PickRole }[]>([]);
  const roleIds = (r: PickRole) => team.filter((t) => t.team_role === r).map((t) => t.user_id);
  const setRole = (r: PickRole, ids: string[]) =>
    setTeam((all) => [...all.filter((t) => t.team_role !== r), ...ids.filter((id) => id !== leadId).map((user_id) => ({ user_id, team_role: r }))]);
  const takenFor = (r: PickRole) => {
    const m = new Map<string, string>();
    if (leadId) m.set(leadId, TEAM_ROLE.lead.toLowerCase());
    team.filter((t) => t.team_role !== r).forEach((t) => m.set(t.user_id, TEAM_ROLE[t.team_role as TeamRole].toLowerCase()));
    return m;
  };
  const meOnTeam = leadId === me || team.some((t) => t.user_id === me);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [proposedFor, setProposedFor] = useState<string | null>(null);
  const [plannedStart, setPlannedStart] = useState("");
  const [docsDue, setDocsDue] = useState("");
  const [reportDue, setReportDue] = useState("");
  // Client access: every contact with a portal account is ticked by default
  const portalUsers = (cid?: string) => contacts.filter((c) => c.client_id === cid && c.user_id).map((c) => c.id);
  const [access, setAccess] = useState<Set<string>>(() => new Set(portalUsers(initialClientId)));

  const filteredClients = useMemo(() => {
    const n = clientQ.trim().toLowerCase();
    return clients.filter((c) => !n || `${c.name} ${c.rc_number ?? ""} ${c.tin ?? ""} ${c.industry ?? ""}`.toLowerCase().includes(n)).slice(0, 50);
  }, [clientQ, clients]);

  const applicable = useMemo(
    () => masterItems.filter((m) => (m.master_item_engagement_types ?? []).some((x) => x.engagement_type_id === typeId)),
    [masterItems, typeId],
  );
  const byCategory = useMemo(
    () =>
      categories
        .map((c) => ({ category: c, items: masterItems.filter((m) => m.category_id === c.id) }))
        .filter((g) => g.items.length > 0),
    [categories, masterItems],
  );

  function pickClient(c: Client) {
    if (c.id !== clientId) setAccess(new Set(portalUsers(c.id)));
    setClientId(c.id);
    const p = defaultPeriod(c);
    setStart(p.start);
    setEnd(p.end);
  }

  function goToList() {
    // Propose the list for the chosen engagement type (only on first visit or type change)
    if (proposedFor !== typeId) {
      setSelected(new Set(applicable.map((m) => m.id)));
      setProposedFor(typeId);
    }
    setStep(2);
  }

  async function create() {
    if (!client || !type) return;
    setBusy(true);
    const { data, error } = await createClient().rpc("create_engagement", {
      p_client_id: client.id,
      p_engagement_type_id: type.id,
      p_name: name.trim() || `${type.name} — FY${end.slice(0, 4)}`,
      p_period_start: start || null,
      p_period_end: end,
      p_lead_id: leadId,
      p_master_item_ids: [...selected],
      p_default_due_date: dueDate || null,
      p_team: team,
      p_planned_start: plannedStart || null,
      p_documents_due: docsDue || null,
      p_report_due: reportDue || null,
      p_client_contact_ids: [...access],
    });
    if (error) {
      setBusy(false);
      return toast.error(friendlyError(error));
    }
    toast.success(
      access.size
        ? `Engagement created as a draft. ${access.size} client user${access.size === 1 ? "" : "s"} can see it as "Request in progress" until you release the list.`
        : "Engagement created as a draft. Customise the list, invite the client, then release it.",
    );
    router.push(`/engagements/${data}?tab=requests`);
  }

  const clientContacts = contacts.filter((c) => c.client_id === clientId);
  const datesInvalid = Boolean(docsDue && reportDue && reportDue < docsDue);
  const critical = masterItems.filter((m) => selected.has(m.id) && m.is_critical).length;

  return (
    <div className="space-y-6">
      <ol className="grid grid-cols-4 gap-2" aria-label="Steps">
        {STEPS.map((s, i) => (
          <li key={s} className="space-y-1.5">
            <div className={cn("h-1 rounded-full", i <= step ? "bg-primary" : "bg-muted")} />
            <div className={cn("text-xs font-medium", i === step ? "text-foreground" : "text-muted-foreground")} aria-current={i === step ? "step" : undefined}>
              {i + 1}. {s}
            </div>
          </li>
        ))}
      </ol>

      {step === 0 ? (
        <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
          <Card>
            <CardHeader>
              <CardTitle>Find the client</CardTitle>
              <CardDescription>Clients are synced from the firm&apos;s client database. Ask an administrator to sync if a client is missing.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="relative">
                <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input autoFocus value={clientQ} onChange={(e) => setClientQ(e.target.value)} placeholder="Name, RC number or TIN" className="pl-9" />
              </div>
              <ul className="max-h-[420px] divide-y overflow-y-auto rounded-lg border">
                {filteredClients.map((c) => (
                  <li key={c.id}>
                    <button onClick={() => pickClient(c)} className={cn("flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-muted/40", c.id === clientId && "bg-accent")}>
                      <Building2 className="size-4 text-muted-foreground" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{c.name}</span>
                        <span className="block text-xs text-muted-foreground">{[c.rc_number, c.industry].filter(Boolean).join(" · ")}</span>
                      </span>
                      {c.source === "manual" ? <Badge variant="warning">Manual</Badge> : null}
                      {c.id === clientId ? <Check className="size-4 text-primary" /> : null}
                    </button>
                  </li>
                ))}
                {filteredClients.length === 0 ? <li className="p-4 text-sm text-muted-foreground">No clients match.</li> : null}
              </ul>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Client details</CardTitle>
              <CardDescription>Auto-populated from the client database.</CardDescription>
            </CardHeader>
            <CardContent>
              {client ? (
                <dl className="grid grid-cols-[8rem_1fr] gap-x-4 gap-y-2 text-sm">
                  <dt className="text-muted-foreground">Name</dt><dd className="font-medium">{client.name}</dd>
                  <dt className="text-muted-foreground">RC number</dt><dd>{client.rc_number ?? "—"}</dd>
                  <dt className="text-muted-foreground">TIN</dt><dd>{client.tin ?? "—"}</dd>
                  <dt className="text-muted-foreground">Industry</dt><dd>{client.industry ?? "—"}</dd>
                  <dt className="text-muted-foreground">Nature of business</dt><dd>{client.nature_of_business ?? "—"}</dd>
                  <dt className="text-muted-foreground">Address</dt><dd>{client.address ?? "—"}</dd>
                  <dt className="text-muted-foreground">Year end</dt><dd>{client.year_end_month ? `${client.year_end_day} ${MONTHS[client.year_end_month - 1]}` : "—"}</dd>
                  <dt className="text-muted-foreground">Contacts</dt>
                  <dd className="space-y-1">
                    {clientContacts.length === 0 ? "—" : clientContacts.map((c) => (
                      <div key={c.id}>{c.full_name}{c.position ? `, ${c.position}` : ""} <span className="text-muted-foreground">({c.email})</span></div>
                    ))}
                  </dd>
                </dl>
              ) : (
                <p className="text-sm text-muted-foreground">Select a client to see their details.</p>
              )}
            </CardContent>
          </Card>
        </div>
      ) : null}

      {step === 1 ? (
        <Card>
          <CardHeader>
            <CardTitle>Scope & team</CardTitle>
            <CardDescription>{client?.name}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-5 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Engagement type</Label>
              <Select value={typeId} onValueChange={setTypeId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{types.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="nm">Engagement name</Label>
              <Input id="nm" value={name} onChange={(e) => setName(e.target.value)} placeholder={`${type?.name ?? ""} — FY${end.slice(0, 4)}`} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ps">Period start</Label>
              <Input id="ps" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pe">Period end</Label>
              <Input id="pe" type="date" value={end} onChange={(e) => setEnd(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="lead">Team lead <span className="text-destructive" aria-hidden>*</span></Label>
              <Select value={leadId} onValueChange={(v) => { setLeadId(v); setTeam((all) => all.filter((t) => t.user_id !== v)); }}>
                <SelectTrigger id="lead" aria-required="true" aria-describedby="lead-help"><SelectValue placeholder="Choose the team lead" /></SelectTrigger>
                <SelectContent>
                  {staff.map((s) => <SelectItem key={s.id} value={s.id}>{s.full_name || s.email}{s.job_title ? ` · ${s.job_title}` : ""}</SelectItem>)}
                </SelectContent>
              </Select>
              <p id="lead-help" className="text-xs text-muted-foreground">Exactly one. It can be changed later from the Team tab.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="dd">Default due date for items</Label>
              <Input id="dd" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
              <p className="text-xs text-muted-foreground">You can change due dates per item or in bulk later.</p>
            </div>
            <fieldset className="grid gap-4 md:col-span-2 md:grid-cols-3">
              <legend className="mb-2 text-sm font-medium">Engagement team</legend>
              <StaffPicker id="partners" label={`${TEAM_ROLE.partner}(s)`} help="Same powers as the team lead." staff={staff} value={roleIds("partner")} taken={takenFor("partner")} onChange={(ids) => setRole("partner", ids)} />
              <StaffPicker id="managers" label="Managers" staff={staff} value={roleIds("manager")} taken={takenFor("manager")} onChange={(ids) => setRole("manager", ids)} />
              <StaffPicker id="members" label="Team members" staff={staff} value={roleIds("member")} taken={takenFor("member")} onChange={(ids) => setRole("member", ids)} />
              {!meOnTeam ? (
                <p className="text-xs text-muted-foreground md:col-span-3">
                  You are not on this team. As the creator you can still open the engagement, but only the team works on it.
                </p>
              ) : null}
            </fieldset>
            <fieldset className="space-y-2 md:col-span-2">
              <legend className="text-sm font-medium">Planned dates</legend>
              <p className="text-xs text-muted-foreground">Shown on the engagement calendar for the team and the client. You can change them later in Settings.</p>
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor="pl-start">Planned start</Label>
                  <Input id="pl-start" type="date" value={plannedStart} onChange={(e) => setPlannedStart(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="pl-docs">Documents due</Label>
                  <Input id="pl-docs" type="date" value={docsDue} onChange={(e) => setDocsDue(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="pl-report">Report due</Label>
                  <Input id="pl-report" type="date" min={docsDue || undefined} value={reportDue} onChange={(e) => setReportDue(e.target.value)} aria-invalid={datesInvalid || undefined} />
                </div>
              </div>
              {datesInvalid ? <p className="text-xs text-destructive">The report due date can&apos;t be before the documents due date.</p> : null}
            </fieldset>
            <fieldset className="space-y-2 md:col-span-2">
              <legend className="flex items-center gap-2 text-sm font-medium"><UserCheck className="size-4 text-muted-foreground" /> Client access</legend>
              <p className="text-xs text-muted-foreground">
                Ticked client users see this engagement straight away as &quot;Request in progress&quot; (team and key dates only). They see the request list once it is approved and released.
              </p>
              {clientContacts.length === 0 ? (
                <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">This client has no contacts yet. Invite client users from the engagement&apos;s Team tab.</p>
              ) : (
                <ul className="divide-y rounded-md border" aria-label="Client users">
                  {clientContacts.map((c) => (
                    <li key={c.id}>
                      <label className={cn("flex items-center gap-3 px-3 py-2", c.user_id ? "cursor-pointer hover:bg-muted/30" : "opacity-70")}>
                        <Checkbox
                          checked={access.has(c.id)}
                          disabled={!c.user_id}
                          onCheckedChange={(v) => setAccess((s) => { const n = new Set(s); if (v === true) n.add(c.id); else n.delete(c.id); return n; })}
                          aria-label={`Give ${c.full_name} access`}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{c.full_name}{c.position ? <span className="font-normal text-muted-foreground"> · {c.position}</span> : null}</span>
                          <span className="block truncate text-xs text-muted-foreground">{c.email}</span>
                        </span>
                        {c.user_id ? <Badge variant="success">Portal user</Badge> : <Badge variant="muted">No account yet</Badge>}
                      </label>
                    </li>
                  ))}
                </ul>
              )}
              {clientContacts.some((c) => !c.user_id) ? (
                <p className="text-xs text-muted-foreground">Contacts without a portal account can be invited from the Team tab after creation.</p>
              ) : null}
            </fieldset>
          </CardContent>
        </Card>
      ) : null}

      {step === 2 ? (
        <Card>
          <CardHeader>
            <CardTitle>Proposed request list</CardTitle>
            <CardDescription>
              {selected.size} items selected ({critical} critical). Items applicable to {type?.name} are pre-selected; add or remove any. You can add custom items and folders after creation.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {byCategory.map(({ category, items }) => {
              const ids = items.map((i) => i.id);
              const all = ids.every((id) => selected.has(id));
              const some = ids.some((id) => selected.has(id));
              return (
                <section key={category.id} className="rounded-lg border">
                  <header className="flex items-center gap-3 border-b bg-muted/40 px-3 py-2">
                    <Checkbox
                      checked={all ? true : some ? "indeterminate" : false}
                      onCheckedChange={(v) => setSelected((s) => { const n = new Set(s); ids.forEach((id) => (v === true ? n.add(id) : n.delete(id))); return n; })}
                      aria-label={`Select all ${category.name}`}
                    />
                    <span className="text-sm font-semibold">{category.name}</span>
                    <span className="text-xs text-muted-foreground">{ids.filter((id) => selected.has(id)).length}/{ids.length}</span>
                  </header>
                  <ul className="divide-y">
                    {items.map((m) => (
                      <li key={m.id}>
                        <label className="flex cursor-pointer items-start gap-3 px-3 py-2 hover:bg-muted/30">
                          <Checkbox className="mt-0.5" checked={selected.has(m.id)} onCheckedChange={(v) => setSelected((s) => { const n = new Set(s); if (v === true) n.add(m.id); else n.delete(m.id); return n; })} />
                          <span className="w-16 shrink-0 font-mono text-xs text-muted-foreground">{m.code}</span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm">{m.title}</span>
                            <span className="block text-xs text-muted-foreground">{m.default_folder}</span>
                          </span>
                          {m.is_critical ? <Badge variant="danger"><ShieldAlert /> Critical</Badge> : null}
                        </label>
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </CardContent>
        </Card>
      ) : null}

      {step === 3 ? (
        <Card>
          <CardHeader>
            <CardTitle>Review and create</CardTitle>
            <CardDescription>The engagement is created as a draft. Client users with access see it as &quot;Request in progress&quot; until the request list is approved and released.</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-[7.5rem_1fr] gap-x-4 gap-y-2 text-sm sm:grid-cols-[10rem_1fr]">
              <dt className="text-muted-foreground">Client</dt><dd className="font-medium">{client?.name}</dd>
              <dt className="text-muted-foreground">Type</dt><dd>{type?.name}</dd>
              <dt className="text-muted-foreground">Name</dt><dd>{name || `${type?.name} — FY${end.slice(0, 4)}`}</dd>
              <dt className="text-muted-foreground">Period</dt><dd>{start || "—"} to {end}</dd>
              <dt className="text-muted-foreground">{TEAM_ROLE.lead}</dt><dd>{staff.find((s) => s.id === leadId)?.full_name ?? "—"}</dd>
              {(["partner", "manager", "member"] as const).map((r) => (
                <div key={r} className="contents">
                  <dt className="text-muted-foreground">{r === "partner" ? "Partners" : r === "manager" ? "Managers" : "Team members"}</dt>
                  <dd>{roleIds(r).map((id) => staff.find((s) => s.id === id)?.full_name).join(", ") || "—"}</dd>
                </div>
              ))}
              <dt className="text-muted-foreground">Request items</dt><dd>{selected.size} ({critical} critical / pre-engagement)</dd>
              <dt className="text-muted-foreground">Default due date</dt><dd>{dueDate || "Not set"}</dd>
              <dt className="text-muted-foreground">Planned dates</dt>
              <dd>Start {plannedStart || "—"} · documents due {docsDue || "—"} · report due {reportDue || "—"}</dd>
              <dt className="text-muted-foreground">Client access</dt>
              <dd>{access.size ? clientContacts.filter((c) => access.has(c.id)).map((c) => c.full_name).join(", ") : "Nobody yet"}</dd>
            </dl>
          </CardContent>
        </Card>
      ) : null}

      <div className="flex justify-between">
        <Button variant="ghost" disabled={step === 0 || busy} onClick={() => setStep((s) => s - 1)}><ChevronLeft /> Back</Button>
        {step === 0 ? <Button disabled={!client} onClick={() => setStep(1)}>Continue <ChevronRight /></Button> : null}
        {step === 1 ? <Button disabled={!typeId || !end || !leadId || datesInvalid} onClick={goToList}>Continue <ChevronRight /></Button> : null}
        {step === 2 ? <Button disabled={selected.size === 0} onClick={() => setStep(3)}>Continue <ChevronRight /></Button> : null}
        {step === 3 ? <Button disabled={busy} onClick={create}>{busy ? <Loader2 className="animate-spin" /> : <Check />} Create engagement</Button> : null}
      </div>
    </div>
  );
}
