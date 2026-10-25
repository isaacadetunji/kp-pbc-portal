/** Harness configuration, read from the environment and $KP_E2E_STATE/keys.env (written by start-stack.sh). */
import fs from "node:fs";
import path from "node:path";

export const stateDir = process.env.KP_E2E_STATE ?? "/tmp/kp-e2e-state";

function readKeysEnv(): Record<string, string> {
  const file = path.join(stateDir, "keys.env");
  if (!fs.existsSync(file)) return {};
  const out: Record<string, string> = {};
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]!] = m[2]!;
  }
  return out;
}
const keys = readKeysEnv();
const pick = (name: string, fallback: string) => process.env[name] ?? keys[name] ?? fallback;

export const appUrl = pick("APP_URL", "http://localhost:3000").replace(/\/$/, "");
export const supabaseUrl = pick("SUPABASE_URL", "http://localhost:54321").replace(/\/$/, "");
export const mailDir = pick("MAIL_DIR", path.join(stateDir, "mail"));
export const anonKey = pick("ANON_KEY", "");
export const serviceRoleKey = pick("SERVICE_ROLE_KEY", "");
export const demoPassword = process.env.DEMO_PASSWORD ?? "DemoPass#2026";

/** Demo accounts created by scripts/seed-demo.mts */
export const users = {
  superAdmin: "super@demo.kp.test",
  admin: "admin@demo.kp.test",
  lead: "lead@demo.kp.test",
  manager: "manager@demo.kp.test",
  senior: "senior@demo.kp.test",
  clientCfo: "cfo@demo.client.test",
  clientFc: "fc@demo.client.test",
} as const;

/** The seed's released engagement is for last calendar year (scripts/seed-demo.mts). */
export const seedYear = new Date().getFullYear() - 1;
