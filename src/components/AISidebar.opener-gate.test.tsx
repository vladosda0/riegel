import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

/**
 * The readiness gate cannot be reached by the rest of the suite: `.env.test` pins
 * `VITE_WORKSPACE_SOURCE="local"`, where every `isLoading` is hard-false. That is why
 * two audit rounds found defects behind it while CI stayed green. This file forces the
 * loading state instead of waiting for a mode that never happens in tests.
 */
const loading = { project: false, tasks: false };

vi.mock("@/hooks/use-workspace-source", async () => {
  const actual = await vi.importActual<typeof import("@/hooks/use-workspace-source")>(
    "@/hooks/use-workspace-source",
  );
  return {
    ...actual,
    useWorkspaceProjectState: (projectId: string) => ({
      ...actual.useWorkspaceProjectState(projectId),
      isLoading: loading.project,
    }),
  };
});

vi.mock("@/hooks/use-planning-source", async () => {
  const actual = await vi.importActual<typeof import("@/hooks/use-planning-source")>(
    "@/hooks/use-planning-source",
  );
  return {
    ...actual,
    usePlanningProjectTasksState: (projectId: string) => ({
      ...actual.usePlanningProjectTasksState(projectId),
      isLoading: loading.tasks,
    }),
  };
});

/** A spy component, so "was the legacy row ever rendered" is directly observable. */
const suggestionChipsSpy = vi.fn();
vi.mock("@/components/ai/SuggestionChips", () => ({
  SuggestionChips: (props: { suggestions: string[] }) => {
    suggestionChipsSpy(props.suggestions.length);
    return null;
  },
}));

vi.mock("@/lib/analytics", () => ({
  trackEvent: vi.fn(),
  trackEventOncePerUser: vi.fn(),
  trackEventOncePerSession: vi.fn(),
  setAnalyticsUserId: vi.fn(),
  initMetrika: vi.fn(),
  ensureMetrikaStarted: vi.fn(),
  analyticsPageUrl: () => "http://localhost/",
  METRIKA_COUNTER_ID: null,
}));

const { AISidebar } = await import("@/components/AISidebar");
const { __unsafeResetStoreForTests, addMember, addProject, addTask } = await import("@/data/store");
const { clearDemoSession, clearStoredAuthProfile, setAuthRole, setStoredAuthProfile } = await import(
  "@/lib/auth-state"
);
const { trackEvent } = await import("@/lib/analytics");

const trackEventMock = vi.mocked(trackEvent);
let projectSeq = 0;
let projectId = "";

function shownCalls() {
  return trackEventMock.mock.calls.filter(([name]) => name === "ai_opener_shown");
}

function renderSidebar() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/project/${projectId}/dashboard`]}>
        <AISidebar collapsed={false} onCollapsedChange={vi.fn()} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("AISidebar opener readiness gate", () => {
  afterEach(cleanup);

  beforeEach(() => {
    loading.project = false;
    loading.tasks = false;
    suggestionChipsSpy.mockClear();
    trackEventMock.mockClear();
    localStorage.clear();
    sessionStorage.clear();
    setAuthRole("guest");
    clearStoredAuthProfile();
    clearDemoSession();
    const profile = setStoredAuthProfile({ email: "owner@example.com", name: "Owner User" });
    setAuthRole("owner");
    __unsafeResetStoreForTests();

    projectSeq += 1;
    projectId = `project-gate-${projectSeq}`;
    addProject({
      id: projectId,
      owner_id: profile.id,
      title: `Gate ${projectSeq}`,
      type: "residential",
      automation_level: "assisted",
      current_stage_id: "",
      progress_pct: 0,
    });
    addMember({
      project_id: projectId,
      user_id: profile.id,
      role: "owner",
      ai_access: "project_pool",
      credit_limit: 500,
      used_credits: 0,
    });
    addTask({
      id: `task-gate-${projectSeq}`,
      project_id: projectId,
      stage_id: "",
      title: "Blocked work",
      description: "",
      status: "blocked",
      assignee_id: "",
      checklist: [],
      comments: [],
      attachments: [],
      photos: [],
      linked_estimate_item_ids: [],
      created_at: new Date().toISOString(),
    });
  });

  it("says nothing and records nothing while the tasks are still loading", () => {
    loading.tasks = true;
    renderSidebar();

    // Positive first: the sidebar really rendered, so the absences below mean
    // something. No signal, no legacy row, because a count read now would be a
    // count read from an unresolved query.
    expect(screen.getByPlaceholderText("Ask AI...")).toBeInTheDocument();
    expect(screen.queryByText(/Blocked tasks/i)).toBeNull();
    expect(screen.queryByRole("button", { name: "What is blocking tasks?" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Generate contract" })).toBeNull();
    expect(shownCalls()).toHaveLength(0);
    expect(localStorage.getItem("ai-opener-state:anonymous")).toBeNull();
  });

  it("says nothing while the project row is still loading", () => {
    loading.project = true;
    renderSidebar();

    expect(screen.getByPlaceholderText("Ask AI...")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "What is blocking tasks?" })).toBeNull();
    expect(shownCalls()).toHaveLength(0);
  });

  it("shows the block once both have loaded, and reports it once", () => {
    renderSidebar();

    expect(screen.getByRole("button", { name: "What is blocking tasks?" })).toBeInTheDocument();
    expect(shownCalls()).toHaveLength(1);
  });

  it("never renders the legacy chip row between the placeholder and the block", () => {
    // The show is minted in an effect, so the block trails the data by one commit.
    // Asserting on the final DOM cannot see that gap, because act() flushes every
    // effect before the assertion runs; a render COUNT can, because the legacy row
    // is a separate module. Reverting the skeleton fix makes this fail.
    renderSidebar();

    expect(screen.getByRole("button", { name: "What is blocking tasks?" })).toBeInTheDocument();
    expect(suggestionChipsSpy).not.toHaveBeenCalled();
  });

  it("does render the legacy row where the opener cannot serve, so nothing is lost", () => {
    // A project that never resolves is not loading; the block has nothing to say
    // and must hand the space back rather than hold a placeholder forever.
    projectId = "project-gate-missing";
    renderSidebar();

    expect(suggestionChipsSpy).toHaveBeenCalled();
    expect(shownCalls()).toHaveLength(0);
  });
});
