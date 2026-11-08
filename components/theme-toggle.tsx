"use client";

import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

type Choice = "light" | "dark" | "system";

const OPTIONS: { value: Choice; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
];

/** Reads the theme cookie (same source the no-flash script in app/layout uses). */
function readChoice(): Choice {
  if (typeof document === "undefined") return "system";
  const m = document.cookie.match(/(?:^|; )theme=([^;]+)/);
  const v = m ? decodeURIComponent(m[1]!) : "system";
  return v === "light" || v === "dark" ? v : "system";
}

function systemPrefersDark() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/** Applies the resolved theme to <html> and remembers the choice (cookie + localStorage). */
function apply(choice: Choice) {
  const dark = choice === "dark" || (choice === "system" && systemPrefersDark());
  document.documentElement.classList.toggle("dark", dark);
  try {
    document.cookie = `theme=${choice}; path=/; max-age=31536000; samesite=lax`;
    localStorage.setItem("theme", choice);
  } catch {
    /* storage can be blocked; the cookie still drives SSR */
  }
}

export function ThemeToggle({ className }: { className?: string }) {
  const [choice, setChoice] = useState<Choice>("system");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setChoice(readChoice());
    setMounted(true);
  }, []);

  // Follow OS changes while on "system".
  useEffect(() => {
    if (choice !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => apply("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [choice]);

  function pick(next: Choice) {
    setChoice(next);
    apply(next);
  }

  const Active = (mounted ? OPTIONS.find((o) => o.value === choice) : undefined)?.icon ?? Sun;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Appearance"
        title="Appearance"
        className={cn(
          "grid size-9 place-items-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50",
          className,
        )}
      >
        <Active className="size-[18px]" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuLabel>Appearance</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {OPTIONS.map((o) => (
          <DropdownMenuItem
            key={o.value}
            onSelect={() => pick(o.value)}
            className={cn(mounted && choice === o.value && "text-primary")}
          >
            <o.icon /> {o.label}
            {mounted && choice === o.value ? <span className="ml-auto text-xs text-muted-foreground">●</span> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
