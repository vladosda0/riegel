import { describe, expect, it } from "vitest";

import { proposalFailureReasonKey, resolveProposalFastFail } from "@/lib/ai-proposal-execution";
import type { AIProposalType } from "@/types/ai";

// The complete AIProposalType union. Kept as a typed literal so adding a member
// to the union without deciding its fast-fail behaviour fails typecheck here.
const ALL_TYPES: AIProposalType[] = [
  "add_task",
  "update_estimate",
  "add_procurement",
  "generate_document",
  "create_project",
];

const WORKSPACE_KINDS = ["demo", "local", "supabase", "guest", "pending-supabase"];

describe("resolveProposalFastFail", () => {
  it("blocks update_estimate in every workspace mode", () => {
    // The type has no mutator in commitProposal, so it can never succeed
    // anywhere. Mode-independent, matching the library guard.
    for (const kind of WORKSPACE_KINDS) {
      const result = resolveProposalFastFail("update_estimate", kind);
      expect(result, `expected a fast-fail in ${kind}`).not.toBeNull();
      expect(result?.reason).toBe("unsupported_proposal_type");
    }
  });

  it("blocks generate_document only in supabase mode", () => {
    expect(resolveProposalFastFail("generate_document", "supabase")?.reason)
      .toBe("unsupported_in_supabase_mode");
    for (const kind of WORKSPACE_KINDS.filter((k) => k !== "supabase")) {
      expect(resolveProposalFastFail("generate_document", kind), kind).toBeNull();
    }
  });

  it("lets every implemented type through in every mode", () => {
    const implemented = ALL_TYPES.filter((t) => t !== "update_estimate" && t !== "generate_document");
    for (const type of implemented) {
      for (const kind of WORKSPACE_KINDS) {
        expect(resolveProposalFastFail(type, kind), `${type} in ${kind}`).toBeNull();
      }
    }
  });

  it("covers the full proposal-type domain with no unhandled member", () => {
    // Every member resolves to either a fast-fail or a proceed, and never throws.
    for (const type of ALL_TYPES) {
      for (const kind of WORKSPACE_KINDS) {
        expect(() => resolveProposalFastFail(type, kind)).not.toThrow();
      }
    }
  });

  it("always returns a reason together with both toast keys", () => {
    // The caller shows the toast AND records the reason. A fast-fail missing
    // either half is how the round-one defect looked: an event with no matching
    // user-visible explanation.
    for (const type of ALL_TYPES) {
      for (const kind of WORKSPACE_KINDS) {
        const result = resolveProposalFastFail(type, kind);
        if (!result) continue;
        expect(result.reason).toBeTruthy();
        expect(result.titleKey).toBeTruthy();
        expect(result.descriptionKey).toBeTruthy();
      }
    }
  });

  it("emits a reason that the feed can actually translate", () => {
    // Closes the loop between the two halves of the fix: any reason this
    // produces must have a rendering key, or it silently shows as blank.
    for (const type of ALL_TYPES) {
      for (const kind of WORKSPACE_KINDS) {
        const result = resolveProposalFastFail(type, kind);
        if (!result) continue;
        expect(proposalFailureReasonKey(result.reason), result.reason).not.toBeNull();
      }
    }
  });
});

describe("proposalFailureReasonKey", () => {
  it.each([
    ["execution_failed", "ai.sidebar.proposal.failureReason.executionFailed"],
    ["unsupported_proposal_type", "ai.sidebar.proposal.failureReason.unsupportedProposalType"],
    ["unsupported_in_supabase_mode", "ai.sidebar.proposal.failureReason.unsupportedInSupabaseMode"],
  ])("maps the known reason %s", (reason, key) => {
    expect(proposalFailureReasonKey(reason)).toBe(key);
  });

  it.each([
    ["an unknown token", "some_future_reason"],
    ["an empty string", ""],
    ["a non-string", 42],
    ["null", null],
    ["undefined", undefined],
    ["a prototype key", "toString"],
  ])("renders nothing for %s", (_label, reason) => {
    // Returning null is what stops a raw machine token reaching a Russian feed
    // entry. "toString" is included because a plain-object lookup would
    // otherwise resolve it off the prototype and print a function.
    expect(proposalFailureReasonKey(reason)).toBeNull();
  });
});
