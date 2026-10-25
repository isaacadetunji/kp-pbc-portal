"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { AtSign, Eye, Lock, MessageSquare, Reply, Send, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { createClient } from "@/lib/supabase/client";
import { fmtDateTime } from "@/lib/dates";
import type { Comment, Person } from "@/lib/types";
import { cn, friendlyError, initials } from "@/lib/utils";

export function CommentThread({
  itemId,
  userId,
  audience,
  team,
  refreshKey,
  sampleLineId,
  compact,
  canPost = true,
}: {
  itemId: string;
  userId: string;
  audience: "team" | "client";
  team: Person[];
  refreshKey?: number;
  /** When set, the thread is for one sample line; otherwise item-level only. */
  sampleLineId?: string;
  compact?: boolean;
  /** False for read-only viewers (can see the engagement but are not on its team). */
  canPost?: boolean;
}) {
  const supabase = createClient();
  const [comments, setComments] = useState<Comment[]>([]);
  const [people, setPeople] = useState<Record<string, Person>>({});
  const [body, setBody] = useState("");
  const [internal, setInternal] = useState(false);
  const [mentions, setMentions] = useState<Person[]>([]);
  const [replyTo, setReplyTo] = useState<Comment | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    let query = supabase
      .from("comments")
      .select("*")
      .eq("request_item_id", itemId)
      .is("deleted_at", null)
      .order("created_at");
    query = sampleLineId ? query.eq("sample_line_id", sampleLineId) : query.is("sample_line_id", null);
    const { data } = await query;
    const rows = (data as Comment[]) ?? [];
    setComments(rows);
    const ids = [...new Set(rows.map((c) => c.author_id))].filter((id) => !people[id]);
    if (ids.length) {
      const { data: ps } = await supabase.from("profiles").select("id, full_name, email, app_role").in("id", ids);
      setPeople((prev) => ({ ...prev, ...Object.fromEntries(((ps as Person[]) ?? []).map((p) => [p.id, p])) }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId, sampleLineId, supabase]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  useEffect(() => {
    const ch = supabase
      .channel(`comments:${itemId}:${sampleLineId ?? "item"}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "comments", filter: `request_item_id=eq.${itemId}` }, () => load())
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [itemId, load, supabase]);

  const threads = useMemo(() => {
    const roots = comments.filter((c) => !c.parent_id);
    return roots.map((r) => ({ root: r, replies: comments.filter((c) => c.parent_id === r.id) }));
  }, [comments]);

  async function post(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    setBusy(true);
    const { error } = await supabase.from("comments").insert({
      request_item_id: itemId,
      author_id: userId,
      body: body.trim(),
      is_internal: audience === "team" ? internal || Boolean(replyTo?.is_internal) : false,
      parent_id: replyTo?.id ?? null,
      sample_line_id: sampleLineId ?? null,
      mentions: mentions.map((m) => m.id),
    });
    setBusy(false);
    if (error) return toast.error(friendlyError(error));
    setBody("");
    setMentions([]);
    setReplyTo(null);
    load();
  }

  function addMention(p: Person) {
    if (!mentions.find((m) => m.id === p.id)) setMentions((m) => [...m, p]);
    setBody((b) => `${b}${b && !b.endsWith(" ") ? " " : ""}@${p.full_name || p.email} `);
  }

  const nameOf = (id: string) => {
    if (id === userId) return "You";
    const p = people[id] ?? team.find((t) => t.id === id);
    if (p) return p.full_name || p.email;
    return audience === "client" ? "Engagement team" : "Client";
  };
  const isStaffAuthor = (id: string) => {
    const p = people[id] ?? team.find((t) => t.id === id);
    return p ? p.app_role !== "client" : audience === "client";
  };

  function Bubble({ c }: { c: Comment }) {
    return (
      <div className={cn("flex gap-3", c.is_internal && "rounded-lg border border-warning/15 bg-warning-soft/60 p-2.5")}>
        <span
          className={cn(
            "grid size-8 shrink-0 place-items-center rounded-full text-xs font-semibold",
            isStaffAuthor(c.author_id) ? "bg-primary text-primary-foreground" : "bg-client-soft text-client",
          )}
        >
          {initials(nameOf(c.author_id))}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-sm font-semibold">{nameOf(c.author_id)}</span>
            <span className="text-xs text-muted-foreground">{fmtDateTime(c.created_at)}</span>
            {c.is_internal ? (
              <Badge variant="warning">
                <Lock /> Internal
              </Badge>
            ) : null}
            {c.edited_at ? <span className="text-xs text-muted-foreground">(edited)</span> : null}
          </div>
          <p className="mt-1 text-sm leading-relaxed whitespace-pre-wrap break-words text-foreground/90">{c.body}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {threads.length === 0 ? (
        compact ? (
          <p className="text-xs text-muted-foreground">No comments on this line yet.</p>
        ) : (
          <div className="flex flex-col items-center gap-1 rounded-lg border border-dashed py-6 text-center text-sm text-muted-foreground">
            <MessageSquare className="size-5" />
            No comments yet.{" "}
            {audience === "client" ? "Use this to explain anything about the documents you provide." : "Add context or clarify what is needed."}
          </div>
        )
      ) : (
        <ul className="space-y-4">
          {threads.map(({ root, replies }) => (
            <li key={root.id} className="space-y-3">
              <Bubble c={root} />
              {replies.length ? (
                <ul className="ml-11 space-y-3 border-l pl-4">
                  {replies.map((r) => (
                    <li key={r.id}>
                      <Bubble c={r} />
                    </li>
                  ))}
                </ul>
              ) : null}
              {canPost ? (
                <button onClick={() => setReplyTo(root)} className="ml-11 flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                  <Reply className="size-3" /> Reply
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {canPost ? (
      <form onSubmit={post} className="space-y-2 rounded-xl border bg-card p-3 shadow-xs focus-within:border-ring/60 focus-within:ring-[3px] focus-within:ring-ring/20">
        {replyTo ? (
          <div className="flex items-center justify-between rounded bg-muted px-2 py-1 text-xs">
            <span className="truncate">
              Replying to {nameOf(replyTo.author_id)}
              {replyTo.is_internal ? " (internal thread)" : ""}
            </span>
            <button type="button" onClick={() => setReplyTo(null)} aria-label="Cancel reply">
              <X className="size-3" />
            </button>
          </div>
        ) : null}
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={audience === "client" ? "Write a comment for the engagement team…" : "Write a comment… use @ to mention a colleague"}
          rows={compact ? 2 : 3}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) post(e);
          }}
        />
        <div className="flex flex-wrap items-center gap-2">
          {audience === "team" ? (
            <>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button type="button" variant="ghost" size="sm">
                    <AtSign /> Mention
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuLabel>Engagement team</DropdownMenuLabel>
                  {team.filter((t) => t.id !== userId).map((t) => (
                    <DropdownMenuItem key={t.id} onSelect={() => addMention(t)}>
                      {t.full_name || t.email}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <Switch checked={internal || Boolean(replyTo?.is_internal)} disabled={Boolean(replyTo?.is_internal)} onCheckedChange={setInternal} />
                <Lock className="size-3" /> Internal only (hidden from client)
              </label>
            </>
          ) : null}
          <div className="flex-1" />
          <Button type="submit" size="sm" disabled={busy || !body.trim()}>
            <Send /> Post
          </Button>
        </div>
      </form>
      ) : (
        <p className="flex items-center gap-2 rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground">
          <Eye className="size-3.5 shrink-0" /> View only. You are not on this engagement team, so you can&apos;t comment.
        </p>
      )}
    </div>
  );
}
