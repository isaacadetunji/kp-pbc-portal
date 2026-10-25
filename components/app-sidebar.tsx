"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Briefcase, Building2, ClipboardList, LayoutDashboard, Menu, Settings, Users, Bell, UserCog,
} from "lucide-react";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { BrandLogo } from "@/components/brand-logo";
import { cn } from "@/lib/utils";

type NavItem = { href: string; label: string; icon: React.ComponentType<{ className?: string }> };

/** Which admin areas the user may open (from Settings > Access; Settings itself is Super admin only). */
export interface NavAccess {
  users: boolean;
  clients: boolean;
  checklist: boolean;
  settings: boolean;
}

const MAIN: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/engagements", label: "Engagements", icon: Briefcase },
  { href: "/notifications", label: "Notifications", icon: Bell },
];
const ADMIN: (NavItem & { area: keyof NavAccess })[] = [
  { href: "/admin/users", label: "Users & access", icon: Users, area: "users" },
  { href: "/admin/clients", label: "Clients", icon: Building2, area: "clients" },
  { href: "/admin/checklist", label: "Master checklist", icon: ClipboardList, area: "checklist" },
  { href: "/admin/settings", label: "Settings", icon: Settings, area: "settings" },
];

function NavLinks({ access, onNavigate }: { access: NavAccess; onNavigate?: () => void }) {
  const admin = ADMIN.filter((a) => access[a.area]);
  const path = usePathname();
  const link = (n: NavItem) => {
    const active = path === n.href || path.startsWith(`${n.href}/`);
    return (
      <Link
        key={n.href}
        href={n.href}
        onClick={onNavigate}
        className={cn(
          "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-sidebar-muted transition-colors hover:bg-sidebar-active hover:text-sidebar-foreground",
          active && "bg-sidebar-active text-primary",
        )}
        aria-current={active ? "page" : undefined}
      >
        <n.icon className="size-4" />
        {n.label}
      </Link>
    );
  };
  return (
    <nav className="flex flex-1 flex-col gap-1 px-3">
      {MAIN.map(link)}
      {admin.length ? (
        <>
          <div className="mt-6 mb-1 px-3 text-[11px] font-semibold tracking-wider text-sidebar-muted uppercase">Administration</div>
          {admin.map(link)}
        </>
      ) : null}
      <div className="mt-auto pb-4">{link({ href: "/account", label: "My account", icon: UserCog })}</div>
    </nav>
  );
}

function Brand({ firm, portal, logoUrl }: { firm: string; portal: string; logoUrl: string | null }) {
  return (
    <Link href="/dashboard" className="flex flex-col gap-1.5 px-5 pt-6 pb-5">
      <BrandLogo logoUrl={logoUrl} firm={firm} className="h-6" />
      <span className="text-xs font-medium tracking-wide text-sidebar-muted uppercase">{portal}</span>
    </Link>
  );
}

export function AppSidebar({ access, firm, portal, logoUrl }: { access: NavAccess; firm: string; portal: string; logoUrl: string | null }) {
  return (
    <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col bg-sidebar text-sidebar-foreground border-r lg:flex">
      <Brand firm={firm} portal={portal} logoUrl={logoUrl} />
      <NavLinks access={access} />
    </aside>
  );
}

export function MobileNav({ access, firm, portal, logoUrl }: { access: NavAccess; firm: string; portal: string; logoUrl: string | null }) {
  return (
    <Sheet>
      <SheetTrigger className="rounded-md p-2 hover:bg-muted lg:hidden" aria-label="Open navigation">
        <Menu className="size-5" />
      </SheetTrigger>
      <SheetContent side="left" className="flex bg-sidebar p-0 text-sidebar-foreground">
        <SheetTitle className="sr-only">Navigation</SheetTitle>
        <Brand firm={firm} portal={portal} logoUrl={logoUrl} />
        <NavLinks access={access} />
      </SheetContent>
    </Sheet>
  );
}
