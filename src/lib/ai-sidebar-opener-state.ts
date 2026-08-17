/**
 * Fade state for the sidebar opener (PRD section 5.2, requirements 6.4 and 6.5).
 *
 * Two counters, both per user rather than per project: a veteran opening a new
 * project should not be re-introduced to the assistant, and someone who ignores
 * the block in one project is telling us about the block, not about that project.
 *
 * L0 counts DISTINCT DAYS, not shows. Counting shows let a single evening of
 * opening and closing the sidebar burn the whole introduction unread.
 *
 * The fade counter counts shows that produced no first move at all, which
 * includes a prompt the user typed themselves. A user who read "Заблокировано
 * задач: 2" and asked their own question in their own words got exactly what the
 * block is for; counting that as ignoring would fade the signal for the people it
 * works best on. Chip click-through is a separate measurement (metric 7.2).
 *
 * No clock and no storage decisions live in the pure functions: the caller passes
 * today's date, so tests do not have to travel in time.
 */

import type { OpenerLevel } from "@/lib/ai-sidebar-opener";

/** Distinct days of L0 before the introduction stops. */
export const L0_DISTINCT_DAYS = 3;
/** Days of being shown without a first move before the block collapses to one line. */
export const FADE_AFTER_IGNORED_DAYS = 5;

const STORAGE_PREFIX = "ai-opener-state";

export interface OpenerState {
  /** ISO `YYYY-MM-DD` days on which the opener was shown, capped at L0_DISTINCT_DAYS. */
  days: string[];
  /** Consecutive DAYS on which it was shown and no first move followed. */
  ignored: number;
  /** Last day counted, so reopening the panel does not count again. */
  lastDay?: string;
}

export const EMPTY_OPENER_STATE: OpenerState = { days: [], ignored: 0 };

export function storageKey(userId: string): string {
  // Keyed by user: a shared browser must not let one person's fade level decide
  // what the next person sees.
  return `${STORAGE_PREFIX}:${userId || "anonymous"}`;
}

function isState(value: unknown): value is OpenerState {
  if (!value || typeof value !== "object") return false;
  const v = value as Partial<OpenerState>;
  return Array.isArray(v.days) && v.days.every((d) => typeof d === "string") && typeof v.ignored === "number";
}

export function readOpenerState(userId: string): OpenerState {
  if (typeof window === "undefined") return EMPTY_OPENER_STATE;
  try {
    const raw = window.localStorage.getItem(storageKey(userId));
    if (!raw) return EMPTY_OPENER_STATE;
    const parsed: unknown = JSON.parse(raw);
    return isState(parsed) ? parsed : EMPTY_OPENER_STATE;
  } catch {
    // Private mode, quota, or a value someone else wrote: a fresh state shows the
    // introduction again, which is a better failure than showing nothing.
    return EMPTY_OPENER_STATE;
  }
}

export function writeOpenerState(userId: string, state: OpenerState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey(userId), JSON.stringify(state));
  } catch {
    // Nothing to do: the level simply does not persist for this browser.
  }
}

/** Pure: the level this state implies, before the coming show is recorded. */
export function resolveOpenerLevel(state: OpenerState): OpenerLevel {
  if (state.ignored >= FADE_AFTER_IGNORED_DAYS) return "l2";
  if (state.days.length < L0_DISTINCT_DAYS) return "l0";
  return "l1";
}

/**
 * Pure: state after the opener was shown on `today` (`YYYY-MM-DD`).
 *
 * The ignore counter moves at most once a day, for the same reason L0 counts days:
 * closing and reopening the panel is not five opinions about the block. Counting raw
 * shows faded a first-day user to L2 in one evening, before the introduction had been
 * on screen three times, which is the opposite of what the fade is for.
 */
export function withShown(state: OpenerState, today: string): OpenerState {
  const days = state.days.includes(today) ? state.days : [...state.days, today];
  const alreadyCountedToday = state.lastDay === today;
  return {
    // Only the count matters, so the list stays bounded instead of growing forever.
    days: days.slice(-L0_DISTINCT_DAYS),
    ignored: alreadyCountedToday ? state.ignored : state.ignored + 1,
    lastDay: today,
  };
}

/**
 * Pure: state after the user made any first move, by chip or by typing.
 *
 * `lastDay` is deliberately kept: today has already been accounted for, and a second
 * thread opened the same day should not immediately count as ignoring again.
 */
export function withFirstMove(state: OpenerState): OpenerState {
  return { ...state, ignored: 0 };
}

/** `YYYY-MM-DD` in the user's own timezone: "a different day" is a human notion. */
export function localDayKey(now: Date): string {
  const y = now.getFullYear();
  const m = `${now.getMonth() + 1}`.padStart(2, "0");
  const d = `${now.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${d}`;
}
