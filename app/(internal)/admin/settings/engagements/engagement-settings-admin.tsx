"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Pencil, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { saveCodeFormat, saveEngagementType, saveStageLabels } from "@/lib/actions/settings-access";
import {
  CODE_TOKENS, DEFAULT_CODE_FORMAT, DEFAULT_STAGE_LABELS, STAGE_FLOW, STAGE_HELP, formatCode, validCodeFormat, type StageKey, type StageLabels,
} from "@/lib/stages";
import type { EngagementType } from "@/lib/types";

type TypeDraft = { id?: string; code: string; name: string; codePrefix: string; isActive: boolean };

export function EngagementSettingsAdmin({
  labels: initialLabels, types, codeFormat, usage,
}: { labels: StageLabels; types: EngagementType[]; codeFormat: string; usage: Record<string, number> }) {
  const router = useRouter();
  const [labels, setLabels] = useState<StageLabels>(initialLabels);
  const [savedLabels, setSavedLabels] = useState<StageLabels>(initialLabels);
  const [fmt, setFmt] = useState(codeFormat);
  const [savedFmt, setSavedFmt] = useState(codeFormat);
  const [busy, setBusy] = useState<string | null>(null);
  const [draft, setDraft] = useState<TypeDraft | null>(null);
  const year = new Date().getFullYear();
  const fmtValid = validCodeFormat(fmt.trim());
  const examplePrefix = types.find((t) => t.is_active)?.code_prefix ?? "SA";
  const preview = useMemo(() => (fmtValid ? formatCode(fmt.trim(), examplePrefix, year, 1) : null), [fmt, fmtValid, examplePrefix, year]);
  const labelsDirty = JSON.stringify(labels) !== JSON.stringify(savedLabels);

  async function saveLabels() {
    setBusy("labels");
    const res = await saveStageLabels(labels);
    setBusy(null);
    if (!res.ok) return toast.error(res.error);
    setSavedLabels(res.data);
    setLabels(res.data);
    toast.success("Stage names saved");
    router.refresh();
  }
  async function saveFmt() {
    setBusy("fmt");
    const res = await saveCodeFormat(fmt.trim());
    setBusy(null);
    if (!res.ok) return toast.error(res.error);
    setSavedFmt(fmt.trim());
    toast.success("Code format saved. It applies to new engagements only.");
  }
  async function saveType(e: React.FormEvent) {
    e.preventDefault();
    if (!draft) return;
    setBusy("type");
    const res = await saveEngagementType(draft);
    setBusy(null);
    if (!res.ok) return toast.error(res.error);
    toast.success(draft.id ? "Engagement type updated" : "Engagement type added");
    setDraft(null);
    router.refresh();
  }
  async function toggleActive(t: EngagementType, on: boolean) {
    const res = await saveEngagementType({ id: t.id, code: t.code, name: t.name, codePrefix: t.code_prefix, isActive: on });
    if (!res.ok) return toast.error(res.error);
    toast.success(on ? `${t.name} activated` : `${t.name} deactivated. Existing engagements are not affected.`);
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Stage names</CardTitle>
          <CardDescription>The stages are fixed; their names are shown in the stage bar, status labels, filters, the client portal and e-mails.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <ol className="space-y-3">
            {[...STAGE_FLOW, "archived" as StageKey].map((k, i) => (
              <li key={k} className="grid gap-2 sm:grid-cols-[2rem_14rem_minmax(0,1fr)] sm:items-center">
                <span className="hidden size-7 place-items-center rounded-full bg-muted text-xs font-semibold text-muted-foreground sm:grid" aria-hidden>
                  {k === "archived" ? "–" : i + 1}
                </span>
                <div className="space-y-1">
                  <Label htmlFor={`stage-${k}`} className="sr-only">Name for stage {i + 1}</Label>
                  <Input
                    id={`stage-${k}`}
                    value={labels[k]}
                    maxLength={40}
                    onChange={(e) => setLabels((l) => ({ ...l, [k]: e.target.value }))}
                    aria-describedby={`stage-${k}-help`}
                  />
                </div>
                <p id={`stage-${k}-help`} className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">Default: {DEFAULT_STAGE_LABELS[k]}.</span> {STAGE_HELP[k]}
                </p>
              </li>
            ))}
          </ol>
          <div className="flex flex-wrap gap-2">
            <Button onClick={saveLabels} disabled={!labelsDirty || busy !== null || STAGE_FLOW.some((k) => !labels[k].trim())}>
              {busy === "labels" ? <Loader2 className="animate-spin" /> : null} Save stage names
            </Button>
            <Button variant="ghost" onClick={() => setLabels(DEFAULT_STAGE_LABELS)} disabled={busy !== null}>Restore defaults</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Engagement code format</CardTitle>
          <CardDescription>Used for new engagements. Existing codes never change.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-[minmax(0,22rem)_1fr]">
            <div className="space-y-2">
              <Label htmlFor="code-format">Format</Label>
              <Input
                id="code-format"
                value={fmt}
                onChange={(e) => setFmt(e.target.value)}
                className="font-mono"
                maxLength={40}
                aria-invalid={!fmtValid || undefined}
                aria-describedby="code-format-preview"
              />
              <p id="code-format-preview" className={fmtValid ? "text-xs text-muted-foreground" : "text-xs text-destructive"}>
                {fmtValid ? <>Next code looks like <span className="font-mono font-medium text-foreground">{preview}</span></> : "Include a running number token such as {SEQ4}; use only letters, digits, - _ . and the tokens."}
              </p>
            </div>
            <ul className="space-y-1 text-xs text-muted-foreground">
              {CODE_TOKENS.map((t) => (
                <li key={t.token}>
                  <button type="button" className="font-mono text-primary hover:underline" onClick={() => setFmt((f) => f + t.token)}>{t.token}</button> {t.help}
                </li>
              ))}
              <li>Without a year token the running number never restarts; without {"{PREFIX}"} all types share one sequence.</li>
            </ul>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={saveFmt} disabled={!fmtValid || fmt.trim() === savedFmt || busy !== null}>{busy === "fmt" ? <Loader2 className="animate-spin" /> : null} Save format</Button>
            <Button variant="ghost" onClick={() => setFmt(DEFAULT_CODE_FORMAT)} disabled={busy !== null}>Use default ({DEFAULT_CODE_FORMAT})</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3">
          <div className="space-y-1.5">
            <CardTitle>Engagement types</CardTitle>
            <CardDescription>The code prefix goes into engagement codes (e.g. SA, TX, AD, DD). Deactivated types cannot be chosen for new engagements.</CardDescription>
          </div>
          <Button size="sm" onClick={() => setDraft({ code: "", name: "", codePrefix: "", isActive: true })}><Plus /> Add type</Button>
        </CardHeader>
        <CardContent>
          <ul className="divide-y rounded-lg border" aria-label="Engagement types">
            {types.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{t.name}</span>
                  <span className="block text-xs text-muted-foreground">
                    Type code {t.code} · prefix <span className="font-mono">{t.code_prefix}</span> · {usage[t.id] ?? 0} engagement{(usage[t.id] ?? 0) === 1 ? "" : "s"}
                  </span>
                </span>
                {t.is_active ? <Badge variant="success">Active</Badge> : <Badge variant="muted">Inactive</Badge>}
                <Switch checked={t.is_active} onCheckedChange={(v) => toggleActive(t, v)} aria-label={`${t.name} active`} />
                <Button size="icon-sm" variant="ghost" aria-label={`Edit ${t.name}`} onClick={() => setDraft({ id: t.id, code: t.code, name: t.name, codePrefix: t.code_prefix, isActive: t.is_active })}>
                  <Pencil />
                </Button>
              </li>
            ))}
            {types.length === 0 ? <li className="p-4 text-sm text-muted-foreground">No engagement types yet.</li> : null}
          </ul>
        </CardContent>
      </Card>

      <Dialog open={Boolean(draft)} onOpenChange={(o) => !o && setDraft(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{draft?.id ? "Edit engagement type" : "Add engagement type"}</DialogTitle>
            <DialogDescription>Changing a prefix affects new engagement codes only.</DialogDescription>
          </DialogHeader>
          {draft ? (
            <form onSubmit={saveType} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="et-name">Name</Label>
                <Input id="et-name" required maxLength={80} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="e.g. Internal Audit" autoFocus />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="et-code">Type code</Label>
                  <Input id="et-code" required maxLength={10} value={draft.code} disabled={Boolean(draft.id)} className="font-mono uppercase"
                    onChange={(e) => setDraft({ ...draft, code: e.target.value.toUpperCase() })} aria-describedby="et-code-help" />
                  <p id="et-code-help" className="text-xs text-muted-foreground">Used in checklist imports; fixed once created.</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="et-prefix">Code prefix</Label>
                  <Input id="et-prefix" required maxLength={10} value={draft.codePrefix} className="font-mono uppercase"
                    onChange={(e) => setDraft({ ...draft, codePrefix: e.target.value.toUpperCase() })} />
                </div>
              </div>
              <label className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm">
                Active
                <Switch checked={draft.isActive} onCheckedChange={(v) => setDraft({ ...draft, isActive: v })} />
              </label>
              <DialogFooter>
                <Button type="button" variant="ghost" onClick={() => setDraft(null)}>Cancel</Button>
                <Button type="submit" disabled={busy === "type"}>{busy === "type" ? <Loader2 className="animate-spin" /> : null} Save</Button>
              </DialogFooter>
            </form>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
