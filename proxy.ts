import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Runs before every page request:
 *  1. refreshes the Supabase session cookie
 *  2. enforces the idle session timeout (SESSION_IDLE_MINUTES)
 *  3. sends signed-out users to /login
 * Role-based routing (staff vs client) happens in the route-group layouts.
 */
const PUBLIC_PATHS = ["/login", "/auth", "/forgot-password"];
const ACTIVITY_COOKIE = "kp_last_activity";

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );

  // Do not add code between createServerClient and getClaims(): it refreshes the session.
  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims?.sub);
  const path = request.nextUrl.pathname;
  const isPublic = PUBLIC_PATHS.some((p) => path === p || path.startsWith(`${p}/`));

  if (signedIn) {
    const idleMinutes = Number(process.env.SESSION_IDLE_MINUTES ?? 30);
    const last = Number(request.cookies.get(ACTIVITY_COOKIE)?.value ?? 0);
    const now = Date.now();
    if (idleMinutes > 0 && last > 0 && now - last > idleMinutes * 60_000 && !isPublic) {
      await supabase.auth.signOut();
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      url.search = "?reason=timeout";
      const redirect = NextResponse.redirect(url);
      response.cookies.getAll().forEach((c) => redirect.cookies.set(c));
      redirect.cookies.delete(ACTIVITY_COOKIE);
      return redirect;
    }
    // Only page navigations count as activity (not prefetches or API polling)
    if (request.headers.get("next-router-prefetch") === null && !path.startsWith("/api/")) {
      response.cookies.set(ACTIVITY_COOKIE, String(now), {
        httpOnly: true,
        sameSite: "lax",
        secure: request.nextUrl.protocol === "https:",
        path: "/",
      });
    }
  }

  if (!signedIn && !isPublic) {
    if (path.startsWith("/api/")) {
      return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    }
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = path && path !== "/" ? `?next=${encodeURIComponent(path + request.nextUrl.search)}` : "";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
