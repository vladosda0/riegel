// The decisions AISidebar's proposal-queue loop makes before it attempts an
// item, extracted so they can be unit-tested.
//
// They lived inline in `runQueueExecution`, which no test in the repo touches,
// and that is exactly where two defects hid: a toast that was silently replaced
// because use-toast then kept TOAST_LIMIT = 1, and a persisted event claiming
// five failed retries of something never attempted once (rovno #175 review
// rounds 1 and 2). Driving that component loop from a test is nontrivial; making
// the decision pure is the cheap way to pin it.
//
// The loop still has no direct coverage, and four more blocking defects hid
// there during the #224 rounds. Extending this pattern is tracked in rovno #229.

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
    // Three different situations share this gate. update_estimate (#175) and
    // add_procurement (#224) are KNOWN not-yet-built features and each deserves
    // its own message naming the right screen. Anything else reaching here is a
    // type the build does not recognise at all (proposals are data, so the union
    // is a compile-time claim, not a runtime guarantee), and telling that user
    // their ESTIMATE cannot be updated would be a lie.
    if (proposalType === "update_estimate") {
      return {
        reason: "unsupported_proposal_type",
        titleKey: "ai.sidebar.toast.estimateUnavailable.title",
        descriptionKey: "ai.sidebar.toast.estimateUnavailable.description",
      };
    }
    if (proposalType === "add_procurement") {
      return {
        reason: "unsupported_proposal_type",
        titleKey: "ai.sidebar.toast.procurementUnavailable.title",
        descriptionKey: "ai.sidebar.toast.procurementUnavailable.description",
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

/**
 * Which analytics event, if any, the queue loop should emit for a finished item.
 *
 * rovno#227. `ai_proposal_applied` used to be emitted at CONFIRM time, before
 * the loop attempted anything, and nothing was emitted on failure. Proposal
 * types that fail closed on every path (`update_estimate` since #175,
 * `add_procurement` since #224, `generate_document` in supabase mode) therefore
 * reported a 100% apply rate against zero applications — and the number got
 * worse as more dead paths were correctly closed, which is precisely backwards
 * for a metric meant to say whether the AI features earn their cost.
 *
 * Returning null is a real answer, not an omission: the retries-exhausted case
 * is `confirmed - applied - unavailable` by subtraction, so measuring it needs
 * no fourth Yandex Metrika goal to be created by hand.
 */
export type ProposalExecutionAnalytics =
  | { event: "ai_proposal_applied"; attempts: number }
  | { event: "ai_proposal_unavailable"; reason: string; attempts: number };

export function resolveProposalExecutionAnalytics(input: {
  success: boolean;
  /** The fast-fail token, or null when the loop was actually entered. */
  unavailableReason: string | null;
  /** Attempts actually made. Zero for a fast-fail, which never enters the loop. */
  attempts: number;
}): ProposalExecutionAnalytics | null {
  if (input.success) {
    // Success wins over a reason. The current loop cannot produce both, but a
    // total function is cheaper than a caller-side invariant nobody re-checks.
    return { event: "ai_proposal_applied", attempts: input.attempts };
  }

  // `!== null` and not a truthiness check: an empty string is a string, and
  // treating it as a fast-fail would invent an unavailable event whose reason
  // dimension is blank. An empty reason means the loop ran and lost.
  if (input.unavailableReason !== null && input.unavailableReason !== "") {
    return {
      event: "ai_proposal_unavailable",
      reason: input.unavailableReason,
      attempts: input.attempts,
    };
  }

  return null;
}
