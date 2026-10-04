"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";
import { fmtDateTime } from "@/lib/dates";
import type { Notification } from "@/lib/types";
import { cn } from "@/lib/utils";

export function NotificationsList({ items }: { items: Notification[] }) {
  const router = useRouter();
  const supabase = createClient();
  async function markAll() {
    await supabase.rpc("mark_notifications_read", { p_ids: null });
    router.refresh();
  }
  return (
    <div className="space-y-3">
      {items.some((n) => !n.read_at) ? (
        <Button variant="outline" size="sm" onClick={markAll}><CheckCheck /> Mark all as read</Button>
      ) : null}
      <Card className="divide-y overflow-hidden">
        {items.length === 0 ? <p className="p-8 text-center text-sm text-muted-foreground">No notifications yet.</p> : null}
        {items.map((n) => (
          <Link
            key={n.id}
            href={n.link ?? "#"}
            onClick={() => !n.read_at && supabase.rpc("mark_notifications_read", { p_ids: [n.id] })}
            className={cn("flex gap-3 px-4 py-3 hover:bg-muted/40", !n.read_at && "bg-accent/40")}
          >
            <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", n.read_at ? "bg-transparent" : "bg-brand-accent")} />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">{n.title}</span>
              {n.body ? <span className="block text-sm text-muted-foreground">{n.body}</span> : null}
              <span className="text-xs text-muted-foreground">{fmtDateTime(n.created_at)}</span>
            </span>
          </Link>
        ))}
      </Card>
    </div>
  );
}
