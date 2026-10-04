/* eslint-disable @next/next/no-img-element */
import { cn } from "@/lib/utils";

/** Firm logo from branding settings, with a text fallback. */
export function BrandLogo({ logoUrl, firm, className }: { logoUrl: string | null; firm: string; className?: string }) {
  if (logoUrl) return <img src={logoUrl} alt={firm} className={cn("h-7 w-auto", className)} />;
  return <span className={cn("text-lg font-bold tracking-tight text-primary", className)}>{firm}</span>;
}
