import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ProjectTasks from "@/pages/project/ProjectTasks";
import type { ContractAction, ContractDomain } from "@/lib/permission-contract-actions";
import { seamResolveActionState } from "@/lib/permissions";
import type { ProjectAuthoritySeam } from "@/lib/project-authority-seam";
import type { MemberRole } from "@/types/entities";

const mocks = vi.hoisted(() => ({
  useProject: vi.fn(),
  useTasks: vi.fn(),
  usePermission: vi.fn(),
  useMedia: vi.fn(),
  useWorkspaceMode: vi.fn(),
  useEstimateV2Project: vi.fn(),
  useEstimateV2ProjectionCapability: vi.fn(),
  useMediaUploadMutations: vi.fn(),
  getCurrentUser: vi.fn(),
}));

vi.mock("@/hooks/use-mock-data", () => ({
  useProject: mocks.useProject,
  useTasks: mocks.useTasks,
  usePermission: mocks.usePermission,
  useMedia: mocks.useMedia,
  useWorkspaceMode: mocks.useWorkspaceMode,
}));

vi.mock("@/hooks/use-estimate-v2-data", () => ({
  useEstimateV2Project: mocks.useEstimateV2Project,
  useEstimateV2ProjectionCapability: mocks.useEstimateV2ProjectionCapability,
}));

vi.mock("@/hooks/use-planning-source", () => ({
  planningQueryKeys: {
    projectStages: (profileId: string, projectId: string) =>
      ["planning", "project-stages", profileId, projectId] as const,
    projectTasks: (profileId: string, projectId: string) =>
      ["planning", "project-tasks", profileId, projectId] as const,
  },
  usePlanningProjectTasksState: (projectId: string) => ({
    tasks: mocks.useTasks(projectId),
    isLoading: false,
  }),
}));

vi.mock("@/hooks/use-documents-media-source", () => ({
  useMediaUploadMutations: mocks.useMediaUploadMutations,
  useProjectMediaMutations: () => ({ deleteMedia: vi.fn(), updateMediaCaption: vi.fn() }),
}));

vi.mock("@/lib/permissions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/permissions")>();
  return {
    ...actual,
    usePermission: mocks.usePermission,
  };
});

vi.mock("@/data/store", () => ({
  getUserById: (id: string) => (id === "user-1" ? { id, name: "Owner" } : null),
  getCurrentUser: mocks.getCurrentUser,
  updateTask: vi.fn(),
  addTask: vi.fn(),
  deleteTask: vi.fn(),
  deleteStage: vi.fn(),
  completeStage: vi.fn(),
}));

vi.mock("@/data/planning-source", () => ({
  getPlanningSource: vi.fn(),
  TaskNoLongerAvailableError: class TaskNoLongerAvailableError extends Error {},
}));

vi.mock("@/lib/auth-state", () => ({
  getAuthRole: () => "owner",
}));

vi.mock("@/lib/analytics", () => ({
  trackEvent: vi.fn(),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

function renderProjectTasks() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/project/project-1/tasks"]}>
        <Routes>
          <Route path="/project/:id/tasks" element={<ProjectTasks />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function buildTask(overrides: Record<string, unknown> = {}) {
  return {
    id: "task-1",
    project_id: "project-1",
    stage_id: "stage-1",
    estimateV2WorkId: "work-1",
    title: "Estimate task",
    description: "Desc",
    status: "not_started",
    assignee_id: "user-1",
    assignees: [{ id: "user-1", name: "Owner", email: null }],
    checklist: [],
    comments: [],
    attachments: [],
    photos: [],
    linked_estimate_item_ids: [],
    created_at: "2026-03-01T00:00:00.000Z",
    ...overrides,
  };
}

function buildPermission(role: MemberRole) {
  const seam: ProjectAuthoritySeam = {
    projectId: "project-1",
    profileId: "user-1",
    membership: {
      project_id: "project-1",
      user_id: "user-1",
      role,
      viewer_regime: undefined,
      ai_access: "consult_only",
      finance_visibility: "summary",
      credit_limit: 0,
      used_credits: 0,
    },
    project: undefined,
  };
  return {
    seam,
    role,
    can: () => true,
    isLoading: false,
    actionState: (domain: ContractDomain, action: ContractAction) =>
      seamResolveActionState(seam, domain, action),
  };
}

describe("ProjectTasks", () => {
  beforeEach(() => {
    mocks.useProject.mockReturnValue({
      project: {
        id: "project-1",
        owner_id: "user-1",
        title: "Project One",
        type: "residential",
        project_mode: "contractor",
        automation_level: "manual",
        current_stage_id: "stage-1",
        progress_pct: 0,
      },
      stages: [
        {
          id: "stage-1",
          project_id: "project-1",
          title: "Stage One",
          description: "",
          order: 1,
          status: "open",
        },
      ],
      members: [
        {
          project_id: "project-1",
          user_id: "user-1",
          role: "owner",
          ai_access: "project_pool",
          credit_limit: 500,
          used_credits: 0,
        },
      ],
    });
    mocks.useTasks.mockReturnValue([buildTask()]);
    mocks.getCurrentUser.mockReturnValue({ id: "user-1", name: "Owner" });
    mocks.usePermission.mockReturnValue(buildPermission("owner"));
    mocks.useMedia.mockReturnValue([]);
    mocks.useWorkspaceMode.mockReturnValue({ kind: "supabase", profileId: "user-1" });
    mocks.useEstimateV2Project.mockReturnValue({
      project: {
        projectMode: "contractor",
        estimateStatus: "in_work",
      },
      works: [],
      lines: [],
      stages: [],
      sync: {
        estimateRevision: "rev-1",
        domains: {
          tasks: { status: "synced", projectedRevision: "rev-1", lastAttemptedAt: null, lastSucceededAt: null, lastError: null },
          procurement: { status: "idle", projectedRevision: null, lastAttemptedAt: null, lastSucceededAt: null, lastError: null },
          hr: { status: "idle", projectedRevision: null, lastAttemptedAt: null, lastSucceededAt: null, lastError: null },
        },
      },
    });
    mocks.useEstimateV2ProjectionCapability.mockReturnValue("projector");
    mocks.useMediaUploadMutations.mockReturnValue({
      prepareUpload: vi.fn(),
      uploadBytes: vi.fn(),
      finalizeUpload: vi.fn(),
    });
  });

  it("removes task and stage authoring controls in Supabase mode", () => {
    renderProjectTasks();

    expect(screen.queryByRole("button", { name: /New task/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /New stage/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Stage One" }));

    expect(screen.queryByRole("button", { name: /Complete stage/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Delete$/i })).not.toBeInTheDocument();
    expect(screen.getByText("Estimate task")).toBeInTheDocument();
  });

  it("keeps contractor in contribute mode without structure controls", () => {
    mocks.usePermission.mockReturnValue(buildPermission("contractor"));
    mocks.useWorkspaceMode.mockReturnValue({ kind: "local" });

    renderProjectTasks();

    expect(screen.queryByRole("button", { name: /New task/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /New stage/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Estimate task"));

    expect(screen.getByRole("button", { name: "In progress" })).toBeEnabled();
    expect(screen.getByPlaceholderText("Add a comment...")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Add photos/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Delete task/i })).not.toBeInTheDocument();
  });

  it("keeps viewer fully read-only in task detail", () => {
    mocks.usePermission.mockReturnValue(buildPermission("viewer"));
    mocks.useWorkspaceMode.mockReturnValue({ kind: "local" });

    renderProjectTasks();

    fireEvent.click(screen.getByText("Estimate task"));

    expect(screen.getByRole("button", { name: "In progress" })).toBeDisabled();
    expect(screen.queryByPlaceholderText("Add a comment...")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Add photos/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /New task/i })).not.toBeInTheDocument();
  });

  const behindSyncState = () => ({
    project: { projectMode: "contractor", estimateStatus: "in_work" },
    works: [],
    lines: [],
    stages: [],
    sync: {
      estimateRevision: "rev-2",
      domains: {
        tasks: { status: "idle", projectedRevision: "rev-1", lastAttemptedAt: null, lastSucceededAt: null, lastError: null, skipReason: null },
        procurement: { status: "idle", projectedRevision: null, lastAttemptedAt: null, lastSucceededAt: null, lastError: null, skipReason: null },
        hr: { status: "idle", projectedRevision: null, lastAttemptedAt: null, lastSucceededAt: null, lastError: null, skipReason: null },
      },
    },
  });

  it("does not block a reader session on its meaningless local projection state", () => {
    // Contractor reader: local projectedRevision never advances for them, so a
    // "behind" comparison must not gate their status changes or show a banner.
    mocks.usePermission.mockReturnValue(buildPermission("contractor"));
    mocks.useEstimateV2ProjectionCapability.mockReturnValue("reader");
    mocks.useEstimateV2Project.mockReturnValue(behindSyncState());

    renderProjectTasks();

    expect(screen.queryByText("Tasks are behind the latest Estimate")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Estimate task"));
    expect(screen.getByRole("button", { name: "In progress" })).toBeEnabled();
  });

  it("does not block a blocked_permission editor on projection state it cannot advance", () => {
    mocks.usePermission.mockReturnValue(buildPermission("co_owner"));
    mocks.useEstimateV2ProjectionCapability.mockReturnValue("blocked_permission");
    mocks.useEstimateV2Project.mockReturnValue(behindSyncState());

    renderProjectTasks();

    expect(screen.queryByText("Tasks are behind the latest Estimate")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Estimate task"));
    expect(screen.getByRole("button", { name: "In progress" })).toBeEnabled();
  });

  it("shows the behind banner but no longer blocks status changes for the projector (P3)", () => {
    mocks.useEstimateV2ProjectionCapability.mockReturnValue("projector");
    mocks.useEstimateV2Project.mockReturnValue(behindSyncState());

    renderProjectTasks();

    // The informational banner still surfaces the behind state...
    expect(screen.getByText("Tasks are behind the latest Estimate")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Estimate task"));
    // ...but the status control is now ENABLED: change_task_status_v2 preserves
    // the task's status through re-projection and converges concurrent moves via
    // P0002, so the projection-behind hard-block is gone.
    expect(screen.getByRole("button", { name: "In progress" })).toBeEnabled();
  });

  it("keys the assigned-to-me filter on the Supabase profile id, not the empty local user", () => {
    // Production shape in Supabase mode: nothing writes `auth-local-profile`, so
    // getCurrentUser() returns the empty user and its id is "". Keying the filter
    // on that id matched nothing and blanked the whole board for contractors.
    mocks.getCurrentUser.mockReturnValue({ id: "", name: "" });
    mocks.usePermission.mockReturnValue(buildPermission("contractor"));
    mocks.useWorkspaceMode.mockReturnValue({ kind: "supabase", profileId: "profile-9" });
    mocks.useTasks.mockReturnValue([
      buildTask({
        assignee_id: "profile-9",
        assignees: [{ id: "profile-9", name: "Contractor", email: null }],
      }),
    ]);

    renderProjectTasks();

    expect(screen.getByText("Estimate task")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Assigned to me/i }));

    expect(screen.getByText("Estimate task")).toBeInTheDocument();
  });
});
