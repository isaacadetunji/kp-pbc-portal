import "server-only";
import net from "node:net";

/**
 * E-mail provider abstraction.
 *
 *   EMAIL_PROVIDER=resend  Resend REST API (RESEND_API_KEY, EMAIL_FROM)
 *   EMAIL_PROVIDER=log     Development / tests: writes each message to the
 *                          server log. If SMTP_URL is set (e.g.
 *                          smtp://localhost:54325 for the Supabase Inbucket /
 *                          Mailpit sink) it is also delivered there over plain SMTP.
 *
 * When EMAIL_PROVIDER is unset (or the legacy value "supabase"), Resend is used
 * if RESEND_API_KEY is present, otherwise "log".
 */
export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Optional idempotency / tracing key (sent as a header where supported). */
  key?: string;
}

export interface EmailProvider {
  name: "resend" | "log";
  send(msg: EmailMessage): Promise<{ id: string | null }>;
}

export function emailConfig() {
  const raw = (process.env.EMAIL_PROVIDER ?? "").trim().toLowerCase();
  const resendKey = process.env.RESEND_API_KEY ?? "";
  const provider: "resend" | "log" = raw === "resend" ? "resend" : raw === "log" ? "log" : resendKey ? "resend" : "log";
  return {
    provider,
    from: process.env.EMAIL_FROM || "Kreston Pedabo PBC Portal <pbc@example.com>",
    replyTo: process.env.EMAIL_REPLY_TO || null,
    resendKey,
    smtpUrl: process.env.SMTP_URL || null,
    cronConfigured: Boolean(process.env.CRON_SECRET),
  };
}

export function getEmailProvider(): EmailProvider {
  const cfg = emailConfig();
  if (cfg.provider === "resend") return resendProvider(cfg.resendKey, cfg.from, cfg.replyTo);
  return logProvider(cfg.from, cfg.smtpUrl);
}

function resendProvider(apiKey: string, from: string, replyTo: string | null): EmailProvider {
  return {
    name: "resend",
    async send(msg) {
      if (!apiKey) throw new Error("RESEND_API_KEY is not configured");
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          ...(msg.key ? { "Idempotency-Key": msg.key.slice(0, 256) } : {}),
        },
        body: JSON.stringify({
          from,
          to: [msg.to],
          subject: msg.subject,
          html: msg.html,
          text: msg.text,
          ...(replyTo ? { reply_to: replyTo } : {}),
        }),
        signal: AbortSignal.timeout(15_000),
      });
      const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string; name?: string };
      if (!res.ok) throw new Error(`Resend ${res.status}: ${body.message ?? body.name ?? res.statusText}`);
      return { id: body.id ?? null };
    },
  };
}

function logProvider(from: string, smtpUrl: string | null): EmailProvider {
  return {
    name: "log",
    async send(msg) {
      console.info(
        `[email:log] to=${msg.to} subject=${JSON.stringify(msg.subject)}\n${msg.text.split("\n").map((l) => `  ${l}`).join("\n")}`,
      );
      if (smtpUrl) await sendSmtp(smtpUrl, from, msg);
      return { id: null };
    },
  };
}

// ---------------------------------------------------------------------------
// Minimal plain-SMTP client for local mail sinks (no auth, no TLS)
// ---------------------------------------------------------------------------
function addressOf(from: string): string {
  const m = /<([^>]+)>/.exec(from);
  return (m ? m[1]! : from).trim();
}

function encodeHeader(v: string): string {
  // RFC 2047 for non-ASCII subjects/names
  return /^[\x20-\x7e]*$/.test(v) ? v : `=?UTF-8?B?${Buffer.from(v, "utf8").toString("base64")}?=`;
}

function b64Lines(s: string): string {
  return Buffer.from(s, "utf8").toString("base64").replace(/.{1,76}/g, "$&\r\n");
}

export function buildMime(from: string, msg: EmailMessage): string {
  const boundary = `kp_${Math.random().toString(36).slice(2)}`;
  return [
    `From: ${from}`,
    `To: ${msg.to}`,
    `Subject: ${encodeHeader(msg.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    b64Lines(msg.text),
    `--${boundary}`,
    "Content-Type: text/html; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    b64Lines(msg.html),
    `--${boundary}--`,
    "",
  ].join("\r\n");
}

async function sendSmtp(url: string, from: string, msg: EmailMessage): Promise<void> {
  const u = new URL(url);
  const socket = net.connect({ host: u.hostname, port: Number(u.port || 25) });
  socket.setTimeout(10_000);
  let buffer = "";
  const waiters: ((line: string) => void)[] = [];
  socket.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    // A complete reply ends with a line "NNN text" (no dash after the code)
    for (;;) {
      const lines = buffer.split("\r\n");
      const end = lines.findIndex((l, i) => i < lines.length - 1 && /^\d{3}( |$)/.test(l));
      if (end < 0) return;
      buffer = lines.slice(end + 1).join("\r\n");
      waiters.shift()?.(lines.slice(0, end + 1).join("\n"));
    }
  });
  const closed = new Promise<never>((_, reject) => {
    socket.on("error", reject);
    socket.on("timeout", () => reject(new Error("SMTP timeout")));
  });
  const expect = async (codes: string[], cmd?: string) => {
    const reply = new Promise<string>((resolve) => waiters.push(resolve));
    if (cmd !== undefined) socket.write(`${cmd}\r\n`);
    const r = await Promise.race([reply, closed]);
    if (!codes.some((c) => r.startsWith(c))) throw new Error(`SMTP: ${r.split("\n").pop()}`);
  };
  try {
    await expect(["220"]);
    await expect(["250"], `EHLO ${u.hostname === "localhost" ? "localhost" : "kp-pbc-portal"}`);
    await expect(["250"], `MAIL FROM:<${addressOf(from)}>`);
    await expect(["250", "251"], `RCPT TO:<${msg.to}>`);
    await expect(["354"], "DATA");
    const body = buildMime(from, msg).replace(/\r\n\./g, "\r\n..");
    await expect(["250"], `${body}\r\n.`);
    socket.write("QUIT\r\n");
  } finally {
    socket.end();
  }
}
