import type { Metadata } from "next";
import { NotificationsList } from "@/components/notifications-list";
import { requireClient } from "@/lib/auth";
import type { Notification } from "@/lib/types";

export const metadata: Metadata = { title: "Notifications" };

export default async function PortalNotificationsPage() {
  const { supabase } = await requireClient();
  const { data } = await supabase.from("notifications").select("*").order("created_at", { ascending: false }).limit(200);
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Notifications</h1>
      <NotificationsList items={(data as Notification[]) ?? []} />
    </div>
  );
}
