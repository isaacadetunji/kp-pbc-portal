"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  addDays, addMonths, endOfMonth, endOfWeek, format, isSameMonth, parseISO, startOfMonth, startOfWeek,
} from "date-fns";
import { CalendarPlus, ChevronLeft, ChevronRight, EyeOff, Flag, ListChecks, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ItemStatusBadge } from "@/components/status-badge";
import { createClient } from "@/lib/supabase/client";
import { EVENT_KIND, EVENT_KIND_ORDER } from "@/lib/constants";
import { fmtDate, lagosToday } from "@/lib/dates";
import type { EngagementEvent, EventKind, ItemStatus } from "@/lib/types";
import { cn, friendlyError } from "@/lib/utils";

export interface CalendarItem {
  id: string;
  code: string;
  title: string;
  status: ItemStatus;
  due_date: string | null;
}

type Entry =
  | { type: "event"; key: string; date: string; event: EngagementEvent }
  | { type: "milestone"; key: string; date: string; label: string }
  | { type: "items"; key: string; date: string; items: CalendarItem[] };

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const ymd = (d: Date) => format(d, "yyyy-MM-dd");
const OPEN: ItemStatus[] = ["requested", "queried", "submitted", "under_review"];

const EMPTY_FORM = { title: "", kind: "meeting" as EventKind, starts_on: "", ends_on: "", notes: "", visible_to_client: true };

export function EngagementCalendar({
  engagementId,
  audience,
  canEdit,
  events,
  items,
  milestones,
  itemHref,
}: {
  engagementId: string;
  audience: "team" | "client";
  canEdit: boolean;
  events: EngagementEvent[];
  items: CalendarItem[];
  milestones: { date: string | null; label: string }[];
  /** base href for opening a request item; "?item=<id>" style query is appended */
  itemHref: string;
}) {
  const router = useRouter();
  const today = lagosToday();
  const [month, setMonth] = useState(() => startOfMonth(parseISO(today)));
  const [dialog, setDialog] = useState<{ mode: "add" | "edit" | "view"; event?: EngagementEvent } | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [busy, setBusy] = useState(false);

  // Entries keyed by day (multi-day events appear on every day they span)
  const { byDay, all } = useMemo(() => {
    const list: Entry[] = [];
    for (const m of milestones) if (m.date) list.push({ type: "milestone", key: `m-${m.label}`, date: m.date, label: m.label });
    const due = new Map<string, CalendarItem[]>();
    for (const i of items) if (i.due_date && i.status !== "not_applicable") due.set(i.due_date, [...(due.get(i.due_date) ?? []), i]);
    for (const [date, list_] of due) list.push({ type: "items", key: `i-${date}`, date, items: list_ });
    for (const e of events) list.push({ type: "event", key: `e-${e.id}`, date: e.starts_on, event: e });
    const map = new Map<string, Entry[]>();
    for (const en of list) {
      const end = en.type === "event" && en.event.ends_on ? en.event.ends_on : en.date;
      let d = parseISO(en.date);
      for (let n = 0; n < 62 && ymd(d) <= end; n++, d = addDays(d, 1)) map.set(ymd(d), [...(map.get(ymd(d)) ?? []), en]);
    }
    const rank = { milestone: 0, event: 1, items: 2 } as const;
    map.forEach((v) => v.sort((a, b) => rank[a.type] - rank[b.type]));
    return { byDay: map, all: list.sort((a, b) => a.date.localeCompare(b.date) || rank[a.type] - rank[b.type]) };
  }, [events, items, milestones]);

  const weeks = useMemo(() => {
    const start = startOfWeek(startOfMonth(month), { weekStartsOn: 1 });
    const end = endOfWeek(endOfMonth(month), { weekStartsOn: 1 });
    const out: Date[][] = [];
    for (let d = start; d <= end; d = addDays(d, 7)) out.push(Array.from({ length: 7 }, (_, i) => addDays(d, i)));
    return out;
  }, [month]);

  const upcoming = all.filter((e) => (e.type === "event" && e.event.ends_on ? e.event.ends_on : e.date) >= today).slice(0, 14);

  function openAdd(date?: string) {
    setForm({ ...EMPTY_FORM, starts_on: date ?? today });
    setDialog({ mode: "add" });
  }
  function openEvent(e: EngagementEvent) {
    setForm({
      title: e.title, kind: e.kind, starts_on: e.starts_on, ends_on: e.ends_on ?? "", notes: e.notes ?? "", visible_to_client: e.visible_to_client,
    });
    setDialog({ mode: canEdit ? "edit" : "view", event: e });
  }

  async function save(ev: React.FormEvent) {
    ev.preventDefault();
    if (!form.title.trim() || !form.starts_on) return;
    if (form.ends_on && form.ends_on < form.starts_on) return toast.error("The end date can't be before the start date");
    setBusy(true);
    const supabase = createClient();
    const row = {
      title: form.title.trim(), kind: form.kind, starts_on: form.starts_on, ends_on: form.ends_on || null,
      notes: form.notes.trim() || null, visible_to_client: form.visible_to_client,
    };
    const { error } = dialog?.mode === "edit" && dialog.event
      ? await supabase.from("engagement_events").update(row).eq("id", dialog.event.id)
      : await supabase.from("engagement_events").insert({ ...row, engagement_id: engagementId });
    setBusy(false);
    if (error) return toast.error(friendlyError(error));
    toast.success(dialog?.mode === "edit" ? "Event updated" : "Event added to the calendar");
    setDialog(null);
    setMonth(startOfMonth(parseISO(form.starts_on)));
    router.refresh();
  }

  async function remove() {
    if (!dialog?.event || !confirm(`Delete "${dialog.event.title}"?`)) return;
    const { error } = await createClient().from("engagement_events").delete().eq("id", dialog.event.id);
    if (error) return toast.error(friendlyError(error));
    toast.success("Event deleted");
    setDialog(null);
    router.refresh();
  }

  const itemsPopover = (en: Extract<Entry, { type: "items" }>, trigger: React.ReactNode) => (
    <Popover key={en.key}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="start">
        <div className="border-b px-3 py-2 text-xs font-semibold text-muted-foreground">Requests due {fmtDate(en.date)}</div>
        <ul className="max-h-72 divide-y overflow-y-auto">
          {en.items.map((i) => (
            <li key={i.id}>
              <Link href={`${itemHref}${itemHref.includes("?") ? "&" : "?"}item=${i.id}`} className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted/60">
                {audience === "team" ? <span className="font-mono text-xs text-muted-foreground">{i.code}</span> : null}
                <span className="min-w-0 flex-1 truncate">{i.title}</span>
                <ItemStatusBadge status={i.status} audience={audience} />
              </Link>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );

  const openCount = (en: Extract<Entry, { type: "items" }>) => en.items.filter((i) => OPEN.includes(i.status)).length;

  const chip = (en: Entry, compact = false) => {
    if (en.type === "milestone") {
      return (
        <span key={en.key} className="flex items-center gap-1 truncate rounded bg-cyan-50 px-1.5 py-0.5 text-[11px] font-medium text-cyan-800" title={en.label}>
          <Flag className="size-3 shrink-0" /> <span className="truncate">{en.label}</span>
        </span>
      );
    }
    if (en.type === "items") {
      const label = `${en.items.length} request${en.items.length === 1 ? "" : "s"} due`;
      return itemsPopover(
        en,
        <button
          key={en.key}
          type="button"
          className={cn(
            "flex w-full items-center gap-1 truncate rounded px-1.5 py-0.5 text-left text-[11px] font-medium focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
            openCount(en) ? "bg-primary/10 text-primary hover:bg-primary/15" : "bg-success-soft text-success",
          )}
          aria-label={`${label} on ${fmtDate(en.date)}`}
        >
          <ListChecks className="size-3 shrink-0" /> <span className="truncate">{compact ? en.items.length : `${en.items.length} due`}</span>
        </button>,
      );
    }
    const k = EVENT_KIND[en.event.kind];
    return (
      <button
        key={en.key}
        type="button"
        onClick={() => openEvent(en.event)}
        className={cn("flex w-full items-center gap-1 truncate rounded px-1.5 py-0.5 text-left text-[11px] font-medium focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none", k.chip)}
        title={`${k.label}: ${en.event.title}`}
      >
        {!en.event.visible_to_client && audience === "team" ? <EyeOff className="size-3 shrink-0" aria-label="Team only" /> : null}
        <span className="truncate">{en.event.title}</span>
      </button>
    );
  };

  const dotClass = (en: Entry) =>
    en.type === "milestone" ? "bg-brand-accent" : en.type === "items" ? (openCount(en) ? "bg-primary" : "bg-success") : EVENT_KIND[en.event.kind].dot;

  return (
    <div className="grid gap-6 2xl:grid-cols-[minmax(0,1fr)_20rem]">
      <Card className="min-w-0">
        <CardHeader className="flex flex-row flex-wrap items-center gap-2 space-y-0">
          <CardTitle className="mr-auto text-lg" aria-live="polite">{format(month, "MMMM yyyy")}</CardTitle>
          <div className="flex items-center gap-1">
            <Button size="icon-sm" variant="outline" onClick={() => setMonth((m) => addMonths(m, -1))} aria-label="Previous month"><ChevronLeft /></Button>
            <Button size="sm" variant="outline" onClick={() => setMonth(startOfMonth(parseISO(today)))}>Today</Button>
            <Button size="icon-sm" variant="outline" onClick={() => setMonth((m) => addMonths(m, 1))} aria-label="Next month"><ChevronRight /></Button>
          </div>
          {canEdit ? <Button size="sm" onClick={() => openAdd()}><CalendarPlus /> Add event</Button> : null}
        </CardHeader>
        <CardContent className="space-y-3">
          <div role="grid" aria-label={`Calendar for ${format(month, "MMMM yyyy")}`} className="overflow-hidden rounded-lg border">
            <div role="row" className="grid grid-cols-7 border-b bg-muted/50">
              {WEEKDAYS.map((w) => (
                <div key={w} role="columnheader" className="px-1 py-1.5 text-center text-[11px] font-semibold text-muted-foreground sm:text-xs">
                  <span className="sm:hidden">{w[0]}</span><span className="hidden sm:inline">{w}</span>
                </div>
              ))}
            </div>
            {weeks.map((week) => (
              <div key={ymd(week[0]!)} role="row" className="grid grid-cols-7 border-b last:border-b-0">
                {week.map((d) => {
                  const key = ymd(d);
                  const entries = byDay.get(key) ?? [];
                  const inMonth = isSameMonth(d, month);
                  const isToday = key === today;
                  return (
                    <div
                      key={key}
                      role="gridcell"
                      aria-label={`${format(d, "EEEE d MMMM")}${entries.length ? `, ${entries.length} entr${entries.length === 1 ? "y" : "ies"}` : ""}`}
                      className={cn("min-h-14 min-w-0 border-r p-1 last:border-r-0 sm:min-h-24", !inMonth && "bg-muted/30")}
                    >
                      <div className="mb-0.5 flex items-center justify-between">
                        <span
                          className={cn(
                            "grid size-6 place-items-center rounded-full text-xs tabular",
                            isToday ? "bg-primary font-semibold text-primary-foreground" : inMonth ? "text-foreground" : "text-muted-foreground",
                          )}
                        >
                          {format(d, "d")}
                        </span>
                      </div>
                      {/* phones: coloured dots; larger screens: chips */}
                      <div className="flex flex-wrap gap-0.5 sm:hidden">
                        {entries.slice(0, 4).map((en) =>
                          en.type === "items" ? (
                            itemsPopover(en, <button key={en.key} type="button" className={cn("size-2 rounded-full", dotClass(en))} aria-label={`${en.items.length} requests due`} />)
                          ) : en.type === "event" ? (
                            <button key={en.key} type="button" onClick={() => openEvent(en.event)} className={cn("size-2 rounded-full", dotClass(en))} aria-label={en.event.title} />
                          ) : (
                            <span key={en.key} className={cn("size-2 rounded-full", dotClass(en))} title={en.label} />
                          ),
                        )}
                      </div>
                      <div className="hidden space-y-0.5 sm:block">
                        {entries.slice(0, 3).map((en) => chip(en))}
                        {entries.length > 3 ? <div className="px-1 text-[11px] text-muted-foreground">+{entries.length - 3} more</div> : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
          <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted-foreground" aria-label="Legend">
            <li className="flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-brand-accent" /> Engagement dates</li>
            <li className="flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-primary" /> Requests due</li>
            {EVENT_KIND_ORDER.map((k) => (
              <li key={k} className="flex items-center gap-1.5"><span className={cn("size-2.5 rounded-full", EVENT_KIND[k].dot)} /> {EVENT_KIND[k].label}</li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card className="h-fit">
        <CardHeader>
          <CardTitle className="text-base">Upcoming</CardTitle>
        </CardHeader>
        <CardContent>
          {upcoming.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing scheduled from today onwards.</p>
          ) : (
            <ol className="grid gap-3 md:grid-cols-2 2xl:grid-cols-1" aria-label="Upcoming dates">
              {upcoming.map((en) => (
                <li key={en.key} className="flex gap-3">
                  <div className="w-11 shrink-0 rounded-md border bg-card py-1 text-center">
                    <div className="text-[10px] font-semibold text-muted-foreground uppercase">{format(parseISO(en.date), "MMM")}</div>
                    <div className="text-base leading-tight font-semibold tabular">{format(parseISO(en.date), "d")}</div>
                  </div>
                  <div className="min-w-0 flex-1 text-sm">
                    {en.type === "milestone" ? (
                      <>
                        <div className="font-medium">{en.label}</div>
                        <div className="text-xs text-muted-foreground">Engagement date</div>
                      </>
                    ) : en.type === "items" ? (
                      itemsPopover(
                        en,
                        <button type="button" className="text-left">
                          <span className="block font-medium text-primary underline-offset-2 hover:underline">
                            {en.items.length} request{en.items.length === 1 ? "" : "s"} due
                          </span>
                          <span className="block text-xs text-muted-foreground">{openCount(en)} still open</span>
                        </button>,
                      )
                    ) : (
                      <button type="button" className="block w-full text-left" onClick={() => openEvent(en.event)}>
                        <span className="block font-medium underline-offset-2 hover:underline">{en.event.title}</span>
                        <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                          <span className={cn("size-2 rounded-full", EVENT_KIND[en.event.kind].dot)} />
                          {EVENT_KIND[en.event.kind].label}
                          {en.event.ends_on ? ` · until ${fmtDate(en.event.ends_on, "d MMM")}` : ""}
                          {!en.event.visible_to_client && audience === "team" ? <Badge variant="muted"><EyeOff /> Team only</Badge> : null}
                        </span>
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>

      <Dialog open={Boolean(dialog)} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{dialog?.mode === "add" ? "Add event" : dialog?.mode === "edit" ? "Edit event" : dialog?.event?.title}</DialogTitle>
            <DialogDescription>
              {dialog?.mode === "view"
                ? `${EVENT_KIND[dialog.event!.kind].label} · ${fmtDate(dialog.event!.starts_on)}${dialog.event!.ends_on ? ` to ${fmtDate(dialog.event!.ends_on)}` : ""}`
                : "Deadlines, regulatory filings, meetings and milestones for this engagement."}
            </DialogDescription>
          </DialogHeader>
          {dialog?.mode === "view" ? (
            <p className="text-sm whitespace-pre-wrap">{dialog.event?.notes || "No further details."}</p>
          ) : (
            <form onSubmit={save} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="ev-title">Title</Label>
                <Input id="ev-title" required maxLength={200} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. CIT return filing (FIRS)" autoFocus />
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <Label htmlFor="ev-kind">Type</Label>
                  <Select value={form.kind} onValueChange={(v) => setForm({ ...form, kind: v as EventKind })}>
                    <SelectTrigger id="ev-kind"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {EVENT_KIND_ORDER.map((k) => (
                        <SelectItem key={k} value={k}><span className={cn("size-2 rounded-full", EVENT_KIND[k].dot)} />{EVENT_KIND[k].label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ev-start">Date</Label>
                  <Input id="ev-start" type="date" required value={form.starts_on} onChange={(e) => setForm({ ...form, starts_on: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ev-end">End date (optional)</Label>
                  <Input id="ev-end" type="date" min={form.starts_on || undefined} value={form.ends_on} onChange={(e) => setForm({ ...form, ends_on: e.target.value })} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ev-notes">Notes</Label>
                <Textarea id="ev-notes" rows={3} maxLength={2000} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
              </div>
              <label className="flex items-start justify-between gap-4 rounded-lg border p-3">
                <span>
                  <span className="block text-sm font-medium">Visible to client</span>
                  <span className="block text-xs text-muted-foreground">Clients see it in their calendar, even before the request list is released.</span>
                </span>
                <Switch checked={form.visible_to_client} onCheckedChange={(v) => setForm({ ...form, visible_to_client: v })} aria-label="Visible to client" />
              </label>
              <DialogFooter className="gap-2">
                {dialog?.mode === "edit" ? (
                  <Button type="button" variant="ghost" className="mr-auto text-destructive" onClick={remove}><Trash2 /> Delete</Button>
                ) : null}
                <Button type="button" variant="ghost" onClick={() => setDialog(null)}>Cancel</Button>
                <Button type="submit" disabled={busy}>{dialog?.mode === "edit" ? "Save event" : "Add event"}</Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
