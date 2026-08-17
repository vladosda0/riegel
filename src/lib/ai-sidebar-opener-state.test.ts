import { beforeEach, describe, expect, it } from "vitest";
import {
  EMPTY_OPENER_STATE,
  FADE_AFTER_IGNORED_DAYS,
  L0_DISTINCT_DAYS,
  localDayKey,
  readOpenerState,
  resolveOpenerLevel,
  storageKey,
  withFirstMove,
  withShown,
  writeOpenerState,
} from "@/lib/ai-sidebar-opener-state";

describe("level resolution", () => {
  it("starts at L0 and stays there for the first distinct days", () => {
    let state = EMPTY_OPENER_STATE;
    for (let day = 1; day < L0_DISTINCT_DAYS; day += 1) {
      expect(resolveOpenerLevel(state)).toBe("l0");
      state = withShown(state, `2026-08-0${day}`);
    }
    expect(resolveOpenerLevel(state)).toBe("l0");
    state = withShown(state, `2026-08-0${L0_DISTINCT_DAYS}`);
    expect(resolveOpenerLevel(state)).toBe("l1");
  });

  it("does not spend a day of L0 on repeated shows within that day", () => {
    let state = EMPTY_OPENER_STATE;
    for (let i = 0; i < 10; i += 1) state = withShown(state, "2026-08-17");
    expect(state.days).toEqual(["2026-08-17"]);
    expect(resolveOpenerLevel(state)).toBe("l0");
  });

  it("does not fade a first-day user who reopens the panel all evening", () => {
    let state = EMPTY_OPENER_STATE;
    for (let i = 0; i < FADE_AFTER_IGNORED_DAYS * 3; i += 1) state = withShown(state, "2026-08-17");
    expect(state.ignored).toBe(1);
    expect(resolveOpenerLevel(state)).toBe("l0");
  });

  it("does not count the rest of the day as ignoring once the user has engaged", () => {
    let state = withShown({ days: ["a", "b", "c"], ignored: 2 }, "2026-08-17");
    state = withFirstMove(state);
    state = withShown(state, "2026-08-17");
    expect(state.ignored).toBe(0);
  });

  it("fades to L2 after enough days with no first move", () => {
    let state: ReturnType<typeof withShown> = { days: ["a", "b", "c"], ignored: 0 };
    for (let day = 1; day < FADE_AFTER_IGNORED_DAYS; day += 1) {
      state = withShown(state, `2026-08-0${day}`);
      expect(resolveOpenerLevel(state)).toBe("l1");
    }
    state = withShown(state, `2026-08-0${FADE_AFTER_IGNORED_DAYS}`);
    expect(resolveOpenerLevel(state)).toBe("l2");
  });

  it("comes back from L2 on any first move, typed or clicked", () => {
    const faded = { days: ["a", "b", "c"], ignored: FADE_AFTER_IGNORED_DAYS + 3 };
    expect(resolveOpenerLevel(faded)).toBe("l2");
    expect(resolveOpenerLevel(withFirstMove(faded))).toBe("l1");
  });

  it("puts L2 ahead of L0, so a user who ignores it is not re-introduced", () => {
    expect(resolveOpenerLevel({ days: [], ignored: FADE_AFTER_IGNORED_DAYS })).toBe("l2");
  });

  it("keeps the day list bounded however long the block lives", () => {
    let state = EMPTY_OPENER_STATE;
    for (let i = 1; i <= 40; i += 1) state = withShown(state, `2026-09-${`${i}`.padStart(2, "0")}`);
    expect(state.days).toHaveLength(L0_DISTINCT_DAYS);
  });
});

describe("storage", () => {
  beforeEach(() => localStorage.clear());

  it("keeps each user's level separate on a shared browser", () => {
    writeOpenerState("user-a", { days: ["2026-08-17"], ignored: 4 });
    expect(readOpenerState("user-b")).toEqual(EMPTY_OPENER_STATE);
    expect(readOpenerState("user-a").ignored).toBe(4);
    expect(storageKey("user-a")).not.toBe(storageKey("user-b"));
  });

  it("round-trips a state", () => {
    const state = { days: ["2026-08-16", "2026-08-17"], ignored: 2 };
    writeOpenerState("user-a", state);
    expect(readOpenerState("user-a")).toEqual(state);
  });

  it("falls back to a fresh state on unreadable storage", () => {
    localStorage.setItem(storageKey("user-a"), "{not json");
    expect(readOpenerState("user-a")).toEqual(EMPTY_OPENER_STATE);
  });

  it("falls back to a fresh state when the stored shape is wrong", () => {
    localStorage.setItem(storageKey("user-a"), JSON.stringify({ days: "nope", ignored: "nope" }));
    expect(readOpenerState("user-a")).toEqual(EMPTY_OPENER_STATE);
  });
});

describe("day key", () => {
  it("uses the local calendar day, not UTC", () => {
    // 23:30 local on the 17th is still the 17th, whatever UTC says.
    expect(localDayKey(new Date(2026, 7, 17, 23, 30))).toBe("2026-08-17");
    expect(localDayKey(new Date(2026, 7, 1, 0, 5))).toBe("2026-08-01");
  });
});
