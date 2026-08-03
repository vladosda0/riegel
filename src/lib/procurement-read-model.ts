import { getProjects } from "@/data/store";
import { getAllProcurementItemsV2 } from "@/data/procurement-store";
import { listOrdersByProject } from "@/data/order-store";
import { listLocations, listStockByProject } from "@/data/inventory-store";
import {
  computeInStockByLocation,
  computeOrderedOpenQty,
  computeRemainingRequestedQty,
} from "@/lib/procurement-fulfillment";
import type { InventoryLocation, OrderWithLines, ProcurementItemV2 } from "@/types/entities";

export type ProcurementReadStatus = "requested" | "ordered" | "in_stock";

export interface ProcurementReadRow {
  id: string;
  projectId: string;
  name: string;
  spec: string | null;
  unit: string;
  requiredQty: number;
  remainingQty: number;
  orderedOpenQty: number;
  inStockQty: number;
  status: ProcurementReadStatus;
  statusQty: number;
  statusTotal: number;
  plannedUnitPrice: number;
  actualUnitPrice: number;
  inStockPlannedTotal: number;
  inStockActualTotal: number;
  /** When false, UI must not show price-derived values (Home sensitive-detail gate). */
  monetaryVisible?: boolean;
}

export interface ProcurementReadProjectSummary {
  projectId: string;
  projectTitle: string;
  rows: ProcurementReadRow[];
  totalCount: number;
  requestedCount: number;
  orderedCount: number;
  inStockCount: number;
  requestedTotal: number;
  orderedTotal: number;
  inStockTotal: number;
  inStockPlannedTotal: number;
  inStockActualTotal: number;
}

export interface ProcurementReadTotals {
  totalCount: number;
  requestedCount: number;
  orderedCount: number;
  inStockCount: number;
  requestedTotal: number;
  orderedTotal: number;
  inStockTotal: number;
  inStockPlannedTotal: number;
  inStockActualTotal: number;
}

export interface ProcurementReadSnapshot {
  projects: ProcurementReadProjectSummary[];
  totals: ProcurementReadTotals;
}

function plannedUnitPrice(item: ProcurementItemV2): number {
  return item.plannedUnitPrice ?? 0;
}

function actualUnitPrice(item: ProcurementItemV2): number {
  return item.actualUnitPrice ?? item.plannedUnitPrice ?? 0;
}

function classifyStatus(remainingQty: number, orderedOpenQty: number, inStockQty: number): ProcurementReadStatus {
  if (remainingQty > 0 && orderedOpenQty > 0) return "ordered";
  if (remainingQty > 0) return "requested";
  if (inStockQty > 0) return "in_stock";
  if (orderedOpenQty > 0) return "ordered";
  return "requested";
}

function statusQty(status: ProcurementReadStatus, remainingQty: number, orderedOpenQty: number, inStockQty: number): number {
  if (status === "ordered") return orderedOpenQty;
  if (status === "in_stock") return inStockQty;
  return remainingQty;
}

function statusTotal(
  status: ProcurementReadStatus,
  qty: number,
  plannedPrice: number,
  actualPrice: number,
): number {
  if (status === "requested") return plannedPrice * qty;
  return actualPrice * qty;
}

/**
 * The per-project half of the read model, with every input supplied by the caller.
 *
 * Extracted from `getProcurementReadSnapshot` so a caller holding ONE project's data can build
 * its summary without going through the cross-project snapshot, which sources everything from
 * the browser stores and is therefore empty for any authenticated Supabase user (#215).
 * `getProcurementReadSnapshot` still calls this, so both paths share one implementation and
 * cannot drift.
 *
 * Returns null when the project has no live items, mirroring the `totalCount > 0` filter the
 * snapshot applies, so "nothing here" reads the same in both paths.
 */
export function buildProcurementReadProjectSummary(
  project: { id: string; title: string },
  items: ProcurementItemV2[],
  orders: OrderWithLines[],
  locations: InventoryLocation[],
): ProcurementReadProjectSummary | null {
  const projectItems = items.filter((item) => item.projectId === project.id && !item.archived);
  const inStockGroups = computeInStockByLocation(project.id, projectItems, orders, locations);
  const inStockByItemId = new Map<string, number>();
  inStockGroups.forEach((group) => {
    group.items.forEach((entry) => {
      inStockByItemId.set(
        entry.procurementItemId,
        (inStockByItemId.get(entry.procurementItemId) ?? 0) + entry.qty,
      );
    });
  });

  const rows = projectItems.map((item) => {
    const remainingQty = computeRemainingRequestedQty(item, orders);
    const orderedOpenQty = computeOrderedOpenQty(item.id, orders);
    const inStockQty = inStockByItemId.get(item.id) ?? 0;
    const status = classifyStatus(remainingQty, orderedOpenQty, inStockQty);
    const qty = statusQty(status, remainingQty, orderedOpenQty, inStockQty);
    const planned = plannedUnitPrice(item);
    const actual = actualUnitPrice(item);
    return {
      id: item.id,
      projectId: item.projectId,
      name: item.name,
      spec: item.spec,
      unit: item.unit,
      requiredQty: item.requiredQty,
      remainingQty,
      orderedOpenQty,
      inStockQty,
      status,
      statusQty: qty,
      statusTotal: statusTotal(status, qty, planned, actual),
      plannedUnitPrice: planned,
      actualUnitPrice: actual,
      inStockPlannedTotal: planned * inStockQty,
      inStockActualTotal: actual * inStockQty,
    } satisfies ProcurementReadRow;
  }).sort((a, b) => a.name.localeCompare(b.name));

  if (rows.length === 0) return null;

  const requestedRows = rows.filter((row) => row.status === "requested");
  const orderedRows = rows.filter((row) => row.status === "ordered");
  const inStockRows = rows.filter((row) => row.status === "in_stock");

  return {
    projectId: project.id,
    projectTitle: project.title,
    rows,
    totalCount: rows.length,
    requestedCount: requestedRows.length,
    orderedCount: orderedRows.length,
    inStockCount: inStockRows.length,
    requestedTotal: requestedRows.reduce((sum, row) => sum + row.statusTotal, 0),
    orderedTotal: orderedRows.reduce((sum, row) => sum + row.statusTotal, 0),
    inStockTotal: inStockRows.reduce((sum, row) => sum + row.statusTotal, 0),
    inStockPlannedTotal: rows.reduce((sum, row) => sum + row.inStockPlannedTotal, 0),
    inStockActualTotal: rows.reduce((sum, row) => sum + row.inStockActualTotal, 0),
  } satisfies ProcurementReadProjectSummary;
}

export function getProcurementReadSnapshot(): ProcurementReadSnapshot {
  const projects = getProjects();
  const allItems = getAllProcurementItemsV2();

  const summaries: ProcurementReadProjectSummary[] = projects
    .map((project) => buildProcurementReadProjectSummary(
      project,
      allItems,
      listOrdersByProject(project.id),
      listLocations(project.id),
    ))
    .filter((summary): summary is ProcurementReadProjectSummary => summary !== null);

  const totals: ProcurementReadTotals = {
    totalCount: summaries.reduce((sum, summary) => sum + summary.totalCount, 0),
    requestedCount: summaries.reduce((sum, summary) => sum + summary.requestedCount, 0),
    orderedCount: summaries.reduce((sum, summary) => sum + summary.orderedCount, 0),
    inStockCount: summaries.reduce((sum, summary) => sum + summary.inStockCount, 0),
    requestedTotal: summaries.reduce((sum, summary) => sum + summary.requestedTotal, 0),
    orderedTotal: summaries.reduce((sum, summary) => sum + summary.orderedTotal, 0),
    inStockTotal: summaries.reduce((sum, summary) => sum + summary.inStockTotal, 0),
    inStockPlannedTotal: summaries.reduce((sum, summary) => sum + summary.inStockPlannedTotal, 0),
    inStockActualTotal: summaries.reduce((sum, summary) => sum + summary.inStockActualTotal, 0),
  };

  return {
    projects: summaries,
    totals,
  };
}

/**
 * Home-only: clear price-derived row fields and project monetary rollups when the viewer lacks
 * sensitive-detail access; preserve counts. Recomputes snapshot monetary totals from allowed projects only.
 */
export function applySensitiveDetailToProcurementReadSnapshot(
  snapshot: ProcurementReadSnapshot,
  canViewSensitiveDetail: (projectId: string) => boolean,
): ProcurementReadSnapshot {
  const projects = snapshot.projects.map((proj) => {
    if (canViewSensitiveDetail(proj.projectId)) {
      return proj;
    }
    return {
      ...proj,
      requestedTotal: 0,
      orderedTotal: 0,
      inStockTotal: 0,
      inStockPlannedTotal: 0,
      inStockActualTotal: 0,
      rows: proj.rows.map((row) => ({
        ...row,
        monetaryVisible: false,
        statusTotal: 0,
        plannedUnitPrice: 0,
        actualUnitPrice: 0,
        inStockPlannedTotal: 0,
        inStockActualTotal: 0,
      })),
    };
  });

  const totals: ProcurementReadTotals = {
    totalCount: snapshot.totals.totalCount,
    requestedCount: snapshot.totals.requestedCount,
    orderedCount: snapshot.totals.orderedCount,
    inStockCount: snapshot.totals.inStockCount,
    requestedTotal: projects.reduce((sum, p) => sum + p.requestedTotal, 0),
    orderedTotal: projects.reduce((sum, p) => sum + p.orderedTotal, 0),
    inStockTotal: projects.reduce((sum, p) => sum + p.inStockTotal, 0),
    inStockPlannedTotal: projects.reduce((sum, p) => sum + p.inStockPlannedTotal, 0),
    inStockActualTotal: projects.reduce((sum, p) => sum + p.inStockActualTotal, 0),
  };

  return { projects, totals };
}

export function getProcurementReadProjectSummary(projectId: string): ProcurementReadProjectSummary | null {
  const snapshot = getProcurementReadSnapshot();
  return snapshot.projects.find((summary) => summary.projectId === projectId) ?? null;
}

export function getProcurementInStockValueFromInventory(projectId: string): number {
  const stockRows = listStockByProject(projectId).filter((row) => row.qty > 0);
  if (stockRows.length === 0) return 0;

  const items = getAllProcurementItemsV2().filter((item) => item.projectId === projectId);
  const unitPriceByKey = new Map<string, number>();
  items.forEach((item) => {
    const key = [
      item.name.toLowerCase().trim(),
      (item.spec ?? "").toLowerCase().trim(),
      item.unit.toLowerCase().trim(),
    ].join("|");
    if (!unitPriceByKey.has(key)) {
      unitPriceByKey.set(key, actualUnitPrice(item));
    }
  });

  return stockRows.reduce((sum, row) => sum + (unitPriceByKey.get(row.inventoryKey) ?? 0) * row.qty, 0);
}
