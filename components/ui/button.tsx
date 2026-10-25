import * as React from "react";
import { Slot } from "radix-ui";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium tracking-[-0.005em] transition-[color,background-color,border-color,box-shadow] duration-150 active:translate-y-px disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow-[inset_0_1px_0_rgb(255_255_255/0.14),0_1px_2px_rgb(16_24_40/0.12)] hover:bg-primary-hover",
        destructive: "bg-destructive text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.12),0_1px_2px_rgb(16_24_40/0.12)] hover:bg-danger",
        outline: "border border-border-strong bg-card text-foreground shadow-xs hover:border-primary/40 hover:bg-accent hover:text-accent-foreground",
        secondary: "bg-secondary text-secondary-foreground hover:bg-border",
        ghost: "text-foreground/80 hover:bg-muted hover:text-foreground",
        link: "text-primary underline-offset-4 hover:underline",
        success: "bg-success-solid text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.14),0_1px_2px_rgb(16_24_40/0.12)] hover:bg-success",
        warning: "bg-warning-solid text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.14),0_1px_2px_rgb(16_24_40/0.12)] hover:bg-warning",
      },
      size: {
        default: "h-9 px-4 py-2 has-[>svg]:px-3",
        sm: "h-8 rounded-md gap-1.5 px-3 text-[13px] has-[>svg]:px-2.5",
        lg: "h-11 rounded-lg px-6 text-[15px] has-[>svg]:px-4",
        icon: "size-9",
        "icon-sm": "size-8",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "button";
  return <Comp data-slot="button" className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}

export { Button, buttonVariants };
