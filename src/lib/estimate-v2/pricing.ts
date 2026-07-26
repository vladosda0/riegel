import type {
  EstimateV2Project,
  EstimateV2ResourceLine,
  EstimateV2Stage,
  ProjectMode,
  ResourceLineType,
} from "@/types/estimate-v2";

export interface ComputedLineTotals {
  lineId: string;
  type: ResourceLineType;
  costTotalCents: number;
  preDiscountTotalCents: number;
  clientUnitCents: number;
  clientTotalCents: number;
  marginCents: number;
  markupCents: number;
  discountCents: number;
}

export interface ProjectTotals {
  subtotalCents: number;
  taxableBaseCents: number;
  subtotalBeforeDiscountCents: number;
  taxAmountCents: number;
  totalCents: number;
  costTotalCents: number;
  markupTotalCents: number;
  discountTotalCents: number;
  breakdownByType: Record<ResourceLineType, number>;
}

export interface StageTotals {
  stageId: string;
  subtotalCents: number;
  taxableBaseCents: number;
  subtotalBeforeDiscountCents: number;
  taxAmountCents: number;
  totalCents: number;
  costTotalCents: number;
  markupTotalCents: number;
  discountTotalCents: number;
  breakdownByType: Record<ResourceLineType, number>;
}

export interface StageSubtotal {
  stageId: string;
  subtotalCents: number;
}

/** When true, `computeLineTotals` uses persisted `summaryClient*` on the line (RPC summary snapshot). */
export type ComputeLineTotalsOptions = {
  preferPersistedClientSnapshot?: boolean;
};

/** How client money is shown for an estimate line (align with `seamEstimateFinanceVisibilityMode`). */
export type EstimateLineClientDisplayMode = "detail" | "summary" | "none";

const BPS_BASE = 10_000;
const QTY_MILLI_BASE = 1_000;

function clampBps(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(BPS_BASE, Math.round(value)));
}

export function roundHalfUpDiv(numerator: number, denominator: number): number {
  if (denominator === 0) return 0;
  const sign = numerator < 0 ? -1 : 1;
  const abs = Math.abs(numerator);
  return sign * Math.floor((abs + denominator / 2) / denominator);
}

function multiplyBps(value: number, bps: number): number {
  return roundHalfUpDiv(value * bps, BPS_BASE);
}

function multiplyQtyMilli(valueCents: number, qtyMilli: number): number {
  return roundHalfUpDiv(valueCents * qtyMilli, QTY_MILLI_BASE);
}

function emptyBreakdownByType(): Record<ResourceLineType, number> {
  return {
    material: 0,
    tool: 0,
    labor: 0,
    subcontractor: 0,
    overhead: 0,
    other: 0,
  };
}

/**
 * Resolve the discount for a line: line override, else project.
 *
 * There is deliberately NO stage or work tier here. `EstimateV2Stage.discountBps`
 * and `EstimateV2Work.discountBps` exist in the model, are hydrated from
 * `project_stages.discount_bps`, are written back on every snapshot save, and are
 * seeded non-zero in the demo data, but nothing has ever read them for pricing.
 * No UI writes them either, so production rows are all 0 and no displayed number
 * is wrong today.
 *
 * This function previously took the stage and discarded it as `_stage`, which
 * advertised a capability it did not implement: the next person to wire a
 * stage-discount control would reasonably assume pricing already honoured it. The
 * parameter is gone so the signature tells the truth (rovno #207). Whether stage
 * and work discounts SHOULD apply is an open product question; implementing them
 * means adding the tiers here and deciding how they compose with the "0 means
 * inherit" rule below.
 */
export function computeEffectiveDiscountBps(
  line: Pick<EstimateV2ResourceLine, "discountBpsOverride">,
  project: Pick<EstimateV2Project, "discountBps">,
): number {
  // Treat null or 0 as "inherit from project" so global changes propagate to unset lines.
  if (line.discountBpsOverride != null && line.discountBpsOverride > 0) {
    return clampBps(line.discountBpsOverride);
  }
  return clampBps(project.discountBps);
}

export function computeEffectiveMarkupBps(
  line: Pick<EstimateV2ResourceLine, "markupBps">,
  project: Pick<EstimateV2Project, "markupBps">,
): number {
  if (line.markupBps > 0) return clampBps(line.markupBps);
  return clampBps(project.markupBps);
}

export function computeEffectiveTaxBps(
  line: Pick<EstimateV2ResourceLine, "taxBpsOverride">,
  project: Pick<EstimateV2Project, "taxBps">,
): number {
  if (line.taxBpsOverride != null && line.taxBpsOverride > 0) {
    return clampBps(line.taxBpsOverride);
  }
  return clampBps(project.taxBps);
}

export function computeClientUnitCents(
  costUnitCents: number,
  markupBps: number,
  discountBps: number,
): number {
  const markedUp = costUnitCents + multiplyBps(costUnitCents, clampBps(markupBps));
  const discountAmount = multiplyBps(markedUp, clampBps(discountBps));
  return Math.max(markedUp - discountAmount, 0);
}

/**
 * Client-facing unit/total for tables and CSV.
 * - `summary`: prefer persisted `summaryClient*` (RPC snapshot); missing → null.
 * - `detail` / `none`: always use `computed` so owner edits to cost/qty/markup/discount are not overridden
 *   by stale snapshot cents hydrated from the DB.
 */
export function displayLineClientAmounts(
  line: EstimateV2ResourceLine,
  computed: ComputedLineTotals,
  options?: { financeMode?: EstimateLineClientDisplayMode },
): Pick<ComputedLineTotals, "clientUnitCents" | "clientTotalCents"> | null {
  const mode = options?.financeMode ?? "detail";
  if (mode === "summary") {
    const su = line.summaryClientUnitCents;
    const st = line.summaryClientTotalCents;
    if (
      typeof su === "number"
      && Number.isFinite(su)
      && typeof st === "number"
      && Number.isFinite(st)
    ) {
      return { clientUnitCents: su, clientTotalCents: st };
    }
    return null;
  }
  return { clientUnitCents: computed.clientUnitCents, clientTotalCents: computed.clientTotalCents };
}

export function computeLineTotals(
  line: EstimateV2ResourceLine,
  stage: EstimateV2Stage,
  project: EstimateV2Project,
  projectMode: ProjectMode,
  options?: ComputeLineTotalsOptions,
): ComputedLineTotals {
  const qtyMilli = Math.max(0, Math.round(line.qtyMilli));
  const summaryUnit = line.summaryClientUnitCents;
  const summaryTotal = line.summaryClientTotalCents;
  if (
    options?.preferPersistedClientSnapshot
    && typeof summaryUnit === "number"
    && Number.isFinite(summaryUnit)
    && typeof summaryTotal === "number"
    && Number.isFinite(summaryTotal)
  ) {
    const costTotalCents = multiplyQtyMilli(line.costUnitCents, qtyMilli);
    return {
      lineId: line.id,
      type: line.type,
      costTotalCents,
      preDiscountTotalCents: summaryTotal,
      clientUnitCents: summaryUnit,
      clientTotalCents: summaryTotal,
      marginCents: summaryTotal - costTotalCents,
      markupCents: 0,
      discountCents: 0,
    };
  }

  const effectiveDiscountBps = computeEffectiveDiscountBps(line, project);
  const effectiveMarkupBps = projectMode === "build_myself" ? 0 : computeEffectiveMarkupBps(line, project);

  const costTotalCents = multiplyQtyMilli(line.costUnitCents, qtyMilli);
  const preDiscountUnitCents = line.costUnitCents + multiplyBps(line.costUnitCents, effectiveMarkupBps);
  const preDiscountTotalCents = multiplyQtyMilli(preDiscountUnitCents, qtyMilli);
  const clientUnitCents = computeClientUnitCents(line.costUnitCents, effectiveMarkupBps, effectiveDiscountBps);
  const clientTotalCents = multiplyQtyMilli(clientUnitCents, qtyMilli);

  return {
    lineId: line.id,
    type: line.type,
    costTotalCents,
    preDiscountTotalCents,
    clientUnitCents,
    clientTotalCents,
    marginCents: clientTotalCents - costTotalCents,
    markupCents: preDiscountTotalCents - costTotalCents,
    discountCents: preDiscountTotalCents - clientTotalCents,
  };
}

export function computeProjectTotals(
  project: EstimateV2Project,
  stages: EstimateV2Stage[],
  _works: unknown[],
  lines: EstimateV2ResourceLine[],
  projectMode: ProjectMode,
  options?: ComputeLineTotalsOptions,
): ProjectTotals {
  const stageById = new Map(stages.map((stage) => [stage.id, stage]));

  const breakdownByType = emptyBreakdownByType();

  let subtotalCents = 0;
  let costTotalCents = 0;
  let markupTotalCents = 0;
  let discountTotalCents = 0;

  let taxAmountCents = 0;
  lines.forEach((line) => {
    const stage = stageById.get(line.stageId);
    if (!stage) return;

    const totals = computeLineTotals(line, stage, project, projectMode, options);
    subtotalCents += totals.clientTotalCents;
    costTotalCents += totals.costTotalCents;
    markupTotalCents += totals.markupCents;
    discountTotalCents += totals.discountCents;
    breakdownByType[line.type] += totals.costTotalCents;
    taxAmountCents += multiplyBps(totals.clientTotalCents, computeEffectiveTaxBps(line, project));
  });

  const taxableBaseCents = subtotalCents;
  const subtotalBeforeDiscountCents = taxableBaseCents + discountTotalCents;
  return {
    subtotalCents: taxableBaseCents,
    taxableBaseCents,
    subtotalBeforeDiscountCents,
    taxAmountCents,
    totalCents: taxableBaseCents + taxAmountCents,
    costTotalCents,
    markupTotalCents,
    discountTotalCents,
    breakdownByType,
  };
}

export function computeStageTotals(
  project: EstimateV2Project,
  stages: EstimateV2Stage[],
  lines: EstimateV2ResourceLine[],
  projectMode: ProjectMode,
  options?: ComputeLineTotalsOptions,
): StageTotals[] {
  const stageById = new Map(stages.map((stage) => [stage.id, stage]));
  type StageAccumulator = Omit<StageTotals, "stageId" | "totalCents" | "subtotalBeforeDiscountCents" | "subtotalCents">;
  const totalsByStageId = new Map<string, StageAccumulator>();

  lines.forEach((line) => {
    const stage = stageById.get(line.stageId);
    if (!stage) return;

    const current: StageAccumulator = totalsByStageId.get(stage.id) ?? {
      taxableBaseCents: 0,
      costTotalCents: 0,
      markupTotalCents: 0,
      discountTotalCents: 0,
      taxAmountCents: 0,
      breakdownByType: emptyBreakdownByType(),
    };

    const lineTotals = computeLineTotals(line, stage, project, projectMode, options);
    current.taxableBaseCents += lineTotals.clientTotalCents;
    current.costTotalCents += lineTotals.costTotalCents;
    current.markupTotalCents += lineTotals.markupCents;
    current.discountTotalCents += lineTotals.discountCents;
    current.taxAmountCents += multiplyBps(lineTotals.clientTotalCents, computeEffectiveTaxBps(line, project));
    current.breakdownByType[line.type] += lineTotals.costTotalCents;

    totalsByStageId.set(stage.id, current);
  });

  return stages.map((stage) => {
    const byStage: StageAccumulator = totalsByStageId.get(stage.id) ?? {
      taxableBaseCents: 0,
      costTotalCents: 0,
      markupTotalCents: 0,
      discountTotalCents: 0,
      taxAmountCents: 0,
      breakdownByType: emptyBreakdownByType(),
    };
    const subtotalBeforeDiscountCents = byStage.taxableBaseCents + byStage.discountTotalCents;
    const taxAmountCents = byStage.taxAmountCents;
    const totalCents = byStage.taxableBaseCents + taxAmountCents;

    return {
      stageId: stage.id,
      subtotalCents: byStage.taxableBaseCents,
      taxableBaseCents: byStage.taxableBaseCents,
      subtotalBeforeDiscountCents,
      taxAmountCents,
      totalCents,
      costTotalCents: byStage.costTotalCents,
      markupTotalCents: byStage.markupTotalCents,
      discountTotalCents: byStage.discountTotalCents,
      breakdownByType: byStage.breakdownByType,
    };
  });
}

export function computeStageSubtotals(
  project: EstimateV2Project,
  stages: EstimateV2Stage[],
  lines: EstimateV2ResourceLine[],
  projectMode: ProjectMode,
  options?: ComputeLineTotalsOptions,
): StageSubtotal[] {
  const stageById = new Map(stages.map((stage) => [stage.id, stage]));
  const subtotalByStageId = new Map<string, number>();

  lines.forEach((line) => {
    const stage = stageById.get(line.stageId);
    if (!stage) return;
    const totals = computeLineTotals(line, stage, project, projectMode, options);
    subtotalByStageId.set(line.stageId, (subtotalByStageId.get(line.stageId) ?? 0) + totals.clientTotalCents);
  });

  return stages.map((stage) => ({
    stageId: stage.id,
    subtotalCents: subtotalByStageId.get(stage.id) ?? 0,
  }));
}

export function applyLastLineAdjustment(
  linesComputed: ComputedLineTotals[],
  targetTotalCents: number,
): ComputedLineTotals[] {
  if (linesComputed.length === 0) return linesComputed;

  const currentTotal = linesComputed.reduce((sum, line) => sum + line.clientTotalCents, 0);
  const delta = targetTotalCents - currentTotal;
  if (delta === 0) return linesComputed;

  const next = linesComputed.map((line) => ({ ...line }));
  const last = next[next.length - 1];
  last.clientTotalCents += delta;
  last.marginCents += delta;
  return next;
}
