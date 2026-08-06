import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useNavigate } from "react-router-dom";

/**
 * rovno#227: covers the `runQueueExecution` emission point, which the pure
 * `resolveProposalExecutionAnalytics` test cannot reach — it pins the DECISION,
 * not the CALL SITE (the payload, the attempt count, and that exactly one event
 * is emitted per confirmed item).
 *
 * This lives in its OWN file on purpose. `scopedSidebarStateByKey`
 * (AISidebar.tsx) is a module-level Map that is never reset between tests, and
 * the unmount effect saves the departing sidebar's state — including a proposal
 * queue left in review — under its scope key. Appending these cases to
 * AISidebar.assistant-paths.test.tsx makes the sidebar remount straight into
 * that leftover queue, so the composer is never rendered. Vitest isolates the
 * module registry per FILE, which is what keeps this one clean.
 */

const { trackEventMock } = vi.hoisted(() => ({ trackEventMock: vi.fn() }));

vi.mock("@/lib/analytics", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/analytics")>();
  return { ...actual, trackEvent: (...args: unknown[]) => trackEventMock(...args) };
});

import { AISidebar } from "@/components/AISidebar";
import { __unsafeResetStoreForTests, addMember, addProject } from "@/data/store";
import { clearDemoSession, clearStoredAuthProfile, setAuthRole, setStoredAuthProfile } from "@/lib/auth-state";

function setupOwnerWithProject() {
  setAuthRole("guest");
  clearStoredAuthProfile();
  clearDemoSession();
  const profile = setStoredAuthProfile({ email: "owner@example.com", name: "Owner User" });
  setAuthRole("owner");
  __unsafeResetStoreForTests();
  addProject({
    id: "project-a", owner_id: profile.id, title: "Project A", type: "residential",
    automation_level: "assisted", current_stage_id: "", progress_pct: 0,
  });
  addMember({
    project_id: "project-a", user_id: profile.id, role: "owner",
    ai_access: "project_pool", credit_limit: 500, used_credits: 0,
  });
  addProject({
    id: "project-b", owner_id: profile.id, title: "Project B", type: "residential",
    automation_level: "assisted", current_stage_id: "", progress_pct: 0,
  });
  addMember({
    project_id: "project-b", user_id: profile.id, role: "owner",
    ai_access: "project_pool", credit_limit: 500, used_credits: 0,
  });
}

/** Lets a test change the route, which is what changes the sidebar's scope key. */
function ScopeSwitcher() {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => navigate("/project/project-b/dashboard")}>
      GO_TO_B
    </button>
  );
}

type Emitted = { event: string; payload: Record<string, unknown> };

/**
 * Sends `prompt`, confirms every proposal in the queue, drains the retry loop,
 * and returns the ai_proposal_* events in emission order.
 *
 * `randomValue` stubs the loop's `Math.random() < 0.15` simulated failure:
 * 0.99 = never fails, 0 = always fails (drives the 5-attempt exhaustion path).
 */
async function runQueue(prompt: string, randomValue: number): Promise<Emitted[]> {
  vi.spyOn(Math, "random").mockReturnValue(randomValue);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/project/project-a/dashboard"]}>
        <AISidebar collapsed={false} onCollapsedChange={vi.fn()} />
      </MemoryRouter>
    </QueryClientProvider>,
  );

  const composer = screen.getByPlaceholderText("Ask AI...");
  fireEvent.change(composer, { target: { value: prompt } });
  fireEvent.keyDown(composer, { key: "Enter" });
  // WORK_STEPS_GENERATE delay before the queue appears.
  await act(async () => { vi.advanceTimersByTime(4000); });

  // One click per queue item; the card advances to the next item each time and
  // disappears once execution starts.
  for (let i = 0; i < 12; i++) {
    const confirm = screen.queryByRole("button", { name: /Confirm/i });
    if (!confirm) break;
    fireEvent.click(confirm);
    await act(async () => { vi.advanceTimersByTime(0); });
  }

  // Drain: worst case is 5 attempts x (WORK_STEPS_COMMIT 3800ms + 500ms retry
  // wait) per item. 300s of fake time is comfortably past that for 3 items.
  for (let i = 0; i < 300; i++) {
    await act(async () => { vi.advanceTimersByTime(1000); });
  }

  return trackEventMock.mock.calls
    .filter((call) => String(call[0]).startsWith("ai_proposal"))
    .map((call) => ({ event: String(call[0]), payload: call[1] as Record<string, unknown> }));
}

describe("AISidebar proposal queue execution analytics (rovno#227)", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    trackEventMock.mockClear();
    vi.useFakeTimers();
    setupOwnerWithProject();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("emits applied for the item that lands and unavailable for each type that fails closed", async () => {
    // Three proposals from one prompt: add_task (applicable), update_estimate
    // and add_procurement (both fail closed in resolveProposalFastFail).
    const events = await runQueue("add task, update estimate, and buy materials", 0.99);

    expect(events.map((e) => e.event)).toEqual([
      "ai_proposal_confirmed",
      "ai_proposal_confirmed",
      "ai_proposal_confirmed",
      "ai_proposal_applied",
      "ai_proposal_unavailable",
      "ai_proposal_unavailable",
    ]);

    const applied = events.filter((e) => e.event === "ai_proposal_applied");
    expect(applied).toHaveLength(1);
    expect(applied[0].payload).toMatchObject({
      project_id: "project-a",
      surface: "ai",
      proposal_type: "add_task",
      // The item succeeded on its first attempt, not the literal 5 the old
      // failure event recorded.
      attempts: 1,
    });
    // `reason` belongs to the unavailable event only; the conditional spread
    // must not leak an undefined key onto applied.
    expect(applied[0].payload).not.toHaveProperty("reason");

    const unavailable = events.filter((e) => e.event === "ai_proposal_unavailable");
    expect(unavailable).toHaveLength(2);
    for (const event of unavailable) {
      expect(event.payload).toMatchObject({
        project_id: "project-a",
        surface: "ai",
        reason: "unsupported_proposal_type",
        // A fast-fail never enters the retry loop.
        attempts: 0,
      });
    }
    expect(unavailable.map((e) => e.payload.proposal_type).sort())
      .toEqual(["add_procurement", "update_estimate"]);

    // One terminal event per confirmed item, and the proposal ids line up.
    const confirmedIds = events
      .filter((e) => e.event === "ai_proposal_confirmed")
      .map((e) => e.payload.proposal_id);
    const terminalIds = events
      .filter((e) => e.event !== "ai_proposal_confirmed")
      .map((e) => e.payload.proposal_id);
    expect([...terminalIds].sort()).toEqual([...confirmedIds].sort());
  });

  it("carries an in-flight run across a scope change: the second queue still runs and the first does not wipe it", async () => {
    // rovno#227 audit, findings 1 and 2 together, because they only co-occur.
    // (1) beginQueueExecution used to early-return while a run was in flight,
    //     DROPPING the second queue: each further Confirm emitted
    //     ai_proposal_confirmed and no terminal event ever followed, which
    //     breaks the subtraction this issue ships.
    // (2) the in-flight run's tail writes were unscoped, so they landed in
    //     whatever project was on screen and wiped ITS queue mid-review.
    // The composer is replaced by the work-log window while a queue executes,
    // so the only way to confirm a second queue mid-run is from another scope --
    // which is exactly the reported scenario.
    // Project A's item is forced to FAIL every attempt, so its run occupies the
    // full 5-attempt retry loop (~21s of fake time). That is what keeps
    // executingQueueRef set while we move to B and confirm there; with A
    // succeeding immediately the run finishes during B's own send and the
    // pending path is never exercised at all -- which is how the first version
    // of this test passed against the unfixed code.
    const randomMock = vi.spyOn(Math, "random").mockReturnValue(0);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/project/project-a/dashboard"]}>
          <ScopeSwitcher />
          <AISidebar collapsed={false} onCollapsedChange={vi.fn()} />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const confirmAll = async () => {
      for (let i = 0; i < 12; i++) {
        const confirm = screen.queryByRole("button", { name: /^Confirm$/i });
        if (!confirm) break;
        fireEvent.click(confirm);
        await act(async () => { vi.advanceTimersByTime(0); });
      }
    };
    const send = async (prompt: string) => {
      const composer = screen.getByPlaceholderText("Ask AI...");
      fireEvent.change(composer, { target: { value: prompt } });
      fireEvent.keyDown(composer, { key: "Enter" });
      await act(async () => { vi.advanceTimersByTime(4000); });
    };

    // Project A: confirm, then step only part way in, so the run is genuinely
    // in flight when we leave.
    await send("add task for rough-in");
    await confirmAll();
    await act(async () => { vi.advanceTimersByTime(500); });

    // Leave for project B while A is still executing, and confirm a queue there.
    fireEvent.click(screen.getByText("GO_TO_B"));
    await act(async () => { vi.advanceTimersByTime(0); });
    await send("add task for wiring");
    // Finding 2: A's tail must not have wiped B's queue before we can confirm it.
    expect(screen.queryByRole("button", { name: /^Confirm$/i })).not.toBeNull();
    await confirmAll();
    // B is now QUEUED behind A's still-running retry loop. Let B succeed once it
    // finally gets its turn, so its outcome is distinguishable from A's.
    randomMock.mockReturnValue(0.99);

    for (let i = 0; i < 300; i++) {
      await act(async () => { vi.advanceTimersByTime(1000); });
    }

    const events = trackEventMock.mock.calls
      .filter((call) => String(call[0]).startsWith("ai_proposal"))
      .map((call) => ({ event: String(call[0]), payload: call[1] as Record<string, unknown> }));
    const confirmed = events.filter((e) => e.event === "ai_proposal_confirmed");
    const terminal = events.filter((e) => e.event !== "ai_proposal_confirmed");

    // The scope change really happened: both projects confirmed something.
    expect(new Set(confirmed.map((e) => e.payload.project_id)))
      .toEqual(new Set(["project-a", "project-b"]));

    // Finding 1, the load-bearing assertion. B was confirmed while A's run was
    // still in flight. Before the fix that queue was DROPPED: B emitted
    // ai_proposal_confirmed and never terminated, so
    // `confirmed - applied - unavailable` counted a phantom.
    const confirmedB = confirmed.filter((e) => e.payload.project_id === "project-b");
    expect(confirmedB.length).toBeGreaterThan(0);
    const terminalB = terminal.filter((e) => e.payload.project_id === "project-b");
    expect(terminalB.map((e) => e.event)).toEqual(confirmedB.map(() => "ai_proposal_applied"));

    // And the invariant the subtraction rests on, across both scopes: every
    // confirmed proposal reached a terminal event. This is the assertion that
    // fails when the second queue is dropped instead of queued.
    expect([...terminal.map((e) => e.payload.proposal_id)].sort())
      .toEqual([...confirmed.map((e) => e.payload.proposal_id)].sort());
  });

  it("emits NOTHING terminal when the retries are exhausted, leaving it derivable by subtraction", async () => {
    const events = await runQueue("add task for rough-in", 0);

    expect(events.map((e) => e.event)).toEqual(["ai_proposal_confirmed"]);
    expect(events.filter((e) => e.event === "ai_proposal_applied")).toHaveLength(0);
    expect(events.filter((e) => e.event === "ai_proposal_unavailable")).toHaveLength(0);
  });
});
