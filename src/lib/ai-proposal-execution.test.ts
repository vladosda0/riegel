import { describe, expect, it } from "vitest";

import { proposalFailureReasonKey, resolveProposalFastFail } from "@/lib/ai-proposal-execution";
import type { AIProposalType } from "@/types/ai";

// The complete AIProposalType union.
//
// Derived through `satisfies Record<AIProposalType, true>` rather than annotated
// as `AIProposalType[]`. The array annotation does NOT force exhaustiveness (an
// earlier revision of this file claimed it did; a standalone tsc probe with a
// sixth member added showed the file still compiles), so a new union member would
// silently drop out of every loop below, including the one that claims to cover
// the whole domain. The Record form fails the build until it is listed here.
const ALL_TYPES = Object.keys({
  add_task: true,
  update_estimate: true,
  add_procurement: true,
  generate_document: true,
  create_project: true,
} satisfies Record<AIProposalType, true>) as AIProposalType[];

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

  it("covers the full proposal-type domain with a well-formed answer for every member", () => {
    // An earlier revision asserted only `.not.toThrow()`, which this function has
    // no way to fail: it is two ifs and a return. Assert the SHAPE instead, so the
    // test actually discriminates.
    expect(ALL_TYPES).toHaveLength(5);
    for (const type of ALL_TYPES) {
      for (const kind of WORKSPACE_KINDS) {
        const result = resolveProposalFastFail(type, kind);
        if (result === null) continue;
        expect(typeof result.reason, `${type}/${kind}`).toBe("string");
        expect(proposalFailureReasonKey(result.reason), result.reason).not.toBeNull();
      }
    }
  });

  it("gives an unknown proposal type its own message, not the estimate one", () => {
    // Proposals are data, so the union is a compile-time claim only. Telling a
    // user their ESTIMATE cannot be updated when the type was something the build
    // does not recognise would be a lie.
    const result = resolveProposalFastFail("mystery_type" as AIProposalType, "demo");
    expect(result).not.toBeNull();
    expect(result?.reason).toBe("unknown_proposal_type");
    expect(result?.titleKey).toBe("ai.sidebar.toast.unknownProposalType.title");
    // The two translatability loops below iterate ALL_TYPES, which by
    // construction holds only in-union members, and no in-union member can
    // produce this reason. Without this assertion the suite stays green if the
    // token's i18n mapping is deleted, and the permanent feed entry silently
    // loses its explanation: exactly the defect the first review round found.
    expect(proposalFailureReasonKey(result!.reason)).not.toBeNull();
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
    ["unknown_proposal_type", "ai.sidebar.proposal.failureReason.unknownProposalType"],
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
