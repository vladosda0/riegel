import {
  getDefaultAiAccess,
  getDefaultFinanceVisibility,
  getDefaultInternalDocsVisibility,
} from "@/lib/participant-role-policy";
import type { ParticipantAxes } from "@/lib/participant-access-preview";
import type { WorkspaceProjectInvite } from "@/data/workspace-source";
import type {
  AIAccess,
  FinanceVisibility,
  InternalDocsVisibility,
  MemberRole,
  ViewerRegime,
} from "@/types/entities";

/** Short segment-control captions (the legacy `*VisibilityLabels` maps are full sentences). */
export const FINANCE_SEGMENT_LABELS: Record<FinanceVisibility, string> = {
  none: "participants.axisOption.finance.none",
  summary: "participants.axisOption.finance.summary",
  detail: "participants.axisOption.finance.detail",
};

export const DOCS_SEGMENT_LABELS: Record<InternalDocsVisibility, string> = {
  none: "participants.axisOption.docs.none",
  view: "participants.axisOption.docs.view",
  edit: "participants.axisOption.docs.edit",
};

export const AI_SEGMENT_LABELS: Record<AIAccess, string> = {
  none: "participants.axisOption.ai.none",
  consult_only: "participants.axisOption.ai.consult_only",
  project_pool: "participants.axisOption.ai.project_pool",
};

export type ParticipantTargetRef =
  | { kind: "member"; userId: string }
  | { kind: "invite"; inviteId: string };

/** One row of the unified list — a member or a pending invite (PRD P0-1). */
export type ParticipantRecord = {
  target: ParticipantTargetRef;
  key: string;
  displayName: string;
  secondaryLabel: string;
  role: MemberRole;
  aiAccess: AIAccess;
  financeVisibility: FinanceVisibility;
  internalDocsVisibility: InternalDocsVisibility;
  viewerRegime?: ViewerRegime;
  creditLimit: number;
  usedCredits?: number;
  inviteStatus?: WorkspaceProjectInvite["status"];
  isSelf: boolean;
};

export type ParticipantFormState = {
  role: MemberRole;
  aiAccess: AIAccess;
  financeVisibility: FinanceVisibility;
  internalDocsVisibility: InternalDocsVisibility;
  viewerRegime: ViewerRegime;
  creditLimit: string;
};

export type ProjectParticipantsMode = "contractor" | "build_myself";

export function resolveViewerRegime(
  role: MemberRole,
  projectMode: ProjectParticipantsMode,
  currentViewerRegime?: ViewerRegime,
): ViewerRegime | undefined {
  if (role !== "viewer") return undefined;
  return currentViewerRegime ?? (projectMode === "build_myself" ? "build_myself" : "client");
}

export function defaultViewerRegimeFor(projectMode: ProjectParticipantsMode): ViewerRegime {
  return projectMode === "build_myself" ? "build_myself" : "client";
}

export const DEFAULT_INVITE_CREDIT_LIMIT = 50;

export function buildCreateForm(projectMode: ProjectParticipantsMode): ParticipantFormState {
  return {
    role: "contractor",
    aiAccess: getDefaultAiAccess("contractor"),
    financeVisibility: getDefaultFinanceVisibility("contractor"),
    internalDocsVisibility: getDefaultInternalDocsVisibility("contractor"),
    viewerRegime: defaultViewerRegimeFor(projectMode),
    creditLimit: String(DEFAULT_INVITE_CREDIT_LIMIT),
  };
}

export function buildFormFromRecord(
  record: ParticipantRecord,
  projectMode: ProjectParticipantsMode,
): ParticipantFormState {
  return {
    role: record.role,
    aiAccess: record.aiAccess,
    financeVisibility: record.financeVisibility,
    internalDocsVisibility: record.internalDocsVisibility,
    viewerRegime: resolveViewerRegime(record.role, projectMode, record.viewerRegime)
      ?? defaultViewerRegimeFor(projectMode),
    creditLimit: String(record.creditLimit),
  };
}

export function formAxes(form: ParticipantFormState): ParticipantAxes {
  return {
    aiAccess: form.aiAccess,
    financeVisibility: form.financeVisibility,
    internalDocsVisibility: form.internalDocsVisibility,
  };
}

export function recordAxes(record: ParticipantRecord): ParticipantAxes {
  return {
    aiAccess: record.aiAccess,
    financeVisibility: record.financeVisibility,
    internalDocsVisibility: record.internalDocsVisibility,
  };
}

export function parseCreditLimit(value: string): number {
  // Number(), not parseInt(): a `<input type="number">` can legitimately hold
  // exponent notation ("1e3" → 1000, which parseInt would read as 1). Floor to
  // an integer credit count and clamp at zero. Non-finite input ("1e999" →
  // Infinity, which would JSON-serialize to null and wipe the column) → 0.
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

/** Roles that consume "editor" seats in the DB limits trigger (owner's row never counts). */
export function isEditorSeatRole(role: MemberRole): boolean {
  return role === "co_owner" || role === "contractor";
}

export type SeatInfo = {
  editorsUsed: number;
  editorsPending: number;
  viewersUsed: number;
  viewersPending: number;
  /** null = unknown (actor is not the owner or no subscription data); -1 = unlimited. */
  editorsLimit: number | null;
  viewersLimit: number | null;
};

export function seatLimitReached(used: number, limit: number | null): boolean {
  return limit != null && limit >= 0 && used >= limit;
}
