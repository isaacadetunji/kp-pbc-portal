"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { createClient } from "@/lib/supabase/client";
import type { BrandSettings } from "@/lib/settings";
import { friendlyError } from "@/lib/utils";

export function SettingsForm({
  brand, uploads, mfaForStaff, integrations,
}: {
  brand: BrandSettings;
  uploads: { maxFileMb: number; allowedExtensions: string[] };
  mfaForStaff: boolean;
  integrations: { storage: string; clientDirectory: string; email: string; sessionIdleMinutes: number };
}) {
  const router = useRouter();
  const supabase = createClient();
  const [b, setB] = useState(brand);
  const [maxMb, setMaxMb] = useState(String(uploads.maxFileMb));
  const [exts, setExts] = useState(uploads.allowedExtensions.join(", "));
  const [mfa, setMfa] = useState(mfaForStaff);
  const [busy, setBusy] = useState(false);

  async function upsert(key: string, value: unknown) {
    const { error } = await supabase.from("app_settings").upsert({ key, value, updated_at: new Date().toISOString() });
    if (error) throw error;
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const hex = /^#[0-9a-fA-F]{6}$/;
    if (!hex.test(b.primary) || !hex.test(b.accent)) return toast.error("Colours must be 6-digit hex codes, e.g. #0F77AD");
    const list = exts.split(/[,;\s]+/).map((x) => x.replace(/^\./, "").toLowerCase()).filter(Boolean);
    if (list.some((x) => ["exe", "bat", "cmd", "js", "msi", "sh", "ps1", "vbs", "html", "htm", "svg"].includes(x))) {
      return toast.error("Executable, script and web file types can't be allowed.");
    }
    setBusy(true);
    try {
      await upsert("brand", b);
      await upsert("uploads.max_file_mb", Math.max(1, Math.min(2048, Number(maxMb) || 100)));
      await upsert("uploads.allowed_extensions", list);
      await upsert("security.mfa_required_for_staff", mfa);
      toast.success("Settings saved");
      router.refresh();
    } catch (err) {
      toast.error(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="grid gap-6 xl:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Branding</CardTitle>
          <CardDescription>Applied across the portal, including the client sign-in page.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="s-firm">Firm name</Label>
            <Input id="s-firm" value={b.firm_name} onChange={(e) => setB({ ...b, firm_name: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="s-portal">Portal name</Label>
            <Input id="s-portal" value={b.portal_name} onChange={(e) => setB({ ...b, portal_name: e.target.value })} />
          </div>
          {(["primary", "accent"] as const).map((k) => (
            <div key={k} className="space-y-1.5">
              <Label htmlFor={`s-${k}`} className="capitalize">{k} colour</Label>
              <div className="flex gap-2">
                <input type="color" aria-label={`${k} colour picker`} value={b[k]} onChange={(e) => setB({ ...b, [k]: e.target.value })} className="h-9 w-12 cursor-pointer rounded-md border bg-card" />
                <Input id={`s-${k}`} value={b[k]} onChange={(e) => setB({ ...b, [k]: e.target.value })} className="font-mono" />
              </div>
            </div>
          ))}
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="s-logo">Logo URL</Label>
            <Input id="s-logo" value={b.logo_url ?? ""} onChange={(e) => setB({ ...b, logo_url: e.target.value || null })} placeholder="/kreston-pedabo-logo.png" />
            <p className="text-xs text-muted-foreground">A path in the app (e.g. /kreston-pedabo-logo.png) or an https:// image URL. Transparent PNG or SVG works best.</p>
          </div>
          <div className="flex items-center gap-3 sm:col-span-2">
            <span className="rounded-md px-3 py-1.5 text-sm text-white" style={{ background: b.primary }}>Primary</span>
            <span className="rounded-md px-3 py-1.5 text-sm text-white" style={{ background: b.accent }}>Accent</span>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Uploads & security</CardTitle>
          <CardDescription>Validated in the database on every upload.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="s-max">Maximum file size (MB)</Label>
            <Input id="s-max" type="number" min={1} max={2048} value={maxMb} onChange={(e) => setMaxMb(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="s-ext">Allowed file types</Label>
            <Input id="s-ext" value={exts} onChange={(e) => setExts(e.target.value)} />
          </div>
          <label className="flex items-center justify-between gap-3 rounded-lg border p-3">
            <span>
              <span className="block text-sm font-medium">Require MFA for all firm users</span>
              <span className="block text-xs text-muted-foreground">Users without an authenticator are asked to set one up at next sign-in.</span>
            </span>
            <Switch checked={mfa} onCheckedChange={setMfa} />
          </label>
          <p className="text-xs text-muted-foreground">Idle session timeout: {integrations.sessionIdleMinutes} minutes (SESSION_IDLE_MINUTES).</p>
        </CardContent>
      </Card>
      <Card className="xl:col-span-2">
        <CardHeader>
          <CardTitle>Integrations</CardTitle>
          <CardDescription>Configured through environment variables. See README.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border p-3">
            <div className="text-xs text-muted-foreground">Document storage</div>
            <div className="mt-1 flex items-center gap-2 font-medium">
              {integrations.storage === "sharepoint" ? "SharePoint (Microsoft Graph)" : "Supabase Storage"}
              <Badge variant={integrations.storage === "sharepoint" ? "success" : "warning"}>{integrations.storage === "sharepoint" ? "Live" : "Phase 1"}</Badge>
            </div>
          </div>
          <div className="rounded-lg border p-3">
            <div className="text-xs text-muted-foreground">Client database</div>
            <div className="mt-1 flex items-center gap-2 font-medium">
              {integrations.clientDirectory === "rest" ? "REST API" : "Mock adapter"}
              <Badge variant={integrations.clientDirectory === "rest" ? "success" : "warning"}>{integrations.clientDirectory}</Badge>
            </div>
          </div>
          <div className="rounded-lg border p-3">
            <div className="text-xs text-muted-foreground">Email</div>
            <div className="mt-1 font-medium capitalize">{integrations.email === "supabase" ? "Supabase Auth emails" : integrations.email}</div>
          </div>
        </CardContent>
      </Card>
      <div className="xl:col-span-2">
        <Button type="submit" disabled={busy}>Save settings</Button>
      </div>
    </form>
  );
}
