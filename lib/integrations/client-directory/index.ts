import "server-only";
import { serverEnv } from "@/lib/env";
import { MockClientDirectory } from "./mock";
import { RestClientDirectory } from "./rest";
import type { ClientDirectory } from "./types";

export type { ClientDirectory, DirectoryClient, DirectoryContact } from "./types";

/** Returns the configured client directory (CLIENT_DIRECTORY_MODE=mock|rest). */
export function getClientDirectory(): ClientDirectory {
  const env = serverEnv();
  if (env.clientDirectoryMode === "rest") {
    return new RestClientDirectory({
      baseUrl: env.clientApiBaseUrl,
      apiKey: env.clientApiKey,
      authHeader: env.clientApiAuthHeader,
      authScheme: env.clientApiAuthScheme,
      timeoutMs: env.clientApiTimeoutMs,
      listPath: process.env.CLIENT_API_LIST_PATH,
      itemPath: process.env.CLIENT_API_ITEM_PATH,
      searchParam: process.env.CLIENT_API_SEARCH_PARAM,
      fieldMap: process.env.CLIENT_API_FIELD_MAP,
    });
  }
  return new MockClientDirectory();
}
