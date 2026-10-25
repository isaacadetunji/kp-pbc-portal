"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, Briefcase, ClipboardList, KeyRound, SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";

const ITEMS = [
  { href: "/admin/settings", label: "General", icon: SlidersHorizontal, exact: true },
  { href: "/admin/settings/access", label: "Access", icon: KeyRound },
  { href: "/admin/settings/engagements", label: "Engagements", icon: Briefcase },
  { href: "/admin/settings/checklist", label: "Checklist", icon: ClipboardList },
  { href: "/admin/settings/notifications", label: "Notifications", icon: Bell },
];

export function SettingsNav() {
  const path = usePathname();
  return (
    <nav aria-label="Settings sections" className="lg:w-52 lg:shrink-0">
      <ul className="flex gap-1 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0">
        {ITEMS.map((i) => {
          const active = i.exact ? path === i.href : path === i.href || path.startsWith(`${i.href}/`);
          return (
            <li key={i.href}>
              <Link
                href={i.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                  active && "bg-muted text-primary",
                )}
              >
                <i.icon className="size-4" />
                {i.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
