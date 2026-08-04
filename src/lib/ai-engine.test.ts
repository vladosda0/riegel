import { beforeEach, describe, expect, it, vi } from "vitest";
import { PROPOSAL_TYPE_TO_CONTRACT_ACTION, generateProposalQueue } from "@/lib/ai-engine";
import { TOAST_LIMIT } from "@/hooks/use-toast";
import type { ProjectAuthoritySeam } from "@/lib/project-authority-seam";
import type { FinanceVisibility, MemberRole } from "@/types/entities";
import * as store from "@/data/store";

// ---------------------------------------------------------------------------
// Store mocks — generateProposalQueue reads project + stages from the store
// ---------------------------------------------------------------------------

vi.mock("@/data/store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/data/store")>();
  return {
    ...actual,
    getProject: vi.fn(() => ({
      id: "project-1",
      owner_id: "profile-1",
      title: "Test Project",
      type: "residential",
      automation_level: "full",
      current_stage_id: "stage-1",
      progress_pct: 50,
    })),
    getStages: vi.fn(() => [
      { id: "stage-1", project_id: "project-1", title: "Demolition", description: "", order: 1, status: "open" },
    ]),
  };
});

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

function proposalTypes(input: string, seam: ProjectAuthoritySeam): string[] {
  return generateProposalQueue(input, "project-1", "assisted", seam).map((p) => p.type);
}

// ---------------------------------------------------------------------------
// Contract path: ai_enforcement.can_execute_hidden_actions = false
// Contract path: ai_enforcement.can_execute_disabled_visible_actions = false
// ---------------------------------------------------------------------------

describe("generateProposalQueue — action filtering by role", () => {
  it("viewer: no proposals at all (all mapped actions hidden)", () => {
    const types = proposalTypes(
      "add task, update estimate, buy materials, generate contract",
      seamForRole("viewer"),
    );
    expect(types).toEqual([]);
  });

  it("contractor: only document proposals (upload=enabled; tasks/estimate/procurement blocked)", () => {
    const types = proposalTypes(
      "add task, update estimate, buy materials, generate contract",
      seamForRole("contractor"),
    );
    expect(types).toEqual(["generate_document"]);
  });

  it("co_owner: all proposal types allowed", () => {
    const types = proposalTypes(
      "add task, update estimate, buy materials, generate contract",
      seamForRole("co_owner", "detail"),
    );
    expect(types).toContain("add_task");
    expect(types).toContain("update_estimate");
    expect(types).toContain("add_procurement");
    expect(types).toContain("generate_document");
  });

  it("owner: all proposal types allowed", () => {
    const types = proposalTypes(
      "add task, update estimate, buy materials, generate contract",
      seamForRole("owner", "detail"),
    );
    expect(types).toHaveLength(4);
  });

  it("never produces more proposals than the toast stack can hold", () => {
    // runQueueExecution raises one toast per confirmed item, with no render
    // between consecutive fast-fails, and use-toast keeps only TOAST_LIMIT
    // entries. The chosen limit is justified purely by "greater than the largest
    // queue this generator can build", and the comment tells the next author to
    // raise it if the generator grows — but nothing enforced that: the suite was
    // green at a limit of 4 too, so a fifth intent branch would silently restore
    // the pre-paint eviction the constant exists to prevent.
    const maxQueue = generateProposalQueue(
      "add task, update estimate cost budget, buy purchase material procurement, generate document contract report",
      "project-1",
      "assisted",
      seamForRole("owner", "detail"),
    );

    // Pin that the prompt still reaches EVERY mapped type. Without this the
    // assertion below is satisfied by any queue of 1..TOAST_LIMIT-1, so a fifth
    // intent branch keyed on a word this prompt happens not to contain would
    // slip through green while making a 5-item queue reachable in production.
    // It also catches the reverse rot: a regex edit that silently stops matching
    // a branch shrinks this set instead of passing vacuously on a shorter queue.
    //
    // Residual, stated rather than hidden: a fifth branch re-emitting an
    // EXISTING type is still only caught when its keyword is in the prompt. No
    // black-box test can bound the generator over all inputs.
    expect(new Set(maxQueue.map((proposal) => proposal.type))).toEqual(
      new Set(Object.keys(PROPOSAL_TYPE_TO_CONTRACT_ACTION)),
    );

    expect(
      TOAST_LIMIT,
      `TOAST_LIMIT ${TOAST_LIMIT} must exceed the ${maxQueue.length}-item queue runQueueExecution toasts for`,
    ).toBeGreaterThan(maxQueue.length);
  });

  it("stamps the requested project on every proposal it returns", () => {
    // AISidebar keys four writers on `proposal.project_id`: the failure event,
    // the decline event and the two trackEvent goals. It does that because the
    // route-derived id is "" outside /project/*, and getEvents matches
    // project_id exactly, so an event filed under "" is unreachable forever.
    //
    // That fix rests on this invariant, and nothing else pins it: every other
    // assertion in this file reads only `.type`. Drop the `project_id` stamp in
    // createProjectProposals, or wire in a builder that stamps something else
    // (generateProjectProposal uses the "__new__" sentinel), and those four
    // writers would silently file under a wrong or absent project while the
    // whole suite stayed green — the same invisible-write class as #224.
    const proposals = generateProposalQueue(
      "add task, update estimate, buy materials, generate contract",
      "project-1",
      "assisted",
      seamForRole("owner", "detail"),
    );

    expect(proposals).toHaveLength(4);
    for (const proposal of proposals) {
      expect(proposal.project_id, proposal.type).toBe("project-1");
    }
  });
});

// ---------------------------------------------------------------------------
// Russian intent matching — the UI is Russian by default and the sidebar's own
// chips are Russian, so a chip that reaches no branch is a dead headline feature
// ---------------------------------------------------------------------------

describe("generateProposalQueue — Russian prompts", () => {
  // Verbatim ai.sidebar.suggestion.* values from src/locales/ru.json, paired
  // with the type the chip's own label promises.
  const CHIPS: Array<[string, string]> = [
    ["Добавить задачи", "add_task"],
    ["Обновить смету", "update_estimate"],
    ["Купить материалы", "add_procurement"],
    ["Сгенерировать договор", "generate_document"],
    ["Составь отчёт за неделю", "generate_document"],
  ];

  for (const [chip, expectedType] of CHIPS) {
    it(`matches the «${chip}» chip to ${expectedType}`, () => {
      expect(proposalTypes(chip, seamForRole("owner", "detail"))).toContain(expectedType);
    });
  }

  it("matches ordinary Russian phrasing, not just the chip wording", () => {
    const seam = seamForRole("owner", "detail");
    expect(proposalTypes("Нужно купить материалы: плитка и цемент", seam)).toContain("add_procurement");
    expect(proposalTypes("Добавь задачу на монтаж", seam)).toContain("add_task");
    expect(proposalTypes("Пересчитай стоимость работ", seam)).toContain("update_estimate");
    expect(proposalTypes("Подготовь документ по этапу", seam)).toContain("generate_document");
  });

  it("accepts отчет written without ё", () => {
    expect(proposalTypes("Составь отчет за неделю", seamForRole("owner", "detail")))
      .toContain("generate_document");
  });

  it("still reaches no branch for a prompt naming none of the four intents", () => {
    expect(proposalTypes("Предложи график работ", seamForRole("owner", "detail"))).toEqual([]);
  });

  // The two QUESTION chips the sidebar offers contain intent stems, so widening the matchers to
  // Russian makes them produce proposals where they used to fall through to the text fallback.
  // That is accepted rather than special-cased, because it is PARITY, not a new behaviour class:
  // the English originals already match the pre-existing Latin matchers today
  // (/task/ matches "Which tasks are at risk?", /budget/ matches "Explain the budget variance"),
  // so excluding the Russian forms would make the two languages behave differently, which is the
  // defect #237 set out to remove. Nothing applies without an explicit per-item confirm: the
  // queue is always created with phase "review" (AISidebar), so the cost of a wrong match is one
  // ignored card. Pinned here so a future reader sees it was measured, not missed.
  it("lets the Russian question chips reach a branch, matching what the English ones already do", () => {
    const seam = seamForRole("owner", "detail");
    expect(proposalTypes("Какие задачи в зоне риска?", seam)).toContain("add_task");
    expect(proposalTypes("Объясни отклонение по бюджету", seam)).toContain("update_estimate");
    // The English originals, for the parity claim above.
    expect(proposalTypes("Which tasks are at risk?", seam)).toContain("add_task");
    expect(proposalTypes("Explain the budget variance", seam)).toContain("update_estimate");
  });
});

// ---------------------------------------------------------------------------
// Contract path: ai_enforcement.can_reveal_hidden_fields = false
// ---------------------------------------------------------------------------

describe("generateProposalQueue — monetary copy sanitization", () => {
  it("strips ₽ amounts from estimate proposals when finance is not detail", () => {
    const proposals = generateProposalQueue(
      "update estimate",
      "project-1",
      "assisted",
      seamForRole("co_owner", "summary"),
    );
    const estimateProposal = proposals.find((p) => p.type === "update_estimate");
    expect(estimateProposal).toBeDefined();
    for (const change of estimateProposal!.changes) {
      expect(change.before ?? "").not.toMatch(/₽/);
      expect(change.after ?? "").not.toMatch(/₽/);
    }
  });

  it("strips ₽ amounts from procurement proposals when finance is not detail", () => {
    const proposals = generateProposalQueue(
      "buy materials",
      "project-1",
      "assisted",
      seamForRole("co_owner", "summary"),
    );
    const procProposal = proposals.find((p) => p.type === "add_procurement");
    expect(procProposal).toBeDefined();
    for (const change of procProposal!.changes) {
      expect(change.after ?? "").not.toMatch(/₽/);
    }
  });

  it("preserves ₽ amounts for detail finance visibility", () => {
    const proposals = generateProposalQueue(
      "buy materials",
      "project-1",
      "assisted",
      seamForRole("owner", "detail"),
    );
    const procProposal = proposals.find((p) => p.type === "add_procurement");
    expect(procProposal).toBeDefined();
    expect(procProposal!.changes.some((c) => (c.after ?? "").includes("₽"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Contract: contractor procurement actions = disabled_visible → excluded
// ---------------------------------------------------------------------------

describe("generateProposalQueue — disabled_visible is not enabled", () => {
  it("contractor cannot get procurement proposals (order=disabled_visible)", () => {
    const types = proposalTypes("buy materials", seamForRole("contractor"));
    expect(types).not.toContain("add_procurement");
  });
});

// ---------------------------------------------------------------------------
// Fail closed when seam is omitted (no unbounded AI proposal surface)
// ---------------------------------------------------------------------------

describe("generateProposalQueue — missing seam", () => {
  it("returns no proposals when seam is omitted", () => {
    const types = generateProposalQueue(
      "add task, update estimate, buy materials, generate contract",
      "project-1",
      "assisted",
    ).map((p) => p.type);
    expect(types).toEqual([]);
  });
});
