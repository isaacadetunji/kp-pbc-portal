"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/** Re-renders the current server page when anything on the engagement changes. */
export function RealtimeRefresh({ engagementId }: { engagementId: string }) {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const supabase = createClient();
    const bump = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => router.refresh(), 600);
    };
    const filter = `engagement_id=eq.${engagementId}`;
    const ch = supabase
      .channel(`engagement:${engagementId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "request_items", filter }, bump)
      .on("postgres_changes", { event: "*", schema: "public", table: "request_item_files", filter }, bump)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "comments", filter }, bump)
      .on("postgres_changes", { event: "*", schema: "public", table: "sample_lines", filter }, bump)
      .on("postgres_changes", { event: "*", schema: "public", table: "engagement_documents", filter }, bump)
      .on("postgres_changes", { event: "*", schema: "public", table: "engagement_events", filter }, bump)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "engagements", filter: `id=eq.${engagementId}` }, bump)
      .subscribe();
    return () => {
      if (timer.current) clearTimeout(timer.current);
      supabase.removeChannel(ch);
    };
  }, [engagementId, router]);

  return null;
}
