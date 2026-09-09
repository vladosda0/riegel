import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  commitPhotoConsultActions,
  commitProposal,
  filterPhotoConsultProposalChangesBySeam,
  type CommitResult,
} from "@/lib/commit-proposal";
import type { AIProposal, ProposalChange } from "@/types/ai";
import type { ProjectAuthoritySeam } from "@/lib/project-authority-seam";
import type { FinanceVisibility, MemberRole } from "@/types/entities";
import { __unsafeResetStoreForTests, getCurrentUser, getEvents, getTasks, getDocuments } from "@/data/store";
import { clearDemoSession, enterDemoSession, setAuthRole } from "@/lib/auth-state";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function seamForRole(
  role: MemberRole,
  finance_visibility: FinanceVisibility = "none",
): ProjectAuthoritySeam {
  return {
    projectId: "project-1",
    profileId: "profile-1",
    membership: {
      project_id: "project-1",
      user_id: "profile-1",
      role,
      ai_access: "project_pool",
      finance_visibility,
      credit_limit: 100,
      used_credits: 0,
    },
    project: undefined,
  };
}

function makeProposal(type: AIProposal["type"]): AIProposal {
  const changeMap: Record<string, ProposalChange[]> = {
    add_task: [{ entity_type: "task", action: "create", label: "Test task", after: "not_started" }],
    update_estimate: [{ entity_type: "estimate_item", action: "update", label: "Line item", before: "100", after: "200" }],
    add_procurement: [{ entity_type: "procurement_item", action: "create", label: "Nails", after: "500 ₽" }],
    generate_document: [{ entity_type: "document", action: "create", label: "Contract", after: "Draft v1" }],
  };
  return {
    id: `proposal-test-${Date.now()}`,
    project_id: "project-1",
    type,
    summary: `Test ${type}`,
    changes: changeMap[type] ?? [],
    status: "pending",
  };
}

// ---------------------------------------------------------------------------
// Setup — use demo store seeded state
// ---------------------------------------------------------------------------

beforeEach(() => {
  sessionStorage.clear();
  __unsafeResetStoreForTests();
  clearDemoSession();
  enterDemoSession("project-1");
  setAuthRole("owner");
});

// ---------------------------------------------------------------------------
// Contract path: ai_enforcement.can_execute_hidden_actions = false
// ---------------------------------------------------------------------------

describe("commitProposal — hidden action enforcement", () => {
  it("viewer cannot commit add_task (tasks.manage_tasks = hidden)", () => {
    const result = commitProposal(makeProposal("add_task"), {
      authoritySeam: seamForRole("viewer"),
    });
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it("viewer cannot commit update_estimate (estimate.edit_estimate_rows = hidden)", () => {
    const result = commitProposal(makeProposal("update_estimate"), {
      authoritySeam: seamForRole("viewer"),
    });
    expect(result.success).toBe(false);
  });

  it("viewer cannot commit add_procurement (procurement.order = hidden)", () => {
    const result = commitProposal(makeProposal("add_procurement"), {
      authoritySeam: seamForRole("viewer"),
    });
    expect(result.success).toBe(false);
  });

  it("viewer cannot commit generate_document (documents_media.upload = hidden)", () => {
    const result = commitProposal(makeProposal("generate_document"), {
      authoritySeam: seamForRole("viewer"),
    });
    expect(result.success).toBe(false);
  });

  it("contractor cannot commit add_task (tasks.manage_tasks = hidden)", () => {
    const result = commitProposal(makeProposal("add_task"), {
      authoritySeam: seamForRole("contractor"),
    });
    expect(result.success).toBe(false);
  });

  it("contractor cannot commit update_estimate (estimate.edit_estimate_rows = hidden)", () => {
    const result = commitProposal(makeProposal("update_estimate"), {
      authoritySeam: seamForRole("contractor"),
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Contract path: ai_enforcement.can_execute_disabled_visible_actions = false
// ---------------------------------------------------------------------------

describe("commitProposal — disabled_visible action enforcement", () => {
  it("contractor cannot commit add_procurement (procurement.order = disabled_visible)", () => {
    const result = commitProposal(makeProposal("add_procurement"), {
      authoritySeam: seamForRole("contractor"),
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("not available");
  });
});

// ---------------------------------------------------------------------------
// Contract path: ai_enforcement.confirmation_does_not_grant_permission = true
// ---------------------------------------------------------------------------

describe("commitProposal — confirmation does not grant permission", () => {
  it("confirmed proposal for viewer still fails at commit time", () => {
    const proposal = makeProposal("add_task");
    proposal.status = "confirmed" as never;
    const result = commitProposal(proposal, {
      authoritySeam: seamForRole("viewer"),
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Contract path: enabled actions succeed for authorized roles
// ---------------------------------------------------------------------------

describe("commitProposal — enabled actions succeed", () => {
  it("owner can commit add_task", () => {
    const result = commitProposal(makeProposal("add_task"), {
      authoritySeam: seamForRole("owner", "detail"),
    });
    expect(result.success).toBe(true);
    expect(result.created.length).toBeGreaterThan(0);
  });

  it("writes the task description through t when one is supplied", () => {
    const result = commitProposal(makeProposal("add_task"), {
      authoritySeam: seamForRole("owner", "detail"),
      t: (key, options) => `[${key}|${String((options ?? {}).stage ?? "")}]`,
    });

    expect(result.success).toBe(true);
    const task = getTasks("project-1").find((candidate) => candidate.title === "Test task");
    expect(task?.description).toContain("ai.sidebar.proposal.demo.taskDescription");
    expect(task?.description).not.toContain("AI-generated task for");
  });

  // A project created in demo/local mode is seeded with no stages at all
  // (workspace-source.createProject), so `stages[0]` is undefined here.
  it("falls back to the stage placeholder when the project has no stage", () => {
    const proposal = { ...makeProposal("add_task"), project_id: "project-without-stages" };
    const result = commitProposal(proposal, {
      authoritySeam: seamForRole("owner", "detail"),
      t: (key, options) => `[${key}|${String((options ?? {}).stage ?? "MISSING")}]`,
    });

    expect(result.success).toBe(true);
    const task = getTasks("project-without-stages").find((candidate) => candidate.title === "Test task");
    expect(task?.description).toContain("ai.sidebar.proposal.demo.currentStageFallback");
    expect(task?.description).not.toContain("|]");
  });

  it("writes the document draft body through t when one is supplied", () => {
    const result = commitProposal(makeProposal("generate_document"), {
      authoritySeam: seamForRole("owner", "detail"),
      t: (key, options) => `[${key}|${String((options ?? {}).title ?? "")}]`,
    });

    expect(result.success).toBe(true);
    const document = getDocuments("project-1").find((candidate) => candidate.title === "Contract");
    expect(document?.versions[0]?.content).toContain("ai.sidebar.proposal.demo.documentDraftBody");
    expect(document?.versions[0]?.content).not.toContain("AI-generated draft for");
  });

  it("keeps the English document draft body when no t is supplied", () => {
    const result = commitProposal(makeProposal("generate_document"), {
      authoritySeam: seamForRole("owner", "detail"),
    });

    expect(result.success).toBe(true);
    const document = getDocuments("project-1").find((candidate) => candidate.title === "Contract");
    expect(document?.versions[0]?.content).toContain("AI-generated draft for");
  });

  it("keeps the English default when no t is supplied", () => {
    const result = commitProposal(makeProposal("add_task"), {
      authoritySeam: seamForRole("owner", "detail"),
    });

    expect(result.success).toBe(true);
    const task = getTasks("project-1").find((candidate) => candidate.title === "Test task");
    expect(task?.description).toContain("AI-generated task for");
  });

  it("add_procurement reports unavailable instead of writing to a store nobody reads", () => {
    // Regression for #224, and the same shape as the #175 case below. The role
    // IS permitted and the type IS mapped, but the only mutator this module
    // holds for procurement is addProcurementItem from @/data/store — the v1
    // store, which no procurement reader consumes. The product reads V2
    // (@/data/procurement-store): ProjectProcurement goes through
    // useProjectProcurementItemsState, and procurement-read-model through
    // getAllProcurementItemsV2. The only v1 reader, useProcurement in
    // use-mock-data, has zero call sites.
    //
    // So claiming success charged a credit and logged a procurement_created
    // activity entry for an item that appears nowhere.
    //
    // Reverse this test only together with a real V2 write, never to restore
    // the success claim on its own.
    const before = getCurrentUser();
    const creditsBefore = before.credits_free + before.credits_paid;

    const result = commitProposal(makeProposal("add_procurement"), {
      authoritySeam: seamForRole("owner", "detail"),
    });

    expect(result.success).toBe(false);
    // Pin the EXACT string. /not available/i alone matches the estimate
    // message too, so swapping the two switch arms — precisely the lie the
    // third arm exists to prevent — would otherwise ship green. A loose
    // /procurement/i is also satisfied by the role-guard message for a hidden
    // action, so it cannot tell the applicability guard from the role guard.
    expect(result.error).toBe("Adding AI procurement items is not available yet.");
    expect(result.eventIds).toEqual([]);
    expect(result.created).toEqual([]);
    expect(result.updated).toEqual([]);

    // No credit charged and no activity entry claiming an item was created.
    const after = getCurrentUser();
    expect(after.credits_free + after.credits_paid).toBe(creditsBefore);
    expect(getEvents("project-1").some((event) => event.type === "procurement_created")).toBe(false);
  });

  it("update_estimate reports unavailable instead of a silent no-op, even for a permitted role", () => {
    // Regression for #175. The role IS permitted and the type IS mapped; the
    // point is that nothing in this module can write an estimate, so claiming
    // success charged a credit and logged an activity entry for a change that
    // never happened. Reverse this test only together with a real estimate
    // mutation, never to restore the success claim on its own.
    const before = getCurrentUser();
    const creditsBefore = before.credits_free + before.credits_paid;

    const result = commitProposal(makeProposal("update_estimate"), {
      authoritySeam: seamForRole("co_owner", "detail"),
    });

    expect(result.success).toBe(false);
    // Same reason as the procurement case above, and it matters more here:
    // update_estimate maps to the action edit_estimate_rows, so the role-guard
    // message also contains both "not available" and "estimate".
    expect(result.error).toBe("Applying AI estimate changes is not available yet.");
    expect(result.eventIds).toEqual([]);
    expect(result.created).toEqual([]);
    expect(result.updated).toEqual([]);

    // No credit charged and no activity entry claiming an estimate changed.
    const after = getCurrentUser();
    expect(after.credits_free + after.credits_paid).toBe(creditsBefore);
    expect(getEvents("project-1").some((event) => event.type === "estimate_created")).toBe(false);
  });

  it("contractor can commit generate_document (documents_media.upload = enabled)", () => {
    const result = commitProposal(makeProposal("generate_document"), {
      authoritySeam: seamForRole("contractor"),
    });
    expect(result.success).toBe(true);
  });
});

describe("commitProposal — unknown / unsupported proposal types", () => {
  it("fails closed for an unknown proposal type string", () => {
    const result = commitProposal(
      {
        id: "bad",
        project_id: "project-1",
        type: "unknown_type" as never,
        summary: "nope",
        changes: [],
        status: "pending",
      },
      { authoritySeam: seamForRole("owner", "detail") },
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain("cannot be applied");
  });
});

describe("filterPhotoConsultProposalChangesBySeam", () => {
  const fullSet: ProposalChange[] = [
    { entity_type: "task", action: "create", label: "Fix", after: "not_started" },
    { entity_type: "comment", action: "create", label: "Note" },
    {
      entity_type: "task",
      action: "update",
      label: "Done",
      before: "in_progress",
      after: "done",
    },
  ];

  it("drops all suggestions for viewer (tasks domain actions hidden)", () => {
    const filtered = filterPhotoConsultProposalChangesBySeam(
      seamForRole("viewer"),
      "project-1",
      fullSet,
      true,
    );
    expect(filtered).toEqual([]);
  });

  it("keeps contractor comment + status but drops manage_tasks create", () => {
    const filtered = filterPhotoConsultProposalChangesBySeam(
      seamForRole("contractor"),
      "project-1",
      fullSet,
      true,
    );
    expect(filtered.map((c) => c.entity_type)).toEqual(["comment", "task"]);
    expect(filtered[0].action).toBe("create");
    expect(filtered[1].action).toBe("update");
  });

  it("drops comment and mark-done when there is no linked task", () => {
    const filtered = filterPhotoConsultProposalChangesBySeam(
      seamForRole("owner", "detail"),
      "project-1",
      fullSet,
      false,
    );
    expect(filtered).toHaveLength(1);
    expect(filtered[0].entity_type).toBe("task");
    expect(filtered[0].action).toBe("create");
  });

  it("returns nothing when seam projectId mismatches", () => {
    const filtered = filterPhotoConsultProposalChangesBySeam(
      { ...seamForRole("owner", "detail"), projectId: "other" },
      "project-1",
      fullSet,
      true,
    );
    expect(filtered).toEqual([]);
  });

  it("returns nothing when ai.generate is denied (contractor consult_only)", () => {
    const base = seamForRole("contractor");
    const seam = {
      ...base,
      membership: base.membership
        ? { ...base.membership, ai_access: "consult_only" as const }
        : null,
    };
    const filtered = filterPhotoConsultProposalChangesBySeam(seam, "project-1", fullSet, true);
    expect(filtered).toEqual([]);
  });
});

describe("commitPhotoConsultActions", () => {
  it("viewer cannot apply photo consult task create", () => {
    const result = commitPhotoConsultActions(
      [{ kind: "create_task", projectId: "project-1", title: "Fix", stageId: "s1", photoIds: [] }],
      { authoritySeam: seamForRole("viewer") },
    );
    expect(result.success).toBe(false);
  });

  it("owner can apply a single photo consult task create", () => {
    const result = commitPhotoConsultActions(
      [{ kind: "create_task", projectId: "project-1", title: "Fix leak", stageId: "stage-1-1", photoIds: ["m1"] }],
      { authoritySeam: seamForRole("owner", "detail"), eventSource: "ai" },
    );
    expect(result.success).toBe(true);
    expect(result.count).toBe(1);
  });
});
