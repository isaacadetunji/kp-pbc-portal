import { cn } from "@/lib/utils";

/**
 * Underlined section tab, shared by the firm and client engagement pages.
 * Lives in a server-safe module (not a "use client" file) so server components
 * such as the client portal engagement page can call it directly.
 */
export function tabClass(active: boolean) {
  return cn(
    "-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-medium whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
    active ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:border-border-strong hover:text-foreground",
  );
}
