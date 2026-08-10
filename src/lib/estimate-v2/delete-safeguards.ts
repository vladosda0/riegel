import { computeInStockByLocation, isAppliedOrderStatus } from "@/lib/procurement-fulfillment";
import type { InventoryLocation, OrderWithLines, ProcurementItemV2, Task } from "@/types/entities";
import type { EstimateV2ResourceLine, EstimateV2Stage, EstimateV2Work, EstimateV2WorkStatus, ResourceLineType } from "@/types/estimate-v2";
import type { HRPayment, HRPlannedItem } from "@/types/hr";

export type DeleteDialogStep = "simple" | "execution" | "financial";

export interface DeleteGuardSourceData {
  projectId: string;
  stages: EstimateV2Stage[];
  works: EstimateV2Work[];
  lines: EstimateV2ResourceLine[];
  tasks: Task[];
  procurementItems: ProcurementItemV2[];
  orders: OrderWithLines[];
  hrItems: HRPlannedItem[];
  hrPayments: HRPayment[];
  locations: InventoryLocation[];
}

export interface ProcurementDeleteConsequence {
  procurementItemId: string;
  title: string;
  type: ProcurementItemV2["type"];
  requiredQty: number;
  supplierOrderedQty: number;
  inStockQty: number;
  orderedState: "partial" | "full" | null;
  inStock: boolean;
}

export interface HRDeleteConsequence {
  hrItemId: string;
  title: string;
  type: HRPlannedItem["type"];
  plannedAmount: number;
  paidAmount: number;
  paymentState: "partial" | "full" | null;
}

export interface DeleteFinancialSummary {
  partiallyOrderedCount: number;
  fullyOrderedCount: number;
  inStockCount: number;
  partiallyPaidCount: number;
  fullyPaidCount: number;
}

export interface DeleteFinancialAssessment {
  procurement: ProcurementDeleteConsequence[];
  hr: HRDeleteConsequence[];
  summary: DeleteFinancialSummary;
  hasConsequences: boolean;
}

export interface DeleteExecutionAssessment {
  status: EstimateV2WorkStatus;
  statusLabel: string;
  isDone: boolean;
  isStarted: boolean;
  source: "task" | "work";
  taskId: string | null;
}

export interface DeleteStartedStageEntry {
  id: string;
  kind: "work" | "task";
  title: string;
  status: EstimateV2WorkStatus;
  statusLabel: string;
  workId: string | null;
  taskId: string | null;
}

export interface ResourceDeleteAssessment {
  kind: "resource";
  entityId: string;
  entityTitle: string;
  lineType: ResourceLineType;
  financial: DeleteFinancialAssessment;
  initialStep: DeleteDialogStep;
}

export interface WorkDeleteAssessment {
  kind: "work";
  entityId: string;
  entityTitle: string;
  execution: DeleteExecutionAssessment;
  financial: DeleteFinancialAssessment;
  initialStep: DeleteDialogStep;
}

export interface StageDeleteAssessment {
  kind: "stage";
  entityId: string;
  entityTitle: string;
  startedEntries: DeleteStartedStageEntry[];
  financial: DeleteFinancialAssessment;
  initialStep: DeleteDialogStep;
}

export type DeleteAssessment =
  | ResourceDeleteAssessment
  | WorkDeleteAssessment
  | StageDeleteAssessment;

interface DeleteGuardContext {
  worksById: Map<string, EstimateV2Work>;
  tasksById: Map<string, Task>;
  stageTasksByStageId: Map<string, Task[]>;
  linesByWorkId: Map<string, EstimateV2ResourceLine[]>;
  supplierOrderedQtyByProcurementId: Map<string, number>;
  inStockQtyByProcurementId: Map<string, number>;
  procurementByLineId: Map<string, ProcurementItemV2[]>;
  hrByLineId: Map<string, HRPlannedItem[]>;
  paidByHrItemId: Map<string, number>;
}

const STARTED_WORK_STATUSES = new Set<EstimateV2WorkStatus>(["in_progress", "blocked", "done"]);
const ACTIVE_STAGE_STATUSES = new Set<EstimateV2WorkStatus>(["in_progress", "blocked"]);

function workStatusFromTask(task: Task): EstimateV2WorkStatus {
  if (task.status === "in_progress") return "in_progress";
  if (task.status === "done") return "done";
  if (task.status === "blocked") return "blocked";
  return "not_started";
}

function statusLabel(status: EstimateV2WorkStatus): string {
  if (status === "in_progress") return "In progress";
  if (status === "done") return "Done";
  if (status === "blocked") return "Blocked";
  return "Not started";
}

function buildDeleteGuardContext(input: DeleteGuardSourceData): DeleteGuardContext {
  const worksById = new Map(input.works.map((work) => [work.id, work]));
  const tasksById = new Map(input.tasks.map((task) => [task.id, task]));
  const stageTasksByStageId = new Map<string, Task[]>();
  input.tasks.forEach((task) => {
    const list = stageTasksByStageId.get(task.stage_id) ?? [];
    list.push(task);
    stageTasksByStageId.set(task.stage_id, list);
  });

  const linesByWorkId = new Map<string, EstimateV2ResourceLine[]>();
  input.lines.forEach((line) => {
    const list = linesByWorkId.get(line.workId) ?? [];
    list.push(line);
    linesByWorkId.set(line.workId, list);
  });

  const supplierOrderedQtyByProcurementId = new Map<string, number>();
  input.orders
    .filter((order) => order.kind === "supplier" && isAppliedOrderStatus(order.status))
    .forEach((order) => {
      order.lines.forEach((line) => {
        supplierOrderedQtyByProcurementId.set(
          line.procurementItemId,
          (supplierOrderedQtyByProcurementId.get(line.procurementItemId) ?? 0) + Math.max(line.qty, 0),
        );
      });
    });

  const inStockQtyByProcurementId = new Map<string, number>();
  computeInStockByLocation(input.projectId, input.procurementItems, input.orders, input.locations).forEach((group) => {
    group.items.forEach((entry) => {
      inStockQtyByProcurementId.set(
        entry.procurementItemId,
        (inStockQtyByProcurementId.get(entry.procurementItemId) ?? 0) + Math.max(entry.qty, 0),
      );
    });
  });

  const procurementByLineId = new Map<string, ProcurementItemV2[]>();
  input.procurementItems
    .filter((item) => !item.archived && !item.orphaned)
    .forEach((item) => {
      const lineId = item.sourceEstimateV2LineId ?? null;
      if (!lineId) return;
      const list = procurementByLineId.get(lineId) ?? [];
      list.push(item);
      procurementByLineId.set(lineId, list);
    });

  const hrByLineId = new Map<string, HRPlannedItem[]>();
  input.hrItems
    .filter((item) => !item.orphaned)
    .forEach((item) => {
      if (!item.sourceEstimateV2LineId) return;
      const list = hrByLineId.get(item.sourceEstimateV2LineId) ?? [];
      list.push(item);
      hrByLineId.set(item.sourceEstimateV2LineId, list);
    });

  const paidByHrItemId = new Map<string, number>();
  input.hrPayments.forEach((payment) => {
    paidByHrItemId.set(
      payment.hrItemId,
      (paidByHrItemId.get(payment.hrItemId) ?? 0) + Math.max(payment.amount, 0),
    );
  });

  return {
    worksById,
    tasksById,
    stageTasksByStageId,
    linesByWorkId,
    supplierOrderedQtyByProcurementId,
    inStockQtyByProcurementId,
    procurementByLineId,
    hrByLineId,
    paidByHrItemId,
  };
}

function buildFinancialAssessment(
  lineIds: string[],
  context: DeleteGuardContext,
): DeleteFinancialAssessment {
  const procurementById = new Map<string, ProcurementDeleteConsequence>();
  const hrById = new Map<string, HRDeleteConsequence>();

  lineIds.forEach((lineId) => {
    (context.procurementByLineId.get(lineId) ?? []).forEach((item) => {
      const supplierOrderedQty = context.supplierOrderedQtyByProcurementId.get(item.id) ?? 0;
      const requiredQty = Math.max(item.requiredQty, 0);
      const inStockQty = context.inStockQtyByProcurementId.get(item.id) ?? 0;
      const orderedState =
        supplierOrderedQty <= 0
          ? null
          : supplierOrderedQty >= requiredQty
            ? "full"
            : "partial";
      const consequence: ProcurementDeleteConsequence = {
        procurementItemId: item.id,
        title: item.name,
        type: item.type,
        requiredQty,
        supplierOrderedQty,
        inStockQty,
        orderedState,
        inStock: inStockQty > 0,
      };
      if (consequence.orderedState || consequence.inStock) {
        procurementById.set(item.id, consequence);
      }
    });

    (context.hrByLineId.get(lineId) ?? []).forEach((item) => {
      const plannedAmount = Math.max(item.plannedQty * item.plannedRate, 0);
      const paidAmount = context.paidByHrItemId.get(item.id) ?? 0;
      const paymentState =
        paidAmount <= 0
          ? null
          : plannedAmount > 0 && paidAmount < plannedAmount
            ? "partial"
            : "full";
      if (!paymentState) return;
      hrById.set(item.id, {
        hrItemId: item.id,
        title: item.title,
        type: item.type,
        plannedAmount,
        paidAmount,
        paymentState,
      });
    });
  });

  const procurement = Array.from(procurementById.values()).sort((a, b) => a.title.localeCompare(b.title));
  const hr = Array.from(hrById.values()).sort((a, b) => a.title.localeCompare(b.title));

  const summary: DeleteFinancialSummary = {
    partiallyOrderedCount: procurement.filter((item) => item.orderedState === "partial").length,
    fullyOrderedCount: procurement.filter((item) => item.orderedState === "full").length,
    inStockCount: procurement.filter((item) => item.inStock).length,
    partiallyPaidCount: hr.filter((item) => item.paymentState === "partial").length,
    fullyPaidCount: hr.filter((item) => item.paymentState === "full").length,
  };

  return {
    procurement,
    hr,
    summary,
    hasConsequences: procurement.length > 0 || hr.length > 0,
  };
}

function executionForWork(work: EstimateV2Work, context: DeleteGuardContext): DeleteExecutionAssessment {
  const task = work.taskId ? context.tasksById.get(work.taskId) ?? null : null;
  const status = task ? workStatusFromTask(task) : work.status;
  return {
    status,
    statusLabel: statusLabel(status),
    isDone: status === "done",
    isStarted: STARTED_WORK_STATUSES.has(status),
    source: task ? "task" : "work",
    taskId: task?.id ?? work.taskId ?? null,
  };
}

export function assessResourceDelete(
  line: EstimateV2ResourceLine,
  input: DeleteGuardSourceData,
): ResourceDeleteAssessment {
  const context = buildDeleteGuardContext(input);
  const financial = buildFinancialAssessment([line.id], context);

  return {
    kind: "resource",
    entityId: line.id,
    entityTitle: line.title,
    lineType: line.type,
    financial,
    initialStep: financial.hasConsequences ? "financial" : "simple",
  };
}

export function assessWorkDelete(
  work: EstimateV2Work,
  input: DeleteGuardSourceData,
): WorkDeleteAssessment {
  const context = buildDeleteGuardContext(input);
  const lineIds = (context.linesByWorkId.get(work.id) ?? []).map((line) => line.id);
  const execution = executionForWork(work, context);
  const financial = buildFinancialAssessment(lineIds, context);

  return {
    kind: "work",
    entityId: work.id,
    entityTitle: work.title,
    execution,
    financial,
    initialStep: execution.isStarted
      ? "execution"
      : financial.hasConsequences
        ? "financial"
        : "simple",
  };
}

export function assessStageDelete(
  stage: EstimateV2Stage,
  input: DeleteGuardSourceData,
): StageDeleteAssessment {
  const context = buildDeleteGuardContext(input);
  const stageWorks = input.works.filter((work) => work.stageId === stage.id);
  const stageWorkIds = new Set(stageWorks.map((work) => work.id));
  const lineIds = input.lines
    .filter((line) => stageWorkIds.has(line.workId))
    .map((line) => line.id);
  const startedEntries: DeleteStartedStageEntry[] = [];
  const claimedTaskIds = new Set<string>();

  stageWorks.forEach((work) => {
    const execution = executionForWork(work, context);
    if (!ACTIVE_STAGE_STATUSES.has(execution.status)) return;
    if (execution.taskId) claimedTaskIds.add(execution.taskId);
    startedEntries.push({
      id: work.id,
      kind: "work",
      title: work.title,
      status: execution.status,
      statusLabel: execution.statusLabel,
      workId: work.id,
      taskId: execution.taskId,
    });
  });

  (context.stageTasksByStageId.get(stage.id) ?? []).forEach((task) => {
    const taskStatus = workStatusFromTask(task);
    if (!ACTIVE_STAGE_STATUSES.has(taskStatus)) return;
    if (claimedTaskIds.has(task.id)) return;
    startedEntries.push({
      id: task.id,
      kind: "task",
      title: task.title,
      status: taskStatus,
      statusLabel: statusLabel(taskStatus),
      workId: null,
      taskId: task.id,
    });
  });

  startedEntries.sort((a, b) => a.title.localeCompare(b.title));
  const financial = buildFinancialAssessment(lineIds, context);

  return {
    kind: "stage",
    entityId: stage.id,
    entityTitle: stage.title,
    startedEntries,
    financial,
    initialStep: startedEntries.length > 0
      ? "execution"
      : financial.hasConsequences
        ? "financial"
        : "simple",
  };
}

export function getNextDeleteStep(
  assessment: DeleteAssessment,
  currentStep: DeleteDialogStep,
): DeleteDialogStep | null {
  if (currentStep !== "execution") return null;
  if (assessment.kind === "resource") return null;
  return assessment.financial.hasConsequences ? "financial" : null;
}
