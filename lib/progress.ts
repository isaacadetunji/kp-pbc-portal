// Shared progress colour rule for percentage bars and figures on the firm and
// client dashboards, progress summaries, folder bars, group summary and the
// engagement lists. Client-safe.
//
//   below 30%  -> red    (danger)
//   30 – 69%   -> blue   (info / in progress)
//   70% and up -> green  (success)

export const PROGRESS_BLUE_FROM = 30;
export const PROGRESS_GREEN_FROM = 70;

/** @deprecated kept for back-compat; the mid threshold is now PROGRESS_BLUE_FROM. */
export const PROGRESS_AMBER_FROM = PROGRESS_BLUE_FROM;

export type ProgressTone = "danger" | "info" | "success";

export function progressTone(pct: number | null | undefined): ProgressTone {
  const v = Number.isFinite(pct) ? Number(pct) : 0;
  if (v >= PROGRESS_GREEN_FROM) return "success";
  if (v >= PROGRESS_BLUE_FROM) return "info";
  return "danger";
}

/** Fill colour for a bar (graphical object, >= 3:1 on the track and white). */
export const PROGRESS_BAR_CLASS: Record<ProgressTone, string> = {
  danger: "bg-danger-bar",
  info: "bg-info-bar",
  success: "bg-success-bar",
};

/** Text colour for the percentage figure next to a bar (>= 4.5:1 on white). */
export const PROGRESS_TEXT_CLASS: Record<ProgressTone, string> = {
  danger: "text-danger",
  info: "text-info",
  success: "text-success",
};

export const progressBarClass = (pct: number | null | undefined) => PROGRESS_BAR_CLASS[progressTone(pct)];
export const progressTextClass = (pct: number | null | undefined) => PROGRESS_TEXT_CLASS[progressTone(pct)];

export const PROGRESS_LEGEND = [
  { tone: "danger" as const, label: `Below ${PROGRESS_BLUE_FROM}%` },
  { tone: "info" as const, label: `${PROGRESS_BLUE_FROM}–${PROGRESS_GREEN_FROM - 1}%` },
  { tone: "success" as const, label: `${PROGRESS_GREEN_FROM}% and above` },
];
