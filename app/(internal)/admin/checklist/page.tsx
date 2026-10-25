import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { requireStaff } from "@/lib/auth";
import type { EngagementType, MasterCategory, MasterFolder, MasterItemWithClass } from "@/lib/types";
import { ChecklistAdmin } from "./checklist-admin";

export const metadata: Metadata = { title: "Master checklist" };

export default async function ChecklistPage() {
  const { supabase } = await requireStaff();
  const { data: canManage } = await supabase.rpc("has_app_permission", { p_perm: "manage_checklist" });
  if (!canManage) notFound();
  const [items, cats, folders, types] = await Promise.all([
    supabase.from("master_checklist_items").select("*, master_item_engagement_types(engagement_type_id)").order("sort_order"),
    supabase.from("master_categories").select("*").order("sort_order"),
    supabase.from("master_folders").select("*").order("sort_order"),
    supabase.from("engagement_types").select("*").order("sort_order"),
  ]);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Master checklist"
        description="The standard library of request items. Edits create a new revision and apply to new engagements only; live engagements get a “master updated” notice."
      />
      <ChecklistAdmin
        items={(items.data as MasterItemWithClass[]) ?? []}
        categories={(cats.data as MasterCategory[]) ?? []}
        folders={(folders.data as MasterFolder[]) ?? []}
        types={(types.data as EngagementType[]) ?? []}
      />
    </div>
  );
}
