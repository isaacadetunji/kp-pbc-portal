import * as React from "react";
import { PROGRESS_BAR_CLASS, progressTone, PROGRESS_LEGEND } from "@/lib/progress";
import { cn } from "@/lib/utils";

type Tone = "primary" | "accent" | "success" | "warning" | "danger" | "auto";

/**
 * Accessible progress bar. `tone` picks the fill colour; "auto" applies the
 * shared red / blue / green thresholds from lib/progress.ts.
 */
function Progress({
  value,
  className,
  tone = "primary",
  label,
  size = "md",
}: {
  value: number;
  className?: string;
  tone?: Tone;
  label?: string;
  size?: "sm" | "md" | "lg";
}) {
  const v = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
  const fill =
    tone === "auto"
      ? PROGRESS_BAR_CLASS[progressTone(v)]
      : {
          primary: "bg-primary",
          accent: "bg-brand-accent",
          success: "bg-success-bar",
          warning: "bg-warning-bar",
          danger: "bg-danger-bar",
        }[tone];
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(v)}
      aria-label={label}
      className={cn(
        "relative w-full overflow-hidden rounded-full bg-[#e3e8ef]",
        size === "sm" ? "h-1.5" : size === "lg" ? "h-2.5" : "h-2",
        className,
      )}
    >
      <div
        className={cn("h-full rounded-full transition-[width] duration-500 ease-out", fill, v > 0 && "min-w-1.5")}
        style={{ width: `${v}%` }}
      />
    </div>
  );
}

/** Key for the red / blue / green progress rule. */
function ProgressLegend({ className, prefix }: { className?: string; prefix?: string }) {
  return (
    <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground", className)}>
      {prefix ? <span>{prefix}</span> : null}
      {PROGRESS_LEGEND.map((l) => (
        <span key={l.tone} className="inline-flex items-center gap-1.5">
          <span className={cn("size-2 rounded-full", PROGRESS_BAR_CLASS[l.tone])} aria-hidden />
          {l.label}
        </span>
      ))}
    </div>
  );
}
export { Progress, ProgressLegend };
