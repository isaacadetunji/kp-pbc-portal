/**
 * Reads the SMTP sink's mailbox ($MAIL_DIR, one JSON file per message, written by
 * services/smtp-sink.mjs) and extracts links from emails.
 */
import fs from "node:fs";
import path from "node:path";
import { mailDir } from "./env.mts";

export interface Mail {
  file: string;
  from: string;
  to: string[];
  subject: string;
  date: string;
  html: string | null;
  text: string | null;
}

export function allMail(): Mail[] {
  if (!fs.existsSync(mailDir)) return [];
  return fs
    .readdirSync(mailDir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => ({ file: f, ...(JSON.parse(fs.readFileSync(path.join(mailDir, f), "utf8")) as Omit<Mail, "file">) }));
}

/**
 * Waits for (and returns) the newest email to `address` received at or after `since`
 * (and matching `subject`, if given).
 */
export async function latestEmail(
  address: string,
  opts: { since?: Date; subject?: string | RegExp; timeoutMs?: number } = {},
): Promise<Mail> {
  const deadline = Date.now() + (opts.timeoutMs ?? 20_000);
  const want = address.toLowerCase();
  const since = opts.since ? opts.since.getTime() - 1000 : 0; // tolerate clock granularity
  for (;;) {
    const hits = allMail().filter(
      (m) =>
        m.to.some((t) => t.toLowerCase() === want) &&
        new Date(m.date).getTime() >= since &&
        (!opts.subject || (typeof opts.subject === "string" ? m.subject.includes(opts.subject) : opts.subject.test(m.subject))),
    );
    if (hits.length) return hits[hits.length - 1]!;
    if (Date.now() > deadline) {
      const seen = allMail().slice(-5).map((m) => `${m.date} ${m.to.join(",")} "${m.subject}"`).join("\n  ");
      throw new Error(`No email to ${address}${opts.subject ? ` with subject ${opts.subject}` : ""} in ${mailDir}. Last messages:\n  ${seen || "(none)"}`);
    }
    await new Promise((r) => setTimeout(r, 250));
  }
}

const decodeEntities = (s: string) =>
  s.replace(/&amp;/g, "&").replace(/&#43;/g, "+").replace(/&#61;/g, "=").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">");

/** All href targets in the email (HTML first, then bare URLs in the text part). */
export function linksIn(mail: Mail): string[] {
  const out: string[] = [];
  for (const m of (mail.html ?? "").matchAll(/href\s*=\s*"([^"]+)"/gi)) out.push(decodeEntities(m[1]!));
  for (const m of (mail.text ?? "").matchAll(/https?:\/\/[^\s<>"')]+/g)) out.push(decodeEntities(m[0]));
  return out;
}

/** The first link matching `pattern` (default: the app's /auth/confirm or GoTrue's /verify link). */
export function extractLink(mail: Mail, pattern: RegExp = /\/auth\/confirm\?|\/auth\/v1\/verify\?/): string {
  const link = linksIn(mail).find((l) => pattern.test(l));
  if (!link) throw new Error(`No link matching ${pattern} in "${mail.subject}" (${mail.file}): ${linksIn(mail).join(" | ")}`);
  return link;
}
