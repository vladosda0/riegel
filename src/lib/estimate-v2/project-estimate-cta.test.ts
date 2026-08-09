import { describe, expect, it } from "vitest";
import { canPublishClientShare, resolveProjectEstimateCtaState } from "@/lib/estimate-v2/project-estimate-cta";

describe("resolveProjectEstimateCtaState", () => {
  it("owner + contractor shows submit and hides approve", () => {
    const state = resolveProjectEstimateCtaState({
      projectMode: "contractor",
      isOwner: true,
      hasProposedVersion: true,
    });
    expect(state.showSubmit).toBe(true);
    expect(state.showApprove).toBe(false);
  });

  it("owner + build_myself shows submit and hides approve", () => {
    const state = resolveProjectEstimateCtaState({
      projectMode: "build_myself",
      isOwner: true,
      hasProposedVersion: true,
    });
    expect(state.showSubmit).toBe(false);
    expect(state.showApprove).toBe(false);
  });

  it("non-owner hides submit", () => {
    const state = resolveProjectEstimateCtaState({
      projectMode: "contractor",
      isOwner: false,
      hasProposedVersion: true,
    });
    expect(state.showSubmit).toBe(false);
    expect(state.showApprove).toBe(false);
  });
});

describe("canPublishClientShare", () => {
  const modes = ["none", "summary", "detail"] as const;

  it("allows publishing only with full finance detail", () => {
    // The complete domain: manage x submitter-role x finance mode.
    for (const canManageEstimate of [true, false]) {
      for (const isSubmitterRole of [true, false]) {
        for (const financeMode of modes) {
          expect(canPublishClientShare({ canManageEstimate, isSubmitterRole, financeMode }))
            .toBe(canManageEstimate && isSubmitterRole && financeMode === "detail");
        }
      }
    }
  });

  it("refuses a co_owner whose costs are redacted, who would publish an estimate of zeroes", () => {
    expect(canPublishClientShare({
      canManageEstimate: true,
      isSubmitterRole: true,
      financeMode: "summary",
    })).toBe(false);
  });
});
