import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { rowsToCsv, rowsToXlsx, type ChecklistRow } from "@/lib/checklist-io";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: isStaff } = await supabase.rpc("is_staff");
  if (!isStaff) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { data: canManage } = await supabase.rpc("has_app_permission", { p_perm: "manage_checklist" });
  if (!canManage) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const [{ data: items }, { data: cats }, { data: types }] = await Promise.all([
    supabase
      .from("master_checklist_items")
      .select("*, master_item_engagement_types(engagement_type_id)")
      .order("sort_order"),
    supabase.from("master_categories").select("id, code, sort_order"),
    supabase.from("engagement_types").select("id, code"),
  ]);
  const catById = new Map((cats ?? []).map((c) => [c.id, c]));
  const typeById = new Map((types ?? []).map((t) => [t.id, t.code]));

  const rows: ChecklistRow[] = (items ?? [])
    .sort((a, b) => (catById.get(a.category_id)?.sort_order ?? 0) - (catById.get(b.category_id)?.sort_order ?? 0) || a.sort_order - b.sort_order)
    .map((i) => ({
      code: i.code,
      category_code: catById.get(i.category_id)?.code ?? "",
      title: i.title,
      description: i.guidance ?? "",
      default_folder: i.default_folder,
      file_class: i.file_class ?? "",
      is_critical: i.is_critical ? "yes" : "no",
      default_priority: i.default_priority,
      engagement_types: (i.master_item_engagement_types ?? []).map((x: { engagement_type_id: string }) => typeById.get(x.engagement_type_id)).filter(Boolean).join(";"),
      sort_order: String(i.sort_order),
      is_active: i.is_active ? "yes" : "no",
    }));

  const stamp = new Date().toISOString().slice(0, 10);
  if (request.nextUrl.searchParams.get("format") === "xlsx") {
    const buf = await rowsToXlsx(rows, (cats ?? []).map((c) => c.code));
    return new Response(buf, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="master-checklist-${stamp}.xlsx"`,
      },
    });
  }
  return new Response(rowsToCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="master-checklist-${stamp}.csv"`,
    },
  });
}
