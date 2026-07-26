import type { AIProposal, ProposalChange } from "@/types/ai";
import { getAuthRole } from "@/lib/auth-state";
import { can } from "@/lib/permission-matrix";
import {
  buildProjectAuthoritySeam,
  getProjectDomainAccess,
  projectDomainAllowsView,
  seamAllowsAction,
  seamResolveActionState,
} from "@/lib/permissions";
import type { AIAccess, MemberRole } from "@/types/entities";
import {
  getCurrentUser, getMembers, getProject, getStages, getTask,
  addTask, addEvent, addProcurementItem, addDocument, addComment,
  deductCredit, updateTask,
  addProject, addMember, addStage,
} from "@/data/store";
import type { ProjectAuthoritySeam } from "@/lib/project-authority-seam";
import { PROPOSAL_TYPE_TO_CONTRACT_ACTION, PROPOSAL_TYPE_TO_PROJECT_DOMAIN } from "@/lib/ai-engine";

export interface CommitResultItem {
  type: string;
  id: string;
  label: string;
  route?: string;
  meta?: string;
}

export interface CommitResult {
  success: boolean;
  error?: string;
  count?: number;
  eventIds: string[];
  created: CommitResultItem[];
  updated: CommitResultItem[];
  projectId?: string;
}

export interface CommitProposalOptions {
  eventSource?: "ai" | "user";
  eventActorId?: string;
  emitProposalEvent?: boolean;
  /**
   * When set (e.g. from `usePermission().seam`), AI authority matches workspace-backed membership.
   * Omit only for browser-only paths where the store is the same source as the shell (demo/local).
   */
  authoritySeam?: ProjectAuthoritySeam;
}

export type PhotoConsultApplyKind = "create_task" | "task_comment" | "task_status_done";

export interface PhotoConsultApplyAction {
  kind: PhotoConsultApplyKind;
  projectId: string;
  title?: string;
  description?: string;
  stageId?: string;
  photoIds?: string[];
  taskId?: string;
  commentText?: string;
}

export interface CommitPhotoConsultOptions extends CommitProposalOptions {
  /** Required — photo consult apply must not bypass workspace membership authority. */
  authoritySeam: ProjectAuthoritySeam;
}

function projectDomainAllowsProposalType(seam: ProjectAuthoritySeam, proposalType: string): boolean {
  const routeDomain = PROPOSAL_TYPE_TO_PROJECT_DOMAIN[proposalType];
  if (!routeDomain) return true;
  return projectDomainAllowsView(getProjectDomainAccess(seam, routeDomain));
}

/**
 * Maps a photo-consult UI suggestion row to the apply kind used by `commitPhotoConsultActions`.
 * `hasLinkedTask` must match whether the consult context includes a task (comment / mark-done need it).
 */
export function photoConsultApplyKindForChange(
  change: ProposalChange,
  hasLinkedTask: boolean,
): PhotoConsultApplyKind | null {
  if (change.entity_type === "task" && change.action === "create") {
    return "create_task";
  }
  if (change.entity_type === "comment" && change.action === "create" && hasLinkedTask) {
    return "task_comment";
  }
  if (
    change.entity_type === "task" &&
    change.action === "update" &&
    hasLinkedTask &&
    change.after === "done"
  ) {
    return "task_status_done";
  }
  return null;
}

/** Same domain + contract checks as `commitPhotoConsultActions` per kind (after ai.generate + project scope). */
export function photoConsultSeamAllowsApplyKind(seam: ProjectAuthoritySeam, kind: PhotoConsultApplyKind): boolean {
  switch (kind) {
    case "create_task":
      return (
        projectDomainAllowsProposalType(seam, "add_task") &&
        seamResolveActionState(seam, "tasks", "manage_tasks") === "enabled"
      );
    case "task_comment":
      return (
        projectDomainAllowsProposalType(seam, "add_task") &&
        seamResolveActionState(seam, "tasks", "comment") === "enabled"
      );
    case "task_status_done":
      return (
        projectDomainAllowsProposalType(seam, "add_task") &&
        seamResolveActionState(seam, "tasks", "change_status") === "enabled"
      );
    default:
      return false;
  }
}

/**
 * Filter consult suggestions before render so hidden/disabled actions never appear as available.
 * Aligns with `commitPhotoConsultActions` enforcement.
 */
export function filterPhotoConsultProposalChangesBySeam(
  seam: ProjectAuthoritySeam | undefined,
  projectId: string,
  changes: ProposalChange[],
  hasLinkedTask: boolean,
): ProposalChange[] {
  if (!seam || seam.projectId !== projectId) return [];
  if (!seamAllowsAction(seam, "ai.generate")) return [];
  return changes.filter((change) => {
    const kind = photoConsultApplyKindForChange(change, hasLinkedTask);
    if (!kind) return false;
    return photoConsultSeamAllowsApplyKind(seam, kind);
  });
}

/**
 * Apply photo-consult suggested actions through the same coarse + contract checks as `commitProposal`,
 * without inventing a parallel mutation path.
 */
export function commitPhotoConsultActions(
  actions: PhotoConsultApplyAction[],
  options: CommitPhotoConsultOptions,
): CommitResult {
  if (actions.length === 0) {
    return { success: true, count: 0, eventIds: [], created: [], updated: [] };
  }

  const { authoritySeam, eventSource, eventActorId } = options;
  const user = getCurrentUser();

  if (!seamAllowsAction(authoritySeam, "ai.generate")) {
    return { success: false, error: "You don't have permission to use AI generation.", eventIds: [], created: [], updated: [] };
  }

  for (const action of actions) {
    if (action.projectId !== authoritySeam.projectId) {
      return { success: false, error: "Project scope mismatch for photo consult actions.", eventIds: [], created: [], updated: [] };
    }
    if (!photoConsultSeamAllowsApplyKind(authoritySeam, action.kind)) {
      return {
        success: false,
        error: "This photo consult action is not available for your role.",
        eventIds: [],
        created: [],
        updated: [],
      };
    }
  }

  const actorId = eventActorId ?? (eventSource === "ai" ? "ai" : user.id);
  const created: CommitResultItem[] = [];
  const updated: CommitResultItem[] = [];
  const eventIds: string[] = [];
  let count = 0;

  for (let i = 0; i < actions.length; i++) {
    const action = actions[i];
    if (action.kind === "create_task") {
      const title = action.title?.trim();
      if (!title) continue;
      const taskId = `task-ai-photo-${Date.now()}-${i}`;
      addTask({
        id: taskId,
        project_id: action.projectId,
        stage_id: action.stageId ?? "",
        title,
        description: action.description ?? "",
        status: "not_started",
        assignee_id: user.id,
        checklist: [],
        comments: [],
        attachments: [],
        photos: action.photoIds ?? [],
        linked_estimate_item_ids: [],
        created_at: new Date().toISOString(),
      }, { actorId, source: eventSource });
      created.push({ type: "task", id: taskId, label: title, route: `/project/${action.projectId}/tasks` });
      count++;
    } else if (action.kind === "task_comment") {
      const taskId = action.taskId;
      const text = action.commentText?.trim();
      if (!taskId || !text) continue;
      const task = getTask(taskId);
      if (!task || task.project_id !== action.projectId) {
        return { success: false, error: "Task not found in this project.", eventIds: [], created: [], updated: [] };
      }
      addComment(taskId, text);
      count++;
    } else if (action.kind === "task_status_done") {
      const taskId = action.taskId;
      if (!taskId) continue;
      const task = getTask(taskId);
      if (!task || task.project_id !== action.projectId) {
        return { success: false, error: "Task not found in this project.", eventIds: [], created: [], updated: [] };
      }
      updateTask(taskId, { status: "done" });
      updated.push({ type: "task", id: taskId, label: task.title, route: `/project/${action.projectId}/tasks` });
      count++;
    }
  }

  if (count === 0) {
    return { success: false, error: "No valid actions to apply.", eventIds: [], created: [], updated: [] };
  }

  deductCredit();

  return { success: true, count, eventIds, created, updated };
}

function buildPayloadWithSource(payload: Record<string, unknown>, source?: "ai" | "user") {
  return source ? { ...payload, source } : payload;
}

/**
 * Whether commitProposal can actually apply this proposal type, as opposed to
 * merely being permitted to.
 *
 * `update_estimate` is mapped and permission-checked but writes nothing: this
 * module holds no estimate mutator (rovno #175). The single predicate exists so
 * the library guard and the AISidebar fast-fail cannot drift apart. Wiring real
 * estimate writes means changing this ONE place, and both guards follow.
 *
 * Written as an exhaustive switch, NOT as `type !== "update_estimate"`. The
 * denylist form fails OPEN inside a module that is otherwise deny-by-default: add
 * a sixth AIProposalType plus its PROPOSAL_TYPE_TO_CONTRACT_ACTION entry (which an
 * author must add in order to permission-check it at all) and forget the mutator,
 * and this returns true, every permission gate passes, no mutation branch matches,
 * `count` stays 0, proposal_confirmed is emitted with change_count 0, deductCredit
 * runs, and the user is told «Изменения применены». That is #175 reproduced
 * exactly, and neither the type system nor the suite would notice.
 *
 * The `never` assignment makes the compiler refuse an unhandled member, so the
 * next type has to make this decision explicitly.
 */
export function isProposalTypeApplicable(type: AIProposal["type"]): boolean {
  switch (type) {
    case "add_task":
    case "add_procurement":
    case "generate_document":
    case "create_project":
      return true;
    case "update_estimate":
      return false;
    default: {
      // Returned rather than merely declared so no-unused-vars stays happy; a
      // `never` value is assignable to boolean and is unreachable anyway.
      const exhaustive: never = type;
      return exhaustive;
    }
  }
}

export function commitProposal(proposal: AIProposal, options: CommitProposalOptions = {}): CommitResult {
  // Handle create_project specially — no existing project context needed
  if (proposal.type === "create_project") {
    return commitProjectProposal(proposal, options);
  }

  const user = getCurrentUser();

  const authoritySeam =
    options.authoritySeam ??
    buildProjectAuthoritySeam({
      projectId: proposal.project_id,
      profileId: user.id,
      members: getMembers(proposal.project_id),
      project: getProject(proposal.project_id),
    });

  if (!seamAllowsAction(authoritySeam, "ai.generate")) {
    return { success: false, error: "You don't have permission to use AI generation.", eventIds: [], created: [], updated: [] };
  }

  // Deny-by-default: only explicitly mapped proposal types may execute.
  const actionMapping = PROPOSAL_TYPE_TO_CONTRACT_ACTION[proposal.type];
  if (!actionMapping) {
    return {
      success: false,
      error: `AI proposal type "${proposal.type}" cannot be applied.`,
      eventIds: [],
      created: [],
      updated: [],
    };
  }

  if (!projectDomainAllowsProposalType(authoritySeam, proposal.type)) {
    return {
      success: false,
      error: "This module is not available for your role.",
      eventIds: [],
      created: [],
      updated: [],
    };
  }

  // Contract action enforcement: hidden and disabled_visible actions are blocked — confirmation does not grant permission.
  const actionState = seamResolveActionState(authoritySeam, actionMapping.domain, actionMapping.action);
  if (actionState !== "enabled") {
    return {
      success: false,
      error: `Action "${actionMapping.action}" is not available for your role.`,
      eventIds: [],
      created: [],
      updated: [],
    };
  }

  // See isProposalTypeApplicable: update_estimate is mapped and
  // permission-checked, but NOTHING here writes to
  // an estimate store: this module imports no estimate mutator at all, and no
  // event subscriber closes the gap (the only consumers of estimate_created are
  // display-only). It used to fall through, emit estimate_created, push result
  // rows routed at /project/<id>/estimate, report count = changes.length, deduct
  // a credit and return success. So the user saw a success toast, paid a credit,
  // got a permanent activity-feed entry for a change that never happened, and
  // followed a link to an unchanged estimate.
  //
  // Failing honestly is the minimum until AI estimate edits are actually
  // implemented (rovno #175). Applying them for real is the open feature: it
  // means mutating the estimate store here the way add_task, add_procurement and
  // generate_document mutate theirs. Note this is also the only mapped type with
  // no unavailability handling in AISidebar, which is why it read as working.
  if (!isProposalTypeApplicable(proposal.type)) {
    return {
      success: false,
      error: "Applying AI estimate changes is not available yet.",
      eventIds: [],
      created: [],
      updated: [],
    };
  }

  const project = authoritySeam.project ?? getProject(proposal.project_id);
  const stages = getStages(proposal.project_id);
  const currentStage = stages.find((s) => s.id === project?.current_stage_id) ?? stages[0];
  const eventActorId = options.eventActorId ?? (options.eventSource === "ai" ? "ai" : user.id);

  let count = 0;
  const eventIds: string[] = [];
  const created: CommitResultItem[] = [];
  const updated: CommitResultItem[] = [];
  const pid = proposal.project_id;

  if (proposal.type === "add_task") {
    for (const change of proposal.changes) {
      if (change.action === "create" && change.entity_type === "task") {
        const taskId = `task-ai-${Date.now()}-${count}`;
        addTask({
          id: taskId,
          project_id: pid,
          stage_id: currentStage?.id ?? "",
          title: change.label,
          description: `AI-generated task for ${currentStage?.title ?? "project"}`,
          status: "not_started",
          assignee_id: user.id,
          checklist: [],
          comments: [],
          attachments: [],
          photos: [],
          linked_estimate_item_ids: [],
          created_at: new Date().toISOString(),
        }, {
          actorId: eventActorId,
          source: options.eventSource,
        });
        created.push({
          type: "task",
          id: taskId,
          label: change.label,
          route: `/project/${pid}/tasks`,
        });
        count++;
      }
    }
  }

  if (proposal.type === "add_procurement") {
    for (const change of proposal.changes) {
      if (change.action === "create" && change.entity_type === "procurement_item") {
        const itemId = `proc-ai-${Date.now()}-${count}`;
        addProcurementItem({
          id: itemId,
          project_id: pid,
          stage_id: currentStage?.id,
          title: change.label,
          unit: "pcs",
          qty: 1,
          in_stock: 0,
          cost: parseInt(change.after?.replace(/[^\d]/g, "") ?? "0"),
          status: "not_purchased",
        });
        const procurementEvtId = `evt-proc-ai-${Date.now()}-${count}`;
        addEvent({
          id: procurementEvtId,
          project_id: pid,
          actor_id: eventActorId,
          type: "procurement_created",
          object_type: "procurement_item",
          object_id: itemId,
          timestamp: new Date().toISOString(),
          payload: buildPayloadWithSource({ title: change.label }, options.eventSource),
        });
        eventIds.push(procurementEvtId);
        created.push({
          type: "procurement_item",
          id: itemId,
          label: change.label,
          route: `/project/${pid}/procurement`,
        });
        count++;
      }
    }
  }

  if (proposal.type === "generate_document") {
    for (const change of proposal.changes) {
      if (change.action === "create" && change.entity_type === "document") {
        const docId = `doc-ai-${Date.now()}-${count}`;
        addDocument({
          id: docId,
          project_id: pid,
          type: "contract",
          title: change.label,
          versions: [{
            id: `dv-ai-${Date.now()}-${count}`,
            document_id: docId,
            number: 1,
            status: "draft",
            content: `AI-generated draft for ${change.label}`,
          }],
        });
        const documentEvtId = `evt-doc-ai-${Date.now()}-${count}`;
        addEvent({
          id: documentEvtId,
          project_id: pid,
          actor_id: eventActorId,
          type: "document_created",
          object_type: "document",
          object_id: docId,
          timestamp: new Date().toISOString(),
          payload: buildPayloadWithSource({ title: change.label }, options.eventSource),
        });
        eventIds.push(documentEvtId);
        created.push({
          type: "document",
          id: docId,
          label: change.label,
          route: `/project/${pid}/documents`,
        });
        count++;
      }
    }
  }

  // The update_estimate branch that used to sit here is gone: it reported a
  // change count and emitted estimate_created without writing anything. The type
  // now returns unavailable above, before any event or credit. See #175.

  if (options.emitProposalEvent !== false) {
    const proposalEvtId = `evt-proposal-${Date.now()}`;
    addEvent({
      id: proposalEvtId,
      project_id: pid,
      actor_id: eventActorId,
      type: "proposal_confirmed",
      object_type: "proposal",
      object_id: proposal.id,
      timestamp: new Date().toISOString(),
      payload: buildPayloadWithSource({ summary: proposal.summary, change_count: count }, options.eventSource),
    });
    eventIds.push(proposalEvtId);
  }

  deductCredit();

  return { success: true, count, eventIds, created, updated };
}

function commitProjectProposal(proposal: AIProposal, options: CommitProposalOptions): CommitResult {
  const user = getCurrentUser();
  const authRole = getAuthRole();
  if (authRole === "guest") {
    return { success: false, error: "Sign in to create a project.", eventIds: [], created: [], updated: [] };
  }
  const memberRole = authRole as MemberRole;
  const aiAccess: AIAccess =
    memberRole === "contractor" ? "consult_only" : memberRole === "viewer" ? "none" : "project_pool";
  if (!can(memberRole, "ai.generate", aiAccess)) {
    return { success: false, error: "You don't have permission to use AI generation.", eventIds: [], created: [], updated: [] };
  }

  const projectChange = proposal.changes.find((c) => c.entity_type === "project");
  const stageChanges = proposal.changes.filter((c) => c.entity_type === "stage");
  const eventActorId = options.eventActorId ?? (options.eventSource === "ai" ? "ai" : user.id);

  const projectId = `project-ai-${Date.now()}`;
  const firstStageId = `stage-ai-${Date.now()}-0`;

  addProject({
    id: projectId,
    owner_id: user.id,
    title: projectChange?.label ?? "New Project",
    type: projectChange?.after ?? "residential",
    automation_level: "full",
    current_stage_id: firstStageId,
    progress_pct: 0,
  });

  addMember({
    project_id: projectId,
    user_id: user.id,
    role: "owner",
    ai_access: "project_pool",
    finance_visibility: "detail",
    credit_limit: 500,
    used_credits: 0,
  });

  const created: CommitResultItem[] = [
    { type: "project", id: projectId, label: projectChange?.label ?? "New Project", route: `/project/${projectId}/dashboard` },
  ];

  stageChanges.forEach((sc, i) => {
    const stageId = i === 0 ? firstStageId : `stage-ai-${Date.now()}-${i}`;
    addStage({
      id: stageId,
      project_id: projectId,
      title: sc.label,
      description: "",
      order: i + 1,
      status: "open",
    });
    created.push({ type: "stage", id: stageId, label: sc.label, route: `/project/${projectId}/tasks` });
  });

  const evtId = `evt-proj-${Date.now()}`;
  addEvent({
    id: evtId,
    project_id: projectId,
    actor_id: eventActorId,
    type: "project_created",
    object_type: "project",
    object_id: projectId,
    timestamp: new Date().toISOString(),
    payload: buildPayloadWithSource({ title: projectChange?.label, stages: stageChanges.length }, options.eventSource),
  });

  deductCredit();

  return { success: true, count: created.length, eventIds: [evtId], created, updated: [], projectId };
}
