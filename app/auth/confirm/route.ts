import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Handles links in auth emails (invite, magic link, recovery, email change).
 * Supabase email templates should point to:
 *   {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=<type>&next=...
 * PKCE `code` links are handled too.
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const code = url.searchParams.get("code");
  const nextParam = url.searchParams.get("next") ?? "/";
  const next = nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : "/";

  // No token in the query: the session is in the URL fragment (default Supabase
  // email templates / admin-sent links), which only the browser can read.
  // Browsers keep the fragment across this redirect.
  if (!tokenHash && !code) {
    const dest = new URL("/auth/complete", url.origin);
    dest.searchParams.set("next", next);
    for (const k of ["error", "error_code", "error_description"]) {
      const v = url.searchParams.get(k);
      if (v) dest.searchParams.set(k, v);
    }
    return NextResponse.redirect(dest);
  }

  const supabase = await createClient();
  let ok = false;
  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    ok = !error;
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    ok = !error;
  }
  const dest = new URL(ok ? (type === "invite" || type === "recovery" ? "/auth/set-password" : next) : "/login?reason=link", url.origin);
  return NextResponse.redirect(dest);
}
