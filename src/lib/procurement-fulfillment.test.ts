import { describe, expect, it } from "vitest";
import {
  computeLastReceivedAt,
  computeProcurementHeaderKpis,
  computeProjectLastReceivedAt,
  computePurchasePriceVariance,
  computeTabChipTotals,
  collectItemLocationEventHistory,
  computeFulfilledQty,
  computeInStockByLocation,
  computeOrderedOpenQty,
  computeRemainingRequestedQty,
  isAppliedOrderStatus,
  isEstimateLinkedProcurementItem,
  isOpenOrderStatus,
} from "@/lib/procurement-fulfillment";
import type { InventoryLocation, OrderWithLines, ProcurementItemV2 } from "@/types/entities";

function buildTestRequestLine(
  projectId: string,
  id: string,
  requiredQty = 10,
  overrides: Partial<ProcurementItemV2> = {},
) {
  return {
    id,
    projectId,
    stageId: null,
    categoryId: null,
    type: "material",
    name: `Item ${id}`,
    spec: "Spec",
    unit: "pcs",
    requiredByDate: null,
    requiredQty,
    orderedQty: 0,
    receivedQty: 0,
    plannedUnitPrice: 100,
    actualUnitPrice: 120,
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
    createdAt: "2026-03-01T00:00:00.000Z",
    updatedAt: "2026-03-01T00:00:00.000Z",
    ...overrides,
  } satisfies ProcurementItemV2;
}

describe("procurement fulfillment utils", () => {
  it("detects estimate-linked procurement requests by active v2 linkage only", () => {
    expect(isEstimateLinkedProcurementItem({
      sourceEstimateV2LineId: "line-1",
      sourceEstimateItemId: null,
    } as ProcurementItemV2)).toBe(true);
    expect(isEstimateLinkedProcurementItem({
      sourceEstimateV2LineId: null,
      sourceEstimateItemId: "legacy-1",
    } as ProcurementItemV2)).toBe(false);
    expect(isEstimateLinkedProcurementItem({
      sourceEstimateV2LineId: null,
      sourceEstimateItemId: null,
    } as ProcurementItemV2)).toBe(false);
  });

  // Retitled and re-expected under the #216 decision: a same-project warehouse move is a
  // relocation, not a fulfillment. The old title asserted the double count as intended.
  it("counts the supplier order but not the same-project stock move toward the requirement", () => {
    const projectId = `test-project-${Date.now()}`;
    const item = buildTestRequestLine(projectId, `req-${Date.now()}`, 10);

    const orders: OrderWithLines[] = [
      {
        id: "o-1",
        projectId,
        status: "placed",
        kind: "supplier",
        supplierName: "Supplier A",
        deliverToLocationId: "loc-site",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lines: [
          {
            id: "l-1",
            orderId: "o-1",
            procurementItemId: item.id,
            qty: 3,
            receivedQty: 1,
            unit: "pcs",
            plannedUnitPrice: 100,
            actualUnitPrice: 120,
          },
        ],
      },
      {
        id: "o-2",
        projectId,
        status: "received",
        kind: "stock",
        fromLocationId: "loc-a",
        toLocationId: "loc-site",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lines: [
          {
            id: "l-2",
            orderId: "o-2",
            procurementItemId: item.id,
            qty: 4,
            receivedQty: 4,
            unit: "pcs",
            plannedUnitPrice: 100,
            actualUnitPrice: 120,
          },
        ],
      },
      {
        id: "o-voided",
        projectId,
        status: "voided",
        kind: "supplier",
        supplierName: "Supplier B",
        deliverToLocationId: "loc-site",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lines: [
          {
            id: "l-voided",
            orderId: "o-voided",
            procurementItemId: item.id,
            qty: 2,
            receivedQty: 0,
            unit: "pcs",
            plannedUnitPrice: 100,
            actualUnitPrice: 120,
          },
        ],
      },
    ];

    // 10 required, 3 on a supplier order. The 4-unit stock move relocates units the supplier
    // order already counted, so it must not subtract again. Ordered-open is unaffected: it
    // filters to supplier orders already.
    expect(computeRemainingRequestedQty(item, orders)).toBe(7);
    expect(computeOrderedOpenQty(item.id, orders)).toBe(2);
    expect(computeFulfilledQty(item.id, orders)).toBe(3);
  });

  it("does not let an internal warehouse move fulfil a procurement requirement", () => {
    // The exact scenario from #216: the same 60 units counted twice, once by the supplier
    // order that bought them and once by the move that carried them across the site.
    const projectId = `internal-move-${Date.now()}`;
    const item = buildTestRequestLine(projectId, `req-move-${Date.now()}`, 100);
    const orders: OrderWithLines[] = [
      {
        id: "o-supplier",
        projectId,
        status: "received",
        kind: "supplier",
        supplierName: "Supplier A",
        deliverToLocationId: "loc-a",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lines: [
          {
            id: "l-supplier",
            orderId: "o-supplier",
            procurementItemId: item.id,
            qty: 60,
            receivedQty: 60,
            unit: "pcs",
            plannedUnitPrice: 100,
            actualUnitPrice: 120,
          },
        ],
      },
      {
        id: "o-move",
        projectId,
        status: "received",
        kind: "stock",
        transferDirection: null,
        fromLocationId: "loc-a",
        toLocationId: "loc-b",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lines: [
          {
            id: "l-move",
            orderId: "o-move",
            procurementItemId: item.id,
            qty: 60,
            receivedQty: 60,
            unit: "pcs",
            plannedUnitPrice: 100,
            actualUnitPrice: 120,
          },
        ],
      },
    ];

    expect(computeRemainingRequestedQty(item, orders)).toBe(40);
    expect(computeFulfilledQty(item.id, orders)).toBe(60);
  });

  it("still counts the incoming side of a cross-project transfer as fulfillment", () => {
    // Anti-regression guard for option B of #216: excluding every stock order would fix the
    // double count by inventing an under-count, because a cross-project «in» transfer brings
    // genuinely new material into this project. Passes BEFORE and AFTER the fix by design; it
    // fails only if the predicate is widened to `kind === "supplier"`.
    const projectId = `cross-in-${Date.now()}`;
    const item = buildTestRequestLine(projectId, `req-cross-${Date.now()}`, 100);
    const orders: OrderWithLines[] = [
      {
        id: "o-cross-in",
        projectId,
        status: "received",
        kind: "stock",
        transferDirection: "in",
        fromLocationId: "loc-other-project",
        toLocationId: "loc-site",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lines: [
          {
            id: "l-cross-in",
            orderId: "o-cross-in",
            procurementItemId: item.id,
            qty: 60,
            receivedQty: 60,
            unit: "pcs",
            plannedUnitPrice: 100,
            actualUnitPrice: 120,
          },
        ],
      },
    ];

    expect(computeRemainingRequestedQty(item, orders)).toBe(40);
    expect(computeFulfilledQty(item.id, orders)).toBe(60);
  });

  it("clamps requested remaining to zero when ordered quantity exceeds requested", () => {
    const projectId = `remaining-clamp-${Date.now()}`;
    const item = buildTestRequestLine(projectId, `req-over-${Date.now()}`, 5);
    const orders: OrderWithLines[] = [
      {
        id: "o-over",
        projectId,
        status: "placed",
        kind: "supplier",
        supplierName: "Supplier X",
        deliverToLocationId: "loc-site",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lines: [
          {
            id: "l-over",
            orderId: "o-over",
            procurementItemId: item.id,
            qty: 7,
            receivedQty: 0,
            unit: "pcs",
            plannedUnitPrice: 100,
            actualUnitPrice: 120,
          },
        ],
      },
    ];

    expect(computeRemainingRequestedQty(item, orders)).toBe(0);
  });

  it("excludes non-estimate-linked items from requested chip totals", () => {
    const projectId = `chip-filter-${Date.now()}`;
    const linked = buildTestRequestLine(projectId, `linked-${Date.now()}`, 4, {
      sourceEstimateV2LineId: "line-linked",
      createdFrom: "estimate",
      plannedUnitPrice: 250,
    });
    const manual = buildTestRequestLine(projectId, `manual-${Date.now()}`, 6, {
      sourceEstimateV2LineId: null,
      sourceEstimateItemId: null,
      createdFrom: "manual",
      plannedUnitPrice: 999,
    });

    const totals = computeTabChipTotals(projectId, [linked, manual], [], []);

    expect(totals.requested.count).toBe(1);
    expect(totals.requested.total).toBe(1_000);
  });

  it("computes requested totals from the provided item array without relying on the local procurement store", () => {
    const projectId = `supabase-requested-${Date.now()}`;
    const requested = buildTestRequestLine(projectId, `requested-${Date.now()}`, 8, {
      sourceEstimateV2LineId: "line-requested",
      createdFrom: "estimate",
      plannedUnitPrice: 300,
    });

    const orders: OrderWithLines[] = [
      {
        id: "order-requested",
        projectId,
        status: "placed",
        kind: "supplier",
        supplierName: "Supplier A",
        deliverToLocationId: "loc-site",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lines: [
          {
            id: "line-requested",
            orderId: "order-requested",
            procurementItemId: requested.id,
            qty: 3,
            receivedQty: 0,
            unit: requested.unit,
            plannedUnitPrice: requested.plannedUnitPrice ?? 0,
            actualUnitPrice: requested.actualUnitPrice ?? 0,
          },
        ],
      },
    ];

    const totals = computeTabChipTotals(projectId, [requested], orders, []);

    expect(totals.requested.count).toBe(1);
    expect(totals.requested.total).toBe(1_500);
  });

  it("builds in-stock groups only from location placements", () => {
    const projectId = `stock-project-${Date.now()}`;
    const item = buildTestRequestLine(projectId, `req-stock-${Date.now()}`, 10);

    const orders: OrderWithLines[] = [
      {
        id: "supplier-received",
        projectId,
        status: "received",
        kind: "supplier",
        deliverToLocationId: "loc-site",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lines: [
          {
            id: "line-a",
            orderId: "supplier-received",
            procurementItemId: item.id,
            qty: 5,
            receivedQty: 5,
            unit: "pcs",
            plannedUnitPrice: 100,
            actualUnitPrice: 120,
          },
        ],
        receiveEvents: [
          {
            id: "ev-a",
            orderId: "supplier-received",
            orderLineId: "line-a",
            procurementItemId: item.id,
            locationId: "loc-site",
            deltaQty: 3,
            eventType: "receive",
            createdAt: new Date().toISOString(),
          },
          {
            id: "ev-b",
            orderId: "supplier-received",
            orderLineId: "line-a",
            procurementItemId: item.id,
            locationId: "loc-wh",
            deltaQty: 2,
            eventType: "receive",
            createdAt: new Date().toISOString(),
          },
        ],
      },
      {
        id: "stock-move",
        projectId,
        status: "received",
        kind: "stock",
        fromLocationId: "loc-site",
        toLocationId: "loc-wh",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lines: [
          {
            id: "line-b",
            orderId: "stock-move",
            procurementItemId: item.id,
            qty: 2,
            receivedQty: 2,
            unit: "pcs",
            plannedUnitPrice: 100,
            actualUnitPrice: 120,
          },
        ],
        receiveEvents: [
          {
            id: "ev-c",
            orderId: "stock-move",
            orderLineId: "line-b",
            procurementItemId: item.id,
            locationId: "loc-site",
            deltaQty: -2,
            eventType: "move_out",
            createdAt: new Date().toISOString(),
          },
          {
            id: "ev-d",
            orderId: "stock-move",
            orderLineId: "line-b",
            procurementItemId: item.id,
            locationId: "loc-wh",
            deltaQty: 2,
            eventType: "move_in",
            createdAt: new Date().toISOString(),
          },
        ],
      },
    ];

    const locations: InventoryLocation[] = [
      { id: "loc-site", name: "To the site", isDefault: true },
      { id: "loc-wh", name: "Warehouse" },
    ];

    const groups = computeInStockByLocation(projectId, [item], orders, locations);
    expect(groups.length).toBe(2);

    const byLocation = new Map(groups.map((group) => [group.locationId, group]));
    expect(byLocation.get("loc-site")?.items[0]?.qty).toBe(1);
    expect(byLocation.get("loc-wh")?.items[0]?.qty).toBe(4);
  });

  it("does not count a placed (not-yet-received) cross-project transfer as in-stock", () => {
    const projectId = `phantom-${Date.now()}`;
    const item = buildTestRequestLine(projectId, `req-phantom-${Date.now()}`, 10);

    const orders: OrderWithLines[] = [
      {
        id: "transfer-in-placed",
        projectId,
        status: "placed",
        kind: "stock",
        transferDirection: "in",
        counterpartyProjectId: "project-b",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lines: [
          {
            id: "line-t",
            orderId: "transfer-in-placed",
            procurementItemId: item.id,
            qty: 10,
            receivedQty: 0,
            unit: "pcs",
            plannedUnitPrice: 100,
            actualUnitPrice: 120,
          },
        ],
        receiveEvents: [],
      },
    ];

    const locations: InventoryLocation[] = [{ id: "loc-site", name: "Site", isDefault: true }];

    // The deferred transfer holds no real stock until received, so no in-stock group should appear.
    const groups = computeInStockByLocation(projectId, [item], orders, locations);
    expect(groups.length).toBe(0);
  });

  it("computes last received date from positive receipt events only", () => {
    const projectId = `last-received-${Date.now()}`;
    const item = buildTestRequestLine(projectId, `req-last-${Date.now()}`, 10);
    const older = "2026-01-10T10:00:00.000Z";
    const newer = "2026-02-15T12:00:00.000Z";
    const usage = "2026-03-01T09:00:00.000Z";

    const orders: OrderWithLines[] = [
      {
        id: "order-last",
        projectId,
        status: "received",
        kind: "supplier",
        deliverToLocationId: "loc-site",
        createdAt: older,
        updatedAt: usage,
        lines: [
          {
            id: "line-last",
            orderId: "order-last",
            procurementItemId: item.id,
            qty: 10,
            receivedQty: 10,
            unit: "pcs",
          },
        ],
        receiveEvents: [
          {
            id: "ev-receive-1",
            orderId: "order-last",
            orderLineId: "line-last",
            procurementItemId: item.id,
            locationId: "loc-site",
            deltaQty: 4,
            eventType: "receive",
            createdAt: older,
          },
          {
            id: "ev-receive-2",
            orderId: "order-last",
            orderLineId: "line-last",
            procurementItemId: item.id,
            locationId: "loc-site",
            deltaQty: 6,
            eventType: "receive",
            createdAt: newer,
          },
          {
            id: "ev-use",
            orderId: "order-last",
            orderLineId: "line-last",
            procurementItemId: item.id,
            locationId: "loc-site",
            deltaQty: -2,
            eventType: "use",
            createdAt: usage,
          },
        ],
      },
    ];

    expect(computeLastReceivedAt(item.id, "loc-site", orders)).toBe(newer);
  });

  it("separates receipt and usage event history by item+location", () => {
    const projectId = `event-history-${Date.now()}`;
    const item = buildTestRequestLine(projectId, `req-history-${Date.now()}`, 8);
    const now = new Date().toISOString();
    const orders: OrderWithLines[] = [
      {
        id: "order-history",
        projectId,
        status: "received",
        kind: "supplier",
        deliverToLocationId: "loc-site",
        createdAt: now,
        updatedAt: now,
        lines: [
          {
            id: "line-history",
            orderId: "order-history",
            procurementItemId: item.id,
            qty: 8,
            receivedQty: 8,
            unit: "pcs",
          },
        ],
        receiveEvents: [
          {
            id: "ev-history-receive",
            orderId: "order-history",
            orderLineId: "line-history",
            procurementItemId: item.id,
            locationId: "loc-site",
            deltaQty: 8,
            eventType: "receive",
            createdAt: now,
          },
          {
            id: "ev-history-use",
            orderId: "order-history",
            orderLineId: "line-history",
            procurementItemId: item.id,
            locationId: "loc-site",
            deltaQty: -3,
            eventType: "use",
            createdAt: now,
          },
        ],
      },
    ];

    const history = collectItemLocationEventHistory(item.id, "loc-site", orders);
    expect(history.receiptEvents).toHaveLength(1);
    expect(history.usageEvents).toHaveLength(1);
    expect(history.receiptEvents[0]?.event.id).toBe("ev-history-receive");
    expect(history.usageEvents[0]?.event.id).toBe("ev-history-use");
  });

  it("computes procurement header KPIs for estimate-linked items only", () => {
    const projectId = `header-kpi-${Date.now()}`;
    const linked = buildTestRequestLine(projectId, `req-linked-${Date.now()}`, 10, {
      sourceEstimateV2LineId: "line-linked",
      plannedUnitPrice: 100,
      actualUnitPrice: 120,
      createdFrom: "estimate",
    });
    const manual = buildTestRequestLine(projectId, `req-manual-${Date.now()}`, 20, {
      sourceEstimateV2LineId: null,
      sourceEstimateItemId: null,
      plannedUnitPrice: 900,
      actualUnitPrice: 950,
      createdFrom: "manual",
    });

    const now = new Date().toISOString();
    const orders: OrderWithLines[] = [
      {
        id: "order-kpi",
        projectId,
        status: "placed",
        kind: "supplier",
        supplierName: "Supplier",
        deliverToLocationId: "loc-site",
        createdAt: now,
        updatedAt: now,
        lines: [
          {
            id: "line-linked",
            orderId: "order-kpi",
            procurementItemId: linked.id,
            qty: 6,
            receivedQty: 2,
            unit: "pcs",
            plannedUnitPrice: 100,
            actualUnitPrice: 120,
          },
          {
            id: "line-manual",
            orderId: "order-kpi",
            procurementItemId: manual.id,
            qty: 10,
            receivedQty: 4,
            unit: "pcs",
            plannedUnitPrice: 900,
            actualUnitPrice: 950,
          },
        ],
      },
    ];

    const kpis = computeProcurementHeaderKpis(projectId, [linked, manual], orders);
    expect(kpis.hasLinkedItems).toBe(true);
    expect(kpis.missingPlannedPriceCount).toBe(0);
    expect(kpis.missingOrderPriceCount).toBe(0);
    expect(kpis.planned).toBe(1000);
    expect(kpis.committed).toBe(480);
    expect(kpis.received).toBe(240);
    expect(kpis.used).toBe(720);
    expect(kpis.variance).toBe(280);
  });

  it("returns graceful KPI nulls when planned/order prices are missing", () => {
    const projectId = `header-kpi-missing-${Date.now()}`;
    const linkedNoPlan = buildTestRequestLine(projectId, `req-linked-missing-plan-${Date.now()}`, 5, {
      sourceEstimateV2LineId: "line-missing-plan",
      plannedUnitPrice: null,
      actualUnitPrice: null,
      createdFrom: "estimate",
    });
    const linkedWithPlan = buildTestRequestLine(projectId, `req-linked-missing-order-${Date.now()}`, 8, {
      sourceEstimateV2LineId: "line-missing-order",
      plannedUnitPrice: 200,
      actualUnitPrice: null,
      createdFrom: "estimate",
    });

    const now = new Date().toISOString();
    const orders: OrderWithLines[] = [
      {
        id: "order-kpi-missing",
        projectId,
        status: "placed",
        kind: "supplier",
        supplierName: "Supplier",
        deliverToLocationId: "loc-site",
        createdAt: now,
        updatedAt: now,
        lines: [
          {
            id: "line-missing-order-price",
            orderId: "order-kpi-missing",
            procurementItemId: linkedWithPlan.id,
            qty: 3,
            receivedQty: 1,
            unit: "pcs",
            plannedUnitPrice: null,
            actualUnitPrice: null,
          },
        ],
      },
    ];

    const kpis = computeProcurementHeaderKpis(projectId, [linkedNoPlan, linkedWithPlan], orders);
    expect(kpis.hasLinkedItems).toBe(true);
    expect(kpis.missingPlannedPriceCount).toBe(1);
    expect(kpis.missingOrderPriceCount).toBe(0);
    expect(kpis.planned).toBeNull();
    expect(kpis.committed).toBe(400);
    expect(kpis.received).toBe(200);
    expect(kpis.used).toBe(600);
    expect(kpis.variance).toBeNull();
  });
});

describe("computePurchasePriceVariance", () => {
  const projectId = "ppv-project";

  function supplierOrder(lines: OrderWithLines["lines"], overrides: Partial<OrderWithLines> = {}): OrderWithLines {
    return {
      id: overrides.id ?? "o-ppv",
      projectId,
      status: "placed",
      kind: "supplier",
      supplierName: "Supplier",
      deliverToLocationId: "loc-site",
      createdAt: "2026-06-01T00:00:00.000Z",
      updatedAt: "2026-06-01T00:00:00.000Z",
      ...overrides,
      lines,
    } as OrderWithLines;
  }

  it("computes overpay over received quantities only", () => {
    const item = buildTestRequestLine(projectId, "ppv-item", 10, { plannedUnitPrice: 100, actualUnitPrice: null, sourceEstimateV2LineId: "est-line-1" });
    const orders = [supplierOrder([
      { id: "l-1", orderId: "o-ppv", procurementItemId: item.id, qty: 5, receivedQty: 2, unit: "pcs", plannedUnitPrice: 100, actualUnitPrice: 120 },
    ])];

    const ppv = computePurchasePriceVariance(projectId, [item], orders);
    // (120 − 100) × 2 received; the 3 open units do not count.
    expect(ppv.deltaTotal).toBe(40);
    expect(ppv.baseTotal).toBe(200);
    expect(ppv.pct).toBeCloseTo(20, 5);
    expect(ppv.lines).toHaveLength(1);
    expect(ppv.lines[0].deltaTotal).toBe(40);
    expect(ppv.skippedLineCount).toBe(0);
  });

  it("reports savings as a negative delta and sorts lines by |delta|", () => {
    const itemA = buildTestRequestLine(projectId, "ppv-a", 10, { plannedUnitPrice: 100, actualUnitPrice: null, sourceEstimateV2LineId: "est-line-a" });
    const itemB = buildTestRequestLine(projectId, "ppv-b", 10, { plannedUnitPrice: 50, actualUnitPrice: null, sourceEstimateV2LineId: "est-line-b" });
    const orders = [supplierOrder([
      { id: "l-a", orderId: "o-ppv", procurementItemId: itemA.id, qty: 2, receivedQty: 2, unit: "pcs", plannedUnitPrice: 100, actualUnitPrice: 90 },
      { id: "l-b", orderId: "o-ppv", procurementItemId: itemB.id, qty: 4, receivedQty: 4, unit: "pcs", plannedUnitPrice: 50, actualUnitPrice: 75 },
    ])];

    const ppv = computePurchasePriceVariance(projectId, [itemA, itemB], orders);
    // A: (90−100)×2 = −20 savings; B: (75−50)×4 = +100 overpay.
    expect(ppv.deltaTotal).toBe(80);
    expect(ppv.baseTotal).toBe(400);
    expect(ppv.lines.map((line) => line.procurementItemId)).toEqual([itemB.id, itemA.id]);
  });

  it("skips received lines without a resolvable planned or actual price", () => {
    const noPlanned = buildTestRequestLine(projectId, "ppv-no-plan", 10, { plannedUnitPrice: null, actualUnitPrice: null, sourceEstimateV2LineId: "est-line-np" });
    const noActual = buildTestRequestLine(projectId, "ppv-no-actual", 10, { plannedUnitPrice: 100, actualUnitPrice: null, sourceEstimateV2LineId: "est-line-na" });
    const orders = [supplierOrder([
      { id: "l-1", orderId: "o-ppv", procurementItemId: noPlanned.id, qty: 1, receivedQty: 1, unit: "pcs", plannedUnitPrice: null, actualUnitPrice: 120 },
      { id: "l-2", orderId: "o-ppv", procurementItemId: noActual.id, qty: 1, receivedQty: 1, unit: "pcs", plannedUnitPrice: null, actualUnitPrice: null },
    ])];

    const ppv = computePurchasePriceVariance(projectId, [noPlanned, noActual], orders);
    expect(ppv.deltaTotal).toBe(0);
    expect(ppv.baseTotal).toBe(0);
    expect(ppv.pct).toBeNull();
    expect(ppv.lines).toHaveLength(0);
    expect(ppv.skippedLineCount).toBe(2);
  });

  it("falls back to item prices when line prices are missing", () => {
    const item = buildTestRequestLine(projectId, "ppv-fallback", 10, { plannedUnitPrice: 100, actualUnitPrice: 110, sourceEstimateV2LineId: "est-line-fb" });
    const orders = [supplierOrder([
      { id: "l-1", orderId: "o-ppv", procurementItemId: item.id, qty: 3, receivedQty: 3, unit: "pcs", plannedUnitPrice: null, actualUnitPrice: null },
    ])];

    const ppv = computePurchasePriceVariance(projectId, [item], orders);
    expect(ppv.deltaTotal).toBe(30);
    expect(ppv.baseTotal).toBe(300);
  });

  it("excludes items not linked to the estimate (manual purchases are out of scope)", () => {
    const manualItem = buildTestRequestLine(projectId, "ppv-manual", 10, { plannedUnitPrice: 100, actualUnitPrice: null, sourceEstimateV2LineId: null });
    const orders = [supplierOrder([
      { id: "l-m", orderId: "o-ppv", procurementItemId: manualItem.id, qty: 2, receivedQty: 2, unit: "pcs", plannedUnitPrice: 100, actualUnitPrice: 150 },
    ])];

    const ppv = computePurchasePriceVariance(projectId, [manualItem], orders);
    expect(ppv.deltaTotal).toBe(0);
    expect(ppv.baseTotal).toBe(0);
    expect(ppv.pct).toBeNull();
    expect(ppv.lines).toHaveLength(0);
    expect(ppv.skippedLineCount).toBe(0);
  });

  it("ignores draft and stock orders", () => {
    const item = buildTestRequestLine(projectId, "ppv-draft", 10, { plannedUnitPrice: 100, actualUnitPrice: null, sourceEstimateV2LineId: "est-line-d" });
    const orders = [
      supplierOrder([
        { id: "l-1", orderId: "o-draft", procurementItemId: item.id, qty: 2, receivedQty: 2, unit: "pcs", plannedUnitPrice: 100, actualUnitPrice: 150 },
      ], { id: "o-draft", status: "draft" }),
      supplierOrder([
        { id: "l-2", orderId: "o-stock", procurementItemId: item.id, qty: 2, receivedQty: 2, unit: "pcs", plannedUnitPrice: 100, actualUnitPrice: 150 },
      ], { id: "o-stock", kind: "stock", status: "received" }),
    ];

    const ppv = computePurchasePriceVariance(projectId, [item], orders);
    expect(ppv.deltaTotal).toBe(0);
    expect(ppv.lines).toHaveLength(0);
  });
});

describe("computeProjectLastReceivedAt", () => {
  it("returns the latest receipt-like event across applied orders", () => {
    const projectId = "last-received-project";
    const item = buildTestRequestLine(projectId, "lr-item", 10);
    const orders: OrderWithLines[] = [
      {
        id: "o-1",
        projectId,
        status: "received",
        kind: "supplier",
        supplierName: "Supplier",
        deliverToLocationId: "loc-site",
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-01T00:00:00.000Z",
        lines: [
          { id: "l-1", orderId: "o-1", procurementItemId: item.id, qty: 2, receivedQty: 2, unit: "pcs", plannedUnitPrice: 100, actualUnitPrice: 100 },
        ],
        receiveEvents: [
          { id: "e-1", orderId: "o-1", orderLineId: "l-1", procurementItemId: item.id, locationId: "loc-site", eventType: "receive", deltaQty: 1, createdAt: "2026-06-02T10:00:00.000Z" },
          { id: "e-2", orderId: "o-1", orderLineId: "l-1", procurementItemId: item.id, locationId: "loc-site", eventType: "receive", deltaQty: 1, createdAt: "2026-06-05T09:00:00.000Z" },
          { id: "e-3", orderId: "o-1", orderLineId: "l-1", procurementItemId: item.id, locationId: "loc-site", eventType: "use", deltaQty: -1, createdAt: "2026-06-06T09:00:00.000Z" },
        ],
      } as OrderWithLines,
    ];

    expect(computeProjectLastReceivedAt(projectId, orders)).toBe("2026-06-05T09:00:00.000Z");
    expect(computeProjectLastReceivedAt(projectId, [])).toBeNull();
  });

  it("ignores internal transfer arrivals — moves are not deliveries", () => {
    const projectId = "last-received-transfers";
    const item = buildTestRequestLine(projectId, "lr-move-item", 10);
    const orders: OrderWithLines[] = [
      {
        id: "o-sup",
        projectId,
        status: "received",
        kind: "supplier",
        supplierName: "Supplier",
        deliverToLocationId: "loc-site",
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-01T00:00:00.000Z",
        lines: [
          { id: "l-1", orderId: "o-sup", procurementItemId: item.id, qty: 1, receivedQty: 1, unit: "pcs", plannedUnitPrice: 100, actualUnitPrice: 100 },
        ],
        receiveEvents: [
          { id: "e-1", orderId: "o-sup", orderLineId: "l-1", procurementItemId: item.id, locationId: "loc-site", eventType: "receive", deltaQty: 1, createdAt: "2026-06-02T10:00:00.000Z" },
        ],
      } as OrderWithLines,
      {
        id: "o-move",
        projectId,
        status: "received",
        kind: "stock",
        fromLocationId: "loc-a",
        toLocationId: "loc-site",
        createdAt: "2026-06-08T00:00:00.000Z",
        updatedAt: "2026-06-08T00:00:00.000Z",
        lines: [
          { id: "l-2", orderId: "o-move", procurementItemId: item.id, qty: 1, receivedQty: 1, unit: "pcs", plannedUnitPrice: 100, actualUnitPrice: 100 },
        ],
        receiveEvents: [
          { id: "e-2", orderId: "o-move", orderLineId: "l-2", procurementItemId: item.id, locationId: "loc-site", eventType: "move_in", deltaQty: 1, createdAt: "2026-06-09T10:00:00.000Z" },
        ],
      } as OrderWithLines,
    ];

    // The later move_in must not bump the project-level delivery date.
    expect(computeProjectLastReceivedAt(projectId, orders)).toBe("2026-06-02T10:00:00.000Z");
    // Orders from another project never count.
    expect(computeProjectLastReceivedAt("other-project", orders)).toBeNull();
  });
});

describe("partially received supplier orders", () => {
  const RECEIVED_AT = "2026-03-05T10:00:00.000Z";
  const projectId = "partial-project";

  function partialItem(overrides: Partial<ProcurementItemV2> = {}) {
    return buildTestRequestLine(projectId, "req-partial", 10, {
      sourceEstimateV2LineId: "line-1",
      plannedUnitPrice: 100,
      actualUnitPrice: 120,
      ...overrides,
    });
  }

  /** qty 10 ordered, 4 delivered to loc-site, so 6 are still outstanding. */
  function partialOrder(status: OrderWithLines["status"] = "partially_received"): OrderWithLines {
    return {
      id: "o-partial",
      projectId,
      status,
      kind: "supplier",
      supplierName: "Supplier A",
      deliverToLocationId: "loc-site",
      createdAt: "2026-03-01T00:00:00.000Z",
      updatedAt: "2026-03-01T00:00:00.000Z",
      lines: [{
        id: "l-partial",
        orderId: "o-partial",
        procurementItemId: "req-partial",
        qty: 10,
        receivedQty: 4,
        unit: "pcs",
        plannedUnitPrice: 100,
        actualUnitPrice: 120,
      }],
      receiveEvents: [{
        id: "ev-partial",
        orderId: "o-partial",
        orderLineId: "l-partial",
        procurementItemId: "req-partial",
        locationId: "loc-site",
        deltaQty: 4,
        eventType: "receive",
        createdAt: RECEIVED_AT,
      }],
    } as unknown as OrderWithLines;
  }

  const locations = [
    { id: "loc-site", projectId, name: "Site", isDefault: true },
  ] as unknown as InventoryLocation[];

  it("reports the unreceived remainder as still open", () => {
    expect(computeOrderedOpenQty("req-partial", [partialOrder()])).toBe(6);
  });

  it("counts the order against the requested quantity", () => {
    expect(computeRemainingRequestedQty(partialItem(), [partialOrder()])).toBe(0);
    expect(computeFulfilledQty("req-partial", [partialOrder()])).toBe(10);
  });

  it("puts the delivered units on hand", () => {
    const groups = computeInStockByLocation(projectId, [partialItem()], [partialOrder()], locations);

    expect(groups).toHaveLength(1);
    expect(groups[0].items[0]).toMatchObject({ procurementItemId: "req-partial", qty: 4 });
    expect(groups[0].totalValue).toBe(480);
  });

  it("splits the order across committed and received in the header KPIs", () => {
    const kpis = computeProcurementHeaderKpis(projectId, [partialItem()], [partialOrder()]);

    // 6 outstanding x 120 committed, 4 delivered x 120 received.
    expect(kpis.committed).toBe(720);
    expect(kpis.received).toBe(480);
    expect(kpis.used).toBe(1_200);
  });

  it("includes the delivered units in purchase price variance", () => {
    const variance = computePurchasePriceVariance(projectId, [partialItem()], [partialOrder()]);

    // 4 delivered at 120 against a planned 100.
    expect(variance.deltaTotal).toBe(80);
    expect(variance.baseTotal).toBe(400);
    expect(variance.pct).toBe(20);
  });

  it("surfaces the receipt timestamp", () => {
    expect(computeLastReceivedAt("req-partial", "loc-site", [partialOrder()])).toBe(RECEIVED_AT);
    expect(computeProjectLastReceivedAt(projectId, [partialOrder()])).toBe(RECEIVED_AT);
  });

  it("keeps the order in the ordered tab chip while quantity is outstanding", () => {
    const totals = computeTabChipTotals(projectId, [partialItem()], [partialOrder()], []);

    expect(totals.ordered.count).toBe(1);
    expect(totals.ordered.total).toBe(720);
  });

  it("matches how a placed order of the same shape is treated", () => {
    const partial = partialOrder("partially_received");
    const placed = partialOrder("placed");

    expect(computeOrderedOpenQty("req-partial", [partial]))
      .toBe(computeOrderedOpenQty("req-partial", [placed]));
    expect(computeProcurementHeaderKpis(projectId, [partialItem()], [partial]))
      .toEqual(computeProcurementHeaderKpis(projectId, [partialItem()], [placed]));
  });
});

describe("order status predicates", () => {
  // Enumerated over the whole OrderStatus domain: a missing case here is exactly the
  // defect class this module keeps reintroducing.
  it.each([
    ["draft", false, false],
    ["placed", true, true],
    ["partially_received", true, true],
    ["received", true, false],
    ["voided", false, false],
  ] as const)("classifies %s", (status, applied, open) => {
    expect(isAppliedOrderStatus(status)).toBe(applied);
    expect(isOpenOrderStatus(status)).toBe(open);
  });
});
