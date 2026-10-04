import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { requireAdmin } from "@/lib/auth";
import type { EngagementType, MasterCategory, MasterItem } from "@/lib/types";
import { ChecklistAdmin } from "./checklist-admin";

export const metadata: Metadata = { title: "Master checklist" };

export default async function ChecklistPage() {
  const { supabase } = await requireAdmin();
  const [items, cats, types] = await Promise.all([
    supabase.from("master_checklist_items").select("*, master_item_engagement_types(engagement_type_id)").order("sort_order"),
    supabase.from("master_categories").select("*").order("sort_order"),
    supabase.from("engagement_types").select("*").order("sort_order"),
  ]);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Master checklist"
        description="The standard library of request items. Edits create a new revision and apply to new engagements only; live engagements get a “master updated” notice."
      />
      <ChecklistAdmin
        items={(items.data as MasterItem[]) ?? []}
        categories={(cats.data as MasterCategory[]) ?? []}
        types={(types.data as EngagementType[]) ?? []}
      />
    </div>
  );
}
