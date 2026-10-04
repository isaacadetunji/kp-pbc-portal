import * as React from "react";
import { cn } from "@/lib/utils";

/** Accessible progress bar. `tone` picks the fill colour. */
function Progress({
  value,
  className,
  tone = "primary",
  label,
}: {
  value: number;
  className?: string;
  tone?: "primary" | "accent" | "success" | "warning";
  label?: string;
}) {
  const v = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
  const fill = {
    primary: "bg-primary",
    accent: "bg-brand-accent",
    success: "bg-success",
    warning: "bg-warning",
  }[tone];
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(v)}
      aria-label={label}
      className={cn("relative h-2 w-full overflow-hidden rounded-full bg-muted", className)}
    >
      <div className={cn("h-full rounded-full transition-all", fill)} style={{ width: `${v}%` }} />
    </div>
  );
}
export { Progress };
