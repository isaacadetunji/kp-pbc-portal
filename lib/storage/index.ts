import "server-only";
import { serverEnv } from "@/lib/env";
import { SharePointStorageProvider } from "./sharepoint-provider";
import { SupabaseStorageProvider } from "./supabase-provider";
import type { StorageProvider } from "./types";

export type { StorageProvider, UploadTarget } from "./types";

export function getStorageProvider(id?: "supabase" | "sharepoint"): StorageProvider {
  const env = serverEnv();
  const which = id ?? env.storageProvider;
  return which === "sharepoint" ? new SharePointStorageProvider() : new SupabaseStorageProvider(env.storageBucket);
}
