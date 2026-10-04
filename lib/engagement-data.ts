import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Client, ClientContact, Engagement, EngagementProgress, EngagementStatus, EngagementType, Folder, FolderProgress, Person, RequestItem, TeamRole,
} from "@/lib/types";

export interface TeamMember extends Person {
  team_role: TeamRole;
}

export interface EngagementBundle {
  engagement: Engagement;
  client: Client;
  type: EngagementType;
  folders: Folder[];
  items: RequestItem[];
  team: TeamMember[];
  progress: EngagementProgress | null;
  folderProgress: FolderProgress[];
  fileCounts: Record<string, number>;
  commentCounts: Record<string, number>;
}

/** Loads everything an engagement screen needs, with the caller's RLS. */
export async function loadEngagement(supabase: SupabaseClient, id: string): Promise<EngagementBundle | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data: engagement } = await supabase.from("engagements").select("*").eq("id", id).maybeSingle<Engagement>();
  if (!engagement) return null;

  const [client, type, folders, items, team, progress, folderProgress, files, comments] = await Promise.all([
    supabase.from("clients").select("*").eq("id", engagement.client_id).maybeSingle<Client>(),
    supabase.from("engagement_types").select("*").eq("id", engagement.engagement_type_id).single<EngagementType>(),
    supabase.from("engagement_folders").select("*").eq("engagement_id", id).order("sort_order").order("name"),
    supabase.from("request_items").select("*").eq("engagement_id", id).order("sort_order").order("code"),
    supabase.from("engagement_team").select("team_role, profiles:user_id(id, full_name, email, app_role, phone, job_title)").eq("engagement_id", id),
    supabase.from("v_engagement_progress").select("*").eq("engagement_id", id).maybeSingle<EngagementProgress>(),
    supabase.from("v_folder_progress").select("*").eq("engagement_id", id),
    supabase.from("request_item_files").select("request_item_id").eq("engagement_id", id).eq("kind", "client_submission").not("submitted_at", "is", null),
    supabase.from("comments").select("request_item_id").eq("engagement_id", id).is("deleted_at", null).is("sample_line_id", null),
  ]);

  const count = (rows: { request_item_id: string }[] | null) =>
    (rows ?? []).reduce<Record<string, number>>((acc, r) => {
      acc[r.request_item_id] = (acc[r.request_item_id] ?? 0) + 1;
      return acc;
    }, {});

  const roleOrder: Record<TeamRole, number> = { lead: 0, manager: 1, member: 2 };
  const teamRows = (team.data ?? []) as unknown as { team_role: TeamRole; profiles: Person | null }[];

  return {
    engagement,
    // Clients can always read their own client record; staff can read all
    client: client.data ?? ({ id: engagement.client_id, name: "Client" } as Client),
    type: type.data as EngagementType,
    folders: (folders.data as Folder[]) ?? [],
    items: (items.data as RequestItem[]) ?? [],
    team: teamRows
      .filter((t) => t.profiles)
      .map((t) => ({ ...(t.profiles as Person), team_role: t.team_role }))
      .sort((a, b) => roleOrder[a.team_role] - roleOrder[b.team_role]),
    progress: progress.data ?? null,
    folderProgress: (folderProgress.data as FolderProgress[]) ?? [],
    fileCounts: count(files.data as { request_item_id: string }[] | null),
    commentCounts: count(comments.data as { request_item_id: string }[] | null),
  };
}

export interface ClientAccessRow {
  id: string;
  invited_at: string;
  first_login_at: string | null;
  revoked_at: string | null;
  contact: ClientContact;
}

/** Released to the client (the request list is visible to them). */
export const isReleased = (s: EngagementStatus) => s !== "draft" && s !== "awaiting_approval";

export interface NavEngagement {
  id: string;
  code: string;
  name: string;
  status: EngagementStatus;
  period_end: string;
  client_id: string;
  client_name: string;
  group_id: string | null;
  type_name: string;
  pct_provided: number;
  applicable: number;
  accepted: number;
  open_items: number;
  overdue: number;
}

export interface NavGroup {
  key: string;
  label: string;
  items: NavEngagement[];
}

type NavRow = {
  id: string; code: string; name: string; status: EngagementStatus; period_end: string; client_id: string;
  clients: { name: string; group_id: string | null } | null; engagement_types: { name: string } | null;
};

/**
 * Engagements for the vertical workspace list, read with the caller's RLS.
 * scope "mine" limits staff to engagements they are on the team of (admins can
 * read every engagement through RLS, so "mine" is applied explicitly).
 */
export async function loadEngagementNav(
  supabase: SupabaseClient,
  opts: { userId: string; scope: "mine" | "all"; includeArchived?: boolean },
): Promise<NavEngagement[]> {
  let ids: string[] | null = null;
  if (opts.scope === "mine") {
    const { data } = await supabase.from("engagement_team").select("engagement_id").eq("user_id", opts.userId);
    ids = (data ?? []).map((r) => r.engagement_id as string);
    if (ids.length === 0) return [];
  }
  let q = supabase
    .from("engagements")
    .select("id, code, name, status, period_end, client_id, clients(name, group_id), engagement_types(name)")
    .order("period_end", { ascending: false })
    .limit(1000);
  if (ids) q = q.in("id", ids);
  if (!opts.includeArchived) q = q.neq("status", "archived");
  const [{ data }, { data: prog }] = await Promise.all([q, supabase.from("v_engagement_progress").select("*")]);
  const progress = new Map(((prog as EngagementProgress[]) ?? []).map((p) => [p.engagement_id, p]));
  return ((data as unknown as NavRow[]) ?? []).map((r) => {
    const p = progress.get(r.id);
    return {
      id: r.id,
      code: r.code,
      name: r.name,
      status: r.status,
      period_end: r.period_end,
      client_id: r.client_id,
      client_name: r.clients?.name ?? "Client",
      group_id: r.clients?.group_id ?? null,
      type_name: r.engagement_types?.name ?? "",
      pct_provided: Number(p?.pct_provided ?? 0),
      applicable: p?.applicable_items ?? 0,
      accepted: p?.accepted_items ?? 0,
      open_items: (p?.requested_items ?? 0) + (p?.queried_items ?? 0),
      overdue: p?.overdue_items ?? 0,
    };
  });
}

/** Group by client (entity), clients A-Z, engagements newest period first. */
export function groupByClient(rows: NavEngagement[]): NavGroup[] {
  const map = new Map<string, NavGroup>();
  for (const r of rows) {
    const g = map.get(r.client_id) ?? { key: r.client_id, label: r.client_name, items: [] };
    g.items.push(r);
    map.set(r.client_id, g);
  }
  return [...map.values()]
    .sort((a, b) => a.label.localeCompare(b.label))
    .map((g) => ({ ...g, items: g.items.sort((a, b) => b.period_end.localeCompare(a.period_end) || a.code.localeCompare(b.code)) }));
}

/** Engagement dates shown on the calendar. */
export function engagementMilestones(e: Pick<Engagement, "planned_start" | "documents_due" | "report_due" | "period_end">) {
  return [
    { date: e.planned_start, label: "Planned start" },
    { date: e.documents_due, label: "Documents due" },
    { date: e.report_due, label: "Report due" },
    { date: e.period_end, label: "Period end" },
  ];
}
