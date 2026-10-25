// Tiny SMTP sink: accepts every message and writes it to $MAIL_DIR as
//   <epoch-ms>-<seq>.json  { from, to[], subject, date, html, text, raw }
//   <epoch-ms>-<seq>.eml   the raw message
// No TLS, no auth. Good enough for GoTrue's mailer; never expose it.
import net from "node:net";
import fs from "node:fs";
import path from "node:path";

const PORT = Number(process.env.SMTP_PORT ?? 54325);
const DIR = path.resolve(process.env.MAIL_DIR ?? "./mail");
fs.mkdirSync(DIR, { recursive: true });
let seq = 0;

function decodeQP(s) {
  const bytes = [];
  const src = s.replace(/=\r?\n/g, "");
  for (let i = 0; i < src.length; i++) {
    if (src[i] === "=" && /^[0-9A-Fa-f]{2}$/.test(src.slice(i + 1, i + 3))) {
      bytes.push(parseInt(src.slice(i + 1, i + 3), 16));
      i += 2;
    } else bytes.push(...Buffer.from(src[i], "utf8"));
  }
  return Buffer.from(bytes).toString("utf8");
}

function decodeWords(v) {
  // RFC 2047 encoded-words in headers, e.g. =?UTF-8?q?...?= or =?UTF-8?b?...?=
  return v.replace(/=\?([^?]+)\?([bBqQ])\?([^?]*)\?=/g, (_, _cs, enc, txt) =>
    enc.toUpperCase() === "B" ? Buffer.from(txt, "base64").toString("utf8") : decodeQP(txt.replace(/_/g, " ")),
  );
}

function parseHeaders(block) {
  const headers = {};
  for (const line of block.replace(/\r?\n[ \t]+/g, " ").split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i > 0) headers[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
  }
  return headers;
}

function splitMessage(raw) {
  const m = raw.match(/\r?\n\r?\n/);
  if (!m) return { headers: parseHeaders(raw), body: "" };
  return { headers: parseHeaders(raw.slice(0, m.index)), body: raw.slice(m.index + m[0].length) };
}

function decodeBody(body, headers) {
  const enc = (headers["content-transfer-encoding"] ?? "").toLowerCase();
  if (enc === "quoted-printable") return decodeQP(body);
  if (enc === "base64") return Buffer.from(body.replace(/\s+/g, ""), "base64").toString("utf8");
  return body;
}

/** Collects text/html and text/plain parts, walking nested multiparts. */
function collectParts(headers, body, out) {
  const ct = headers["content-type"] ?? "text/plain";
  const boundary = ct.match(/boundary="?([^";]+)"?/i)?.[1];
  if (/^multipart\//i.test(ct) && boundary) {
    for (const part of body.split(`--${boundary}`).slice(1)) {
      if (part.startsWith("--")) break;
      const p = splitMessage(part.replace(/^\r?\n/, ""));
      collectParts(p.headers, p.body, out);
    }
    return;
  }
  const text = decodeBody(body, headers);
  if (/text\/html/i.test(ct)) out.html = (out.html ?? "") + text;
  else out.text = (out.text ?? "") + text;
}

function save(envelope, raw) {
  const { headers, body } = splitMessage(raw);
  const parts = {};
  collectParts(headers, body, parts);
  const base = `${Date.now()}-${String(++seq).padStart(4, "0")}`;
  const msg = {
    from: envelope.from,
    to: envelope.to,
    subject: decodeWords(headers.subject ?? ""),
    date: new Date().toISOString(),
    html: parts.html ?? null,
    text: parts.text ?? null,
    headers,
  };
  fs.writeFileSync(path.join(DIR, `${base}.eml`), raw);
  // write-then-rename so readers never see a half-written JSON file
  fs.writeFileSync(path.join(DIR, `${base}.json.tmp`), JSON.stringify(msg, null, 2));
  fs.renameSync(path.join(DIR, `${base}.json.tmp`), path.join(DIR, `${base}.json`));
  console.log(`${msg.date} mail to=${msg.to.join(",")} subject=${JSON.stringify(msg.subject)} -> ${base}.json`);
}

const server = net.createServer((sock) => {
  let buf = "";
  let inData = false;
  let env = { from: "", to: [] };
  const reply = (s) => sock.write(s + "\r\n");
  reply("220 kp-e2e smtp sink ready");
  sock.on("data", (chunk) => {
    buf += chunk.toString("utf8");
    for (;;) {
      if (inData) {
        const end = buf.indexOf("\r\n.\r\n");
        const atStart = buf.startsWith(".\r\n");
        if (end < 0 && !atStart) return;
        const raw = atStart ? "" : buf.slice(0, end);
        buf = atStart ? buf.slice(3) : buf.slice(end + 5);
        inData = false;
        try {
          save(env, raw.replace(/\r\n\.\./g, "\r\n."));
          reply("250 OK: queued");
        } catch (e) {
          console.error(e);
          reply("451 local error");
        }
        env = { from: "", to: [] };
        continue;
      }
      const nl = buf.indexOf("\r\n");
      if (nl < 0) return;
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 2);
      const cmd = line.slice(0, 4).toUpperCase();
      if (cmd === "EHLO") sock.write("250-kp-e2e\r\n250-8BITMIME\r\n250-SIZE 52428800\r\n250 OK\r\n");
      else if (cmd === "HELO") reply("250 kp-e2e");
      else if (cmd === "MAIL") { env.from = (line.match(/<([^>]*)>/)?.[1] ?? "").toLowerCase(); reply("250 OK"); }
      else if (cmd === "RCPT") { env.to.push((line.match(/<([^>]*)>/)?.[1] ?? "").toLowerCase()); reply("250 OK"); }
      else if (cmd === "DATA") { inData = true; reply("354 End data with <CR><LF>.<CR><LF>"); }
      else if (cmd === "RSET") { env = { from: "", to: [] }; reply("250 OK"); }
      else if (cmd === "NOOP") reply("250 OK");
      else if (cmd === "AUTH") reply("235 Authentication succeeded");
      else if (cmd === "QUIT") { reply("221 Bye"); sock.end(); return; }
      else reply("250 OK");
    }
  });
  sock.on("error", () => {});
});

server.listen(PORT, "127.0.0.1", () => console.log(`smtp sink on 127.0.0.1:${PORT}, writing to ${DIR}`));
