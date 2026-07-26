// The decisions AISidebar's proposal-queue loop makes before it attempts an
// item, extracted so they can be unit-tested.
//
// They lived inline in `runQueueExecution`, which no test in the repo touches,
// and that is exactly where two defects hid: a toast that was silently replaced
// because use-toast keeps TOAST_LIMIT = 1, and a persisted event claiming five
// failed retries of something never attempted once (rovno #175 review rounds 1
// and 2). Driving that component loop from a test is nontrivial; making the
// decision pure is the cheap way to pin it.

import { isProposalTypeApplicable } from "@/lib/commit-proposal";
import type { AIProposalType } from "@/types/ai";

export interface ProposalFastFail {
  /**
   * Machine token persisted on the proposal_cancelled event. Never rendered
   * directly: see proposalFailureReasonKey.
   */
  reason: string;
  titleKey: string;
  descriptionKey: string;
}

/**
 * Whether this queue item can be attempted at all, and if not, why.
 *
 * Returning non-null means the caller must show the returned toast, record the
 * returned reason, and NOT enter the retry loop. Returning null means proceed.
 */
export function resolveProposalFastFail(
  proposalType: AIProposalType,
  workspaceKind: string,
): ProposalFastFail | null {
  // Cannot be applied in ANY mode: commitProposal holds no mutator for the type
  // and returns unavailable rather than claiming a success it never delivered.
  if (!isProposalTypeApplicable(proposalType)) {
    // Two different situations share this gate. update_estimate is a KNOWN
    // not-yet-built feature and deserves the specific message. Anything else
    // reaching here is a type the build does not recognise at all (proposals are
    // data, so the union is a compile-time claim, not a runtime guarantee), and
    // telling that user their ESTIMATE cannot be updated would be a lie.
    if (proposalType === "update_estimate") {
      return {
        reason: "unsupported_proposal_type",
        titleKey: "ai.sidebar.toast.estimateUnavailable.title",
        descriptionKey: "ai.sidebar.toast.estimateUnavailable.description",
      };
    }
    return {
      reason: "unknown_proposal_type",
      titleKey: "ai.sidebar.toast.unknownProposalType.title",
      descriptionKey: "ai.sidebar.toast.unknownProposalType.description",
    };
  }

  // Mode-specific: document text persistence does not exist in supabase mode.
  if (workspaceKind === "supabase" && proposalType === "generate_document") {
    return {
      reason: "unsupported_in_supabase_mode",
      titleKey: "ai.sidebar.toast.supabaseModeUnavailable.title",
      descriptionKey: "ai.sidebar.toast.supabaseModeUnavailable.documentDescription",
    };
  }

  return null;
}

/**
 * Reason tokens that have a translation. Anything else renders as nothing.
 *
 * `payload.reason` is a machine token on a PERMANENT activity-feed entry, and the
 * feed used to print it with underscores swapped for spaces, which put raw
 * English ("execution failed") into the Russian feed. An allowlist means a new
 * token cannot leak by default: it renders blank until someone adds its key.
 */
// A Map, deliberately, NOT an object literal. `payload.reason` is arbitrary
// persisted data, and a plain-object lookup resolves inherited keys: a stored
// reason of "toString" or "constructor" would come back as a function off
// Object.prototype and be handed to the renderer.
const PROPOSAL_FAILURE_REASON_KEYS = new Map<string, string>([
  ["execution_failed", "ai.sidebar.proposal.failureReason.executionFailed"],
  ["unsupported_proposal_type", "ai.sidebar.proposal.failureReason.unsupportedProposalType"],
  ["unsupported_in_supabase_mode", "ai.sidebar.proposal.failureReason.unsupportedInSupabaseMode"],
  ["unknown_proposal_type", "ai.sidebar.proposal.failureReason.unknownProposalType"],
]);

/** i18n key for a persisted failure reason, or null when it must not be shown. */
export function proposalFailureReasonKey(reason: unknown): string | null {
  if (typeof reason !== "string") return null;
  return PROPOSAL_FAILURE_REASON_KEYS.get(reason) ?? null;
}
