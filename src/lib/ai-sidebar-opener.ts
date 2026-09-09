/**
 * The grounded sidebar opener: what the assistant says first on an empty thread.
 *
 * Spec: `rovno-docs/specs/rovno-ai-sidebar-opener-prd.md` (sections 5.3 catalogue,
 * 5.4 combination rules, 5.5 chips, 5.7 degradation). Copy lives in the locales;
 * this module only decides WHICH strings apply.
 *
 * Pure by construction: no stores, no hooks, no clock, no storage. Everything it
 * knows arrives in one object, so the fade level, the role and the permission-aware
 * context pack are all substitutable in tests. Phase 3 adds fields to `AIContextPack`
 * (last event date, project age) without changing this signature.
 *
 * The one invariant worth stating: a SIGNAL is an assertion about the project, so it
 * may never exist without the field that backs it, and never before the pack is built.
 * A CHIP is only a prompt draft for an assistant that has its own context, so it needs
 * no field at all. That asymmetry is why `null` domains silently remove signals but
 * only filter chips.
 */

import type { AIContextPack } from "@/lib/ai-project-context";
import type { MemberRole } from "@/types/entities";

export type OpenerLevel = "l0" | "l1" | "l2";

/** Domains a signal can speak about, and a chip can lead into. */
export type OpenerDomain = "project" | "estimate" | "tasks" | "procurement" | "participants" | "documents";

export type Translate = (key: string, options?: Record<string, unknown>) => string;

export interface SidebarOpenerInput {
  /** `null` while the seam loads or the pack could not be built. */
  ctx: AIContextPack | null;
  role: MemberRole;
  level: OpenerLevel;
  /** Mobile width: one line and two chips, whatever the level (requirement 6.12). */
  compact: boolean;
  /** Chips render disabled and a credits line is added (section 5.7). */
  quotaExhausted: boolean;
  /** Defaults to the v1 subset; widened by tests that exercise the whole catalogue. */
  enabledDomains?: ReadonlySet<OpenerDomain>;
  t: Translate;
}

export interface OpenerChip {
  /** Locale key, so analytics reports a stable id rather than translated text. */
  key: string;
  text: string;
}

export interface SidebarOpenerResult {
  /** L0 only: the one place the assistant introduces itself. */
  headline?: string;
  /** L0 only: the "I read this project" line, above the signal. */
  intro?: string;
  lines: string[];
  chips: OpenerChip[];
  /** Signal ids in display order, for `ai_opener_shown`. */
  signals: string[];
  quotaNote?: string;
}

const SUGGESTION = "ai.sidebar.suggestion.";
const OPENER = "ai.sidebar.opener.";

/**
 * Explicit opt-out via `VITE_AI_SIDEBAR_OPENER` (requirement 6.11). When on, the
 * sidebar behaves exactly as it did before this feature: the old chip row returns
 * and nothing new renders. Same shape as `isLiveTextHostedKillSwitchEnabled`.
 */
export function isSidebarOpenerKillSwitchEnabled(): boolean {
  const v = import.meta.env.VITE_AI_SIDEBAR_OPENER;
  if (v === undefined || v === null) return false;
  const s = String(v).trim().toLowerCase();
  if (s === "") return false;
  return s === "0" || s === "false" || s === "no" || s === "off";
}

/** Which domain a chip leads into, for requirement 6.13. `null` = no domain gate. */
const CHIP_DOMAIN: Record<string, OpenerDomain | null> = {
  [`${SUGGESTION}addTasks`]: "tasks",
  [`${SUGGESTION}updateEstimate`]: "estimate",
  [`${SUGGESTION}generateContract`]: "documents",
  [`${SUGGESTION}buyMaterials`]: "procurement",
  [`${SUGGESTION}draftWeeklyReport`]: null,
  [`${SUGGESTION}nextRiskyTasks`]: "tasks",
  [`${SUGGESTION}suggestSchedule`]: "tasks",
  [`${SUGGESTION}proposeMaterials`]: "estimate",
  [`${SUGGESTION}draftInvite`]: "participants",
  [`${SUGGESTION}compareEstimates`]: "estimate",
  [`${SUGGESTION}estimateFromDescription`]: "estimate",
  [`${SUGGESTION}estimateFromTasks`]: "estimate",
  [`${SUGGESTION}fillEstimate`]: "estimate",
  [`${SUGGESTION}whatBlocksTasks`]: "tasks",
  [`${SUGGESTION}whatToOrderFirst`]: "procurement",
  [`${SUGGESTION}whatIsLeft`]: "tasks",
  [`${SUGGESTION}clientStatus`]: null,
  [`${SUGGESTION}finalReport`]: null,
  [`${SUGGESTION}writeOffStock`]: "procurement",
};

/** Used to top up a set the domain filter left short, in this order. */
const FILLER_CHIPS = [
  `${SUGGESTION}nextRiskyTasks`,
  `${SUGGESTION}updateEstimate`,
  `${SUGGESTION}buyMaterials`,
  `${SUGGESTION}draftWeeklyReport`,
  `${SUGGESTION}suggestSchedule`,
];

interface SignalDef {
  id: string;
  priority: number;
  /** The domain the signal SPEAKS about; drives combination rule 2. */
  domain: OpenerDomain;
  /**
   * Every domain the `test` READS. Separate from `domain` because the two differ:
   * S04 speaks about tasks but reads the estimate, so labelling it by what it says
   * let it ship under a narrowing meant to exclude the estimate. The v1 filter is
   * on this, so a signal ships only when every source behind it is proven loaded.
   */
  reads: OpenerDomain[];
  /** False for roles that must never see it (section 5.3 roles column). */
  allows: (role: MemberRole) => boolean;
  /** `null` when it does not fire; otherwise the interpolation values. */
  test: (ctx: AIContextPack) => Record<string, number> | null;
  textKey: string;
  chips: string[];
}

/**
 * Domains whose signals ship in v1.
 *
 * A signal is an assertion, so it may only ship where we can prove the data behind
 * it has loaded. Tasks expose a loading flag; the estimate hydrates through a store
 * with its own timing, and the procurement counts are derived from orders and
 * locations, neither of which reports loading at all. Until those do, a signal built
 * on them can tell a populated project it is empty, which is the one thing goal 4
 * forbids. Narrowed on Vlad's call, 2026-08-17, after two audit rounds found the
 * same class twice.
 *
 * The detectors below stay defined and tested: widening this set is what brings them
 * back, once the hooks can say whether they have loaded.
 */
export const V1_ENABLED_DOMAINS: ReadonlySet<OpenerDomain> = new Set(["tasks"]);

/** Every domain, for tests that exercise a detector rather than the v1 selection. */
export const ALL_OPENER_DOMAINS: ReadonlySet<OpenerDomain> = new Set([
  "project",
  "estimate",
  "tasks",
  "procurement",
  "participants",
  "documents",
]);

const ownerLike = (role: MemberRole) => role === "owner" || role === "co_owner";
const ownerOrContractor = (role: MemberRole) => ownerLike(role) || role === "contractor";
const anyRole = () => true;

/**
 * Section 5.3, in priority order. Every `test` reads only fields it is allowed to:
 * a `null` domain means the pack deliberately withheld it, so the signal cannot fire.
 */
const SIGNALS: SignalDef[] = [
  {
    id: "S01",
    priority: 100,
    domain: "project",
    reads: ["estimate", "tasks", "procurement"],
    allows: ownerOrContractor,
    test: (c) =>
      c.estimate != null &&
      !c.estimate.hasEstimate &&
      c.tasks?.total === 0 &&
      c.procurement?.total === 0
        ? {}
        : null,
    textKey: `${OPENER}signal.emptyProject`,
    chips: [`${SUGGESTION}estimateFromDescription`, `${SUGGESTION}addTasks`, `${SUGGESTION}suggestSchedule`],
  },
  {
    id: "S11",
    priority: 95,
    domain: "tasks",
    reads: ["tasks"],
    allows: anyRole,
    test: (c) => (c.tasks && c.tasks.total > 0 && c.tasks.done === c.tasks.total ? {} : null),
    textKey: `${OPENER}signal.allDone`,
    chips: [`${SUGGESTION}finalReport`, `${SUGGESTION}clientStatus`, `${SUGGESTION}compareEstimates`],
  },
  {
    id: "S02",
    priority: 90,
    domain: "estimate",
    reads: ["estimate", "tasks"],
    allows: ownerOrContractor,
    test: (c) =>
      c.estimate && !c.estimate.hasEstimate && c.tasks && c.tasks.total > 0 ? {} : null,
    textKey: `${OPENER}signal.noEstimate`,
    chips: [`${SUGGESTION}estimateFromTasks`, `${SUGGESTION}nextRiskyTasks`, `${SUGGESTION}suggestSchedule`],
  },
  {
    id: "S03",
    priority: 85,
    domain: "estimate",
    reads: ["estimate"],
    allows: ownerOrContractor,
    test: (c) => (c.estimate?.hasEstimate && c.estimate.lines === 0 ? {} : null),
    textKey: `${OPENER}signal.emptyEstimate`,
    chips: [`${SUGGESTION}fillEstimate`, `${SUGGESTION}proposeMaterials`, `${SUGGESTION}suggestSchedule`],
  },
  {
    id: "S04",
    priority: 80,
    domain: "tasks",
    reads: ["estimate", "tasks"],
    allows: ownerOrContractor,
    test: (c) =>
      c.estimate?.hasEstimate && c.estimate.lines > 0 && c.tasks?.total === 0 ? {} : null,
    textKey: `${OPENER}signal.noTasks`,
    chips: [`${SUGGESTION}addTasks`, `${SUGGESTION}suggestSchedule`, `${SUGGESTION}buyMaterials`],
  },
  {
    id: "S05",
    priority: 75,
    domain: "tasks",
    reads: ["tasks"],
    allows: anyRole,
    test: (c) => (c.tasks && c.tasks.blocked > 0 ? { count: c.tasks.blocked } : null),
    textKey: `${OPENER}signal.blocked`,
    chips: [`${SUGGESTION}whatBlocksTasks`, `${SUGGESTION}nextRiskyTasks`, `${SUGGESTION}suggestSchedule`],
  },
  {
    id: "S06",
    priority: 70,
    domain: "procurement",
    reads: ["procurement"],
    allows: ownerOrContractor,
    test: (c) =>
      c.procurement && c.procurement.requested > 0 && c.procurement.ordered === 0
        ? { count: c.procurement.requested }
        : null,
    textKey: `${OPENER}signal.toOrder`,
    chips: [`${SUGGESTION}whatToOrderFirst`, `${SUGGESTION}buyMaterials`, `${SUGGESTION}proposeMaterials`],
  },
  {
    id: "S10",
    priority: 60,
    domain: "tasks",
    reads: ["tasks"],
    allows: anyRole,
    test: (c) => {
      if (!c.tasks || c.tasks.total < 5) return null;
      if (c.tasks.done >= c.tasks.total) return null;
      if (c.tasks.done / c.tasks.total < 0.9) return null;
      return { count: c.tasks.total - c.tasks.done, total: c.tasks.total };
    },
    textKey: `${OPENER}signal.almostDone`,
    chips: [`${SUGGESTION}whatIsLeft`, `${SUGGESTION}clientStatus`, `${SUGGESTION}draftWeeklyReport`],
  },
  {
    id: "S07",
    priority: 40,
    domain: "procurement",
    reads: ["procurement"],
    allows: ownerOrContractor,
    test: (c) => (c.procurement && c.procurement.inStock > 0 ? { count: c.procurement.inStock } : null),
    textKey: `${OPENER}signal.inStock`,
    chips: [`${SUGGESTION}writeOffStock`, `${SUGGESTION}buyMaterials`, `${SUGGESTION}proposeMaterials`],
  },
  {
    id: "S12",
    priority: 30,
    domain: "participants",
    reads: ["participants", "tasks"],
    allows: ownerLike,
    test: (c) => (c.members === 1 && c.tasks && c.tasks.total > 0 ? {} : null),
    textKey: `${OPENER}signal.soloOwner`,
    chips: [`${SUGGESTION}draftInvite`, `${SUGGESTION}generateContract`, `${SUGGESTION}addTasks`],
  },
];

/** Which domains this user can be told about at all. */
function visibleDomains(ctx: AIContextPack): Set<OpenerDomain> {
  const visible = new Set<OpenerDomain>(["project"]);
  if (ctx.tasks) visible.add("tasks");
  if (ctx.estimate) visible.add("estimate");
  if (ctx.procurement) visible.add("procurement");
  if (ctx.members !== null) visible.add("participants");
  if (!ctx._meta.hiddenDomains.includes("documents")) visible.add("documents");
  return visible;
}

/** Section 5.4. Returns at most two signals, highest priority first. */
export function selectSignals(
  ctx: AIContextPack,
  role: MemberRole,
  enabledDomains: ReadonlySet<OpenerDomain> = V1_ENABLED_DOMAINS,
): SignalDef[] {
  const fired = SIGNALS.filter(
    (s) =>
      s.reads.every((d) => enabledDomains.has(d)) && s.allows(role) && s.test(ctx) !== null,
  ).sort((a, b) => b.priority - a.priority);
  const first = fired[0];
  if (!first) return [];
  // Rule 4: S01 says the project is empty, so a second statement about it would
  // contradict the first.
  if (first.id === "S01") return [first];
  // Rule 2: the second must speak about something else, or it repeats the first.
  const second = fired.find((s) => s.domain !== first.domain);
  return second ? [first, second] : [first];
}

function chipsFor(
  signals: SignalDef[],
  ctx: AIContextPack | null,
  wanted: number,
  t: Translate,
): OpenerChip[] {
  const allowed = ctx ? visibleDomains(ctx) : null;
  const passes = (key: string) => {
    const domain = CHIP_DOMAIN[key];
    if (domain === null || domain === undefined) return true;
    // Before the pack exists nothing is known to be visible, so only ungated
    // chips are offered: requirement 6.6 covers chips as well as numbers.
    return allowed ? allowed.has(domain) : false;
  };

  const ordered: string[] = [];
  if (signals.length >= 2) {
    ordered.push(signals[0].chips[0], signals[0].chips[1], signals[1].chips[0]);
  } else if (signals.length === 1) {
    ordered.push(...signals[0].chips);
  }
  ordered.push(...FILLER_CHIPS);

  const picked: string[] = [];
  for (const key of ordered) {
    if (picked.length >= wanted) break;
    if (!key || picked.includes(key) || !passes(key)) continue;
    picked.push(key);
  }
  return picked.map((key) => ({ key, text: t(key) }));
}

/**
 * Build the opener for one render. Never throws: a missing pack degrades to the
 * pre-context fallback, which carries neither a number nor a domain list.
 */
export function buildSidebarOpener(input: SidebarOpenerInput): SidebarOpenerResult {
  const { ctx, role, level, compact, quotaExhausted, enabledDomains, t } = input;
  const chipCount = compact ? 2 : 3;
  const quotaNote = quotaExhausted ? t(`${OPENER}quotaExhausted`) : undefined;
  const l0 =
    level === "l0"
      ? { headline: t(`${OPENER}l0.headline`), intro: t(`${OPENER}l0.intro`) }
      : {};

  // Requirement 6.6: no number and no domain list until the pack is built.
  if (!ctx) {
    return {
      ...l0,
      lines: [t(`${OPENER}signal.fallbackNoContext`)],
      chips: chipsFor([], null, chipCount, t),
      signals: ["S00n"],
      quotaNote,
    };
  }

  const domains = [...visibleDomains(ctx)].filter(
    (d): d is Exclude<OpenerDomain, "project"> => d !== "project",
  );
  const fallback = (): SidebarOpenerResult => ({
    ...l0,
    lines: [
      t(`${OPENER}signal.fallback`, {
        domains: domains.map((d) => t(`${OPENER}domain.${d}`)).join(", "),
      }),
    ],
    chips: chipsFor([], ctx, chipCount, t),
    signals: ["S00"],
    quotaNote,
  });

  // L2 is the faded state: the signal is dropped and only the neutral line stays.
  if (level === "l2") return fallback();

  const signals = selectSignals(ctx, role, enabledDomains ?? V1_ENABLED_DOMAINS);
  if (signals.length === 0) return fallback();

  // Requirement 6.12: on a narrow panel a second line costs more than it says.
  const shown = compact || level === "l0" ? signals.slice(0, 1) : signals;
  return {
    ...l0,
    lines: shown.map((s) => t(s.textKey, s.test(ctx) ?? {})),
    chips: chipsFor(shown, ctx, chipCount, t),
    signals: shown.map((s) => s.id),
    quotaNote,
  };
}
