import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OnboardingStepper } from "@/components/onboarding/OnboardingStepper";
import type { Stage } from "@/types/entities";

const { getPlanningSourceMock, toastMock, captureExceptionMock } = vi.hoisted(() => ({
  getPlanningSourceMock: vi.fn(),
  toastMock: vi.fn(),
  captureExceptionMock: vi.fn(),
}));

vi.mock("@/data/planning-source", async () => {
  const actual = await vi.importActual<typeof import("@/data/planning-source")>("@/data/planning-source");
  return { ...actual, getPlanningSource: getPlanningSourceMock };
});

vi.mock("@/lib/observability/sentry", async () => {
  const actual = await vi.importActual<typeof import("@/lib/observability/sentry")>("@/lib/observability/sentry");
  return { ...actual, captureException: captureExceptionMock };
});

vi.mock("@/hooks/use-toast", async () => {
  const actual = await vi.importActual<typeof import("@/hooks/use-toast")>("@/hooks/use-toast");
  return { ...actual, toast: toastMock };
});

function renderStepper(onComplete: () => void = () => {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <OnboardingStepper onComplete={onComplete} />
    </QueryClientProvider>,
  );
}

function polyfillPointerEvents() {
  class MockPointerEvent extends MouseEvent {
    pointerType: string;
    isPrimary: boolean;
    constructor(type: string, params: MouseEventInit & { pointerType?: string; isPrimary?: boolean } = {}) {
      super(type, params);
      this.pointerType = params.pointerType ?? "mouse";
      this.isPrimary = params.isPrimary ?? true;
    }
  }
  Object.defineProperty(window, "PointerEvent", { configurable: true, writable: true, value: MockPointerEvent });
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, writable: true, value: () => {} });
  Object.defineProperty(HTMLElement.prototype, "hasPointerCapture", { configurable: true, writable: true, value: () => false });
  Object.defineProperty(HTMLElement.prototype, "setPointerCapture", { configurable: true, writable: true, value: () => {} });
  Object.defineProperty(HTMLElement.prototype, "releasePointerCapture", { configurable: true, writable: true, value: () => {} });
}

describe("OnboardingStepper units persistence", () => {
  // Radix Select needs these jsdom polyfills (same pattern as ProjectEstimate.test.tsx).
  beforeEach(polyfillPointerEvents);
  afterEach(() => {
    localStorage.clear();
  });

  it("persists the chosen units to local profile preferences on Continue", async () => {
    // The Preferences step is the initial render (MVP_SHOW_AI_AUTOMATION_MODE_UI is false).
    renderStepper();
    // Two Selects on this step: language, then units (last).
    const comboboxes = screen.getAllByRole("combobox");
    fireEvent.pointerDown(comboboxes[comboboxes.length - 1]);
    const imperialOption = await screen.findByRole("option", { name: /imperial/i });
    fireEvent.click(imperialOption);

    fireEvent.click(screen.getByRole("button", { name: /continue|продолжить/i }));

    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem("profile-preferences") ?? "{}") as Record<string, unknown>;
      expect(saved.units).toBe("imperial");
    });
  });
});

describe("OnboardingStepper stages step", () => {
  beforeEach(polyfillPointerEvents);
  afterEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  function fakePlanningSource({ failOnCall }: { failOnCall: number }) {
    const created: Stage[] = [];
    let calls = 0;
    const createProjectStage = vi.fn(async (input: { projectId: string; title: string; order: number }) => {
      calls += 1;
      if (calls === failOnCall) {
        throw new Error("network");
      }
      const stage: Stage = {
        id: `stage-${created.length + 1}`,
        project_id: input.projectId,
        title: input.title,
        description: "",
        order: input.order,
        status: "open",
      };
      created.push(stage);
      return stage;
    });
    return { created, createProjectStage };
  }

  // Onboarding is finished here rather than navigated away from: with no org step,
  // leaving the stages screen IS the onComplete call, and the component stays mounted.
  const onComplete = vi.fn();

  async function reachStagesStep(rows: number) {
    renderStepper(onComplete);
    fireEvent.click(screen.getByRole("button", { name: /continue|далее|продолжить/i }));
    const nameInput = await screen.findByPlaceholderText(/project name|название проекта/i);
    fireEvent.change(nameInput, { target: { value: "Stages project" } });
    fireEvent.click(screen.getByRole("button", { name: /create & continue|создать и продолжить/i }));

    await screen.findByRole("button", { name: /add stage|добавить этап/i });
    for (let i = 1; i < rows; i++) {
      fireEvent.click(screen.getByRole("button", { name: /add stage|добавить этап/i }));
      await waitFor(() => expect(screen.getAllByRole("textbox")).toHaveLength(i + 1));
    }
  }

  function setStageTitles(titles: string[]) {
    const inputs = screen.getAllByRole("textbox");
    titles.forEach((title, i) => fireEvent.change(inputs[i], { target: { value: title } }));
  }

  const continueButton = () => screen.getByRole("button", { name: /^(continue|далее)$/i });
  const skipButton = () => screen.getByRole("button", { name: /^(skip|пропустить)$/i });

  it("leaves the stages step when a stage write fails part way through", async () => {
    const { created, createProjectStage } = fakePlanningSource({ failOnCall: 2 });
    getPlanningSourceMock.mockResolvedValue({ mode: "local", createProjectStage });

    await reachStagesStep(2);
    setStageTitles(["AAA", "BBB"]);

    fireEvent.click(continueButton());

    await waitFor(() => expect(onComplete).toHaveBeenCalled());
    expect(created.map((stage) => stage.title)).toEqual(["AAA"]);
  });

  it("leaves the stages step when Skip's stage write fails", async () => {
    const { created, createProjectStage } = fakePlanningSource({ failOnCall: 1 });
    getPlanningSourceMock.mockResolvedValue({ mode: "local", createProjectStage });

    await reachStagesStep(1);

    fireEvent.click(skipButton());

    await waitFor(() => expect(onComplete).toHaveBeenCalled());
    expect(created).toHaveLength(0);
  });

  it("names the stage write, not project creation, when the write fails", async () => {
    const { createProjectStage } = fakePlanningSource({ failOnCall: 1 });
    getPlanningSourceMock.mockResolvedValue({ mode: "local", createProjectStage });

    await reachStagesStep(1);

    fireEvent.click(continueButton());

    await waitFor(() => expect(toastMock).toHaveBeenCalled());
    const titles = toastMock.mock.calls.map(([arg]) => (arg as { title?: string }).title);
    expect(titles).toContain("Failed to save stages");
    expect(titles).not.toContain("Failed to create project");
  });

  it("reports the swallowed write failure so it is not lost", async () => {
    const { createProjectStage } = fakePlanningSource({ failOnCall: 1 });
    getPlanningSourceMock.mockResolvedValue({ mode: "local", createProjectStage });

    await reachStagesStep(1);

    fireEvent.click(continueButton());

    await waitFor(() => expect(onComplete).toHaveBeenCalled());
    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
    expect(captureExceptionMock.mock.calls[0][0]).toBeInstanceOf(Error);
  });

  it("writes every stage and advances when nothing fails", async () => {
    const { created, createProjectStage } = fakePlanningSource({ failOnCall: 0 });
    getPlanningSourceMock.mockResolvedValue({ mode: "local", createProjectStage });

    await reachStagesStep(3);
    setStageTitles(["AAA", "BBB", "CCC"]);

    fireEvent.click(continueButton());

    await waitFor(() => expect(onComplete).toHaveBeenCalled());
    expect(created.map((stage) => stage.title)).toEqual(["AAA", "BBB", "CCC"]);
    expect(created.map((stage) => stage.order)).toEqual([1, 2, 3]);
    expect(toastMock).not.toHaveBeenCalled();
    expect(captureExceptionMock).not.toHaveBeenCalled();
  });
});
