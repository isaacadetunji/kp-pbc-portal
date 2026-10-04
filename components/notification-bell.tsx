"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, CheckCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { createClient } from "@/lib/supabase/client";
import { fromNow } from "@/lib/dates";
import type { Notification } from "@/lib/types";
import { cn } from "@/lib/utils";

export function NotificationBell({ userId, allHref = "/notifications" }: { userId: string; allHref?: string }) {
  const supabase = createClient();
  const router = useRouter();
  const [items, setItems] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("notifications")
      .select("id, type, title, body, link, read_at, created_at")
      .order("created_at", { ascending: false })
      .limit(15);
    setItems((data as Notification[]) ?? []);
  }, [supabase]);

  useEffect(() => {
    load();
    const channel = supabase
      .channel(`notifications:${userId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` }, () => load())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [load, supabase, userId]);

  const unread = items.filter((n) => !n.read_at).length;

  async function markAll() {
    await supabase.rpc("mark_notifications_read", { p_ids: null });
    load();
  }

  async function openItem(n: Notification) {
    if (!n.read_at) await supabase.rpc("mark_notifications_read", { p_ids: [n.id] });
    setOpen(false);
    load();
    if (n.link) router.push(n.link);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}>
          <Bell className="size-5" />
          {unread > 0 ? (
            <span className="absolute top-1 right-1 grid min-w-4 place-items-center rounded-full bg-destructive px-1 text-[10px] leading-4 font-semibold text-white">
              {unread > 9 ? "9+" : unread}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[22rem] p-0">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="text-sm font-semibold">Notifications</div>
          {unread > 0 ? (
            <button onClick={markAll} className="flex items-center gap-1 text-xs text-primary hover:underline">
              <CheckCheck className="size-3.5" /> Mark all read
            </button>
          ) : null}
        </div>
        <div className="max-h-96 overflow-y-auto">
          {items.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">You&apos;re all caught up.</p>
          ) : (
            items.map((n) => (
              <button
                key={n.id}
                onClick={() => openItem(n)}
                className={cn("flex w-full gap-3 border-b px-4 py-3 text-left last:border-0 hover:bg-muted/50", !n.read_at && "bg-accent/40")}
              >
                <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", n.read_at ? "bg-transparent" : "bg-brand-accent")} />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{n.title}</span>
                  {n.body ? <span className="line-clamp-2 block text-xs text-muted-foreground">{n.body}</span> : null}
                  <span className="mt-1 block text-[11px] text-muted-foreground">{fromNow(n.created_at)}</span>
                </span>
              </button>
            ))
          )}
        </div>
        <div className="border-t px-4 py-2 text-center">
          <Link href={allHref} onClick={() => setOpen(false)} className="text-xs text-primary hover:underline">
            View all
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
