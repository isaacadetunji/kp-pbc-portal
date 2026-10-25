/**
 * Branded e-mail templates (HTML + plain text). Pure functions so they can be
 * rendered in tests or previews. Table layout and inline styles for e-mail
 * clients (Outlook included).
 */
import { ITEM_STATUS } from "@/lib/constants";
import type { ItemStatus } from "@/lib/types";

export interface EmailBrand {
  firmName: string;
  portalName: string;
  primary: string;
  accent: string;
  /** Absolute URL of the logo */
  logoUrl: string | null;
  siteUrl: string;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function absUrl(brand: EmailBrand, link: string | null | undefined): string {
  if (!link) return brand.siteUrl;
  if (/^https?:\/\//i.test(link)) return link;
  return `${brand.siteUrl.replace(/\/$/, "")}${link.startsWith("/") ? "" : "/"}${link}`;
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return "";
  const dt = new Date(/^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d}T12:00:00Z` : d);
  if (Number.isNaN(dt.getTime())) return d;
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Lagos" }).format(dt);
}

function lagosToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos" }).format(now);
}

interface LayoutInput {
  brand: EmailBrand;
  preheader: string;
  heading: string;
  greeting: string;
  introHtml: string;
  bodyHtml?: string;
  cta?: { label: string; url: string };
  footerNote: string;
}

function layout(i: LayoutInput): string {
  const { brand } = i;
  const logo = brand.logoUrl
    ? `<img src="${esc(brand.logoUrl)}" alt="${esc(brand.firmName)}" height="32" style="display:block;height:32px;width:auto;border:0;outline:none" />`
    : `<span style="font-size:18px;font-weight:700;color:${esc(brand.primary)}">${esc(brand.firmName)}</span>`;
  const cta = i.cta
    ? `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:24px 0 8px"><tr><td style="border-radius:6px;background:${esc(brand.primary)}">
         <a href="${esc(i.cta.url)}" style="display:inline-block;padding:12px 22px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:6px">${esc(i.cta.label)}</a>
       </td></tr></table>`
    : "";
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(i.heading)}</title></head>
<body style="margin:0;padding:0;background:#f3f6f8;font-family:Segoe UI,Helvetica,Arial,sans-serif;color:#1f2933">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(i.preheader)}</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f3f6f8"><tr><td align="center" style="padding:24px 12px">
  <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:8px;overflow:hidden;border:1px solid #e3e8ec">
    <tr><td style="height:4px;background:${esc(brand.primary)};font-size:0;line-height:0">&nbsp;</td></tr>
    <tr><td style="padding:20px 28px 0">${logo}
      <div style="margin-top:4px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#6b7785">${esc(brand.portalName)}</div></td></tr>
    <tr><td style="padding:20px 28px 8px">
      <h1 style="margin:0 0 12px;font-size:20px;line-height:1.3;color:#102a43">${esc(i.heading)}</h1>
      <p style="margin:0 0 12px;font-size:15px;line-height:1.5">${esc(i.greeting)}</p>
      <div style="font-size:15px;line-height:1.5">${i.introHtml}</div>
      ${i.bodyHtml ?? ""}
      ${cta}
    </td></tr>
    <tr><td style="padding:16px 28px 24px;border-top:1px solid #e3e8ec;font-size:12px;line-height:1.5;color:#6b7785">
      ${esc(i.footerNote)}<br>
      <span style="color:${esc(brand.accent)};font-weight:600">${esc(brand.firmName)}</span> · ${esc(brand.portalName)} · <a href="${esc(brand.siteUrl)}" style="color:#6b7785">${esc(brand.siteUrl.replace(/^https?:\/\//, ""))}</a>
    </td></tr>
  </table>
</td></tr></table>
</body></html>`;
}

function textLayout(lines: (string | null | undefined | false)[], brand: EmailBrand, footer: string): string {
  return [...lines.filter((l): l is string => typeof l === "string"), "", "--", footer, `${brand.firmName} · ${brand.portalName}`, brand.siteUrl].join("\n");
}

const FOOTER_TEAM = "You receive these e-mails as a member of the engagement team. A partner, the team lead or a manager can change them in the engagement's Settings tab.";
const FOOTER_CLIENT = "You receive these e-mails because you have access to this engagement on the portal. Please do not reply with documents: upload them on the portal so they are kept securely.";

function firstName(name: string | null | undefined, email: string): string {
  const n = (name ?? "").trim();
  return n ? n.split(/\s+/)[0]! : email;
}

// ---------------------------------------------------------------------------
// Instant notifications (one e-mail per person per run; several grouped)
// ---------------------------------------------------------------------------
export interface InstantNotification {
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  engagement_code: string | null;
  engagement_name: string | null;
  created_at: string;
}

type Category = "released" | "query" | "assigned" | "uploaded" | "comment" | "mention" | "update";

export function categoryOf(type: string): Category {
  switch (type) {
    case "request_list_issued":
      return "released";
    case "item_queried":
    case "sample_queried":
      return "query";
    case "item_assigned":
    case "items_assigned":
    case "assigned":
      return "assigned";
    case "item_submitted":
    case "document_uploaded":
    case "document_shared":
    case "firm_document":
    case "sample_provided":
      return "uploaded";
    case "mention":
      return "mention";
    case "comment":
      return "comment";
    default:
      return "update";
  }
}

const CATEGORY_HEADING: Record<Category, { one: string; label: string }> = {
  released: { one: "A new information request is ready", label: "New request list" },
  query: { one: "A query has been raised", label: "Query raised" },
  assigned: { one: "Items have been assigned to you", label: "Assigned to you" },
  uploaded: { one: "New documents have been uploaded", label: "Uploaded" },
  comment: { one: "New comment", label: "Comment" },
  mention: { one: "You were mentioned", label: "Mention" },
  update: { one: "Update on your engagement", label: "Update" },
};

export function renderInstantEmail(input: {
  brand: EmailBrand;
  recipient: { name: string | null; email: string; isClient: boolean };
  notifications: InstantNotification[];
}): RenderedEmail {
  const { brand, recipient } = input;
  const items = [...input.notifications].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const single = items.length === 1;
  const first = items[0]!;
  const cat = categoryOf(first.type);
  const subject = single
    ? first.title
    : `${items.length} updates on ${brand.portalName}${new Set(items.map((n) => n.engagement_code)).size === 1 && first.engagement_code ? ` · ${first.engagement_code}` : ""}`;
  const heading = single ? CATEGORY_HEADING[cat].one : `You have ${items.length} updates`;
  const greeting = `Dear ${firstName(recipient.name, recipient.email)},`;

  const rowHtml = (n: InstantNotification) => `
    <tr><td style="padding:12px 0;border-top:1px solid #e3e8ec">
      <div style="font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:${esc(brand.accent)}">${esc(CATEGORY_HEADING[categoryOf(n.type)].label)}${n.engagement_code ? ` · ${esc(n.engagement_code)}` : ""}</div>
      <div style="margin-top:2px;font-size:15px;font-weight:600"><a href="${esc(absUrl(brand, n.link))}" style="color:#102a43;text-decoration:none">${esc(n.title)}</a></div>
      ${n.body ? `<div style="margin-top:4px;font-size:14px;line-height:1.5;color:#3e4c59;white-space:pre-wrap">${esc(n.body)}</div>` : ""}
    </td></tr>`;

  const intro = single
    ? first.engagement_name
      ? `<p style="margin:0">On <strong>${esc(first.engagement_name)}</strong>${first.engagement_code ? ` (${esc(first.engagement_code)})` : ""}:</p>`
      : ""
    : `<p style="margin:0">Here is what happened on the portal since our last e-mail.</p>`;
  const bodyHtml = `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:12px">${items.map(rowHtml).join("")}</table>`;
  const ctaUrl = absUrl(brand, single ? first.link : recipient.isClient ? "/portal/notifications" : "/notifications");
  const cta = { label: single ? (recipient.isClient ? "Open on the portal" : "Open in the portal") : "View all notifications", url: ctaUrl };
  const footer = recipient.isClient ? FOOTER_CLIENT : FOOTER_TEAM;

  const html = layout({ brand, preheader: single ? first.body ?? first.title : subject, heading, greeting, introHtml: intro, bodyHtml, cta, footerNote: footer });
  const text = textLayout(
    [
      greeting,
      "",
      single ? (first.engagement_name ? `On ${first.engagement_name}${first.engagement_code ? ` (${first.engagement_code})` : ""}:` : "") : "Here is what happened on the portal since our last e-mail:",
      "",
      ...items.flatMap((n) => [
        `* ${CATEGORY_HEADING[categoryOf(n.type)].label}${n.engagement_code ? ` (${n.engagement_code})` : ""}: ${n.title}`,
        ...(n.body ? n.body.split("\n").map((l) => `  ${l}`) : []),
        `  ${absUrl(brand, n.link)}`,
        "",
      ]),
      `${cta.label}: ${cta.url}`,
    ],
    brand,
    footer,
  );
  return { subject, html, text };
}

// ---------------------------------------------------------------------------
// Reminder digests
// ---------------------------------------------------------------------------
export interface DigestItem {
  id: string;
  code: string;
  title: string;
  status: ItemStatus;
  due_date: string | null;
  is_critical: boolean;
  priority: string;
  folder: string;
  submitted_at?: string | null;
}

const MAX_LISTED = 50;

export function renderReminderEmail(input: {
  brand: EmailBrand;
  audience: "client" | "team";
  recipient: { name: string | null; email: string };
  engagement: { id: string; code: string; name: string; clientName: string };
  items: DigestItem[];
  now?: Date;
}): RenderedEmail {
  const { brand, audience, recipient, engagement } = input;
  const today = lagosToday(input.now);
  const items = input.items;
  const n = items.length;
  const isClient = audience === "client";
  const overdue = items.filter((i) => i.due_date && i.due_date < today && (i.status === "requested" || i.status === "queried")).length;
  const queried = items.filter((i) => i.status === "queried").length;

  const subject = isClient
    ? n > 0
      ? `Reminder: ${n} item${n === 1 ? "" : "s"} outstanding — ${engagement.name}`
      : `Status update: nothing outstanding — ${engagement.name}`
    : `${n} client submission${n === 1 ? "" : "s"} awaiting review — ${engagement.code}`;
  const heading = isClient
    ? n > 0 ? "Items we still need from you" : "You are up to date"
    : "Client submissions awaiting review";
  const greeting = `Dear ${firstName(recipient.name, recipient.email)},`;

  const summary = isClient
    ? n > 0
      ? `For <strong>${esc(engagement.name)}</strong> (${esc(engagement.code)}) we are still waiting for <strong>${n}</strong> item${n === 1 ? "" : "s"}${queried ? `, including <strong>${queried}</strong> with a query that needs your action` : ""}${overdue ? `. <span style="color:#b42318;font-weight:600">${overdue} ${overdue === 1 ? "is" : "are"} past the due date.</span>` : "."}`
      : `There is nothing outstanding on <strong>${esc(engagement.name)}</strong> (${esc(engagement.code)}) at the moment. Thank you.`
    : `<strong>${esc(engagement.clientName)}</strong> has submitted <strong>${n}</strong> item${n === 1 ? "" : "s"} on ${esc(engagement.code)} (${esc(engagement.name)}) that ${n === 1 ? "is" : "are"} waiting for review.`;

  const listed = items.slice(0, MAX_LISTED);
  const statusLabel = (s: ItemStatus) => (isClient ? ITEM_STATUS[s]?.clientLabel : ITEM_STATUS[s]?.label) ?? s;
  const rows = listed
    .map((i) => {
      const late = i.due_date && i.due_date < today && (i.status === "requested" || i.status === "queried");
      const meta = [
        statusLabel(i.status),
        i.is_critical ? "Critical" : null,
        isClient && i.due_date ? `Due ${fmtDate(i.due_date)}` : null,
        !isClient && i.submitted_at ? `Submitted ${fmtDate(i.submitted_at)}` : null,
      ].filter(Boolean).join(" · ");
      return `<tr>
        <td style="padding:8px 8px 8px 0;border-top:1px solid #e3e8ec;font-family:Consolas,Menlo,monospace;font-size:12px;color:#6b7785;vertical-align:top;white-space:nowrap">${esc(i.code)}</td>
        <td style="padding:8px 0;border-top:1px solid #e3e8ec;font-size:14px;vertical-align:top">
          <div style="font-weight:600;color:#102a43">${esc(i.title)}</div>
          <div style="font-size:12px;color:${late ? "#b42318" : "#6b7785"}">${esc(i.folder)} · ${esc(meta)}${late ? " · Overdue" : ""}</div>
        </td></tr>`;
    })
    .join("");
  const more = n > MAX_LISTED ? `<p style="margin:8px 0 0;font-size:13px;color:#6b7785">…and ${n - MAX_LISTED} more on the portal.</p>` : "";
  const bodyHtml = n > 0 ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:16px">${rows}</table>${more}` : "";
  const cta = {
    label: isClient ? (n > 0 ? "Upload on the portal" : "Open the portal") : "Review submissions",
    url: absUrl(brand, isClient ? `/portal/${engagement.id}` : `/engagements/${engagement.id}`),
  };
  const footer = isClient ? FOOTER_CLIENT : FOOTER_TEAM;
  const html = layout({
    brand, preheader: subject, heading, greeting,
    introHtml: `<p style="margin:0">${summary}</p>`, bodyHtml, cta, footerNote: footer,
  });
  const plainSummary = summary.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  const text = textLayout(
    [
      greeting,
      "",
      plainSummary,
      "",
      ...listed.map((i) => {
        const late = i.due_date && i.due_date < today && (i.status === "requested" || i.status === "queried");
        return `* ${i.code} ${i.title} [${i.folder}; ${statusLabel(i.status)}${i.is_critical ? "; Critical" : ""}${isClient && i.due_date ? `; due ${fmtDate(i.due_date)}` : ""}${late ? "; OVERDUE" : ""}]`;
      }),
      n > MAX_LISTED ? `...and ${n - MAX_LISTED} more on the portal.` : null,
      "",
      `${cta.label}: ${cta.url}`,
    ],
    brand,
    footer,
  );
  return { subject, html, text };
}

/** A small test message for Settings > Notifications. */
export function renderTestEmail(brand: EmailBrand, name: string | null, email: string): RenderedEmail {
  const subject = `Test e-mail from ${brand.portalName}`;
  const greeting = `Dear ${firstName(name, email)},`;
  const intro = "This is a test message. If you can read it, e-mail notifications from the portal are working.";
  return {
    subject,
    html: layout({ brand, preheader: intro, heading: "E-mail is working", greeting, introHtml: `<p style="margin:0">${esc(intro)}</p>`, cta: { label: "Open the portal", url: brand.siteUrl }, footerNote: "Sent from Settings > Notifications." }),
    text: textLayout([greeting, "", intro, "", brand.siteUrl], brand, "Sent from Settings > Notifications."),
  };
}
