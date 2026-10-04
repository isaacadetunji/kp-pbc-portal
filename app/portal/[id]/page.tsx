import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarDays, ChevronLeft, Hourglass, Users } from "lucide-react";
import { AdditionalDocuments } from "@/components/engagement/additional-documents";
import { ActiveTabScroller } from "@/components/engagement/active-tab-scroller";
import { AttachmentsPanel } from "@/components/engagement/attachments-panel";
import { EngagementCalendar } from "@/components/engagement/engagement-calendar";
import { EngagementWorkspace } from "@/components/engagement/engagement-nav";
import { ProgressPanel } from "@/components/engagement/progress-panel";
import { RealtimeRefresh } from "@/components/engagement/realtime-refresh";
import { TeamAccess } from "@/components/engagement/team-access";
import { PortalRequestList } from "@/components/portal/portal-request-list";
import { EngagementStatusBadge } from "@/components/status-badge";
import { Alert } from "@/components/ui/alert";
import { loadAttachments, publicAttachment } from "@/lib/attachments";
import { requireClient } from "@/lib/auth";
import { fmtDate } from "@/lib/dates";
import { engagementMilestones, groupByClient, isReleased, loadEngagement, loadEngagementNav, type ClientAccessRow } from "@/lib/engagement-data";
import { getUploadSettings } from "@/lib/settings";
import type { EngagementDocument, EngagementEvent } from "@/lib/types";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Information request" };

const TABS = [
  { key: "requests", label: "Requests", prep: false },
  { key: "dashboard", label: "Dashboard", prep: false },
  { key: "documents", label: "Additional documents", prep: false },
  { key: "calendar", label: "Calendar", prep: true },
  { key: "team", label: "Team", prep: true },
  { key: "attachments", label: "Attachments", prep: false },
];

export default async function PortalEngagementPage({
  params, searchParams,
}: { params: Promise<{ id: string }>; searchParams: Promise<{ view?: string; tab?: string }> }) {
  const { id } = await params;
  const { view, tab: tabParam } = await searchParams;
  const { supabase, profile } = await requireClient();
  const bundle = await loadEngagement(supabase, id);
  if (!bundle) notFound();
  await supabase.rpc("touch_client_access", { p_engagement_id: id });
  const { engagement, client, type, folders, items, team, progress, folderProgress, fileCounts, commentCounts } = bundle;
  const released = isReleased(engagement.status);
  const [upload, nav] = await Promise.all([getUploadSettings(), loadEngagementNav(supabase, { userId: profile.id, scope: "all" })]);
  const maxMb = engagement.max_upload_mb ?? upload.maxFileMb;
  const base = `/portal/${id}`;

  // ?view=summary is the old link to the progress view
  const requested = tabParam ?? (view === "summary" ? "dashboard" : undefined);
  const available = TABS.filter((t) => released || t.prep);
  const tab = available.some((t) => t.key === requested) ? requested! : released ? "requests" : "calendar";

  let content: React.ReactNode = null;
  if (tab === "requests") {
    content = (
      <PortalRequestList
        engagementId={id}
        engagementStatus={engagement.status}
        items={items}
        folders={folders}
        team={team}
        progress={progress}
        fileCounts={fileCounts}
        commentCounts={commentCounts}
        userId={profile.id}
        upload={{ allowedExtensions: upload.allowedExtensions, maxFileMb: maxMb }}
      />
    );
  } else if (tab === "dashboard") {
    content = <ProgressPanel progress={progress} folders={folderProgress} items={items} audience="client" hrefFor={(i) => `${base}?tab=requests&item=${i.id}`} />;
  } else if (tab === "documents") {
    const { data } = await supabase.from("engagement_documents").select("*").eq("engagement_id", id).order("created_at", { ascending: false });
    const { data: peers } = await supabase.from("client_contacts").select("user_id, full_name").not("user_id", "is", null);
    const names: Record<string, string> = Object.fromEntries(team.map((t) => [t.id, t.full_name]));
    for (const p of (peers ?? []) as { user_id: string; full_name: string }[]) names[p.user_id] ??= p.full_name;
    content = (
      <AdditionalDocuments
        engagementId={id}
        audience="client"
        userId={profile.id}
        documents={(data as EngagementDocument[]) ?? []}
        names={names}
        canManage={false}
        canUpload={!["archived", "declined", "completed"].includes(engagement.status)}
        upload={{ allowedExtensions: upload.allowedExtensions, maxFileMb: maxMb }}
        closedReason="This engagement is closed, so documents can no longer be added."
      />
    );
  } else if (tab === "calendar") {
    const { data } = await supabase.from("engagement_events").select("*").eq("engagement_id", id).order("starts_on");
    content = (
      <EngagementCalendar
        engagementId={id}
        audience="client"
        canEdit={false}
        events={(data as EngagementEvent[]) ?? []}
        items={items.map((i) => ({ id: i.id, code: i.code, title: i.title, status: i.status, due_date: i.due_date }))}
        milestones={engagementMilestones(engagement)}
        itemHref={`${base}?tab=requests`}
      />
    );
  } else if (tab === "team") {
    const { data: access } = await supabase
      .from("engagement_client_access")
      .select("id, invited_at, first_login_at, revoked_at, contact:contact_id(*)")
      .eq("engagement_id", id)
      .is("revoked_at", null)
      .order("invited_at");
    content = (
      <TeamAccess
        engagementId={id}
        team={team}
        staff={[]}
        access={((access as unknown as ClientAccessRow[]) ?? []).filter((a) => a.contact)}
        contacts={[]}
        canManage={false}
        isDraft={!released}
        audience="client"
      />
    );
  } else if (tab === "attachments") {
    const rows = await loadAttachments(supabase, id, "firm");
    content = <AttachmentsPanel engagementId={id} side="firm" rows={rows.map(publicAttachment)} itemHref={`${base}?tab=requests`} />;
  }

  return (
    <EngagementWorkspace groups={groupByClient(nav)} activeId={id} hrefBase="/portal" audience="client">
      <RealtimeRefresh engagementId={id} />
      <div className="space-y-2">
        <Link href="/portal" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ChevronLeft className="size-3" /> All engagements
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold sm:text-2xl">{client.name}</h1>
          <EngagementStatusBadge status={engagement.status} audience="client" />
        </div>
        <p className="text-sm text-muted-foreground">
          {engagement.name} · {type?.name} · {engagement.code} · period to {fmtDate(engagement.period_end)}
        </p>
        {team.length ? (
          <p className="text-xs text-muted-foreground">Your engagement team: {team.map((t) => t.full_name).join(", ")}</p>
        ) : null}
      </div>

      {!released ? (
        <Alert variant="info">
          <Hourglass />
          <div>
            <div className="font-medium">Being prepared</div>
            <div className="text-sm">
              {team.find((t) => t.team_role === "lead")?.full_name ?? "The engagement team"} and the team are preparing the information request for this engagement.
              You&apos;ll be notified as soon as it&apos;s released. Meanwhile you can see who is on the team and the key dates.
            </div>
          </div>
        </Alert>
      ) : null}

      <nav className="flex gap-1 overflow-x-auto border-b" aria-label="Engagement sections">
        {(released ? TABS : [...TABS.filter((t) => t.prep), ...TABS.filter((t) => !t.prep)]).map((t) => {
          const enabled = released || t.prep;
          const cls = "-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap";
          return enabled ? (
            <Link
              key={t.key}
              href={`${base}?tab=${t.key}`}
              scroll={false}
              aria-current={tab === t.key ? "page" : undefined}
              className={cn(cls, tab === t.key ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}
            >
              {t.key === "team" ? <Users className="size-3.5" /> : t.key === "calendar" ? <CalendarDays className="size-3.5" /> : null}
              {t.label}
            </Link>
          ) : (
            <span key={t.key} aria-disabled="true" title="Available once the request list is released" className={cn(cls, "cursor-not-allowed border-transparent text-muted-foreground/50")}>
              {t.label}
            </span>
          );
        })}
      </nav>
      <ActiveTabScroller />
      <div>{content}</div>
    </EngagementWorkspace>
  );
}
