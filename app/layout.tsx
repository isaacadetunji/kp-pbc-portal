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

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#0F77AD" },
    { media: "(prefers-color-scheme: dark)", color: "#0c1626" },
  ],
};

// Runs before first paint: resolves the saved choice (cookie) or the OS setting
// and sets the .dark class on <html>, so there is no flash of the wrong theme.
const NO_FLASH = `(function(){try{var m=document.cookie.match(/(?:^|; )theme=([^;]+)/);var t=m?decodeURIComponent(m[1]):'system';var d=t==='dark'||(t!=='light'&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d);}catch(e){}})();`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const brand = await getBrand();
  return (
    <html
      lang="en-GB"
      suppressHydrationWarning
      style={{ ["--brand-primary" as string]: brand.primary, ["--brand-accent" as string]: brand.accent }}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: NO_FLASH }} />
      </head>
      <body className="min-h-dvh">
        {children}
        <Toaster position="top-right" richColors closeButton theme="system" />
      </body>
    </html>
  );
}
