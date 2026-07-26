import { describe, expect, it } from "vitest";
import {
  assessResourceDelete,
  assessStageDelete,
  assessWorkDelete,
} from "@/lib/estimate-v2/delete-safeguards";
import type { InventoryLocation, OrderWithLines, ProcurementItemV2, Task } from "@/types/entities";
import type { EstimateV2ResourceLine, EstimateV2Stage, EstimateV2Work } from "@/types/estimate-v2";
import type { HRPayment, HRPlannedItem } from "@/types/hr";

const projectId = "project-delete-guards";

function stage(partial: Partial<EstimateV2Stage> = {}): EstimateV2Stage {
  return {
    id: partial.id ?? "stage-1",
    projectId,
    title: partial.title ?? "Stage 1",
    order: partial.order ?? 1,
    discountBps: partial.discountBps ?? 0,
    createdAt: partial.createdAt ?? "2026-03-01T00:00:00.000Z",
    updatedAt: partial.updatedAt ?? "2026-03-01T00:00:00.000Z",
  };
}

function work(partial: Partial<EstimateV2Work> = {}): EstimateV2Work {
  return {
    id: partial.id ?? "work-1",
    projectId,
    stageId: partial.stageId ?? "stage-1",
    title: partial.title ?? "Main work",
    order: partial.order ?? 1,
    discountBps: partial.discountBps ?? 0,
    plannedStart: partial.plannedStart ?? null,
    plannedEnd: partial.plannedEnd ?? null,
    taskId: partial.taskId ?? null,
    status: partial.status ?? "not_started",
    createdAt: partial.createdAt ?? "2026-03-01T00:00:00.000Z",
    updatedAt: partial.updatedAt ?? "2026-03-01T00:00:00.000Z",
  };
}

function line(partial: Partial<EstimateV2ResourceLine> = {}): EstimateV2ResourceLine {
  return {
    id: partial.id ?? "line-1",
    projectId,
    stageId: partial.stageId ?? "stage-1",
    workId: partial.workId ?? "work-1",
    title: partial.title ?? "Concrete",
    type: partial.type ?? "material",
    unit: partial.unit ?? "pcs",
    qtyMilli: partial.qtyMilli ?? 1_000,
    costUnitCents: partial.costUnitCents ?? 10_000,
    markupBps: partial.markupBps ?? 0,
    discountBpsOverride: partial.discountBpsOverride ?? null,
    assigneeId: partial.assigneeId ?? null,
    assigneeName: partial.assigneeName ?? null,
    assigneeEmail: partial.assigneeEmail ?? null,
    receivedCents: partial.receivedCents ?? 0,
    pnlPlaceholderCents: partial.pnlPlaceholderCents ?? 0,
    createdAt: partial.createdAt ?? "2026-03-01T00:00:00.000Z",
    updatedAt: partial.updatedAt ?? "2026-03-01T00:00:00.000Z",
  };
}

function task(partial: Partial<Task> = {}): Task {
  return {
    id: partial.id ?? "task-1",
    project_id: partial.project_id ?? projectId,
    stage_id: partial.stage_id ?? "stage-1",
    title: partial.title ?? "Main work",
    description: partial.description ?? "",
    status: partial.status ?? "not_started",
    assignee_id: partial.assignee_id ?? "",
    checklist: partial.checklist ?? [],
    comments: partial.comments ?? [],
    attachments: partial.attachments ?? [],
    photos: partial.photos ?? [],
    linked_estimate_item_ids: partial.linked_estimate_item_ids ?? [],
    created_at: partial.created_at ?? "2026-03-01T00:00:00.000Z",
    startDate: partial.startDate,
    deadline: partial.deadline,
  };
}

function procurementItem(partial: Partial<ProcurementItemV2> = {}): ProcurementItemV2 {
  return {
    id: partial.id ?? "proc-1",
    projectId: partial.projectId ?? projectId,
    stageId: partial.stageId ?? "stage-1",
    categoryId: partial.categoryId ?? null,
    type: partial.type ?? "material",
    name: partial.name ?? "Concrete",
    spec: partial.spec ?? null,
    unit: partial.unit ?? "pcs",
    requiredByDate: partial.requiredByDate ?? null,
    requiredQty: partial.requiredQty ?? 10,
    orderedQty: partial.orderedQty ?? 0,
    receivedQty: partial.receivedQty ?? 0,
    plannedUnitPrice: partial.plannedUnitPrice ?? 100,
    actualUnitPrice: partial.actualUnitPrice ?? 100,
    supplier: partial.supplier ?? null,
    supplierPreferred: partial.supplierPreferred ?? null,
    locationPreferredId: partial.locationPreferredId ?? null,
    lockedFromEstimate: partial.lockedFromEstimate ?? true,
    sourceEstimateItemId: partial.sourceEstimateItemId ?? null,
    sourceEstimateV2LineId: partial.sourceEstimateV2LineId ?? "line-1",
    orphaned: partial.orphaned ?? false,
    orphanedAt: partial.orphanedAt ?? null,
    orphanedReason: partial.orphanedReason ?? null,
    linkUrl: partial.linkUrl ?? null,
    notes: partial.notes ?? null,
    attachments: partial.attachments ?? [],
    createdFrom: partial.createdFrom ?? "estimate",
    linkedTaskIds: partial.linkedTaskIds ?? [],
    archived: partial.archived ?? false,
    createdAt: partial.createdAt ?? "2026-03-01T00:00:00.000Z",
    updatedAt: partial.updatedAt ?? "2026-03-01T00:00:00.000Z",
  };
}

function order(partial: Partial<OrderWithLines> = {}): OrderWithLines {
  return {
    id: partial.id ?? "order-1",
    projectId: partial.projectId ?? projectId,
    status: partial.status ?? "placed",
    kind: partial.kind ?? "supplier",
    supplierName: partial.supplierName ?? null,
    deliverToLocationId: partial.deliverToLocationId ?? "loc-1",
    fromLocationId: partial.fromLocationId ?? null,
    toLocationId: partial.toLocationId ?? null,
    dueDate: partial.dueDate ?? null,
    deliveryDeadline: partial.deliveryDeadline ?? null,
    invoiceAttachment: partial.invoiceAttachment ?? null,
    note: partial.note ?? null,
    createdAt: partial.createdAt ?? "2026-03-01T00:00:00.000Z",
    updatedAt: partial.updatedAt ?? "2026-03-01T00:00:00.000Z",
    lines: partial.lines ?? [],
    receiveEvents: partial.receiveEvents ?? [],
  };
}

function hrItem(partial: Partial<HRPlannedItem> = {}): HRPlannedItem {
  return {
    id: partial.id ?? "hr-1",
    projectId: partial.projectId ?? projectId,
    stageId: partial.stageId ?? "stage-1",
    workId: partial.workId ?? "work-1",
    taskId: partial.taskId ?? null,
    title: partial.title ?? "Crew",
    type: partial.type ?? "labor",
    plannedQty: partial.plannedQty ?? 10,
    plannedRate: partial.plannedRate ?? 10,
    assignee: partial.assignee ?? null,
    assigneeIds: partial.assigneeIds ?? [],
    status: partial.status ?? "planned",
    lockedFromEstimate: partial.lockedFromEstimate ?? true,
    sourceEstimateV2LineId: partial.sourceEstimateV2LineId ?? "line-1",
    orphaned: partial.orphaned ?? false,
    orphanedAt: partial.orphanedAt ?? null,
    orphanedReason: partial.orphanedReason ?? null,
    createdAt: partial.createdAt ?? "2026-03-01T00:00:00.000Z",
    updatedAt: partial.updatedAt ?? "2026-03-01T00:00:00.000Z",
  };
}

function hrPayment(partial: Partial<HRPayment> = {}): HRPayment {
  return {
    id: partial.id ?? "payment-1",
    projectId: partial.projectId ?? projectId,
    hrItemId: partial.hrItemId ?? "hr-1",
    amount: partial.amount ?? 50,
    paidAt: partial.paidAt ?? "2026-03-02T00:00:00.000Z",
    note: partial.note ?? null,
    createdAt: partial.createdAt ?? "2026-03-02T00:00:00.000Z",
  };
}

const defaultLocation: InventoryLocation = {
  id: "loc-1",
  name: "Main site",
  isDefault: true,
};

describe("delete-safeguards", () => {
  it("reports linked procurement ordering and in-stock consequences for resource deletes only when evidence is linked", () => {
    const materialLine = line({
      id: "line-material",
      title: "Concrete",
      type: "material",
      qtyMilli: 12_000,
    });

    const linkedProcurement = procurementItem({
      id: "proc-linked",
      name: "Concrete",
      requiredQty: 12,
      sourceEstimateV2LineId: materialLine.id,
    });
    const unlinkedProcurement = procurementItem({
      id: "proc-unlinked",
      name: "Ignored",
      sourceEstimateV2LineId: "another-line",
    });
    const legacyOnlyProcurement = procurementItem({
      id: "proc-legacy-only",
      name: "Legacy only",
      sourceEstimateV2LineId: null,
      sourceEstimateItemId: materialLine.id,
    });

    const assessment = assessResourceDelete(materialLine, {
      projectId,
      stages: [stage()],
      works: [work()],
      lines: [materialLine],
      tasks: [],
      procurementItems: [linkedProcurement, unlinkedProcurement, legacyOnlyProcurement],
      orders: [
        order({
          lines: [{
            id: "order-line-1",
            orderId: "order-1",
            procurementItemId: linkedProcurement.id,
            qty: 10,
            receivedQty: 4,
            unit: "pcs",
            plannedUnitPrice: 100,
            actualUnitPrice: 100,
          }],
        }),
      ],
      hrItems: [],
      hrPayments: [],
      locations: [defaultLocation],
    });

    expect(assessment.initialStep).toBe("financial");
    expect(assessment.financial.summary.partiallyOrderedCount).toBe(1);
    expect(assessment.financial.summary.fullyOrderedCount).toBe(0);
    expect(assessment.financial.summary.inStockCount).toBe(1);
    expect(assessment.financial.procurement).toHaveLength(1);
    expect(assessment.financial.procurement[0]).toMatchObject({
      procurementItemId: "proc-linked",
      orderedState: "partial",
      inStock: true,
      inStockQty: 4,
    });
  });

  it("reports linked HR partial and full payment consequences for resource deletes", () => {
    const laborLine = line({
      id: "line-labor",
      title: "Install team",
      type: "labor",
    });

    const partialPaidAssessment = assessResourceDelete(laborLine, {
      projectId,
      stages: [stage()],
      works: [work()],
      lines: [laborLine],
      tasks: [],
      procurementItems: [],
      orders: [],
      hrItems: [hrItem({
        id: "hr-partial",
        title: "Install team",
        sourceEstimateV2LineId: laborLine.id,
        plannedQty: 10,
        plannedRate: 10,
      })],
      hrPayments: [hrPayment({
        hrItemId: "hr-partial",
        amount: 25,
      })],
      locations: [defaultLocation],
    });

    expect(partialPaidAssessment.financial.summary.partiallyPaidCount).toBe(1);
    expect(partialPaidAssessment.financial.summary.fullyPaidCount).toBe(0);
    expect(partialPaidAssessment.financial.hr[0]).toMatchObject({
      hrItemId: "hr-partial",
      paymentState: "partial",
      paidAmount: 25,
      plannedAmount: 100,
    });

    const fullPaidAssessment = assessResourceDelete(laborLine, {
      projectId,
      stages: [stage()],
      works: [work()],
      lines: [laborLine],
      tasks: [],
      procurementItems: [],
      orders: [],
      hrItems: [hrItem({
        id: "hr-full",
        title: "Install team",
        sourceEstimateV2LineId: laborLine.id,
        plannedQty: 10,
        plannedRate: 10,
      })],
      hrPayments: [hrPayment({
        hrItemId: "hr-full",
        amount: 100,
      })],
      locations: [defaultLocation],
    });

    expect(fullPaidAssessment.financial.summary.partiallyPaidCount).toBe(0);
    expect(fullPaidAssessment.financial.summary.fullyPaidCount).toBe(1);
    expect(fullPaidAssessment.financial.hr[0]?.paymentState).toBe("full");
  });

  it("treats done work as already started for the first work delete warning", () => {
    const finishedWork = work({
      id: "work-finished",
      title: "Completed work",
      taskId: "task-finished",
      status: "not_started",
    });

    const assessment = assessWorkDelete(finishedWork, {
      projectId,
      stages: [stage()],
      works: [finishedWork],
      lines: [],
      tasks: [task({
        id: "task-finished",
        title: "Completed work",
        status: "done",
      })],
      procurementItems: [],
      orders: [],
      hrItems: [],
      hrPayments: [],
      locations: [defaultLocation],
    });

    expect(assessment.execution.status).toBe("done");
    expect(assessment.execution.isStarted).toBe(true);
    expect(assessment.execution.isDone).toBe(true);
    expect(assessment.initialStep).toBe("execution");
  });

  it("returns started stage entries with linked work-task dedupe and excludes done items", () => {
    const activeStage = stage();
    const linkedWork = work({
      id: "work-linked",
      title: "Linked work",
      stageId: activeStage.id,
      taskId: "task-linked",
      status: "not_started",
    });
    const doneWork = work({
      id: "work-done",
      title: "Done work",
      stageId: activeStage.id,
      taskId: "task-done",
      status: "not_started",
    });

    const assessment = assessStageDelete(activeStage, {
      projectId,
      stages: [activeStage],
      works: [linkedWork, doneWork],
      lines: [],
      tasks: [
        task({
          id: "task-linked",
          stage_id: activeStage.id,
          title: "Linked work",
          status: "in_progress",
        }),
        task({
          id: "task-manual",
          stage_id: activeStage.id,
          title: "Manual blocked task",
          status: "blocked",
        }),
        task({
          id: "task-done",
          stage_id: activeStage.id,
          title: "Done work",
          status: "done",
        }),
        task({
          id: "task-manual-done",
          stage_id: activeStage.id,
          title: "Manual done task",
          status: "done",
        }),
      ],
      procurementItems: [],
      orders: [],
      hrItems: [],
      hrPayments: [],
      locations: [defaultLocation],
    });

    expect(assessment.initialStep).toBe("execution");
    expect(assessment.startedEntries).toHaveLength(2);
    expect(assessment.startedEntries.map((entry) => entry.title)).toEqual([
      "Linked work",
      "Manual blocked task",
    ]);
    expect(assessment.startedEntries.map((entry) => entry.kind)).toEqual(["work", "task"]);
  });
});

describe("delete-safeguards with a partially received order", () => {
  // Latent hole: while `partially_received` was excluded from the applied-order set, an
  // estimate line with a real part-delivery scored supplierOrderedQty 0 AND inStockQty 0, so
  // NEITHER guard fired and the line could be deleted, orphaning stock already on site.
  it("still warns when the linked order is partially received", () => {
    const materialLine = line({
      id: "line-material",
      title: "Concrete",
      type: "material",
      qtyMilli: 12_000,
    });
    const linkedProcurement = procurementItem({
      id: "proc-linked",
      name: "Concrete",
      requiredQty: 12,
      sourceEstimateV2LineId: materialLine.id,
    });

    const assessment = assessResourceDelete(materialLine, {
      projectId,
      stages: [stage()],
      works: [work()],
      lines: [materialLine],
      tasks: [],
      procurementItems: [linkedProcurement],
      orders: [
        order({
          status: "partially_received",
          lines: [{
            id: "order-line-1",
            orderId: "order-1",
            procurementItemId: linkedProcurement.id,
            qty: 10,
            receivedQty: 4,
            unit: "pcs",
            plannedUnitPrice: 100,
            actualUnitPrice: 100,
          }],
        }),
      ],
      hrItems: [],
      hrPayments: [],
      locations: [defaultLocation],
    });

    expect(assessment.initialStep).toBe("financial");
    expect(assessment.financial.summary.partiallyOrderedCount).toBe(1);
    expect(assessment.financial.summary.inStockCount).toBe(1);
    expect(assessment.financial.procurement[0]).toMatchObject({
      procurementItemId: "proc-linked",
      orderedState: "partial",
      inStock: true,
      inStockQty: 4,
    });
  });
});
