// Netlify scheduled function: calls the portal's notification dispatcher
// every hour. Set CRON_SECRET in the site's environment variables (same value
// the Next.js app uses). Netlify sets URL to the site's primary URL; SITE_URL
// or NEXT_PUBLIC_SITE_URL override it.
// Scheduled functions run on published deploys only.

export default async function dispatch(): Promise<Response> {
  const base = (process.env.SITE_URL || process.env.NEXT_PUBLIC_SITE_URL || process.env.URL || "").replace(/\/$/, "");
  const secret = process.env.CRON_SECRET;
  if (!base || !secret) {
    console.error("[dispatch] SITE_URL/URL or CRON_SECRET is not set");
    return new Response("not configured", { status: 500 });
  }
  const res = await fetch(`${base}/api/cron/dispatch`, {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}` },
  });
  const body = await res.text();
  console.log(`[dispatch] ${res.status} ${body.slice(0, 2000)}`);
  return new Response(body, { status: res.ok ? 200 : 502 });
}

export const config = { schedule: "@hourly" };
