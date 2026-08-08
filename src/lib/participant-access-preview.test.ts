import { describe, expect, it } from "vitest";
import { parseCreditLimit } from "@/components/participants/participants-shared";
import {
  computeAccessPreview,
  effectiveFinanceVisibility,
  effectiveInternalDocsVisibility,
  getRoleAxisDefaults,
  hasManualAxisConfig,
  listManualAxisDeviations,
  listSensitiveGrantsRequiringConfirmation,
  type ParticipantAxes,
} from "@/lib/participant-access-preview";

function axes(partial?: Partial<ParticipantAxes>): ParticipantAxes {
  return {
    aiAccess: "none",
    financeVisibility: "none",
    internalDocsVisibility: "none",
    ...partial,
  };
}

function previewItem(items: ReturnType<typeof computeAccessPreview>, key: string) {
  const item = items.find((entry) => entry.key === key);
  if (!item) throw new Error(`preview item ${key} missing`);
  return item;
}

describe("participant-access-preview", () => {
  // Mirrors SQL effective_finance_visibility / effective_internal_docs_visibility
  // (rovno-db 20260325100000) — including coalesce(NULL, 'none') before the floor.
  describe("effective visibility (P1-2)", () => {
    it("owner is always detail / edit", () => {
      expect(effectiveFinanceVisibility("owner", "none")).toBe("detail");
      expect(effectiveFinanceVisibility("owner", undefined)).toBe("detail");
      expect(effectiveInternalDocsVisibility("owner", "none")).toBe("edit");
    });

    it("co_owner with none or missing values is floored to summary / view", () => {
      expect(effectiveFinanceVisibility("co_owner", "none")).toBe("summary");
      expect(effectiveFinanceVisibility("co_owner", undefined)).toBe("summary");
      expect(effectiveInternalDocsVisibility("co_owner", "none")).toBe("view");
      expect(effectiveInternalDocsVisibility("co_owner", undefined)).toBe("view");
    });

    it("co_owner explicit values above the floor pass through", () => {
      expect(effectiveFinanceVisibility("co_owner", "summary")).toBe("summary");
      expect(effectiveFinanceVisibility("co_owner", "detail")).toBe("detail");
      expect(effectiveInternalDocsVisibility("co_owner", "edit")).toBe("edit");
    });

    it("contractor and viewer have no floor", () => {
      expect(effectiveFinanceVisibility("contractor", undefined)).toBe("none");
      expect(effectiveFinanceVisibility("contractor", "summary")).toBe("summary");
      expect(effectiveFinanceVisibility("viewer", "none")).toBe("none");
      expect(effectiveInternalDocsVisibility("viewer", undefined)).toBe("none");
    });
  });

  describe("computeAccessPreview (P0-3)", () => {
    it("viewer with minimal axes sees view-only domains, hidden money/docs/ai", () => {
      const items = computeAccessPreview({ role: "viewer", axes: axes() });
      expect(previewItem(items, "estimate").state).toBe("views");
      expect(previewItem(items, "tasks").state).toBe("views");
      expect(previewItem(items, "procurement").state).toBe("views");
      expect(previewItem(items, "hr").state).toBe("hidden");
      expect(previewItem(items, "documents").state).toBe("views");
      expect(previewItem(items, "gallery").state).toBe("views");
      expect(previewItem(items, "money").state).toBe("hidden");
      expect(previewItem(items, "internalDocs").state).toBe("hidden");
      expect(previewItem(items, "ai").state).toBe("hidden");
      expect(previewItem(items, "participants").state).toBe("hidden");
    });

    it("contractor with role defaults contributes to tasks and views internal docs", () => {
      const items = computeAccessPreview({
        role: "contractor",
        axes: axes({ aiAccess: "consult_only", internalDocsVisibility: "view" }),
      });
      expect(previewItem(items, "tasks").state).toBe("edits");
      expect(previewItem(items, "estimate").state).toBe("views");
      expect(previewItem(items, "money").state).toBe("hidden");
      expect(previewItem(items, "internalDocs").state).toBe("views");
      expect(previewItem(items, "ai")).toMatchObject({
        state: "views",
        stateLabelKey: "participants.preview.aiState.consult",
      });
    });

    it("owner edits everything including money at detail level", () => {
      const items = computeAccessPreview({
        role: "owner",
        axes: axes({ aiAccess: "project_pool", financeVisibility: "detail", internalDocsVisibility: "edit" }),
        creditLimit: 500,
      });
      expect(previewItem(items, "estimate").state).toBe("edits");
      expect(previewItem(items, "hr").state).toBe("edits");
      expect(previewItem(items, "participants").state).toBe("edits");
      expect(previewItem(items, "money")).toMatchObject({
        state: "edits",
        detailKey: "participants.preview.moneyLevel.detail",
      });
      expect(previewItem(items, "internalDocs").state).toBe("edits");
      expect(previewItem(items, "ai")).toMatchObject({
        state: "edits",
        stateLabelKey: "participants.preview.aiState.full",
      });
      // Nothing enforces the per-member limit, so the preview must not promise
      // one alongside a drawer field that now reads «Скоро» (rovno#301, option B).
      expect(previewItem(items, "ai")).not.toHaveProperty("detailKey");
      expect(previewItem(items, "ai")).not.toHaveProperty("detailParams");
    });

    it("co_owner with finance=none previews the SQL summary floor, not hidden", () => {
      const items = computeAccessPreview({ role: "co_owner", axes: axes() });
      expect(previewItem(items, "money")).toMatchObject({
        state: "views",
        detailKey: "participants.preview.moneyLevel.summary",
      });
      expect(previewItem(items, "internalDocs").state).toBe("views");
    });

    it("contractor with granted detail money still only views it", () => {
      const items = computeAccessPreview({
        role: "contractor",
        axes: axes({ financeVisibility: "detail" }),
      });
      expect(previewItem(items, "money")).toMatchObject({
        state: "views",
        detailKey: "participants.preview.moneyLevel.detail",
      });
    });
  });

  describe("manual configuration badge (P0-7)", () => {
    it("role defaults produce no deviations", () => {
      for (const role of ["owner", "co_owner", "contractor", "viewer"] as const) {
        expect(listManualAxisDeviations(role, getRoleAxisDefaults(role))).toEqual([]);
        expect(hasManualAxisConfig(role, getRoleAxisDefaults(role))).toBe(false);
      }
    });

    it("owner row force-set by the DB trigger (pool/detail/edit) matches defaults", () => {
      expect(hasManualAxisConfig("owner", {
        aiAccess: "project_pool",
        financeVisibility: "detail",
        internalDocsVisibility: "edit",
      })).toBe(false);
    });

    it("lists each deviating axis", () => {
      const deviations = listManualAxisDeviations("contractor", axes({
        aiAccess: "consult_only",
        financeVisibility: "detail",
        internalDocsVisibility: "view",
      }));
      expect(deviations).toEqual(["financeVisibility"]);
      expect(hasManualAxisConfig("contractor", axes({ aiAccess: "none" }))).toBe(true);
    });
  });

  describe("parseCreditLimit", () => {
    it("reads integers, exponent notation, and trims", () => {
      expect(parseCreditLimit("50")).toBe(50);
      expect(parseCreditLimit("1e3")).toBe(1000);
      expect(parseCreditLimit(" 10 ")).toBe(10);
    });

    it("floors decimals and clamps negatives / junk / empty to 0", () => {
      expect(parseCreditLimit("1.9")).toBe(1);
      expect(parseCreditLimit("-5")).toBe(0);
      expect(parseCreditLimit("abc")).toBe(0);
      expect(parseCreditLimit("")).toBe(0);
    });

    it("clamps non-finite input to 0 so it never serializes to null", () => {
      expect(parseCreditLimit("1e999")).toBe(0);
      expect(parseCreditLimit("Infinity")).toBe(0);
    });
  });

  describe("sensitive grant confirmation (P0-4)", () => {
    it("asks when raising contractor money to detail against the saved baseline", () => {
      expect(listSensitiveGrantsRequiringConfirmation({
        role: "contractor",
        axes: axes({ financeVisibility: "detail", internalDocsVisibility: "view", aiAccess: "consult_only" }),
        baseline: axes({ internalDocsVisibility: "view", aiAccess: "consult_only" }),
      })).toEqual(["finance_detail"]);
    });

    it("asks for both grants when both are raised on a new invite (defaults baseline)", () => {
      expect(listSensitiveGrantsRequiringConfirmation({
        role: "viewer",
        axes: axes({ financeVisibility: "detail", internalDocsVisibility: "edit" }),
      })).toEqual(["finance_detail", "docs_edit"]);
    });

    it("does not nag when re-saving unchanged sensitive values", () => {
      const saved = axes({ financeVisibility: "detail", internalDocsVisibility: "edit" });
      expect(listSensitiveGrantsRequiringConfirmation({
        role: "contractor",
        axes: saved,
        baseline: saved,
      })).toEqual([]);
    });

    it("never asks for owner or co_owner (their role design includes these)", () => {
      expect(listSensitiveGrantsRequiringConfirmation({
        role: "co_owner",
        axes: axes({ financeVisibility: "detail", internalDocsVisibility: "edit" }),
        baseline: axes(),
      })).toEqual([]);
      expect(listSensitiveGrantsRequiringConfirmation({
        role: "owner",
        axes: axes({ financeVisibility: "detail", internalDocsVisibility: "edit" }),
      })).toEqual([]);
    });
  });
});
