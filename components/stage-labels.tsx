"use client";

import { createContext, useContext } from "react";
import { DEFAULT_STAGE_LABELS, stageLabel, type StageLabels } from "@/lib/stages";
import type { EngagementStatus } from "@/lib/types";

const Ctx = createContext<StageLabels>(DEFAULT_STAGE_LABELS);

/** Mounted by the internal and portal layouts with app_settings 'stage_labels'. */
export function StageLabelsProvider({ labels, children }: { labels: StageLabels; children: React.ReactNode }) {
  return <Ctx.Provider value={labels}>{children}</Ctx.Provider>;
}

export function useStageLabels() {
  return useContext(Ctx);
}

export function useStageLabel(status: EngagementStatus) {
  return stageLabel(status, useContext(Ctx));
}
