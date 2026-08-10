import { beforeEach, describe, expect, it } from "vitest";
import { addProcurementItem, getProcurementItemById } from "@/data/procurement-store";
import {
  __unsafeResetOrdersForTests,
  cancelDraftOrder,
  createDraftOrder,
  getOrder,
  placeOrder,
  receiveOrder,
  consumeStockFromInventory,
  updateOrder,
  voidOrder,
} from "@/data/order-store";
import {
  __unsafeResetInventoryForTests,
  adjustStock,
  createLocation,
  ensureDefaultLocation,
  getStock,
} from "@/data/inventory-store";
import { toInventoryKey } from "@/lib/procurement-fulfillment";

function createRequestLine(projectId: string, id: string, qty = 10) {
  const uniqueId = `${id}-${Math.random().toString(36).slice(2, 6)}`;
  return addProcurementItem({
    id: uniqueId,
    projectId,
    stageId: null,
    categoryId: null,
    type: "material",
    name: `Material ${id}`,
    spec: null,
    unit: "pcs",
    requiredByDate: null,
    requiredQty: qty,
    orderedQty: 0,
    receivedQty: 0,
    plannedUnitPrice: 100,
    actualUnitPrice: 120,
    supplier: null,
    supplierPreferred: null,
    locationPreferredId: null,
    lockedFromEstimate: false,
    linkUrl: null,
    notes: null,
    attachments: [],
    createdFrom: "manual",
    linkedTaskIds: [],
    archived: false,
  });
}

describe("order-store", () => {
  beforeEach(() => {
    __unsafeResetOrdersForTests();
    __unsafeResetInventoryForTests();
  });

  it("placing supplier order does not mutate inventory stock", () => {
    const projectId = `supplier-project-${Date.now()}`;
    const item = createRequestLine(projectId, `line-${Date.now()}`);
    const site = ensureDefaultLocation(projectId);

    const draft = createDraftOrder({
      projectId,
      kind: "supplier",
      supplierName: "Supplier",
      deliverToLocationId: site.id,
      lines: [{ procurementItemId: item.id, qty: 5, unit: "pcs", plannedUnitPrice: 100, actualUnitPrice: 120 }],
    });

    const placed = placeOrder(draft.id);
    expect(placed.ok).toBe(true);
    if (placed.ok) {
      expect(placed.order.status).toBe("placed");
    }

    expect(getStock(projectId, site.id, toInventoryKey(item))).toBe(0);
  });

  it("placing stock order moves inventory and completes immediately", () => {
    const projectId = `stock-project-${Date.now()}`;
    const item = createRequestLine(projectId, `line-${Date.now()}`);
    const from = ensureDefaultLocation(projectId);
    const to = createLocation(projectId, { name: "Warehouse" });

    adjustStock(projectId, from.id, toInventoryKey(item), 10);

    const draft = createDraftOrder({
      projectId,
      kind: "stock",
      fromLocationId: from.id,
      toLocationId: to.id,
      deliverToLocationId: to.id,
      lines: [{ procurementItemId: item.id, qty: 4, unit: "pcs", plannedUnitPrice: 100, actualUnitPrice: 120 }],
    });

    const placed = placeOrder(draft.id);
    expect(placed.ok).toBe(true);
    if (placed.ok) {
      expect(placed.order.status).toBe("received");
    }

    expect(getStock(projectId, from.id, toInventoryKey(item))).toBe(6);
    expect(getStock(projectId, to.id, toInventoryKey(item))).toBe(4);
  });

  it("supports partial receive and closes order when fully received", () => {
    const projectId = `receive-project-${Date.now()}`;
    const item = createRequestLine(projectId, `line-${Date.now()}`);
    const site = ensureDefaultLocation(projectId);

    const draft = createDraftOrder({
      projectId,
      kind: "supplier",
      supplierName: "Supplier",
      deliverToLocationId: site.id,
      lines: [{ procurementItemId: item.id, qty: 8, unit: "pcs", plannedUnitPrice: 100, actualUnitPrice: 120 }],
    });

    const placed = placeOrder(draft.id);
    expect(placed.ok).toBe(true);

    const firstLineId = getOrder(draft.id)?.lines[0]?.id;
    expect(firstLineId).toBeTruthy();
    if (!firstLineId) return;

    const firstReceive = receiveOrder(draft.id, { locationId: site.id, lines: [{ lineId: firstLineId, qty: 3 }] });
    expect(firstReceive.ok).toBe(true);
    if (firstReceive.ok) {
      // A partial receipt now records the half-delivered state, matching the Supabase source.
      expect(firstReceive.order.status).toBe("partially_received");
      expect(firstReceive.order.lines[0]?.receivedQty).toBe(3);
    }
    expect(getStock(projectId, site.id, toInventoryKey(item))).toBe(3);

    const secondReceive = receiveOrder(draft.id, { locationId: site.id, lines: [{ lineId: firstLineId, qty: 5 }] });
    expect(secondReceive.ok).toBe(true);
    if (secondReceive.ok) {
      expect(secondReceive.order.status).toBe("received");
      expect(secondReceive.order.lines[0]?.receivedQty).toBe(8);
    }
    expect(getStock(projectId, site.id, toInventoryKey(item))).toBe(8);

    const mirroredRequest = getProcurementItemById(item.id);
    expect(mirroredRequest?.orderedQty).toBe(8);
    expect(mirroredRequest?.receivedQty).toBe(8);
  });

  it("applies bulk receive quantities across multiple order lines", () => {
    const projectId = `bulk-receive-project-${Date.now()}`;
    const itemA = createRequestLine(projectId, `line-a-${Date.now()}`, 10);
    const itemB = createRequestLine(projectId, `line-b-${Date.now()}`, 7);
    const site = ensureDefaultLocation(projectId);

    const draft = createDraftOrder({
      projectId,
      kind: "supplier",
      supplierName: "Supplier",
      deliverToLocationId: site.id,
      lines: [
        { procurementItemId: itemA.id, qty: 5, unit: "pcs", plannedUnitPrice: 100, actualUnitPrice: 120 },
        { procurementItemId: itemB.id, qty: 3, unit: "pcs", plannedUnitPrice: 90, actualUnitPrice: 95 },
      ],
    });
    placeOrder(draft.id);

    const placed = getOrder(draft.id);
    const lineAId = placed?.lines.find((line) => line.procurementItemId === itemA.id)?.id;
    const lineBId = placed?.lines.find((line) => line.procurementItemId === itemB.id)?.id;
    expect(lineAId).toBeTruthy();
    expect(lineBId).toBeTruthy();
    if (!lineAId || !lineBId) return;

    const firstReceive = receiveOrder(draft.id, {
      locationId: site.id,
      lines: [
        { lineId: lineAId, qty: 2 },
        { lineId: lineBId, qty: 3 },
      ],
    });
    expect(firstReceive.ok).toBe(true);
    if (firstReceive.ok) {
      // A partial receipt now records the half-delivered state, matching the Supabase source.
      expect(firstReceive.order.status).toBe("partially_received");
      const nextLineA = firstReceive.order.lines.find((line) => line.id === lineAId);
      const nextLineB = firstReceive.order.lines.find((line) => line.id === lineBId);
      expect(nextLineA?.receivedQty).toBe(2);
      expect(nextLineB?.receivedQty).toBe(3);
    }

    const secondReceive = receiveOrder(draft.id, {
      locationId: site.id,
      lines: [{ lineId: lineAId, qty: 3 }],
    });
    expect(secondReceive.ok).toBe(true);
    if (secondReceive.ok) {
      expect(secondReceive.order.status).toBe("received");
    }

    expect(getStock(projectId, site.id, toInventoryKey(itemA))).toBe(5);
    expect(getStock(projectId, site.id, toInventoryKey(itemB))).toBe(3);

    expect(getProcurementItemById(itemA.id)?.receivedQty).toBe(5);
    expect(getProcurementItemById(itemB.id)?.receivedQty).toBe(3);
  });

  it("persists delivery scheduled updates on existing order", () => {
    const projectId = `delivery-date-project-${Date.now()}`;
    const item = createRequestLine(projectId, `line-${Date.now()}`, 6);
    const site = ensureDefaultLocation(projectId);

    const draft = createDraftOrder({
      projectId,
      kind: "supplier",
      supplierName: "Supplier",
      deliverToLocationId: site.id,
      lines: [{ procurementItemId: item.id, qty: 4, unit: "pcs", plannedUnitPrice: 100, actualUnitPrice: 120 }],
    });
    placeOrder(draft.id);

    const deliveryDate = "2026-05-01T00:00:00.000Z";
    const updated = updateOrder(draft.id, { deliveryDeadline: deliveryDate });
    expect(updated?.deliveryDeadline).toBe(deliveryDate);
    expect(getOrder(draft.id)?.deliveryDeadline).toBe(deliveryDate);
  });

  it("can cancel draft orders", () => {
    const projectId = `cancel-project-${Date.now()}`;
    const item = createRequestLine(projectId, `line-${Date.now()}`);
    const site = ensureDefaultLocation(projectId);

    const draft = createDraftOrder({
      projectId,
      kind: "supplier",
      deliverToLocationId: site.id,
      lines: [{ procurementItemId: item.id, qty: 2, unit: "pcs" }],
    });

    const cancelled = cancelDraftOrder(draft.id);
    expect(cancelled.ok).toBe(true);
    if (cancelled.ok) {
      expect(cancelled.order.status).toBe("voided");
    }
  });

  it("can void placed supplier orders with zero receipts", () => {
    const projectId = `void-supplier-project-${Date.now()}`;
    const item = createRequestLine(projectId, `line-${Date.now()}`);
    const site = ensureDefaultLocation(projectId);

    const draft = createDraftOrder({
      projectId,
      kind: "supplier",
      deliverToLocationId: site.id,
      lines: [{ procurementItemId: item.id, qty: 5, unit: "pcs" }],
    });

    const placed = placeOrder(draft.id);
    expect(placed.ok).toBe(true);

    const voided = voidOrder(draft.id);
    expect(voided.ok).toBe(true);
    if (voided.ok) {
      expect(voided.order.status).toBe("voided");
    }

    const mirroredRequest = getProcurementItemById(item.id);
    expect(mirroredRequest?.orderedQty).toBe(0);
    expect(mirroredRequest?.receivedQty).toBe(0);
  });

  it("voids stock allocations by reversing inventory movements", () => {
    const projectId = `void-stock-project-${Date.now()}`;
    const item = createRequestLine(projectId, `line-${Date.now()}`);
    const from = ensureDefaultLocation(projectId);
    const to = createLocation(projectId, { name: "Storage" });

    adjustStock(projectId, from.id, toInventoryKey(item), 7);

    const draft = createDraftOrder({
      projectId,
      kind: "stock",
      fromLocationId: from.id,
      toLocationId: to.id,
      lines: [{ procurementItemId: item.id, qty: 4, unit: "pcs" }],
    });

    const placed = placeOrder(draft.id);
    expect(placed.ok).toBe(true);
    expect(getStock(projectId, from.id, toInventoryKey(item))).toBe(3);
    expect(getStock(projectId, to.id, toInventoryKey(item))).toBe(4);

    const voided = voidOrder(draft.id);
    expect(voided.ok).toBe(true);
    if (voided.ok) {
      expect(voided.order.status).toBe("voided");
    }
    expect(getStock(projectId, from.id, toInventoryKey(item))).toBe(7);
    expect(getStock(projectId, to.id, toInventoryKey(item))).toBe(0);
  });

  it("tracks receive events per location across partial receives", () => {
    const projectId = `receive-events-project-${Date.now()}`;
    const item = createRequestLine(projectId, `line-${Date.now()}`);
    const site = ensureDefaultLocation(projectId);
    const warehouse = createLocation(projectId, { name: "Warehouse" });

    const draft = createDraftOrder({
      projectId,
      kind: "supplier",
      supplierName: "Supplier",
      deliverToLocationId: site.id,
      lines: [{ procurementItemId: item.id, qty: 6, unit: "pcs" }],
    });

    const placed = placeOrder(draft.id);
    expect(placed.ok).toBe(true);

    const firstLineId = getOrder(draft.id)?.lines[0]?.id;
    expect(firstLineId).toBeTruthy();
    if (!firstLineId) return;

    const firstReceive = receiveOrder(draft.id, {
      locationId: site.id,
      lines: [{ lineId: firstLineId, qty: 2 }],
    });
    expect(firstReceive.ok).toBe(true);

    const secondReceive = receiveOrder(draft.id, {
      locationId: warehouse.id,
      lines: [{ lineId: firstLineId, qty: 4 }],
    });
    expect(secondReceive.ok).toBe(true);

    const updated = getOrder(draft.id);
    const eventsByLocation = new Map<string, number>();
    (updated?.receiveEvents ?? []).forEach((event) => {
      eventsByLocation.set(event.locationId, (eventsByLocation.get(event.locationId) ?? 0) + event.deltaQty);
    });

    expect(eventsByLocation.get(site.id)).toBe(2);
    expect(eventsByLocation.get(warehouse.id)).toBe(4);
  });

  it("uses stock partially and logs usage metadata in receive events", () => {
    const projectId = `use-stock-project-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const item = createRequestLine(projectId, `line-${Date.now()}`, 10);
    const site = ensureDefaultLocation(projectId);

    const draft = createDraftOrder({
      projectId,
      kind: "supplier",
      supplierName: "Supplier",
      deliverToLocationId: site.id,
      lines: [{ procurementItemId: item.id, qty: 8, unit: "pcs", plannedUnitPrice: 100, actualUnitPrice: 120 }],
    });
    placeOrder(draft.id);

    const lineId = getOrder(draft.id)?.lines[0]?.id;
    expect(lineId).toBeTruthy();
    if (!lineId) return;

    const receiveResult = receiveOrder(draft.id, {
      locationId: site.id,
      lines: [{ lineId, qty: 8 }],
    });
    expect(receiveResult.ok).toBe(true);
    expect(getStock(projectId, site.id, toInventoryKey(item))).toBe(8);

    const useResult = consumeStockFromInventory({
      projectId,
      procurementItemId: item.id,
      locationId: site.id,
      qty: 3,
      usedByName: "Ivan Petrov",
      note: "Used for stage prep",
    });
    if (!useResult.ok) {
      throw new Error(useResult.error);
    }
    expect(useResult.remainingQty).toBe(5);
    expect(getStock(projectId, site.id, toInventoryKey(item))).toBe(5);

    const updated = getOrder(draft.id);
    const usageEvent = (updated?.receiveEvents ?? []).find((event) => event.eventType === "use");
    expect(usageEvent).toBeTruthy();
    expect(usageEvent?.deltaQty).toBe(-3);
    expect(usageEvent?.usedByName).toBe("Ivan Petrov");
    expect(usageEvent?.note).toBe("Used for stage prep");
  });
});

describe("order-store partially_received parity", () => {
  beforeEach(() => {
    __unsafeResetOrdersForTests();
    __unsafeResetInventoryForTests();
  });

  it("records the half-delivered state and keeps the order receivable to completion", () => {
    const projectId = `parity-${Date.now()}`;
    const item = createRequestLine(projectId, `line-${Date.now()}`);
    const site = ensureDefaultLocation(projectId);

    const draft = createDraftOrder({
      projectId,
      kind: "supplier",
      supplierName: "Supplier",
      deliverToLocationId: site.id,
      lines: [{ procurementItemId: item.id, qty: 10, unit: "pcs", plannedUnitPrice: 100, actualUnitPrice: 100 }],
    });
    expect(placeOrder(draft.id).ok).toBe(true);

    const lineId = getOrder(draft.id)?.lines[0]?.id;
    expect(lineId).toBeTruthy();
    if (!lineId) return;

    // Demo/local must report the same state the Supabase source does for the same data,
    // otherwise demo is not a valid rehearsal surface for a part-delivered order.
    const partial = receiveOrder(draft.id, { locationId: site.id, lines: [{ lineId, qty: 4 }] });
    expect(partial.ok).toBe(true);
    if (partial.ok) expect(partial.order.status).toBe("partially_received");

    // Voiding stays refused, and for the precise reason.
    const voided = voidOrder(draft.id);
    expect(voided.ok).toBe(false);
    if (!voided.ok) expect(voided.error).toBe("Supplier order with received quantities cannot be voided");

    // Not a dead end: the remaining quantity still closes the order.
    const rest = receiveOrder(draft.id, { locationId: site.id, lines: [{ lineId, qty: 6 }] });
    expect(rest.ok).toBe(true);
    if (rest.ok) expect(rest.order.status).toBe("received");
  });

  // Covers the no-quantity rejection: a receive that applies nothing is refused outright and
  // leaves the status untouched, so the order never slips into partially_received.
  it("stays on placed when a receive lands no quantity at all", () => {
    const projectId = `parity-none-${Date.now()}`;
    const item = createRequestLine(projectId, `line-${Date.now()}`);
    const site = ensureDefaultLocation(projectId);

    const draft = createDraftOrder({
      projectId,
      kind: "supplier",
      supplierName: "Supplier",
      deliverToLocationId: site.id,
      lines: [{ procurementItemId: item.id, qty: 10, unit: "pcs", plannedUnitPrice: 100, actualUnitPrice: 100 }],
    });
    expect(placeOrder(draft.id).ok).toBe(true);
    expect(getOrder(draft.id)?.status).toBe("placed");

    const lineId = getOrder(draft.id)?.lines[0]?.id;
    if (!lineId) return;
    const none = receiveOrder(draft.id, { locationId: site.id, lines: [{ lineId, qty: 0 }] });
    expect(none.ok).toBe(false);
    expect(getOrder(draft.id)?.status).toBe("placed");
  });
});
