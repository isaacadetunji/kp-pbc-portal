/** Centralised, typed access to environment variables. Server-only values
 *  must never be imported into client components. */
export const publicEnv = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
  siteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
  firmName: process.env.NEXT_PUBLIC_FIRM_NAME ?? "Kreston Pedabo",
};

export function serverEnv() {
  return {
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
    storageProvider: (process.env.STORAGE_PROVIDER ?? "supabase") as "supabase" | "sharepoint",
    storageBucket: process.env.SUPABASE_STORAGE_BUCKET ?? "pbc-files",
    clientDirectoryMode: (process.env.CLIENT_DIRECTORY_MODE ?? "mock") as "mock" | "rest",
    clientApiBaseUrl: process.env.CLIENT_API_BASE_URL ?? "",
    clientApiKey: process.env.CLIENT_API_KEY ?? "",
    clientApiAuthHeader: process.env.CLIENT_API_AUTH_HEADER ?? "Authorization",
    clientApiAuthScheme: process.env.CLIENT_API_AUTH_SCHEME ?? "Bearer",
    clientApiTimeoutMs: Number(process.env.CLIENT_API_TIMEOUT_MS ?? 15000),
    sessionIdleMinutes: Number(process.env.SESSION_IDLE_MINUTES ?? 30),
    emailProvider: (process.env.EMAIL_PROVIDER ?? "supabase") as "supabase" | "resend" | "graph",
  };
}
