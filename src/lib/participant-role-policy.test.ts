import { describe, expect, it } from "vitest";
import type { AIAccess, MemberRole } from "@/types/entities";
import {
  axesWithinDelegateCaps,
  canActorAssignRole,
  canRemoveMember,
  canRevokeInvite,
  describePermissionSummary,
  getActorDelegateCaps,
  getDefaultAiAccess,
  getDefaultFinanceVisibility,
  getDefaultInternalDocsVisibility,
  getFinanceVisibilityOptions,
  getInternalDocsVisibilityOptions,
  getInviteAiAccessOptions,
  getInviteRoleOptions,
  getNonStandardAccessSummary,
  getPermissionWarnings,
  getReassignRoleOptions,
  hasNonStandardSupportedAccess,
  internalDocsVisibilityLabels,
} from "@/lib/participant-role-policy";

// A pass-through translator used in tests: returns the key, interpolating any {{value}}
// placeholder. When the key does not contain a placeholder for an option, the option's
// value is appended so that assertions checking .toContain(...) still succeed on the
// structural output (keys + their substituted values).
const t = (key: string, options?: Record<string, unknown>): string => {
  if (!options) return key;
  let out = key;
  for (const [name, value] of Object.entries(options)) {
    const placeholder = `{{${name}}}`;
    if (out.includes(placeholder)) {
      out = out.split(placeholder).join(String(value));
    } else {
      out = `${out} ${String(value)}`;
    }
  }
  return out;
};

function assertRolesEqual(actual: MemberRole[], expected: MemberRole[]) {
  expect(actual).toEqual(expected);
}

function assertAiEqual(actual: AIAccess[], expected: AIAccess[]) {
  expect(actual).toEqual(expected);
}

describe("participant-role-policy", () => {
  describe("getInviteRoleOptions", () => {
    it("owner can invite co_owner/contractor/viewer", () => {
      assertRolesEqual(getInviteRoleOptions("owner"), ["co_owner", "contractor", "viewer"]);
    });

    it("co_owner can invite contractor/viewer only", () => {
      assertRolesEqual(getInviteRoleOptions("co_owner"), ["contractor", "viewer"]);
    });

    it("contractor/viewer cannot invite", () => {
      assertRolesEqual(getInviteRoleOptions("contractor"), []);
      assertRolesEqual(getInviteRoleOptions("viewer"), []);
    });
  });

  describe("getReassignRoleOptions", () => {
    it("never offers owner target reassignment", () => {
      assertRolesEqual(getReassignRoleOptions("owner", "owner"), []);
      assertRolesEqual(getReassignRoleOptions("co_owner", "owner"), []);
    });

    it("owner can assign co_owner/contractor/viewer", () => {
      assertRolesEqual(getReassignRoleOptions("owner", "contractor"), ["co_owner", "contractor", "viewer"]);
      assertRolesEqual(getReassignRoleOptions("owner", "viewer"), ["co_owner", "contractor", "viewer"]);
    });

    it("co_owner can assign contractor/viewer only for contractor or viewer targets", () => {
      assertRolesEqual(getReassignRoleOptions("co_owner", "contractor"), ["contractor", "viewer"]);
      assertRolesEqual(getReassignRoleOptions("co_owner", "viewer"), ["contractor", "viewer"]);
      assertRolesEqual(getReassignRoleOptions("co_owner", "co_owner"), []);
    });

    it("contractor/viewer cannot reassign", () => {
      assertRolesEqual(getReassignRoleOptions("contractor", "contractor"), []);
      assertRolesEqual(getReassignRoleOptions("viewer", "viewer"), []);
    });
  });

  describe("getInviteAiAccessOptions", () => {
    it("none restricts to none", () => {
      assertAiEqual(getInviteAiAccessOptions("none"), ["none"]);
    });

    it("consult_only restricts to none/consult_only", () => {
      assertAiEqual(getInviteAiAccessOptions("consult_only"), ["none", "consult_only"]);
    });

    it("project_pool allows all", () => {
      assertAiEqual(getInviteAiAccessOptions("project_pool"), ["none", "consult_only", "project_pool"]);
    });
  });

  describe("finance visibility defaults", () => {
    it("keeps viewer and contractor fail-safe by default", () => {
      expect(getDefaultFinanceVisibility("viewer")).toBe("none");
      expect(getDefaultFinanceVisibility("contractor")).toBe("none");
    });

    it("keeps co_owner and owner on detail defaults", () => {
      expect(getDefaultFinanceVisibility("co_owner")).toBe("detail");
      expect(getDefaultFinanceVisibility("owner")).toBe("detail");
    });
  });

  describe("internal docs & media copy", () => {
    it("labels resolve to distinct i18n keys for none/view/edit", () => {
      expect(internalDocsVisibilityLabels.none).toBe("participants.internalDocs.none");
      expect(internalDocsVisibilityLabels.view).toBe("participants.internalDocs.view");
      expect(internalDocsVisibilityLabels.edit).toBe("participants.internalDocs.edit");
    });

    it("permission summary includes the internal docs & media line", () => {
      const summary = describePermissionSummary({
        role: "contractor",
        aiAccess: "none",
        internalDocsVisibility: "view",
      }, t);
      const docsLine = summary.find((l) => l.startsWith("participants.summary.internalDocs"));
      expect(docsLine).toContain("participants.internalDocs.view");
    });

    it("permission summary states no per-member AI request limit", () => {
      // Nothing reads project_members.credit_limit (rovno#301), so the summary
      // must not assert one: the field it described is parked behind «Скоро».
      const summary = describePermissionSummary({
        role: "contractor",
        aiAccess: "project_pool",
        internalDocsVisibility: "view",
      }, t);
      expect(summary.some((line) => line.includes("creditLimit"))).toBe(false);
    });

    it("edit warning produces the docs-edit key", () => {
      const warnings = getPermissionWarnings({
        role: "contractor",
        aiAccess: "none",
        internalDocsVisibility: "edit",
      }, t);
      expect(warnings).toContain("participants.warning.docsEdit");
    });
  });

  // Mirror of `assert_project_participant_delegate_ok` + `actor_*_delegate_cap`
  // (rovno-db 20260324140000 / 20260325100000). Any change here must match SQL.
  describe("delegation caps mirror", () => {
    it("owner caps are the maximum of every axis", () => {
      expect(getActorDelegateCaps({ role: "owner" })).toEqual({
        aiAccess: "project_pool",
        financeVisibility: "detail",
        internalDocsVisibility: "edit",
      });
    });

    it("co_owner with none/missing finance and docs is floored to summary/view", () => {
      expect(getActorDelegateCaps({ role: "co_owner" })).toEqual({
        aiAccess: "none",
        financeVisibility: "summary",
        internalDocsVisibility: "view",
      });
      expect(getActorDelegateCaps({
        role: "co_owner",
        aiAccess: "none",
        financeVisibility: "none",
        internalDocsVisibility: "none",
      })).toEqual({
        aiAccess: "none",
        financeVisibility: "summary",
        internalDocsVisibility: "view",
      });
    });

    it("the AI axis has NO co_owner floor (deliberate SQL asymmetry)", () => {
      expect(getActorDelegateCaps({ role: "co_owner", aiAccess: "none" }).aiAccess).toBe("none");
      expect(getActorDelegateCaps({ role: "co_owner", aiAccess: "consult_only" }).aiAccess).toBe("consult_only");
    });

    it("co_owner stored values above the floor are kept", () => {
      expect(getActorDelegateCaps({ role: "co_owner", financeVisibility: "detail" }).financeVisibility).toBe("detail");
      expect(getActorDelegateCaps({ role: "co_owner", internalDocsVisibility: "edit" }).internalDocsVisibility).toBe("edit");
    });

    it("axesWithinDelegateCaps accepts values at the cap and rejects above it", () => {
      const coOwner = { role: "co_owner" as MemberRole, aiAccess: "consult_only" as AIAccess, financeVisibility: "none" as const, internalDocsVisibility: "none" as const };
      expect(axesWithinDelegateCaps(coOwner, { aiAccess: "consult_only", financeVisibility: "summary", internalDocsVisibility: "view" })).toBe(true);
      expect(axesWithinDelegateCaps(coOwner, { aiAccess: "project_pool", financeVisibility: "summary", internalDocsVisibility: "view" })).toBe(false);
      expect(axesWithinDelegateCaps(coOwner, { aiAccess: "none", financeVisibility: "detail", internalDocsVisibility: "none" })).toBe(false);
      expect(axesWithinDelegateCaps(coOwner, { aiAccess: "none", financeVisibility: "none", internalDocsVisibility: "edit" })).toBe(false);
    });

    it("canActorAssignRole enumerates the full role matrix", () => {
      const roles: MemberRole[] = ["owner", "co_owner", "contractor", "viewer"];
      for (const target of roles) {
        expect(canActorAssignRole("owner", target)).toBe(target !== "owner");
        expect(canActorAssignRole("co_owner", target)).toBe(target === "contractor" || target === "viewer");
        expect(canActorAssignRole("contractor", target)).toBe(false);
        expect(canActorAssignRole("viewer", target)).toBe(false);
      }
    });

    it("member removal is owner-only and never targets the owner row", () => {
      expect(canRemoveMember("owner", "co_owner")).toBe(true);
      expect(canRemoveMember("owner", "contractor")).toBe(true);
      expect(canRemoveMember("owner", "viewer")).toBe(true);
      expect(canRemoveMember("owner", "owner")).toBe(false);
      expect(canRemoveMember("co_owner", "contractor")).toBe(false);
      expect(canRemoveMember("co_owner", "viewer")).toBe(false);
      expect(canRemoveMember("contractor", "viewer")).toBe(false);
    });

    it("co_owner cannot revoke a co_owner invite or one with axes above their caps", () => {
      const coOwner = { role: "co_owner" as MemberRole, aiAccess: "consult_only" as AIAccess, financeVisibility: "summary" as const, internalDocsVisibility: "view" as const };
      const plainContractorInvite = { role: "contractor" as MemberRole, aiAccess: "consult_only" as AIAccess, financeVisibility: "none" as const, internalDocsVisibility: "view" as const };
      expect(canRevokeInvite(coOwner, plainContractorInvite)).toBe(true);
      expect(canRevokeInvite(coOwner, { ...plainContractorInvite, role: "co_owner" })).toBe(false);
      expect(canRevokeInvite(coOwner, { ...plainContractorInvite, financeVisibility: "detail" })).toBe(false);
      expect(canRevokeInvite(coOwner, { ...plainContractorInvite, aiAccess: "project_pool" })).toBe(false);
      // Owner revokes anything, including invites above any caps.
      expect(canRevokeInvite({ role: "owner" }, { ...plainContractorInvite, financeVisibility: "detail" })).toBe(true);
      expect(canRevokeInvite({ role: "contractor" }, plainContractorInvite)).toBe(false);
    });

    it("option lists widen with the co_owner floors", () => {
      expect(getFinanceVisibilityOptions("co_owner", "none")).toEqual(["none", "summary"]);
      expect(getFinanceVisibilityOptions("co_owner", undefined)).toEqual(["none", "summary"]);
      expect(getFinanceVisibilityOptions("co_owner", "detail")).toEqual(["none", "summary", "detail"]);
      expect(getFinanceVisibilityOptions("owner")).toEqual(["none", "summary", "detail"]);
      expect(getInternalDocsVisibilityOptions("co_owner", "none")).toEqual(["none", "view"]);
      expect(getInternalDocsVisibilityOptions("co_owner", undefined)).toEqual(["none", "view"]);
    });
  });

  describe("role axis defaults", () => {
    it("AI defaults follow the role presets", () => {
      expect(getDefaultAiAccess("owner")).toBe("project_pool");
      expect(getDefaultAiAccess("co_owner")).toBe("project_pool");
      expect(getDefaultAiAccess("contractor")).toBe("consult_only");
      expect(getDefaultAiAccess("viewer")).toBe("none");
    });

    it("owner internal docs default mirrors the DB owner-membership trigger (edit)", () => {
      expect(getDefaultInternalDocsVisibility("owner")).toBe("edit");
      expect(getDefaultInternalDocsVisibility("co_owner")).toBe("view");
      expect(getDefaultInternalDocsVisibility("contractor")).toBe("view");
      expect(getDefaultInternalDocsVisibility("viewer")).toBe("none");
    });
  });

  describe("non-standard supported access summary", () => {
    it("flags non-default finance expansion for viewer and contractor", () => {
      expect(hasNonStandardSupportedAccess({ role: "viewer", financeVisibility: "summary" })).toBe(true);
      expect(hasNonStandardSupportedAccess({ role: "contractor", financeVisibility: "summary" })).toBe(true);
    });

    it("returns the expected i18n keys for the non-standard access summary", () => {
      const viewerSummary = getNonStandardAccessSummary({ role: "viewer", financeVisibility: "summary" }, t);
      expect(viewerSummary?.title).toBe("participants.nonStandard.viewer.title");
      expect(viewerSummary?.lines).toEqual(["participants.nonStandard.viewer.line1"]);

      const contractorSummary = getNonStandardAccessSummary({ role: "contractor", financeVisibility: "summary" }, t);
      expect(contractorSummary?.title).toBe("participants.nonStandard.contractor.title");
      expect(contractorSummary?.lines).toEqual(["participants.nonStandard.contractor.line1"]);
    });
  });
});
