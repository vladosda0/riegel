import { describe, expect, it } from "vitest";

import {
  proposalFailureReasonKey,
  resolveProposalExecutionAnalytics,
  resolveProposalFastFail,
} from "@/lib/ai-proposal-execution";
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

  it("blocks add_procurement in every workspace mode", () => {
    // Regression for #224. The mutator exists but writes to the v1 @/data/store,
    // which no procurement reader consumes, so the type can never surface
    // anywhere. Mode-independent, matching the library guard.
    for (const kind of WORKSPACE_KINDS) {
      const result = resolveProposalFastFail("add_procurement", kind);
      expect(result, `expected a fast-fail in ${kind}`).not.toBeNull();
      expect(result?.reason).toBe("unsupported_proposal_type");
    }
  });

  it("gives add_procurement its own message, not the estimate one", () => {
    // Both are unsupported_proposal_type, so the reason alone cannot tell them
    // apart. Telling a user their ESTIMATE cannot be updated when they asked for
    // procurement would be the same lie the unknown-type case guards against.
    const result = resolveProposalFastFail("add_procurement", "demo");
    expect(result?.titleKey).toBe("ai.sidebar.toast.procurementUnavailable.title");
    expect(result?.descriptionKey).toBe("ai.sidebar.toast.procurementUnavailable.description");
    expect(resolveProposalFastFail("update_estimate", "demo")?.titleKey)
      .toBe("ai.sidebar.toast.estimateUnavailable.title");
  });

  it("lets every implemented type through in every mode", () => {
    const implemented = ALL_TYPES.filter(
      (t) => t !== "update_estimate" && t !== "generate_document" && t !== "add_procurement",
    );
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

describe("resolveProposalExecutionAnalytics", () => {
  // rovno#227. `ai_proposal_applied` used to fire at CONFIRM time, before the
  // queue attempted anything, with no counter-event on failure. Types that fail
  // closed on every path therefore reported a 100% apply rate, and the figure
  // got WORSE as more dead paths were correctly closed. The emission decision
  // now lives here so it is pinned by tests rather than by a component loop
  // nothing touches — the same reason resolveProposalFastFail was extracted.

  // The COMPLETE input domain: success x unavailableReason. All four cells.
  it("reports applied when the item succeeded", () => {
    expect(resolveProposalExecutionAnalytics({ success: true, unavailableReason: null, attempts: 1 }))
      .toEqual({ event: "ai_proposal_applied", attempts: 1 });
  });

  it("reports applied even if a reason is somehow present, because success wins", () => {
    // Not reachable in the current loop (the fast-fail breaks before any
    // attempt), but the function must be total rather than rely on the caller.
    expect(resolveProposalExecutionAnalytics({ success: true, unavailableReason: "x", attempts: 2 }))
      .toEqual({ event: "ai_proposal_applied", attempts: 2 });
  });

  it("reports unavailable, carrying the reason, when a fast-fail stopped it", () => {
    expect(resolveProposalExecutionAnalytics({
      success: false, unavailableReason: "unsupported_in_supabase_mode", attempts: 0,
    })).toEqual({
      event: "ai_proposal_unavailable", reason: "unsupported_in_supabase_mode", attempts: 0,
    });
  });

  it("reports NOTHING when the retries were exhausted", () => {
    // Deliberate: a fourth goal would have to be created in Yandex Metrika by
    // hand for it to be counted at all. This case is derivable by subtraction,
    // confirmed - applied - unavailable, so it costs no goal and loses nothing.
    expect(resolveProposalExecutionAnalytics({ success: false, unavailableReason: null, attempts: 5 }))
      .toBeNull();
  });

  it("passes the real attempt count through, which is 0 for a fast-fail", () => {
    // The attempts figure is the whole point of separating these two: a
    // fast-fail never entered the loop, and the old event recorded five.
    const fastFail = resolveProposalExecutionAnalytics({
      success: false, unavailableReason: "unsupported_proposal_type", attempts: 0,
    });
    expect(fastFail).not.toBeNull();
    expect(fastFail!.attempts).toBe(0);
    expect(resolveProposalExecutionAnalytics({ success: true, unavailableReason: null, attempts: 4 })!.attempts)
      .toBe(4);
  });

  it("treats an empty reason string as no reason, not as a fast-fail", () => {
    // "" is falsy but is still a string; a truthiness check and an
    // `!== null` check disagree here, and the wrong one invents an
    // unavailable event with a blank reason dimension.
    expect(resolveProposalExecutionAnalytics({ success: false, unavailableReason: "", attempts: 3 }))
      .toBeNull();
  });
});
