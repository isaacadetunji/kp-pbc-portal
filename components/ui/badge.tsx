import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * Status pills and attribute tags. One tone per meaning, used app-wide
 * (lib/constants.ts maps every status to a variant):
 *   muted/neutral  not started, draft, archived, low
 *   info           submitted / provided (with the firm)
 *   review         under review, awaiting approval
 *   brand          current stage in flight (Execution)
 *   success        accepted, received, complete
 *   warning        queried / action needed, pre-execution, important
 *   danger         critical, urgent, overdue
 *   outline        attributes (Permanent / Current, N/A) – square tag, not a pill
 * Soft background + dark text, each pair >= 5.6:1 (WCAG AA).
 */
const badgeVariants = cva(
  "inline-flex items-center justify-center gap-1 rounded-full border px-2 py-px text-xs leading-[18px] font-medium whitespace-nowrap shrink-0 [&>svg]:size-3 [&>svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        outline: "rounded-md border-border-strong bg-card text-muted-foreground",
        success: "border-success/15 bg-success-soft text-success",
        warning: "border-warning/15 bg-warning-soft text-warning",
        danger: "border-danger/15 bg-danger-soft text-danger",
        info: "border-info/15 bg-info-soft text-info",
        review: "border-review/15 bg-review-soft text-review",
        brand: "border-primary/20 bg-accent text-accent-foreground",
        muted: "border-neutral/10 bg-neutral-soft text-neutral",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

function Badge({ className, variant, ...props }: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />;
}
export { Badge, badgeVariants };
