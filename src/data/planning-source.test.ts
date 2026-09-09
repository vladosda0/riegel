import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  deriveEstimateTaskAssignees,
  getPlanningSource,
  mapProjectStageRowToStage,
  mapTaskRowToTask,
  overlayEstimateLinkedAssigneeFromChecklist,
  syncProjectTasksFromEstimate,
  TaskNoLongerAvailableError,
} from "@/data/planning-source";
import { getEvents } from "@/data/store";
import type { Task } from "@/types/entities";

type MockSupabaseClient = {
  from: (table: string) => unknown;
};

const supabaseRef = vi.hoisted(() => ({
  current: null as { from: (table: string) => unknown } | null,
}));

vi.mock("@/integrations/supabase/client", () => ({
  get supabase() {
    return supabaseRef.current;
  },
}));

function setMockSupabase(client: MockSupabaseClient | null) {
  supabaseRef.current = client;
}

function projectStageRow(
  overrides: Partial<Parameters<typeof mapProjectStageRowToStage>[0]> = {},
) {
  return {
    id: "stage-1",
    project_id: "project-1",
    title: "Rough-In",
    description: "Electrical and plumbing",
    sort_order: 2,
    status: "open" as const,
    discount_bps: 0,
    created_at: "2026-03-01T00:00:00.000Z",
    updated_at: "2026-03-01T00:00:00.000Z",
    ...overrides,
  };
}

function taskRow(overrides: Partial<Parameters<typeof mapTaskRowToTask>[0]> = {}) {
  return {
    id: "task-1",
    project_id: "project-1",
    stage_id: "stage-1",
    title: "Install outlets",
    description: "Wire and install outlets",
    status: "in_progress" as const,
    assignee_profile_id: "profile-2",
    estimate_work_id: "work-1",
    created_by: "profile-1",
    start_at: "2026-03-02T00:00:00.000Z",
    due_at: "2026-03-05T00:00:00.000Z",
    completed_at: null,
    created_at: "2026-03-01T00:00:00.000Z",
    updated_at: "2026-03-01T00:00:00.000Z",
    ...overrides,
  };
}

function checklistRow(
  overrides: Partial<{
    id: string;
    task_id: string;
    title: string;
    is_done: boolean;
    procurement_item_id: string | null;
    estimate_resource_line_id: string | null;
    estimate_work_id: string | null;
    sort_order: number;
    created_at: string;
    updated_at: string;
  }> = {},
) {
  return {
    id: "check-1",
    task_id: "task-1",
    title: "Checklist item",
    is_done: false,
    procurement_item_id: null,
    estimate_resource_line_id: null,
    estimate_work_id: null,
    sort_order: 1,
    created_at: "2026-03-01T00:00:00.000Z",
    updated_at: "2026-03-01T00:00:00.000Z",
    ...overrides,
  };
}

function createTaskSyncSupabaseMock(input: {
  operations: string[];
  taskRows?: Array<ReturnType<typeof taskRow>>;
  checklistRows?: Array<ReturnType<typeof checklistRow>>;
}) {
  const state = {
    taskRows: input.taskRows ?? [taskRow()],
    checklistRows: [...(input.checklistRows ?? [])],
    taskUpserts: [] as unknown[],
  };
  const duplicateKeyError = {
    message:
      'duplicate key value violates unique constraint "task_checklist_items_task_id_sort_order_key"',
  };

  const client: MockSupabaseClient = {
    from(table: string) {
      if (table === "tasks") {
        return {
          select() {
            return {
              eq() {
                return Promise.resolve({
                  data: state.taskRows,
                  error: null,
                });
              },
            };
          },
          upsert(rows: unknown[]) {
            input.operations.push(`tasks.upsert:${rows.length}`);
            state.taskUpserts = rows;
            return Promise.resolve({ error: null });
          },
          update() {
            return {
              in() {
                input.operations.push("tasks.clear");
                return Promise.resolve({ error: null });
              },
            };
          },
        };
      }

      if (table === "task_checklist_items") {
        return {
          select() {
            return {
              in(_: string, ids: string[]) {
                return Promise.resolve({
                  data: state.checklistRows.filter((row) => ids.includes(row.task_id)),
                  error: null,
                });
              },
            };
          },
          delete() {
            return {
              in(_: string, ids: string[]) {
                input.operations.push(`checklist.delete:${ids.join(",")}`);
                state.checklistRows = state.checklistRows.filter((row) => !ids.includes(row.id));
                return Promise.resolve({ error: null });
              },
            };
          },
          update(patch: { sort_order?: number }) {
            let rowId: string | null = null;
            let taskId: string | null = null;

            const applyUpdate = () => {
              if (!rowId || !taskId) {
                return null;
              }

              const row = state.checklistRows.find((entry) => entry.id === rowId && entry.task_id === taskId);
              if (!row) {
                return Promise.resolve({ error: new Error(`Missing checklist row ${rowId}`) });
              }

              if (patch.sort_order !== undefined) {
                input.operations.push(`checklist.reorder:${rowId}:${patch.sort_order}`);
                row.sort_order = patch.sort_order;
              }

              return Promise.resolve({ error: null });
            };

            const chain = {
              eq(field: string, value: string) {
                if (field === "id") rowId = value;
                if (field === "task_id") taskId = value;
                return applyUpdate() ?? chain;
              },
            };

            return chain;
          },
          upsert(rows: Array<{
            id: string;
            task_id: string;
            title: string;
            is_done: boolean;
            procurement_item_id: string | null;
            estimate_resource_line_id: string | null;
            estimate_work_id: string | null;
            sort_order: number;
          }>) {
            input.operations.push(`checklist.upsert:${rows.map((row) => `${row.id}:${row.sort_order}`).join(",")}`);

            for (const row of rows) {
              const conflictingRow = state.checklistRows.find((existingRow) => (
                existingRow.task_id === row.task_id
                && existingRow.sort_order === row.sort_order
                && existingRow.id !== row.id
              ));
              if (conflictingRow) {
                return Promise.resolve({ error: duplicateKeyError });
              }

              const existingIndex = state.checklistRows.findIndex((existingRow) => existingRow.id === row.id);
              if (existingIndex >= 0) {
                state.checklistRows[existingIndex] = {
                  ...state.checklistRows[existingIndex],
                  ...row,
                };
                continue;
              }

              state.checklistRows.push(checklistRow({
                ...row,
              }));
            }

            return Promise.resolve({ error: null });
          },
        };
      }

      throw new Error(`Unexpected table ${table}`);
    },
  };

  return {
    client,
    state,
  };
}

describe("planning-source helpers", () => {
  afterEach(() => {
    setMockSupabase(null);
  });

  it("maps project stage rows to the frontend Stage contract", () => {
    const stage = mapProjectStageRowToStage(projectStageRow({
      sort_order: 4,
      status: "completed",
    }));

    expect(stage).toEqual({
      id: "stage-1",
      project_id: "project-1",
      title: "Rough-In",
      description: "Electrical and plumbing",
      order: 4,
      status: "completed",
    });
  });

  it("maps task rows to the frontend Task contract with empty-safe defaults", () => {
    const task = mapTaskRowToTask(taskRow({
      assignee_profile_id: null,
      estimate_work_id: "work-99",
      start_at: null,
      due_at: null,
    }));

    expect(task).toEqual({
      id: "task-1",
      project_id: "project-1",
      stage_id: "stage-1",
      title: "Install outlets",
      description: "Wire and install outlets",
      status: "in_progress",
      assignee_id: "",
      assignees: [],
      checklist: [],
      comments: [],
      attachments: [],
      photos: [],
      linked_estimate_item_ids: [],
      created_at: "2026-03-01T00:00:00.000Z",
      estimateV2WorkId: "work-99",
      startDate: undefined,
      deadline: undefined,
    });
  });

  it("derives estimate task assignees with stable dedupe order", () => {
    expect(deriveEstimateTaskAssignees([
      { assigneeId: "user-1", assigneeName: "Alex", assigneeEmail: "alex@example.com" },
      { assigneeId: "user-1", assigneeName: "Alex Duplicate", assigneeEmail: "alex@example.com" },
      { assigneeId: null, assigneeName: "Crew Two", assigneeEmail: "crew2@example.com" },
      { assigneeId: null, assigneeName: "Crew Two", assigneeEmail: "crew2@example.com" },
      { assigneeId: null, assigneeName: "Crew Three", assigneeEmail: null },
    ])).toEqual([
      { id: "user-1", name: "Alex", email: "alex@example.com" },
      { id: null, name: "Crew Two", email: "crew2@example.com" },
      { id: null, name: "Crew Three", email: null },
    ]);
  });

  it("deletes stale estimate-linked checklist rows before reusing sort order", async () => {
    const operations: string[] = [];
    const { client, state } = createTaskSyncSupabaseMock({
      operations,
      checklistRows: [
        checklistRow({
          id: "check-stale",
          title: "Old line",
          estimate_resource_line_id: "line-old",
          estimate_work_id: "work-1",
          sort_order: 1,
        }),
        checklistRow({
          id: "check-keep",
          title: "Keep line",
          is_done: true,
          estimate_resource_line_id: "line-keep",
          estimate_work_id: "work-1",
          sort_order: 2,
        }),
      ],
    });

    setMockSupabase(client);

    const result = await syncProjectTasksFromEstimate({
      projectId: "project-1",
      estimateStatus: "in_work",
      works: [
        {
          id: "work-1",
          stageId: "stage-1",
          taskId: "task-1",
          title: "Install outlets",
          plannedStart: null,
          plannedEnd: null,
        },
      ],
      lines: [
        {
          id: "line-keep",
          workId: "work-1",
          title: "Updated line",
          type: "tool",
          assigneeId: null,
          assigneeName: null,
          assigneeEmail: null,
        },
      ],
      profileId: "profile-1",
    });

    expect(result).toEqual({ "work-1": "task-1" });
    expect(operations).toEqual([
      "tasks.upsert:1",
      "checklist.delete:check-stale",
      "checklist.reorder:check-keep:4",
      "checklist.upsert:check-keep:1",
    ]);
    expect(state.checklistRows).toEqual([
      expect.objectContaining({
        id: "check-keep",
        title: "Updated line",
        estimate_resource_line_id: "line-keep",
        estimate_work_id: "work-1",
        sort_order: 1,
      }),
    ]);
  });

  it("moves manual checklist rows behind estimate-linked rows during Supabase sync", async () => {
    const operations: string[] = [];
    const { client, state } = createTaskSyncSupabaseMock({
      operations,
      checklistRows: [
        checklistRow({
          id: "check-manual",
          title: "Manual follow-up",
          is_done: true,
          sort_order: 1,
        }),
        checklistRow({
          id: "check-line-material",
          title: "Old material line",
          estimate_resource_line_id: "line-material",
          estimate_work_id: "work-1",
          sort_order: 2,
        }),
        checklistRow({
          id: "check-line-tool",
          title: "Old tool line",
          estimate_resource_line_id: "line-tool",
          estimate_work_id: "work-1",
          sort_order: 3,
        }),
      ],
    });

    setMockSupabase(client);

    const result = await syncProjectTasksFromEstimate({
      projectId: "project-1",
      estimateStatus: "in_work",
      works: [
        {
          id: "work-1",
          stageId: "stage-1",
          taskId: "task-1",
          title: "Install outlets",
          plannedStart: null,
          plannedEnd: null,
        },
      ],
      lines: [
        {
          id: "line-material",
          workId: "work-1",
          title: "Material line",
          type: "material",
          assigneeId: null,
          assigneeName: null,
          assigneeEmail: null,
        },
        {
          id: "line-tool",
          workId: "work-1",
          title: "Tool line",
          type: "tool",
          assigneeId: null,
          assigneeName: null,
          assigneeEmail: null,
        },
      ],
      profileId: "profile-1",
    });

    expect(result).toEqual({ "work-1": "task-1" });
    expect(operations).toEqual([
      "tasks.upsert:1",
      "checklist.reorder:check-manual:6",
      "checklist.reorder:check-line-material:7",
      "checklist.reorder:check-line-tool:8",
      "checklist.upsert:check-line-material:1,check-line-tool:2",
      "checklist.reorder:check-manual:3",
    ]);
    expect(
      [...state.checklistRows].sort((left, right) => left.sort_order - right.sort_order || left.id.localeCompare(right.id)),
    ).toEqual([
      expect.objectContaining({
        id: "check-line-material",
        title: "Material line",
        estimate_resource_line_id: "line-material",
        estimate_work_id: "work-1",
        sort_order: 1,
      }),
      expect.objectContaining({
        id: "check-line-tool",
        title: "Tool line",
        estimate_resource_line_id: "line-tool",
        estimate_work_id: "work-1",
        sort_order: 2,
      }),
      expect.objectContaining({
        id: "check-manual",
        title: "Manual follow-up",
        is_done: true,
        estimate_resource_line_id: null,
        estimate_work_id: null,
        sort_order: 3,
      }),
    ]);
  });

  it("writes the deterministic primary assignee from estimate-owned assignee data", async () => {
    const operations: string[] = [];
    const { client, state } = createTaskSyncSupabaseMock({
      operations,
      taskRows: [
        taskRow({
          assignee_profile_id: "legacy-user",
        }),
      ],
    });

    setMockSupabase(client);

    await syncProjectTasksFromEstimate({
      projectId: "project-1",
      estimateStatus: "in_work",
      works: [
        {
          id: "work-1",
          stageId: "stage-1",
          taskId: "task-1",
          title: "Install outlets",
          plannedStart: null,
          plannedEnd: null,
        },
      ],
      lines: [
        {
          id: "line-1",
          workId: "work-1",
          title: "Labor line",
          type: "labor",
          assigneeId: "user-2",
          assigneeName: "Crew lead",
          assigneeEmail: "lead@example.com",
        },
        {
          id: "line-2",
          workId: "work-1",
          title: "Labor line 2",
          type: "labor",
          assigneeId: null,
          assigneeName: "Helper",
          assigneeEmail: "helper@example.com",
        },
      ],
      profileId: "profile-1",
    });

    expect(operations[0]).toBe("tasks.upsert:1");
    expect(state.taskUpserts).toEqual([
      expect.objectContaining({
        id: "task-1",
        assignee_profile_id: "user-2",
      }),
    ]);
  });
});

describe("overlayEstimateLinkedAssigneeFromChecklist", () => {
  it("replaces stale task assignee row with free-text from estimate-linked checklist", () => {
    const base = mapTaskRowToTask(taskRow({
      assignee_profile_id: "user-2",
      estimate_work_id: "work-1",
    }));
    const task: Task = {
      ...base,
      checklist: [
        {
          id: "c1",
          text: "Labor line",
          done: false,
          type: "subtask",
          procurementItemId: null,
          estimateV2LineId: "line-1",
          estimateV2WorkId: "work-1",
          estimateV2ResourceType: "labor",
          estimateV2AssigneeLabel: "Володя",
        },
      ],
    };
    const next = overlayEstimateLinkedAssigneeFromChecklist(task);
    expect(next.assignee_id).toBe("");
    expect(next.assignees?.[0]?.name).toBe("Володя");
    expect(next.assignees?.[0]?.id ?? null).toBeNull();
  });

  it("uses checklist profile id when present on the first sorted estimate line", () => {
    const base = mapTaskRowToTask(taskRow({
      assignee_profile_id: "user-2",
      estimate_work_id: "work-1",
    }));
    const task: Task = {
      ...base,
      checklist: [
        {
          id: "c1",
          text: "Labor",
          done: false,
          type: "subtask",
          procurementItemId: null,
          estimateV2LineId: "line-1",
          estimateV2WorkId: "work-1",
          estimateV2ResourceType: "labor",
          estimateV2AssigneeProfileId: "user-1",
        },
      ],
    };
    const next = overlayEstimateLinkedAssigneeFromChecklist(task);
    expect(next.assignee_id).toBe("user-1");
  });

  // Supabase checklist rows never carry assignee metadata (the SELECT has no
  // assignee columns) — the overlay must be enrich-only and keep the task row's
  // projection-written assignee instead of clearing it to "Unassigned".
  it("keeps the task row assignee when checklist items carry no assignee metadata", () => {
    const base = mapTaskRowToTask(taskRow({
      assignee_profile_id: "user-2",
      estimate_work_id: "work-1",
    }));
    const task: Task = {
      ...base,
      checklist: [
        {
          id: "c1",
          text: "Labor line",
          done: false,
          type: "subtask",
          procurementItemId: null,
          estimateV2LineId: "line-1",
          estimateV2WorkId: "work-1",
          estimateV2ResourceType: "labor",
        },
      ],
    };
    const next = overlayEstimateLinkedAssigneeFromChecklist(task);
    expect(next.assignee_id).toBe("user-2");
  });
});

describe("changeTaskStatus (supabase source)", () => {
  afterEach(() => setMockSupabase(null));

  async function supabaseSource() {
    return getPlanningSource({ kind: "supabase", profileId: "profile-1" });
  }

  it("calls change_task_status_v2 with trimmed comment + CAS and resolves on success", async () => {
    const rpc = vi.fn(async () => ({ data: { id: "task-1", status: "blocked" }, error: null }));
    setMockSupabase({ rpc, from: vi.fn() } as unknown as MockSupabaseClient);
    const source = await supabaseSource();

    await expect(
      source.changeTaskStatus("task-1", "blocked", { expectedStatus: "in_progress", commentBody: "  needs parts  " }),
    ).resolves.toBeUndefined();
    expect(rpc).toHaveBeenCalledWith("change_task_status_v2", {
      p_task_id: "task-1",
      p_new_status: "blocked",
      p_comment_body: "needs parts",
      p_expected_status: "in_progress",
    });
  });

  it("maps P0002 to TaskNoLongerAvailableError (converge on not-found or stale CAS)", async () => {
    setMockSupabase({
      rpc: vi.fn(async () => ({ data: null, error: { code: "P0002", message: "task status changed" } })),
      from: vi.fn(),
    } as unknown as MockSupabaseClient);
    const source = await supabaseSource();
    await expect(source.changeTaskStatus("task-1", "done")).rejects.toBeInstanceOf(TaskNoLongerAvailableError);
  });

  it("re-throws a non-converge DB error (22023 guard) raw, so the UI shows its localized fallback", async () => {
    // The raw PostgREST error is a plain object, NOT an Error instance. The
    // caller's `error instanceof Error` check must fall through to the localized
    // fallback toast rather than leaking the English Postgres guard message.
    const rawError = { code: "22023", message: "blocking a task requires a reason comment" };
    setMockSupabase({
      rpc: vi.fn(async () => ({ data: null, error: rawError })),
      from: vi.fn(),
    } as unknown as MockSupabaseClient);
    const source = await supabaseSource();
    const err = await source.changeTaskStatus("task-1", "blocked").catch((e) => e);
    expect(err).toBe(rawError);
    expect(err).not.toBeInstanceOf(TaskNoLongerAvailableError);
    expect(err).not.toBeInstanceOf(Error);
  });

  it("falls back to the legacy comment + direct update on a pre-P3 database, with the real author", async () => {
    const commentInsert = vi.fn(async () => ({ error: null }));
    const taskUpdateResult = { data: taskRow({ status: "in_progress" }), error: null };
    // tasks.update(...).eq(...).select(...).maybeSingle()
    const tasksChain = {
      update: vi.fn(() => tasksChain),
      eq: vi.fn(() => tasksChain),
      select: vi.fn(() => tasksChain),
      maybeSingle: vi.fn(async () => taskUpdateResult),
    };
    const from = vi.fn((table: string) => {
      if (table === "task_comments") return { insert: commentInsert };
      return tasksChain;
    });
    setMockSupabase({
      auth: { getSession: vi.fn(async () => ({ data: { session: { user: { id: "profile-7" } } } })) },
      rpc: vi.fn(async () => ({ data: null, error: { code: "PGRST202", message: "Could not find the function public.change_task_status_v2" } })),
      from,
    } as unknown as MockSupabaseClient);
    const source = await supabaseSource();

    await expect(
      source.changeTaskStatus("task-1", "in_progress", { commentBody: "note" }),
    ).resolves.toBeUndefined();
    expect(commentInsert).toHaveBeenCalledTimes(1);
    // The comment must carry the real session author, never an empty string
    // (author_profile_id is uuid NOT NULL and RLS requires = auth.uid()).
    expect(commentInsert).toHaveBeenCalledWith({
      task_id: "task-1",
      body: "note",
      author_profile_id: "profile-7",
    });
    expect(tasksChain.update).toHaveBeenCalledTimes(1);
  });

  it("legacy fallback with no session surfaces a non-Error so the UI localizes it", async () => {
    // Degenerate: RPC missing + a session that lapsed mid-action. The comment
    // insert must NOT be attempted (no author), and the thrown value must NOT be
    // an Error instance, so the caller's `instanceof Error` check falls through
    // to the localized fallback toast instead of leaking an English string.
    const commentInsert = vi.fn(async () => ({ error: null }));
    const from = vi.fn(() => ({ insert: commentInsert }));
    setMockSupabase({
      auth: { getSession: vi.fn(async () => ({ data: { session: null } })) },
      rpc: vi.fn(async () => ({ data: null, error: { code: "PGRST202", message: "Could not find the function public.change_task_status_v2" } })),
      from,
    } as unknown as MockSupabaseClient);
    const source = await supabaseSource();

    const err = await source
      .changeTaskStatus("task-1", "blocked", { commentBody: "note" })
      .catch((e) => e);
    expect(err).not.toBeInstanceOf(Error);
    expect(commentInsert).not.toHaveBeenCalled();
  });
});

describe("createProjectStage (browser source)", () => {
  // Both ids are built from Date.now(). Pin the clock so these prove the disambiguating
  // counter rather than the clock.
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-19T00:00:00.000Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("mints a distinct id for every stage created in one loop", async () => {
    const source = await getPlanningSource({ kind: "local" });
    const ids: string[] = [];

    for (const title of ["A", "B", "C", "D", "E"]) {
      const stage = await source.createProjectStage({
        projectId: "project-loop",
        title,
        description: "",
        order: ids.length + 1,
        status: "open",
      });
      ids.push(stage.id);
    }

    expect(new Set(ids).size).toBe(ids.length);
  });

  it("mints a distinct activity-event id for every stage created in one loop", async () => {
    const source = await getPlanningSource({ kind: "local" });

    for (const title of ["A", "B", "C", "D", "E"]) {
      await source.createProjectStage({
        projectId: "project-events",
        title,
        description: "",
        order: 1,
        status: "open",
      });
    }

    const eventIds = getEvents("project-events").map((event) => event.id);
    expect(eventIds).toHaveLength(5);
    expect(new Set(eventIds).size).toBe(eventIds.length);
  });
});
