// File-system backed mock of the parts of the Supabase Storage API the app uses
// (see lib/storage/supabase-provider.ts, components/items/file-uploader.tsx and
// scripts/seed-demo.mts):
//
//   POST   /object/upload/sign/{bucket}/{path}           createSignedUploadUrl   (service role)
//   PUT    /object/upload/sign/{bucket}/{path}?token=…   uploadToSignedUrl       (token)
//   POST   /object/{bucket}/{path}                       upload                  (service role)
//   PUT    /object/{bucket}/{path}                       update                  (service role)
//   POST   /object/sign/{bucket}/{path}                  createSignedUrl         (service role)
//   GET    /object/sign/{bucket}/{path}?token=…          signed download         (token)
//   GET    /object/authenticated/{bucket}/{path}         download                (service role)
//   POST   /object/list/{bucket}                         list                    (service role)
//   DELETE /object/{bucket}                              remove {prefixes}       (service role)
//
// Objects live in $STORAGE_DIR/{bucket}/{path}; metadata in $STORAGE_DIR/.meta/{bucket}/{path}.json.
// Tokens are HMAC-signed with JWT_SECRET, so restarts do not invalidate them.
import http from "node:http";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const PORT = Number(process.env.STORAGE_PORT ?? 54333);
const ROOT = path.resolve(process.env.STORAGE_DIR ?? "./storage-data");
const SECRET = process.env.JWT_SECRET ?? "";
if (!SECRET) throw new Error("JWT_SECRET is required");
const UPLOAD_TTL = 2 * 60 * 60; // signed upload URLs are valid for 2h, like Supabase

const b64url = (b) => Buffer.from(b).toString("base64url");
const hmac = (s) => crypto.createHmac("sha256", SECRET).update(s).digest("base64url");

function signToken(payload) {
  const body = b64url(JSON.stringify(payload));
  return `${body}.${hmac(body)}`;
}
function readToken(token) {
  const [body, sig] = String(token ?? "").split(".");
  if (!body || !sig || hmac(body) !== sig) return null;
  const p = JSON.parse(Buffer.from(body, "base64url").toString());
  if (p.exp && p.exp < Date.now() / 1000) return null;
  return p;
}

/** Decodes and verifies a Supabase HS256 JWT from the Authorization header; returns its claims. */
function bearerClaims(req) {
  const h = req.headers.authorization ?? "";
  const jwt = h.startsWith("Bearer ") ? h.slice(7) : (req.headers.apikey ?? "");
  const [head, payload, sig] = String(jwt).split(".");
  if (!head || !payload || !sig) return null;
  const expect = crypto.createHmac("sha256", SECRET).update(`${head}.${payload}`).digest("base64url");
  if (expect !== sig) return null;
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
  if (claims.exp && claims.exp < Date.now() / 1000) return null;
  return claims;
}

function send(res, status, body, headers = {}) {
  const json = typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(json);
}
const fail = (res, status, error, message) => send(res, status, { statusCode: String(status), error, message });

function safeJoin(base, rel) {
  const p = path.resolve(base, rel);
  if (p !== base && !p.startsWith(base + path.sep)) throw new Error("path escapes bucket");
  return p;
}
const objectFile = (bucket, key) => safeJoin(ROOT, path.join(bucket, key));
const metaFile = (bucket, key) => safeJoin(path.join(ROOT, ".meta"), path.join(bucket, key + ".json"));

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks);
}

/** Extracts the file bytes and content type from a multipart or raw upload body. */
async function fileFromRequest(req, raw) {
  const ct = req.headers["content-type"] ?? "application/octet-stream";
  if (ct.startsWith("multipart/form-data")) {
    const form = await new Request("http://local/", { method: "POST", headers: { "content-type": ct }, body: raw }).formData();
    for (const [, v] of form.entries()) {
      if (typeof v !== "string") return { bytes: Buffer.from(await v.arrayBuffer()), contentType: v.type || "application/octet-stream" };
    }
    throw new Error("multipart body has no file part");
  }
  return { bytes: raw, contentType: ct };
}

async function store(res, req, bucket, key, upsert) {
  const raw = await readBody(req);
  const file = objectFile(bucket, key);
  if (!upsert && fs.existsSync(file)) return fail(res, 400, "Duplicate", "The resource already exists");
  const { bytes, contentType } = await fileFromRequest(req, raw);
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, bytes);
  const now = new Date().toISOString();
  const meta = {
    id: crypto.randomUUID(),
    created_at: now,
    updated_at: now,
    metadata: { size: bytes.length, mimetype: contentType, eTag: `"${crypto.createHash("md5").update(bytes).digest("hex")}"`, cacheControl: "max-age=3600", lastModified: now, contentLength: bytes.length, httpStatusCode: 200 },
  };
  await fsp.mkdir(path.dirname(metaFile(bucket, key)), { recursive: true });
  await fsp.writeFile(metaFile(bucket, key), JSON.stringify(meta));
  send(res, 200, { Key: `${bucket}/${key}`, Id: meta.id });
}

async function readMeta(bucket, key) {
  try {
    return JSON.parse(await fsp.readFile(metaFile(bucket, key), "utf8"));
  } catch {
    return null;
  }
}

async function download(res, bucket, key) {
  const file = objectFile(bucket, key);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return fail(res, 404, "not_found", "Object not found");
  const meta = await readMeta(bucket, key);
  res.writeHead(200, {
    "content-type": meta?.metadata?.mimetype ?? "application/octet-stream",
    "content-length": String(fs.statSync(file).size),
    "cache-control": "no-store",
  });
  fs.createReadStream(file).pipe(res);
}

async function list(res, bucket, body) {
  const prefix = String(body.prefix ?? "").replace(/^\/+|\/+$/g, "");
  const dir = objectFile(bucket, prefix || ".");
  const limit = Number(body.limit ?? 100);
  const offset = Number(body.offset ?? 0);
  const search = String(body.search ?? "").toLowerCase();
  let entries = [];
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return send(res, 200, []);
  }
  const rows = [];
  for (const e of entries) {
    if (search && !e.name.toLowerCase().includes(search)) continue;
    if (e.isDirectory()) rows.push({ name: e.name, id: null, updated_at: null, created_at: null, last_accessed_at: null, metadata: null });
    else {
      const meta = await readMeta(bucket, prefix ? `${prefix}/${e.name}` : e.name);
      rows.push({ name: e.name, id: meta?.id ?? null, updated_at: meta?.updated_at ?? null, created_at: meta?.created_at ?? null, last_accessed_at: meta?.updated_at ?? null, metadata: meta?.metadata ?? { size: 0 } });
    }
  }
  rows.sort((a, b) => a.name.localeCompare(b.name));
  send(res, 200, rows.slice(offset, offset + limit));
}

async function remove(res, bucket, body) {
  const out = [];
  for (const key of body.prefixes ?? []) {
    const file = objectFile(bucket, key);
    if (fs.existsSync(file)) {
      await fsp.rm(file, { force: true });
      await fsp.rm(metaFile(bucket, key), { force: true });
      out.push({ name: key, bucket_id: bucket });
    }
  }
  send(res, 200, out);
}

/** "/bucket/a/b c.pdf" -> ["bucket", "a/b c.pdf"] */
function splitBucket(rest) {
  const clean = rest.replace(/^\/+/, "");
  const i = clean.indexOf("/");
  return i < 0 ? [clean, ""] : [clean.slice(0, i), clean.slice(i + 1)];
}

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url ?? "/", "http://local");
    const p = decodeURIComponent(u.pathname);
    const m = req.method ?? "GET";
    const isService = () => bearerClaims(req)?.role === "service_role";

    if (p === "/health" || p === "/status") return send(res, 200, { ok: true });

    if (p.startsWith("/object/upload/sign/")) {
      const [bucket, key] = splitBucket(p.slice("/object/upload/sign".length));
      if (m === "POST") {
        if (!isService()) return fail(res, 403, "Unauthorized", "service_role required");
        await readBody(req);
        const token = signToken({ op: "upload", bucket, key, upsert: req.headers["x-upsert"] === "true", exp: Math.floor(Date.now() / 1000) + UPLOAD_TTL });
        return send(res, 200, { url: `/object/upload/sign/${bucket}/${key}?token=${token}`, token });
      }
      if (m === "PUT") {
        const t = readToken(u.searchParams.get("token"));
        if (!t || t.op !== "upload" || t.bucket !== bucket || t.key !== key) return fail(res, 400, "InvalidSignature", "invalid or expired upload token");
        return store(res, req, bucket, key, t.upsert || req.headers["x-upsert"] === "true");
      }
    }

    if (p.startsWith("/object/sign/")) {
      const [bucket, key] = splitBucket(p.slice("/object/sign".length));
      if (m === "POST") {
        if (!isService()) return fail(res, 403, "Unauthorized", "service_role required");
        const body = JSON.parse((await readBody(req)).toString() || "{}");
        if (!fs.existsSync(objectFile(bucket, key))) return fail(res, 400, "not_found", "Object not found");
        const token = signToken({ op: "read", bucket, key, exp: Math.floor(Date.now() / 1000) + Number(body.expiresIn ?? 60) });
        return send(res, 200, { signedURL: `/object/sign/${bucket}/${key}?token=${token}` });
      }
      if (m === "GET" || m === "HEAD") {
        const t = readToken(u.searchParams.get("token"));
        if (!t || t.op !== "read" || t.bucket !== bucket || t.key !== key) return fail(res, 400, "InvalidSignature", "invalid or expired token");
        return download(res, bucket, key);
      }
    }

    if (p.startsWith("/object/list/") && m === "POST") {
      if (!isService()) return fail(res, 403, "Unauthorized", "service_role required");
      const bucket = p.slice("/object/list/".length).replace(/\/+$/, "");
      return list(res, bucket, JSON.parse((await readBody(req)).toString() || "{}"));
    }

    if (p.startsWith("/object/authenticated/") && m === "GET") {
      if (!isService()) return fail(res, 403, "Unauthorized", "service_role required");
      const [bucket, key] = splitBucket(p.slice("/object/authenticated".length));
      return download(res, bucket, key);
    }

    if (p.startsWith("/object/")) {
      const [bucket, key] = splitBucket(p.slice("/object".length));
      if (!isService()) return fail(res, 403, "Unauthorized", "service_role required");
      if (m === "DELETE" && !key) return remove(res, bucket, JSON.parse((await readBody(req)).toString() || "{}"));
      if (m === "POST") return store(res, req, bucket, key, req.headers["x-upsert"] === "true");
      if (m === "PUT") return store(res, req, bucket, key, true);
      if (m === "GET") return download(res, bucket, key);
    }

    return fail(res, 404, "not_found", `mock-storage: unsupported ${m} ${p}`);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) fail(res, 500, "internal", String(e?.message ?? e));
    else res.destroy();
  }
});

fs.mkdirSync(ROOT, { recursive: true });
server.listen(PORT, "127.0.0.1", () => console.log(`mock storage on http://127.0.0.1:${PORT} (data in ${ROOT})`));
