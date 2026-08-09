import type { ProjectMode } from "@/types/estimate-v2";

export interface ProjectEstimateCtaState {
  showSubmit: boolean;
  showApprove: boolean;
  approveDisabled: boolean;
  approveDisabledReason: string | null;
  showClientPreviewBadge: boolean;
}

interface ResolveProjectEstimateCtaInput {
  projectMode: ProjectMode;
  isOwner: boolean;
  hasProposedVersion: boolean;
}

export function resolveProjectEstimateCtaState(
  input: ResolveProjectEstimateCtaInput,
): ProjectEstimateCtaState {
  return {
    showSubmit: input.isOwner && input.projectMode === "contractor",
    showApprove: false,
    approveDisabled: true,
    approveDisabledReason: null,
    showClientPreviewBadge: false,
  };
}

/**
 * May this member publish a client-facing share snapshot of the estimate?
 *
 * Publishing is stronger than editing and takes the same finance gate. The
 * snapshot is built from the RAW estimate lines and the public page recomputes
 * from them without preferring the persisted client snapshot, so a member whose
 * costs were redacted to zero would publish an estimate of zeroes to the client
 * while the app shows them the correct money (rovno#282).
 */
export function canPublishClientShare(input: {
  /** Role-level manage access to the estimate domain. */
  canManageEstimate: boolean;
  /** Owner or co_owner by membership — the roles the publish RPC accepts. */
  isSubmitterRole: boolean;
  /** `seamEstimateFinanceVisibilityMode` for this member. */
  financeMode: "none" | "summary" | "detail";
}): boolean {
  return input.canManageEstimate && input.isSubmitterRole && input.financeMode === "detail";
}
