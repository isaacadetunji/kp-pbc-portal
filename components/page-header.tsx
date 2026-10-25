import { cn } from "@/lib/utils";

export function PageHeader({
  title, description, actions, className, eyebrow,
}: { title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; className?: string; eyebrow?: React.ReactNode }) {
  return (
    <div className={cn("flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between", className)}>
      <div className="min-w-0 space-y-1">
        {eyebrow ? <div className="eyebrow">{eyebrow}</div> : null}
        <h1 className="text-[26px] leading-8 font-bold text-foreground sm:text-[28px] sm:leading-9">{title}</h1>
        {description ? <div className="max-w-3xl text-sm text-muted-foreground">{description}</div> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
