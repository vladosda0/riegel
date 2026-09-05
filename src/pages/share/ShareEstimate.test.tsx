import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import ShareEstimate from "@/pages/share/ShareEstimate";
import {
  approveVersion,
  createLine,
  createVersionSnapshot,
  getEstimateV2ProjectState,
  submitVersion,
  updateEstimateV2Project,
} from "@/data/estimate-v2-store";
import { clearDemoSession, enterDemoSession, setAuthRole } from "@/lib/auth-state";
import { __unsafeResetRuntimeAuthForTests } from "@/hooks/use-runtime-auth";
import { authenticateRuntimeAuth, guestRuntimeAuth, loadingRuntimeAuth } from "@/test/runtime-auth";

let shareScenarioCounter = 0;

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>;
}

function renderSharePage(shareId: string) {
  // ShareEstimate now consumes React Query (useEstimateV2Share + manual
  // invalidation after approve). Each test gets a fresh client with retries
  // disabled so the Supabase RPC failure path in jsdom does not flake.
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/share/estimate/${shareId}`]}>
        <Routes>
          <Route path="/share/estimate/:shareId" element={<ShareEstimate />} />
          <Route path="*" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function money(cents: number, currency: string): string {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

function createSubmittedShareVersion(
  projectMode: "contractor" | "build_myself" = "contractor",
  options?: Parameters<typeof submitVersion>[2],
): { shareId: string; versionId: string; lineTitle: string; expectedClientTotal: string } {
  const projectId = "project-1";
  setAuthRole("owner");
  updateEstimateV2Project(projectId, { projectMode });
  const state = getEstimateV2ProjectState(projectId);
  const stage = state.stages[0];
  const work = state.works[0];
  expect(stage).toBeDefined();
  expect(work).toBeDefined();
  if (!stage || !work) {
    throw new Error("Missing seeded stage/work for share estimate test");
  }
  shareScenarioCounter += 1;
  const lineTitle = `Mode-sensitive line (${projectMode}) #${shareScenarioCounter}`;
  const line = createLine(projectId, {
    stageId: stage.id,
    workId: work.id,
    title: lineTitle,
    type: "material",
    unit: "service",
    qtyMilli: 1_000,
    costUnitCents: 10_000,
    markupBps: 2_000,
    discountBpsOverride: 500,
  });
  expect(line).toBeTruthy();
  const created = createVersionSnapshot(projectId, "user-1");
  const ok = submitVersion(projectId, created.versionId, options);
  expect(ok).toBe(true);
  return {
    shareId: created.shareId,
    versionId: created.versionId,
    lineTitle,
    expectedClientTotal: money(projectMode === "contractor" ? 11_400 : 9_500, "RUB"),
  };
}

beforeEach(() => {
  clearDemoSession();
  enterDemoSession("project-1");
  setAuthRole("owner");
  guestRuntimeAuth();
});

describe("ShareEstimate approval access", () => {
  afterEach(() => {
    clearDemoSession();
    setAuthRole("owner");
    __unsafeResetRuntimeAuthForTests();
  });

  it("follows the real session over a conflicting simulated role", () => {
    const { shareId } = createSubmittedShareVersion();
    // The simulated role says "owner" (beforeEach) while the real session says
    // guest. The page must follow the session.

    renderSharePage(shareId);

    expect(screen.getByRole("button", { name: "Register to approve" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
  });

  it("sends the guest to signup with the share link as the return path", () => {
    const { shareId } = createSubmittedShareVersion();

    renderSharePage(shareId);
    fireEvent.click(screen.getByRole("button", { name: "Register to approve" }));

    expect(screen.getByTestId("location")).toHaveTextContent(
      `/auth/signup?next=${encodeURIComponent(`/share/estimate/${shareId}`)}`,
    );
  });

  it("shows register prompt for guests while keeping preview visible", () => {
    const { shareId } = createSubmittedShareVersion();
    setAuthRole("guest");

    renderSharePage(shareId);

    expect(screen.getByText("Estimate preview")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Register to approve" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
  });

  it("allows registered users to approve when policy is registered", () => {
    const { shareId } = createSubmittedShareVersion("contractor");
    setAuthRole("owner");
    authenticateRuntimeAuth();

    renderSharePage(shareId);

    expect(screen.getByRole("button", { name: "Approve" })).toBeInTheDocument();
  });

  it("blocks approval when submission policy is preview-only", () => {
    const { shareId } = createSubmittedShareVersion("contractor", {
      shareApprovalPolicy: "disabled",
      shareApprovalDisabledReason: "no_participant_slot",
    });
    setAuthRole("owner");
    authenticateRuntimeAuth();

    renderSharePage(shareId);

    expect(
      screen.getByText("Approval is unavailable until project owner upgrades plan and adds client as participant."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
  });

  it("holds the approval slot with a placeholder while the session is still resolving", () => {
    const { shareId } = createSubmittedShareVersion();
    loadingRuntimeAuth();

    renderSharePage(shareId);

    // Neither boolean is true at "loading", so without the placeholder the card
    // renders its heading over an empty row and the client sees no call to action.
    expect(screen.getByTestId("approval-action-pending")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Register to approve" })).not.toBeInTheDocument();
  });

  it("replaces the placeholder with the real action once the session resolves", () => {
    const { shareId } = createSubmittedShareVersion("contractor");
    setAuthRole("owner");
    loadingRuntimeAuth();

    renderSharePage(shareId);
    expect(screen.getByTestId("approval-action-pending")).toBeInTheDocument();

    act(() => authenticateRuntimeAuth());

    expect(screen.queryByTestId("approval-action-pending")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve" })).toBeInTheDocument();
  });

  it("shows no placeholder while loading on a version that is already approved", () => {
    const { shareId, versionId } = createSubmittedShareVersion("contractor");
    expect(
      approveVersion("project-1", versionId, {
        name: "Ivan",
        surname: "Petrov",
        email: "ivan@example.com",
        timestamp: new Date("2026-09-01T00:00:00Z").toISOString(),
      }),
    ).toBe(true);
    loadingRuntimeAuth();

    renderSharePage(shareId);

    // Anchor the render: without this the absence below would also hold for a
    // page that never got past its early returns.
    expect(screen.getByRole("button", { name: "Ask questions (coming soon)" })).toBeInTheDocument();
    // approvalEligible is already false, so no action is coming here either.
    expect(screen.queryByTestId("approval-action-pending")).not.toBeInTheDocument();
  });

  it("shows no placeholder while loading when the policy will never offer an action", () => {
    const { shareId } = createSubmittedShareVersion("contractor", {
      shareApprovalPolicy: "disabled",
      shareApprovalDisabledReason: "no_participant_slot",
    });
    loadingRuntimeAuth();

    renderSharePage(shareId);

    // A placeholder promises an action that is coming. Under a disabled policy
    // none ever arrives, so the promise would be a lie.
    expect(screen.queryByTestId("approval-action-pending")).not.toBeInTheDocument();
  });

  it("offers the question button as disabled, because nothing carries the question yet", () => {
    const { shareId } = createSubmittedShareVersion();
    authenticateRuntimeAuth();

    renderSharePage(shareId);

    const button = screen.getByRole("button", { name: "Ask questions (coming soon)" });
    expect(button).toBeInTheDocument();
    expect(button).toBeDisabled();
  });

  it("uses contractor project mode for shared estimate pricing", () => {
    const { shareId, lineTitle, expectedClientTotal } = createSubmittedShareVersion("contractor");

    renderSharePage(shareId);

    const row = screen.getByText(lineTitle).closest("tr");
    expect(row).not.toBeNull();
    expect(row?.textContent?.replace(/\s/g, "")).toContain(expectedClientTotal.replace(/\s/g, ""));
  });

  it("uses build_myself project mode for shared estimate pricing while keeping discounts", () => {
    const { shareId, lineTitle, expectedClientTotal } = createSubmittedShareVersion("build_myself");

    renderSharePage(shareId);

    const row = screen.getByText(lineTitle).closest("tr");
    expect(row).not.toBeNull();
    expect(row?.textContent?.replace(/\s/g, "")).toContain(expectedClientTotal.replace(/\s/g, ""));
  });
});
