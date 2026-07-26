export type ResourceLineType = "material" | "tool" | "labor" | "subcontractor" | "overhead" | "other";

export type ProjectMode = "build_myself" | "contractor";

export type EstimateV2VersionStatus = "proposed" | "approved";
export type EstimateV2VersionShareApprovalPolicy = "registered" | "disabled";
export type EstimateV2VersionShareApprovalDisabledReason = "no_participant_slot" | null;
export type EstimateExecutionStatus = "planning" | "in_work" | "paused" | "finished";
export type EstimateV2WorkStatus = "not_started" | "in_progress" | "done" | "blocked";

export interface EstimateV2Project {
  id: string;
  projectId: string;
  title: string;
  projectMode: ProjectMode;
  currency: string;
  taxBps: number;
  discountBps: number;
  markupBps: number;
  estimateStatus: EstimateExecutionStatus;
  /** @deprecated not yet wired — do not read in UI */
  receivedCents: number;
  /** @deprecated not yet wired — do not read in UI */
  pnlPlaceholderCents: number;
  createdAt: string;
  updatedAt: string;
}

export interface EstimateV2Stage {
  id: string;
  projectId: string;
  title: string;
  order: number;
  /**
   * Persisted to `project_stages.discount_bps` but NOT applied to pricing.
   * `computeEffectiveDiscountBps` resolves line override then project only. No UI
   * writes this, so real rows are 0; the demo seed carries non-zero values that
   * do nothing. See rovno #207 before wiring a stage-discount control.
   */
  discountBps: number;
  /** Canonical-library link (system_stage_article_id). Set when this stage came from the rovno.ai library. */
  systemStageArticleId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EstimateV2Work {
  id: string;
  projectId: string;
  stageId: string;
  title: string;
  order: number;
  /** Not applied to pricing, and not even resolved. Same story as the stage tier: see rovno #207. */
  discountBps: number;
  plannedStart: string | null;
  plannedEnd: string | null;
  taskId: string | null;
  status: EstimateV2WorkStatus;
  /** Canonical-library link (system_work_article_id). Set when this work came from the rovno.ai library. */
  systemWorkArticleId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EstimateV2ResourceLine {
  id: string;
  projectId: string;
  stageId: string;
  workId: string;
  title: string;
  type: ResourceLineType;
  unit: string;
  qtyMilli: number;
  costUnitCents: number;
  /**
   * True when this line was hydrated from the operational summary RPC and the
   * internal cost is hidden by finance visibility: `costUnitCents`/`markupBps`
   * are placeholder zeros, NOT real values. UI must render a redacted marker
   * ("—"), never ₽0.
   */
  costRedacted?: boolean;
  /** Canonical-library link (system_resource_article_id). Set when this line came from the rovno.ai library; drives the library row indicator + resource modal. */
  systemResourceArticleId?: string | null;
  /** Populated from operational RPC when finance visibility is summary-only (no cost in payload). */
  summaryClientUnitCents?: number | null;
  summaryClientTotalCents?: number | null;
  /** Persisted discounted client total from `get_estimate_operational_summary` when finance visibility is summary/detail. */
  summaryDiscountedClientTotalCents?: number | null;
  markupBps: number;
  discountBpsOverride: number | null;
  /** When null or 0, inherits `project.taxBps`. Otherwise overrides the project VAT rate for this line. */
  taxBpsOverride?: number | null;
  assigneeId: string | null;
  assigneeName: string | null;
  assigneeEmail: string | null;
  /** @deprecated not yet wired — do not read in UI */
  receivedCents: number;
  /** @deprecated not yet wired — do not read in UI */
  pnlPlaceholderCents: number;
  createdAt: string;
  updatedAt: string;
}

export interface EstimateV2Dependency {
  id: string;
  projectId: string;
  kind: "FS";
  fromWorkId: string;
  toWorkId: string;
  lagDays: number;
  createdAt: string;
  updatedAt: string;
}

export interface ApprovalStamp {
  name: string;
  surname: string;
  email: string;
  timestamp: string;
}

export interface EstimateV2Snapshot {
  project: EstimateV2Project;
  stages: EstimateV2Stage[];
  works: EstimateV2Work[];
  lines: EstimateV2ResourceLine[];
  dependencies: EstimateV2Dependency[];
}

export interface ScheduleBaselineWork {
  workId: string;
  baselineStart: string | null;
  baselineEnd: string | null;
}

export interface ScheduleBaseline {
  capturedAt: string;
  projectBaselineStart: string | null;
  projectBaselineEnd: string | null;
  works: ScheduleBaselineWork[];
}

export interface EstimateV2Version {
  id: string;
  projectId: string;
  number: number;
  status: EstimateV2VersionStatus;
  snapshot: EstimateV2Snapshot;
  shareId: string;
  shareApprovalPolicy: EstimateV2VersionShareApprovalPolicy;
  shareApprovalDisabledReason: EstimateV2VersionShareApprovalDisabledReason;
  approvalStamp: ApprovalStamp | null;
  archived: boolean;
  submitted: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface EstimateV2DiffEntityChange {
  id: string;
  type: "added" | "removed" | "updated";
}

export interface EstimateV2DiffFieldChange {
  field: string;
  before: unknown;
  after: unknown;
  label: string;
}

export interface EstimateV2StructuredChange {
  entityKind: "stage" | "work" | "line";
  entityId: string;
  changeType: "added" | "removed" | "updated";
  stageId: string | null;
  stageTitle: string | null;
  workId: string | null;
  workTitle: string | null;
  title: string;
  stageNumber: number | null;
  workNumber: string | null;
  fieldChanges: EstimateV2DiffFieldChange[];
}

export interface EstimateV2DiffResult {
  stageChanges: EstimateV2DiffEntityChange[];
  workChanges: EstimateV2DiffEntityChange[];
  lineChanges: EstimateV2DiffEntityChange[];
  changedStageIds: string[];
  changedWorkIds: string[];
  changedLineIds: string[];
  changes: EstimateV2StructuredChange[];
}
