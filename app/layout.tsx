import type { Metadata, Viewport } from "next";
import "@fontsource-variable/inter";
import "@fontsource-variable/plus-jakarta-sans";
import "./globals.css";
import { Toaster } from "sonner";
import { getBrand } from "@/lib/settings";

// Branding comes from the database, so every page renders per request.
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const brand = await getBrand();
  return {
    title: { default: `${brand.portal_name} · ${brand.firm_name}`, template: `%s · ${brand.portal_name}` },
    description: `${brand.firm_name} secure client information request portal`,
    robots: { index: false, follow: false },
  };
}

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#0F77AD" };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const brand = await getBrand();
  return (
    <html
      lang="en-GB"
      style={{ ["--brand-primary" as string]: brand.primary, ["--brand-accent" as string]: brand.accent }}
    >
      <body className="min-h-dvh">
        {children}
        <Toaster position="top-right" richColors closeButton />
      </body>
    </html>
  );
}
