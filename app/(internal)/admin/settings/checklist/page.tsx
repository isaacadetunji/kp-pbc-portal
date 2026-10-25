import type { Metadata } from "next";
import Link from "next/link";
import { requireSettingsAccess } from "@/lib/settings";
import type { MasterCategory, MasterFolder } from "@/lib/types";
import { TaxonomyManager } from "../../checklist/taxonomy-manager";

export const metadata: Metadata = { title: "Settings · Checklist" };

export default async function ChecklistSettingsPage() {
  const { supabase } = await requireSettingsAccess();
  const [cats, folders, items] = await Promise.all([
    supabase.from("master_categories").select("*").order("sort_order"),
    supabase.from("master_folders").select("*").order("sort_order"),
    supabase.from("master_checklist_items").select("category_id, default_folder"),
  ]);
  const byCat: Record<string, number> = {};
  const byFolder: Record<string, number> = {};
  for (const i of items.data ?? []) {
    byCat[i.category_id] = (byCat[i.category_id] ?? 0) + 1;
    const k = String(i.default_folder).toLowerCase();
    byFolder[k] = (byFolder[k] ?? 0) + 1;
  }
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Checklist</h2>
        <p className="text-sm text-muted-foreground">
          Categories and default folders of the <Link href="/admin/checklist" className="text-primary underline-offset-4 hover:underline">master checklist</Link>.
          Users with the “Manage checklist” permission can change these too, from the master checklist.
        </p>
      </div>
      <TaxonomyManager
        categories={(cats.data as MasterCategory[]) ?? []}
        folders={(folders.data as MasterFolder[]) ?? []}
        itemCountByCategory={byCat}
        itemCountByFolder={byFolder}
      />
    </div>
  );
}
