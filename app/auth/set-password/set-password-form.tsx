"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";

function strength(p: string) {
  let s = 0;
  if (p.length >= 10) s++;
  if (/[A-Z]/.test(p) && /[a-z]/.test(p)) s++;
  if (/\d/.test(p)) s++;
  if (/[^A-Za-z0-9]/.test(p)) s++;
  return s;
}

export function SetPasswordForm({ home }: { home: string }) {
  const router = useRouter();
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const s = strength(pw);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pw.length < 10) return setError("Use at least 10 characters.");
    if (s < 3) return setError("Use a mix of upper and lower case letters, numbers and symbols.");
    if (pw !== pw2) return setError("The passwords don't match.");
    setBusy(true);
    const { error } = await createClient().auth.updateUser({ password: pw });
    setBusy(false);
    if (error) return setError(error.message);
    router.replace(home);
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {error ? <Alert variant="destructive">{error}</Alert> : null}
      <div className="space-y-2">
        <Label htmlFor="pw">New password</Label>
        <Input id="pw" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} required />
        <div className="flex gap-1" aria-hidden>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className={`h-1 flex-1 rounded-full ${i < s ? (s >= 3 ? "bg-success" : "bg-warning") : "bg-muted"}`} />
          ))}
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="pw2">Confirm password</Label>
        <Input id="pw2" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} required />
      </div>
      <Button className="w-full" disabled={busy}>Save password and continue</Button>
      <Button type="button" variant="ghost" className="w-full" onClick={() => router.replace(home)}>
        Skip for now
      </Button>
    </form>
  );
}
