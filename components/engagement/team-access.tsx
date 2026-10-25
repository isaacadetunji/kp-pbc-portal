"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Building2, Crown, Mail, Phone, ShieldCheck, Trash2, UserPlus, UserX, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { inviteClientContact } from "@/lib/actions/engagements";
import { createClient } from "@/lib/supabase/client";
import { TEAM_ROLE, TEAM_ROLE_ORDER } from "@/lib/constants";
import { fmtDateTime } from "@/lib/dates";
import type { ClientAccessRow, TeamMember } from "@/lib/engagement-data";
import type { ClientContact, Person, TeamRole } from "@/lib/types";
import { cn, friendlyError, initials } from "@/lib/utils";

const NEW = "__new";
const ROW = "grid gap-x-4 gap-y-1 px-3 py-3 md:grid-cols-[minmax(0,1.5fr)_9.5rem_minmax(0,1.6fr)_9rem_auto] md:items-center";

function Contact({ email, phone }: { email?: string | null; phone?: string | null }) {
  return (
    <>
      <div className="min-w-0 text-sm">
        {email ? (
          <a href={`mailto:${email}`} className="flex min-w-0 items-center gap-1.5 text-primary hover:underline">
            <Mail className="size-3.5 shrink-0 md:hidden" /> <span className="truncate">{email}</span>
          </a>
        ) : <span className="text-muted-foreground">—</span>}
      </div>
      <div className="text-sm">
        {phone ? (
          <a href={`tel:${phone.replace(/\s+/g, "")}`} className="flex items-center gap-1.5 hover:underline">
            <Phone className="size-3.5 shrink-0 md:hidden" /> {phone}
          </a>
        ) : <span className="hidden text-muted-foreground md:inline">—</span>}
      </div>
    </>
  );
}

export function TeamAccess({
  engagementId,
  team,
  staff,
  access,
  contacts,
  canManage,
  isLead = false,
  userId,
  isDraft,
  audience = "team",
}: {
  engagementId: string;
  team: TeamMember[];
  staff: Person[];
  access: ClientAccessRow[];
  contacts: ClientContact[];
  canManage: boolean;
  /** Partner or team lead (or Super admin): may add / remove partners */
  isLead?: boolean;
  userId?: string;
  isDraft: boolean;
  audience?: "team" | "client";
}) {
  const router = useRouter();
  const supabase = createClient();
  const [addUser, setAddUser] = useState("");
  const [addRole, setAddRole] = useState<TeamRole>("member");
  const [leadPick, setLeadPick] = useState("");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [contactId, setContactId] = useState<string>(NEW);
  const [form, setForm] = useState({ fullName: "", email: "", phone: "", position: "" });
  const [busy, setBusy] = useState(false);
  const isTeam = audience === "team";
  const manage = isTeam && canManage;

  const onTeam = new Set(team.map((t) => t.id));
  const lead = team.find((t) => t.team_role === "lead");
  // Roles a user may give by direct edit (the lead changes through set_engagement_lead)
  const assignable = TEAM_ROLE_ORDER.filter((r) => r !== "lead" && (r !== "partner" || isLead));
  const canEditRow = (r: TeamRole) => manage && r !== "lead" && (r !== "partner" || isLead);

  async function changeLead(newLead: string) {
    if (!newLead) return;
    const person = staff.find((s) => s.id === newLead) ?? team.find((t) => t.id === newLead);
    if (!confirm(`Make ${person?.full_name ?? "this person"} the team lead?${lead ? ` ${lead.full_name} becomes a manager.` : ""}`)) {
      setLeadPick("");
      return;
    }
    const { error } = await supabase.rpc("set_engagement_lead", { p_engagement_id: engagementId, p_user_id: newLead });
    if (error) return toast.error(friendlyError(error));
    toast.success(`${person?.full_name ?? "New lead"} is now the team lead`);
    setLeadPick("");
    router.refresh();
  }
  const granted = new Set(access.filter((a) => !a.revoked_at).map((a) => a.contact.id));
  const visibleAccess = isTeam ? access : access.filter((a) => !a.revoked_at);

  async function addMember() {
    if (!addUser) return;
    const { error } = await supabase.from("engagement_team").insert({ engagement_id: engagementId, user_id: addUser, team_role: addRole });
    if (error) return toast.error(friendlyError(error));
    setAddUser("");
    router.refresh();
  }
  async function changeRole(userId: string, role: TeamRole) {
    const { error } = await supabase.from("engagement_team").update({ team_role: role }).eq("engagement_id", engagementId).eq("user_id", userId);
    if (error) return toast.error(friendlyError(error));
    router.refresh();
  }
  async function removeMember(userId: string) {
    if (!confirm("Remove this person from the engagement team?")) return;
    const { error } = await supabase.from("engagement_team").delete().eq("engagement_id", engagementId).eq("user_id", userId);
    if (error) return toast.error(friendlyError(error));
    router.refresh();
  }
  async function setRevoked(id: string, revoke: boolean) {
    const { error } = await supabase
      .from("engagement_client_access")
      .update({ revoked_at: revoke ? new Date().toISOString() : null })
      .eq("id", id);
    if (error) return toast.error(friendlyError(error));
    toast.success(revoke ? "Access revoked" : "Access restored");
    router.refresh();
  }

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const res = await inviteClientContact(contactId === NEW ? { engagementId, ...form } : { engagementId, contactId });
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    toast.success(
      res.data.invited === "new_user"
        ? `Invitation sent to ${res.data.email}`
        : res.data.invited === "magic_link"
          ? `Access granted and sign-in link sent to ${res.data.email}`
          : `Access granted to ${res.data.email}${isDraft ? ". They see the engagement as \"Request in progress\" until the list is released." : ""}`,
    );
    setInviteOpen(false);
    setForm({ fullName: "", email: "", phone: "", position: "" });
    setContactId(NEW);
    router.refresh();
  }

  const header = (cols: string[]) => (
    <div className={cn(ROW, "hidden border-b bg-muted/40 py-2 text-xs font-semibold text-muted-foreground md:grid")} aria-hidden>
      {cols.map((c, i) => <span key={i}>{c}</span>)}
    </div>
  );

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Users className="size-4" /> Engagement team</CardTitle>
          <CardDescription>
            {isTeam
              ? "Partners, the team lead and managers edit the request list, invite client users, approve and move the stage. Partners and the team lead can also waive critical items and complete an engagement with open items. There is exactly one team lead."
              : `The ${team.length} people at the firm working on this engagement.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="overflow-hidden rounded-lg border">
            {header(["Name", "Engagement role", "Email", "Phone", ""])}
            <ul className="divide-y" aria-label="Engagement team">
              {team.map((t) => (
                <li key={t.id} className={ROW}>
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="grid size-8 shrink-0 place-items-center rounded-full bg-primary text-xs font-semibold text-primary-foreground" aria-hidden>{initials(t.full_name)}</span>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{t.full_name || t.email}</div>
                      <div className="truncate text-xs text-muted-foreground">{t.job_title ?? "—"}{t.id === userId ? " · you" : ""}</div>
                    </div>
                  </div>
                  <div>
                    {canEditRow(t.team_role) ? (
                      <Select value={t.team_role} onValueChange={(v) => changeRole(t.id, v as TeamRole)}>
                        <SelectTrigger className="h-8 w-40" aria-label={`Role of ${t.full_name}`}><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {assignable.map((r) => <SelectItem key={r} value={r}>{TEAM_ROLE[r]}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Badge variant={t.team_role === "lead" || t.team_role === "partner" ? "default" : t.team_role === "manager" ? "info" : "secondary"}>
                        {t.team_role === "lead" ? <Crown /> : null}{TEAM_ROLE[t.team_role]}
                      </Badge>
                    )}
                  </div>
                  <Contact email={t.email} phone={t.phone} />
                  <div className="flex justify-end">
                    {canEditRow(t.team_role) ? (
                      <Button size="icon-sm" variant="ghost" onClick={() => removeMember(t.id)} aria-label={`Remove ${t.full_name}`}><Trash2 /></Button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </div>
          {manage ? (
            <div className="flex flex-col gap-2 rounded-lg border bg-muted/30 p-3 sm:flex-row sm:items-center">
              <label htmlFor="lead-pick" className="flex items-center gap-2 text-sm font-medium sm:w-44"><Crown className="size-4 text-muted-foreground" /> Change team lead</label>
              <Select value={leadPick} onValueChange={(v) => { setLeadPick(v); changeLead(v); }}>
                <SelectTrigger id="lead-pick" className="flex-1" aria-describedby="lead-pick-help"><SelectValue placeholder={lead ? `Current: ${lead.full_name}` : "Choose the team lead"} /></SelectTrigger>
                <SelectContent>
                  {staff.filter((s) => s.id !== lead?.id).map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.full_name || s.email}{s.job_title ? ` · ${s.job_title}` : ""}{onTeam.has(s.id) ? "" : " (not on the team yet)"}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span id="lead-pick-help" className="text-xs text-muted-foreground sm:w-48">The previous lead becomes a manager.</span>
            </div>
          ) : null}
          {manage ? (
            <div className="flex flex-col gap-2 sm:flex-row">
              <Select value={addUser} onValueChange={setAddUser}>
                <SelectTrigger className="flex-1" aria-label="Colleague to add"><SelectValue placeholder="Add a colleague…" /></SelectTrigger>
                <SelectContent>
                  {staff.filter((s) => !onTeam.has(s.id)).map((s) => <SelectItem key={s.id} value={s.id}>{s.full_name || s.email}{s.job_title ? ` · ${s.job_title}` : ""}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={addRole} onValueChange={(v) => setAddRole(v as TeamRole)}>
                <SelectTrigger className="sm:w-44" aria-label="Role for the new colleague"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {assignable.map((r) => <SelectItem key={r} value={r}>{TEAM_ROLE[r]}</SelectItem>)}
                </SelectContent>
              </Select>
              <Button onClick={addMember} disabled={!addUser}><UserPlus /> Add</Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {isTeam ? <ShieldCheck className="size-4" /> : <Building2 className="size-4" />} Client team
          </CardTitle>
          <CardDescription>
            {isTeam
              ? "Client users with portal access to this engagement. Before release they see it as \"Request in progress\" (team and calendar only); after release they see the request list, their uploads and non-internal comments."
              : "People at your organisation who can see this engagement."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {visibleAccess.length === 0 ? (
            <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
              No client users yet.{isTeam ? " Invite at least one contact before releasing the list." : ""}
            </p>
          ) : (
            <div className="overflow-hidden rounded-lg border">
              {header(["Name", "Portal", "Email", "Phone", ""])}
              <ul className="divide-y" aria-label="Client team">
                {visibleAccess.map((a) => (
                  <li key={a.id} className={cn(ROW, a.revoked_at && "bg-muted/30")}>
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-client-soft text-xs font-semibold text-client" aria-hidden>{initials(a.contact.full_name)}</span>
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{a.contact.full_name}</div>
                        <div className="truncate text-xs text-muted-foreground">{a.contact.position ?? "—"}</div>
                      </div>
                    </div>
                    <div title={a.revoked_at ? `Revoked ${fmtDateTime(a.revoked_at)}` : a.first_login_at ? `Active since ${fmtDateTime(a.first_login_at)}` : `Invited ${fmtDateTime(a.invited_at)}`}>
                      {a.revoked_at ? <Badge variant="muted">Revoked</Badge> : a.first_login_at ? <Badge variant="success">Active</Badge> : <Badge variant="info">Invited</Badge>}
                    </div>
                    <Contact email={a.contact.email} phone={a.contact.phone} />
                    <div className="flex justify-end">
                      {manage ? (
                        <Button size="icon-sm" variant="ghost" onClick={() => setRevoked(a.id, !a.revoked_at)} aria-label={a.revoked_at ? `Restore access for ${a.contact.full_name}` : `Revoke access for ${a.contact.full_name}`}>
                          {a.revoked_at ? <UserPlus /> : <UserX />}
                        </Button>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {manage ? <Button onClick={() => setInviteOpen(true)}><Mail /> Invite client user</Button> : null}
        </CardContent>
      </Card>

      {manage ? (
        <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Invite client user</DialogTitle>
              <DialogDescription>New users receive an invitation email to set a password. Existing users get a sign-in link.</DialogDescription>
            </DialogHeader>
            <form onSubmit={invite} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="inv-contact">Contact</Label>
                <Select value={contactId} onValueChange={setContactId}>
                  <SelectTrigger id="inv-contact"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NEW}>+ New contact</SelectItem>
                    {contacts.filter((c) => !granted.has(c.id)).map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.full_name} ({c.email})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {contactId === NEW ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-2 sm:col-span-2">
                    <Label htmlFor="inv-name">Full name</Label>
                    <Input id="inv-name" required value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
                  </div>
                  <div className="space-y-2 sm:col-span-2">
                    <Label htmlFor="inv-email">Email</Label>
                    <Input id="inv-email" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="inv-pos">Position</Label>
                    <Input id="inv-pos" value={form.position} onChange={(e) => setForm({ ...form, position: e.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="inv-phone">Phone</Label>
                    <Input id="inv-phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
                  </div>
                </div>
              ) : null}
              <DialogFooter>
                <Button type="button" variant="ghost" onClick={() => setInviteOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={busy}><Mail /> Grant access & send email</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}
