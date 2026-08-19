import type { SupabaseClient } from "@supabase/supabase-js";
import * as store from "@/data/store";
import {
  resolveRuntimeWorkspaceMode,
  type RuntimeWorkspaceMode,
  type WorkspaceMode,
} from "@/data/workspace-source";
import type { ChecklistItem, ChecklistItemType, Comment, Stage, Task, TaskAssignee, TaskStatus } from "@/types/entities";
import type {
  EstimateExecutionStatus,
  EstimateV2ResourceLine,
  EstimateV2Work,
  ResourceLineType,
} from "@/types/estimate-v2";
import {
  checklistEstimateV2ResourceType,
  parsePersistedEstimateResourceType,
  resourceLineTypeFromPersisted,
} from "@/lib/estimate-v2/resource-type-contract";
import { loadEstimateOperationalSummary } from "@/data/estimate-source";
import type { Database as PlanningDatabase } from "../../backend-truth/generated/supabase-types";

type ProjectStageRow = PlanningDatabase["public"]["Tables"]["project_stages"]["Row"];
type TaskRow = PlanningDatabase["public"]["Tables"]["tasks"]["Row"];
type TaskChecklistItemRow = PlanningDatabase["public"]["Tables"]["task_checklist_items"]["Row"];
type TaskCommentRow = PlanningDatabase["public"]["Tables"]["task_comments"]["Row"];
/**
 * Local re-type that widens `resource_type` to the post-Session-0 6-value
 * `ResourceLineType` set; the generated mirror still pins the legacy 4-value
 * enum and is refreshed by the backend-truth GHA sync PR after the matching
 * `rovno-db` migration lands.
 */
type EstimateResourceLineRow = Omit<
  PlanningDatabase["public"]["Tables"]["estimate_resource_lines"]["Row"],
  "resource_type"
> & { resource_type: ResourceLineType };
type ProjectStageInsert = PlanningDatabase["public"]["Tables"]["project_stages"]["Insert"];
type TaskInsert = PlanningDatabase["public"]["Tables"]["tasks"]["Insert"];
type TaskChecklistItemInsert = PlanningDatabase["public"]["Tables"]["task_checklist_items"]["Insert"];
type TaskChecklistItemUpdate = PlanningDatabase["public"]["Tables"]["task_checklist_items"]["Update"];
type TaskCommentInsert = PlanningDatabase["public"]["Tables"]["task_comments"]["Insert"];
type TaskUpdateRow = PlanningDatabase["public"]["Tables"]["tasks"]["Update"];
type TypedSupabaseClient = SupabaseClient<PlanningDatabase>;

const PROJECT_STAGE_SELECT = "id, project_id, title, description, sort_order, status";
const TASK_SELECT = "id, project_id, stage_id, estimate_work_id, title, description, status, assignee_profile_id, created_by, created_at, start_at, due_at";
const TASK_CHECKLIST_SELECT = "id, task_id, title, is_done, procurement_item_id, estimate_resource_line_id, estimate_work_id, sort_order";
const TASK_COMMENT_SELECT = "id, task_id, author_profile_id, body, created_at";
const ESTIMATE_RESOURCE_LINE_SELECT = "id, resource_type, quantity, unit";
const RESOURCE_TYPE_ORDER: Record<ResourceLineType, number> = {
  material: 0,
  tool: 1,
  labor: 2,
  subcontractor: 3,
  overhead: 4,
  other: 5,
};

/**
 * A task write matched 0 rows: the row was re-projected under a new id or is
 * filtered by RLS for this session. Callers should refetch and inform the user
 * the list was refreshed — this is a converge signal, not a crash.
 */
export class TaskNoLongerAvailableError extends Error {
  constructor() {
    super("Task is no longer available in its previous form.");
    this.name = "TaskNoLongerAvailableError";
  }
}

export interface ChangeTaskStatusInput {
  /** The status the caller believes the task currently has. A server-side
   * mismatch (another session moved it) converges via TaskNoLongerAvailable. */
  expectedStatus?: TaskStatus;
  /** Reason/blocker comment; the RPC inserts it exactly once server-side. */
  commentBody?: string;
}

function isMissingRpcError(error: { code?: string; message?: string } | null): boolean {
  const code = error?.code;
  if (code === "PGRST202" || code === "42883") return true;
  return typeof error?.message === "string"
    && error.message.includes("change_task_status_v2")
    && /not find|does not exist/i.test(error.message);
}

export interface CreateProjectStageInput {
  projectId: string;
  title: string;
  description?: string;
  order: number;
  status?: Stage["status"];
}

export interface CreateProjectTaskInput {
  projectId: string;
  stageId: string;
  title: string;
  description?: string;
  status?: Task["status"];
  assigneeId?: string;
  createdBy: string;
  deadline?: string;
}

export interface UpdateProjectTaskInput {
  stageId?: string;
  title?: string;
  description?: string;
  status?: Task["status"];
  assigneeId?: string | null;
  deadline?: string | null;
  startDate?: string | null;
}

export interface PlanningSource {
  mode: WorkspaceMode["kind"];
  getProjectStages: (projectId: string) => Promise<Stage[]>;
  getProjectTasks: (projectId: string) => Promise<Task[]>;
  createProjectStage: (input: CreateProjectStageInput) => Promise<Stage>;
  createProjectTask: (input: CreateProjectTaskInput) => Promise<Task>;
  updateProjectTask: (taskId: string, patch: UpdateProjectTaskInput) => Promise<Task>;
  updateTaskChecklistItem: (
    taskId: string,
    itemId: string,
    patch: { done?: boolean; text?: string },
  ) => Promise<void>;
  createTaskChecklistItem: (
    taskId: string,
    input: { text: string; done?: boolean; sortOrder?: number },
  ) => Promise<void>;
  deleteTaskChecklistItem: (taskId: string, itemId: string) => Promise<void>;
  createTaskComment: (taskId: string, body: string, authorId?: string) => Promise<void>;
  /**
   * Unified task-status change: server-enforces the done/blocked guards, inserts
   * the reason comment once, and emits the P2 realtime signal. P0002 (not found
   * or a stale expectedStatus) surfaces as TaskNoLongerAvailableError to
   * converge; every other DB error (guard/permission) propagates raw so the
   * caller shows its localized fallback toast rather than an English message.
   */
  changeTaskStatus: (
    taskId: string,
    newStatus: TaskStatus,
    input?: ChangeTaskStatusInput,
  ) => Promise<void>;
}

export interface EnsureProjectStageInput {
  localStageId: string;
  remoteStageId: string;
  projectId: string;
  title: string;
  description?: string;
  order: number;
  status?: Stage["status"];
  discountBps?: number;
}

export interface HeroTaskUpsertInput {
  id: string;
  projectId: string;
  stageId: string;
  estimateWorkId?: string | null;
  title: string;
  description?: string;
  status?: Task["status"];
  assigneeId?: string | null;
  createdBy: string;
  startAt?: string | null;
  dueAt?: string | null;
}

export interface HeroTaskChecklistItemUpsertInput {
  id: string;
  taskId: string;
  title: string;
  isDone?: boolean;
  procurementItemId?: string | null;
  estimateResourceLineId?: string | null;
  estimateWorkId?: string | null;
  sortOrder: number;
}

export interface SyncProjectTasksFromEstimateInput {
  projectId: string;
  estimateStatus: EstimateExecutionStatus;
  works: Array<Pick<EstimateV2Work, "id" | "stageId" | "taskId" | "title" | "plannedStart" | "plannedEnd">>;
  lines: Array<Pick<EstimateV2ResourceLine, "id" | "workId" | "title" | "type" | "assigneeId" | "assigneeName" | "assigneeEmail">>;
  profileId: string;
}

interface ChecklistSortOrderUpdate {
  id: string;
  taskId: string;
  sortOrder: number;
}

function mapTaskPatchToTaskUpdateRow(patch: UpdateProjectTaskInput): TaskUpdateRow {
  const update: TaskUpdateRow = {};

  if (patch.stageId !== undefined) {
    update.stage_id = patch.stageId;
  }
  if (patch.title !== undefined) {
    update.title = patch.title;
  }
  if (patch.description !== undefined) {
    update.description = patch.description;
  }
  if (patch.status !== undefined) {
    update.status = patch.status;
  }
  if (patch.assigneeId !== undefined) {
    update.assignee_profile_id = patch.assigneeId || null;
  }
  if (patch.deadline !== undefined) {
    update.due_at = patch.deadline;
  }
  if (patch.startDate !== undefined) {
    update.start_at = patch.startDate;
  }

  return update;
}

function getProtectedTaskPatchFields(
  patch: UpdateProjectTaskInput,
): Array<keyof UpdateProjectTaskInput> {
  const protectedFields: Array<keyof UpdateProjectTaskInput> = [];
  if (patch.title !== undefined) protectedFields.push("title");
  if (patch.stageId !== undefined) protectedFields.push("stageId");
  if (patch.startDate !== undefined) protectedFields.push("startDate");
  if (patch.deadline !== undefined) protectedFields.push("deadline");
  if (patch.assigneeId !== undefined) protectedFields.push("assigneeId");
  return protectedFields;
}

function isEstimateLinkedTaskRow(
  row: Pick<TaskRow, "estimate_work_id">,
): boolean {
  return Boolean(row.estimate_work_id);
}

function isEstimateLinkedChecklistRow(
  row: Pick<TaskChecklistItemRow, "estimate_resource_line_id" | "estimate_work_id">,
): boolean {
  return Boolean(row.estimate_resource_line_id || row.estimate_work_id);
}

function defaultTaskIdForEstimateWork(workId: string): string {
  return workId;
}

function sortEstimateLinesForChecklist<T extends Pick<EstimateV2ResourceLine, "id" | "type">>(
  lines: T[],
): T[] {
  return [...lines].sort((left, right) => {
    const typeDiff = RESOURCE_TYPE_ORDER[left.type] - RESOURCE_TYPE_ORDER[right.type];
    if (typeDiff !== 0) return typeDiff;
    return left.id.localeCompare(right.id);
  });
}

/** Labor / subcontractor lines only — same slice HR uses for estimate-driven people. */
export function pickEstimateLinesForTaskAssigneeProjection(
  lines: Array<Pick<EstimateV2ResourceLine, "type" | "assigneeId" | "assigneeName" | "assigneeEmail">>,
): Array<Pick<EstimateV2ResourceLine, "assigneeId" | "assigneeName" | "assigneeEmail">> {
  return lines
    .filter((line) => line.type === "labor" || line.type === "subcontractor")
    .map((line) => ({
      assigneeId: line.assigneeId,
      assigneeName: line.assigneeName,
      assigneeEmail: line.assigneeEmail,
    }));
}

function normalizeTaskAssigneeIdentity(
  line: Pick<EstimateV2ResourceLine, "assigneeId" | "assigneeName" | "assigneeEmail">,
): string | null {
  const assigneeId = line.assigneeId?.trim();
  if (assigneeId) return `id:${assigneeId}`;

  const assigneeEmail = line.assigneeEmail?.trim().toLowerCase();
  if (assigneeEmail) return `email:${assigneeEmail}`;

  const assigneeName = line.assigneeName?.trim().toLowerCase();
  if (assigneeName) return `name:${assigneeName}`;

  return null;
}

export function deriveEstimateTaskAssignees(
  lines: Array<Pick<EstimateV2ResourceLine, "assigneeId" | "assigneeName" | "assigneeEmail">>,
): TaskAssignee[] {
  const assignees: TaskAssignee[] = [];
  const seen = new Set<string>();

  lines.forEach((line) => {
    const identity = normalizeTaskAssigneeIdentity(line);
    if (!identity || seen.has(identity)) {
      return;
    }

    seen.add(identity);
    assignees.push({
      id: line.assigneeId?.trim() || null,
      name: line.assigneeName?.trim() || null,
      email: line.assigneeEmail?.trim() || null,
    });
  });

  return assignees;
}

export function getPrimaryEstimateTaskAssigneeId(
  assignees: TaskAssignee[],
): string | null {
  return assignees.find((assignee) => Boolean(assignee.id))?.id ?? null;
}

// The onboarding stages step creates several stages back to back in one loop, and
// Date.now() alone repeats across those iterations, so every row would share one id.
let browserStageSeq = 0;

function createBrowserPlanningSource(mode: "demo" | "local"): PlanningSource {
  return {
    mode,
    async getProjectStages(projectId: string) {
      return store.getStages(projectId);
    },
    async getProjectTasks(projectId: string) {
      return store.getTasks(projectId);
    },

    async createProjectStage(input: CreateProjectStageInput) {
      const stage: Stage = {
        id: `stage-${Date.now()}-${(browserStageSeq += 1)}`,
        project_id: input.projectId,
        title: input.title,
        description: input.description ?? "",
        order: input.order,
        status: input.status ?? "open",
      };

      store.addStage(stage);
      return stage;
    },

    async createProjectTask(input: CreateProjectTaskInput) {
      const task: Task = {
        id: `task-${Date.now()}`,
        project_id: input.projectId,
        stage_id: input.stageId,
        estimateV2WorkId: undefined,
        title: input.title,
        description: input.description ?? "",
        status: input.status ?? "not_started",
        assignee_id: input.assigneeId ?? "",
        assignees: input.assigneeId ? [{ id: input.assigneeId, name: null, email: null }] : [],
        checklist: [],
        comments: [],
        attachments: [],
        photos: [],
        linked_estimate_item_ids: [],
        created_at: new Date().toISOString(),
        deadline: input.deadline ?? undefined,
      };

      store.addTask(task);
      return task;
    },

    async updateProjectTask(taskId: string, patch: UpdateProjectTaskInput) {
      const update: Partial<Task> = {};

      if (patch.stageId !== undefined) {
        update.stage_id = patch.stageId;
      }
      if (patch.title !== undefined) {
        update.title = patch.title;
      }
      if (patch.description !== undefined) {
        update.description = patch.description;
      }
      if (patch.status !== undefined) {
        update.status = patch.status;
      }
      if (patch.assigneeId !== undefined) {
        update.assignee_id = patch.assigneeId ?? "";
        update.assignees = patch.assigneeId
          ? [{ id: patch.assigneeId, name: null, email: null }]
          : [];
      }
      if (patch.deadline !== undefined) {
        update.deadline = patch.deadline ?? undefined;
      }
      if (patch.startDate !== undefined) {
        update.startDate = patch.startDate ?? undefined;
      }

      store.updateTask(taskId, update);
      const task = store.getTask(taskId);
      if (!task) {
        throw new Error(`Task not found: ${taskId}`);
      }

      return task;
    },
    async updateTaskChecklistItem(taskId: string, itemId: string, patch: { done?: boolean; text?: string }) {
      const task = store.getTask(taskId);
      if (!task) {
        throw new Error(`Task not found: ${taskId}`);
      }
      const nextChecklist = task.checklist.map((item) => (
        item.id === itemId
          ? {
              ...item,
              done: patch.done ?? item.done,
              text: patch.text ?? item.text,
            }
          : item
      ));
      store.updateChecklist(taskId, nextChecklist);
    },
    async createTaskChecklistItem(taskId: string, input: { text: string; done?: boolean; sortOrder?: number }) {
      store.addChecklistItem(taskId, {
        id: `cl-${Date.now()}`,
        text: input.text,
        done: input.done ?? false,
        type: "subtask",
      });
    },
    async deleteTaskChecklistItem(taskId: string, itemId: string) {
      store.deleteChecklistItem(taskId, itemId);
    },
    async createTaskComment(taskId: string, body: string) {
      store.addComment(taskId, body);
    },
    async changeTaskStatus(taskId: string, newStatus: TaskStatus, input?: ChangeTaskStatusInput) {
      const task = store.getTask(taskId);
      if (!task) {
        throw new Error(`Task not found: ${taskId}`);
      }
      if (input?.commentBody && input.commentBody.trim().length > 0) {
        store.addComment(taskId, input.commentBody.trim());
      }
      store.updateTask(taskId, { status: newStatus });
    },
  };
}

export function mapProjectStageRowToStage(
  row: Pick<ProjectStageRow, "id" | "project_id" | "title" | "description" | "sort_order" | "status">,
): Stage {
  return {
    id: row.id,
    project_id: row.project_id,
    title: row.title,
    description: row.description ?? "",
    order: row.sort_order,
    status: row.status,
  };
}

export function mapTaskRowToTask(
  row: Pick<TaskRow, "id" | "project_id" | "stage_id" | "estimate_work_id" | "title" | "description" | "status" | "assignee_profile_id" | "created_by" | "created_at" | "start_at" | "due_at">,
): Task {
  return {
    id: row.id,
    project_id: row.project_id,
    stage_id: row.stage_id,
    estimateV2WorkId: row.estimate_work_id ?? undefined,
    title: row.title,
    description: row.description ?? "",
    status: row.status,
    assignee_id: row.assignee_profile_id ?? "",
    assignees: row.assignee_profile_id
      ? [{ id: row.assignee_profile_id, name: null, email: null }]
      : [],
    checklist: [],
    comments: [],
    attachments: [],
    photos: [],
    linked_estimate_item_ids: [],
    created_at: row.created_at,
    startDate: row.start_at ?? undefined,
    deadline: row.due_at ?? undefined,
  };
}

function resourceLineTypeForChecklistAssigneeSort(item: ChecklistItem): ResourceLineType {
  const mapped = checklistEstimateV2ResourceType(item.estimateV2ResourceType);
  if (
    mapped === "material"
    || mapped === "tool"
    || mapped === "labor"
    || mapped === "subcontractor"
    || mapped === "other"
  ) {
    return mapped;
  }
  return "other";
}

/**
 * Hero `tasks.assignee_profile_id` can lag estimate lines after edits. Checklist rows
 * (when they carry assignee metadata — demo/local stores do, the Supabase checklist
 * SELECT does not) refine the task-level assignee for UI/filters.
 *
 * ENRICH-ONLY: when no checklist item carries assignee data, keep the task row's own
 * `assignee_profile_id` — it was written by the estimate projection and is the only
 * assignee truth available to sessions that cannot read estimate lines under RLS.
 * Clearing it here rendered every estimate-linked task "Unassigned" for those users.
 */
export function overlayEstimateLinkedAssigneeFromChecklist(task: Task): Task {
  if (!task.estimateV2WorkId) return task;

  const estimateItems = task.checklist
    .filter((item) => Boolean(item.estimateV2LineId))
    .sort((a, b) => {
      const orderA = RESOURCE_TYPE_ORDER[resourceLineTypeForChecklistAssigneeSort(a)];
      const orderB = RESOURCE_TYPE_ORDER[resourceLineTypeForChecklistAssigneeSort(b)];
      if (orderA !== orderB) return orderA - orderB;
      return (a.estimateV2LineId ?? "").localeCompare(b.estimateV2LineId ?? "");
    });

  if (estimateItems.length === 0) return task;

  for (const item of estimateItems) {
    const profileId = item.estimateV2AssigneeProfileId?.trim() || null;
    if (profileId) {
      return {
        ...task,
        assignee_id: profileId,
        assignees: [{ id: profileId, name: null, email: null }],
      };
    }
    const label = item.estimateV2AssigneeLabel?.trim() || null;
    if (label) {
      return {
        ...task,
        assignee_id: "",
        assignees: [{ id: null, name: label, email: null }],
      };
    }
  }

  return task;
}

function mapEstimateResourceTypeToChecklistType(
  resourceType: string | null | undefined,
): ChecklistItemType {
  if (resourceType == null) return "subtask";
  const parsed = parsePersistedEstimateResourceType(resourceType);
  if (!parsed.ok) return "subtask";
  const appType = resourceLineTypeFromPersisted(parsed.db);
  if (appType === "material") return "material";
  if (appType === "tool") return "tool";
  return "subtask";
}

function mapTaskChecklistItemRowToChecklistItem(
  row: Pick<TaskChecklistItemRow, "id" | "task_id" | "title" | "is_done" | "procurement_item_id" | "estimate_resource_line_id" | "estimate_work_id" | "sort_order">,
  lineById: Map<string, Pick<EstimateResourceLineRow, "id" | "resource_type" | "quantity" | "unit">>,
): ChecklistItem {
  const linkedLine = row.estimate_resource_line_id
    ? lineById.get(row.estimate_resource_line_id)
    : undefined;
  const resourceType = linkedLine?.resource_type;

  return {
    id: row.id,
    text: row.title,
    done: row.is_done,
    type: mapEstimateResourceTypeToChecklistType(resourceType),
    procurementItemId: row.procurement_item_id ?? null,
    estimateV2LineId: row.estimate_resource_line_id ?? undefined,
    estimateV2WorkId: row.estimate_work_id ?? undefined,
    estimateV2ResourceType: checklistEstimateV2ResourceType(resourceType),
    estimateV2QtyMilli: linkedLine?.quantity != null
      ? Math.max(1, Math.round(linkedLine.quantity * 1_000))
      : undefined,
    estimateV2Unit: linkedLine?.unit ?? undefined,
  };
}

function mapTaskCommentRowToComment(row: TaskCommentRow): Comment {
  return {
    id: row.id,
    author_id: row.author_profile_id,
    text: row.body,
    created_at: row.created_at,
  };
}

async function loadSupabaseClient(): Promise<TypedSupabaseClient> {
  const { supabase } = await import("@/integrations/supabase/client");
  return supabase as unknown as TypedSupabaseClient;
}

export async function ensureProjectStages(
  supabase: TypedSupabaseClient,
  inputs: EnsureProjectStageInput[],
): Promise<Record<string, string>> {
  if (inputs.length === 0) {
    return {};
  }

  const projectId = inputs[0].projectId;
  const { data, error } = await supabase
    .from("project_stages")
    .select("id, project_id, title, description, sort_order, status, discount_bps")
    .eq("project_id", projectId);

  if (error) {
    throw error;
  }

  const remoteRows = data ?? [];
  const mapping: Record<string, string> = {};
  const rowsToUpsert: ProjectStageInsert[] = [];

  inputs.forEach((input) => {
    const deterministicMatch = remoteRows.find((row) => row.id === input.remoteStageId) ?? null;
    const exactMatches = remoteRows.filter((row) => (
      row.title === input.title && row.sort_order === input.order
    ));

    if (exactMatches.length > 1) {
      throw new Error(`Ambiguous remote stage mapping for "${input.title}"`);
    }

    const resolvedId = deterministicMatch?.id ?? exactMatches[0]?.id ?? input.remoteStageId;
    mapping[input.localStageId] = resolvedId;

    rowsToUpsert.push({
      id: resolvedId,
      project_id: input.projectId,
      title: input.title,
      description: input.description ?? "",
      sort_order: input.order,
      status: input.status ?? "open",
      discount_bps: input.discountBps ?? 0,
    });
  });

  const { error: upsertError } = await supabase
    .from("project_stages")
    .upsert(rowsToUpsert, { onConflict: "id" });

  if (upsertError) {
    throw upsertError;
  }

  return mapping;
}

export async function upsertHeroTasks(
  supabase: TypedSupabaseClient,
  inputs: HeroTaskUpsertInput[],
): Promise<void> {
  if (inputs.length === 0) return;

  const rows: TaskInsert[] = inputs.map((input) => ({
    id: input.id,
    project_id: input.projectId,
    stage_id: input.stageId,
    estimate_work_id: input.estimateWorkId ?? null,
    title: input.title,
    description: input.description ?? "",
    status: input.status ?? "not_started",
    assignee_profile_id: input.assigneeId ?? null,
    created_by: input.createdBy,
    start_at: input.startAt ?? null,
    due_at: input.dueAt ?? null,
  }));

  const { error } = await supabase
    .from("tasks")
    .upsert(rows, { onConflict: "id" });

  if (error) {
    throw error;
  }
}

export async function loadHeroTasksForProject(
  supabase: TypedSupabaseClient,
  projectId: string,
): Promise<TaskRow[]> {
  const { data, error } = await supabase
    .from("tasks")
    .select("id, project_id, stage_id, estimate_work_id, title, description, status, assignee_profile_id, created_by, start_at, due_at, completed_at, created_at, updated_at")
    .eq("project_id", projectId);

  if (error) {
    throw error;
  }

  return data ?? [];
}

async function loadHeroTaskChecklistItemsByTaskIds(
  supabase: TypedSupabaseClient,
  taskIds: string[],
): Promise<TaskChecklistItemRow[]> {
  if (taskIds.length === 0) {
    return [];
  }

  const { data, error } = await supabase
    .from("task_checklist_items")
    .select("id, task_id, title, is_done, procurement_item_id, estimate_resource_line_id, estimate_work_id, sort_order, created_at, updated_at")
    .in("task_id", taskIds);

  if (error) {
    throw error;
  }

  return data ?? [];
}

async function clearEstimateWorkIdForTasks(
  supabase: TypedSupabaseClient,
  ids: string[],
): Promise<void> {
  if (ids.length === 0) return;

  const { error } = await supabase
    .from("tasks")
    .update({ estimate_work_id: null })
    .in("id", ids);

  if (error) {
    throw error;
  }
}

export async function upsertTaskChecklistItems(
  supabase: TypedSupabaseClient,
  inputs: HeroTaskChecklistItemUpsertInput[],
): Promise<void> {
  if (inputs.length === 0) return;

  const rows: TaskChecklistItemInsert[] = inputs.map((input) => ({
    id: input.id,
    task_id: input.taskId,
    title: input.title,
    is_done: input.isDone ?? false,
    procurement_item_id: input.procurementItemId ?? null,
    estimate_resource_line_id: input.estimateResourceLineId ?? null,
    estimate_work_id: input.estimateWorkId ?? null,
    sort_order: input.sortOrder,
  }));

  const { error } = await supabase
    .from("task_checklist_items")
    .upsert(rows, { onConflict: "id" });

  if (error) {
    throw error;
  }
}

export async function loadHeroTaskChecklistItemsByEstimateWorkIds(
  supabase: TypedSupabaseClient,
  estimateWorkIds: string[],
): Promise<TaskChecklistItemRow[]> {
  if (estimateWorkIds.length === 0) {
    return [];
  }

  const { data, error } = await supabase
    .from("task_checklist_items")
    .select("id, task_id, title, is_done, procurement_item_id, estimate_resource_line_id, estimate_work_id, sort_order, created_at, updated_at")
    .in("estimate_work_id", estimateWorkIds);

  if (error) {
    throw error;
  }

  return data ?? [];
}

export async function deleteHeroTaskChecklistItems(
  supabase: TypedSupabaseClient,
  ids: string[],
): Promise<void> {
  if (ids.length === 0) return;

  const { error } = await supabase
    .from("task_checklist_items")
    .delete()
    .in("id", ids);

  if (error) {
    throw error;
  }
}

async function updateTaskChecklistSortOrders(
  supabase: TypedSupabaseClient,
  updates: ChecklistSortOrderUpdate[],
): Promise<void> {
  for (const update of updates) {
    const patch: TaskChecklistItemUpdate = {
      sort_order: update.sortOrder,
    };
    const { error } = await supabase
      .from("task_checklist_items")
      .update(patch)
      .eq("id", update.id)
      .eq("task_id", update.taskId);

    if (error) {
      throw error;
    }
  }
}

export async function deleteHeroTasks(
  supabase: TypedSupabaseClient,
  ids: string[],
): Promise<void> {
  if (ids.length === 0) return;

  const { error } = await supabase
    .from("tasks")
    .delete()
    .in("id", ids);

  if (error) {
    throw error;
  }
}

export async function syncProjectTasksFromEstimate(
  input: SyncProjectTasksFromEstimateInput,
): Promise<Record<string, string>> {
  if (input.estimateStatus === "planning") {
    return {};
  }

  const supabase = await loadSupabaseClient();
  const taskRows = await loadHeroTasksForProject(supabase, input.projectId);
  const desiredWorkIds = new Set(input.works.map((work) => work.id));
  const taskRowByEstimateWorkId = new Map<string, TaskRow>();
  const taskRowById = new Map(taskRows.map((row) => [row.id, row]));

  taskRows.forEach((row) => {
    if (!row.estimate_work_id) return;
    if (!taskRowByEstimateWorkId.has(row.estimate_work_id)) {
      taskRowByEstimateWorkId.set(row.estimate_work_id, row);
    }
  });

  const staleLinkedTaskIds = taskRows
    .filter((row) => row.estimate_work_id && !desiredWorkIds.has(row.estimate_work_id))
    .map((row) => row.id);

  if (staleLinkedTaskIds.length > 0) {
    await clearEstimateWorkIdForTasks(supabase, staleLinkedTaskIds);
  }

  const linesByWorkId = new Map<string, Array<Pick<EstimateV2ResourceLine, "id" | "type" | "title" | "assigneeId" | "assigneeName" | "assigneeEmail">>>();
  input.lines.forEach((line) => {
    const list = linesByWorkId.get(line.workId) ?? [];
    list.push(line);
    linesByWorkId.set(line.workId, list);
  });

  const taskIdByWorkId: Record<string, string> = {};
  const taskUpserts: HeroTaskUpsertInput[] = input.works.map((work) => {
    const existingRow = taskRowByEstimateWorkId.get(work.id)
      ?? (work.taskId ? taskRowById.get(work.taskId) ?? null : null);
    const taskId = existingRow?.id ?? work.taskId ?? defaultTaskIdForEstimateWork(work.id);
    const derivedAssignees = deriveEstimateTaskAssignees(
      pickEstimateLinesForTaskAssigneeProjection(linesByWorkId.get(work.id) ?? []),
    );
    taskIdByWorkId[work.id] = taskId;

    return {
      id: taskId,
      projectId: input.projectId,
      stageId: work.stageId,
      estimateWorkId: work.id,
      title: work.title,
      description: existingRow?.description ?? "Auto-created from Estimate v2 work",
      status: existingRow?.status ?? "not_started",
      assigneeId: getPrimaryEstimateTaskAssigneeId(derivedAssignees) ?? null,
      createdBy: existingRow?.created_by ?? input.profileId,
      startAt: work.plannedStart ?? null,
      dueAt: work.plannedEnd ?? null,
    };
  });

  // Re-read statuses immediately before the write so this projection never
  // clobbers a status another session changed while it was computing. The
  // server sync_estimate_projection RPC preserves status by excluding it from
  // its ON CONFLICT set-list; this legacy client fallback (reached only on a
  // pre-P1 DB that lacks the RPC) has no such guarantee, so it must carry the
  // freshest value rather than the one read at the top of the function.
  const freshStatusById = new Map(
    (await loadHeroTasksForProject(supabase, input.projectId)).map((row) => [row.id, row.status]),
  );
  const freshTaskUpserts = taskUpserts.map((upsert) => {
    const freshStatus = freshStatusById.get(upsert.id);
    return freshStatus === undefined ? upsert : { ...upsert, status: freshStatus };
  });

  await upsertHeroTasks(supabase, freshTaskUpserts);

  const checklistRows = await loadHeroTaskChecklistItemsByTaskIds(
    supabase,
    Array.from(new Set([...Object.values(taskIdByWorkId), ...staleLinkedTaskIds])),
  );
  const activeTaskIds = new Set(Object.values(taskIdByWorkId));
  const existingChecklistRowByEstimateLineId = new Map<string, TaskChecklistItemRow>();
  const checklistRowsByTaskId = new Map<string, TaskChecklistItemRow[]>();
  checklistRows.forEach((row) => {
    const rowsForTask = checklistRowsByTaskId.get(row.task_id) ?? [];
    rowsForTask.push(row);
    checklistRowsByTaskId.set(row.task_id, rowsForTask);
    if (!row.estimate_resource_line_id) return;
    if (!existingChecklistRowByEstimateLineId.has(row.estimate_resource_line_id)) {
      existingChecklistRowByEstimateLineId.set(row.estimate_resource_line_id, row);
    }
  });

  const checklistUpserts = input.works.flatMap((work) => (
    sortEstimateLinesForChecklist(linesByWorkId.get(work.id) ?? []).map((line, index) => {
      const existingChecklistRow = existingChecklistRowByEstimateLineId.get(line.id) ?? null;
      return {
        id: existingChecklistRow?.id ?? line.id,
        taskId: taskIdByWorkId[work.id],
        title: line.title,
        isDone: existingChecklistRow?.is_done ?? false,
        procurementItemId: existingChecklistRow?.procurement_item_id ?? null,
        estimateResourceLineId: line.id,
        estimateWorkId: work.id,
        sortOrder: index + 1,
      } satisfies HeroTaskChecklistItemUpsertInput;
    })
  ));
  const checklistUpsertsByTaskId = new Map<string, HeroTaskChecklistItemUpsertInput[]>();
  checklistUpserts.forEach((input) => {
    const rowsForTask = checklistUpsertsByTaskId.get(input.taskId) ?? [];
    rowsForTask.push(input);
    checklistUpsertsByTaskId.set(input.taskId, rowsForTask);
  });

  const desiredLineIds = new Set(input.lines.map((line) => line.id));
  const checklistIdsToDelete = checklistRows
    .filter(isEstimateLinkedChecklistRow)
    .filter((row) => {
      if (!row.estimate_work_id || !desiredWorkIds.has(row.estimate_work_id)) {
        return true;
      }
      return !row.estimate_resource_line_id || !desiredLineIds.has(row.estimate_resource_line_id);
    })
    .map((row) => row.id);
  const checklistIdsToDeleteSet = new Set(checklistIdsToDelete);

  if (checklistIdsToDelete.length > 0) {
    await deleteHeroTaskChecklistItems(supabase, checklistIdsToDelete);
  }

  const temporarySortOrderUpdates: ChecklistSortOrderUpdate[] = [];
  const finalManualSortOrderUpdates: ChecklistSortOrderUpdate[] = [];

  activeTaskIds.forEach((taskId) => {
    const desiredRows = checklistUpsertsByTaskId.get(taskId) ?? [];
    if (desiredRows.length === 0) {
      return;
    }

    const retainedRows = (checklistRowsByTaskId.get(taskId) ?? [])
      .filter((row) => !checklistIdsToDeleteSet.has(row.id))
      .sort((left, right) => left.sort_order - right.sort_order || left.id.localeCompare(right.id));

    if (retainedRows.length === 0) {
      return;
    }

    const maxSortOrder = retainedRows.reduce((max, row) => Math.max(max, row.sort_order), 0);
    const temporaryBase = maxSortOrder + desiredRows.length;
    retainedRows.forEach((row, index) => {
      temporarySortOrderUpdates.push({
        id: row.id,
        taskId,
        sortOrder: temporaryBase + index + 1,
      });
    });

    retainedRows
      .filter((row) => !isEstimateLinkedChecklistRow(row))
      .forEach((row, index) => {
        finalManualSortOrderUpdates.push({
          id: row.id,
          taskId,
          sortOrder: desiredRows.length + index + 1,
        });
      });
  });

  await updateTaskChecklistSortOrders(supabase, temporarySortOrderUpdates);
  await upsertTaskChecklistItems(supabase, checklistUpserts);
  await updateTaskChecklistSortOrders(supabase, finalManualSortOrderUpdates);

  return taskIdByWorkId;
}

function createSupabasePlanningSource(
  supabase: TypedSupabaseClient,
): PlanningSource {
  return {
    mode: "supabase",
    async getProjectStages(projectId: string) {
      const { data, error } = await supabase
        .from("project_stages")
        .select(PROJECT_STAGE_SELECT)
        .eq("project_id", projectId)
        .order("sort_order", { ascending: true });

      if (error) {
        throw error;
      }

      return (data ?? []).map(mapProjectStageRowToStage);
    },

    async getProjectTasks(projectId: string) {
      const { data, error } = await supabase
        .from("tasks")
        .select(TASK_SELECT)
        .eq("project_id", projectId)
        .order("created_at", { ascending: true });

      if (error) {
        throw error;
      }

      const taskRows = data ?? [];
      if (taskRows.length === 0) {
        return [];
      }

      const taskIds = taskRows.map((row) => row.id);
      const { data: checklistRows, error: checklistError } = await supabase
        .from("task_checklist_items")
        .select(TASK_CHECKLIST_SELECT)
        .in("task_id", taskIds)
        .order("sort_order", { ascending: true });

      if (checklistError) {
        throw checklistError;
      }
      const { data: commentRows, error: commentError } = await supabase
        .from("task_comments")
        .select(TASK_COMMENT_SELECT)
        .in("task_id", taskIds)
        .order("created_at", { ascending: true });

      if (commentError) {
        throw commentError;
      }

      const estimateLineIds = Array.from(new Set(
        (checklistRows ?? [])
          .map((row) => row.estimate_resource_line_id)
          .filter((value): value is string => Boolean(value)),
      ));
      const estimateLineIdSet = new Set(estimateLineIds);

      let estimateLineRows: Array<Pick<EstimateResourceLineRow, "id" | "resource_type" | "quantity" | "unit">> = [];
      if (estimateLineIds.length > 0) {
        const { data: lineRows, error: lineError } = await supabase
          .from("estimate_resource_lines")
          .select(ESTIMATE_RESOURCE_LINE_SELECT)
          .in("id", estimateLineIds);

        if (lineError) {
          throw lineError;
        }

        estimateLineRows = lineRows ?? [];
      }

      const lineById = new Map(estimateLineRows.map((row) => [row.id, row]));

      if (estimateLineIds.length > lineById.size) {
        try {
          const op = await loadEstimateOperationalSummary(projectId, null);
          for (const rl of op?.resourceLines ?? []) {
            if (!estimateLineIdSet.has(rl.estimate_resource_line_id)) continue;
            if (lineById.has(rl.estimate_resource_line_id)) continue;
            lineById.set(rl.estimate_resource_line_id, {
              id: rl.estimate_resource_line_id,
              resource_type: rl.resource_type,
              quantity: rl.quantity,
              unit: rl.unit,
            });
          }
        } catch {
          /* tasks still load; checklist types may stay incomplete */
        }
      }

      const checklistByTaskId = new Map<string, ChecklistItem[]>();
      const commentsByTaskId = new Map<string, Comment[]>();

      (checklistRows ?? []).forEach((row) => {
        const list = checklistByTaskId.get(row.task_id) ?? [];
        list.push(mapTaskChecklistItemRowToChecklistItem(row, lineById));
        checklistByTaskId.set(row.task_id, list);
      });
      (commentRows ?? []).forEach((row) => {
        const list = commentsByTaskId.get(row.task_id) ?? [];
        list.push(mapTaskCommentRowToComment(row));
        commentsByTaskId.set(row.task_id, list);
      });

      return taskRows.map((row) => {
        const merged: Task = {
          ...mapTaskRowToTask(row),
          checklist: checklistByTaskId.get(row.id) ?? [],
          comments: commentsByTaskId.get(row.id) ?? [],
        };
        return overlayEstimateLinkedAssigneeFromChecklist(merged);
      });
    },

    async createProjectStage(input: CreateProjectStageInput) {
      const insert: ProjectStageInsert = {
        project_id: input.projectId,
        title: input.title,
        description: input.description ?? "",
        sort_order: input.order,
        status: input.status ?? "open",
      };

      const { data, error } = await supabase
        .from("project_stages")
        .insert(insert)
        .select(PROJECT_STAGE_SELECT)
        .single();

      if (error) {
        throw error;
      }

      return mapProjectStageRowToStage(data);
    },

    async createProjectTask(input: CreateProjectTaskInput) {
      const insert: TaskInsert = {
        project_id: input.projectId,
        stage_id: input.stageId,
        estimate_work_id: null,
        title: input.title,
        description: input.description ?? "",
        status: input.status ?? "not_started",
        assignee_profile_id: input.assigneeId || null,
        created_by: input.createdBy,
        due_at: input.deadline ?? null,
      };

      const { data, error } = await supabase
        .from("tasks")
        .insert(insert)
        .select(TASK_SELECT)
        .single();

      if (error) {
        throw error;
      }

      return mapTaskRowToTask(data);
    },

    async updateProjectTask(taskId: string, patch: UpdateProjectTaskInput) {
      const protectedFields = getProtectedTaskPatchFields(patch);
      if (protectedFields.length > 0) {
        const { data: currentRow, error: currentRowError } = await supabase
          .from("tasks")
          .select("id, estimate_work_id")
          .eq("id", taskId)
          .maybeSingle();

        if (currentRowError) {
          throw currentRowError;
        }

        if (currentRow && isEstimateLinkedTaskRow(currentRow)) {
          throw new Error("Estimate-derived task structure and assignees are read-only in Supabase mode.");
        }
      }

      const { data, error } = await supabase
        .from("tasks")
        .update(mapTaskPatchToTaskUpdateRow(patch))
        .eq("id", taskId)
        .select(TASK_SELECT)
        .maybeSingle();

      if (error) {
        throw error;
      }

      // 0 rows = the task vanished from this session's view (re-projected under a
      // new id, or filtered by RLS). Surface a converge-able "task changed" error
      // instead of PostgREST's opaque "JSON object requested…" crash.
      if (!data) {
        throw new TaskNoLongerAvailableError();
      }

      return mapTaskRowToTask(data);
    },
    async updateTaskChecklistItem(taskId: string, itemId: string, patch: { done?: boolean; text?: string }) {
      if (patch.text !== undefined) {
        const { data: currentRow, error: currentRowError } = await supabase
          .from("task_checklist_items")
          .select("id, estimate_resource_line_id, estimate_work_id")
          .eq("id", itemId)
          .eq("task_id", taskId)
          .maybeSingle();

        if (currentRowError) throw currentRowError;

        if (currentRow?.estimate_resource_line_id || currentRow?.estimate_work_id) {
          throw new Error("Estimate-linked checklist text is read-only in Supabase mode.");
        }
      }

      const rowPatch: PlanningDatabase["public"]["Tables"]["task_checklist_items"]["Update"] = {};
      if (patch.done !== undefined) rowPatch.is_done = patch.done;
      if (patch.text !== undefined) rowPatch.title = patch.text;
      const { error } = await supabase
        .from("task_checklist_items")
        .update(rowPatch)
        .eq("id", itemId)
        .eq("task_id", taskId);
      if (error) throw error;
    },
    async createTaskChecklistItem(taskId: string, input: { text: string; done?: boolean; sortOrder?: number }) {
      const { data: taskRow, error: taskRowError } = await supabase
        .from("tasks")
        .select("id, estimate_work_id")
        .eq("id", taskId)
        .maybeSingle();
      if (taskRowError) throw taskRowError;
      if (taskRow && isEstimateLinkedTaskRow(taskRow)) {
        throw new Error("Estimate-derived checklist structure is read-only in Supabase mode.");
      }

      const { data: lastRow, error: lastRowError } = await supabase
        .from("task_checklist_items")
        .select("sort_order")
        .eq("task_id", taskId)
        .order("sort_order", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (lastRowError) throw lastRowError;
      const insert: TaskChecklistItemInsert = {
        task_id: taskId,
        title: input.text,
        is_done: input.done ?? false,
        sort_order: input.sortOrder ?? ((lastRow?.sort_order ?? 0) + 1),
      };
      const { error } = await supabase
        .from("task_checklist_items")
        .insert(insert);
      if (error) throw error;
    },
    async deleteTaskChecklistItem(taskId: string, itemId: string) {
      const { data: taskRow, error: taskRowError } = await supabase
        .from("tasks")
        .select("id, estimate_work_id")
        .eq("id", taskId)
        .maybeSingle();
      if (taskRowError) throw taskRowError;
      if (taskRow && isEstimateLinkedTaskRow(taskRow)) {
        throw new Error("Estimate-derived checklist structure is read-only in Supabase mode.");
      }

      const { data: currentRow, error: currentRowError } = await supabase
        .from("task_checklist_items")
        .select("id, estimate_resource_line_id, estimate_work_id")
        .eq("id", itemId)
        .eq("task_id", taskId)
        .maybeSingle();
      if (currentRowError) throw currentRowError;
      if (currentRow?.estimate_resource_line_id || currentRow?.estimate_work_id) {
        throw new Error("Estimate-linked checklist items cannot be deleted in Supabase mode.");
      }

      const { error } = await supabase
        .from("task_checklist_items")
        .delete()
        .eq("id", itemId)
        .eq("task_id", taskId);
      if (error) throw error;
    },
    async createTaskComment(taskId: string, body: string, authorId?: string) {
      const insert: TaskCommentInsert = {
        task_id: taskId,
        body,
        author_profile_id: authorId ?? "",
      };
      const { error } = await supabase
        .from("task_comments")
        .insert(insert);
      if (error) throw error;
    },
    async changeTaskStatus(taskId: string, newStatus: TaskStatus, input?: ChangeTaskStatusInput) {
      const comment = input?.commentBody?.trim() ? input.commentBody.trim() : null;
      const { error } = await (supabase as unknown as SupabaseClient).rpc("change_task_status_v2", {
        p_task_id: taskId,
        p_new_status: newStatus,
        p_comment_body: comment,
        p_expected_status: input?.expectedStatus ?? null,
      });
      if (!error) return;

      // Pre-P3 database: fall back to the legacy two-write path (comment then a
      // direct status update). The direct update's 0-row → TaskNoLongerAvailable
      // is preserved by updateProjectTask below.
      if (isMissingRpcError(error)) {
        if (comment) {
          // task_comments.author_profile_id is uuid NOT NULL and its INSERT
          // policy requires author_profile_id = auth.uid(); resolve the real
          // author from the local session (an empty string would 22P02, and a
          // wrong uuid would fail RLS).
          const { data: sessionData } = await (supabase as unknown as SupabaseClient).auth.getSession();
          const authorId = sessionData?.session?.user?.id;
          if (!authorId) {
            // Session lapsed mid-action (degenerate in supabase mode). Surface a
            // plain, non-Error object — like a raw PostgREST error — so the
            // caller's `instanceof Error` check falls through to the LOCALIZED
            // fallback toast instead of rendering this English string in the ru UI.
            throw { code: "NO_SESSION", message: "No authenticated session to record the task comment." };
          }
          const { error: commentError } = await supabase
            .from("task_comments")
            .insert({ task_id: taskId, body: comment, author_profile_id: authorId });
          if (commentError) throw commentError;
        }
        await this.updateProjectTask(taskId, { status: newStatus });
        return;
      }

      // P0002 = converge (not found, or a stale expectedStatus another session
      // already moved): refetch + gentle toast, never a hard failure.
      if (error.code === "P0002") {
        throw new TaskNoLongerAvailableError();
      }
      // Every other DB error (22023 server guard — client-pre-guarded so rarely
      // reached; 42501 permission; unexpected): re-throw the raw PostgrestError.
      // It is a plain object (not an Error instance), so the caller's
      // `error instanceof Error` check falls through to the LOCALIZED fallback
      // toast — the guard/permission messages from Postgres are English, and
      // wrapping them in an Error would leak that English into the ru UI.
      throw error;
    },
  };
}

export async function getPlanningSource(
  mode?: RuntimeWorkspaceMode,
): Promise<PlanningSource> {
  const resolvedMode = mode ?? await resolveRuntimeWorkspaceMode();
  if (resolvedMode.kind === "guest") {
    throw new Error("An authenticated Supabase session is required.");
  }

  if (resolvedMode.kind !== "supabase") {
    return createBrowserPlanningSource(resolvedMode.kind);
  }

  const supabase = await loadSupabaseClient();
  return createSupabasePlanningSource(supabase);
}
