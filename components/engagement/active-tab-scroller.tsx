"use client";

import { useEffect } from "react";

/** On narrow screens the tab bar scrolls sideways; keep the current tab in view. */
export function ActiveTabScroller({ label = "Engagement sections" }: { label?: string }) {
  useEffect(() => {
    const el = document.querySelector<HTMLElement>(`nav[aria-label="${label}"] [aria-current="page"]`);
    const nav = el?.parentElement;
    if (el && nav && nav.scrollWidth > nav.clientWidth) {
      nav.scrollLeft = el.offsetLeft - (nav.clientWidth - el.offsetWidth) / 2;
    }
  });
  return null;
}
