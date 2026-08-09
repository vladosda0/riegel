import { useQueryClient } from "@tanstack/react-query";
import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { useParams, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useProject, usePermission, useMedia, useWorkspaceMode } from "@/hooks/use-mock-data";
import {
  getUserById, getCurrentUser, updateTask, addTask, deleteTask as storeDeleteTask,
  deleteStage as storeDeleteStage, completeStage as storeCompleteStage,
} from "@/data/store";
import { getPlanningSource, TaskNoLongerAvailableError } from "@/data/planning-source";
import { EmptyState } from "@/components/EmptyState";
import { ConfirmModal } from "@/components/ConfirmModal";
import { TaskDetailModal } from "@/components/tasks/TaskDetailModal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FileInput } from "@/components/ui/file-input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { useToast } from "@/hooks/use-toast";
import { getAuthRole } from "@/lib/auth-state";
import { trackEvent } from "@/lib/analytics";
import { cn } from "@/lib/utils";
import {
  getProjectDomainAccess,
  projectDomainAllowsContribute,
  projectDomainAllowsManage,
} from "@/lib/permissions";
import { format } from "date-fns";
import {
  ListTodo, Plus, CheckCircle2, Circle, Clock,
  AlertTriangle, Trash2, Check, User, Calendar as CalendarIcon, GripVertical, Camera, Loader2,
} from "lucide-react";
import { planningQueryKeys, usePlanningProjectTasksState } from "@/hooks/use-planning-source";
import type { TaskStatus } from "@/types/entities";
import { useEstimateV2Project, useEstimateV2ProjectionCapability } from "@/hooks/use-estimate-v2-data";
import { Skeleton } from "@/components/ui/skeleton";
import { useMediaUploadMutations } from "@/hooks/use-documents-media-source";
import type { Task } from "@/types/entities";

const statusMeta: Record<TaskStatus, { labelKey: string; Icon: typeof Circle; colorClass: string; bgClass: string }> = {
  not_started: { labelKey: "tasks.status.not_started", Icon: Circle, colorClass: "text-muted-foreground", bgClass: "bg-muted" },
  in_progress: { labelKey: "tasks.status.in_progress", Icon: Clock, colorClass: "text-info", bgClass: "bg-info/15" },
  done: { labelKey: "tasks.status.done", Icon: CheckCircle2, colorClass: "text-success", bgClass: "bg-success/15" },
  blocked: { labelKey: "tasks.status.blocked", Icon: AlertTriangle, colorClass: "text-destructive", bgClass: "bg-destructive/15" },
};

const allStatuses: TaskStatus[] = ["not_started", "in_progress", "done", "blocked"];

type Translator = (key: string, options?: Record<string, unknown>) => string;

function getTaskAssigneeEntries(task: Task, t: Translator): Array<{ key: string; id: string | null; label: string; initial: string }> {
  const entries = (task.assignees ?? [])
    .map((assignee, index) => {
      const user = assignee.id ? getUserById(assignee.id) : null;
      const label = assignee.name?.trim() || user?.name || assignee.email?.trim() || null;
      return {
        key: assignee.id ?? assignee.email ?? assignee.name ?? `assignee-${index}`,
        id: assignee.id,
        label: label ?? t("common.unassigned"),
        initial: (label ?? user?.name ?? "").trim().charAt(0).toUpperCase() || "?",
      };
    })
    .filter((entry, index, list) => list.findIndex((candidate) => candidate.key === entry.key) === index);

  if (entries.length > 0) {
    return entries;
  }

  if (!task.assignee_id) {
    return [];
  }

  const user = getUserById(task.assignee_id);
  const label = user?.name ?? t("common.unassigned");
  return [{
    key: task.assignee_id,
    id: task.assignee_id,
    label,
    initial: label.trim().charAt(0).toUpperCase() || "?",
  }];
}

function getTaskAssigneeIds(task: Task, t: Translator): string[] {
  return getTaskAssigneeEntries(task, t)
    .map((entry) => entry.id)
    .filter((id): id is string => Boolean(id));
}

const EMPTY_SYNC_STATE = {
  estimateRevision: null,
  domains: {
    tasks: { status: "idle", projectedRevision: null, lastAttemptedAt: null, lastSucceededAt: null, lastError: null },
    procurement: { status: "idle", projectedRevision: null, lastAttemptedAt: null, lastSucceededAt: null, lastError: null },
    hr: { status: "idle", projectedRevision: null, lastAttemptedAt: null, lastSucceededAt: null, lastError: null },
  },
} as const;

export default function ProjectTasks() {
  const { t } = useTranslation();
  const { id: projectId } = useParams<{ id: string }>();
  const pid = projectId!;
  const { project, stages, members } = useProject(pid);
  const { tasks, isLoading: isTasksLoading } = usePlanningProjectTasksState(pid);
  const media = useMedia(pid);
  const perm = usePermission(pid);
  const { role } = perm;
  const estimateState = useEstimateV2Project(pid);
  const estimateSync = estimateState.sync ?? EMPTY_SYNC_STATE;
  const { project: estimateProject } = estimateState;
  const workspaceMode = useWorkspaceMode();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const authRole = getAuthRole();
  const currentUser = getCurrentUser();
  // In Supabase mode getCurrentUser() resolves to the empty local-store user
  // (nothing writes `auth-local-profile`), so its id is "". The viewer's real
  // identity there is the workspace profile id. Everything keyed on "me" — the
  // assigned-to-me filter, comment authorship — must resolve through this.
  const viewerId = workspaceMode.kind === "supabase" ? workspaceMode.profileId : currentUser.id;
  const tasksAccess = getProjectDomainAccess(perm.seam, "tasks");
  const canManageTasks = projectDomainAllowsManage(tasksAccess);
  const canContributeTasks = projectDomainAllowsContribute(tasksAccess);
  const canCreateTask = canManageTasks;
  const canChangeTaskStatus = canContributeTasks;
  const canEditChecklist = canContributeTasks;
  const canCommentOnTasks = canContributeTasks;
  const canUploadTaskMedia = canContributeTasks;
  const taskSyncState = estimateSync.domains.tasks;
  const isSupabaseMode = workspaceMode.kind === "supabase";
  // Only the session that actually RUNS the projection has a meaningful local
  // sync state. A reader's (viewer/contractor) projectedRevision never advances,
  // so comparing it to estimateRevision would block their task actions forever —
  // the DB tasks they read through react-query ARE the projected truth.
  const projectionCapability = useEstimateV2ProjectionCapability(pid);
  const isProjectorSession = isSupabaseMode && projectionCapability === "projector";
  const isTaskSyncing = isProjectorSession && taskSyncState.status === "syncing";
  const hasTaskSyncError = isProjectorSession && taskSyncState.status === "error";
  // "skipped" is a settled, honest no-op (nothing to project / no permission),
  // not a pending sync — treating it as "behind" would block actions forever.
  const isTaskProjectionBehind = isProjectorSession
    && estimateProject.estimateStatus !== "planning"
    && taskSyncState.status !== "skipped"
    && taskSyncState.projectedRevision !== estimateSync.estimateRevision
    && !isTaskSyncing
    && !hasTaskSyncError;
  // P3: isTaskProjectionBehind / hasTaskSyncError drive the informational sync
  // banner only. They no longer BLOCK status changes — change_task_status_v2
  // preserves task.status through re-projection and converges concurrent moves
  // via P0002, so a status change is always safe to attempt.
  const canAuthorTaskStructure = canCreateTask && !isSupabaseMode;
  const { prepareUpload, uploadBytes, finalizeUpload } = useMediaUploadMutations(pid);

  const location = useLocation();

  const [activeTab, setActiveTab] = useState<string>("all");
  const [assignedToMe, setAssignedToMe] = useState(false);

  // Task detail modal
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const selectedTask = tasks.find((entry) => entry.id === selectedTaskId) ?? null;

  // Deep-link: open task from navigation state (e.g. from PhotoViewer)
  useEffect(() => {
    const state = location.state as { openTaskId?: string } | null;
    if (state?.openTaskId) {
      setSelectedTaskId(state.openTaskId);
      // Clear the state so it doesn't re-open on re-render
      window.history.replaceState({}, "");
    }
  }, [location.state]);

  // New stage modal
  const [stageModalOpen, setStageModalOpen] = useState(false);
  const [newStageTitle, setNewStageTitle] = useState("");
  const [newStageDesc, setNewStageDesc] = useState("");
  const [createWithAI, setCreateWithAI] = useState(false);

  // New task modal
  const [taskModalOpen, setTaskModalOpen] = useState(false);
  const [taskTitle, setTaskTitle] = useState("");
  const [taskDesc, setTaskDesc] = useState("");
  const [taskStatus, setTaskStatus] = useState<TaskStatus>("not_started");
  const [taskAssignee, setTaskAssignee] = useState("");
  const [taskStageId, setTaskStageId] = useState("");
  const [taskDeadline, setTaskDeadline] = useState<Date | undefined>();

  // Stage delete/complete
  const [deleteStageId, setDeleteStageId] = useState<string | null>(null);
  const [completeStageId, setCompleteStageId] = useState<string | null>(null);

  // DnD
  const [dragTaskId, setDragTaskId] = useState<string | null>(null);
  const [dropStatus, setDropStatus] = useState<TaskStatus | null>(null);

  // --- Done prompt ---
  // `expectedStatus` is captured when the prompt OPENS, not read back at confirm
  // time. The window between the two is user-paced (picking photos, typing a
  // reason) and the tasks query refetches inside it (refetchOnWindowFocus, and
  // projection invalidation), so re-reading the live list would adopt another
  // session's concurrent move as the "expected" value and the CAS in
  // change_task_status_v2 would always agree with itself.
  const [donePrompt, setDonePrompt] = useState<{ taskId: string; expectedStatus: TaskStatus } | null>(null);
  const [doneFiles, setDoneFiles] = useState<File[]>([]);
  const [doneUploading, setDoneUploading] = useState(false);
  const [doneFilesResetKey, setDoneFilesResetKey] = useState(0);
  // Bumped by every confirm run and by Cancel. A run whose id no longer matches
  // has been abandoned: it stops issuing uploads and must never touch prompt
  // state, or a finishing loop tears down whatever prompt is open by then.
  const doneRunIdRef = useRef(0);
  const [doneComment, setDoneComment] = useState("");

  // --- Blocked prompt --- (same capture-at-open rule as the Done prompt above)
  const [blockedPrompt, setBlockedPrompt] = useState<{ taskId: string; expectedStatus: TaskStatus } | null>(null);
  const [blockedReason, setBlockedReason] = useState("");

  // Derived
  const deleteStage_ = stages.find((s) => s.id === deleteStageId);
  const deleteTaskCount = deleteStage_ ? tasks.filter((entry) => entry.stage_id === deleteStage_?.id).length : 0;
  const completeStage_ = stages.find((s) => s.id === completeStageId);
  const incompleteTasks = useMemo(
    () => (completeStage_
      ? tasks.filter((entry) => entry.stage_id === completeStage_.id && entry.status !== "done")
      : []),
    [completeStage_, tasks],
  );

  // Filter tasks
  let filteredTasks = activeTab === "all" ? tasks : tasks.filter((entry) => entry.stage_id === activeTab);
  if (assignedToMe) filteredTasks = filteredTasks.filter((entry) => getTaskAssigneeIds(entry, t).includes(viewerId));

  const getColumnTasks = (status: TaskStatus) => filteredTasks.filter((entry) => entry.status === status);
  const invalidateProjectStages = useCallback(async () => {
    if (workspaceMode.kind !== "supabase") return;
    await queryClient.invalidateQueries({
      queryKey: planningQueryKeys.projectStages(workspaceMode.profileId, pid),
    });
  }, [workspaceMode, queryClient, pid]);
  const invalidateProjectTasks = useCallback(async () => {
    if (workspaceMode.kind !== "supabase") return;
    await queryClient.invalidateQueries({
      queryKey: planningQueryKeys.projectTasks(workspaceMode.profileId, pid),
    });
  }, [workspaceMode, queryClient, pid]);

  const updateTaskFact = useCallback(async (
    taskId: string,
    patch: { title?: string; description?: string; deadline?: string | null; startDate?: string | null; status?: TaskStatus },
  ) => {
    const source = await getPlanningSource(
      workspaceMode.kind === "pending-supabase" ? undefined : workspaceMode,
    );
    await source.updateProjectTask(taskId, patch);
    await invalidateProjectTasks();
  }, [workspaceMode, invalidateProjectTasks]);

  // --- Central status change handler (intercepts Done / Blocked) ---
  const handleStatusChange = useCallback((taskId: string, newStatus: TaskStatus) => {
    if (!canChangeTaskStatus) return;
    const task = tasks.find((entry) => entry.id === taskId);
    if (!task || task.status === newStatus) return;
    // P3: no projection-behind hard-block. change_task_status_v2 preserves the
    // task's own status through re-projection and absorbs concurrent moves via
    // the P0002 converge path, so a status change is always safe to attempt.

    if (newStatus === "done") {
      const unresolvedChecklistItems = task.checklist.filter((item) => !item.done);
      if (unresolvedChecklistItems.length > 0) {
        toast({
          title: t("tasks.toast.cannotMarkDone.title"),
          description: t("tasks.toast.cannotMarkDone.description"),
          variant: "destructive",
        });
        return;
      }
      setBlockedPrompt(null); // close any existing prompt
      setSelectedTaskId(null);
      setDonePrompt({ taskId, expectedStatus: task.status });
      setDoneFiles([]);
      setDoneComment("");
      return;
    }
    if (newStatus === "blocked") {
      setDonePrompt(null); // close any existing prompt
      setSelectedTaskId(null);
      setBlockedPrompt({ taskId, expectedStatus: task.status });
      setBlockedReason("");
      return;
    }
    void (async () => {
      try {
        const source = await getPlanningSource(
          workspaceMode.kind === "pending-supabase" ? undefined : workspaceMode,
        );
        await source.changeTaskStatus(taskId, newStatus, { expectedStatus: task.status });
        await invalidateProjectTasks();
        toast({ title: t("tasks.toast.statusUpdated"), description: t(statusMeta[newStatus].labelKey) });
        if (newStatus === "in_progress") {
          trackEvent("task_marked_in_progress", {
            project_id: pid,
            task_id: taskId,
            from_status: task.status,
          });
        }
      } catch (error) {
        if (error instanceof TaskNoLongerAvailableError) {
          // The task was re-projected/replaced, or another session moved it
          // first (P0002 CAS). Refresh and tell the user the list converged.
          await invalidateProjectTasks();
          toast({
            title: t("tasks.toast.taskRefreshed.title"),
            description: t("tasks.toast.taskRefreshed.description"),
          });
          return;
        }
        toast({
          title: t("tasks.toast.statusUpdateFailed.title"),
          description: error instanceof Error ? error.message : t("tasks.toast.statusUpdateFailed.fallback"),
          variant: "destructive",
        });
      }
    })();
  }, [canChangeTaskStatus, tasks, toast, workspaceMode, invalidateProjectTasks, pid, t]);

  // A prompt whose compare-and-set can no longer land converges exactly the way
  // the RPC's own P0002 path does: refetch and tell the user the list moved. A
  // bare `return` here would leave the confirm button silently dead.
  const convergeStalePrompt = useCallback(async () => {
    await invalidateProjectTasks();
    toast({
      title: t("tasks.toast.taskRefreshed.title"),
      description: t("tasks.toast.taskRefreshed.description"),
    });
  }, [invalidateProjectTasks, toast, t]);

  // Confirm Done
  // Leaving must stay possible while photos upload: storage-js exposes no way to
  // abort the request in flight, and nothing in the chain has a timeout, so a
  // stalled network would otherwise trap the user in a full-screen prompt with no
  // Escape handler. Abandoning the run is what makes that safe.
  const cancelDonePrompt = useCallback(() => {
    doneRunIdRef.current += 1;
    setDonePrompt(null);
    setDoneFiles([]);
    setDoneComment("");
    setDoneUploading(false);
  }, []);

  const handleConfirmDone = useCallback(async () => {
    if (!donePrompt) return;
    const task = tasks.find((entry) => entry.id === donePrompt.taskId);
    // The task either left this session's list (deleted, re-projected under a new
    // id, or RLS-filtered) or another session moved it since the prompt opened.
    // The CAS cannot pass either way, so converge BEFORE the upload loop runs:
    // those photos are finalized as is_final rows that nothing rolls back and
    // that the server would count toward a LATER Done attempt's photo guard.
    if (!task || task.status !== donePrompt.expectedStatus) {
      setDonePrompt(null);
      setDoneFiles([]);
      setDoneComment("");
      await convergeStalePrompt();
      return;
    }
    if (task.checklist.some((item) => !item.done)) {
      toast({
        title: t("tasks.toast.cannotMarkDone.title"),
        description: t("tasks.toast.cannotMarkDone.description"),
        variant: "destructive",
      });
      return;
    }
    if (doneFiles.length === 0) {
      toast({
        title: t("tasks.toast.noMediaUploaded.title"),
        description: t("tasks.toast.noMediaUploaded.description"),
        variant: "destructive",
      });
      return;
    }

    const runId = doneRunIdRef.current + 1;
    doneRunIdRef.current = runId;
    const isCurrentRun = () => doneRunIdRef.current === runId;

    setDoneUploading(true);
    try {
      for (const file of doneFiles) {
        // Cancel cannot abort the request already in flight: storage-js `upload()`
        // takes no AbortSignal. It does stop every file after this one.
        if (!isCurrentRun()) return;
        const intent = await prepareUpload({
          mediaType: "photo",
          clientFilename: file.name,
          mimeType: file.type || "image/jpeg",
          sizeBytes: file.size,
          caption: doneComment.trim() || undefined,
          taskId: donePrompt.taskId,
          isFinal: true,
        });
        await uploadBytes(intent.bucket, intent.objectPath, file);
        await finalizeUpload(intent.uploadIntentId, { taskId: donePrompt.taskId, isFinal: true });
      }

      const source = await getPlanningSource(
        workspaceMode.kind === "pending-supabase" ? undefined : workspaceMode,
      );
      // The RPC inserts the acceptance comment once (server-side) alongside the
      // status change; the same text also rode along as the photo caption above.
      if (!isCurrentRun()) return;
      await source.changeTaskStatus(donePrompt.taskId, "done", {
        expectedStatus: donePrompt.expectedStatus,
        commentBody: doneComment.trim() || undefined,
      });
      if (!isCurrentRun()) return;
      await invalidateProjectTasks();
      trackEvent("task_marked_done", {
        project_id: pid,
        task_id: donePrompt.taskId,
        // The status the user acted on. The RPC path asserts it via the CAS, but
        // the demo/local source and the pre-P3 fallback ignore expectedStatus, so
        // this is not a guaranteed DB pre-image on every path.
        from_status: donePrompt.expectedStatus,
      });

      setDonePrompt(null);
      setDoneFiles([]);
      setDoneComment("");
      toast({ title: t("tasks.toast.markedDone") });
    } catch (error) {
      if (!isCurrentRun()) return;
      if (error instanceof TaskNoLongerAvailableError) {
        // Reaching here means the status write lost the race AFTER the upload
        // loop completed, so the acceptance photos are already attached and
        // final. Say so plainly instead of the generic "the list refreshed",
        // which would leave the user guessing where their photos went.
        await invalidateProjectTasks();
        setDonePrompt(null);
        toast({
          title: t("tasks.toast.donePhotosKept.title"),
          description: t("tasks.toast.donePhotosKept.description"),
        });
        return;
      }
      // Files the loop got through are attached as is_final and cannot be told
      // apart from here, so a second click over the same selection would
      // re-upload them. Drop it: the retry has to be a deliberate re-pick.
      // FileInput keeps its own filename state and its own native value, so it
      // is remounted too, or the row would keep showing the old file next to
      // "no files selected" and re-picking that file would fire no change event.
      setDoneFiles([]);
      setDoneFilesResetKey((key) => key + 1);
      toast({
        title: t("tasks.toast.cannotComplete.title"),
        description: error instanceof Error ? error.message : t("tasks.toast.cannotComplete.fallback"),
        variant: "destructive",
      });
    } finally {
      if (isCurrentRun()) setDoneUploading(false);
    }
  }, [
    donePrompt,
    doneFiles,
    doneComment,
    tasks,
    prepareUpload,
    uploadBytes,
    finalizeUpload,
    workspaceMode,
    invalidateProjectTasks,
    convergeStalePrompt,
    toast,
    pid,
    t,
  ]);

  // Confirm Blocked
  const handleConfirmBlocked = useCallback(async () => {
    if (!blockedPrompt) return;
    const blockedTask = tasks.find((entry) => entry.id === blockedPrompt.taskId);
    // Gone from this session's list: the RPC would raise P0002 anyway, so
    // converge here rather than returning and leaving a dead button. Unlike the
    // Done path this does NOT also pre-check a status mismatch — there is no
    // upload to protect, so a stale confirm costs only a round-trip, and on the
    // RPC path its CAS converges it while letting a status that bounced back to
    // the captured value still land. Note the CAS does not run on the demo/local
    // source or the pre-P3 fallback (see the from_status caveat above); that gap
    // is pre-existing and identical on every status path in this file.
    if (!blockedTask) {
      setBlockedPrompt(null);
      setBlockedReason("");
      await convergeStalePrompt();
      return;
    }
    try {
      const source = await getPlanningSource(
        workspaceMode.kind === "pending-supabase" ? undefined : workspaceMode,
      );
      // The RPC enforces the reason-required guard and inserts the blocker
      // comment once, server-side, alongside the status change.
      await source.changeTaskStatus(blockedPrompt.taskId, "blocked", {
        expectedStatus: blockedPrompt.expectedStatus,
        commentBody: t("tasks.toast.blockerPrefix", { reason: blockedReason.trim() }),
      });
      await invalidateProjectTasks();
      trackEvent("task_marked_blocked", {
        project_id: pid,
        task_id: blockedPrompt.taskId,
        // Same caveat as the Done path: asserted by the CAS on the RPC path only.
        from_status: blockedPrompt.expectedStatus,
      });
      setBlockedPrompt(null);
      setBlockedReason("");
      toast({ title: t("tasks.toast.markedBlocked") });
    } catch (error) {
      if (error instanceof TaskNoLongerAvailableError) {
        await invalidateProjectTasks();
        setBlockedPrompt(null);
        toast({
          title: t("tasks.toast.taskRefreshed.title"),
          description: t("tasks.toast.taskRefreshed.description"),
        });
        return;
      }
      toast({
        title: t("tasks.toast.cannotBlock.title"),
        description: error instanceof Error ? error.message : t("tasks.toast.cannotBlock.fallback"),
        variant: "destructive",
      });
    }
  }, [blockedPrompt, blockedReason, tasks, workspaceMode, invalidateProjectTasks, convergeStalePrompt, toast, pid, t]);

  const handleChecklistToggle = useCallback(async (
    taskId: string,
    itemId: string,
    done: boolean,
  ) => {
    if (!canEditChecklist) return;
    try {
      const source = await getPlanningSource(
        workspaceMode.kind === "pending-supabase" ? undefined : workspaceMode,
      );
      await source.updateTaskChecklistItem(taskId, itemId, { done });
      await invalidateProjectTasks();
    } catch (error) {
      toast({
        title: t("tasks.toast.checklistUpdateFailed.title"),
        description: error instanceof Error ? error.message : t("tasks.toast.checklistUpdateFailed.fallback"),
        variant: "destructive",
      });
      throw error;
    }
  }, [canEditChecklist, workspaceMode, invalidateProjectTasks, toast, t]);

  const handleAddChecklistItem = useCallback(async (taskId: string, text: string) => {
    if (!canEditChecklist) return;
    try {
      const source = await getPlanningSource(
        workspaceMode.kind === "pending-supabase" ? undefined : workspaceMode,
      );
      await source.createTaskChecklistItem(taskId, { text: text.trim(), done: false });
      await invalidateProjectTasks();
    } catch (error) {
      toast({
        title: t("tasks.toast.checklistAddFailed.title"),
        description: error instanceof Error ? error.message : t("tasks.toast.checklistAddFailed.fallback"),
        variant: "destructive",
      });
    }
  }, [canEditChecklist, workspaceMode, invalidateProjectTasks, toast, t]);

  const handleDeleteChecklistItem = useCallback(async (taskId: string, itemId: string) => {
    if (!canEditChecklist) return;
    try {
      const source = await getPlanningSource(
        workspaceMode.kind === "pending-supabase" ? undefined : workspaceMode,
      );
      await source.deleteTaskChecklistItem(taskId, itemId);
      await invalidateProjectTasks();
    } catch (error) {
      toast({
        title: t("tasks.toast.checklistDeleteFailed.title"),
        description: error instanceof Error ? error.message : t("tasks.toast.checklistDeleteFailed.fallback"),
        variant: "destructive",
      });
    }
  }, [canEditChecklist, workspaceMode, invalidateProjectTasks, toast, t]);

  const handleTaskCommentCreate = useCallback(async (taskId: string, body: string) => {
    if (!canCommentOnTasks) return;
    try {
      const source = await getPlanningSource(
        workspaceMode.kind === "pending-supabase" ? undefined : workspaceMode,
      );
      await source.createTaskComment(taskId, body.trim(), viewerId);
      await invalidateProjectTasks();
      toast({ title: t("tasks.toast.commentAdded") });
    } catch (error) {
      toast({
        title: t("tasks.toast.commentFailed.title"),
        description: error instanceof Error ? error.message : t("tasks.toast.commentFailed.fallback"),
        variant: "destructive",
      });
    }
  }, [canCommentOnTasks, workspaceMode, viewerId, invalidateProjectTasks, toast, t]);

  const handleTaskTitleChange = useCallback(async (taskId: string, title: string) => {
    await updateTaskFact(taskId, { title });
  }, [updateTaskFact]);

  const handleTaskDescriptionChange = useCallback(async (taskId: string, description: string) => {
    await updateTaskFact(taskId, { description });
  }, [updateTaskFact]);

  const handleTaskDeadlineChange = useCallback(async (taskId: string, deadline?: string) => {
    await updateTaskFact(taskId, { deadline: deadline ?? null });
  }, [updateTaskFact]);

  const handleTaskDelete = useCallback(async (taskId: string) => {
    if (isSupabaseMode) {
      throw new Error(t("tasks.error.supabaseStructure"));
    }

    storeDeleteTask(taskId);
  }, [isSupabaseMode, t]);

  // --- Handlers ---
  const openNewTask = useCallback((prefillStatus?: TaskStatus) => {
    if (!canAuthorTaskStructure) return;
    setTaskTitle("");
    setTaskDesc("");
    setTaskStatus(prefillStatus ?? "not_started");
    setTaskAssignee("");
    setTaskDeadline(undefined);
    setTaskStageId(activeTab !== "all" ? activeTab : (stages[0]?.id ?? ""));
    setTaskModalOpen(true);
  }, [activeTab, canAuthorTaskStructure, stages]);

  const handleCreateTask = useCallback(() => {
    if (!canAuthorTaskStructure) return;
    if (!taskTitle.trim()) return;
    void (async () => {
      try {
        const source = await getPlanningSource(
          workspaceMode.kind === "pending-supabase" ? undefined : workspaceMode,
        );
        const createdTask = await source.createProjectTask({
          projectId: pid,
          stageId: taskStageId || stages[0]?.id || "",
          title: taskTitle.trim(),
          description: taskDesc.trim(),
          status: taskStatus,
          assigneeId: taskAssignee || currentUser.id,
          // canAuthorTaskStructure (guard above) is never true in supabase mode,
          // so there is no profileId branch here.
          createdBy: currentUser.id,
          deadline: taskDeadline?.toISOString(),
        });
        await invalidateProjectTasks();
        setTaskModalOpen(false);
        toast({ title: t("tasks.toast.taskCreated"), description: createdTask.title });
      } catch (error) {
        toast({
          title: t("tasks.toast.taskCreationFailed.title"),
          description: error instanceof Error ? error.message : t("tasks.toast.taskCreationFailed.fallback"),
          variant: "destructive",
        });
      }
    })();
  }, [
    canAuthorTaskStructure,
    pid,
    taskTitle,
    taskDesc,
    taskStatus,
    taskAssignee,
    taskStageId,
    taskDeadline,
    stages,
    currentUser,
    toast,
    workspaceMode,
    invalidateProjectTasks,
    t,
  ]);

  const handleCreateStage = useCallback(() => {
    if (!canAuthorTaskStructure) return;
    if (!newStageTitle.trim()) return;
    void (async () => {
      try {
        const source = await getPlanningSource(
          workspaceMode.kind === "pending-supabase" ? undefined : workspaceMode,
        );
        const createdStage = await source.createProjectStage({
          projectId: pid,
          title: newStageTitle.trim(),
          description: newStageDesc.trim(),
          order: stages.length + 1,
          status: "open",
        });

        if (createWithAI && newStageDesc.trim()) {
          const name = newStageTitle.trim();
          const aiTasks = [
            t("tasks.createStage.aiTask.prepare", { name }),
            t("tasks.createStage.aiTask.execute", { name }),
            t("tasks.createStage.aiTask.qa", { name }),
          ];
          aiTasks.forEach((title, i) => {
            const aiTask = {
              id: `task-ai-${Date.now()}-${i}`,
              project_id: pid,
              stage_id: createdStage.id,
              title,
              description: t("tasks.createStage.aiTask.autoGenerated", { desc: newStageDesc.trim() }),
              status: "not_started" as const,
              assignee_id: currentUser.id,
              checklist: [],
              comments: [],
              attachments: [],
              photos: [],
              linked_estimate_item_ids: [],
              created_at: new Date().toISOString(),
            };
            addTask(aiTask);
          });
        }

        trackEvent("project_stage_created", { project_id: pid });
        await invalidateProjectStages();
        setStageModalOpen(false);
        setNewStageTitle("");
        setNewStageDesc("");
        setCreateWithAI(false);
        setActiveTab(createdStage.id);
        toast({ title: t("tasks.toast.stageCreated"), description: createdStage.title });
      } catch (error) {
        toast({
          title: t("tasks.toast.stageCreationFailed.title"),
          description: error instanceof Error ? error.message : t("tasks.toast.stageCreationFailed.fallback"),
          variant: "destructive",
        });
      }
    })();
  }, [
    canAuthorTaskStructure,
    pid,
    newStageTitle,
    newStageDesc,
    createWithAI,
    stages,
    currentUser,
    toast,
    workspaceMode,
    invalidateProjectStages,
    t,
  ]);

  const handleDeleteStage = useCallback(() => {
    if (isSupabaseMode) return;
    if (!deleteStageId) return;
    storeDeleteStage(deleteStageId);
    if (activeTab === deleteStageId) setActiveTab("all");
    setDeleteStageId(null);
    toast({ title: t("tasks.toast.stageDeleted") });
  }, [deleteStageId, activeTab, isSupabaseMode, toast, t]);

  const handleCompleteStage = useCallback(() => {
    if (isSupabaseMode) return;
    if (!completeStageId) return;
    incompleteTasks.forEach((entry) => updateTask(entry.id, { status: "done" }));
    storeCompleteStage(completeStageId);
    setCompleteStageId(null);
    toast({ title: t("tasks.toast.stageCompleted") });
  }, [completeStageId, incompleteTasks, isSupabaseMode, toast, t]);

  // DnD handlers
  const handleDragStart = (e: React.DragEvent, taskId: string) => {
    setDragTaskId(taskId);
    e.dataTransfer.effectAllowed = "move";
  };
  const handleDragOver = (e: React.DragEvent, status: TaskStatus) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDropStatus(status);
  };
  const handleDragLeave = () => setDropStatus(null);
  const handleDrop = (e: React.DragEvent, status: TaskStatus) => {
    e.preventDefault();
    setDropStatus(null);
    if (dragTaskId) {
      handleStatusChange(dragTaskId, status);
    }
    setDragTaskId(null);
  };

  if (!project) {
    return <EmptyState icon={ListTodo} title={t("tasks.notFound.title")} description={t("tasks.notFound.description")} />;
  }

  return (
    <div className="p-sp-2 flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-sp-2 flex-wrap gap-2">
        <h2 className="text-lg font-semibold text-foreground">{t("tasks.title")}</h2>
        <div className="flex items-center gap-2">
          {(authRole === "contractor" || role === "contractor") && (
            <button
              onClick={() => setAssignedToMe(!assignedToMe)}
              className={`rounded-full px-3 py-1 text-caption font-medium transition-colors ${
                assignedToMe ? "bg-accent text-accent-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
            >
              <User className="h-3 w-3 inline mr-1" /> {t("tasks.assignedToMe")}
            </button>
          )}
          {canAuthorTaskStructure && (
            <Button
              size="sm"
              className="bg-accent text-accent-foreground hover:bg-accent/90"
              onClick={() => openNewTask()}
            >
              <Plus className="mr-1 h-4 w-4" /> {t("tasks.newTask")}
            </Button>
          )}
        </div>
      </div>
      {(isTaskSyncing || isTaskProjectionBehind || hasTaskSyncError) && (
        <div className={cn(
          "mb-2 flex items-start gap-2 rounded-lg border px-3 py-2 text-sm",
          hasTaskSyncError
            ? "border-destructive/30 bg-destructive/10 text-destructive"
            : isTaskProjectionBehind
              ? "border-warning/30 bg-warning/10 text-foreground"
              : "border-info/30 bg-info/10 text-foreground",
        )}>
          {isTaskSyncing ? <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}
          <div className="min-w-0">
            <p className="font-medium">
              {isTaskSyncing
                ? t("tasks.sync.syncingTitle")
                : hasTaskSyncError
                  ? t("tasks.sync.failedTitle")
                  : t("tasks.sync.behindTitle")}
            </p>
            <p className="text-xs opacity-80">
              {isTaskSyncing
                ? t("tasks.sync.syncingBody")
                : hasTaskSyncError
                  ? (taskSyncState.lastError ?? t("tasks.sync.failedFallback"))
                  : t("tasks.sync.behindBody")}
            </p>
          </div>
        </div>
      )}

      {/* Stage Tabs */}
      <div className="flex gap-1 overflow-x-auto pb-sp-1 mb-sp-2 shrink-0">
        <button
          onClick={() => setActiveTab("all")}
          className={`rounded-full px-3 py-1.5 text-caption font-medium whitespace-nowrap transition-colors ${
            activeTab === "all" ? "bg-accent text-accent-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"
          }`}
        >
          {t("tasks.allStages")}
        </button>
        {stages.map((stage) => (
          <button
            key={stage.id}
            onClick={() => setActiveTab(stage.id)}
            className={`rounded-full px-3 py-1.5 text-caption font-medium whitespace-nowrap transition-colors flex items-center gap-1.5 ${
              activeTab === stage.id ? "bg-accent text-accent-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"
            }`}
          >
            {stage.title}
            {stage.status === "completed" && <Check className="h-3 w-3" />}
          </button>
        ))}
        {canAuthorTaskStructure && (
          <button
            onClick={() => setStageModalOpen(true)}
            className="rounded-full px-3 py-1.5 text-caption font-medium whitespace-nowrap text-muted-foreground hover:bg-muted/80 transition-colors border border-dashed border-border"
          >
            <Plus className="h-3 w-3 inline mr-0.5" /> {t("tasks.newStage")}
          </button>
        )}
      </div>

      {/* Stage actions */}
      {activeTab !== "all" && canAuthorTaskStructure && (() => {
        const stage = stages.find((s) => s.id === activeTab);
        if (!stage || stage.status === "completed") return null;
        return (
          <div className="flex gap-1.5 mb-sp-2">
            <Button variant="outline" size="sm" className="h-7 text-caption" onClick={() => setCompleteStageId(stage.id)}>
              <Check className="h-3 w-3 mr-1" /> {t("tasks.stage.complete")}
            </Button>
            <Button variant="outline" size="sm" className="h-7 text-caption text-destructive hover:bg-destructive/10" onClick={() => setDeleteStageId(stage.id)}>
              <Trash2 className="h-3 w-3 mr-1" /> {t("tasks.stage.delete")}
            </Button>
          </div>
        );
      })()}

      {/* Kanban columns — skeleton while the tasks query resolves so an empty
          board is never mistaken for "no tasks". */}
      {isTasksLoading ? (
        <div className="flex gap-sp-2 overflow-x-auto pb-sp-2 flex-1 min-h-0" data-testid="tasks-kanban-skeleton">
          {allStatuses.map((status) => (
            <div key={status} className="bg-muted/30 border border-border rounded-xl p-sp-2 min-w-[260px] w-[280px] flex-shrink-0 space-y-2">
              <Skeleton className="h-5 w-28" />
              <Skeleton className="h-16 rounded-lg" />
              <Skeleton className="h-16 rounded-lg" />
            </div>
          ))}
        </div>
      ) : (
      <div className="flex gap-sp-2 overflow-x-auto pb-sp-2 flex-1 min-h-0">
        {allStatuses.map((status) => {
          const meta = statusMeta[status];
          const columnTasks = getColumnTasks(status);
          const isDropTarget = dropStatus === status;

          return (
            <div
              key={status}
              className={`bg-muted/30 border border-border rounded-xl p-sp-2 min-w-[260px] w-[280px] flex-shrink-0 flex flex-col transition-colors ${
                isDropTarget ? "ring-2 ring-accent/50 bg-accent/5" : ""
              }`}
              onDragOver={(e) => handleDragOver(e, status)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, status)}
            >
              {/* Column header */}
              <div className="flex items-center justify-between mb-sp-2">
                <div className="flex items-center gap-1.5">
                  <meta.Icon className={`h-4 w-4 ${meta.colorClass}`} />
                  <span className="text-sm font-semibold text-foreground">{t(meta.labelKey)}</span>
                  <span className="text-caption text-muted-foreground">({columnTasks.length})</span>
                </div>
                {canAuthorTaskStructure && (
                  <button
                    onClick={() => openNewTask(status)}
                    className="p-1 rounded-full hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>

              {/* Task cards */}
              <div className="space-y-2 flex-1 overflow-y-auto py-1 px-0.5">
                {columnTasks.map((task) => {
                  const assignees = getTaskAssigneeEntries(task, t);
                  const checkDone = task.checklist.filter((c) => c.done).length;
                  const taskPhotos = media.filter((m) => m.task_id === task.id);

                  return (
                    <div
                      key={task.id}
                      draggable={canChangeTaskStatus}
                      onDragStart={(e) => handleDragStart(e, task.id)}
                      onClick={() => setSelectedTaskId(task.id)}
                      className={`bg-card border border-border rounded-lg p-2 px-2.5 cursor-pointer hover:shadow-md transition-all ${
                        dragTaskId === task.id ? "opacity-50" : "shadow-sm"
                      }`}
                    >
                      <div className="flex items-center gap-1.5 mb-0.5">
                        {canChangeTaskStatus && (
                          <GripVertical className="h-3 w-3 text-muted-foreground shrink-0 cursor-grab" />
                        )}
                        <span className="text-caption font-medium text-foreground flex-1 truncate">{task.title}</span>
                      </div>
                      <div className="flex items-center gap-1.5 ml-5 flex-wrap">
                        {assignees.length > 0 && (
                          <div className="flex items-center gap-1">
                            {assignees.slice(0, 2).map((assignee) => (
                              <div
                                key={assignee.key}
                                className="h-4 w-4 rounded-full bg-accent/20 flex items-center justify-center shrink-0"
                                title={assignee.label}
                              >
                                <span className="text-[8px] font-semibold text-accent">{assignee.initial}</span>
                              </div>
                            ))}
                            {assignees.length > 2 && (
                              <span className="text-[10px] text-muted-foreground">+{assignees.length - 2}</span>
                            )}
                          </div>
                        )}
                        {task.checklist.length > 0 && (
                          <span className="text-[10px] text-muted-foreground">✓ {checkDone}/{task.checklist.length}</span>
                        )}
                        {task.comments.length > 0 && (
                          <span className="text-[10px] text-muted-foreground">💬 {task.comments.length}</span>
                        )}
                        {taskPhotos.length > 0 && (
                          <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                            <Camera className="h-2.5 w-2.5" /> {taskPhotos.length}
                          </span>
                        )}
                        {task.deadline && (
                          <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                            <CalendarIcon className="h-2.5 w-2.5" />
                            {format(new Date(task.deadline), "MMM d")}
                          </span>
                        )}
                        {activeTab === "all" && (() => {
                          const stage = stages.find((s) => s.id === task.stage_id);
                          return stage ? (
                            <span className="text-[10px] text-muted-foreground bg-muted rounded-full px-1.5">{stage.title}</span>
                          ) : null;
                        })()}
                      </div>
                    </div>
                  );
                })}
                {columnTasks.length === 0 && (
                  <p className="text-[10px] text-muted-foreground text-center py-sp-3">{t("tasks.column.empty")}</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
      )}

      {/* Task Detail Modal */}
      <TaskDetailModal
        task={selectedTask}
        open={!!selectedTaskId}
        onOpenChange={(open) => { if (!open) setSelectedTaskId(null); }}
        canManageTask={canManageTasks}
        canChangeStatus={canChangeTaskStatus}
        canEditChecklist={canEditChecklist}
        canComment={canCommentOnTasks}
        canUploadMedia={canUploadTaskMedia}
        estimateLinkedPlanningReadOnly={workspaceMode.kind === "supabase" && Boolean(selectedTask?.estimateV2WorkId)}
        taskStructureReadOnly={isSupabaseMode}
        blockEstimateLinkedDelete={isSupabaseMode}
        disableStatusChanges={false}
        onStatusChange={handleStatusChange}
        onTitleChange={handleTaskTitleChange}
        onDescriptionChange={handleTaskDescriptionChange}
        onDeadlineChange={handleTaskDeadlineChange}
        onDeleteTask={isSupabaseMode ? undefined : handleTaskDelete}
        projectMedia={media}
        onChecklistToggle={handleChecklistToggle}
        onChecklistAdd={handleAddChecklistItem}
        onChecklistDelete={handleDeleteChecklistItem}
        onAddComment={handleTaskCommentCreate}
      />

      {/* New Task Modal */}
      {taskModalOpen && canAuthorTaskStructure && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="bg-card border border-border rounded-xl p-sp-3 w-full max-w-md space-y-sp-2 relative z-[52] shadow-xl">
            <h3 className="text-lg font-semibold text-foreground">{t("tasks.newTaskModal.title")}</h3>
            <Input placeholder={t("tasks.newTaskModal.titlePlaceholder")} value={taskTitle} onChange={(e) => setTaskTitle(e.target.value)} autoFocus />
            <Textarea placeholder={t("tasks.newTaskModal.descriptionPlaceholder")} value={taskDesc} onChange={(e) => setTaskDesc(e.target.value)} rows={2} />

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-caption text-muted-foreground mb-1 block">{t("tasks.newTaskModal.statusLabel")}</label>
                <Select value={taskStatus} onValueChange={(v) => setTaskStatus(v as TaskStatus)}>
                  <SelectTrigger className="h-8 text-caption"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {allStatuses.map((s) => (
                      <SelectItem key={s} value={s}>{t(statusMeta[s].labelKey)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-caption text-muted-foreground mb-1 block">{t("tasks.newTaskModal.assigneeLabel")}</label>
                <Select value={taskAssignee} onValueChange={setTaskAssignee}>
                  <SelectTrigger className="h-8 text-caption"><SelectValue placeholder={t("tasks.newTaskModal.assigneePlaceholder")} /></SelectTrigger>
                  <SelectContent>
                    {members.map((m) => {
                      const u = getUserById(m.user_id);
                      return u ? <SelectItem key={m.user_id} value={m.user_id}>{u.name}</SelectItem> : null;
                    })}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {activeTab === "all" && stages.length > 0 && (
              <div>
                <label className="text-caption text-muted-foreground mb-1 block">{t("tasks.newTaskModal.stageLabel")}</label>
                <Select value={taskStageId} onValueChange={setTaskStageId}>
                  <SelectTrigger className="h-8 text-caption"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {stages.map((s) => <SelectItem key={s.id} value={s.id}>{s.title}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div>
              <label className="text-caption text-muted-foreground mb-1 block">{t("tasks.newTaskModal.deadlineLabel")}</label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className={cn("h-8 text-caption justify-start w-full", !taskDeadline && "text-muted-foreground")}
                  >
                    <CalendarIcon className="h-3 w-3 mr-1.5" />
                    {taskDeadline ? format(taskDeadline, "MMM d, yyyy") : t("tasks.newTaskModal.pickDate")}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={taskDeadline}
                    onSelect={setTaskDeadline}
                    className={cn("p-3 pointer-events-auto")}
                  />
                </PopoverContent>
              </Popover>
            </div>

            <div className="flex justify-end gap-2 pt-sp-1">
              <Button variant="outline" onClick={() => setTaskModalOpen(false)}>{t("common.cancel")}</Button>
              <Button
                className="bg-accent text-accent-foreground hover:bg-accent/90"
                onClick={handleCreateTask}
                disabled={!taskTitle.trim()}
              >
                {t("common.create")}
              </Button>
            </div>
          </div>
          <div className="fixed inset-0 z-[51] bg-black/40" onClick={() => setTaskModalOpen(false)} />
        </div>
      )}

      {/* New Stage Modal */}
      {stageModalOpen && canAuthorTaskStructure && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="bg-card border border-border rounded-xl p-sp-3 w-full max-w-md space-y-sp-2 relative z-[52] shadow-xl">
            <h3 className="text-lg font-semibold text-foreground">{t("tasks.newStageModal.title")}</h3>
            <Input
              placeholder={t("tasks.newStageModal.namePlaceholder")}
              value={newStageTitle}
              onChange={(e) => setNewStageTitle(e.target.value)}
              autoFocus
            />
            <Textarea
              placeholder={t("tasks.newStageModal.descriptionPlaceholder")}
              value={newStageDesc}
              onChange={(e) => {
                setNewStageDesc(e.target.value);
                if (e.target.value.trim()) setCreateWithAI(true);
                else setCreateWithAI(false);
              }}
              rows={2}
            />
            <label className="flex items-center gap-2 text-caption text-foreground cursor-pointer">
              <Checkbox
                checked={createWithAI}
                onCheckedChange={(checked) => setCreateWithAI(!!checked)}
                disabled={!newStageDesc.trim()}
              />
              {t("tasks.newStageModal.createWithAi")}
            </label>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => { setStageModalOpen(false); setNewStageTitle(""); setNewStageDesc(""); setCreateWithAI(false); }}>
                {t("common.cancel")}
              </Button>
              <Button
                className="bg-accent text-accent-foreground hover:bg-accent/90"
                onClick={handleCreateStage}
                disabled={!newStageTitle.trim()}
              >
                {t("common.create")}
              </Button>
            </div>
          </div>
          <div className="fixed inset-0 z-[51] bg-black/40" onClick={() => setStageModalOpen(false)} />
        </div>
      )}

      {/* Done prompt — require photos */}
      {donePrompt && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center">
          <div className="bg-card border border-border rounded-xl p-sp-3 w-full max-w-md space-y-sp-2 relative z-[62] shadow-xl">
            <h3 className="text-lg font-semibold text-foreground">{t("tasks.donePrompt.title")}</h3>
            <p className="text-sm text-muted-foreground">{t("tasks.donePrompt.description")}</p>

            <div className="space-y-2">
              <FileInput
                key={doneFilesResetKey}
                accept="image/*"
                multiple
                disabled={doneUploading}
                onChange={(e) => setDoneFiles(Array.from(e.target.files ?? []))}
              />
              <p className="text-caption text-muted-foreground">
                {doneFiles.length > 0 ? t("tasks.donePrompt.filesSelected", { count: doneFiles.length }) : t("tasks.donePrompt.noFilesSelected")}
              </p>
            </div>

            <div>
              <label className="text-caption text-muted-foreground mb-1 block">{t("tasks.donePrompt.commentLabel")}</label>
              <Input
                value={doneComment}
                onChange={(e) => setDoneComment(e.target.value)}
                placeholder={t("tasks.donePrompt.commentPlaceholder")}
                className="text-sm h-8"
              />
            </div>

            <div className="flex justify-end gap-2 pt-sp-1">
              <Button variant="outline" onClick={cancelDonePrompt}>{t("common.back")}</Button>
              <Button
                className="bg-success text-success-foreground hover:bg-success/90"
                onClick={() => void handleConfirmDone()}
                disabled={doneUploading || doneFiles.length === 0}
              >
                <CheckCircle2 className="h-4 w-4 mr-1" /> {doneUploading ? t("tasks.donePrompt.uploading") : t("tasks.donePrompt.markDone")}
              </Button>
            </div>
          </div>
          <div className="fixed inset-0 z-[61] bg-black/40" onClick={cancelDonePrompt} />
        </div>
      )}

      {/* Blocked prompt — require comment */}
      {blockedPrompt && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center">
          <div className="bg-card border border-border rounded-xl p-sp-3 w-full max-w-md space-y-sp-2 relative z-[62] shadow-xl">
            <h3 className="text-lg font-semibold text-foreground">{t("tasks.blockedPrompt.title")}</h3>
            <p className="text-sm text-muted-foreground">{t("tasks.blockedPrompt.description")}</p>

            <Textarea
              value={blockedReason}
              onChange={(e) => setBlockedReason(e.target.value)}
              placeholder={t("tasks.blockedPrompt.placeholder")}
              rows={3}
              autoFocus
              className="text-sm"
            />

            <div className="flex justify-end gap-2 pt-sp-1">
              <Button variant="outline" onClick={() => setBlockedPrompt(null)}>{t("common.cancel")}</Button>
              <Button
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={() => void handleConfirmBlocked()}
                disabled={blockedReason.trim().length < 5}
              >
                <AlertTriangle className="h-4 w-4 mr-1" /> {t("tasks.blockedPrompt.markBlocked")}
              </Button>
            </div>
          </div>
          <div className="fixed inset-0 z-[61] bg-black/40" onClick={() => setBlockedPrompt(null)} />
        </div>
      )}

      {/* Stage delete modal */}
      <ConfirmModal
        open={!!deleteStageId}
        onOpenChange={(open) => { if (!open) setDeleteStageId(null); }}
        title={t("tasks.deleteStage.title")}
        description={
          deleteTaskCount > 0
            ? t("tasks.deleteStage.descriptionWithTasks", { count: deleteTaskCount })
            : t("tasks.deleteStage.descriptionEmpty")
        }
        confirmLabel={t("common.delete")}
        onConfirm={handleDeleteStage}
      />

      {/* Stage complete modal */}
      <ConfirmModal
        open={!!completeStageId}
        onOpenChange={(open) => { if (!open) setCompleteStageId(null); }}
        title={t("tasks.completeStage.title")}
        description={
          incompleteTasks.length > 0
            ? t("tasks.completeStage.descriptionPending", { count: incompleteTasks.length })
            : t("tasks.completeStage.descriptionAllDone")
        }
        confirmLabel={t("tasks.completeStage.confirmLabel")}
        onConfirm={handleCompleteStage}
      />
    </div>
  );
}
