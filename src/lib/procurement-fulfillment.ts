import { normalizeName } from "@/lib/procurement-utils";
import type {
  InventoryLocation,
  OrderLine,
  OrderReceiveEvent,
  OrderStatus,
  OrderWithLines,
  ProcurementItemV2,
} from "@/types/entities";

/**
 * The order exists operationally: placed, not voided, not a draft — so its lines represent
 * real committed quantities and real money.
 *
 * `partially_received` is the state between `placed` and `received` and belongs here with
 * them. Omitting it silently zeroes spend, on-hand stock, procurement KPIs and the estimate
 * delete guards for a half-delivered order, which reads as "clean" because every individual
 * status check looks reasonable in isolation.
 *
 * Domain note: this is the CLIENT model (`OrderStatus`). The Supabase row domain is a
 * different set (`cancelled` where this has `voided`), so it cannot share this predicate and
 * is checked separately in two places that must stay in agreement with it:
 * `orderRowStatusAllowsOperationalLineHydration` in `@/data/orders-source` and the
 * same-named `isAppliedOrderStatus` in `@/data/procurement-source`.
 */
export function isAppliedOrderStatus(status: OrderStatus): boolean {
  return status === "placed" || status === "partially_received" || status === "received";
}

/**
 * An applied order that still has unreceived quantity outstanding, i.e. money that is
 * committed but not yet delivered. `received` is excluded because a fully received order
 * has nothing open left; `partially_received` is included because it does.
 */
export function isOpenOrderStatus(status: OrderStatus): boolean {
  return status === "placed" || status === "partially_received";
}

export interface InStockItemByLocation {
  procurementItemId: string;
  qty: number;
  plannedValue: number;
  actualValue: number;
  orderIds: string[];
}

export interface InStockLocationGroup {
  locationId: string;
  locationName: string;
  locationAddress?: string;
  totalValue: number;
  items: InStockItemByLocation[];
}

export interface TabChipStat {
  count: number;
  total: number;
}

export interface ProcurementTabChipTotals {
  requested: TabChipStat;
  ordered: TabChipStat;
  inStock: TabChipStat;
}

export interface InventoryStockSnapshotRow {
  projectId: string;
  locationId: string;
  inventoryKey: string;
  qty: number;
}

export interface ItemLocationEventEntry {
  order: OrderWithLines;
  line: OrderLine | null;
  event: OrderReceiveEvent;
}

export interface ItemLocationEventHistory {
  receiptEvents: ItemLocationEventEntry[];
  usageEvents: ItemLocationEventEntry[];
}

export interface ProcurementHeaderKpis {
  planned: number | null;
  committed: number | null;
  received: number | null;
  used: number | null;
  variance: number | null;
  hasLinkedItems: boolean;
  missingPlannedPriceCount: number;
  missingOrderPriceCount: number;
}

function isAppliedOrder(order: OrderWithLines): boolean {
  return isAppliedOrderStatus(order.status);
}

/**
 * Which applied orders count as FULFILLING a procurement requirement, as opposed to merely
 * moving units that were already counted.
 *
 * Supplier orders always count: they are how material enters the project. Stock orders are the
 * subtle case. A cross-project transfer's «in» side brings genuinely new material into this
 * project and must count. A same-project warehouse-to-warehouse move (`transferDirection`
 * null/undefined) only relocates units a supplier order already counted, so counting it again
 * subtracts the same quantity a second time and drives «Осталось заказать» down with ordinary
 * warehouse activity. The «out» side of a cross-project transfer never matches a procurement
 * item anyway — `20260630140000_cross_project_transfer_deferred_receipt.sql` writes that line
 * with a NULL `procurement_item_id` — but it is excluded explicitly so this predicate states
 * the whole rule instead of leaning on that.
 *
 * The sibling helpers in this file (`computeOrderedOpenQty`, `computeProcurementHeaderKpis`,
 * `computePurchasePriceVariance`, `computeProjectLastReceivedAt`) filter to supplier orders
 * only, which is right for what each of them measures. See #216.
 */
function countsTowardFulfillment(order: OrderWithLines): boolean {
  return order.kind === "supplier" || order.transferDirection === "in";
}

function unitPriceForItem(item: ProcurementItemV2): number {
  return item.actualUnitPrice ?? item.plannedUnitPrice ?? 0;
}

export function isEstimateLinkedProcurementItem(
  item: Pick<ProcurementItemV2, "sourceEstimateV2LineId" | "sourceEstimateItemId">,
): boolean {
  return Boolean(item.sourceEstimateV2LineId);
}

export function toInventoryKey(item: Pick<ProcurementItemV2, "name" | "spec" | "unit">): string {
  return [
    normalizeName(item.name),
    item.spec ? normalizeName(item.spec) : "",
    item.unit.trim().toLowerCase(),
  ].join("|");
}

export function computeRemainingRequestedQty(
  item: Pick<ProcurementItemV2, "id" | "requiredQty"> | undefined,
  orders: OrderWithLines[],
): number {
  if (!item) return 0;

  const fulfilledFromOrders = orders
    .filter((order) => isAppliedOrder(order) && countsTowardFulfillment(order))
    .flatMap((order) => order.lines)
    .filter((line) => line.procurementItemId === item.id)
    .reduce((sum, line) => sum + line.qty, 0);

  return Math.max(item.requiredQty - fulfilledFromOrders, 0);
}

export function computeOrderedOpenQty(requestId: string, orders: OrderWithLines[]): number {
  return orders
    .filter((order) => order.kind === "supplier" && isOpenOrderStatus(order.status))
    .flatMap((order) => order.lines)
    .filter((line) => line.procurementItemId === requestId)
    .reduce((sum, line) => sum + Math.max(line.qty - line.receivedQty, 0), 0);
}

export function computeFulfilledQty(requestId: string, orders: OrderWithLines[]): number {
  return orders
    .filter((order) => isAppliedOrder(order) && countsTowardFulfillment(order))
    .flatMap((order) => order.lines)
    .filter((line) => line.procurementItemId === requestId)
    .reduce((sum, line) => sum + line.qty, 0);
}

export function computeInStockByLocation(
  projectId: string,
  items: ProcurementItemV2[],
  orders: OrderWithLines[],
  locations: InventoryLocation[],
): InStockLocationGroup[] {
  const qtyByLocationItem = new Map<string, number>();
  const orderIdsByLocationItem = new Map<string, Set<string>>();

  const locationNameById = new Map(locations.map((location) => [location.id, location]));
  const itemById = new Map(items.map((item) => [item.id, item]));

  const applyQty = (locationId: string, itemId: string, delta: number, orderId: string) => {
    if (!locationId || !itemById.has(itemId) || delta === 0) return;
    const key = `${locationId}::${itemId}`;
    const next = (qtyByLocationItem.get(key) ?? 0) + delta;
    qtyByLocationItem.set(key, next);

    const orderIds = orderIdsByLocationItem.get(key) ?? new Set<string>();
    orderIds.add(orderId);
    orderIdsByLocationItem.set(key, orderIds);
  };

  orders
    .filter((order) => order.projectId === projectId && isAppliedOrder(order))
    .forEach((order) => {
      const fallbackLocation = locations.find((location) => location.isDefault)?.id ?? locations[0]?.id ?? "";
      const events = order.receiveEvents ?? [];

      if (events.length > 0) {
        events.forEach((event) => {
          if (!itemById.has(event.procurementItemId)) return;
          applyQty(event.locationId, event.procurementItemId, event.deltaQty, order.id);
        });
        return;
      }

      // Legacy fallback for orders without receive/move event history.
      order.lines.forEach((line) => {
        if (!itemById.has(line.procurementItemId)) return;

        if (order.kind === "supplier") {
          const locationId = order.deliverToLocationId ?? fallbackLocation;
          applyQty(locationId, line.procurementItemId, line.receivedQty, order.id);
          return;
        }

        // A not-yet-received stock order holds no real stock: a deferred cross-project transfer
        // writes NO movements until receipt, so this legacy (event-less) fallback must not credit
        // its qty as on-hand (a placed 'in' order would otherwise phantom-fill the destination, and
        // a placed 'out' order the source). Received legacy stock orders always have events and take
        // the branch above, so they never reach here.
        if (order.status !== "received") return;

        const toLocationId = order.toLocationId ?? order.deliverToLocationId ?? fallbackLocation;
        const fromLocationId = order.fromLocationId ?? "";
        applyQty(toLocationId, line.procurementItemId, line.qty, order.id);
        applyQty(fromLocationId, line.procurementItemId, -line.qty, order.id);
      });
    });

  const groupsMap = new Map<string, InStockLocationGroup>();
  qtyByLocationItem.forEach((qty, key) => {
    if (qty <= 0) return;
    const [locationId, itemId] = key.split("::");
    const item = itemById.get(itemId);
    if (!item) return;

    const location = locationNameById.get(locationId);
    const group = groupsMap.get(locationId) ?? {
      locationId,
      locationName: location?.name ?? "Unknown location",
      locationAddress: location?.address,
      totalValue: 0,
      items: [],
    };

    const plannedValue = (item.plannedUnitPrice ?? 0) * qty;
    const actualValue = unitPriceForItem(item) * qty;

    group.items.push({
      procurementItemId: item.id,
      qty,
      plannedValue,
      actualValue,
      orderIds: Array.from(orderIdsByLocationItem.get(key) ?? []),
    });
    group.totalValue += actualValue;
    groupsMap.set(locationId, group);
  });

  return Array.from(groupsMap.values())
    .map((group) => ({
      ...group,
      items: group.items.sort((a, b) => a.procurementItemId.localeCompare(b.procurementItemId)),
    }))
    .sort((a, b) => a.locationName.localeCompare(b.locationName));
}

function isReceiptLikeEvent(event: OrderReceiveEvent): boolean {
  return event.deltaQty > 0 && (event.eventType === "receive" || event.eventType === "move_in");
}

function resolveLineUnitPrice(
  line: Pick<OrderLine, "actualUnitPrice" | "plannedUnitPrice">,
  item: Pick<ProcurementItemV2, "actualUnitPrice" | "plannedUnitPrice"> | undefined,
): number | null {
  const value = line.actualUnitPrice
    ?? line.plannedUnitPrice
    ?? item?.actualUnitPrice
    ?? item?.plannedUnitPrice
    ?? null;
  if (value === null || !Number.isFinite(value)) return null;
  return value;
}

export function computeLastReceivedAt(
  procurementItemId: string,
  locationId: string,
  orders: OrderWithLines[],
): string | null {
  let maxTimestampMs = Number.NEGATIVE_INFINITY;
  let maxTimestampIso: string | null = null;

  orders.forEach((order) => {
    if (!isAppliedOrder(order)) return;
    (order.receiveEvents ?? []).forEach((event) => {
      if (event.procurementItemId !== procurementItemId || event.locationId !== locationId) return;
      if (!isReceiptLikeEvent(event)) return;
      const ts = new Date(event.createdAt).getTime();
      if (Number.isNaN(ts) || ts <= maxTimestampMs) return;
      maxTimestampMs = ts;
      maxTimestampIso = event.createdAt;
    });
  });

  return maxTimestampIso;
}

export function collectItemLocationEventHistory(
  procurementItemId: string,
  locationId: string,
  orders: OrderWithLines[],
): ItemLocationEventHistory {
  const receiptEvents: ItemLocationEventEntry[] = [];
  const usageEvents: ItemLocationEventEntry[] = [];

  orders.forEach((order) => {
    if (!isAppliedOrder(order)) return;
    const lineById = new Map(order.lines.map((line) => [line.id, line]));

    (order.receiveEvents ?? []).forEach((event) => {
      if (event.procurementItemId !== procurementItemId || event.locationId !== locationId) return;
      const entry: ItemLocationEventEntry = {
        order,
        line: lineById.get(event.orderLineId) ?? null,
        event,
      };
      if (isReceiptLikeEvent(event)) {
        receiptEvents.push(entry);
        return;
      }
      if (event.eventType === "use" && event.deltaQty < 0) {
        usageEvents.push(entry);
      }
    });
  });

  const sortByNewest = (a: ItemLocationEventEntry, b: ItemLocationEventEntry) => (
    new Date(b.event.createdAt).getTime() - new Date(a.event.createdAt).getTime()
  );

  receiptEvents.sort(sortByNewest);
  usageEvents.sort(sortByNewest);

  return { receiptEvents, usageEvents };
}

export function computeProcurementHeaderKpis(
  projectId: string,
  items: ProcurementItemV2[],
  orders: OrderWithLines[],
): ProcurementHeaderKpis {
  const linkedItems = items
    .filter((item) => item.projectId === projectId)
    .filter(isEstimateLinkedProcurementItem);
  const hasLinkedItems = linkedItems.length > 0;
  const linkedItemIdSet = new Set(linkedItems.map((item) => item.id));
  const itemById = new Map(linkedItems.map((item) => [item.id, item]));

  let plannedSum = 0;
  let missingPlannedPriceCount = 0;
  linkedItems.forEach((item) => {
    if (item.plannedUnitPrice === null || !Number.isFinite(item.plannedUnitPrice)) {
      missingPlannedPriceCount += 1;
      return;
    }
    plannedSum += item.plannedUnitPrice * item.requiredQty;
  });

  let committedSum = 0;
  let receivedSum = 0;
  let missingOrderPriceCount = 0;

  orders
    .filter((order) => order.projectId === projectId && order.kind === "supplier" && isAppliedOrder(order))
    .forEach((order) => {
      order.lines.forEach((line) => {
        if (!linkedItemIdSet.has(line.procurementItemId)) return;
        const openQty = Math.max(line.qty - line.receivedQty, 0);
        const receivedQty = Math.max(line.receivedQty, 0);
        if (openQty <= 0 && receivedQty <= 0) return;

        const item = itemById.get(line.procurementItemId);
        const unitPrice = resolveLineUnitPrice(line, item);
        if (unitPrice === null) {
          missingOrderPriceCount += 1;
          return;
        }

        committedSum += unitPrice * openQty;
        receivedSum += unitPrice * receivedQty;
      });
    });

  const planned = hasLinkedItems && missingPlannedPriceCount === 0 ? plannedSum : null;
  const committed = hasLinkedItems && missingOrderPriceCount === 0 ? committedSum : null;
  const received = hasLinkedItems && missingOrderPriceCount === 0 ? receivedSum : null;
  const used = committed !== null && received !== null ? committed + received : null;
  const variance = planned !== null && used !== null ? planned - used : null;

  return {
    planned,
    committed,
    received,
    used,
    variance,
    hasLinkedItems,
    missingPlannedPriceCount,
    missingOrderPriceCount,
  };
}

export interface PurchasePriceVarianceLine {
  procurementItemId: string;
  receivedQty: number;
  plannedUnitPrice: number;
  actualUnitPrice: number;
  /** (actual − planned) × receivedQty; positive = переплата, negative = экономия. */
  deltaTotal: number;
}

export interface PurchasePriceVarianceSummary {
  /** Σ delta over received lines with both prices known. Positive = переплата. */
  deltaTotal: number;
  /** Σ planned × receivedQty over the same lines (the comparison base). */
  baseTotal: number;
  /** deltaTotal / baseTotal × 100; null when nothing received with known prices. */
  pct: number | null;
  /** Per-line breakdown, non-zero deltas only, largest |delta| first. */
  lines: PurchasePriceVarianceLine[];
  /** Received lines skipped because planned or actual price is unknown. */
  skippedLineCount: number;
}

/**
 * Purchase price variance (spec Part 2 §7.5): fact price vs planned price over RECEIVED
 * quantities only (a fact price is required, so unreceived lines never count). Planned
 * comes from the line's planned price falling back to the item's; actual from the line's
 * actual price falling back to the item's — no planned-as-actual substitution.
 * Estimate-linked items only, matching the budget/funnel population: the planned price
 * basis is the estimate line, so out-of-estimate manual purchases are out of scope here.
 */
export function computePurchasePriceVariance(
  projectId: string,
  items: ProcurementItemV2[],
  orders: OrderWithLines[],
): PurchasePriceVarianceSummary {
  const itemById = new Map(
    items
      .filter((item) => item.projectId === projectId)
      .filter(isEstimateLinkedProcurementItem)
      .map((item) => [item.id, item]),
  );

  let deltaTotal = 0;
  let baseTotal = 0;
  let skippedLineCount = 0;
  const lines: PurchasePriceVarianceLine[] = [];

  orders
    .filter((order) => order.projectId === projectId && order.kind === "supplier" && isAppliedOrder(order))
    .forEach((order) => {
      order.lines.forEach((line) => {
        const receivedQty = Math.max(line.receivedQty, 0);
        if (receivedQty <= 0) return;
        const item = itemById.get(line.procurementItemId);
        if (!item) return;

        const plannedUnitPrice = line.plannedUnitPrice ?? item.plannedUnitPrice ?? null;
        const actualUnitPrice = line.actualUnitPrice ?? item.actualUnitPrice ?? null;
        if (
          plannedUnitPrice === null || !Number.isFinite(plannedUnitPrice)
          || actualUnitPrice === null || !Number.isFinite(actualUnitPrice)
        ) {
          skippedLineCount += 1;
          return;
        }

        const deltaLine = (actualUnitPrice - plannedUnitPrice) * receivedQty;
        deltaTotal += deltaLine;
        baseTotal += plannedUnitPrice * receivedQty;
        if (deltaLine !== 0) {
          lines.push({
            procurementItemId: line.procurementItemId,
            receivedQty,
            plannedUnitPrice,
            actualUnitPrice,
            deltaTotal: deltaLine,
          });
        }
      });
    });

  lines.sort((a, b) => Math.abs(b.deltaTotal) - Math.abs(a.deltaTotal));

  return {
    deltaTotal,
    baseTotal,
    pct: baseTotal > 0 ? (deltaTotal / baseTotal) * 100 : null,
    lines,
    skippedLineCount,
  };
}

/**
 * Latest SUPPLIER receipt timestamp across the project's applied orders. Internal
 * stock transfers (move_in arrivals) are not deliveries, so they don't count here —
 * unlike the per-location computeLastReceivedAt, where an arrival at that location does.
 */
export function computeProjectLastReceivedAt(projectId: string, orders: OrderWithLines[]): string | null {
  let maxTimestampMs = Number.NEGATIVE_INFINITY;
  let maxTimestampIso: string | null = null;

  orders.forEach((order) => {
    if (order.projectId !== projectId || order.kind !== "supplier" || !isAppliedOrder(order)) return;
    (order.receiveEvents ?? []).forEach((event) => {
      if (event.eventType !== "receive" || event.deltaQty <= 0) return;
      const ts = new Date(event.createdAt).getTime();
      if (Number.isNaN(ts) || ts <= maxTimestampMs) return;
      maxTimestampMs = ts;
      maxTimestampIso = event.createdAt;
    });
  });

  return maxTimestampIso;
}

export function computeTabChipTotals(
  projectId: string,
  items: ProcurementItemV2[],
  orders: OrderWithLines[],
  inventoryRows: InventoryStockSnapshotRow[],
): ProcurementTabChipTotals {
  const requestedItems = items
    .filter((item) => item.projectId === projectId)
    .filter(isEstimateLinkedProcurementItem)
    .map((item) => ({ item, remaining: computeRemainingRequestedQty(item, orders) }))
    .filter(({ remaining }) => remaining > 0);

  const requested: TabChipStat = {
    count: requestedItems.length,
    total: requestedItems.reduce((sum, entry) => sum + (entry.item.plannedUnitPrice ?? 0) * entry.remaining, 0),
  };

  // Count placed supplier orders AND pending cross-project transfers (both sides) — an outgoing
  // transfer is a real placed order in this project, so it belongs in the "ordered" tally.
  const orderedOrders = orders.filter((order) =>
    order.projectId === projectId
    && isOpenOrderStatus(order.status)
    && (order.kind === "supplier" || order.transferDirection != null));
  const itemById = new Map(items.map((item) => [item.id, item]));
  const ordered: TabChipStat = {
    count: orderedOrders.length,
    total: orderedOrders.reduce((sum, order) => sum + order.lines.reduce((lineSum, line) => {
      const item = itemById.get(line.procurementItemId);
      const openQty = Math.max(line.qty - line.receivedQty, 0);
      const unitPrice = line.actualUnitPrice
        ?? line.plannedUnitPrice
        ?? item?.actualUnitPrice
        ?? item?.plannedUnitPrice
        ?? 0;
      return lineSum + unitPrice * openQty;
    }, 0), 0),
  };

  const priceByInventoryKey = new Map<string, number>();
  items
    .filter((item) => item.projectId === projectId)
    .forEach((item) => {
      const key = toInventoryKey(item);
      if (!priceByInventoryKey.has(key)) {
        priceByInventoryKey.set(key, unitPriceForItem(item));
      }
    });

  const inStockRows = inventoryRows
    .filter((row) => row.projectId === projectId && row.qty > 0);
  const inStock: TabChipStat = {
    count: inStockRows.length,
    total: inStockRows.reduce((sum, row) => sum + (priceByInventoryKey.get(row.inventoryKey) ?? 0) * row.qty, 0),
  };

  return { requested, ordered, inStock };
}
