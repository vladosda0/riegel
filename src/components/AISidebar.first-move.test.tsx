import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { AISidebar } from "@/components/AISidebar";
import { __unsafeResetStoreForTests, addMember, addProject, addTask } from "@/data/store";
import { clearDemoSession, clearStoredAuthProfile, setAuthRole, setStoredAuthProfile } from "@/lib/auth-state";
import { trackEvent } from "@/lib/analytics";

/**
 * `ai_thread_first_move` is the phase-0 baseline for the grounded opener: it is
 * the number the opener's own click-through will be compared against, so the
 * cases that decide `entry` are asserted against the real composer rather than
 * left to the comparator's unit tests, which cannot see the wiring.
 */
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

const trackEventMock = vi.mocked(trackEvent);

/**
 * A send leaves a work-log window open, and the sidebar's in-memory per-project
 * state is restored on remount, so a reused project id would bring the lock back
 * and the next test would find no composer. Each test gets its own project id.
 */
let projectSeq = 0;
let projectId = "";
let ownerProfileId = "";

function firstMoveCalls() {
  return trackEventMock.mock.calls.filter(([name]) => name === "ai_thread_first_move");
}

function promptSubmittedCalls() {
  return trackEventMock.mock.calls.filter(([name]) => name === "ai_prompt_submitted");
}

function renderSidebar() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/project/${projectId}/dashboard`]}>
        <AISidebar collapsed={false} onCollapsedChange={vi.fn()} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return screen.getByPlaceholderText("Ask AI...");
}

describe("AISidebar first-move instrumentation", () => {
  afterEach(cleanup);

  beforeEach(() => {
    trackEventMock.mockClear();
    localStorage.clear();
    sessionStorage.clear();
    setAuthRole("guest");
    clearStoredAuthProfile();
    clearDemoSession();
    const profile = setStoredAuthProfile({ email: "owner@example.com", name: "Owner User" });
    ownerProfileId = profile.id;
    setAuthRole("owner");
    __unsafeResetStoreForTests();

    projectSeq += 1;
    projectId = `project-first-move-${projectSeq}`;

    addProject({
      id: projectId,
      owner_id: profile.id,
      title: `Project ${projectSeq}`,
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
    // A blocked task, so the opener has a v1 signal to show: only the tasks domain
    // ships in v1, and an empty project falls back to the neutral line.
    addTask({
      id: `task-blocked-${projectSeq}`,
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

  it("attributes an unedited chip send to that chip", () => {
    const composer = renderSidebar();

    fireEvent.click(screen.getByRole("button", { name: "Which tasks are at risk?" }));
    fireEvent.keyDown(composer, { key: "Enter" });

    expect(firstMoveCalls()).toHaveLength(1);
    expect(firstMoveCalls()[0][1]).toMatchObject({
      entry: "chip",
      chip_key: "ai.sidebar.suggestion.nextRiskyTasks",
    });
  });

  it("counts an edited chip as manual and drops the key", () => {
    const composer = renderSidebar();

    fireEvent.click(screen.getByRole("button", { name: "Which tasks are at risk?" }));
    fireEvent.change(composer, { target: { value: "Which tasks are at risk here?" } });
    fireEvent.keyDown(composer, { key: "Enter" });

    expect(firstMoveCalls()[0][1]).toMatchObject({ entry: "manual", chip_key: null });
  });

  it("counts a typed prompt as manual", () => {
    const composer = renderSidebar();

    fireEvent.change(composer, { target: { value: "why is the demolition stuck" } });
    fireEvent.keyDown(composer, { key: "Enter" });

    expect(firstMoveCalls()[0][1]).toMatchObject({ entry: "manual", chip_key: null });
  });

  it("does not fire a second time once the thread is under way", async () => {
    const composer = renderSidebar();

    fireEvent.change(composer, { target: { value: "first" } });
    fireEvent.keyDown(composer, { key: "Enter" });

    // A send unmounts the composer while the assistant's work log runs, so the
    // second send has to wait for it to come back. Asserting two submissions is
    // what keeps this test honest: without the wait the second pair of events
    // lands on a detached node and the test would pass while covering nothing.
    const reopened = await screen.findByPlaceholderText("Ask AI...", {}, { timeout: 10_000 });
    fireEvent.change(reopened, { target: { value: "second" } });
    fireEvent.keyDown(reopened, { key: "Enter" });

    expect(promptSubmittedCalls()).toHaveLength(2);
    expect(firstMoveCalls()).toHaveLength(1);
  }, 20_000);

  it("reports the chip actually clicked last, not the first one", () => {
    const composer = renderSidebar();

    // A blocked task, so the opener offers S05's chips. Clicking a second one must
    // replace the seed, not leave the first one attributed.
    fireEvent.click(screen.getByRole("button", { name: "What is blocking tasks?" }));
    fireEvent.click(screen.getByRole("button", { name: "Which tasks are at risk?" }));
    fireEvent.keyDown(composer, { key: "Enter" });

    expect(firstMoveCalls()).toHaveLength(1);
    expect(firstMoveCalls()[0][1]).toMatchObject({
      entry: "chip",
      chip_key: "ai.sidebar.suggestion.nextRiskyTasks",
    });
  });

  it("carries the opener's identity on the first move it produced", () => {
    const composer = renderSidebar();

    fireEvent.click(screen.getByRole("button", { name: "Which tasks are at risk?" }));
    fireEvent.keyDown(composer, { key: "Enter" });

    const payload = firstMoveCalls()[0][1] as Record<string, unknown>;
    expect(payload.opener_shown_id).toEqual(expect.any(String));
    expect(payload.opener_level).toBe("l0");
  });

  it("does not count a show on a project whose thread was restored from storage", () => {
    // A UUID project id, because only those persist a transcript.
    const restoredId = "11111111-2222-4333-8444-555555555555";
    addProject({
      id: restoredId,
      owner_id: ownerProfileId,
      title: "Restored",
      type: "residential",
      automation_level: "assisted",
      current_stage_id: "",
      progress_pct: 0,
    });
    addMember({
      project_id: restoredId,
      user_id: ownerProfileId,
      role: "owner",
      ai_access: "project_pool",
      credit_limit: 500,
      used_credits: 0,
    });
    localStorage.setItem(
      `rovno:ai-transcript:v1:${restoredId}`,
      JSON.stringify({
        version: 1,
        updatedAt: Date.now(),
        messages: [
          { id: "m1", role: "user", content: "earlier question", timestamp: new Date().toISOString() },
        ],
      }),
    );

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[`/project/${restoredId}/dashboard`]}>
          <AISidebar collapsed={false} onCollapsedChange={vi.fn()} />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    // Positive first, so the assertions below cannot pass by the sidebar simply
    // not rendering: the restored message must actually be on screen.
    expect(screen.getByText("earlier question")).toBeInTheDocument();

    // The block was never on screen, so it must not be recorded as shown: doing so
    // burns the L0 days unread and walks the user to a permanent L2.
    expect(trackEventMock.mock.calls.filter(([name]) => name === "ai_opener_shown")).toHaveLength(0);
    expect(localStorage.getItem("ai-opener-state:anonymous")).toBeNull();
  });

  it("shows the opener instead of the static chip row, never both", () => {
    renderSidebar();

    // "Generate contract" belongs to the static row and to no S01 chip set, so it
    // is a witness for that row being on screen.
    expect(screen.queryByRole("button", { name: "Generate contract" })).toBeNull();
    expect(screen.getByRole("button", { name: "What is blocking tasks?" })).toBeInTheDocument();
  });
});
