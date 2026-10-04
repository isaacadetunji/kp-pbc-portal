"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { KeyRound, ShieldCheck, Smartphone } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import type { Profile } from "@/lib/types";
import { friendlyError } from "@/lib/utils";

type Factor = { id: string; friendly_name?: string; status: string; created_at: string };

export function AccountSettings({ profile }: { profile: Profile }) {
  const router = useRouter();
  const supabase = createClient();
  const [fullName, setFullName] = useState(profile.full_name);
  const [phone, setPhone] = useState(profile.phone ?? "");
  const [jobTitle, setJobTitle] = useState(profile.job_title ?? "");
  const [factors, setFactors] = useState<Factor[]>([]);

  async function loadFactors() {
    const { data } = await supabase.auth.mfa.listFactors();
    setFactors(((data?.totp ?? []) as Factor[]).filter((f) => f.status === "verified"));
  }
  useEffect(() => {
    loadFactors();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const { error } = await supabase
      .from("profiles")
      .update({ full_name: fullName.trim(), phone: phone.trim() || null, job_title: jobTitle.trim() || null })
      .eq("id", profile.id);
    if (error) return toast.error(friendlyError(error));
    toast.success("Profile saved");
    router.refresh();
  }

  async function remove(id: string) {
    if (profile.mfa_required && factors.length <= 1) {
      return toast.error("Two-step verification is required for your account and can't be removed.");
    }
    if (!confirm("Remove this authenticator? You'll sign in with your password only.")) return;
    const { error } = await supabase.auth.mfa.unenroll({ factorId: id });
    if (error) return toast.error(error.message);
    toast.success("Authenticator removed");
    loadFactors();
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <CardDescription>{profile.email}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={save} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="acc-name">Full name</Label>
              <Input id="acc-name" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="acc-title">Job title</Label>
              <Input id="acc-title" value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="acc-phone">Phone</Label>
              <Input id="acc-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            <Button type="submit">Save profile</Button>
          </form>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><ShieldCheck className="size-4" /> Security</CardTitle>
          <CardDescription>Protect your account with an authenticator app.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Two-step verification</span>
            {factors.length ? <Badge variant="success">On</Badge> : <Badge variant="muted">Off</Badge>}
          </div>
          {factors.map((f) => (
            <div key={f.id} className="flex items-center gap-3 rounded-lg border p-3">
              <Smartphone className="size-4 text-muted-foreground" />
              <span className="flex-1 text-sm">{f.friendly_name ?? "Authenticator app"}</span>
              <Button size="sm" variant="ghost" className="text-destructive" onClick={() => remove(f.id)}>Remove</Button>
            </div>
          ))}
          {factors.length === 0 ? (
            <Button asChild variant="outline"><Link href="/mfa?enroll=1"><Smartphone /> Set up authenticator app</Link></Button>
          ) : null}
          <div className="border-t pt-4">
            <Button asChild variant="outline"><Link href="/auth/set-password"><KeyRound /> Change password</Link></Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
