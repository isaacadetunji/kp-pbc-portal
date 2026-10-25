import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const alertVariants = cva("relative flex w-full gap-3 rounded-lg border px-4 py-3 text-sm leading-5 [&>svg]:mt-0.5 [&>svg]:size-4 [&>svg]:shrink-0", {
  variants: {
    variant: {
      default: "bg-card text-card-foreground shadow-xs",
      info: "border-info/20 bg-info-soft text-info",
      warning: "border-warning/25 bg-warning-soft text-warning",
      destructive: "border-danger/20 bg-danger-soft text-danger",
      success: "border-success/25 bg-success-soft text-success",
    },
  },
  defaultVariants: { variant: "default" },
});

function Alert({ className, variant, ...props }: React.ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
  return <div role="alert" className={cn(alertVariants({ variant }), className)} {...props} />;
}
export { Alert };
