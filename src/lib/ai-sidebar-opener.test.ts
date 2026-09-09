import { afterEach, describe, expect, it, vi } from "vitest";
import type { AIContextPack } from "@/lib/ai-project-context";
import type { MemberRole } from "@/types/entities";
import {
  ALL_OPENER_DOMAINS,
  buildSidebarOpener,
  isSidebarOpenerKillSwitchEnabled,
  selectSignals,
  V1_ENABLED_DOMAINS,
  type SidebarOpenerInput,
} from "@/lib/ai-sidebar-opener";

/** Keys plus their interpolation, so a test can assert both without the locales. */
const t = (key: string, options?: Record<string, unknown>) =>
  options && Object.keys(options).length > 0 ? `${key}|${JSON.stringify(options)}` : key;

function pack(overrides: Partial<AIContextPack> = {}): AIContextPack {
  return {
    project: { title: "Дом", type: "residential", progress: "40%" },
    stages: [],
    tasks: { total: 10, done: 4, blocked: 0 },
    estimate: { hasEstimate: true, status: "approved", stages: 3, lines: 20 },
    procurement: { total: 5, requested: 0, ordered: 5, inStock: 0 },
    user: { role: "owner" },
    members: 3,
    recentEvents: [],
    _meta: { hiddenDomains: [] },
    ...overrides,
  };
}

function build(overrides: Partial<SidebarOpenerInput> = {}) {
  return buildSidebarOpener({
    ctx: pack(),
    role: "owner",
    level: "l1",
    compact: false,
    quotaExhausted: false,
    t,
    ...overrides,
  });
}

/** Detector-level: the whole catalogue, so a signal held out of v1 is still tested. */
const ids = (ctx: AIContextPack, role: MemberRole = "owner") =>
  selectSignals(ctx, role, ALL_OPENER_DOMAINS).map((s) => s.id);

/** What v1 actually selects. */
const v1ids = (ctx: AIContextPack, role: MemberRole = "owner") =>
  selectSignals(ctx, role).map((s) => s.id);

describe("kill switch", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("stays on when unset or empty", () => {
    vi.stubEnv("VITE_AI_SIDEBAR_OPENER", "");
    expect(isSidebarOpenerKillSwitchEnabled()).toBe(false);
  });

  it("turns off only on the four off-words", () => {
    for (const off of ["0", "false", "no", "off", "OFF", " False "]) {
      vi.stubEnv("VITE_AI_SIDEBAR_OPENER", off);
      expect(isSidebarOpenerKillSwitchEnabled()).toBe(true);
    }
  });

  it("does not read a truthy value as an instruction to disable", () => {
    for (const on of ["1", "true", "yes", "on"]) {
      vi.stubEnv("VITE_AI_SIDEBAR_OPENER", on);
      expect(isSidebarOpenerKillSwitchEnabled()).toBe(false);
    }
  });
});

describe("detectors", () => {
  it("S01 fires only when estimate, tasks and procurement are all empty", () => {
    const empty = pack({
      estimate: { hasEstimate: false, status: null, stages: 0, lines: 0 },
      tasks: { total: 0, done: 0, blocked: 0 },
      procurement: { total: 0, requested: 0, ordered: 0, inStock: 0 },
    });
    expect(ids(empty)).toEqual(["S01"]);
    expect(ids(pack({ ...empty, tasks: { total: 1, done: 0, blocked: 0 } }))).not.toContain("S01");
  });

  it("S11 fires when every task is done, and not while one is open", () => {
    expect(ids(pack({ tasks: { total: 6, done: 6, blocked: 0 } }))).toContain("S11");
    expect(ids(pack({ tasks: { total: 6, done: 5, blocked: 0 } }))).not.toContain("S11");
    expect(ids(pack({ tasks: { total: 0, done: 0, blocked: 0 } }))).not.toContain("S11");
  });

  it("S02 fires when tasks exist without an estimate", () => {
    const noEstimate = pack({ estimate: { hasEstimate: false, status: null, stages: 0, lines: 0 } });
    expect(ids(noEstimate)).toContain("S02");
    expect(ids(pack())).not.toContain("S02");
  });

  it("S03 fires on an estimate with no line items", () => {
    expect(ids(pack({ estimate: { hasEstimate: true, status: "draft", stages: 1, lines: 0 } }))).toContain("S03");
    expect(ids(pack())).not.toContain("S03");
  });

  it("S04 fires on a filled estimate with no tasks", () => {
    expect(ids(pack({ tasks: { total: 0, done: 0, blocked: 0 } }))).toContain("S04");
    expect(ids(pack())).not.toContain("S04");
  });

  it("S05 fires on blocked tasks and carries the count", () => {
    const blocked = pack({ tasks: { total: 10, done: 4, blocked: 2 } });
    expect(ids(blocked)).toContain("S05");
    expect(build({ ctx: blocked }).lines[0]).toBe('ai.sidebar.opener.signal.blocked|{"count":2}');
    expect(ids(pack())).not.toContain("S05");
  });

  it("S06 fires when nothing requested has been ordered", () => {
    expect(ids(pack({ procurement: { total: 5, requested: 5, ordered: 0, inStock: 0 } }))).toContain("S06");
    expect(ids(pack({ procurement: { total: 5, requested: 5, ordered: 1, inStock: 0 } }))).not.toContain("S06");
  });

  it("S10 fires from 90 percent done, with at least five tasks, and never at 100", () => {
    expect(ids(pack({ tasks: { total: 10, done: 9, blocked: 0 } }))).toContain("S10");
    expect(ids(pack({ tasks: { total: 10, done: 8, blocked: 0 } }))).not.toContain("S10");
    expect(ids(pack({ tasks: { total: 4, done: 4, blocked: 0 } }))).not.toContain("S10");
    expect(ids(pack({ tasks: { total: 10, done: 10, blocked: 0 } }))).not.toContain("S10");
  });

  it("S10 reports what is left, not what is done", () => {
    const line = build({ ctx: pack({ tasks: { total: 10, done: 9, blocked: 0 } }) }).lines[0];
    expect(line).toBe('ai.sidebar.opener.signal.almostDone|{"count":1,"total":10}');
  });

  it("S07 fires on anything in stock", () => {
    expect(ids(pack({ procurement: { total: 5, requested: 0, ordered: 0, inStock: 3 } }))).toContain("S07");
    expect(ids(pack())).not.toContain("S07");
  });

  it("S12 fires for a lone owner with tasks", () => {
    expect(ids(pack({ members: 1 }))).toContain("S12");
    expect(ids(pack({ members: 2 }))).not.toContain("S12");
    expect(ids(pack({ members: 1, tasks: { total: 0, done: 0, blocked: 0 } }))).not.toContain("S12");
  });
});

describe("hidden domains", () => {
  it("never fires a task signal when tasks are hidden", () => {
    expect(ids(pack({ tasks: null }))).not.toContain("S05");
    expect(ids(pack({ tasks: null }))).not.toContain("S11");
  });

  it("never fires an estimate signal when the estimate is hidden", () => {
    const hidden = pack({ estimate: null, tasks: { total: 3, done: 0, blocked: 0 } });
    expect(ids(hidden)).not.toContain("S02");
    expect(ids(hidden)).not.toContain("S03");
  });

  it("never fires a procurement signal when procurement is hidden", () => {
    expect(ids(pack({ procurement: null }))).not.toContain("S06");
    expect(ids(pack({ procurement: null }))).not.toContain("S07");
  });

  it("never fires S12 when participants are hidden", () => {
    expect(ids(pack({ members: null }))).not.toContain("S12");
  });

  it("never claims the project is empty while the estimate is withheld", () => {
    const withheld = pack({
      estimate: null,
      tasks: { total: 0, done: 0, blocked: 0 },
      procurement: { total: 0, requested: 0, ordered: 0, inStock: 0 },
    });
    expect(ids(withheld)).not.toContain("S01");
  });

  it("keeps a hidden domain out of the fallback line", () => {
    const line = build({ ctx: pack({ procurement: null, tasks: null, estimate: null, members: null }) }).lines[0];
    expect(line).toContain("ai.sidebar.opener.domain.documents");
    expect(line).not.toContain("ai.sidebar.opener.domain.procurement");
    expect(line).not.toContain("ai.sidebar.opener.domain.tasks");
  });
});

describe("roles", () => {
  const OWNER_ONLY = ["S01", "S02", "S03", "S04", "S06", "S07", "S12"];

  it("gives a viewer only the four signals of section 5.3", () => {
    for (const ctx of [
      pack({ estimate: { hasEstimate: false, status: null, stages: 0, lines: 0 } }),
      pack({ tasks: { total: 10, done: 4, blocked: 3 } }),
      pack({ procurement: { total: 5, requested: 5, ordered: 0, inStock: 2 } }),
      pack({ members: 1 }),
    ]) {
      for (const id of ids(ctx, "viewer")) expect(OWNER_ONLY).not.toContain(id);
    }
  });

  it("treats co_owner exactly as owner", () => {
    const ctx = pack({ members: 1, procurement: { total: 2, requested: 2, ordered: 0, inStock: 1 } });
    expect(ids(ctx, "co_owner")).toEqual(ids(ctx, "owner"));
  });

  it("does not give a contractor the owner-only S12", () => {
    expect(ids(pack({ members: 1 }), "contractor")).not.toContain("S12");
  });

  it("leaves a viewer with a single line, because their signals share one domain", () => {
    const ctx = pack({ tasks: { total: 10, done: 9, blocked: 2 } });
    expect(build({ ctx, role: "viewer" }).lines).toHaveLength(1);
  });
});

describe("combination rules", () => {
  it("takes at most two signals", () => {
    const busy = pack({
      tasks: { total: 10, done: 9, blocked: 2 },
      procurement: { total: 5, requested: 5, ordered: 0, inStock: 3 },
      members: 1,
    });
    expect(ids(busy)).toHaveLength(2);
  });

  it("requires the second signal to speak about another domain", () => {
    const ctx = pack({ tasks: { total: 10, done: 9, blocked: 2 } });
    expect(ids(ctx)).toEqual(["S05"]);
  });

  it("prefers the higher priority inside one domain", () => {
    const ctx = pack({
      tasks: { total: 10, done: 9, blocked: 2 },
      procurement: { total: 5, requested: 5, ordered: 0, inStock: 0 },
    });
    expect(ids(ctx)).toEqual(["S05", "S06"]);
  });

  it("adds no second signal to S01", () => {
    const empty = pack({
      estimate: { hasEstimate: false, status: null, stages: 0, lines: 0 },
      tasks: { total: 0, done: 0, blocked: 0 },
      procurement: { total: 0, requested: 0, ordered: 0, inStock: 0 },
      members: 1,
    });
    expect(ids(empty)).toEqual(["S01"]);
  });

  it("lets a low-priority signal stand alone when nothing else fired", () => {
    const ctx = pack({ procurement: { total: 3, requested: 0, ordered: 0, inStock: 3 } });
    expect(ids(ctx)).toEqual(["S07"]);
  });

  it("falls back to S00 when no detector fires", () => {
    const quiet = pack({ tasks: { total: 10, done: 4, blocked: 0 } });
    expect(ids(quiet)).toEqual([]);
    expect(build({ ctx: quiet }).signals).toEqual(["S00"]);
  });
});

describe("degradation", () => {
  it("shows neither a number nor a domain list before the pack exists", () => {
    const result = build({ ctx: null });
    expect(result.signals).toEqual(["S00n"]);
    expect(result.lines).toEqual(["ai.sidebar.opener.signal.fallbackNoContext"]);
    expect(result.lines.join(" ")).not.toMatch(/\d/);
    expect(result.lines.join(" ")).not.toContain("domain");
  });

  it("offers no domain-gated chip before the pack exists", () => {
    const result = build({ ctx: null });
    // Pinned, not just filtered: without a length the loop passes on an empty list,
    // and one chip is what this path actually produces.
    expect(result.chips).toHaveLength(1);
    expect(result.chips[0].key).toBe("ai.sidebar.suggestion.draftWeeklyReport");
  });

  it("drops the signal at L2 and keeps the chips", () => {
    const ctx = pack({ tasks: { total: 10, done: 4, blocked: 3 } });
    const result = build({ ctx, level: "l2" });
    expect(result.signals).toEqual(["S00"]);
    expect(result.chips.length).toBeGreaterThan(0);
  });

  it("introduces the assistant only at L0", () => {
    expect(build({ level: "l0" }).headline).toBeDefined();
    expect(build({ level: "l1" }).headline).toBeUndefined();
    expect(build({ level: "l2" }).headline).toBeUndefined();
  });

  it("keeps L0 to a single signal line", () => {
    const ctx = pack({
      tasks: { total: 10, done: 4, blocked: 2 },
      procurement: { total: 5, requested: 5, ordered: 0, inStock: 0 },
    });
    expect(build({ ctx, level: "l1", enabledDomains: ALL_OPENER_DOMAINS }).lines).toHaveLength(2);
    expect(build({ ctx, level: "l0", enabledDomains: ALL_OPENER_DOMAINS }).lines).toHaveLength(1);
  });

  it("gives a narrow panel one line and two chips at any level", () => {
    const ctx = pack({
      tasks: { total: 10, done: 4, blocked: 2 },
      procurement: { total: 5, requested: 5, ordered: 0, inStock: 0 },
    });
    const result = build({ ctx, compact: true, enabledDomains: ALL_OPENER_DOMAINS });
    expect(result.lines).toHaveLength(1);
    expect(result.chips).toHaveLength(2);
  });

  it("adds the credits line only when the quota is exhausted", () => {
    expect(build({ quotaExhausted: true }).quotaNote).toBe("ai.sidebar.opener.quotaExhausted");
    expect(build().quotaNote).toBeUndefined();
  });
});

describe("v1 narrowing", () => {
  it("ships only task signals, so every other detector is held back", () => {
    const busy = pack({
      estimate: { hasEstimate: false, status: null, stages: 0, lines: 0 },
      tasks: { total: 10, done: 4, blocked: 2 },
      procurement: { total: 5, requested: 5, ordered: 0, inStock: 3 },
      members: 1,
    });
    expect(ids(busy).length).toBeGreaterThan(1);
    expect(v1ids(busy)).toEqual(["S05"]);
  });

  it("falls back rather than speaking from a domain it cannot prove has loaded", () => {
    const emptyProject = pack({
      estimate: { hasEstimate: false, status: null, stages: 0, lines: 0 },
      tasks: { total: 0, done: 0, blocked: 0 },
      procurement: { total: 0, requested: 0, ordered: 0, inStock: 0 },
    });
    expect(ids(emptyProject)).toEqual(["S01"]);
    expect(v1ids(emptyProject)).toEqual([]);
    expect(build({ ctx: emptyProject }).signals).toEqual(["S00"]);
  });

  it("holds back a signal that speaks about tasks but reads the estimate", () => {
    // S04 says "the estimate is filled in, there are no tasks yet". It is a task
    // statement built on estimate data, which is exactly the source the narrowing
    // exists to exclude, so labelling it by what it says let it through once.
    const filledEstimateNoTasks = pack({
      estimate: { hasEstimate: true, status: "approved", stages: 2, lines: 12 },
      tasks: { total: 0, done: 0, blocked: 0 },
    });
    expect(ids(filledEstimateNoTasks)).toContain("S04");
    expect(v1ids(filledEstimateNoTasks)).toEqual([]);
    expect(build({ ctx: filledEstimateNoTasks }).signals).toEqual(["S00"]);
  });

  it("ships exactly the three task-only detectors", () => {
    const shipping = new Set<string>();
    for (const ctx of [
      pack({ tasks: { total: 10, done: 4, blocked: 2 } }),
      pack({ tasks: { total: 10, done: 9, blocked: 0 } }),
      pack({ tasks: { total: 6, done: 6, blocked: 0 } }),
      pack({ tasks: { total: 0, done: 0, blocked: 0 } }),
      pack({ estimate: { hasEstimate: false, status: null, stages: 0, lines: 0 } }),
      pack({ procurement: { total: 5, requested: 5, ordered: 0, inStock: 2 } }),
      pack({ members: 1 }),
    ]) {
      for (const role of ["owner", "co_owner", "contractor", "viewer"] as const) {
        for (const id of v1ids(ctx, role)) shipping.add(id);
      }
    }
    expect([...shipping].sort()).toEqual(["S05", "S10", "S11"]);
  });

  it("cannot produce two lines while one domain is enabled", () => {
    expect([...V1_ENABLED_DOMAINS]).toEqual(["tasks"]);
    const busy = pack({ tasks: { total: 10, done: 9, blocked: 2 } });
    expect(build({ ctx: busy }).lines).toHaveLength(1);
  });
});

describe("chips", () => {
  it("returns three distinct chips", () => {
    const result = build({ ctx: pack({ tasks: { total: 10, done: 4, blocked: 2 } }) });
    expect(result.chips).toHaveLength(3);
    expect(new Set(result.chips.map((c) => c.key)).size).toBe(3);
  });

  it("leads with the chips of the first signal", () => {
    const result = build({ ctx: pack({ tasks: { total: 10, done: 4, blocked: 2 } }) });
    expect(result.chips[0].key).toBe("ai.sidebar.suggestion.whatBlocksTasks");
  });

  it("takes two chips from the first signal and one from the second", () => {
    const ctx = pack({
      tasks: { total: 10, done: 4, blocked: 2 },
      procurement: { total: 5, requested: 5, ordered: 0, inStock: 0 },
    });
    expect(build({ ctx, enabledDomains: ALL_OPENER_DOMAINS }).chips.map((c) => c.key)).toEqual([
      "ai.sidebar.suggestion.whatBlocksTasks",
      "ai.sidebar.suggestion.nextRiskyTasks",
      "ai.sidebar.suggestion.whatToOrderFirst",
    ]);
  });

  it("drops a chip that leads into a hidden domain", () => {
    // A viewer with all tasks done gets S11, whose third chip is "compare estimates".
    const ctx = pack({ tasks: { total: 6, done: 6, blocked: 0 }, estimate: null });
    const keys = build({ ctx, role: "viewer" }).chips.map((c) => c.key);
    expect(keys).not.toContain("ai.sidebar.suggestion.compareEstimates");
    expect(keys).toHaveLength(3);
  });
});
