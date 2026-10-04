import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AdditionalDocuments } from "@/components/engagement/additional-documents";
import { AttachmentsPanel } from "@/components/engagement/attachments-panel";
import { EngagementCalendar } from "@/components/engagement/engagement-calendar";
import { EngagementHeader } from "@/components/engagement/engagement-header";
import { EngagementWorkspace } from "@/components/engagement/engagement-nav";
import { EngagementSettings } from "@/components/engagement/engagement-settings";
import { ProgressPanel } from "@/components/engagement/progress-panel";
import { RealtimeRefresh } from "@/components/engagement/realtime-refresh";
import { RequestList, type MasterOption } from "@/components/engagement/request-list";
import { TeamAccess } from "@/components/engagement/team-access";
import { loadAttachments, publicAttachment } from "@/lib/attachments";
import { requireStaff } from "@/lib/auth";
import { engagementMilestones, groupByClient, loadEngagement, loadEngagementNav, type ClientAccessRow } from "@/lib/engagement-data";
import { getUploadSettings } from "@/lib/settings";
import type { ClientContact, EngagementDocument, EngagementEvent, Person } from "@/lib/types";

export const metadata: Metadata = { title: "Engagement" };

const ALL_TABS = [
  { key: "requests", label: "Requests" },
  { key: "dashboard", label: "Dashboard" },
  { key: "documents", label: "Additional documents" },
  { key: "calendar", label: "Calendar" },
  { key: "team", label: "Team" },
  { key: "attachments", label: "Attachments" },
  { key: "settings", label: "Settings" },
];

export default async function EngagementPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; item?: string }>;
}) {
  const { id } = await params;
  const { tab: tabParam } = await searchParams;
  const { supabase, profile } = await requireStaff();
  const bundle = await loadEngagement(supabase, id);
  if (!bundle) notFound();
  const { engagement, client, type, folders, items, team, progress, folderProgress, fileCounts, commentCounts } = bundle;

  const [canManage, canAccept, isLead, canEdit, upload, navMine] = await Promise.all([
    supabase.rpc("can_manage_engagement", { p_engagement_id: id }).then((r) => Boolean(r.data)),
    supabase.rpc("can_accept_items", { p_engagement_id: id }).then((r) => Boolean(r.data)),
    supabase.rpc("is_engagement_lead", { p_engagement_id: id }).then((r) => Boolean(r.data)),
    supabase.rpc("can_edit_request_list", { p_engagement_id: id }).then((r) => Boolean(r.data)),
    getUploadSettings(),
    loadEngagementNav(supabase, { userId: profile.id, scope: "mine" }),
  ]);
  // Admins can open engagements they are not on; keep the current one in the list.
  let nav = navMine;
  if (!nav.some((n) => n.id === id)) {
    const all = await loadEngagementNav(supabase, { userId: profile.id, scope: "all", includeArchived: true });
    nav = [...nav, ...all.filter((n) => n.id === id)];
  }
  const tabs = ALL_TABS.filter((t) => t.key !== "settings" || canManage);
  const tab = tabs.some((t) => t.key === tabParam) ? tabParam! : "requests";
  const perms = { canManage, canAccept, isLead, canEdit };
  const allowed = upload.allowedExtensions;
  const maxMb = engagement.max_upload_mb ?? upload.maxFileMb;
  const base = `/engagements/${id}`;

  let content: React.ReactNode = null;

  if (tab === "requests") {
    const [{ data: updates }, { data: master }, { data: samples }] = await Promise.all([
      supabase.from("v_master_updates").select("request_item_id").eq("engagement_id", id),
      canManage
        ? supabase
            .from("master_checklist_items")
            .select("id, code, title, is_critical, master_categories(name, sort_order)")
            .eq("is_active", true)
            .order("sort_order")
        : Promise.resolve({ data: [] }),
      supabase.from("v_sample_progress").select("request_item_id, received_lines, total_lines, na_lines").eq("engagement_id", id),
    ]);
    const sampleProgress = Object.fromEntries(
      ((samples ?? []) as { request_item_id: string; received_lines: number; total_lines: number; na_lines: number }[]).map((s) => [
        s.request_item_id,
        { received: s.received_lines, total: s.total_lines - s.na_lines },
      ]),
    );
    const requester = team.find((t) => t.id === engagement.approval_requested_by);
    const existing = new Set(items.map((i) => i.code));
    const masterOptions: MasterOption[] = ((master ?? []) as unknown as {
      id: string; code: string; title: string; is_critical: boolean; master_categories: { name: string; sort_order: number } | null;
    }[])
      .filter((m) => !existing.has(m.code))
      .sort((a, b) => (a.master_categories?.sort_order ?? 0) - (b.master_categories?.sort_order ?? 0))
      .map((m) => ({ id: m.id, code: m.code, title: m.title, is_critical: m.is_critical, category: m.master_categories?.name ?? "" }));

    content = (
      <RequestList
        engagementId={id}
        engagementStatus={engagement.status}
        items={items}
        folders={folders}
        team={team}
        fileCounts={fileCounts}
        commentCounts={commentCounts}
        perms={perms}
        userId={profile.id}
        upload={{ allowedExtensions: allowed, maxFileMb: maxMb }}
        masterUpdates={updates?.length ?? 0}
        masterOptions={masterOptions}
        sampleProgress={sampleProgress}
        approval={{ requestedByName: requester?.full_name, requestedAt: engagement.approval_requested_at }}
      />
    );
  } else if (tab === "dashboard") {
    content = (
      <ProgressPanel
        progress={progress}
        folders={folderProgress}
        items={items}
        audience="team"
        hrefFor={(i) => `${base}?tab=requests&item=${i.id}`}
      />
    );
  } else if (tab === "documents") {
    const { data } = await supabase.from("engagement_documents").select("*").eq("engagement_id", id).order("created_at", { ascending: false });
    const docs = (data as EngagementDocument[]) ?? [];
    const ids = [...new Set(docs.flatMap((d) => [d.uploaded_by, d.deleted_by]).filter(Boolean) as string[])];
    const { data: people } = ids.length ? await supabase.from("profiles").select("id, full_name, email").in("id", ids) : { data: [] };
    const names = Object.fromEntries(((people ?? []) as Person[]).map((p) => [p.id, p.full_name || p.email]));
    content = (
      <AdditionalDocuments
        engagementId={id}
        audience="team"
        userId={profile.id}
        documents={docs}
        names={names}
        canManage={canManage}
        canUpload={!["archived", "declined"].includes(engagement.status)}
        upload={{ allowedExtensions: allowed, maxFileMb: maxMb }}
      />
    );
  } else if (tab === "calendar") {
    const { data } = await supabase.from("engagement_events").select("*").eq("engagement_id", id).order("starts_on");
    content = (
      <EngagementCalendar
        engagementId={id}
        audience="team"
        canEdit={engagement.status !== "archived"}
        events={(data as EngagementEvent[]) ?? []}
        items={items.map((i) => ({ id: i.id, code: i.code, title: i.title, status: i.status, due_date: i.due_date }))}
        milestones={engagementMilestones(engagement)}
        itemHref={`${base}?tab=requests`}
      />
    );
  } else if (tab === "team") {
    const [{ data: staff }, { data: access }, { data: contacts }] = await Promise.all([
      supabase.from("profiles").select("id, full_name, email, app_role").in("app_role", ["super_admin", "admin", "staff"]).eq("is_active", true).order("full_name"),
      supabase
        .from("engagement_client_access")
        .select("id, invited_at, first_login_at, revoked_at, contact:contact_id(*)")
        .eq("engagement_id", id)
        .order("invited_at"),
      supabase.from("client_contacts").select("*").eq("client_id", engagement.client_id).order("full_name"),
    ]);
    content = (
      <TeamAccess
        engagementId={id}
        team={team}
        staff={(staff as Person[]) ?? []}
        access={(access as unknown as ClientAccessRow[]) ?? []}
        contacts={(contacts as ClientContact[]) ?? []}
        canManage={canManage}
        isDraft={engagement.status === "draft" || engagement.status === "awaiting_approval"}
      />
    );
  } else if (tab === "attachments") {
    const rows = await loadAttachments(supabase, id, "client");
    content = <AttachmentsPanel engagementId={id} side="client" rows={rows.map(publicAttachment)} itemHref={`${base}?tab=requests`} />;
  } else {
    content = <EngagementSettings engagement={engagement} canManage={canManage} firmMaxMb={upload.maxFileMb} />;
  }

  return (
    <EngagementWorkspace groups={groupByClient(nav)} activeId={id} hrefBase="/engagements">
      <RealtimeRefresh engagementId={id} />
      <EngagementHeader engagement={engagement} client={client} type={type} basePath={base} tab={tab} tabs={tabs} />
      <div className="pt-2">{content}</div>
    </EngagementWorkspace>
  );
}
