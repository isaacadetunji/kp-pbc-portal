// Prints ANON_KEY=… and SERVICE_ROLE_KEY=… (HS256 JWTs signed with JWT_SECRET),
// in the same shape as the keys `supabase start` prints.
import crypto from "node:crypto";

const secret = process.env.JWT_SECRET;
if (!secret) throw new Error("JWT_SECRET is required");
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
function sign(payload) {
  const head = b64({ alg: "HS256", typ: "JWT" });
  const body = b64(payload);
  const sig = crypto.createHmac("sha256", secret).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
}
// Fixed timestamps keep the keys identical across runs, so NEXT_PUBLIC_SUPABASE_ANON_KEY
// (inlined at build time) does not change and an existing .next build stays valid.
const iat = 1767225600; // 2026-01-01
const exp = 2082758400; // 2036-01-01
console.log(`ANON_KEY=${sign({ iss: "supabase-demo", role: "anon", iat, exp })}`);
console.log(`SERVICE_ROLE_KEY=${sign({ iss: "supabase-demo", role: "service_role", iat, exp })}`);
