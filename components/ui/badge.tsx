import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * Corporate status / priority / attribute TAGS. Square-ish (not pills): a small
 * 3px radius, a tinted soft background and a 1px border, 11px medium weight. One
 * tone per meaning, used app-wide (lib/constants.ts maps every status/priority/
 * stage to a variant):
 *   muted/neutral  not started, draft, archived, low
 *   info           submitted / provided (with the firm)
 *   review         under review, awaiting approval
 *   steel          Pre-execution stage (muted indigo — off the old yellow)
 *   brand          current stage in flight (Execution)
 *   success        accepted, received, complete
 *   warning        queried / action needed (muted amber)
 *   ochre          Important priority (muted brown-amber — never yellow)
 *   urgent         Urgent priority (burnt orange — more severe than Important)
 *   danger         critical, overdue (red)
 *   outline        attributes (Permanent / Current, N/A)
 * Soft background + dark text, each pair >= 5.6:1 (WCAG AA) in light and dark.
 */
const badgeVariants = cva(
  "inline-flex items-center justify-center gap-1 rounded-[3px] border px-1.5 py-px text-[11px] leading-[17px] font-medium whitespace-nowrap shrink-0 [&>svg]:size-3 [&>svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        outline: "border-border-strong bg-card text-muted-foreground",
        success: "border-success/25 bg-success-soft text-success",
        warning: "border-warning/25 bg-warning-soft text-warning",
        danger: "border-danger/30 bg-danger-soft text-danger",
        info: "border-info/25 bg-info-soft text-info",
        review: "border-review/25 bg-review-soft text-review",
        steel: "border-steel/25 bg-steel-soft text-steel",
        ochre: "border-ochre/30 bg-ochre-soft text-ochre",
        urgent: "border-urgent/30 bg-urgent-soft text-urgent",
        brand: "border-primary/25 bg-accent text-accent-foreground",
        muted: "border-neutral/15 bg-neutral-soft text-neutral",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

function Badge({ className, variant, ...props }: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />;
}
export { Badge, badgeVariants };
