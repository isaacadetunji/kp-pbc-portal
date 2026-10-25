// Engagement stages: the fixed main flow with editable display names
// (app_settings 'stage_labels', Settings > Engagements). Client-safe.
import type { EngagementStatus } from "./types";

export type StageKey = "draft" | "awaiting_approval" | "pre_engagement" | "in_progress" | "completed" | "archived";

/** Main flow shown in the stepper (archived is off the flow). */
export const STAGE_FLOW: StageKey[] = ["draft", "awaiting_approval", "pre_engagement", "in_progress", "completed"];
export const STAGE_KEYS: StageKey[] = [...STAGE_FLOW, "archived"];

export type StageLabels = Record<StageKey, string>;

/** Same as public.default_stage_labels() */
export const DEFAULT_STAGE_LABELS: StageLabels = {
  draft: "Draft",
  awaiting_approval: "Approval",
  pre_engagement: "Pre-execution",
  in_progress: "Execution",
  completed: "Completed",
  archived: "Archived",
};

export const STAGE_HELP: Record<StageKey, string> = {
  draft: "The team prepares the request list. Clients with access see the engagement as “Request in progress”.",
  awaiting_approval: "The list waits for a partner, the team lead or a manager to approve and release it.",
  pre_engagement: "Released to the client. Critical items must be accepted or waived before work starts.",
  in_progress: "Work is under way; the client keeps providing information.",
  completed: "All items are accepted or N/A (or a partner / the lead completed it with a reason).",
  archived: "Closed and kept for the record.",
};

/** acceptance_review / accepted / declined are legacy values shown as Pre-execution. */
export function stageKey(status: EngagementStatus): StageKey {
  return status === "acceptance_review" || status === "accepted" || status === "declined" ? "pre_engagement" : status;
}

export function normaliseStageLabels(value: unknown): StageLabels {
  const v = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const out = { ...DEFAULT_STAGE_LABELS };
  for (const k of STAGE_KEYS) {
    const x = v[k];
    if (typeof x === "string" && x.trim()) out[k] = x.trim().slice(0, 40);
  }
  return out;
}

export function stageLabel(status: EngagementStatus, labels: StageLabels = DEFAULT_STAGE_LABELS) {
  return labels[stageKey(status)];
}

/** Statuses matched by a stage filter (legacy values fold into Pre-execution). */
export function statusesForStage(stage: StageKey): EngagementStatus[] {
  return stage === "pre_engagement" ? ["pre_engagement", "acceptance_review", "accepted", "declined"] : [stage];
}

// ---------------------------------------------------------------------------
// Engagement code format (app_settings 'engagement_code_format')
// ---------------------------------------------------------------------------
export const DEFAULT_CODE_FORMAT = "{PREFIX}-{YYYY}-{SEQ4}";
export const CODE_TOKENS = [
  { token: "{PREFIX}", help: "The engagement type's code prefix, e.g. SA" },
  { token: "{YYYY}", help: "Year of the period end, e.g. 2026" },
  { token: "{YY}", help: "Two-digit year, e.g. 26" },
  { token: "{SEQ4}", help: "Running number, 4 digits (0001). Also {SEQ3}, {SEQ5}, {SEQ6} or {SEQ}" },
];

/** Mirrors public.valid_engagement_code_format() */
export function validCodeFormat(f: string): boolean {
  if (f.length < 3 || f.length > 40) return false;
  if (!/\{SEQ[3-6]?\}/.test(f)) return false;
  return /^[A-Za-z0-9._-]*$/.test(f.replace(/\{(PREFIX|YYYY|YY|SEQ|SEQ3|SEQ4|SEQ5|SEQ6)\}/g, ""));
}

/** Mirrors public.format_engagement_code() for previews */
export function formatCode(f: string, prefix: string, year: number, seq: number): string {
  const y = String(year).padStart(4, "0");
  const pad = (n: number) => String(seq).padStart(n, "0");
  return f
    .replaceAll("{PREFIX}", prefix)
    .replaceAll("{YYYY}", y)
    .replaceAll("{YY}", y.slice(-2))
    .replaceAll("{SEQ6}", pad(6))
    .replaceAll("{SEQ5}", pad(5))
    .replaceAll("{SEQ4}", pad(4))
    .replaceAll("{SEQ3}", pad(3))
    .replaceAll("{SEQ}", String(seq));
}
