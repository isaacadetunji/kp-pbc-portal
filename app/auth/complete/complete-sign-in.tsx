"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { createClient } from "@/lib/supabase/client";

/**
 * Finishes sign-in for links that carry the session in the URL fragment
 * (#access_token=…&refresh_token=…&type=invite). This is what Supabase's
 * default email templates produce for invitations and admin-sent links,
 * so the portal works whether or not the custom templates are installed.
 */
export function CompleteSignIn({ next }: { next: string }) {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const query = new URLSearchParams(window.location.search);
    const accessToken = hash.get("access_token");
    const refreshToken = hash.get("refresh_token");
    const type = hash.get("type") ?? query.get("type");
    const linkError = hash.get("error_description") ?? query.get("error_description");

    if (linkError) {
      setError(/expired|invalid/i.test(linkError) ? "This link has expired or has already been used. Ask for a new one, or sign in below." : linkError.replace(/\+/g, " "));
      return;
    }
    if (!accessToken || !refreshToken) {
      window.location.replace("/login?reason=link");
      return;
    }
    createClient()
      .auth.setSession({ access_token: accessToken, refresh_token: refreshToken })
      .then(({ error: err }: { error: unknown }) => {
        if (err) {
          setError("We couldn't sign you in with this link. It may have expired. Ask for a new one, or sign in below.");
          return;
        }
        // Clear the tokens from the address bar before moving on
        window.history.replaceState(null, "", window.location.pathname);
        const dest = type === "invite" || type === "recovery" || type === "signup" ? "/auth/set-password" : next;
        window.location.replace(dest);
      });
  }, [next]);

  if (error) {
    return (
      <div className="space-y-4">
        <Alert variant="destructive">{error}</Alert>
        <Link href="/login" className="text-sm font-medium text-primary underline-offset-4 hover:underline">Go to sign in</Link>
      </div>
    );
  }
  return (
    <p className="flex items-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" aria-hidden /> Signing you in…
    </p>
  );
}
