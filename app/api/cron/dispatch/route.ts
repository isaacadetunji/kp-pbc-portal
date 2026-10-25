import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { runDispatch } from "@/lib/email";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

function authorised(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const got = Buffer.from(request.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  return got.length === want.length && timingSafeEqual(got, want);
}

/**
 * Hourly notification dispatch: instant e-mails + reminder digests.
 * Called by netlify/functions/dispatch.mts or .github/workflows/dispatch.yml
 * with `Authorization: Bearer ${CRON_SECRET}`. Safe to call more often:
 * reminders are sent at most once per engagement, person and day.
 */
export async function POST(request: NextRequest) {
  if (!process.env.CRON_SECRET) return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 503 });
  if (!authorised(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const summary = await runDispatch();
    console.info("[cron:dispatch]", JSON.stringify(summary));
    return NextResponse.json({ ok: summary.errors.length === 0, ...summary });
  } catch (e) {
    console.error("[cron:dispatch] failed", e);
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
