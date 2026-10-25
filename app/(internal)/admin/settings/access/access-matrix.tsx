"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Info, Loader2 } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { saveRolePermissions } from "@/lib/actions/settings-access";
import { fmtDateTime } from "@/lib/dates";
import { APP_PERMISSIONS, DEFAULT_ROLE_PERMISSIONS, type AppPermission, type RolePermissions } from "@/lib/permissions";

const ROLES = [
  { key: "admin", label: "Admin" },
  { key: "staff", label: "Staff" },
] as const;

export function AccessMatrix({ initial, updatedAt }: { initial: RolePermissions; updatedAt: string | null }) {
  const router = useRouter();
  const [matrix, setMatrix] = useState<RolePermissions>(initial);
  const [saved, setSaved] = useState<RolePermissions>(initial);
  const [busy, setBusy] = useState(false);
  const dirty = JSON.stringify(matrix) !== JSON.stringify(saved);

  const set = (role: "admin" | "staff", perm: AppPermission, on: boolean) =>
    setMatrix((m) => ({ ...m, [role]: { ...m[role], [perm]: on } }));

  async function save() {
    setBusy(true);
    const res = await saveRolePermissions(matrix);
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    setSaved(res.data);
    setMatrix(res.data);
    toast.success("Access saved. It applies straight away, including to people who are signed in.");
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">Permissions by role</caption>
              <thead>
                <tr className="border-b bg-muted/40 text-left text-xs font-semibold text-muted-foreground">
                  <th scope="col" className="px-4 py-3">Permission</th>
                  <th scope="col" className="w-28 px-3 py-3 text-center">Super admin</th>
                  {ROLES.map((r) => <th key={r.key} scope="col" className="w-24 px-3 py-3 text-center">{r.label}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y">
                {APP_PERMISSIONS.map((p) => (
                  <tr key={p.key}>
                    <th scope="row" className="px-4 py-3 text-left align-top font-normal">
                      <span className="block font-medium">{p.label}</span>
                      <span className="block text-xs text-muted-foreground">{p.description}</span>
                    </th>
                    <td className="px-3 py-3 text-center align-middle">
                      <span className="inline-flex items-center gap-1 text-xs text-success" title="Super admins always have every permission">
                        <Check className="size-4" aria-hidden /> <span className="sr-only">Always on</span><span aria-hidden>Always</span>
                      </span>
                    </td>
                    {ROLES.map((r) => (
                      <td key={r.key} className="px-3 py-3 text-center align-middle">
                        <Switch
                          checked={matrix[r.key][p.key]}
                          onCheckedChange={(v) => set(r.key, p.key, v)}
                          aria-label={`${r.label}: ${p.label}`}
                          disabled={busy}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
                <tr>
                  <th scope="row" className="px-4 py-3 text-left align-top font-normal">
                    <span className="block font-medium">Settings</span>
                    <span className="block text-xs text-muted-foreground">Branding, access, stages, engagement types, checklist and notification settings.</span>
                  </th>
                  <td className="px-3 py-3 text-center text-xs text-success">Always</td>
                  <td className="px-3 py-3 text-center text-xs text-muted-foreground" colSpan={2}>Super admin only</td>
                </tr>
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
      <Alert variant="info">
        <Info />
        <div className="text-sm">
          Engagement work does not depend on these switches: people on an engagement team act according to their team role (partner, team lead, manager or member).
        </div>
      </Alert>
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={save} disabled={!dirty || busy}>{busy ? <Loader2 className="animate-spin" /> : null} Save access</Button>
        <Button variant="ghost" onClick={() => setMatrix(DEFAULT_ROLE_PERMISSIONS)} disabled={busy}>Restore defaults</Button>
        {dirty ? <span className="text-xs text-warning">Unsaved changes</span> : updatedAt ? <span className="text-xs text-muted-foreground">Last changed {fmtDateTime(updatedAt)}</span> : null}
      </div>
    </div>
  );
}
