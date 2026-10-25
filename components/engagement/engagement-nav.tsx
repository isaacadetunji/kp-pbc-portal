"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, Folder, FolderOpen } from "lucide-react";
import { EngagementStatusBadge } from "@/components/status-badge";
import type { NavEngagement, NavGroup } from "@/lib/engagement-data";
import { progressBarClass, progressTextClass } from "@/lib/progress";
import { cn, pct } from "@/lib/utils";

/** "FY2025 · Statutory audit" */
export function engagementLabel(e: Pick<NavEngagement, "period_end" | "type_name">) {
  return `FY${e.period_end.slice(0, 4)} · ${e.type_name}`;
}

function MiniBar({ value, label }: { value: number; label: string }) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <span className="block h-1.5 w-full overflow-hidden rounded-full bg-[#e3e8ef]" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(v)} aria-label={label}>
      <span className={cn("block h-full rounded-full", progressBarClass(v), v > 0 && "min-w-1.5")} style={{ width: `${v}%` }} />
    </span>
  );
}

/**
 * Vertical engagement list grouped into collapsible folder rows (one per client
 * or entity). Used on /engagements and on the client portal home. (Inside an
 * engagement there is no side list: the header has an "All engagements" link.)
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
        <div className="eyebrow flex items-center justify-between px-2 pb-1">
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
                  "flex w-full items-center gap-2.5 rounded-lg px-2 text-left text-sm font-semibold text-foreground hover:bg-muted/70 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                  dense ? "py-1.5" : "py-2.5",
                )}
              >
                {isCollapsed ? <ChevronRight className="size-4 shrink-0 text-muted-foreground" /> : <ChevronDown className="size-4 shrink-0 text-muted-foreground" />}
                <span className="grid size-7 shrink-0 place-items-center rounded-md bg-accent text-primary">
                  {isCollapsed ? <Folder className="size-4" /> : <FolderOpen className="size-4" />}
                </span>
                <span className="min-w-0 flex-1 truncate" title={g.label}>{g.label}</span>
                <span className="rounded-full border bg-card px-2 text-xs leading-5 font-medium text-muted-foreground tabular" aria-label={`${g.items.length} engagement${g.items.length === 1 ? "" : "s"}`}>
                  {g.items.length}
                </span>
              </button>
              {!isCollapsed ? (
                <ul id={panelId} className="mt-0.5 mb-1 ml-[1.375rem] space-y-0.5 border-l-2 border-border pl-3">
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
                            "block rounded-lg px-3 transition-colors hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                            dense ? "py-1.5" : "py-2.5",
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
                                  <span className={cn("w-9 shrink-0 text-right text-[11px] font-semibold tabular", progressTextClass(e.pct_provided))}>{pct(e.pct_provided)}</span>
                                </span>
                              ) : null}
                            </>
                          ) : (
                            <span className="grid gap-x-6 gap-y-1.5 sm:grid-cols-[minmax(0,1fr)_13rem_10rem] sm:items-center">
                              <span className="min-w-0">
                                <span className={cn("block truncate text-sm", active ? "font-semibold" : "font-medium")}>{engagementLabel(e)}</span>
                                <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                                  {e.code}
                                  {e.name && !e.name.includes(`FY${e.period_end.slice(0, 4)}`) ? ` · ${e.name}` : ""}
                                  {audience === "client" && released ? ` · ${e.open_items} to provide` : ""}
                                  {e.overdue && (released || audience === "team") ? <span className="font-medium text-danger"> · {e.overdue} overdue</span> : null}
                                </span>
                              </span>
                              {released || audience === "team" ? (
                                <span className="flex items-center gap-2">
                                  <MiniBar value={e.pct_provided} label={`${e.code} progress`} />
                                  <span className={cn("w-11 shrink-0 text-right text-xs font-semibold tabular", progressTextClass(e.pct_provided))}>{pct(e.pct_provided)}</span>
                                </span>
                              ) : (
                                <span className="text-xs text-subtle-foreground italic">Request list not released yet</span>
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
