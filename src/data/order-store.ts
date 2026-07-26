import {
  adjustStock,
  ensureDefaultLocation,
  getStock,
} from "@/data/inventory-store";
import {
  getAllProcurementItemsV2,
  getProcurementItemById,
  updateProcurementItem,
} from "@/data/procurement-store";
import { isOpenOrderStatus, toInventoryKey } from "@/lib/procurement-fulfillment";
import { onDemoSessionDeactivated } from "@/lib/auth-state";
import type {
  Order,
  OrderLine,
  OrderReceiveEvent,
  OrderWithLines,
  ProcurementAttachment,
} from "@/types/entities";

export interface DraftOrderLineInput {
  procurementItemId: string;
  qty: number;
  unit: string;
  plannedUnitPrice?: number | null;
  actualUnitPrice?: number | null;
}

export interface DraftOrderInput {
  projectId: string;
  kind: Order["kind"];
  supplierName?: string | null;
  deliverToLocationId?: string | null;
  fromLocationId?: string | null;
  toLocationId?: string | null;
  dueDate?: string | null;
  deliveryDeadline?: string | null;
  invoiceAttachment?: ProcurementAttachment | null;
  note?: string | null;
  lines: DraftOrderLineInput[];
}

export interface ReceiveOrderInput {
  locationId?: string | null;
  lines: Array<{ lineId: string; qty: number }>;
}

export interface UseStockFromInventoryInput {
  projectId: string;
  procurementItemId: string;
  locationId: string;
  qty: number;
  usedByParticipantId?: string | null;
  usedByName?: string | null;
  note?: string | null;
}

type Listener = () => void;

const listeners = new Set<Listener>();
let orders: Order[] = [];
let orderLines: OrderLine[] = [];
let orderReceiveEvents: OrderReceiveEvent[] = [];

function notify() {
  listeners.forEach((listener) => listener());
}

function genOrderId(): string {
  return `order-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

function genOrderLineId(): string {
  return `oline-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

function genReceiveEventId(): string {
  return `orevt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

function withLines(order: Order): OrderWithLines {
  return {
    ...order,
    lines: orderLines
      .filter((line) => line.orderId === order.id)
      .map((line) => ({ ...line })),
    receiveEvents: orderReceiveEvents
      .filter((event) => event.orderId === order.id)
      .map((event) => ({ ...event })),
  };
}

function refreshLegacyProcurementQuantities(projectId: string) {
  const orderedByItem = new Map<string, number>();
  const receivedByItem = new Map<string, number>();

  const appliedOrders = orders.filter((order) => (
    order.projectId === projectId
    && order.status !== "draft"
    && order.status !== "voided"
  ));
  appliedOrders.forEach((order) => {
    orderLines
      .filter((line) => line.orderId === order.id)
      .forEach((line) => {
        orderedByItem.set(line.procurementItemId, (orderedByItem.get(line.procurementItemId) ?? 0) + line.qty);
        const receivedDelta = order.kind === "supplier" ? line.receivedQty : line.qty;
        receivedByItem.set(line.procurementItemId, (receivedByItem.get(line.procurementItemId) ?? 0) + receivedDelta);
      });
  });

  const projectItems = getAllProcurementItemsV2(true).filter((item) => item.projectId === projectId);
  projectItems.forEach((item) => {
    const orderedQty = orderedByItem.get(item.id) ?? 0;
    const receivedQty = receivedByItem.get(item.id) ?? 0;
    if (orderedQty !== item.orderedQty || receivedQty !== item.receivedQty) {
      updateProcurementItem(item.id, { orderedQty, receivedQty });
    }
  });
}

function seedOrdersFromLegacyProcurement() {
  const items = getAllProcurementItemsV2();
  const seededOrders: Order[] = [];
  const seededLines: OrderLine[] = [];
  const seededReceiveEvents: OrderReceiveEvent[] = [];

  items.forEach((item) => {
    if (item.orderedQty <= 0 && item.receivedQty <= 0) return;

    const qty = Math.max(item.orderedQty, item.receivedQty, 0);
    if (qty <= 0) return;

    const now = item.updatedAt || item.createdAt || new Date().toISOString();
    const deliverToLocation = ensureDefaultLocation(item.projectId);
    const orderId = `order-seed-${item.id}`;

    seededOrders.push({
      id: orderId,
      projectId: item.projectId,
      status: item.receivedQty >= qty ? "received" : "placed",
      kind: "supplier",
      supplierName: item.supplier ?? item.supplierPreferred ?? null,
      deliverToLocationId: deliverToLocation.id,
      dueDate: null,
      deliveryDeadline: item.requiredByDate ?? null,
      invoiceAttachment: null,
      note: item.notes ?? null,
      createdAt: item.createdAt,
      updatedAt: now,
    });

    const seededLine: OrderLine = {
      id: `oline-seed-${item.id}`,
      orderId,
      procurementItemId: item.id,
      qty,
      receivedQty: Math.min(item.receivedQty, qty),
      unit: item.unit,
      plannedUnitPrice: item.plannedUnitPrice,
      actualUnitPrice: item.actualUnitPrice,
    };
    seededLines.push(seededLine);

    if (seededLine.receivedQty > 0) {
      seededReceiveEvents.push({
        id: `orevt-seed-${item.id}`,
        orderId,
        orderLineId: seededLine.id,
        procurementItemId: item.id,
        locationId: deliverToLocation.id,
        deltaQty: seededLine.receivedQty,
        eventType: "receive",
        createdAt: now,
      });
    }
  });

  orders = seededOrders;
  orderLines = seededLines;
  orderReceiveEvents = seededReceiveEvents;
}

seedOrdersFromLegacyProcurement();

// Pristine-re-entry: rebuild the demo orders from the (already-reset) demo
// procurement seed when the demo session ends. procurement-store and
// inventory-store register earlier (order-store imports both), so their
// resets run first and this re-seed reads the fresh procurement seed and the
// restored default locations.
onDemoSessionDeactivated(() => {
  seedOrdersFromLegacyProcurement();
  notify();
});

export function subscribeOrders(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getOrder(orderId: string): OrderWithLines | undefined {
  const order = orders.find((entry) => entry.id === orderId);
  if (!order) return undefined;
  return withLines(order);
}

export function listOrdersByProject(projectId: string): OrderWithLines[] {
  return orders
    .filter((order) => order.projectId === projectId)
    .map(withLines)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

export function listPlacedSupplierOrders(projectId: string): OrderWithLines[] {
  return listOrdersByProject(projectId)
    .filter((order) => order.kind === "supplier" && isOpenOrderStatus(order.status));
}

export function listPlacedSupplierOrdersAllProjects(): OrderWithLines[] {
  return orders
    .filter((order) => order.kind === "supplier" && isOpenOrderStatus(order.status))
    .map(withLines)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

export function createDraftOrder(input: DraftOrderInput): OrderWithLines {
  const now = new Date().toISOString();
  const orderId = genOrderId();
  const deliverTo = input.deliverToLocationId ?? ensureDefaultLocation(input.projectId).id;

  const created: Order = {
    id: orderId,
    projectId: input.projectId,
    status: "draft",
    kind: input.kind,
    supplierName: input.supplierName ?? null,
    deliverToLocationId: deliverTo,
    fromLocationId: input.fromLocationId ?? null,
    toLocationId: input.toLocationId ?? null,
    dueDate: input.dueDate ?? null,
    deliveryDeadline: input.deliveryDeadline ?? null,
    invoiceAttachment: input.invoiceAttachment ?? null,
    note: input.note ?? null,
    createdAt: now,
    updatedAt: now,
  };

  const lines: OrderLine[] = input.lines
    .filter((line) => line.qty > 0)
    .map((line) => ({
      id: genOrderLineId(),
      orderId,
      procurementItemId: line.procurementItemId,
      qty: line.qty,
      receivedQty: 0,
      unit: line.unit,
      plannedUnitPrice: line.plannedUnitPrice ?? null,
      actualUnitPrice: line.actualUnitPrice ?? null,
    }));

  orders = [...orders, created];
  orderLines = [...orderLines, ...lines];
  notify();

  return {
    ...created,
    lines,
  };
}

export function updateOrder(
  orderId: string,
  partial: Partial<Omit<Order, "id" | "projectId" | "createdAt" | "updatedAt">> & { lines?: DraftOrderLineInput[] },
): OrderWithLines | undefined {
  const existing = orders.find((entry) => entry.id === orderId);
  if (!existing) return undefined;

  const updated: Order = {
    ...existing,
    ...partial,
    updatedAt: new Date().toISOString(),
  };

  orders = orders.map((entry) => (entry.id === orderId ? updated : entry));

  if (partial.lines) {
    orderLines = orderLines.filter((line) => line.orderId !== orderId);
    const nextLines = partial.lines
      .filter((line) => line.qty > 0)
      .map((line) => ({
        id: genOrderLineId(),
        orderId,
        procurementItemId: line.procurementItemId,
        qty: line.qty,
        receivedQty: 0,
        unit: line.unit,
        plannedUnitPrice: line.plannedUnitPrice ?? null,
        actualUnitPrice: line.actualUnitPrice ?? null,
      }));
    orderLines = [...orderLines, ...nextLines];
  }

  notify();
  return withLines(updated);
}

export function placeOrder(orderId: string): { ok: true; order: OrderWithLines } | { ok: false; error: string } {
  const order = orders.find((entry) => entry.id === orderId);
  if (!order) return { ok: false, error: "Order not found" };
  if (order.status !== "draft") return { ok: false, error: "Only draft orders can be placed" };

  const lines = orderLines.filter((line) => line.orderId === orderId);
  if (lines.length === 0) return { ok: false, error: "Order has no lines" };

  if (order.kind === "stock") {
    const fromLocationId = order.fromLocationId;
    const toLocationId = order.toLocationId ?? order.deliverToLocationId ?? ensureDefaultLocation(order.projectId).id;

    if (!fromLocationId) {
      return { ok: false, error: "From location is required for stock allocations" };
    }

    for (const line of lines) {
      const item = getProcurementItemById(line.procurementItemId);
      if (!item) continue;
      const key = toInventoryKey(item);
      const available = getStock(order.projectId, fromLocationId, key);
      if (line.qty > available) {
        return { ok: false, error: `Not enough stock for ${item.name}` };
      }
    }

    const now = new Date().toISOString();
    const events: OrderReceiveEvent[] = [];

    lines.forEach((line) => {
      const item = getProcurementItemById(line.procurementItemId);
      if (!item) return;
      const key = toInventoryKey(item);
      adjustStock(order.projectId, fromLocationId, key, -line.qty);
      adjustStock(order.projectId, toLocationId, key, line.qty);
      events.push({
        id: genReceiveEventId(),
        orderId: order.id,
        orderLineId: line.id,
        procurementItemId: line.procurementItemId,
        locationId: fromLocationId,
        deltaQty: -line.qty,
        eventType: "move_out",
        sourceLocationId: toLocationId,
        createdAt: now,
      });
      events.push({
        id: genReceiveEventId(),
        orderId: order.id,
        orderLineId: line.id,
        procurementItemId: line.procurementItemId,
        locationId: toLocationId,
        deltaQty: line.qty,
        eventType: "move_in",
        sourceLocationId: fromLocationId,
        createdAt: now,
      });
    });
    orderReceiveEvents = [...orderReceiveEvents, ...events];

    orderLines = orderLines.map((line) => (
      line.orderId === orderId
        ? { ...line, receivedQty: line.qty }
        : line
    ));

    const nextOrder: Order = {
      ...order,
      status: "received",
      updatedAt: new Date().toISOString(),
    };
    orders = orders.map((entry) => (entry.id === orderId ? nextOrder : entry));

    refreshLegacyProcurementQuantities(order.projectId);
    notify();
    return { ok: true, order: withLines(nextOrder) };
  }

  const nextOrder: Order = {
    ...order,
    status: "placed",
    deliverToLocationId: order.deliverToLocationId ?? ensureDefaultLocation(order.projectId).id,
    updatedAt: new Date().toISOString(),
  };

  orders = orders.map((entry) => (entry.id === orderId ? nextOrder : entry));
  refreshLegacyProcurementQuantities(order.projectId);
  notify();
  return { ok: true, order: withLines(nextOrder) };
}

export function receiveOrder(
  orderId: string,
  payload: ReceiveOrderInput,
): { ok: true; order: OrderWithLines } | { ok: false; error: string } {
  const order = orders.find((entry) => entry.id === orderId);
  if (!order) return { ok: false, error: "Order not found" };
  if (order.kind !== "supplier") return { ok: false, error: "Only supplier orders can be received" };
  if (order.status === "draft") return { ok: false, error: "Draft order must be placed before receiving" };
  if (order.status === "voided") return { ok: false, error: "Voided order cannot be received" };

  const locationId = payload.locationId ?? order.deliverToLocationId ?? ensureDefaultLocation(order.projectId).id;
  const linesById = new Map(payload.lines.map((line) => [line.lineId, line.qty]));
  let receivedSomething = false;
  const newEvents: OrderReceiveEvent[] = [];
  const now = new Date().toISOString();

  orderLines = orderLines.map((line) => {
    if (line.orderId !== orderId) return line;

    const requestedQty = linesById.get(line.id) ?? 0;
    if (requestedQty <= 0) return line;

    const receivable = Math.max(0, line.qty - line.receivedQty);
    if (receivable <= 0) return line;

    const appliedQty = Math.min(requestedQty, receivable);
    if (appliedQty <= 0) return line;

    const item = getProcurementItemById(line.procurementItemId);
    if (item) {
      adjustStock(order.projectId, locationId, toInventoryKey(item), appliedQty);
    }
    newEvents.push({
      id: genReceiveEventId(),
      orderId: order.id,
      orderLineId: line.id,
      procurementItemId: line.procurementItemId,
      locationId,
      deltaQty: appliedQty,
      eventType: "receive",
      createdAt: now,
    });

    receivedSomething = true;
    return {
      ...line,
      receivedQty: line.receivedQty + appliedQty,
    };
  });

  if (!receivedSomething) {
    return { ok: false, error: "No quantities were received" };
  }
  orderReceiveEvents = [...orderReceiveEvents, ...newEvents];

  const currentLines = orderLines.filter((line) => line.orderId === orderId);
  const isFullyReceived = currentLines.every((line) => line.receivedQty >= line.qty);
  // Mirror the Supabase source, which records 'partially_received' once some but not all
  // quantity has landed. Without this, demo/local mode shows «Заказано» for the same data
  // the real backend shows as «Частично получено», so demo stops being a valid rehearsal
  // surface for the half-delivered state.
  const hasAnyReceipt = currentLines.some((line) => line.receivedQty > 0);

  const nextOrder: Order = {
    ...order,
    status: isFullyReceived ? "received" : (hasAnyReceipt ? "partially_received" : "placed"),
    deliverToLocationId: order.deliverToLocationId ?? locationId,
    updatedAt: new Date().toISOString(),
  };

  orders = orders.map((entry) => (entry.id === orderId ? nextOrder : entry));
  refreshLegacyProcurementQuantities(order.projectId);
  notify();
  return { ok: true, order: withLines(nextOrder) };
}

export function consumeStockFromInventory(
  payload: UseStockFromInventoryInput,
): { ok: true; event: OrderReceiveEvent; remainingQty: number } | { ok: false; error: string } {
  const qty = Number(payload.qty);
  if (!Number.isFinite(qty) || qty <= 0) {
    return { ok: false, error: "Quantity must be greater than zero" };
  }

  const item = getProcurementItemById(payload.procurementItemId);
  if (!item || item.projectId !== payload.projectId) {
    return { ok: false, error: "Procurement item not found" };
  }

  const inventoryKey = toInventoryKey(item);
  const available = getStock(payload.projectId, payload.locationId, inventoryKey);
  if (qty > available) {
    return { ok: false, error: "Quantity exceeds available stock" };
  }

  const anchor = orders
    .filter((order) => (
      order.projectId === payload.projectId
      && order.status !== "draft"
      && order.status !== "voided"
    ))
    .map((order) => ({
      order,
      line: orderLines.find((line) => line.orderId === order.id && line.procurementItemId === payload.procurementItemId) ?? null,
    }))
    .filter((entry): entry is { order: Order; line: OrderLine } => !!entry.line)
    .sort((a, b) => {
      const updatedDiff = new Date(b.order.updatedAt).getTime() - new Date(a.order.updatedAt).getTime();
      if (updatedDiff !== 0) return updatedDiff;
      return b.order.id.localeCompare(a.order.id);
    })[0];

  if (!anchor) {
    return { ok: false, error: "No order history found for this item" };
  }

  adjustStock(payload.projectId, payload.locationId, inventoryKey, -qty);

  const event: OrderReceiveEvent = {
    id: genReceiveEventId(),
    orderId: anchor.order.id,
    orderLineId: anchor.line.id,
    procurementItemId: payload.procurementItemId,
    locationId: payload.locationId,
    deltaQty: -qty,
    eventType: "use",
    usedByParticipantId: payload.usedByParticipantId ?? null,
    usedByName: payload.usedByName ?? null,
    note: payload.note ?? null,
    createdAt: new Date().toISOString(),
  };
  orderReceiveEvents = [...orderReceiveEvents, event];
  notify();

  return {
    ok: true,
    event,
    remainingQty: Math.max(0, available - qty),
  };
}

export function cancelDraftOrder(
  orderId: string,
): { ok: true; order: OrderWithLines } | { ok: false; error: string } {
  const order = orders.find((entry) => entry.id === orderId);
  if (!order) return { ok: false, error: "Order not found" };
  if (order.status !== "draft") return { ok: false, error: "Only draft orders can be cancelled" };

  const nextOrder: Order = {
    ...order,
    status: "voided",
    updatedAt: new Date().toISOString(),
  };
  orders = orders.map((entry) => (entry.id === orderId ? nextOrder : entry));
  refreshLegacyProcurementQuantities(order.projectId);
  notify();
  return { ok: true, order: withLines(nextOrder) };
}

export function voidOrder(
  orderId: string,
): { ok: true; order: OrderWithLines } | { ok: false; error: string } {
  const order = orders.find((entry) => entry.id === orderId);
  if (!order) return { ok: false, error: "Order not found" };
  if (order.status === "voided") return { ok: false, error: "Order is already voided" };

  if (order.kind === "supplier") {
    if (!isOpenOrderStatus(order.status)) {
      return { ok: false, error: "Only placed supplier orders can be voided" };
    }
    // A partially received order falls through to the received-quantity guard below, which
    // rejects it with the more precise message — same outcome as before this status existed.
    const lines = orderLines.filter((line) => line.orderId === orderId);
    if (lines.some((line) => line.receivedQty > 0)) {
      return { ok: false, error: "Supplier order with received quantities cannot be voided" };
    }
  }

  if (order.kind === "stock") {
    if (order.status !== "received") {
      return { ok: false, error: "Only completed stock allocations can be voided" };
    }
    const movementEvents = orderReceiveEvents.filter((event) => event.orderId === orderId);
    if (movementEvents.length === 0) {
      return { ok: false, error: "Stock movement history is missing for this order" };
    }

    for (const event of movementEvents) {
      if (event.deltaQty <= 0) continue;
      const item = getProcurementItemById(event.procurementItemId);
      if (!item) continue;
      const available = getStock(order.projectId, event.locationId, toInventoryKey(item));
      if (available < event.deltaQty) {
        return { ok: false, error: `Cannot void: insufficient stock in ${event.locationId}` };
      }
    }

    const reversalEvents: OrderReceiveEvent[] = [];
    const now = new Date().toISOString();
    for (const event of movementEvents) {
      const item = getProcurementItemById(event.procurementItemId);
      if (!item) continue;
      const key = toInventoryKey(item);
      adjustStock(order.projectId, event.locationId, key, -event.deltaQty);
      reversalEvents.push({
        id: genReceiveEventId(),
        orderId: order.id,
        orderLineId: event.orderLineId,
        procurementItemId: event.procurementItemId,
        locationId: event.locationId,
        deltaQty: -event.deltaQty,
        eventType: "void_reversal",
        createdAt: now,
      });
    }
    orderReceiveEvents = [...orderReceiveEvents, ...reversalEvents];
  }

  const nextOrder: Order = {
    ...order,
    status: "voided",
    updatedAt: new Date().toISOString(),
  };
  orders = orders.map((entry) => (entry.id === orderId ? nextOrder : entry));
  refreshLegacyProcurementQuantities(order.projectId);
  notify();
  return { ok: true, order: withLines(nextOrder) };
}

export function __unsafeResetOrdersForTests() {
  orders = [];
  orderLines = [];
  orderReceiveEvents = [];
}
