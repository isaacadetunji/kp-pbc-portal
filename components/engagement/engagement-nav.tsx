"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Briefcase, ChevronDown, ChevronRight, ChevronsUpDown, Folder, FolderOpen, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { EngagementStatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { NavEngagement, NavGroup } from "@/lib/engagement-data";
import { cn, pct } from "@/lib/utils";

/** "FY2025 · Statutory audit" */
export function engagementLabel(e: Pick<NavEngagement, "period_end" | "type_name">) {
  return `FY${e.period_end.slice(0, 4)} · ${e.type_name}`;
}

function MiniBar({ value, label }: { value: number; label: string }) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <span className="block h-1.5 w-full overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(v)} aria-label={label}>
      <span className="block h-full rounded-full bg-success" style={{ width: `${v}%` }} />
    </span>
  );
}

/**
 * Vertical engagement list grouped into collapsible folder rows (one per client
 * or entity). Used on /engagements, as the left pane inside an engagement, and
 * in the client portal.
 */
export function EngagementNavList({
  groups,
  activeId,
  hrefBase,
  audience = "team",
  dense = false,
  showHeader = true,
}: {
  groups: NavGroup[];
  activeId?: string;
  hrefBase: "/engagements" | "/portal";
  audience?: "team" | "client";
  dense?: boolean;
  showHeader?: boolean;
}) {
  const total = groups.reduce((n, g) => n + g.items.length, 0);
  const activeGroup = groups.find((g) => g.items.some((i) => i.id === activeId))?.key;
  const [collapsed, setCollapsed] = useState<Set<string>>(
    () => new Set(total > 30 ? groups.filter((g) => g.key !== activeGroup).map((g) => g.key) : []),
  );
  const toggle = (k: string) =>
    setCollapsed((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  return (
    <div className="space-y-1" data-testid="engagement-nav">
      {showHeader ? (
        <div className="flex items-center justify-between px-2 pb-1 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
          <span>{audience === "client" ? "Your engagements" : "My engagements"}</span>
          <span className="tabular">{total}</span>
        </div>
      ) : null}
      <ul className="space-y-1">
        {groups.map((g) => {
          const isCollapsed = collapsed.has(g.key);
          const panelId = `nav-${hrefBase.slice(1)}-${g.key}`;
          return (
            <li key={g.key} className="rounded-lg">
              <button
                type="button"
                onClick={() => toggle(g.key)}
                aria-expanded={!isCollapsed}
                aria-controls={panelId}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 text-left text-sm font-semibold hover:bg-muted/70 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                  dense ? "py-1.5" : "py-2",
                )}
              >
                {isCollapsed ? <ChevronRight className="size-4 shrink-0 text-muted-foreground" /> : <ChevronDown className="size-4 shrink-0 text-muted-foreground" />}
                {isCollapsed ? <Folder className="size-4 shrink-0 text-brand-accent" /> : <FolderOpen className="size-4 shrink-0 text-brand-accent" />}
                <span className="min-w-0 flex-1 truncate" title={g.label}>{g.label}</span>
                <span className="rounded-full bg-muted px-1.5 text-xs font-medium text-muted-foreground tabular" aria-label={`${g.items.length} engagement${g.items.length === 1 ? "" : "s"}`}>
                  {g.items.length}
                </span>
              </button>
              {!isCollapsed ? (
                <ul id={panelId} className="mt-0.5 ml-4 space-y-0.5 border-l pl-2">
                  {g.items.map((e) => {
                    const active = e.id === activeId;
                    const released = e.status !== "draft" && e.status !== "awaiting_approval";
                    return (
                      <li key={e.id}>
                        <Link
                          href={`${hrefBase}/${e.id}`}
                          aria-current={active ? "page" : undefined}
                          aria-label={`${e.client_name} — ${e.name} (${e.code})`}
                          className={cn(
                            "block rounded-md px-2 hover:bg-muted/70 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                            dense ? "py-1.5" : "py-2",
                            active && "bg-accent text-accent-foreground hover:bg-accent",
                          )}
                        >
                          {dense ? (
                            <>
                              <span className={cn("block truncate text-sm", active ? "font-semibold" : "font-medium")} title={engagementLabel(e)}>{engagementLabel(e)}</span>
                              <span className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                                <span className="min-w-0 flex-1 truncate">{e.code}</span>
                                <EngagementStatusBadge status={e.status} audience={audience} />
                              </span>
                              {released || audience === "team" ? (
                                <span className="mt-1.5 flex items-center gap-2">
                                  <MiniBar value={e.pct_provided} label={`${e.code} progress`} />
                                  <span className="w-9 shrink-0 text-right text-[11px] text-muted-foreground tabular">{pct(e.pct_provided)}</span>
                                </span>
                              ) : null}
                            </>
                          ) : (
                            <span className="grid gap-x-4 gap-y-1.5 sm:grid-cols-[minmax(0,1fr)_11rem_8.5rem] sm:items-center">
                              <span className="min-w-0">
                                <span className={cn("block truncate text-sm", active ? "font-semibold" : "font-medium")}>{engagementLabel(e)}</span>
                                <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                                  {e.code}
                                  {e.name && !e.name.includes(`FY${e.period_end.slice(0, 4)}`) ? ` · ${e.name}` : ""}
                                  {audience === "client" && released ? ` · ${e.open_items} to provide` : ""}
                                  {e.overdue && (released || audience === "team") ? <span className="text-destructive"> · {e.overdue} overdue</span> : null}
                                </span>
                              </span>
                              {released || audience === "team" ? (
                                <span className="flex items-center gap-2">
                                  <MiniBar value={e.pct_provided} label={`${e.code} progress`} />
                                  <span className="w-10 shrink-0 text-right text-xs text-muted-foreground tabular">{pct(e.pct_provided)}</span>
                                </span>
                              ) : (
                                <span className="text-xs text-muted-foreground">Request list not released yet</span>
                              )}
                              <span className="sm:text-right"><EngagementStatusBadge status={e.status} audience={audience} /></span>
                            </span>
                          )}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Mobile: the same list as a dropdown at the top of the engagement page. */
export function EngagementSwitcher({
  groups, activeId, hrefBase, audience = "team", className,
}: { groups: NavGroup[]; activeId: string; hrefBase: "/engagements" | "/portal"; audience?: "team" | "client"; className?: string }) {
  const active = useMemo(() => groups.flatMap((g) => g.items).find((i) => i.id === activeId), [groups, activeId]);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className={cn("h-auto w-full justify-between py-2 text-left", className)} aria-label="Switch engagement">
          <span className="flex min-w-0 items-center gap-2">
            <Briefcase className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">{active ? engagementLabel(active) : "Engagements"}</span>
              <span className="block truncate text-xs font-normal text-muted-foreground">{active?.client_name}</span>
            </span>
          </span>
          <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-[70vh] w-[min(22rem,calc(100vw-2rem))] overflow-y-auto">
        {groups.map((g, i) => (
          <div key={g.key}>
            {i > 0 ? <DropdownMenuSeparator /> : null}
            <DropdownMenuLabel className="flex items-center gap-2 text-xs text-muted-foreground">
              <Folder className="size-3.5 text-brand-accent" /> {g.label}
            </DropdownMenuLabel>
            {g.items.map((e) => (
              <DropdownMenuItem key={e.id} asChild>
                <Link href={`${hrefBase}/${e.id}`} className={cn("flex items-center gap-2", e.id === activeId && "bg-accent")}>
                  <span className="min-w-0 flex-1 truncate">{engagementLabel(e)}</span>
                  <EngagementStatusBadge status={e.status} audience={audience} />
                </Link>
              </DropdownMenuItem>
            ))}
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Two-pane engagement workspace: collapsible engagement list + content. */
export function EngagementWorkspace({
  groups, activeId, hrefBase, audience = "team", children,
}: {
  groups: NavGroup[]; activeId: string; hrefBase: "/engagements" | "/portal"; audience?: "team" | "client"; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className="lg:flex lg:items-start lg:gap-6">
      <aside
        className={cn("sticky top-20 hidden shrink-0 lg:block", open ? "w-72" : "w-9")}
        aria-label={audience === "client" ? "Your engagements" : "My engagements"}
      >
        {open ? (
          <div className="max-h-[calc(100dvh-6rem)] overflow-y-auto rounded-xl border bg-card p-2">
            <div className="flex justify-end">
              <Button size="icon-sm" variant="ghost" onClick={() => setOpen(false)} aria-label="Collapse engagement list" title="Collapse">
                <PanelLeftClose />
              </Button>
            </div>
            <EngagementNavList groups={groups} activeId={activeId} hrefBase={hrefBase} audience={audience} dense />
          </div>
        ) : (
          <Button size="icon-sm" variant="outline" onClick={() => setOpen(true)} aria-label="Show engagement list" title="Show engagements">
            <PanelLeftOpen />
          </Button>
        )}
      </aside>
      <div className="min-w-0 flex-1 space-y-4">
        <div className="lg:hidden">
          <EngagementSwitcher groups={groups} activeId={activeId} hrefBase={hrefBase} audience={audience} />
        </div>
        {children}
      </div>
    </div>
  );
}
