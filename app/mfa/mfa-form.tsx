"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import { signOut } from "@/lib/actions/auth";

export function MfaForm({ mode, home }: { mode: "enroll" | "challenge"; home: string }) {
  const router = useRouter();
  const supabase = createClient();
  const [factorId, setFactorId] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.mfa.listFactors();
      const verified = data?.totp.find((f: { status: string }) => f.status === "verified");
      if (verified) {
        setFactorId(verified.id);
        return;
      }
      if (mode === "enroll" || !verified) {
        // clear abandoned enrolments, then start a fresh one
        for (const f of data?.all ?? []) if (f.status !== "verified") await supabase.auth.mfa.unenroll({ factorId: f.id });
        const { data: en, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: `Authenticator ${new Date().toISOString().slice(0, 10)}` });
        if (error) return setError(error.message);
        setFactorId(en.id);
        setQr(en.totp.qr_code);
        setSecret(en.totp.secret);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    if (!factorId) return;
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: code.replace(/\s/g, "") });
    setBusy(false);
    if (error) return setError("That code didn't work. Check the time on your phone and try again.");
    router.replace(home);
    router.refresh();
  }

  return (
    <form onSubmit={verify} className="space-y-4">
      {error ? <Alert variant="destructive">{error}</Alert> : null}
      {qr ? (
        <div className="space-y-3 rounded-lg border bg-card p-4">
          <p className="text-sm">Scan this QR code with Microsoft Authenticator, Google Authenticator or a similar app.</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qr} alt="Authenticator QR code" className="mx-auto size-44" />
          {secret ? <p className="text-center font-mono text-xs break-all text-muted-foreground">{secret}</p> : null}
        </div>
      ) : null}
      <div className="space-y-2">
        <Label htmlFor="code">6-digit code</Label>
        <Input id="code" inputMode="numeric" autoComplete="one-time-code" maxLength={7} value={code} onChange={(e) => setCode(e.target.value)} required autoFocus />
      </div>
      <Button className="w-full" disabled={busy || !factorId}>Verify</Button>
      <Button type="button" variant="ghost" className="w-full" onClick={() => signOut()}>
        Sign out
      </Button>
    </form>
  );
}
