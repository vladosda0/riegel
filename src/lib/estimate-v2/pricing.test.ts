import { describe, expect, it } from "vitest";
import type {
  EstimateV2Project,
  EstimateV2ResourceLine,
  EstimateV2Stage,
  ProjectMode,
  ResourceLineType,
} from "@/types/estimate-v2";
import {
  computeEffectiveDiscountBps,
  computeEffectiveMarkupBps,
  computeEffectiveTaxBps,
  computeClientUnitCents,
  computeLineTotals,
  computeProjectTotals,
  computeStageSubtotals,
  computeStageTotals,
  displayLineClientAmounts,
} from "@/lib/estimate-v2/pricing";

function createProject(partial: Partial<EstimateV2Project> = {}): EstimateV2Project {
  return {
    id: "estimate-1",
    projectId: "project-1",
    title: "Project",
    projectMode: "contractor",
    currency: "RUB",
    taxBps: 2000,
    discountBps: 500,
    markupBps: 2000,
    estimateStatus: "planning",
    receivedCents: 0,
    pnlPlaceholderCents: 0,
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
    ...partial,
  };
}

function createStage(partial: Partial<EstimateV2Stage> = {}): EstimateV2Stage {
  return {
    id: "stage-1",
    projectId: "project-1",
    title: "Stage",
    order: 1,
    discountBps: 0,
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
    ...partial,
  };
}

function createLine(partial: Partial<EstimateV2ResourceLine> = {}): EstimateV2ResourceLine {
  return {
    id: "line-1",
    projectId: "project-1",
    stageId: "stage-1",
    workId: "work-1",
    title: "Line",
    type: "material",
    unit: "pcs",
    qtyMilli: 1_000,
    costUnitCents: 10_000,
    markupBps: 2000,
    discountBpsOverride: null,
    assigneeId: null,
    assigneeName: null,
    assigneeEmail: null,
    receivedCents: 0,
    pnlPlaceholderCents: 0,
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
    ...partial,
  };
}

describe("estimate-v2 pricing", () => {
  it("inherits project discount when line override is absent or zero (stage tier removed)", () => {
    const project = createProject({ discountBps: 300 });
    expect(computeEffectiveDiscountBps(createLine({ discountBpsOverride: null }), project)).toBe(300);
    expect(computeEffectiveDiscountBps(createLine({ discountBpsOverride: 0 }), project)).toBe(300);
  });

  it("prefers positive line discount override over the project discount", () => {
    const project = createProject({ discountBps: 300 });
    const line = createLine({ discountBpsOverride: 2500 });

    expect(computeEffectiveDiscountBps(line, project)).toBe(2500);
  });

  it("inherits the project markup and tax when the line value is zero or unset", () => {
    // This is the rule the estimate CSV and the PDF payload print. Both used to
    // emit the RAW line.markupBps, so a line at 0 showed 0% while it was in fact
    // charged the project markup. They now go through this resolver, so the rule
    // needs a test of its own rather than only being exercised through totals.
    const project = createProject({ markupBps: 2500, taxBps: 2000 });
    expect(computeEffectiveMarkupBps(createLine({ markupBps: 0 }), project)).toBe(2500);
    expect(computeEffectiveMarkupBps(createLine({ markupBps: 1000 }), project)).toBe(1000);
    expect(computeEffectiveTaxBps(createLine({ taxBpsOverride: null }), project)).toBe(2000);
    expect(computeEffectiveTaxBps(createLine({ taxBpsOverride: 0 }), project)).toBe(2000);
    expect(computeEffectiveTaxBps(createLine({ taxBpsOverride: 500 }), project)).toBe(500);
  });

  it("clamps an out-of-band persisted rate on every resolver, so display cannot diverge from what is charged", () => {
    // The client hydration path reads these straight from the database with no
    // clamp, so a value outside [0, 10000] is reachable and self-sustaining. What
    // the table, the CSV and the PDF show must be what computeClientUnitCents
    // actually applies. Non-finite maps to 0, fractions round.
    const project = createProject({ discountBps: 0, markupBps: 0, taxBps: 0 });
    expect(computeEffectiveMarkupBps(createLine({ markupBps: 50_000 }), project)).toBe(10_000);
    expect(computeEffectiveMarkupBps(createLine({ markupBps: Number.POSITIVE_INFINITY }), project)).toBe(0);
    expect(computeEffectiveMarkupBps(createLine({ markupBps: Number.NaN }), project)).toBe(0);
    expect(computeEffectiveMarkupBps(createLine({ markupBps: 1250.6 }), project)).toBe(1251);
    expect(computeEffectiveDiscountBps(createLine({ discountBpsOverride: 20_000 }), project)).toBe(10_000);
    expect(computeEffectiveTaxBps(createLine({ taxBpsOverride: 20_000 }), project)).toBe(10_000);
  });

  it("ignores a non-zero stage discount, which is persisted but never priced (#207)", () => {
    // Pins the documented behaviour so a future stage-discount feature has to
    // change this test deliberately rather than silently start applying a
    // discount that has been sitting in the database all along.
    const project = createProject({ discountBps: 300 });
    const stage = createStage({ discountBps: 1200 });
    const line = createLine({ discountBpsOverride: null });

    const totals = computeLineTotals(line, stage, project, "contractor");
    const withoutStageDiscount = computeLineTotals(
      line,
      createStage({ discountBps: 0 }),
      project,
      "contractor",
    );

    expect(totals.clientTotalCents).toBe(withoutStageDiscount.clientTotalCents);
    expect(totals.discountCents).toBe(withoutStageDiscount.discountCents);
  });

  it("applies markup to labor and subcontractor lines in contractor mode", () => {
    const project = createProject();
    const stage = createStage();
    const labor = createLine({ id: "line-labor", type: "labor" });
    const subcontractor = createLine({ id: "line-sub", type: "subcontractor" });

    const laborTotals = computeLineTotals(labor, stage, project, "contractor");
    const subTotals = computeLineTotals(subcontractor, stage, project, "contractor");

    expect(laborTotals.clientUnitCents).toBeGreaterThan(labor.costUnitCents);
    expect(subTotals.clientUnitCents).toBeGreaterThan(subcontractor.costUnitCents);
  });

  it("forces markup to zero in build_myself regime", () => {
    const project = createProject({ discountBps: 0, markupBps: 0 });
    const stage = createStage();
    const line = createLine({ markupBps: 4000, discountBpsOverride: null });

    const totals = computeLineTotals(line, stage, project, "build_myself");

    expect(totals.clientUnitCents).toBe(line.costUnitCents);
    expect(totals.markupCents).toBe(0);
  });

  it("computes tax and total deterministically", () => {
    const project = createProject({ taxBps: 1000, markupBps: 0, discountBps: 0 });
    const stage = createStage();
    const lines = [
      createLine({ id: "l1", type: "material" as ResourceLineType, costUnitCents: 10_000, qtyMilli: 1_000, markupBps: 0, discountBpsOverride: null }),
      createLine({ id: "l2", type: "labor" as ResourceLineType, costUnitCents: 5_000, qtyMilli: 2_000, markupBps: 0, discountBpsOverride: null }),
    ];

    const totals = computeProjectTotals(project, [stage], [], lines, "contractor");

    expect(totals.subtotalCents).toBe(20_000);
    expect(totals.taxableBaseCents).toBe(20_000);
    expect(totals.subtotalBeforeDiscountCents).toBe(20_000);
    expect(totals.taxAmountCents).toBe(2_000);
    expect(totals.totalCents).toBe(22_000);
  });

  it("uses half-up rounding for edge values", () => {
    const unit = computeClientUnitCents(1, 5000, 0); // 1.5 => 2 with half-up
    expect(unit).toBe(2);

    const project = createProject({ taxBps: 5000, markupBps: 0, discountBps: 0 });
    const stage = createStage();
    const line = createLine({ costUnitCents: 1, qtyMilli: 1_000, markupBps: 0, discountBpsOverride: null });
    const totals = computeLineTotals(line, stage, project, "contractor" as ProjectMode);

    expect(totals.clientTotalCents).toBe(1);
  });

  it("computes stage subtotals from client line totals", () => {
    const project = createProject({ taxBps: 0, discountBps: 0, markupBps: 0 });
    const stages = [
      createStage({ id: "stage-a", order: 1 }),
      createStage({ id: "stage-b", order: 2 }),
    ];
    const lines = [
      createLine({ id: "l1", stageId: "stage-a", costUnitCents: 1_000, qtyMilli: 1_000, markupBps: 0, discountBpsOverride: null }),
      createLine({ id: "l2", stageId: "stage-a", costUnitCents: 2_000, qtyMilli: 2_000, markupBps: 0, discountBpsOverride: null }),
      createLine({ id: "l3", stageId: "stage-b", costUnitCents: 3_000, qtyMilli: 1_000, markupBps: 0, discountBpsOverride: null }),
    ];

    const subtotals = computeStageSubtotals(project, stages, lines, "contractor");
    const byStage = new Map(subtotals.map((item) => [item.stageId, item.subtotalCents]));

    expect(byStage.get("stage-a")).toBe(5_000);
    expect(byStage.get("stage-b")).toBe(3_000);
  });

  it("applies project-level discount and tax to total", () => {
    const project = createProject({ discountBps: 1_000, taxBps: 2_200, markupBps: 0 });
    const stage = createStage();
    const lines = [
      createLine({ id: "l1", costUnitCents: 10_000, qtyMilli: 1_000, markupBps: 0, discountBpsOverride: null }),
      createLine({ id: "l2", costUnitCents: 10_000, qtyMilli: 1_000, markupBps: 0, discountBpsOverride: null }),
    ];

    const totals = computeProjectTotals(project, [stage], [], lines, "contractor");
    expect(totals.subtotalCents).toBe(18_000);
    expect(totals.taxableBaseCents).toBe(18_000);
    expect(totals.subtotalBeforeDiscountCents).toBe(20_000);
    expect(totals.taxAmountCents).toBe(3_960);
    expect(totals.totalCents).toBe(21_960);
  });

  it("computes stage totals with tax applied to post-discount base", () => {
    const project = createProject({ discountBps: 0, taxBps: 2_000, markupBps: 0 });
    const stages = [
      createStage({ id: "stage-a", order: 1 }),
      createStage({ id: "stage-b", order: 2 }),
    ];
    const lines = [
      createLine({ id: "l1", stageId: "stage-a", costUnitCents: 10_000, qtyMilli: 1_000, markupBps: 0, discountBpsOverride: 1_000 }),
      createLine({ id: "l2", stageId: "stage-b", costUnitCents: 5_000, qtyMilli: 1_000, markupBps: 0, discountBpsOverride: null }),
    ];

    const totals = computeStageTotals(project, stages, lines, "contractor");
    const stageA = totals.find((item) => item.stageId === "stage-a");
    const stageB = totals.find((item) => item.stageId === "stage-b");

    expect(stageA?.taxableBaseCents).toBe(9_000);
    expect(stageA?.subtotalBeforeDiscountCents).toBe(10_000);
    expect(stageA?.discountTotalCents).toBe(1_000);
    expect(stageA?.taxAmountCents).toBe(1_800);
    expect(stageA?.totalCents).toBe(10_800);

    expect(stageB?.taxableBaseCents).toBe(5_000);
    expect(stageB?.subtotalBeforeDiscountCents).toBe(5_000);
    expect(stageB?.discountTotalCents).toBe(0);
    expect(stageB?.taxAmountCents).toBe(1_000);
    expect(stageB?.totalCents).toBe(6_000);
  });

  it("exposes material and tool cost subtotal for procurement budget (ex VAT)", () => {
    const project = createProject({ discountBps: 1_500, taxBps: 2_000 });
    const stage = createStage();
    const lines = [
      createLine({ id: "l-material", type: "material", costUnitCents: 10_000, qtyMilli: 1_000 }),
      createLine({ id: "l-tool", type: "tool", costUnitCents: 5_555, qtyMilli: 1_500 }),
      createLine({ id: "l-labor", type: "labor", costUnitCents: 7_000, qtyMilli: 2_000 }),
    ];

    const totals = computeProjectTotals(project, [stage], [], lines, "contractor");
    const procurementSubtotalCents = totals.breakdownByType.material + totals.breakdownByType.tool;

    expect(totals.breakdownByType.material).toBe(10_000);
    expect(totals.breakdownByType.tool).toBe(8_333);
    expect(procurementSubtotalCents).toBe(18_333);
  });

  it("populates a finite bucket for every ResourceLineType (no NaN drift on overhead lines)", () => {
    const project = createProject({ discountBps: 0, markupBps: 0, taxBps: 0 });
    const stage = createStage();
    const lines = [
      createLine({ id: "l-material", type: "material", costUnitCents: 1_000, qtyMilli: 1_000 }),
      createLine({ id: "l-tool", type: "tool", costUnitCents: 1_000, qtyMilli: 1_000 }),
      createLine({ id: "l-labor", type: "labor", costUnitCents: 1_000, qtyMilli: 1_000 }),
      createLine({ id: "l-sub", type: "subcontractor", costUnitCents: 1_000, qtyMilli: 1_000 }),
      createLine({ id: "l-overhead", type: "overhead", costUnitCents: 1_000, qtyMilli: 1_000 }),
      createLine({ id: "l-other", type: "other", costUnitCents: 1_000, qtyMilli: 1_000 }),
    ];

    const totals = computeProjectTotals(project, [stage], [], lines, "contractor");
    const buckets = totals.breakdownByType;
    const allTypes: ResourceLineType[] = ["material", "tool", "labor", "subcontractor", "overhead", "other"];
    for (const type of allTypes) {
      expect(Number.isFinite(buckets[type])).toBe(true);
      expect(buckets[type]).toBe(1_000);
    }
  });

  it("displayLineClientAmounts prefers summary RPC cents when both are finite (summary mode)", () => {
    const project = createProject();
    const stage = createStage();
    const line = createLine({
      costUnitCents: 0,
      summaryClientUnitCents: 123,
      summaryClientTotalCents: 456,
    });
    const computed = computeLineTotals(line, stage, project, "contractor");
    const display = displayLineClientAmounts(line, computed, { financeMode: "summary" });
    expect(display?.clientUnitCents).toBe(123);
    expect(display?.clientTotalCents).toBe(456);
  });

  it("displayLineClientAmounts returns null in summary mode when snapshot cents are absent", () => {
    const project = createProject();
    const stage = createStage();
    const line = createLine({ costUnitCents: 0 });
    const computed = computeLineTotals(line, stage, project, "contractor");
    expect(displayLineClientAmounts(line, computed, { financeMode: "summary" })).toBeNull();
  });

  it("detail mode uses computed client cents even when persisted summary cents exist (owner edit path)", () => {
    const project = createProject({ discountBps: 0 });
    const stage = createStage();
    const line = createLine({
      costUnitCents: 10_000,
      qtyMilli: 2_000,
      markupBps: 1_000,
      summaryClientUnitCents: 9_999,
      summaryClientTotalCents: 19_998,
    });
    const computed = computeLineTotals(line, stage, project, "contractor");
    const display = displayLineClientAmounts(line, computed, { financeMode: "detail" });
    expect(display?.clientUnitCents).toBe(computed.clientUnitCents);
    expect(display?.clientTotalCents).toBe(computed.clientTotalCents);
    expect(display?.clientUnitCents).not.toBe(9_999);
  });

  it("computeLineTotals uses persisted snapshot only when preferPersistedClientSnapshot is true", () => {
    const project = createProject();
    const stage = createStage();
    const line = createLine({
      costUnitCents: 50_000,
      qtyMilli: 1_000,
      markupBps: 5_000,
      summaryClientUnitCents: 1,
      summaryClientTotalCents: 2,
    });
    const fromSnapshot = computeLineTotals(line, stage, project, "contractor", {
      preferPersistedClientSnapshot: true,
    });
    expect(fromSnapshot.clientUnitCents).toBe(1);
    expect(fromSnapshot.clientTotalCents).toBe(2);

    const fromFormula = computeLineTotals(line, stage, project, "contractor");
    expect(fromFormula.clientUnitCents).not.toBe(1);
    expect(fromFormula.markupCents).toBeGreaterThan(0);
  });
});
