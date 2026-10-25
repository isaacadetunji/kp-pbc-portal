import Link from "next/link";
import { BrandLogo } from "@/components/brand-logo";
import { NotificationBell } from "@/components/notification-bell";
import { UserMenu } from "@/components/user-menu";
import { getStageLabels, requireClient } from "@/lib/auth";
import { StageLabelsProvider } from "@/components/stage-labels";
import { getBrand } from "@/lib/settings";

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const { profile } = await requireClient();
  const [brand, labels] = await Promise.all([getBrand(), getStageLabels()]);
  return (
    <StageLabelsProvider labels={labels}>
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 border-b bg-card/95 backdrop-blur">
        <div className="h-1 bg-gradient-to-r from-brand-accent to-brand-blue" />
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-3 px-4">
          <Link href="/portal" className="flex items-center gap-3">
            <BrandLogo logoUrl={brand.logo_url} firm={brand.firm_name} className="h-5 sm:h-6" />
            <span className="hidden border-l pl-3 text-xs font-medium tracking-wide text-muted-foreground uppercase sm:inline">{brand.portal_name}</span>
          </Link>
          <div className="flex-1" />
          <NotificationBell userId={profile.id} allHref="/portal/notifications" />
          <UserMenu name={profile.full_name} email={profile.email} role="Client" accountHref="/portal/account" />
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">{children}</main>
      <footer className="border-t py-4 text-center text-xs text-muted-foreground">
        {brand.firm_name} · Secure client portal · Files are stored in the firm&apos;s document system and every action is logged.
      </footer>
    </div>
    </StageLabelsProvider>
  );
}
