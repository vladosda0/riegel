import { act, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as planningSource from "@/data/planning-source";
import * as store from "@/data/store";
import * as estimateV2Data from "@/hooks/use-estimate-v2-data";
import {
  usePlanningProjectStages,
  usePlanningProjectTasks,
  usePlanningProjectTasksState,
} from "@/hooks/use-planning-source";
import { authenticateRuntimeAuth } from "@/test/runtime-auth";
import type { Stage, Task } from "@/types/entities";

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
}

function stage(partial: Partial<Stage> = {}): Stage {
  return {
    id: "stage-1",
    project_id: "project-1",
    title: "Stage One",
    description: "",
    order: 1,
    status: "open",
    ...partial,
  };
}

function task(partial: Partial<Task> = {}): Task {
  return {
    id: "task-1",
    project_id: "project-1",
    stage_id: "stage-1",
    title: "Task One",
    description: "",
    status: "not_started",
    assignee_id: "",
    checklist: [],
    comments: [],
    attachments: [],
    photos: [],
    linked_estimate_item_ids: [],
    created_at: "2026-03-01T00:00:00.000Z",
    ...partial,
  };
}

function PlanningProbe({ projectId }: { projectId: string }) {
  const stages = usePlanningProjectStages(projectId);
  const tasks = usePlanningProjectTasks(projectId);

  return (
    <div>
      <span data-testid="stage-count">{stages.length}</span>
      <span data-testid="task-count">{tasks.length}</span>
      <span data-testid="stage-titles">{stages.map((item) => item.title).join("|")}</span>
      <span data-testid="task-titles">{tasks.map((item) => item.title).join("|")}</span>
      <span data-testid="task-assignees">
        {tasks.map((item) => (item.assignees ?? []).map((assignee) => assignee.id ?? assignee.email ?? assignee.name ?? "unknown").join(",")).join("|")}
      </span>
    </div>
  );
}

function TasksIdentityProbe({
  projectId,
  onRender,
}: {
  projectId: string;
  tick: number;
  onRender: (tasks: Task[]) => void;
}) {
  const { tasks } = usePlanningProjectTasksState(projectId);
  onRender(tasks);

  return <span data-testid="task-count">{tasks.length}</span>;
}

function mockEstimateProject(lines: Array<Record<string, unknown>> = []) {
  vi.spyOn(estimateV2Data, "useEstimateV2Project").mockReturnValue({
    project: { estimateStatus: "in_work" },
    stages: [],
    works: [],
    lines,
    versions: [],
    selectedVersionId: null,
    selectedVersion: null,
    dependencies: [],
    baseline: null,
    sync: {
      estimateRevision: null,
      domains: {
        tasks: { status: "idle", projectedRevision: null, lastAttemptedAt: null, lastSucceededAt: null, lastError: null },
        procurement: { status: "idle", projectedRevision: null, lastAttemptedAt: null, lastSucceededAt: null, lastError: null },
        hr: { status: "idle", projectedRevision: null, lastAttemptedAt: null, lastSucceededAt: null, lastError: null },
      },
    },
    isLoading: false,
  } as never);
}

describe("usePlanningProjectStages/usePlanningProjectTasks", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("returns demo store data and reacts to store subscription updates", async () => {
    const queryClient = createQueryClient();
    mockEstimateProject();
    let currentStages = [stage({ title: "Stage One" })];
    let currentTasks = [task({ title: "Task One" })];
    const listeners = new Set<() => void>();

    const getStagesSpy = vi.spyOn(store, "getStages").mockImplementation(() => currentStages);
    const getTasksSpy = vi.spyOn(store, "getTasks").mockImplementation(() => currentTasks);
    vi.spyOn(store, "subscribe").mockImplementation((callback) => {
      listeners.add(callback);
      return () => {
        listeners.delete(callback);
      };
    });

    render(
      <QueryClientProvider client={queryClient}>
        <PlanningProbe projectId="project-1" />
      </QueryClientProvider>,
    );

    expect(screen.getByTestId("stage-count")).toHaveTextContent("1");
    expect(screen.getByTestId("task-count")).toHaveTextContent("1");
    expect(screen.getByTestId("stage-titles")).toHaveTextContent("Stage One");
    expect(screen.getByTestId("task-titles")).toHaveTextContent("Task One");

    act(() => {
      currentStages = [stage({ title: "Stage Two", order: 2 })];
      currentTasks = [task({ title: "Task Two", stage_id: "stage-2" })];
      listeners.forEach((listener) => listener());
    });

    await waitFor(() => {
      expect(screen.getByTestId("stage-titles")).toHaveTextContent("Stage Two");
    });
    expect(screen.getByTestId("task-titles")).toHaveTextContent("Task Two");
    expect(getStagesSpy).toHaveBeenCalledWith("project-1");
    expect(getTasksSpy).toHaveBeenCalledWith("project-1");
  });

  it("returns empty arrays while Supabase planning data is loading, then mapped results", async () => {
    vi.stubEnv("VITE_WORKSPACE_SOURCE", "supabase");

    const queryClient = createQueryClient();
    let resolveStages: (value: Stage[]) => void;
    let resolveTasks: (value: Task[]) => void;
    const stagesPromise = new Promise<Stage[]>((resolve) => {
      resolveStages = resolve;
    });
    const tasksPromise = new Promise<Task[]>((resolve) => {
      resolveTasks = resolve;
    });
    const getStagesSpy = vi.spyOn(store, "getStages");
    const getTasksSpy = vi.spyOn(store, "getTasks");
    const source = {
      mode: "supabase" as const,
      getProjectStages: vi.fn(() => stagesPromise),
      getProjectTasks: vi.fn(() => tasksPromise),
      createProjectStage: vi.fn(),
      createProjectTask: vi.fn(),
      updateProjectTask: vi.fn(),
      updateTaskChecklistItem: vi.fn(),
      createTaskChecklistItem: vi.fn(),
      deleteTaskChecklistItem: vi.fn(),
      createTaskComment: vi.fn(),
      changeTaskStatus: vi.fn(),
    };

    authenticateRuntimeAuth();
    mockEstimateProject();
    vi.spyOn(planningSource, "getPlanningSource").mockResolvedValue(source);

    render(
      <QueryClientProvider client={queryClient}>
        <PlanningProbe projectId="project-1" />
      </QueryClientProvider>,
    );

    expect(screen.getByTestId("stage-count")).toHaveTextContent("0");
    expect(screen.getByTestId("task-count")).toHaveTextContent("0");
    expect(getStagesSpy).not.toHaveBeenCalled();
    expect(getTasksSpy).not.toHaveBeenCalled();

    await act(async () => {
      resolveStages!([stage({ title: "Supabase Stage" })]);
      resolveTasks!([task({ title: "Supabase Task" })]);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByTestId("stage-count")).toHaveTextContent("1");
    });
    expect(screen.getByTestId("task-count")).toHaveTextContent("1");
    expect(screen.getByTestId("stage-titles")).toHaveTextContent("Supabase Stage");
    expect(screen.getByTestId("task-titles")).toHaveTextContent("Supabase Task");
    expect(source.getProjectStages).toHaveBeenCalledWith("project-1");
    expect(source.getProjectTasks).toHaveBeenCalledWith("project-1");
  });

  it("derives multi-assignee task view data from estimate-owned assignees in Supabase mode", async () => {
    vi.stubEnv("VITE_WORKSPACE_SOURCE", "supabase");

    const queryClient = createQueryClient();
    authenticateRuntimeAuth();
    mockEstimateProject([
        {
          id: "line-1",
          projectId: "project-1",
          stageId: "stage-1",
          workId: "work-1",
          title: "Crew lead",
          type: "labor",
          unit: "shift",
          qtyMilli: 1000,
          costUnitCents: 0,
          markupBps: 0,
          discountBpsOverride: null,
          assigneeId: "user-1",
          assigneeName: "Crew Lead",
          assigneeEmail: "lead@example.com",
          receivedCents: 0,
          pnlPlaceholderCents: 0,
          createdAt: "2026-03-01T00:00:00.000Z",
          updatedAt: "2026-03-01T00:00:00.000Z",
        },
        {
          id: "line-2",
          projectId: "project-1",
          stageId: "stage-1",
          workId: "work-1",
          title: "Helper",
          type: "labor",
          unit: "shift",
          qtyMilli: 1000,
          costUnitCents: 0,
          markupBps: 0,
          discountBpsOverride: null,
          assigneeId: null,
          assigneeName: "Helper",
          assigneeEmail: "helper@example.com",
          receivedCents: 0,
          pnlPlaceholderCents: 0,
          createdAt: "2026-03-01T00:00:00.000Z",
          updatedAt: "2026-03-01T00:00:00.000Z",
        },
      ],
    );
    vi.spyOn(planningSource, "getPlanningSource").mockResolvedValue({
      mode: "supabase",
      getProjectStages: vi.fn().mockResolvedValue([]),
      getProjectTasks: vi.fn().mockResolvedValue([
        task({
          estimateV2WorkId: "work-1",
          assignee_id: "",
        }),
      ]),
    } as never);

    render(
      <QueryClientProvider client={queryClient}>
        <PlanningProbe projectId="project-1" />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("task-count")).toHaveTextContent("1");
    });

    expect(screen.getByTestId("task-assignees")).toHaveTextContent("user-1,helper@example.com");
  });

  // Regression: with stable query keys, freshness on page re-entry must not
  // depend on a mounted consumer having observed the projection advance. An
  // estimate edit on another page can advance the projection while this hook is
  // unmounted; refetchOnMount:"always" makes returning within staleTime refetch
  // rather than serve the stale cached list. Without it, the second mount would
  // reuse the fresh-cached data (still 1 call).
  it("refetches on page re-entry so an off-page projection advance is not served stale", async () => {
    vi.stubEnv("VITE_WORKSPACE_SOURCE", "supabase");

    const queryClient = createQueryClient();
    authenticateRuntimeAuth();
    mockEstimateProject();
    const getProjectTasks = vi.fn().mockResolvedValue([task({ title: "Supabase Task" })]);
    vi.spyOn(planningSource, "getPlanningSource").mockResolvedValue({
      mode: "supabase",
      getProjectStages: vi.fn().mockResolvedValue([]),
      getProjectTasks,
    } as never);

    const first = render(
      <QueryClientProvider client={queryClient}>
        <PlanningProbe projectId="project-1" />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(getProjectTasks).toHaveBeenCalledTimes(1));
    first.unmount();

    // Same QueryClient (cache persists, well within the 60s staleTime).
    render(
      <QueryClientProvider client={queryClient}>
        <PlanningProbe projectId="project-1" />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(getProjectTasks).toHaveBeenCalledTimes(2));
  });

  // Regression: the derived-tasks memo must survive a re-render that changes no
  // planning data. Consumers in ProjectTasks.tsx key useMemo/useCallback on the
  // returned array, so a fresh identity per render rebuilds the estimate line
  // map and remaps every task on every keystroke.
  it("keeps the derived tasks array identity stable across a re-render with no data change", async () => {
    vi.stubEnv("VITE_WORKSPACE_SOURCE", "supabase");

    const queryClient = createQueryClient();
    authenticateRuntimeAuth();
    mockEstimateProject();
    vi.spyOn(planningSource, "getPlanningSource").mockResolvedValue({
      mode: "supabase",
      getProjectStages: vi.fn().mockResolvedValue([]),
      getProjectTasks: vi.fn().mockResolvedValue([task({ title: "Supabase Task" })]),
    } as never);

    const rendered: Task[][] = [];
    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <TasksIdentityProbe projectId="project-1" tick={1} onRender={(tasks) => rendered.push(tasks)} />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("task-count")).toHaveTextContent("1");
    });

    const settled = rendered[rendered.length - 1];
    rerender(
      <QueryClientProvider client={queryClient}>
        <TasksIdentityProbe projectId="project-1" tick={2} onRender={(tasks) => rendered.push(tasks)} />
      </QueryClientProvider>,
    );

    expect(rendered.length).toBeGreaterThan(1);
    expect(rendered[rendered.length - 1]).toBe(settled);
  });
});
