import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import ProjectEstimate from "@/pages/project/ProjectEstimate";
import { __unsafeResetStoreForTests, addMember, addProject, addTask, updateTask } from "@/data/store";
import {
  __unsafeSetEstimateOperationalUpperBlockForTests,
  __unsafeResetEstimateV2ForTests,
  createLine,
  createStage,
  createWork,
  getEstimateV2ProjectState,
  setProjectEstimateStatus,
  updateEstimateV2Project,
  updateLine,
} from "@/data/estimate-v2-store";
import { __unsafeResetHrForTests } from "@/data/hr-store";
import { createDraftOrder, placeOrder, receiveOrder, __unsafeResetOrdersForTests } from "@/data/order-store";
import { __unsafeResetInventoryForTests } from "@/data/inventory-store";
import { getProcurementItems } from "@/data/procurement-store";
import { computeProjectTotals } from "@/lib/estimate-v2/pricing";
import * as workspaceSource from "@/data/workspace-source";
import {
  clearDemoSession,
  clearStoredAuthProfile,
  enterDemoSession,
  setAuthRole,
  setStoredAuthProfile,
} from "@/lib/auth-state";

const navigateMock = vi.fn();

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

vi.mock("@/components/ui/select", async () => {
  const React = await import("react");

  interface SelectContextValue {
    value?: string;
    onValueChange?: (value: string) => void;
    disabled?: boolean;
  }

  const SelectContext = React.createContext<SelectContextValue | null>(null);

  function Select({
    value,
    onValueChange,
    disabled,
    children,
  }: {
    value?: string;
    onValueChange?: (value: string) => void;
    disabled?: boolean;
    children: React.ReactNode;
  }) {
    return (
      <SelectContext.Provider value={{ value, onValueChange, disabled }}>
        <div>{children}</div>
      </SelectContext.Provider>
    );
  }

  function SelectTrigger({ children, className }: { children: React.ReactNode; className?: string }) {
    const context = React.useContext(SelectContext);
    return (
      <button
        type="button"
        role="combobox"
        aria-expanded="false"
        disabled={context?.disabled}
        className={className}
      >
        {children}
      </button>
    );
  }

  function SelectValue({ placeholder }: { placeholder?: string }) {
    const context = React.useContext(SelectContext);
    return <span>{context?.value ?? placeholder ?? ""}</span>;
  }

  function SelectContent({ children }: { children: React.ReactNode }) {
    return <div>{children}</div>;
  }

  function SelectItem({ value, children }: { value: string; children: React.ReactNode }) {
    const context = React.useContext(SelectContext);
    return (
      <button
        type="button"
        role="option"
        aria-selected={context?.value === value}
        disabled={context?.disabled}
        onClick={() => context?.onValueChange?.(value)}
      >
        {children}
      </button>
    );
  }

  return {
    Select,
    SelectTrigger,
    SelectValue,
    SelectContent,
    SelectItem,
  };
});

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
}

async function flushUi() {
  await new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });
  await Promise.resolve();
  await new Promise<void>((resolve) => {
    window.setTimeout(() => resolve(), 0);
  });
  await new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });
}

async function changeEstimateStatus(nextStatus: string) {
  const actionName = nextStatus === "In work" ? "Start work"
    : nextStatus === "Finished" ? "Finish"
    : nextStatus === "Paused" ? "Pause"
    : nextStatus;
  fireEvent.click(screen.getByRole("button", { name: actionName }));
  await flushUi();
}

function renderProjectEstimate(projectId: string) {
  const queryClient = createQueryClient();

  return render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={0}>
        <MemoryRouter initialEntries={[`/project/${projectId}/estimate`]}>
          <Routes>
            <Route path="/project/:id/estimate" element={<ProjectEstimate />} />
            <Route path="/project/:id/tasks" element={<div>Tasks page</div>} />
          </Routes>
        </MemoryRouter>
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

function formatMoney(cents: number, currency: string) {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

function normalizeText(value: string | null | undefined) {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function byNormalizedText(expected: string) {
  return (_content: string, element: Element | null) => normalizeText(element?.textContent) === normalizeText(expected);
}

async function expectSelection(input: HTMLInputElement, value: string) {
  await flushUi();
  await waitFor(() => {
    expect(input).toHaveFocus();
  });
  expect(input.selectionStart).toBe(0);
  expect(input.selectionEnd).toBe(value.length);
}

function setupLocalProject(
  projectId: string,
  membershipOverrides: Partial<Parameters<typeof addMember>[0]> = {},
) {
  const profile = setStoredAuthProfile({
    email: `${projectId}@example.com`,
    name: "Owner User",
  });

  addProject({
    id: projectId,
    owner_id: profile.id,
    title: "Workspace Project",
    type: "residential",
    project_mode: "contractor",
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
    ...membershipOverrides,
  });
}

function setupLocalProjectWithoutMembership(projectId: string) {
  const profile = setStoredAuthProfile({
    email: `${projectId}@example.com`,
    name: "Owner User",
  });

  addProject({
    id: projectId,
    owner_id: profile.id,
    title: "Workspace Project",
    type: "residential",
    project_mode: "contractor",
    automation_level: "assisted",
    current_stage_id: "",
    progress_pct: 0,
  });
}

function seedEstimateLine(projectId: string) {
  const stage = createStage(projectId, { title: "Shell" });
  expect(stage).not.toBeNull();
  if (!stage) return null;

  const work = createWork(projectId, { stageId: stage.id, title: "Framing" });
  expect(work).not.toBeNull();
  if (!work) return null;

  const line = createLine(projectId, {
    stageId: stage.id,
    workId: work.id,
    title: "Concrete",
    type: "material",
    qtyMilli: 1_000,
    costUnitCents: 12_500,
  });

  expect(line).not.toBeNull();
  if (!line) return null;
  return { stage, work, line };
}

function getLinkedProcurementItem(projectId: string, lineId: string) {
  return getProcurementItems(projectId).find((item) => item.sourceEstimateV2LineId === lineId) ?? null;
}

function createPlacedSupplierOrderForLine(
  projectId: string,
  lineId: string,
  options: { qty: number; receivedQty?: number },
) {
  const procurementItem = getLinkedProcurementItem(projectId, lineId);
  expect(procurementItem).not.toBeNull();
  if (!procurementItem) return null;

  const draft = createDraftOrder({
    projectId,
    kind: "supplier",
    deliverToLocationId: `${projectId}-loc-site`,
    lines: [{
      procurementItemId: procurementItem.id,
      qty: options.qty,
      unit: procurementItem.unit,
      plannedUnitPrice: procurementItem.plannedUnitPrice ?? 0,
      actualUnitPrice: procurementItem.actualUnitPrice ?? procurementItem.plannedUnitPrice ?? 0,
    }],
  });

  const placed = placeOrder(draft.id);
  expect(placed.ok).toBe(true);

  if ((options.receivedQty ?? 0) > 0) {
    const orderLineId = draft.lines[0]?.id;
    expect(orderLineId).toBeTruthy();
    if (orderLineId) {
      const received = receiveOrder(draft.id, {
        locationId: `${projectId}-loc-site`,
        lines: [{ lineId: orderLineId, qty: options.receivedQty ?? 0 }],
      });
      expect(received.ok).toBe(true);
    }
  }

  return procurementItem;
}

describe("ProjectEstimate", () => {
  beforeEach(() => {
    class MockPointerEvent extends MouseEvent {
      pointerType: string;

      isPrimary: boolean;

      constructor(type: string, params: MouseEventInit & { pointerType?: string; isPrimary?: boolean } = {}) {
        super(type, params);
        this.pointerType = params.pointerType ?? "mouse";
        this.isPrimary = params.isPrimary ?? true;
      }
    }

    Object.defineProperty(window, "PointerEvent", {
      configurable: true,
      writable: true,
      value: MockPointerEvent,
    });
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      writable: true,
      value: () => {},
    });
    Object.defineProperty(HTMLElement.prototype, "hasPointerCapture", {
      configurable: true,
      writable: true,
      value: () => false,
    });
    Object.defineProperty(HTMLElement.prototype, "setPointerCapture", {
      configurable: true,
      writable: true,
      value: () => {},
    });
    Object.defineProperty(HTMLElement.prototype, "releasePointerCapture", {
      configurable: true,
      writable: true,
      value: () => {},
    });

    localStorage.clear();
    sessionStorage.clear();
    navigateMock.mockReset();
    clearDemoSession();
    clearStoredAuthProfile();
    setAuthRole("owner");
    __unsafeResetStoreForTests();
    __unsafeResetEstimateV2ForTests();
    __unsafeResetOrdersForTests();
    __unsafeResetInventoryForTests();
    __unsafeResetHrForTests();
  });

  afterEach(() => {
    clearDemoSession();
    clearStoredAuthProfile();
    setAuthRole("owner");
    vi.restoreAllMocks();
  });

  it("shows the empty estimate intro and immediately edits new stage, work and resource titles", async () => {
    const projectId = "project-estimate-empty-ui";
    setupLocalProject(projectId);

    await act(async () => {
      renderProjectEstimate(projectId);
      await flushUi();
    });

    expect(screen.getByText("No estimate created yet")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add work" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add resource" })).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Create estimate" }));
      await flushUi();
    });

    expect(screen.getByText("No stages yet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add stage" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add work" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add resource" })).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Add stage" }));
      await flushUi();
    });

    const stageInput = screen.getByDisplayValue("Add stage") as HTMLInputElement;
    await expectSelection(stageInput, "Add stage");
    await act(async () => {
      fireEvent.change(stageInput, { target: { value: "Shell" } });
      fireEvent.keyDown(stageInput, { key: "Enter" });
      await flushUi();
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Shell" })).toBeInTheDocument();
    }, { timeout: 10_000 });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Add work" }));
      await flushUi();
    });

    const workInput = screen.getByDisplayValue("Add work") as HTMLInputElement;
    await expectSelection(workInput, "Add work");
    await act(async () => {
      fireEvent.change(workInput, { target: { value: "Framing" } });
      fireEvent.keyDown(workInput, { key: "Enter" });
      await flushUi();
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Framing" })).toBeInTheDocument();
    }, { timeout: 10_000 });

    await act(async () => {
      fireEvent.pointerDown(screen.getByRole("button", { name: "Add resource" }));
      await flushUi();
    });

    await act(async () => {
      fireEvent.click(await screen.findByRole("menuitem", { name: "Material" }, { timeout: 10_000 }));
      await flushUi();
    });

    const resourceInput = screen.getByDisplayValue("Material 1") as HTMLInputElement;
    await expectSelection(resourceInput, "Material 1");
    expect(screen.getByRole("button", { name: "Add resource" })).not.toHaveFocus();

    const createdState = getEstimateV2ProjectState(projectId);
    expect(createdState.lines.some((line) => line.title === "Material 1" && line.type === "material")).toBe(true);

    expect(screen.queryByText("Stage 1")).not.toBeInTheDocument();
    expect(screen.queryByText("General work")).not.toBeInTheDocument();
  }, 20_000);

  it("renders the estimate header status rail and tab-row actions", async () => {
    const projectId = "project-estimate-header-rail";
    setupLocalProject(projectId);

    await act(async () => {
      renderProjectEstimate(projectId);
      await flushUi();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Create estimate" }));
      await flushUi();
    });

    expect(screen.getByText("Planning")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start work" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Finish" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export estimate" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Constructor" })).toBeInTheDocument();
  });

  it("numbers default resource names per work instead of across the whole estimate", async () => {
    const projectId = "project-estimate-resource-naming-scope";
    setupLocalProject(projectId);

    const stage = createStage(projectId, { title: "Shell" });
    expect(stage).not.toBeNull();
    if (!stage) return;

    const firstWork = createWork(projectId, { stageId: stage.id, title: "Framing" });
    const secondWork = createWork(projectId, { stageId: stage.id, title: "Roof" });
    expect(firstWork).not.toBeNull();
    expect(secondWork).not.toBeNull();
    if (!firstWork || !secondWork) return;

    createLine(projectId, {
      stageId: stage.id,
      workId: firstWork.id,
      title: "Material 1",
      type: "material",
      qtyMilli: 1_000,
      costUnitCents: 0,
    });

    await act(async () => {
      renderProjectEstimate(projectId);
      await flushUi();
    });

    const addResourceButtons = screen.getAllByRole("button", { name: "Add resource" });
    expect(addResourceButtons).toHaveLength(2);

    await act(async () => {
      fireEvent.pointerDown(addResourceButtons[1]);
      await flushUi();
    });

    await act(async () => {
      fireEvent.click(await screen.findByRole("menuitem", { name: "Material" }, { timeout: 10_000 }));
      await flushUi();
    });

    const resourceInput = screen.getByDisplayValue("Material 1") as HTMLInputElement;
    await expectSelection(resourceInput, "Material 1");

    const state = getEstimateV2ProjectState(projectId);
    const roofLine = state.lines.find((line) => line.workId === secondWork.id && line.title === "Material 1");
    expect(roofLine).toBeDefined();
  }, 20_000);

  it("opens the estimate immediately when seeded estimate resource lines already exist", async () => {
    const projectId = "project-estimate-seeded-lines";
    setupLocalProject(projectId);
    const seeded = seedEstimateLine(projectId);
    expect(seeded).not.toBeNull();

    await act(async () => {
      renderProjectEstimate(projectId);
      await flushUi();
    });

    expect(screen.queryByText("No estimate created yet")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Shell" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Framing" })).toBeInTheDocument();
  });

  it("opens the estimate workspace when a saved stage already exists", async () => {
    const projectId = "project-estimate-stage-only";
    setupLocalProject(projectId);
    const stage = createStage(projectId, { title: "Shell" });
    expect(stage).not.toBeNull();

    await act(async () => {
      renderProjectEstimate(projectId);
      await flushUi();
    });

    expect(screen.queryByText("No estimate created yet")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Shell" })).toBeInTheDocument();
  });

  it("adds a second work to an existing stage without crashing the page", async () => {
    const projectId = "project-estimate-second-work";
    setupLocalProject(projectId);
    const stage = createStage(projectId, { title: "Shell" });
    expect(stage).not.toBeNull();
    if (!stage) return;

    const firstWork = createWork(projectId, { stageId: stage.id, title: "Framing" });
    expect(firstWork).not.toBeNull();

    await act(async () => {
      renderProjectEstimate(projectId);
      await flushUi();
    });

    expect(screen.getByRole("button", { name: "Framing" })).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Add work" }));
      await flushUi();
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Framing" })).toBeInTheDocument();
      expect(screen.getByDisplayValue("Add work")).toBeInTheDocument();
      expect(screen.getAllByRole("button", { name: "Add resource" })).toHaveLength(2);
    });
  });

  it("shows missing work dates as the only in-work blocker and lets the user skip setup", async () => {
    const projectId = "project-estimate-missing-dates";
    setupLocalProject(projectId);
    const stage = createStage(projectId, { title: "Shell" });
    expect(stage).not.toBeNull();
    if (!stage) return;

    const work = createWork(projectId, { stageId: stage.id, title: "Framing" });
    expect(work).not.toBeNull();

    await act(async () => {
      renderProjectEstimate(projectId);
      await flushUi();
    });

    await act(async () => {
      await changeEstimateStatus("In work");
    });

    expect(screen.getByText("Missing work dates")).toBeInTheDocument();
    const missingDatesDialog = screen.getByRole("alertdialog", { name: "Missing work dates" });
    expect(within(missingDatesDialog).getByText("Framing")).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Skip setup" }));
      await flushUi();
    });

    await waitFor(() => {
      expect(getEstimateV2ProjectState(projectId).project.estimateStatus).toBe("in_work");
    });
    expect(getEstimateV2ProjectState(projectId).works[0]?.plannedStart).toBeTruthy();
    expect(getEstimateV2ProjectState(projectId).works[0]?.plannedEnd).toBeTruthy();
  });

  it("opens tasks from Work log while estimate is still planning", async () => {
    const projectId = "project-estimate-worklog-planning";
    setupLocalProject(projectId);

    await act(async () => {
      renderProjectEstimate(projectId);
      await flushUi();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Create estimate" }));
      await flushUi();
    });

    const workLogTab = screen.getByRole("tab", { name: "Work log" });
    expect(workLogTab).toBeEnabled();

    fireEvent.pointerDown(workLogTab);
    fireEvent.click(workLogTab);
    fireEvent.keyDown(workLogTab, { key: "Enter", code: "Enter" });

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalled();
    });
    const [firstCall] = navigateMock.mock.calls;
    expect(firstCall?.[0]).toBe(`/project/${projectId}/tasks`);
  });

  it("keeps the finance details accordion collapsed by default in work mode, with margin always visible", async () => {
    const projectId = "project-estimate-in-work-ui";
    setupLocalProject(projectId);
    const seeded = seedEstimateLine(projectId);
    expect(seeded).not.toBeNull();

    const statusResult = setProjectEstimateStatus(projectId, "in_work", { skipSetup: true });
    expect(statusResult.ok).toBe(true);

    await act(async () => {
      renderProjectEstimate(projectId);
      await flushUi();
    });

    // Revenue and margin are visible in the KPI strip without expanding details.
    expect(screen.getByText("Revenue (ex VAT)")).toBeInTheDocument();
    expect(screen.getByText("Margin %")).toBeInTheDocument();

    // Commercial detail lives behind a single "Details" accordion, collapsed by default.
    const detailsTrigger = screen.getByRole("button", { name: /Details/i });
    expect(detailsTrigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Subtotal (ex VAT)")).not.toBeInTheDocument();
    expect(screen.queryByText("VAT amount")).not.toBeInTheDocument();
    expect(screen.queryByText("To be paid")).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.click(detailsTrigger);
      await flushUi();
    });

    expect(detailsTrigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Subtotal (ex VAT)")).toBeInTheDocument();
    expect(screen.getByText("VAT amount")).toBeInTheDocument();
    expect(screen.getByText("To be paid")).toBeInTheDocument();
  });

  it("redacts internal financial detail for non-detail viewers while keeping client totals", async () => {
    const projectId = "project-estimate-redacted-finance";
    setupLocalProject(projectId, { finance_visibility: "summary" });
    const seeded = seedEstimateLine(projectId);
    expect(seeded).not.toBeNull();
    if (!seeded?.line) return;

    updateLine(projectId, seeded.line.id, {
      type: "labor",
      assigneeName: "Alex Mason",
      assigneeEmail: "alex@example.com",
    });

    const statusResult = setProjectEstimateStatus(projectId, "in_work", { skipSetup: true });
    expect(statusResult.ok).toBe(true);
    setAuthRole("viewer");

    await act(async () => {
      renderProjectEstimate(projectId);
      await flushUi();
    });

    expect(screen.queryByRole("button", { name: /Detailed cost overview/i })).not.toBeInTheDocument();
    expect(screen.queryByText("Financial breakdown")).not.toBeInTheDocument();
    expect(screen.queryByText("Plan vs actual")).not.toBeInTheDocument();
    expect(screen.queryByText("Cost unit")).not.toBeInTheDocument();
    expect(screen.queryByText("Cost total")).not.toBeInTheDocument();
    expect(screen.queryByText("Markup %")).not.toBeInTheDocument();
    expect(screen.queryByText("Discount %")).not.toBeInTheDocument();
    expect(screen.queryByText("Total cost")).not.toBeInTheDocument();
    expect(screen.getByText("Client total")).toBeInTheDocument();
    expect(screen.getByText("Alex Mason")).toBeInTheDocument();
  });

  it("keeps contractor estimate view redacted by default", async () => {
    const projectId = "project-estimate-contractor-redacted";
    setupLocalProject(projectId, { finance_visibility: "summary" });
    const seeded = seedEstimateLine(projectId);
    expect(seeded).not.toBeNull();
    if (!seeded?.line) return;

    updateLine(projectId, seeded.line.id, {
      costUnitCents: 14_000,
      markupBps: 1_500,
    });
    setAuthRole("contractor");

    await act(async () => {
      renderProjectEstimate(projectId);
      await flushUi();
    });

    expect(screen.queryByText("Cost unit")).not.toBeInTheDocument();
    expect(screen.queryByText("Cost total")).not.toBeInTheDocument();
    expect(screen.queryByText("Markup %")).not.toBeInTheDocument();
    expect(screen.getByText("Client unit")).toBeInTheDocument();
    expect(screen.getByText("Client total")).toBeInTheDocument();
  });

  it("uses fresh computed client pricing for build_myself summary managers holding live costs, even when stale summary cents are zero", async () => {
    const projectId = "project-estimate-build-myself-summary-editable-line";
    const profile = setStoredAuthProfile({
      email: `${projectId}@example.com`,
      name: "Co Owner User",
    });

    addProject({
      id: projectId,
      owner_id: "other-owner-id",
      title: "Workspace Project",
      type: "residential",
      project_mode: "build_myself",
      automation_level: "assisted",
      current_stage_id: "",
      progress_pct: 0,
    });

    addMember({
      project_id: projectId,
      user_id: profile.id,
      role: "co_owner",
      ai_access: "project_pool",
      credit_limit: 500,
      used_credits: 0,
      finance_visibility: "summary",
    });
    setAuthRole("co_owner");

    const seeded = seedEstimateLine(projectId);
    expect(seeded).not.toBeNull();
    if (!seeded?.line) return;

    updateEstimateV2Project(projectId, { projectMode: "build_myself" });
    updateLine(projectId, seeded.line.id, {
      qtyMilli: 2_000,
      discountBpsOverride: 0,
    });
    updateLine(projectId, seeded.line.id, {
      summaryClientUnitCents: 0,
      summaryClientTotalCents: 0,
    });

    const state = getEstimateV2ProjectState(projectId);
    const line = state.lines.find((item) => item.id === seeded.line.id);
    expect(line).toBeTruthy();
    if (!line) return;

    const computedTotals = computeProjectTotals(
      state.project,
      state.stages,
      state.works,
      state.lines,
      state.project.projectMode,
    );
    const expectedLineClientUnit = formatMoney(line.costUnitCents, state.project.currency);
    const expectedLineClientTotal = formatMoney(line.costUnitCents * 2, state.project.currency);

    await act(async () => {
      renderProjectEstimate(projectId);
      await flushUi();
    });

    const lineRow = screen.getByText(line.title).closest("tr");
    expect(lineRow).not.toBeNull();
    if (!lineRow) return;

    expect(within(lineRow).getByText(byNormalizedText(expectedLineClientUnit))).toBeInTheDocument();
    expect(within(lineRow).getByText(byNormalizedText(expectedLineClientTotal))).toBeInTheDocument();

    const footer = screen.getByText("Total across all stages").closest("div.rounded-lg");
    expect(footer).not.toBeNull();
    if (!(footer instanceof HTMLElement)) return;

    expect(within(footer).getByText(byNormalizedText(formatMoney(computedTotals.totalCents, state.project.currency)))).toBeInTheDocument();
  });

  it("uses fresh computed total for build_myself summary managers holding live costs even when cached summary total is zero", async () => {
    const projectId = "project-estimate-build-myself-summary-editable-total";
    const profile = setStoredAuthProfile({
      email: `${projectId}@example.com`,
      name: "Co Owner User",
    });

    addProject({
      id: projectId,
      owner_id: "other-owner-id",
      title: "Workspace Project",
      type: "residential",
      project_mode: "build_myself",
      automation_level: "assisted",
      current_stage_id: "",
      progress_pct: 0,
    });

    addMember({
      project_id: projectId,
      user_id: profile.id,
      role: "co_owner",
      ai_access: "project_pool",
      credit_limit: 500,
      used_credits: 0,
      finance_visibility: "summary",
    });
    setAuthRole("co_owner");

    const seeded = seedEstimateLine(projectId);
    expect(seeded).not.toBeNull();
    if (!seeded?.line) return;

    updateEstimateV2Project(projectId, { projectMode: "build_myself" });
    updateLine(projectId, seeded.line.id, {
      qtyMilli: 2_000,
      discountBpsOverride: 0,
    });
    __unsafeSetEstimateOperationalUpperBlockForTests(projectId, {
      effectiveFinanceVisibility: "summary",
      timing: {
        estimate_version_id: null,
        estimate_version_number: null,
        estimate_version_created_at: null,
      },
      clientTotalCents: 0,
      vatBps: 2200,
      discountBps: 0,
      resourceCostBreakdownClientSafeOnly: null,
    });

    const state = getEstimateV2ProjectState(projectId);
    const computedTotals = computeProjectTotals(
      state.project,
      state.stages,
      state.works,
      state.lines,
      state.project.projectMode,
    );

    await act(async () => {
      renderProjectEstimate(projectId);
      await flushUi();
    });

    const footer = screen.getByText("Total across all stages").closest("div.rounded-lg");
    expect(footer).not.toBeNull();
    if (!(footer instanceof HTMLElement)) return;

    expect(within(footer).getByText(byNormalizedText(formatMoney(computedTotals.totalCents, state.project.currency)))).toBeInTheDocument();
    expect(within(footer).queryByText(byNormalizedText(formatMoney(0, state.project.currency)))).not.toBeInTheDocument();
  });

  it("keeps persisted summary pricing for an EDITABLE summary co_owner whose line costs are redacted", async () => {
    // Same actor as the two tests above — co_owner, summary, build_myself, and
    // able to edit. The single difference is that the store hydrated through the
    // operational RPC and zeroed the cost fields, which is what happens in
    // Supabase mode. Recomputing client pricing from those zeros is the ₽0.00
    // defect (rovno#301 is unrelated; this is rovno#282).
    const projectId = "project-estimate-summary-editable-redacted-costs";
    const profile = setStoredAuthProfile({
      email: `${projectId}@example.com`,
      name: "Co Owner User",
    });

    addProject({
      id: projectId,
      owner_id: "other-owner-id",
      title: "Workspace Project",
      type: "residential",
      project_mode: "build_myself",
      automation_level: "assisted",
      current_stage_id: "",
      progress_pct: 0,
    });

    addMember({
      project_id: projectId,
      user_id: profile.id,
      role: "co_owner",
      ai_access: "project_pool",
      credit_limit: 500,
      used_credits: 0,
      finance_visibility: "summary",
    });
    setAuthRole("co_owner");

    const seeded = seedEstimateLine(projectId);
    expect(seeded).not.toBeNull();
    if (!seeded?.line) return;

    updateEstimateV2Project(projectId, { projectMode: "build_myself" });
    updateLine(projectId, seeded.line.id, { qtyMilli: 2_000, discountBpsOverride: 0 });
    // What estimate-v2-store writes for a redacted line. Set before the snapshot:
    // changing a pricing-driving field clears cached summary cents.
    updateLine(projectId, seeded.line.id, { costUnitCents: 0, costRedacted: true, markupBps: 0 });
    // The snapshot is the only truthful pricing source for such a user.
    updateLine(projectId, seeded.line.id, {
      summaryClientUnitCents: 19_999,
      summaryClientTotalCents: 39_998,
    });

    const state = getEstimateV2ProjectState(projectId);
    const redactedLine = state.lines.find((item) => item.id === seeded.line.id);
    expect(redactedLine?.costRedacted).toBe(true);
    expect(redactedLine?.summaryClientUnitCents).toBe(19_999);
    const zero = formatMoney(0, state.project.currency);

    await act(async () => {
      renderProjectEstimate(projectId);
      await flushUi();
    });

    const lineRow = screen.getByText("Concrete").closest("tr");
    expect(lineRow).not.toBeNull();
    if (!lineRow) return;

    expect(within(lineRow).getByText(byNormalizedText(formatMoney(19_999, state.project.currency)))).toBeInTheDocument();
    expect(within(lineRow).getByText(byNormalizedText(formatMoney(39_998, state.project.currency)))).toBeInTheDocument();

    // The header/footer block is the sharp edge: it fell to the recompute branch
    // and rendered ₽0.00 under per-line prices that were correct.
    const footer = screen.getByText("Total across all stages").closest("div.rounded-lg");
    expect(footer).not.toBeNull();
    if (!(footer instanceof HTMLElement)) return;
    expect(within(footer).queryByText(byNormalizedText(zero))).not.toBeInTheDocument();
  });

  it("makes the estimate read-only for a co_owner below detail finance visibility", async () => {
    // Their writes are refused by queueProjectDraftSync with blocked_permission,
    // and every edit cleared the persisted snapshot that was their only truthful
    // pricing source, so the affordance only ever destroyed data they could see.
    const projectId = "project-estimate-summary-co-owner-read-only";
    const profile = setStoredAuthProfile({
      email: `${projectId}@example.com`,
      name: "Co Owner User",
    });

    addProject({
      id: projectId,
      owner_id: "other-owner-id",
      title: "Workspace Project",
      type: "residential",
      project_mode: "build_myself",
      automation_level: "assisted",
      current_stage_id: "",
      progress_pct: 0,
    });

    addMember({
      project_id: projectId,
      user_id: profile.id,
      role: "co_owner",
      ai_access: "project_pool",
      credit_limit: 500,
      used_credits: 0,
      finance_visibility: "summary",
    });
    setAuthRole("co_owner");

    const seeded = seedEstimateLine(projectId);
    expect(seeded).not.toBeNull();
    if (!seeded?.line) return;

    await act(async () => {
      renderProjectEstimate(projectId);
      await flushUi();
    });

    expect(screen.getByText("Owner only")).toBeInTheDocument();
  });

  it("prices from the operational upper block when the RPC returned no resource lines at all", async () => {
    // With zero lines nothing survives to carry costRedacted, so a guard keyed
    // only on the lines is vacuously false and the footer printed 0 over a real
    // upper-block total.
    const projectId = "project-estimate-summary-upper-block-no-lines";
    const profile = setStoredAuthProfile({
      email: `${projectId}@example.com`,
      name: "Co Owner User",
    });

    addProject({
      id: projectId,
      owner_id: "other-owner-id",
      title: "Workspace Project",
      type: "residential",
      project_mode: "build_myself",
      automation_level: "assisted",
      current_stage_id: "",
      progress_pct: 0,
    });

    addMember({
      project_id: projectId,
      user_id: profile.id,
      role: "co_owner",
      ai_access: "project_pool",
      credit_limit: 500,
      used_credits: 0,
      finance_visibility: "summary",
    });
    setAuthRole("co_owner");

    const stage = createStage(projectId, { title: "Shell" });
    expect(stage).not.toBeNull();
    if (!stage) return;
    expect(createWork(projectId, { stageId: stage.id, title: "Framing" })).not.toBeNull();

    __unsafeSetEstimateOperationalUpperBlockForTests(projectId, {
      effectiveFinanceVisibility: "summary",
      timing: {
        estimate_version_id: null,
        estimate_version_number: null,
        estimate_version_created_at: null,
      },
      clientTotalCents: 1_000_000,
      vatBps: 2200,
      discountBps: 0,
      resourceCostBreakdownClientSafeOnly: null,
    });

    const state = getEstimateV2ProjectState(projectId);
    expect(state.lines).toHaveLength(0);

    await act(async () => {
      renderProjectEstimate(projectId);
      await flushUi();
    });

    const footer = screen.getByText("Total across all stages").closest("div.rounded-lg");
    expect(footer).not.toBeNull();
    if (!(footer instanceof HTMLElement)) return;
    // 1 000 000 + 22% VAT. Keyed on the lines alone this printed 0,00 ₽.
    expect(within(footer).getByText(byNormalizedText(formatMoney(1_220_000, state.project.currency)))).toBeInTheDocument();
    expect(within(footer).queryByText(byNormalizedText(formatMoney(0, state.project.currency)))).not.toBeInTheDocument();
  });

  it("keeps persisted summary pricing for read-only summary viewers while internal detail stays redacted", async () => {
    const projectId = "project-estimate-summary-viewer-snapshot-pricing";
    setupLocalProject(projectId, { finance_visibility: "summary" });
    const seeded = seedEstimateLine(projectId);
    expect(seeded).not.toBeNull();
    if (!seeded?.line) return;

    updateLine(projectId, seeded.line.id, {
      type: "labor",
      qtyMilli: 2_000,
      markupBps: 2_000,
    });
    updateLine(projectId, seeded.line.id, {
      summaryClientUnitCents: 19_999,
      summaryClientTotalCents: 39_998,
    });
    setAuthRole("viewer");

    await act(async () => {
      renderProjectEstimate(projectId);
      await flushUi();
    });

    const lineRow = screen.getByText("Concrete").closest("tr");
    expect(lineRow).not.toBeNull();
    if (!lineRow) return;

    expect(screen.queryByText("Cost unit")).not.toBeInTheDocument();
    expect(screen.queryByText("Cost total")).not.toBeInTheDocument();
    expect(within(lineRow).getByText(byNormalizedText(formatMoney(19_999, "RUB")))).toBeInTheDocument();
    expect(within(lineRow).getByText(byNormalizedText(formatMoney(39_998, "RUB")))).toBeInTheDocument();
  });

  it("clears cached summary pricing when a pricing-driving line field changes", () => {
    const projectId = "project-estimate-clear-stale-summary-cache";
    setupLocalProject(projectId);
    const seeded = seedEstimateLine(projectId);
    expect(seeded).not.toBeNull();
    if (!seeded?.line) return;

    updateLine(projectId, seeded.line.id, {
      summaryClientUnitCents: 0,
      summaryClientTotalCents: 0,
      summaryDiscountedClientTotalCents: 0,
    });
    __unsafeSetEstimateOperationalUpperBlockForTests(projectId, {
      effectiveFinanceVisibility: "summary",
      timing: {
        estimate_version_id: null,
        estimate_version_number: null,
        estimate_version_created_at: null,
      },
      clientTotalCents: 0,
      vatBps: 2200,
      discountBps: 0,
      resourceCostBreakdownClientSafeOnly: null,
    });

    updateLine(projectId, seeded.line.id, { costUnitCents: 15_000 });

    const nextState = getEstimateV2ProjectState(projectId);
    const updatedLine = nextState.lines.find((line) => line.id === seeded.line.id);
    expect(updatedLine).toBeTruthy();
    if (!updatedLine) return;

    expect(updatedLine.summaryClientUnitCents).toBeUndefined();
    expect(updatedLine.summaryClientTotalCents).toBeUndefined();
    expect(updatedLine.summaryDiscountedClientTotalCents).toBeUndefined();
    expect(nextState.operationalUpperBlock).toBeNull();
  });

  it("renders checklist-linked resources for reduced-access viewers when estimate lines are unavailable", async () => {
    const projectId = "project-estimate-checklist-resource-fallback";
    setupLocalProject(projectId, { finance_visibility: "summary" });
    const stage = createStage(projectId, { title: "Shell" });
    expect(stage).not.toBeNull();
    if (!stage) return;

    const work = createWork(projectId, { stageId: stage.id, title: "Framing" });
    expect(work).not.toBeNull();
    if (!work) return;

    addTask({
      id: "task-fallback-resource",
      project_id: projectId,
      stage_id: stage.id,
      title: "Framing task",
      description: "",
      status: "not_started",
      assignee_id: "",
      checklist: [
        {
          id: "checklist-fallback-resource",
          text: "Concrete blocks",
          done: false,
          type: "material",
          estimateV2LineId: "missing-line-1",
          estimateV2WorkId: work.id,
          estimateV2QtyMilli: 4_000,
          estimateV2Unit: "pcs",
        },
      ],
      comments: [],
      attachments: [],
      photos: [],
      linked_estimate_item_ids: [],
      created_at: "2026-03-01T00:00:00.000Z",
    });
    setAuthRole("viewer");

    await act(async () => {
      renderProjectEstimate(projectId);
      await flushUi();
    });

    await waitFor(() => {
      expect(screen.getByText("Concrete blocks")).toBeInTheDocument();
    });
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.getByText("pcs")).toBeInTheDocument();
    expect(screen.queryByText("Client unit")).not.toBeInTheDocument();
    expect(screen.queryByText("Client total")).not.toBeInTheDocument();
  });

  it("renders linked checklist resources even when restricted users cannot recover resource metadata", async () => {
    const projectId = "project-estimate-linked-resource-fallback";
    setupLocalProject(projectId, { finance_visibility: "summary" });
    const stage = createStage(projectId, { title: "Shell" });
    expect(stage).not.toBeNull();
    if (!stage) return;

    const work = createWork(projectId, { stageId: stage.id, title: "Finishes" });
    expect(work).not.toBeNull();
    if (!work) return;

    addTask({
      id: "task-linked-resource-fallback",
      project_id: projectId,
      stage_id: stage.id,
      title: "Finishes task",
      description: "",
      status: "not_started",
      assignee_id: "",
      checklist: [
        {
          id: "checklist-linked-resource-fallback",
          text: "Hidden line item",
          done: false,
          type: "subtask",
          estimateV2LineId: "restricted-line-1",
          estimateV2WorkId: work.id,
        },
      ],
      comments: [],
      attachments: [],
      photos: [],
      linked_estimate_item_ids: [],
      created_at: "2026-03-01T00:00:00.000Z",
    });
    setAuthRole("viewer");

    await act(async () => {
      renderProjectEstimate(projectId);
      await flushUi();
    });

    await waitFor(() => {
      expect(screen.getByText("Hidden line item")).toBeInTheDocument();
    });
    expect(screen.queryByText("Client unit")).not.toBeInTheDocument();
    expect(screen.queryByText("Client total")).not.toBeInTheDocument();
  });

  it("restores markup for the project owner even before the owner membership row hydrates", async () => {
    const projectId = "project-estimate-owner-fallback-markup";
    setupLocalProjectWithoutMembership(projectId);
    const seeded = seedEstimateLine(projectId);
    expect(seeded).not.toBeNull();
    if (!seeded?.line) return;

    await act(async () => {
      renderProjectEstimate(projectId);
      await flushUi();
    });

    expect(screen.getByText("Markup %")).toBeInTheDocument();
  });

  it("creates contractor assignee invites with baseline finance visibility", async () => {
    const projectId = "project-estimate-assignee-invite";
    setupLocalProject(projectId);
    const seeded = seedEstimateLine(projectId);
    expect(seeded).not.toBeNull();
    if (!seeded?.line) return;

    updateLine(projectId, seeded.line.id, {
      type: "labor",
      assigneeName: null,
      assigneeEmail: null,
    });

    const createInviteSpy = vi.spyOn(workspaceSource, "createWorkspaceProjectInvite").mockResolvedValue({
      id: "invite-1",
      project_id: projectId,
      email: "contractor@example.com",
      role: "contractor",
      ai_access: "consult_only",
      viewer_regime: null,
      credit_limit: 50,
      invited_by: "profile-1",
      status: "pending",
      invite_token: "token-1",
      accepted_profile_id: null,
      created_at: "2026-03-01T00:00:00.000Z",
      accepted_at: null,
      finance_visibility: "none",
    } as never);
    const sendInviteSpy = vi.spyOn(workspaceSource, "sendWorkspaceProjectInviteEmail").mockResolvedValue({
      kind: "skipped",
    });

    await act(async () => {
      renderProjectEstimate(projectId);
      await flushUi();
    });

    fireEvent.click(screen.getByRole("button", { name: "Assign" }));
    fireEvent.change(screen.getByPlaceholderText("Type person name"), { target: { value: "Manual Person" } });
    fireEvent.change(screen.getByPlaceholderText("contractor@example.com"), { target: { value: "contractor@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Invite" }));

    await waitFor(() => {
      expect(createInviteSpy).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          projectId,
          role: "contractor",
          financeVisibility: "none",
        }),
      );
    });
    expect(sendInviteSpy).not.toHaveBeenCalled();
  });
  it("marks all project tasks done from the finish blocker and then finishes the estimate after confirmation", async () => {
    const projectId = "project-estimate-finish-bulk-done";
    setupLocalProject(projectId);
    const seeded = seedEstimateLine(projectId);
    expect(seeded).not.toBeNull();
    if (!seeded) return;

    const statusResult = setProjectEstimateStatus(projectId, "in_work", { skipSetup: true });
    expect(statusResult.ok).toBe(true);

    addTask({
      id: "manual-finish-task",
      project_id: projectId,
      stage_id: seeded.stage.id,
      title: "Manual inspection",
      description: "",
      status: "not_started",
      assignee_id: "",
      checklist: [],
      comments: [],
      attachments: [],
      photos: [],
      linked_estimate_item_ids: [],
      created_at: "2026-03-01T00:00:00.000Z",
    });

    await act(async () => {
      renderProjectEstimate(projectId);
      await flushUi();
    });

    await act(async () => {
      await changeEstimateStatus("Finished");
    });

    expect(screen.getByText("Cannot mark as Finished")).toBeInTheDocument();
    expect(screen.getByText("Manual inspection")).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Mark all tasks done" }));
      await flushUi();
    });

    expect(screen.getByText("All tasks are Done")).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Mark estimate Finished" }));
      await flushUi();
    });

    await waitFor(() => {
      expect(getEstimateV2ProjectState(projectId).project.estimateStatus).toBe("finished");
    });
  });

  it("keeps the estimate in work when the follow-up finish confirmation is cancelled", async () => {
    const projectId = "project-estimate-finish-bulk-cancel";
    setupLocalProject(projectId);
    const seeded = seedEstimateLine(projectId);
    expect(seeded).not.toBeNull();
    if (!seeded) return;

    const statusResult = setProjectEstimateStatus(projectId, "in_work", { skipSetup: true });
    expect(statusResult.ok).toBe(true);

    addTask({
      id: "manual-finish-task-cancel",
      project_id: projectId,
      stage_id: seeded.stage.id,
      title: "Client handoff",
      description: "",
      status: "not_started",
      assignee_id: "",
      checklist: [],
      comments: [],
      attachments: [],
      photos: [],
      linked_estimate_item_ids: [],
      created_at: "2026-03-01T00:00:00.000Z",
    });

    await act(async () => {
      renderProjectEstimate(projectId);
      await flushUi();
    });

    await act(async () => {
      await changeEstimateStatus("Finished");
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Mark all tasks done" }));
      await flushUi();
    });

    expect(screen.getByText("All tasks are Done")).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Not now" }));
      await flushUi();
    });

    expect(getEstimateV2ProjectState(projectId).project.estimateStatus).toBe("in_work");
  });

  it("uses a simple one-step confirmation when deleting a resource without downstream consequences", async () => {
    const projectId = "project-estimate-delete-resource-simple";
    setupLocalProject(projectId);
    const currentStage = createStage(projectId, { title: "Delete stage" });
    expect(currentStage).not.toBeNull();
    if (!currentStage) return;

    const currentWork = createWork(projectId, { stageId: currentStage.id, title: "Delete work" });
    expect(currentWork).not.toBeNull();
    if (!currentWork) return;

    const currentLine = createLine(projectId, {
      stageId: currentStage.id,
      workId: currentWork.id,
      title: "Simple resource",
      type: "material",
      qtyMilli: 1_000,
      costUnitCents: 5_000,
    });
    expect(currentLine).not.toBeNull();
    if (!currentLine) return;

    await act(async () => {
      renderProjectEstimate(projectId);
      await flushUi();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Delete resource Simple resource" }));
      await flushUi();
    });

    const dialog = screen.getByRole("alertdialog", { name: "Delete resource?" });
    expect(within(dialog).getByText("This resource will be removed from the estimate. This action cannot be undone.")).toBeInTheDocument();
    expect(within(dialog).queryByText(/normal UI flow/i)).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
      await flushUi();
    });

    await waitFor(() => {
      expect(getEstimateV2ProjectState(projectId).lines).toHaveLength(0);
    });
    expect(screen.queryByText("Simple resource")).not.toBeInTheDocument();
  });

  it("shows the stronger financial warning when deleting a resource with ordered or stocked downstream state", async () => {
    const projectId = "project-estimate-delete-resource-financial";
    setupLocalProject(projectId);
    const seeded = seedEstimateLine(projectId);
    expect(seeded).not.toBeNull();
    if (!seeded) return;

    const statusResult = setProjectEstimateStatus(projectId, "in_work", { skipSetup: true });
    expect(statusResult.ok).toBe(true);
    createPlacedSupplierOrderForLine(projectId, seeded.line.id, { qty: 1, receivedQty: 1 });

    await act(async () => {
      renderProjectEstimate(projectId);
      await flushUi();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Delete resource Concrete" }));
      await flushUi();
    });

    const dialog = screen.getByRole("alertdialog", { name: "Delete resource permanently?" });
    expect(within(dialog).getByText(/cannot be recovered through the normal UI flow/i)).toBeInTheDocument();
    expect(within(dialog).getByText("Concrete (Fully ordered, In stock)")).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Delete permanently" }));
      await flushUi();
    });

    await waitFor(() => {
      expect(getEstimateV2ProjectState(projectId).lines).toHaveLength(0);
    });
  });

  it("uses a staged execution then financial confirmation when deleting a started work", async () => {
    const projectId = "project-estimate-delete-work-staged";
    setupLocalProject(projectId);
    const seeded = seedEstimateLine(projectId);
    expect(seeded).not.toBeNull();
    if (!seeded) return;

    const statusResult = setProjectEstimateStatus(projectId, "in_work", { skipSetup: true });
    expect(statusResult.ok).toBe(true);
    createPlacedSupplierOrderForLine(projectId, seeded.line.id, { qty: 1 });

    const taskId = getEstimateV2ProjectState(projectId).works[0]?.taskId;
    expect(taskId).toBeTruthy();
    if (taskId) {
      updateTask(taskId, { status: "in_progress" });
    }

    await act(async () => {
      renderProjectEstimate(projectId);
      await flushUi();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Delete work Framing" }));
      await flushUi();
    });

    const executionDialog = screen.getByRole("alertdialog", { name: "Delete work?" });
    expect(within(executionDialog).getByText(/already in progress/i)).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(within(executionDialog).getByRole("button", { name: "Continue" }));
      await flushUi();
    });

    const financialDialog = await screen.findByRole("alertdialog", { name: "Delete work permanently?" });
    expect(within(financialDialog).getByText(/cannot be recovered through the normal UI flow/i)).toBeInTheDocument();
    expect(within(financialDialog).getByText("Concrete (Fully ordered)")).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(within(financialDialog).getByRole("button", { name: "Delete permanently" }));
      await flushUi();
    });

    await waitFor(() => {
      expect(getEstimateV2ProjectState(projectId).works).toHaveLength(0);
    });
  });

  it("shows started items first and then the stronger financial warning when deleting a stage", async () => {
    const projectId = "project-estimate-delete-stage-staged";
    setupLocalProject(projectId);
    const seeded = seedEstimateLine(projectId);
    expect(seeded).not.toBeNull();
    if (!seeded) return;

    const statusResult = setProjectEstimateStatus(projectId, "in_work", { skipSetup: true });
    expect(statusResult.ok).toBe(true);
    createPlacedSupplierOrderForLine(projectId, seeded.line.id, { qty: 1 });

    const linkedTaskId = getEstimateV2ProjectState(projectId).works[0]?.taskId;
    expect(linkedTaskId).toBeTruthy();
    if (linkedTaskId) {
      updateTask(linkedTaskId, { status: "in_progress" });
    }

    addTask({
      id: "manual-stage-task",
      project_id: projectId,
      stage_id: seeded.stage.id,
      title: "Manual blocked task",
      description: "",
      status: "blocked",
      assignee_id: "",
      checklist: [],
      comments: [],
      attachments: [],
      photos: [],
      linked_estimate_item_ids: [],
      created_at: "2026-03-01T00:00:00.000Z",
    });

    await act(async () => {
      renderProjectEstimate(projectId);
      await flushUi();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Delete stage Shell" }));
      await flushUi();
    });

    const executionDialog = screen.getByRole("alertdialog", { name: "Delete stage?" });
    expect(within(executionDialog).getByText(/started and is not Done/i)).toBeInTheDocument();
    expect(within(executionDialog).getByText("Framing (Work: In progress)")).toBeInTheDocument();
    expect(within(executionDialog).getByText("Manual blocked task (Task: Blocked)")).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(within(executionDialog).getByRole("button", { name: "Continue" }));
      await flushUi();
    });

    const financialDialog = await screen.findByRole("alertdialog", { name: "Delete stage permanently?" });
    expect(within(financialDialog).getByText(/cannot be recovered through the normal UI flow/i)).toBeInTheDocument();
    expect(within(financialDialog).getByText("Concrete (Fully ordered)")).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(within(financialDialog).getByRole("button", { name: "Delete permanently" }));
      await flushUi();
    });

    await waitFor(() => {
      expect(getEstimateV2ProjectState(projectId).stages).toHaveLength(0);
    });
  });

  it("updates the footer VAT summary totals", async () => {
    const projectId = "project-1";
    enterDemoSession(projectId);
    const seeded = seedEstimateLine(projectId);
    expect(seeded).not.toBeNull();

    await act(async () => {
      renderProjectEstimate(projectId);
      await flushUi();
    });

    const footer = screen.getByText("Total across all stages").closest("div.rounded-lg");
    expect(footer).not.toBeNull();
    if (!(footer instanceof HTMLElement)) return;

    const beforeState = getEstimateV2ProjectState(projectId);
    const beforeTotals = computeProjectTotals(
      beforeState.project,
      beforeState.stages,
      beforeState.works,
      beforeState.lines,
      beforeState.project.projectMode,
    );

    expect(within(footer).getByText("Total across all stages")).toBeInTheDocument();
    expect(normalizeText(footer.textContent)).toContain(normalizeText(formatMoney(beforeTotals.totalCents, beforeState.project.currency)));
    expect(within(footer).getByRole("button", { name: "22%" })).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(within(footer).getByRole("button", { name: "22%" }));
      await flushUi();
    });

    const vatInput = within(footer).getByDisplayValue("22") as HTMLInputElement;
    fireEvent.change(vatInput, { target: { value: "18" } });
    fireEvent.keyDown(vatInput, { key: "Enter" });

    const afterState = getEstimateV2ProjectState(projectId);
    const afterTotals = computeProjectTotals(
      afterState.project,
      afterState.stages,
      afterState.works,
      afterState.lines,
      afterState.project.projectMode,
    );

    expect(afterTotals.totalCents).not.toBe(beforeTotals.totalCents);

    await waitFor(() => {
      expect(within(footer).getByRole("button", { name: "18%" })).toBeInTheDocument();
      expect(normalizeText(footer.textContent)).toContain(normalizeText(formatMoney(afterTotals.totalCents, afterState.project.currency)));
    });
  });
});
