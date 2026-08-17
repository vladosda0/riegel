import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { AISidebar } from "@/components/AISidebar";
import { __unsafeResetStoreForTests, addMember, addProject } from "@/data/store";
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
  });

  it("attributes an unedited chip send to that chip", () => {
    const composer = renderSidebar();

    fireEvent.click(screen.getByRole("button", { name: "Add tasks" }));
    fireEvent.keyDown(composer, { key: "Enter" });

    expect(firstMoveCalls()).toHaveLength(1);
    expect(firstMoveCalls()[0][1]).toMatchObject({
      entry: "chip",
      chip_key: "ai.sidebar.suggestion.addTasks",
    });
  });

  it("counts an edited chip as manual and drops the key", () => {
    const composer = renderSidebar();

    fireEvent.click(screen.getByRole("button", { name: "Add tasks" }));
    fireEvent.change(composer, { target: { value: "Add tasks for the bathroom" } });
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

    // Guards the index-to-key mapping: the key is recovered by position in the
    // key list, so a chip other than the first one is what catches a misaligned
    // or reordered list.
    fireEvent.click(screen.getByRole("button", { name: "Add tasks" }));
    fireEvent.click(screen.getByRole("button", { name: "Buy materials" }));
    fireEvent.keyDown(composer, { key: "Enter" });

    expect(firstMoveCalls()).toHaveLength(1);
    expect(firstMoveCalls()[0][1]).toMatchObject({
      entry: "chip",
      chip_key: "ai.sidebar.suggestion.buyMaterials",
    });
  });
});
