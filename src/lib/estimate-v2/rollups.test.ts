import { beforeEach, describe, expect, it } from "vitest";
import { __unsafeResetHrForTests, addPayment, createFromEstimateLine, setStatus } from "@/data/hr-store";
import { __unsafeResetInventoryForTests } from "@/data/inventory-store";
import {
  __unsafeResetOrdersForTests,
  createDraftOrder,
  placeOrder,
} from "@/data/order-store";
import { addProcurementItem } from "@/data/procurement-store";
import { shapeOrdersWithDetails } from "@/data/orders-source";
import {
  __private,
  combinePlanFact,
  computeFactFromDataSources,
  computeFactFromProcurementAndHR,
  computePlannedFromEstimateV2,
  hasActualFinancialData,
} from "@/lib/estimate-v2/rollups";
import type { OrderWithLines, ProcurementItemV2 } from "@/types/entities";
import type { EstimateV2Project, EstimateV2ResourceLine, EstimateV2Stage } from "@/types/estimate-v2";

function project(partial: Partial<EstimateV2Project> = {}): EstimateV2Project {
  return {
    id: "estimate-v2-1",
    projectId: "project-1",
    title: "Project",
    projectMode: "contractor",
    currency: "RUB",
    taxBps: 1_000,
    discountBps: 0,
    markupBps: 0,
    estimateStatus: "in_work",
    receivedCents: 0,
    pnlPlaceholderCents: 0,
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
    ...partial,
  };
}

function stage(): EstimateV2Stage {
  return {
    id: "stage-1",
    projectId: "project-1",
    title: "Stage",
    order: 1,
    discountBps: 0,
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
  };
}

function line(partial: Partial<EstimateV2ResourceLine>): EstimateV2ResourceLine {
  return {
    id: partial.id ?? "line-1",
    projectId: partial.projectId ?? "project-1",
    stageId: partial.stageId ?? "stage-1",
    workId: partial.workId ?? "work-1",
    title: partial.title ?? "Line",
    type: partial.type ?? "material",
    unit: partial.unit ?? "pcs",
    qtyMilli: partial.qtyMilli ?? 1_000,
    costUnitCents: partial.costUnitCents ?? 10_000,
    markupBps: partial.markupBps ?? 0,
    discountBpsOverride: partial.discountBpsOverride ?? null,
    assigneeId: null,
    assigneeName: null,
    assigneeEmail: null,
    receivedCents: 0,
    pnlPlaceholderCents: 0,
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
  };
}

describe("estimate-v2 rollups", () => {
  beforeEach(() => {
    __unsafeResetOrdersForTests();
    __unsafeResetInventoryForTests();
    __unsafeResetHrForTests();
  });

  it("computes planned rollups from estimate pricing", () => {
    const planned = computePlannedFromEstimateV2({
      project: project(),
      stages: [stage()],
      lines: [
        line({ id: "line-m", type: "material", qtyMilli: 1_000, costUnitCents: 10_000 }),
        line({ id: "line-l", type: "labor", qtyMilli: 2_000, costUnitCents: 5_000 }),
      ],
    });

    expect(planned.plannedSubtotalCents).toBe(20_000);
    expect(planned.plannedTaxCents).toBe(2_000);
    // plannedBudgetCents is the cost basis (себестоимость); here cost == subtotal (no markup).
    expect(planned.plannedBudgetCents).toBe(20_000);
    expect(planned.plannedCostByTypeCents.material).toBe(10_000);
    expect(planned.plannedCostByTypeCents.labor).toBe(10_000);
  });

  it("populates a finite plannedCostByTypeCents bucket for every ResourceLineType (no NaN drift on overhead lines)", () => {
    const planned = computePlannedFromEstimateV2({
      project: project({ taxBps: 0 }),
      stages: [stage()],
      lines: [
        line({ id: "line-material", type: "material", qtyMilli: 1_000, costUnitCents: 1_000 }),
        line({ id: "line-tool", type: "tool", qtyMilli: 1_000, costUnitCents: 1_000 }),
        line({ id: "line-labor", type: "labor", qtyMilli: 1_000, costUnitCents: 1_000 }),
        line({ id: "line-sub", type: "subcontractor", qtyMilli: 1_000, costUnitCents: 1_000 }),
        line({ id: "line-overhead", type: "overhead", qtyMilli: 1_000, costUnitCents: 1_000 }),
        line({ id: "line-other", type: "other", qtyMilli: 1_000, costUnitCents: 1_000 }),
      ],
    });

    const buckets = planned.plannedCostByTypeCents;
    for (const type of ["material", "tool", "labor", "subcontractor", "overhead", "other"] as const) {
      expect(Number.isFinite(buckets[type])).toBe(true);
      expect(buckets[type]).toBe(1_000);
    }
  });

  it("computes fact rollups with orphan handling and unpaid formulas", () => {
    const projectId = `rollup-fact-${Date.now()}`;

    const linkedItem = addProcurementItem({
      id: `proc-linked-${Date.now()}`,
      projectId,
      stageId: "stage-1",
      categoryId: null,
      type: "material",
      name: "Linked material",
      spec: null,
      unit: "pcs",
      requiredByDate: null,
      requiredQty: 5,
      orderedQty: 0,
      receivedQty: 0,
      plannedUnitPrice: 100,
      actualUnitPrice: 120,
      supplier: null,
      supplierPreferred: null,
      locationPreferredId: null,
      lockedFromEstimate: true,
      sourceEstimateItemId: null,
      sourceEstimateV2LineId: "line-linked",
      orphaned: false,
      orphanedAt: null,
      orphanedReason: null,
      linkUrl: null,
      notes: null,
      attachments: [],
      createdFrom: "estimate",
      linkedTaskIds: [],
      archived: false,
    });

    const orphanItem = addProcurementItem({
      id: `proc-orphan-${Date.now()}`,
      projectId,
      stageId: "stage-1",
      categoryId: null,
      type: "tool",
      name: "Orphan tool",
      spec: null,
      unit: "pcs",
      requiredByDate: null,
      requiredQty: 1,
      orderedQty: 0,
      receivedQty: 0,
      plannedUnitPrice: 80,
      actualUnitPrice: 90,
      supplier: null,
      supplierPreferred: null,
      locationPreferredId: null,
      lockedFromEstimate: true,
      sourceEstimateItemId: null,
      sourceEstimateV2LineId: null,
      orphaned: true,
      orphanedAt: "2026-01-01T00:00:00.000Z",
      orphanedReason: "estimate_line_deleted",
      linkUrl: null,
      notes: null,
      attachments: [],
      createdFrom: "estimate",
      linkedTaskIds: [],
      archived: false,
    });

    const draftA = createDraftOrder({
      projectId,
      kind: "supplier",
      supplierName: "Supplier A",
      lines: [{ procurementItemId: linkedItem.id, qty: 2, unit: "pcs", plannedUnitPrice: 100, actualUnitPrice: 120 }],
    });
    placeOrder(draftA.id);

    const draftB = createDraftOrder({
      projectId,
      kind: "supplier",
      supplierName: "Supplier B",
      lines: [{ procurementItemId: orphanItem.id, qty: 1, unit: "pcs", plannedUnitPrice: 80, actualUnitPrice: 90 }],
    });
    placeOrder(draftB.id);

    const hrItem = createFromEstimateLine(projectId, "line-hr", {
      stageId: "stage-1",
      workId: "work-1",
      title: "Crew",
      type: "labor",
      plannedQty: 10,
      plannedRate: 50,
    });
    setStatus(hrItem.id, "planned");
    addPayment(hrItem.id, 200, "2026-01-01T00:00:00.000Z");

    const fact = computeFactFromProcurementAndHR(projectId);

    expect(fact.spentByTypeCents.material).toBe(24_000);
    expect(fact.spentByTypeCents.tool).toBe(9_000);
    expect(fact.spentByTypeCents.labor).toBe(20_000);
    expect(fact.spentCents).toBe(53_000);

    expect(fact.spentAbovePlannedCents).toBe(13_000);
    expect(fact.toBePaidPlannedCents).toBe(80_000);
  });

  it("combines schedule metrics with behind-schedule gating", () => {
    const combined = combinePlanFact(
      {
        plannedBudgetCents: 100,
        plannedCostByTypeCents: { material: 10, tool: 10, labor: 10, subcontractor: 10, overhead: 10, other: 10 },
        plannedSubtotalCents: 80,
        plannedTaxCents: 20,
      },
      {
        spentCents: 50,
        spentByTypeCents: { material: 10, tool: 10, labor: 10, subcontractor: 10, overhead: 10, other: 10 },
        unattributedSpendCents: 0,
        toBePaidPlannedCents: 25,
        spentAbovePlannedCents: -5,
      },
      {
        capturedAt: "2026-01-01T00:00:00.000Z",
        projectBaselineStart: "2020-01-01T00:00:00.000Z",
        projectBaselineEnd: "2020-01-03T00:00:00.000Z",
        works: [],
      },
      { unfinishedTaskCount: 1 },
    );

    expect(combined.durationPlannedDays).toBe(3);
    expect(combined.daysToEnd).toBeLessThan(0);
    expect(combined.behindScheduleDays).toBeGreaterThan(0);
  });

  it("private fact helper treats orphan planned as zero in spent-above-planned", () => {
    const fact = __private.computeFactFromData({
      procurementItems: [
        {
          id: "p-1",
          projectId: "project",
          stageId: null,
          categoryId: null,
          type: "material",
          name: "M",
          spec: null,
          unit: "pcs",
          requiredByDate: null,
          requiredQty: 1,
          orderedQty: 0,
          receivedQty: 0,
          plannedUnitPrice: 100,
          actualUnitPrice: 120,
          supplier: null,
          supplierPreferred: null,
          locationPreferredId: null,
          lockedFromEstimate: true,
          sourceEstimateItemId: null,
          sourceEstimateV2LineId: null,
          orphaned: true,
          orphanedAt: null,
          orphanedReason: "estimate_line_deleted",
          linkUrl: null,
          notes: null,
          attachments: [],
          createdFrom: "estimate",
          linkedTaskIds: [],
          archived: false,
          createdAt: "2025-01-01T00:00:00.000Z",
          updatedAt: "2025-01-01T00:00:00.000Z",
        },
      ],
      orders: [{
        id: "o-1",
        projectId: "project",
        status: "placed",
        kind: "supplier",
        supplierName: "S",
        deliverToLocationId: null,
        fromLocationId: null,
        toLocationId: null,
        dueDate: null,
        deliveryDeadline: null,
        invoiceAttachment: null,
        note: null,
        createdAt: "2025-01-01T00:00:00.000Z",
        updatedAt: "2025-01-01T00:00:00.000Z",
        lines: [{
          id: "ol-1",
          orderId: "o-1",
          procurementItemId: "p-1",
          qty: 1,
          receivedQty: 0,
          unit: "pcs",
          plannedUnitPrice: 100,
          actualUnitPrice: 120,
        }],
      }],
      hrItems: [],
      hrPayments: [],
    });

    expect(fact.spentAbovePlannedCents).toBe(12_000);
  });

  const PARTIAL_ITEM = {
    id: "p-1",
    projectId: "project",
    stageId: null,
    categoryId: null,
    type: "material",
    name: "M",
    spec: null,
    unit: "pcs",
    requiredByDate: null,
    requiredQty: 10,
    orderedQty: 10,
    receivedQty: 4,
    plannedUnitPrice: 100,
    actualUnitPrice: null,
    supplier: null,
    supplierPreferred: null,
    locationPreferredId: null,
    lockedFromEstimate: false,
    sourceEstimateItemId: null,
    sourceEstimateV2LineId: null,
    orphaned: false,
    orphanedAt: null,
    orphanedReason: null,
    linkUrl: null,
    notes: null,
    attachments: [],
    createdFrom: "manual",
    linkedTaskIds: [],
    archived: false,
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
  } as const;

  /** One supplier order, qty 10, 4 of them delivered, planned unit price 100. */
  function partialReceiptInput(
    status: OrderWithLines["status"],
    itemOverrides: Partial<ProcurementItemV2> = {},
    lineOverrides: Partial<OrderWithLines["lines"][number]> = {},
  ) {
    return {
      procurementItems: [{ ...PARTIAL_ITEM, ...itemOverrides } as ProcurementItemV2],
      orders: [{
        id: "o-1",
        projectId: "project",
        status,
        kind: "supplier",
        supplierName: "S",
        deliverToLocationId: null,
        fromLocationId: null,
        toLocationId: null,
        dueDate: null,
        deliveryDeadline: null,
        invoiceAttachment: null,
        note: null,
        createdAt: "2025-01-01T00:00:00.000Z",
        updatedAt: "2025-01-01T00:00:00.000Z",
        lines: [{
          id: "ol-1",
          orderId: "o-1",
          procurementItemId: "p-1",
          qty: 10,
          receivedQty: 4,
          unit: "pcs",
          plannedUnitPrice: 100,
          actualUnitPrice: null,
          ...lineOverrides,
        }],
      }] as unknown as OrderWithLines[],
      hrItems: [],
      hrPayments: [],
    };
  }

  it("counts partially received supplier orders as spend", () => {
    const fact = __private.computeFactFromData(partialReceiptInput("partially_received"));

    expect(fact.spentCents).toBe(100_000);
    expect(fact.spentByTypeCents.material).toBe(100_000);
    // The open remainder only: 6 undelivered units x planned 100. Asserting this alongside
    // spend is the point — counting the full order as spent while still reporting the full
    // order as owed would imply 2x the order's cost in the finance header.
    expect(fact.toBePaidPlannedCents).toBe(60_000);
  });

  it("treats partially_received like placed on both the spend and the to-be-paid side", () => {
    const partial = __private.computeFactFromData(partialReceiptInput("partially_received"));
    const placed = __private.computeFactFromData(partialReceiptInput("placed"));
    const received = __private.computeFactFromData(partialReceiptInput("received"));

    expect({ spent: partial.spentCents, toBePaid: partial.toBePaidPlannedCents })
      .toEqual({ spent: placed.spentCents, toBePaid: placed.toBePaidPlannedCents });
    // ...and the fully received end of the range still owes nothing.
    expect(received.spentCents).toBe(100_000);
    expect(received.toBePaidPlannedCents).toBe(0);
  });

  it("tracks the to-be-paid remainder down as a partially received order is filled", () => {
    const nearlyDone = __private.computeFactFromData(
      partialReceiptInput("partially_received", {}, { receivedQty: 9 }),
    );

    expect(nearlyDone.spentCents).toBe(100_000);
    expect(nearlyDone.toBePaidPlannedCents).toBe(10_000);
  });

  it("counts partially received spend above planned for estimate-scoped items", () => {
    const fact = __private.computeFactFromData(partialReceiptInput(
      "partially_received",
      { sourceEstimateV2LineId: "line-1", plannedUnitPrice: 80 },
      { actualUnitPrice: 100 },
    ));

    // 10 x 100 actually spent against 10 x 80 planned.
    expect(fact.spentCents).toBe(100_000);
    expect(fact.spentAbovePlannedCents).toBe(20_000);
  });
});

describe("hasActualFinancialData", () => {
  function supplierOrder(status: OrderWithLines["status"], lineCount = 1): OrderWithLines {
    return {
      id: "o-1",
      projectId: "project",
      status,
      kind: "supplier",
      supplierName: "S",
      deliverToLocationId: null,
      fromLocationId: null,
      toLocationId: null,
      dueDate: null,
      deliveryDeadline: null,
      invoiceAttachment: null,
      note: null,
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
      lines: Array.from({ length: lineCount }, (_, index) => ({
        id: `ol-${index}`,
        orderId: "o-1",
        procurementItemId: "p-1",
        qty: 10,
        receivedQty: 4,
        unit: "pcs",
        plannedUnitPrice: 100,
        actualUnitPrice: null,
      })),
    } as unknown as OrderWithLines;
  }

  // The gate must admit every state computeFactFromDataSources counts as spend, or the
  // corrected figure is computed and then rendered as «—».
  it.each(["placed", "partially_received", "received"] as const)(
    "shows the finance header for a %s supplier order",
    (status) => {
      expect(hasActualFinancialData({ hrPaymentCount: 0, orders: [supplierOrder(status)] })).toBe(true);
    },
  );

  it.each(["draft", "voided"] as const)("keeps the header hidden for a %s order", (status) => {
    expect(hasActualFinancialData({ hrPaymentCount: 0, orders: [supplierOrder(status)] })).toBe(false);
  });

  it("keeps the header hidden for an order with no lines", () => {
    expect(hasActualFinancialData({ hrPaymentCount: 0, orders: [supplierOrder("partially_received", 0)] }))
      .toBe(false);
  });

  it("shows the header on HR payments alone", () => {
    expect(hasActualFinancialData({ hrPaymentCount: 1, orders: [] })).toBe(true);
  });
});

describe("partially received orders end to end (issue #204)", () => {
  // Guards the whole path, DB rows -> shapeOrdersWithDetails -> rollup, rather than each half
  // in isolation. The two halves individually looked correct while the mapper was quietly
  // flattening 'partially_received' into 'placed', which is what made the original audit of
  // this issue misread an unreachable state as a live money bug.
  it("keeps spend, to-be-paid and the display gate coherent for a real part-delivery", () => {
    const orders = shapeOrdersWithDetails({
      orderRows: [{
        id: "o1",
        project_id: "p1",
        status: "partially_received",
        supplier_name: "S",
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
        transfer_direction: null,
      } as never],
      lineRows: [{
        id: "ol1",
        order_id: "o1",
        procurement_item_id: "pi-1",
        title: "M",
        item_type: "material",
        quantity: 10,
        unit: "pcs",
        unit_price_cents: null,
        total_price_cents: null,
        created_at: "2026-01-01T00:00:00Z",
      } as never],
      movementRows: [{
        id: "m1",
        project_id: "p1",
        order_line_id: "ol1",
        inventory_item_id: "ii1",
        inventory_location_id: "loc1",
        movement_type: "receipt",
        delta_qty: 4,
        created_at: "2026-01-02T00:00:00Z",
      } as never],
      procurementItemRows: [{
        id: "pi-1",
        title: "M",
        unit: "pcs",
        planned_unit_price_cents: 10_000,
      } as never],
    });

    expect(orders[0].status).toBe("partially_received");
    expect(orders[0].lines[0]?.receivedQty).toBe(4);

    const fact = computeFactFromDataSources({
      procurementItems: [{
        id: "pi-1",
        projectId: "p1",
        type: "material",
        name: "M",
        unit: "pcs",
        requiredQty: 10,
        plannedUnitPrice: 100,
        actualUnitPrice: null,
        sourceEstimateV2LineId: null,
        orphaned: false,
        archived: false,
      } as unknown as ProcurementItemV2],
      orders,
      hrItems: [],
      hrPayments: [],
    });

    // Full ordered value committed, only the 6 undelivered units still owed.
    expect(fact.spentCents).toBe(100_000);
    expect(fact.toBePaidPlannedCents).toBe(60_000);
    expect(hasActualFinancialData({ hrPaymentCount: 0, orders })).toBe(true);
  });
});
