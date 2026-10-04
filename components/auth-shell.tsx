import { ShieldCheck } from "lucide-react";
import { BrandLogo } from "@/components/brand-logo";
import { getBrand } from "@/lib/settings";

/** Split layout used by login and other signed-out pages. */
export async function AuthShell({ children, title, subtitle }: { children: React.ReactNode; title: string; subtitle?: string }) {
  const brand = await getBrand();
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.1fr_1fr]">
      <aside className="relative hidden flex-col justify-between overflow-hidden border-r bg-accent/60 p-10 lg:flex">
        <div className="space-y-2">
          <BrandLogo logoUrl={brand.logo_url} firm={brand.firm_name} className="h-9" />
          <div className="text-sm font-medium tracking-wide text-muted-foreground uppercase">{brand.portal_name}</div>
        </div>
        <div className="relative z-10 max-w-md space-y-4">
          <h2 className="text-3xl leading-tight font-semibold text-balance">One secure place for every information request.</h2>
          <p className="text-muted-foreground">
            See exactly what your engagement team needs, upload documents from any device, and track progress in real time.
          </p>
        </div>
        <div className="relative z-10 flex items-center gap-2 text-sm text-muted-foreground">
          <ShieldCheck className="size-4 text-brand-blue" /> Encrypted in transit and at rest. Access is logged.
        </div>
        {/* Chevron motif echoing the logo mark */}
        <svg aria-hidden className="pointer-events-none absolute -right-16 bottom-10 h-72 w-72 opacity-90" viewBox="0 0 200 200" fill="none">
          <path d="M120 10 L60 100 L120 190" stroke="var(--brand-accent)" strokeWidth="34" strokeLinejoin="miter" opacity=".35" />
          <path d="M175 10 L115 100 L175 190" stroke="var(--brand-blue)" strokeWidth="34" strokeLinejoin="miter" opacity=".25" />
        </svg>
      </aside>
      <main className="flex items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-sm space-y-6">
          <div className="lg:hidden">
            <BrandLogo logoUrl={brand.logo_url} firm={brand.firm_name} className="h-7" />
          </div>
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
            {subtitle ? <p className="text-sm text-muted-foreground">{subtitle}</p> : null}
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}
