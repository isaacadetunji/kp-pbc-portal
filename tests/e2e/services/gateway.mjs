// Minimal stand-in for the Supabase API gateway (Kong).
//   /auth/v1/*     -> GoTrue
//   /rest/v1/*     -> PostgREST
//   /storage/v1/*  -> mock-storage.mjs
//   /__templates/* -> supabase/templates/* (GoTrue fetches its email templates from here)
//   /__health      -> 200
// CORS preflight (OPTIONS) is answered here before anything is proxied, and the
// upstream's own CORS headers are replaced, so every header is written exactly once.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const env = process.env;
const PORT = Number(env.GATEWAY_PORT ?? 54321);
const TEMPLATES = env.TEMPLATES_DIR ?? path.resolve("supabase/templates");
const ROUTES = [
  { prefix: "/auth/v1", port: Number(env.GOTRUE_PORT ?? 54331) },
  { prefix: "/rest/v1", port: Number(env.POSTGREST_PORT ?? 54332) },
  { prefix: "/storage/v1", port: Number(env.STORAGE_PORT ?? 54333) },
];

function corsHeaders(req) {
  const origin = req.headers.origin;
  return {
    "access-control-allow-origin": origin ?? "*",
    ...(origin ? { "access-control-allow-credentials": "true", vary: "Origin" } : {}),
    "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS,HEAD",
    "access-control-allow-headers":
      req.headers["access-control-request-headers"] ??
      "authorization,apikey,content-type,x-client-info,x-upsert,prefer,range,accept-profile,content-profile,x-supabase-api-version",
    "access-control-expose-headers": "content-range,content-length,content-type,x-total-count,x-supabase-api-version,etag",
    "access-control-max-age": "600",
  };
}

const server = http.createServer((req, res) => {
  const url = req.url ?? "/";
  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders(req));
    return res.end();
  }
  if (url === "/__health") {
    res.writeHead(200, { "content-type": "text/plain", ...corsHeaders(req) });
    return res.end("ok");
  }
  if (url.startsWith("/__templates/")) {
    const name = path.basename(decodeURIComponent(url.slice("/__templates/".length).split("?")[0]));
    const file = path.join(TEMPLATES, name);
    if (!fs.existsSync(file)) {
      res.writeHead(404);
      return res.end("not found");
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    return fs.createReadStream(file).pipe(res);
  }
  const route = ROUTES.find((r) => url === r.prefix || url.startsWith(r.prefix + "/") || url.startsWith(r.prefix + "?"));
  if (!route) {
    res.writeHead(404, { "content-type": "application/json", ...corsHeaders(req) });
    return res.end(JSON.stringify({ message: `no route for ${url}` }));
  }
  const upstreamPath = url.slice(route.prefix.length) || "/";
  const headers = { ...req.headers, host: `127.0.0.1:${route.port}` };
  // GoTrue builds absolute URLs from API_EXTERNAL_URL; do not forward the browser's host.
  delete headers["x-forwarded-host"];
  const up = http.request(
    { host: "127.0.0.1", port: route.port, method: req.method, path: upstreamPath.startsWith("/") ? upstreamPath : "/" + upstreamPath, headers },
    (upRes) => {
      const out = {};
      for (const [k, v] of Object.entries(upRes.headers)) {
        if (k.startsWith("access-control-") || k === "vary") continue;
        out[k] = v;
      }
      if (res.headersSent) return upRes.resume();
      res.writeHead(upRes.statusCode ?? 502, { ...out, ...corsHeaders(req) });
      upRes.pipe(res);
    },
  );
  up.on("error", (err) => {
    if (!res.headersSent) {
      res.writeHead(502, { "content-type": "application/json", ...corsHeaders(req) });
      res.end(JSON.stringify({ message: `upstream ${route.prefix} unavailable: ${err.message}` }));
    } else res.destroy(err);
  });
  req.pipe(up);
});

// Realtime (websocket) is not part of the local stack: refuse upgrades cleanly.
server.on("upgrade", (_req, socket) => {
  socket.end("HTTP/1.1 503 Service Unavailable\r\nconnection: close\r\ncontent-length: 0\r\n\r\n");
});

server.keepAliveTimeout = 5000;
server.listen(PORT, "127.0.0.1", () => console.log(`gateway listening on http://127.0.0.1:${PORT}`));
