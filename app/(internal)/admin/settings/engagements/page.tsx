import type { Metadata } from "next";
import { getStageLabels, requireSuperAdmin } from "@/lib/auth";
import { DEFAULT_CODE_FORMAT } from "@/lib/stages";
import type { EngagementType } from "@/lib/types";
import { EngagementSettingsAdmin } from "./engagement-settings-admin";

export const metadata: Metadata = { title: "Settings · Engagements" };

export default async function EngagementSettingsPage() {
  const { supabase } = await requireSuperAdmin();
  const [labels, { data: types }, { data: fmt }, { data: usage }] = await Promise.all([
    getStageLabels(),
    supabase.from("engagement_types").select("*").order("sort_order").order("name"),
    supabase.from("app_settings").select("value").eq("key", "engagement_code_format").maybeSingle(),
    supabase.from("engagements").select("engagement_type_id"),
  ]);
  const counts = ((usage ?? []) as { engagement_type_id: string }[]).reduce<Record<string, number>>(
    (a, r) => ((a[r.engagement_type_id] = (a[r.engagement_type_id] ?? 0) + 1), a), {},
  );
  const format = typeof fmt?.value === "string" && fmt.value ? fmt.value : DEFAULT_CODE_FORMAT;
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Engagements</h2>
        <p className="text-sm text-muted-foreground">Stage names, engagement types and how engagement codes are numbered.</p>
      </div>
      <EngagementSettingsAdmin labels={labels} types={(types as EngagementType[]) ?? []} codeFormat={format} usage={counts} />
    </div>
  );
}
