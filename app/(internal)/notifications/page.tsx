import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { NotificationsList } from "@/components/notifications-list";
import { requireStaff } from "@/lib/auth";
import type { Notification } from "@/lib/types";

export const metadata: Metadata = { title: "Notifications" };

export default async function NotificationsPage() {
  const { supabase } = await requireStaff();
  const { data } = await supabase.from("notifications").select("*").order("created_at", { ascending: false }).limit(200);
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title="Notifications" description="Uploads, queries, comments and mentions on your engagements." />
      <NotificationsList items={(data as Notification[]) ?? []} />
    </div>
  );
}
