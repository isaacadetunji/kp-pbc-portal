"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Mail } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { createClient } from "@/lib/supabase/client";

export function LoginForm({ next, notice }: { next: string; notice?: string }) {
  const router = useRouter();
  const supabase = createClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  // A sign-in link that fell back to the site root lands here with the session in the fragment
  useEffect(() => {
    if (/(^|[#&])(access_token|error_description)=/.test(window.location.hash)) {
      window.location.replace(`/auth/complete?next=${encodeURIComponent(next)}${window.location.hash}`);
    }
  }, [next]);

  async function signInWithPassword(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) {
      setError(error.message === "Invalid login credentials" ? "Email or password is incorrect." : error.message);
      return;
    }
    router.replace(next);
    router.refresh();
  }

  async function sendMagicLink(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { shouldCreateUser: false, emailRedirectTo: `${window.location.origin}/auth/confirm?next=${encodeURIComponent(next)}` },
    });
    setBusy(false);
    // Don't reveal whether the address exists
    if (error && !/signups not allowed|not found/i.test(error.message)) setError(error.message);
    else setSent(true);
  }

  return (
    <div className="space-y-4">
      {notice ? <Alert variant="info">{notice}</Alert> : null}
      {error ? <Alert variant="destructive">{error}</Alert> : null}
      <Tabs defaultValue="password" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="password">Password</TabsTrigger>
          <TabsTrigger value="magic">Email me a link</TabsTrigger>
        </TabsList>
        <TabsContent value="password" className="pt-4">
          <form onSubmit={signInWithPassword} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">Password</Label>
                <Link href="/forgot-password" className="text-xs text-primary hover:underline">
                  Forgot password?
                </Link>
              </div>
              <Input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? <Loader2 className="animate-spin" /> : null} Sign in
            </Button>
          </form>
        </TabsContent>
        <TabsContent value="magic" className="pt-4">
          {sent ? (
            <Alert variant="success">
              <Mail />
              <div>If an account exists for {email}, a sign-in link is on its way. It expires in 1 hour.</div>
            </Alert>
          ) : (
            <form onSubmit={sendMagicLink} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email-link">Email</Label>
                <Input id="email-link" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <Button type="submit" className="w-full" disabled={busy}>
                {busy ? <Loader2 className="animate-spin" /> : <Mail />} Send sign-in link
              </Button>
            </form>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
