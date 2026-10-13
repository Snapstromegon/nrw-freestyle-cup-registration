/**
 * The live state of the competition as the music control and the moderation
 * screen show it: the phase (warm-up, act, judging, …), its timer and how far
 * the plan is off.
 */

import type { components } from "./bindings";
import {
  formatDuration,
  judgingAfterBlockEnd,
  lastTimeplanEntry,
  nextTimeplanEntry,
} from "./utils";

export type Timeplan = components["schemas"]["Timeplan"];
export type TimeplanItem = components["schemas"]["TimeplanItem"];
export type TimeplanAct = components["schemas"]["TimeplanAct"];
export type CategoryEntry = Extract<
  components["schemas"]["TimeplanEntry"],
  { Category: unknown }
>["Category"];

/** What is happening right now. */
export type Phase =
  | "before"
  | "pause"
  | "done"
  | "warmup"
  | "act"
  | "judging"
  | "empty"
  | "custom";

export const phaseLabels: Record<Phase, string> = {
  before: "Nicht gestartet",
  pause: "Pause",
  done: "Beendet",
  warmup: "Einfahrzeit",
  act: "Kür",
  judging: "Bewertung",
  empty: "Ohne Küren",
  custom: "Programmpunkt",
};

export const phaseTones: Record<Phase, string> = {
  before: "muted",
  pause: "muted",
  done: "muted",
  warmup: "info",
  act: "ok",
  judging: "warn",
  empty: "muted",
  custom: "info",
};

export interface NextAct {
  item: TimeplanItem;
  category: CategoryEntry;
  act: TimeplanAct;
}

export interface Live {
  phase: Phase;
  /** The running timeplan entry. */
  entry?: TimeplanItem;
  /**
   * The block shown as the title: the running entry, or the block that just
   * ended while its last act is still being judged.
   */
  block?: TimeplanItem;
  category?: CategoryEntry;
  /** The running act, or the act being judged. */
  act?: TimeplanAct;
  /** The next act to start, possibly in a later block. */
  next?: NextAct;
  /** The next timeplan entry to start, if none is running. */
  nextEntry?: TimeplanItem;
  /** The last ended timeplan entry, if none is running. */
  lastEntry?: TimeplanItem;
  /** Start of the current phase and its planned length in seconds. */
  since?: string | null;
  plannedSeconds?: number;
  /**
   * The running act's music hasn't started yet; its time runs from then, so
   * `since` is only the act's start.
   */
  musicPending?: boolean;
}

export const entryTitle = (item: TimeplanItem) =>
  "Category" in item.timeplan_entry
    ? item.timeplan_entry.Category.description
    : item.timeplan_entry.Custom.label;

export const findNextAct = (timeplan: Timeplan): NextAct | undefined => {
  for (const item of timeplan.items) {
    if (item.status === "Ended" || !("Category" in item.timeplan_entry)) {
      continue;
    }
    const category = item.timeplan_entry.Category;
    const act = category.acts.find((a) => a.status === "Planned");
    if (act) {
      return { item, category, act };
    }
  }
  return undefined;
};

/**
 * Derives the live state the same way `timeplan_forward` sees it. `now` (ms)
 * decides whether the last act of an ended block is still being judged.
 */
export const liveState = (timeplan: Timeplan, now: number): Live => {
  const next = findNextAct(timeplan);
  const entry = timeplan.items.find((item) => item.status === "Started");
  if (!entry) {
    // Skipped empty blocks are neither the last nor the next entry.
    const lastEntry = lastTimeplanEntry(timeplan);
    const nextEntry = nextTimeplanEntry(timeplan);
    // Ending the last act ends its block at once, but it is judged afterwards.
    const judging = judgingAfterBlockEnd(timeplan, now);
    if (judging) {
      return {
        phase: "judging",
        block: judging.entry,
        category: judging.category,
        act: judging.act,
        next,
        nextEntry,
        lastEntry,
        since: judging.act.ended_at,
        plannedSeconds: judging.category.judge_duration_seconds,
      };
    }
    return {
      phase: !lastEntry ? "before" : nextEntry ? "pause" : "done",
      next,
      nextEntry,
      lastEntry,
      since: lastEntry?.ended_at,
    };
  }
  if ("Custom" in entry.timeplan_entry) {
    return {
      phase: "custom",
      entry,
      block: entry,
      next,
      since: entry.started_at,
      plannedSeconds: entry.timeplan_entry.Custom.duration_seconds,
    };
  }
  const category = entry.timeplan_entry.Category;
  const running = category.acts.find((a) => a.status === "Started");
  if (running) {
    return {
      phase: "act",
      entry,
      block: entry,
      category,
      act: running,
      next,
      since: running.music_started_at ?? running.started_at,
      musicPending: !running.music_started_at,
      plannedSeconds: category.act_duration_seconds,
    };
  }
  const judged = category.acts.findLast((a) => a.status === "Ended");
  if (judged) {
    return {
      phase: "judging",
      entry,
      block: entry,
      category,
      act: judged,
      next,
      since: judged.ended_at,
      plannedSeconds: category.judge_duration_seconds,
    };
  }
  return {
    phase: category.acts.length ? "warmup" : "empty",
    entry,
    block: entry,
    category,
    next,
    since: entry.started_at,
    plannedSeconds: category.acts.length ? category.warmup_seconds : undefined,
  };
};

/**
 * How far the running plan is off, worded and coloured like the timeplan
 * view (/admin-timeplan): amber when behind, red from 15 minutes on.
 */
export const scheduleOffset = (seconds: number) => ({
  label: seconds > 0 ? "Verzug" : seconds < 0 ? "Vorsprung" : "im Plan",
  value: formatDuration(Math.abs(seconds)),
  tone: seconds <= 0 ? "ok" : seconds <= 15 * 60 ? "warn" : "bad",
});

/**
 * The timer of the current phase: seconds since it started and its planned
 * length. An act with music waits for it (`waiting`), as its time runs from
 * the music's start.
 */
export const phaseTimer = (live: Live, now: number, hasSong: boolean) => {
  if (!live.since) {
    return undefined;
  }
  const planned = live.plannedSeconds;
  if (live.musicPending && hasSong) {
    return { waiting: true, elapsed: 0, planned };
  }
  const elapsed = Math.max(0, (now - new Date(live.since).getTime()) / 1000);
  return { waiting: false, elapsed, planned };
};
