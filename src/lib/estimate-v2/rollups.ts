import { getHRItems, getHRPayments } from "@/data/hr-store";
import { listOrdersByProject } from "@/data/order-store";
import { getProcurementItems } from "@/data/procurement-store";
import {
  computeOrderedOpenQty,
  computeRemainingRequestedQty,
  isAppliedOrderStatus,
} from "@/lib/procurement-fulfillment";
import { computeProjectTotals } from "@/lib/estimate-v2/pricing";
import { toDayIndex } from "@/lib/estimate-v2/schedule";
import type { OrderWithLines, ProcurementItemV2 } from "@/types/entities";
import type {
  EstimateV2Project,
  EstimateV2ResourceLine,
  EstimateV2Stage,
  ResourceLineType,
  ScheduleBaseline,
} from "@/types/estimate-v2";
import type { HRPayment, HRPlannedItem } from "@/types/hr";

export interface PlannedRollups {
  plannedBudgetCents: number;
  plannedCostByTypeCents: Record<ResourceLineType, number>;
  plannedSubtotalCents: number;
  plannedTaxCents: number;
}

export interface FactRollups {
  spentCents: number;
  spentByTypeCents: Record<ResourceLineType, number>;
  unattributedSpendCents: number;
  toBePaidPlannedCents: number;
  spentAbovePlannedCents: number;
}

export interface ScheduleActualsFromTasks {
  unfinishedTaskCount: number;
}

export interface CombinedPlanFactMetrics {
  planned: PlannedRollups;
  fact: FactRollups;
  durationPlannedDays: number | null;
  daysToEnd: number | null;
  behindScheduleDays: number;
}

function emptyByType(): Record<ResourceLineType, number> {
  return {
    material: 0,
    tool: 0,
    labor: 0,
    subcontractor: 0,
    overhead: 0,
    other: 0,
  };
}

function procurementTypeToResourceType(type: ProcurementItemV2["type"]): ResourceLineType | null {
  if (type === "material") return "material";
  if (type === "tool") return "tool";
  return null;
}

function toCents(value: number): number {
  return Math.max(0, Math.round(value * 100));
}

/**
 * Whether the estimate finance header has any real recorded spend to show.
 *
 * When this is false the header renders «—» for «Факт расход» and for the per-type
 * breakdown, and the overspend / risk / finished-accuracy signals all stay inert. It must
 * therefore admit exactly the order states that `computeFactFromDataSources` counts as
 * spend — the two enumerations drifting apart is silent, because a corrected spend figure
 * is simply gated off the screen. Kept in this module, next to that computation, so the
 * pair stays visibly coupled.
 */
export function hasActualFinancialData(input: {
  hrPaymentCount: number;
  orders: OrderWithLines[];
}): boolean {
  return input.hrPaymentCount > 0
    || input.orders.some((order) => (
      order.kind === "supplier"
      && isAppliedOrderStatus(order.status)
      && order.lines.length > 0
    ));
}

function paidByHrItemId(hrPayments: HRPayment[]): Map<string, number> {
  const map = new Map<string, number>();
  hrPayments.forEach((payment) => {
    map.set(payment.hrItemId, (map.get(payment.hrItemId) ?? 0) + Math.max(0, payment.amount));
  });
  return map;
}

export function computeFactFromDataSources(input: {
  procurementItems: ProcurementItemV2[];
  orders: OrderWithLines[];
  hrItems: HRPlannedItem[];
  hrPayments: HRPayment[];
}): FactRollups {
  const spentByType = emptyByType();
  let spentCents = 0;
  let unattributedSpendCents = 0;
  let toBePaidPlannedCents = 0;
  let spentAbovePlannedCents = 0;

  const procurementItemsById = new Map(input.procurementItems.map((item) => [item.id, item]));
  const supplierOrders = input.orders.filter((order) => order.kind === "supplier" && isAppliedOrderStatus(order.status));

  supplierOrders.forEach((order) => {
    order.lines.forEach((line) => {
      const item = procurementItemsById.get(line.procurementItemId);
      const resourceType = item ? procurementTypeToResourceType(item.type) : null;
      const unitPriceMajor =
        line.actualUnitPrice
          ?? line.plannedUnitPrice
          ?? item?.actualUnitPrice
          ?? item?.plannedUnitPrice
          ?? 0;
      const actualSpent = toCents(unitPriceMajor * line.qty);

      spentCents += actualSpent;
      if (resourceType) {
        spentByType[resourceType] += actualSpent;
      } else {
        unattributedSpendCents += actualSpent;
      }

      const isEstimateScoped = Boolean(item && (item.sourceEstimateV2LineId || item.orphaned));
      if (!isEstimateScoped || !item) return;

      const plannedComparable = item.orphaned ? 0 : toCents((item.plannedUnitPrice ?? 0) * line.qty);
      spentAbovePlannedCents += actualSpent - plannedComparable;
    });
  });

  const paidByHrId = paidByHrItemId(input.hrPayments);

  input.hrPayments.forEach((payment) => {
    const hrItem = input.hrItems.find((item) => item.id === payment.hrItemId);
    const type = hrItem?.type === "subcontractor" ? "subcontractor" : "labor";
    const amountCents = toCents(payment.amount);
    spentCents += amountCents;
    spentByType[type] += amountCents;
  });

  input.procurementItems
    .filter((item) => !item.archived)
    .forEach((item) => {
      if (item.orphaned) return;
      const plannedUnit = toCents(item.plannedUnitPrice ?? 0);
      const remaining = computeRemainingRequestedQty(item, input.orders);
      const orderedOpen = computeOrderedOpenQty(item.id, input.orders);
      toBePaidPlannedCents += Math.max(0, Math.round(plannedUnit * (remaining + orderedOpen)));
    });

  input.hrItems.forEach((item) => {
    const paidTotal = paidByHrId.get(item.id) ?? 0;

    const isEstimateScoped = Boolean(item.sourceEstimateV2LineId || item.orphaned);
    if (isEstimateScoped) {
      const plannedCost = toCents(item.plannedQty * item.plannedRate);
      const paidCents = toCents(paidTotal);
      const plannedComparable = item.orphaned ? 0 : Math.min(plannedCost, paidCents);
      spentAbovePlannedCents += paidCents - plannedComparable;
    }

    if (item.orphaned) return;
    if (item.status === "cancelled") return;
    const plannedCost = toCents(item.plannedQty * item.plannedRate);
    const paidCents = toCents(paidTotal);
    toBePaidPlannedCents += Math.max(plannedCost - paidCents, 0);
  });

  return {
    spentCents,
    spentByTypeCents: spentByType,
    unattributedSpendCents,
    toBePaidPlannedCents,
    spentAbovePlannedCents,
  };
}

export function computePlannedFromEstimateV2(input: {
  project: EstimateV2Project;
  stages: EstimateV2Stage[];
  lines: EstimateV2ResourceLine[];
}): PlannedRollups {
  const totals = computeProjectTotals(
    input.project,
    input.stages,
    [],
    input.lines,
    input.project.projectMode,
  );

  return {
    // Planned budget basis is cost (себестоимость), matching the estimate
    // finance header's cost-based utilization (spent / cost). Was totals.totalCents
    // (client price incl. markup + VAT), which made dashboard "spent %" read low.
    plannedBudgetCents: totals.costTotalCents,
    plannedCostByTypeCents: totals.breakdownByType,
    plannedSubtotalCents: totals.subtotalCents,
    plannedTaxCents: totals.taxAmountCents,
  };
}

export function computeFactFromProcurementAndHR(projectId: string): FactRollups {
  return computeFactFromDataSources({
    procurementItems: getProcurementItems(projectId, true),
    orders: listOrdersByProject(projectId),
    hrItems: getHRItems(projectId),
    hrPayments: getHRPayments(projectId),
  });
}

export function combinePlanFact(
  planned: PlannedRollups,
  fact: FactRollups,
  baselineSchedule: ScheduleBaseline | null,
  actualsFromTasks: ScheduleActualsFromTasks,
): CombinedPlanFactMetrics {
  let durationPlannedDays: number | null = null;
  let daysToEnd: number | null = null;

  if (baselineSchedule?.projectBaselineStart && baselineSchedule.projectBaselineEnd) {
    const startDay = toDayIndex(baselineSchedule.projectBaselineStart);
    const endDay = toDayIndex(baselineSchedule.projectBaselineEnd);
    const todayDay = toDayIndex(new Date());

    if (startDay != null && endDay != null && todayDay != null) {
      durationPlannedDays = Math.max(endDay - startDay + 1, 1);
      daysToEnd = endDay - todayDay;
    }
  }

  const behindScheduleDays =
    actualsFromTasks.unfinishedTaskCount > 0 && daysToEnd != null && daysToEnd < 0
      ? Math.abs(daysToEnd)
      : 0;

  return {
    planned,
    fact,
    durationPlannedDays,
    daysToEnd,
    behindScheduleDays,
  };
}

export const __private = {
  computeFactFromData: computeFactFromDataSources,
};
