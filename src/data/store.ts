import type {
  User,
  Project,
  Member,
  Stage,
  Task,
  Estimate,
  ProcurementItem,
  Document,
  Media,
  Event,
  Notification,
  ContractorProposal,
  EstimateVersion,
  EstimateItem,
  DocumentVersion,
  ChecklistItem,
} from "@/types/entities";
import { moveEstimateItemToStage, deleteEstimateItemsForTask, deleteEstimateItemsBySourceId } from "@/data/estimate-store";
import { getCachedWorkspaceUser } from "@/data/workspace-profile-cache";
import {
  getStoredAuthProfile,
  isAuthenticated,
  isDemoSessionActive,
  onDemoSessionDeactivated,
  type StoredAuthProfile,
} from "@/lib/auth-state";
import {
  seedUser,
  seedProjects,
  seedMembers,
  seedStages,
  seedTasks,
  seedEstimates,
  seedProcurementItems,
  seedDocuments,
  seedMedia,
  seedEvents,
  seedNotifications,
  seedInvites,
  allUsers,
} from "@/data/seed";
import type { Database as WorkspaceDatabase } from "../../backend-truth/generated/supabase-types";

export type BrowserWorkspaceKind = "demo" | "local";
export type WorkspaceProjectInvite = WorkspaceDatabase["public"]["Tables"]["project_invites"]["Row"];

interface BrowserWorkspaceState {
  user: User;
  projects: Project[];
  members: Member[];
  stages: Stage[];
  tasks: Task[];
  estimates: Estimate[];
  procurementItems: ProcurementItem[];
  documents: Document[];
  media: Media[];
  events: Event[];
  notifications: Notification[];
  contractorProposals: ContractorProposal[];
  invites: WorkspaceProjectInvite[];
}

const DEMO_STATE_KEY = "workspace-demo-state";

function getResolvedTimezone(): string {
  if (typeof Intl === "undefined") return "UTC";
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

function createLocalUser(profile: StoredAuthProfile | null): User {
  if (!profile || !isAuthenticated()) {
    return {
      id: "",
      email: "",
      name: "",
      locale: "en",
      timezone: getResolvedTimezone(),
      plan: "free",
      credits_free: 0,
      credits_paid: 0,
    };
  }

  return {
    id: profile.id,
    email: profile.email,
    name: profile.name,
    locale: profile.locale ?? "en",
    timezone: profile.timezone ?? getResolvedTimezone(),
    plan: profile.plan === "pro" || profile.plan === "business" ? profile.plan : "free",
    credits_free: seedUser.credits_free,
    credits_paid: 0,
  };
}

function createSeededDemoState(): BrowserWorkspaceState {
  return {
    user: { ...seedUser },
    projects: [...seedProjects],
    members: [...seedMembers],
    stages: [...seedStages],
    tasks: [...seedTasks],
    estimates: [...seedEstimates],
    procurementItems: [...seedProcurementItems],
    documents: [...seedDocuments],
    media: [...seedMedia],
    events: [...seedEvents],
    notifications: [...seedNotifications],
    contractorProposals: [],
    invites: [...seedInvites],
  };
}

function createEmptyLocalState(profile: StoredAuthProfile | null): BrowserWorkspaceState {
  return {
    user: createLocalUser(profile),
    projects: [],
    members: [],
    stages: [],
    tasks: [],
    estimates: [],
    procurementItems: [],
    documents: [],
    media: [],
    events: [],
    notifications: [],
    contractorProposals: [],
    invites: [],
  };
}

function cloneWorkspaceState(state: BrowserWorkspaceState): BrowserWorkspaceState {
  return {
    user: { ...state.user },
    projects: [...state.projects],
    members: [...state.members],
    stages: [...state.stages],
    tasks: [...state.tasks],
    estimates: [...state.estimates],
    procurementItems: [...state.procurementItems],
    documents: [...state.documents],
    media: [...state.media],
    events: [...state.events],
    notifications: [...state.notifications],
    contractorProposals: [...state.contractorProposals],
    invites: [...state.invites],
  };
}

function sanitizeDemoState(state: BrowserWorkspaceState): BrowserWorkspaceState {
  return {
    ...state,
    user: { ...seedUser },
  };
}

function loadPersistedDemoState(): BrowserWorkspaceState | null {
  try {
    const raw = sessionStorage.getItem(DEMO_STATE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<BrowserWorkspaceState>;
    return sanitizeDemoState({
      user: parsed.user ?? { ...seedUser },
      projects: parsed.projects ?? [...seedProjects],
      members: parsed.members ?? [...seedMembers],
      stages: parsed.stages ?? [...seedStages],
      tasks: parsed.tasks ?? [...seedTasks],
      estimates: parsed.estimates ?? [...seedEstimates],
      procurementItems: parsed.procurementItems ?? [...seedProcurementItems],
      documents: parsed.documents ?? [...seedDocuments],
      media: parsed.media ?? [...seedMedia],
      events: parsed.events ?? [...seedEvents],
      notifications: parsed.notifications ?? [...seedNotifications],
      contractorProposals: parsed.contractorProposals ?? [],
      invites: parsed.invites ?? [...seedInvites],
    });
  } catch {
    return null;
  }
}

function persistDemoState(state: BrowserWorkspaceState) {
  try {
    sessionStorage.setItem(DEMO_STATE_KEY, JSON.stringify(sanitizeDemoState(state)));
  } catch {
    // Ignore storage write failures and keep the in-memory snapshot.
  }
}

let demoState = sanitizeDemoState(loadPersistedDemoState() ?? createSeededDemoState());
let localState = createEmptyLocalState(getStoredAuthProfile());
let localProfileId = localState.user.id;

type Listener = () => void;
const listeners = new Set<Listener>();

function getActiveBrowserWorkspaceKind(): BrowserWorkspaceKind {
  return isDemoSessionActive() ? "demo" : "local";
}

function syncLocalWorkspaceUser() {
  const profile = getStoredAuthProfile();
  const nextProfileId = isAuthenticated() ? profile?.id ?? "" : "";
  if (nextProfileId !== localProfileId) {
    localState = createEmptyLocalState(profile);
    localProfileId = nextProfileId;
    return;
  }

  localState = {
    ...localState,
    user: createLocalUser(profile),
  };
}

function getStateForMode(mode: BrowserWorkspaceKind = getActiveBrowserWorkspaceKind()): BrowserWorkspaceState {
  if (mode === "local") {
    syncLocalWorkspaceUser();
    return localState;
  }

  return demoState;
}

function setStateForMode(mode: BrowserWorkspaceKind, state: BrowserWorkspaceState) {
  if (mode === "demo") {
    const sanitizedDemoState = sanitizeDemoState(state);
    demoState = sanitizedDemoState;
    persistDemoState(sanitizedDemoState);
    return;
  }

  localState = state;
  localProfileId = state.user.id;
}

function updateWorkspaceState(
  mutator: (state: BrowserWorkspaceState) => void,
  mode: BrowserWorkspaceKind = getActiveBrowserWorkspaceKind(),
) {
  const nextState = cloneWorkspaceState(getStateForMode(mode));
  mutator(nextState);
  setStateForMode(mode, nextState);
  notify();
}

function addEventToState(state: BrowserWorkspaceState, event: Event) {
  state.events = [...state.events, event];
  const projectMembers = state.members.filter((member) => member.project_id === event.project_id);
  const newNotifications: Notification[] = projectMembers
    .filter((member) => member.user_id !== event.actor_id)
    .map((member, index) => ({
      id: `notif-auto-${Date.now()}-${index}`,
      user_id: member.user_id,
      project_id: event.project_id,
      event_id: event.id,
      is_read: false,
    }));

  state.notifications = [...state.notifications, ...newNotifications];
}

function getStateUserById(state: BrowserWorkspaceState, id: string): User | undefined {
  if (state.user.id && state.user.id === id) {
    return state.user;
  }

  return undefined;
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify() {
  listeners.forEach((listener) => listener());
}

export function getCurrentUserForMode(mode: BrowserWorkspaceKind): User {
  return getStateForMode(mode).user;
}

export function getProjectsForMode(mode: BrowserWorkspaceKind): Project[] {
  return getStateForMode(mode).projects;
}

export function getProjectForMode(mode: BrowserWorkspaceKind, id: string): Project | undefined {
  return getStateForMode(mode).projects.find((project) => project.id === id);
}

export function getMembersForMode(mode: BrowserWorkspaceKind, projectId: string): Member[] {
  return getStateForMode(mode).members.filter((member) => member.project_id === projectId);
}

export function getProjectInvitesForMode(mode: BrowserWorkspaceKind, projectId: string): WorkspaceProjectInvite[] {
  return getStateForMode(mode).invites
    .filter((invite) => invite.project_id === projectId)
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
}

export function getCurrentUser(): User {
  return getStateForMode().user;
}

export function getUserById(id: string): User | undefined {
  const mode = getActiveBrowserWorkspaceKind();
  const activeState = getStateForMode(mode);
  const activeUser = getStateUserById(activeState, id);
  if (activeUser) return activeUser;
  if (mode === "demo") {
    return allUsers.find((user) => user.id === id);
  }
  return getCachedWorkspaceUser(id) ?? allUsers.find((user) => user.id === id);
}

export function getProjects(): Project[] {
  return getStateForMode().projects;
}

export function getProject(id: string): Project | undefined {
  return getStateForMode().projects.find((project) => project.id === id);
}

export function getMembers(projectId: string): Member[] {
  return getMembersForMode(getActiveBrowserWorkspaceKind(), projectId);
}

export function getStages(projectId: string): Stage[] {
  return getStateForMode().stages
    .filter((stage) => stage.project_id === projectId)
    .sort((left, right) => left.order - right.order);
}

export function getTasks(projectId: string, filters?: { stage_id?: string; status?: string }): Task[] {
  let result = getStateForMode().tasks.filter((task) => task.project_id === projectId);
  if (filters?.stage_id) result = result.filter((task) => task.stage_id === filters.stage_id);
  if (filters?.status) result = result.filter((task) => task.status === filters.status);
  return result;
}

export function getAllTasks(): Task[] {
  return getStateForMode().tasks;
}

export function getAllDocuments(): Document[] {
  return getStateForMode().documents;
}

export function getAllProcurementItems(): ProcurementItem[] {
  return getStateForMode().procurementItems;
}

export function getEstimate(projectId: string): Estimate | undefined {
  return getStateForMode().estimates.find((estimate) => estimate.project_id === projectId);
}

export function getProcurementItems(projectId: string): ProcurementItem[] {
  return getStateForMode().procurementItems.filter((item) => item.project_id === projectId);
}

export function getDocuments(projectId: string): Document[] {
  return getStateForMode().documents.filter((document) => document.project_id === projectId);
}

export function getMedia(projectId: string): Media[] {
  return getStateForMode().media.filter((item) => item.project_id === projectId);
}

export function getEvents(projectId: string): Event[] {
  return getStateForMode().events
    .filter((event) => event.project_id === projectId)
    .sort((left, right) => new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime());
}

export function getNotifications(userId: string): Notification[] {
  return getStateForMode().notifications.filter((notification) => notification.user_id === userId);
}

export function getUnreadNotificationCount(userId: string): number {
  return getStateForMode().notifications.filter((notification) => notification.user_id === userId && !notification.is_read).length;
}

export function getProjectInvites(projectId: string): WorkspaceProjectInvite[] {
  return getProjectInvitesForMode(getActiveBrowserWorkspaceKind(), projectId);
}

export function addEvent(event: Event) {
  updateWorkspaceState((state) => {
    addEventToState(state, event);
  });
}

export function updateTask(id: string, partial: Partial<Task>) {
  updateWorkspaceState((state) => {
    state.tasks = state.tasks.map((task) => (task.id === id ? { ...task, ...partial } : task));
    const task = state.tasks.find((entry) => entry.id === id);
    if (!task) return;

    const eventType = partial.status === "done" ? "task_completed" : "task_updated";
    addEventToState(state, {
      id: `evt-auto-${Date.now()}`,
      project_id: task.project_id,
      actor_id: state.user.id,
      type: eventType,
      object_type: "task",
      object_id: id,
      timestamp: new Date().toISOString(),
      payload: { title: task.title, ...partial },
    });
  });
}

interface AddTaskOptions {
  actorId?: string;
  source?: string;
}

export function addTask(task: Task, options: AddTaskOptions = {}) {
  updateWorkspaceState((state) => {
    state.tasks = [...state.tasks, task];
    addEventToState(state, {
      id: `evt-auto-${Date.now()}`,
      project_id: task.project_id,
      actor_id: options.actorId ?? state.user.id,
      type: "task_created",
      object_type: "task",
      object_id: task.id,
      timestamp: new Date().toISOString(),
      payload: {
        title: task.title,
        ...(options.source ? { source: options.source } : {}),
      },
    });
  });
}

export function markNotificationRead(id: string) {
  updateWorkspaceState((state) => {
    state.notifications = state.notifications.map((notification) =>
      notification.id === id ? { ...notification, is_read: true } : notification,
    );
  });
}

export function updateProject(id: string, partial: Partial<Project>) {
  updateWorkspaceState((state) => {
    state.projects = state.projects.map((project) => (project.id === id ? { ...project, ...partial } : project));
  });
}

/**
 * v1 store only. NOT the procurement path any screen reads.
 *
 * Zero importers as of rovno #224: everything in the product goes through
 * `@/data/procurement-store`'s V2 function OF THE SAME NAME (ProjectProcurement
 * via useProjectProcurementItemsState, procurement-read-model via
 * getAllProcurementItemsV2, plus estimate-v2 rollups and procurement-sync).
 *
 * That name collision is exactly what produced #224: the AI commit path imported
 * this one, wrote rows nobody could ever see, and still charged a credit and
 * logged an activity entry. Kept for symmetry with the other v1 mutators rather
 * than deleted, but do not reach for it by autocomplete.
 */
export function addProcurementItem(item: ProcurementItem) {
  updateWorkspaceState((state) => {
    state.procurementItems = [...state.procurementItems, item];
  });
}

export function updateProcurementItem(id: string, partial: Partial<ProcurementItem>) {
  updateWorkspaceState((state) => {
    state.procurementItems = state.procurementItems.map((item) => (item.id === id ? { ...item, ...partial } : item));
  });
}

export function deleteProcurementItem(id: string) {
  updateWorkspaceState((state) => {
    state.procurementItems = state.procurementItems.filter((item) => item.id !== id);
  });
}

export function addDocument(doc: Document) {
  updateWorkspaceState((state) => {
    state.documents = [...state.documents, doc];
  });
}

export function updateDocument(id: string, partial: Partial<Document>) {
  updateWorkspaceState((state) => {
    state.documents = state.documents.map((document) => (document.id === id ? { ...document, ...partial } : document));
  });
}

export function addDocumentVersion(docId: string, version: DocumentVersion) {
  updateWorkspaceState((state) => {
    state.documents = state.documents.map((document) =>
      document.id === docId ? { ...document, versions: [...document.versions, version] } : document,
    );
  });
}

export function deleteDocument(id: string) {
  updateWorkspaceState((state) => {
    state.documents = state.documents.filter((document) => document.id !== id);
  });
}

export function addMedia(item: Media) {
  updateWorkspaceState((state) => {
    state.media = [...state.media, item];
  });
}

export function updateMedia(id: string, partial: Partial<Media>) {
  updateWorkspaceState((state) => {
    state.media = state.media.map((item) => (item.id === id ? { ...item, ...partial } : item));
  });
}

export function deleteMedia(id: string) {
  updateWorkspaceState((state) => {
    state.media = state.media.filter((item) => item.id !== id);
  });
}

export function updateEstimateItems(versionId: string, updatedItems: EstimateItem[]) {
  updateWorkspaceState((state) => {
    state.estimates = state.estimates.map((estimate) => ({
      ...estimate,
      versions: estimate.versions.map((version) =>
        version.id === versionId ? { ...version, items: updatedItems } : version,
      ),
    }));
  });
}

export function addEstimateVersion(projectId: string, version: EstimateVersion) {
  updateWorkspaceState((state) => {
    const existing = state.estimates.find((estimate) => estimate.project_id === projectId);
    if (existing) {
      state.estimates = state.estimates.map((estimate) =>
        estimate.project_id === projectId
          ? { ...estimate, versions: [...estimate.versions, version] }
          : estimate,
      );
      return;
    }

    state.estimates = [...state.estimates, { project_id: projectId, versions: [version] }];
  });
}

export function updateEstimateVersionStatus(versionId: string, status: EstimateVersion["status"]) {
  updateWorkspaceState((state) => {
    state.estimates = state.estimates.map((estimate) => ({
      ...estimate,
      versions: estimate.versions.map((version) => (version.id === versionId ? { ...version, status } : version)),
    }));
  });
}

export function deleteEstimateVersion(versionId: string) {
  updateWorkspaceState((state) => {
    state.estimates = state.estimates.map((estimate) => ({
      ...estimate,
      versions: estimate.versions.filter((version) => version.id !== versionId),
    }));
  });
}

export function updateEstimateItemPaid(versionId: string, itemId: string, paidCost: number) {
  updateWorkspaceState((state) => {
    state.estimates = state.estimates.map((estimate) => ({
      ...estimate,
      versions: estimate.versions.map((version) =>
        version.id === versionId
          ? {
              ...version,
              items: version.items.map((item) => (item.id === itemId ? { ...item, paid_cost: paidCost } : item)),
            }
          : version,
      ),
    }));
  });
}

export function getContractorProposals(projectId: string): ContractorProposal[] {
  return getStateForMode().contractorProposals.filter((proposal) => proposal.project_id === projectId);
}

export function addContractorProposal(proposal: ContractorProposal) {
  updateWorkspaceState((state) => {
    state.contractorProposals = [...state.contractorProposals, proposal];
  });
}

export function updateContractorProposalStatus(proposalId: string, status: "accepted" | "rejected") {
  updateWorkspaceState((state) => {
    state.contractorProposals = state.contractorProposals.map((proposal) =>
      proposal.id === proposalId ? { ...proposal, status } : proposal,
    );
  });
}

export function linkEstimateToTasks(versionId: string, links: { itemId: string; taskIds: string[] }[]) {
  updateWorkspaceState((state) => {
    for (const link of links) {
      for (const taskId of link.taskIds) {
        state.tasks = state.tasks.map((task) =>
          task.id === taskId && !task.linked_estimate_item_ids.includes(link.itemId)
            ? { ...task, linked_estimate_item_ids: [...task.linked_estimate_item_ids, link.itemId] }
            : task,
        );
      }
    }
  });
}

export function deductCredit() {
  updateWorkspaceState((state) => {
    if (state.user.credits_free > 0) {
      state.user = { ...state.user, credits_free: state.user.credits_free - 1 };
      return;
    }

    if (state.user.credits_paid > 0) {
      state.user = { ...state.user, credits_paid: state.user.credits_paid - 1 };
    }
  });
}

export function addProject(project: Project) {
  updateWorkspaceState((state) => {
    state.projects = [...state.projects, project];
  });
}

export function removeProject(projectId: string, mode?: BrowserWorkspaceKind) {
  updateWorkspaceState((state) => {
    state.projects = state.projects.filter((project) => project.id !== projectId);
    state.members = state.members.filter((member) => member.project_id !== projectId);
    state.invites = state.invites.filter((invite) => invite.project_id !== projectId);
    state.stages = state.stages.filter((stage) => stage.project_id !== projectId);
    state.tasks = state.tasks.filter((task) => task.project_id !== projectId);
    state.documents = state.documents.filter((doc) => doc.project_id !== projectId);
    state.media = state.media.filter((m) => m.project_id !== projectId);
    state.events = state.events.filter((event) => event.project_id !== projectId);
  }, mode);
}

export function addMember(member: Member) {
  updateWorkspaceState((state) => {
    state.members = [...state.members, member];
  });
}

export function updateMember(projectId: string, userId: string, partial: Partial<Member>, mode?: BrowserWorkspaceKind): Member | undefined {
  let updated: Member | undefined;
  updateWorkspaceState((state) => {
    state.members = state.members.map((member) => {
      if (member.project_id !== projectId || member.user_id !== userId) return member;
      updated = { ...member, ...partial };
      return updated;
    });
  }, mode);
  return updated;
}

export function removeMember(projectId: string, userId: string, mode?: BrowserWorkspaceKind): boolean {
  let removed = false;
  updateWorkspaceState((state) => {
    const next = state.members.filter((member) => !(member.project_id === projectId && member.user_id === userId));
    removed = next.length !== state.members.length;
    state.members = next;
  }, mode);
  return removed;
}

export function addProjectInvite(invite: WorkspaceProjectInvite, mode?: BrowserWorkspaceKind) {
  updateWorkspaceState((state) => {
    state.invites = [...state.invites, invite];
  }, mode);
}

export function updateProjectInvite(id: string, partial: Partial<WorkspaceProjectInvite>, mode?: BrowserWorkspaceKind): WorkspaceProjectInvite | undefined {
  let updated: WorkspaceProjectInvite | undefined;
  updateWorkspaceState((state) => {
    state.invites = state.invites.map((invite) => {
      if (invite.id !== id) return invite;
      updated = { ...invite, ...partial };
      return updated;
    });
  }, mode);
  return updated;
}

export function removeProjectInvite(id: string, mode?: BrowserWorkspaceKind) {
  updateWorkspaceState((state) => {
    state.invites = state.invites.filter((invite) => invite.id !== id);
  }, mode);
}

// Onboarding creates several stages in one loop, so Date.now() repeats across them and
// every event would share an id; the feed is keyed on it.
let stageEventSeq = 0;

export function addStage(stage: Stage) {
  updateWorkspaceState((state) => {
    state.stages = [...state.stages, stage];
    addEventToState(state, {
      id: `evt-auto-${Date.now()}-${(stageEventSeq += 1)}`,
      project_id: stage.project_id,
      actor_id: state.user.id,
      type: "stage_created",
      object_type: "stage",
      object_id: stage.id,
      timestamp: new Date().toISOString(),
      payload: { title: stage.title },
    });
  });
}

export function deleteStage(stageId: string) {
  updateWorkspaceState((state) => {
    const stage = state.stages.find((entry) => entry.id === stageId);
    if (!stage) return;
    state.stages = state.stages.filter((entry) => entry.id !== stageId);
    addEventToState(state, {
      id: `evt-auto-${Date.now()}`,
      project_id: stage.project_id,
      actor_id: state.user.id,
      type: "stage_deleted",
      object_type: "stage",
      object_id: stageId,
      timestamp: new Date().toISOString(),
      payload: { title: stage.title },
    });
  });
}

export function completeStage(stageId: string) {
  updateWorkspaceState((state) => {
    const stage = state.stages.find((entry) => entry.id === stageId);
    if (!stage) return;
    state.stages = state.stages.map((entry) =>
      entry.id === stageId ? { ...entry, status: "completed" as const } : entry,
    );
    addEventToState(state, {
      id: `evt-auto-${Date.now()}`,
      project_id: stage.project_id,
      actor_id: state.user.id,
      type: "stage_completed",
      object_type: "stage",
      object_id: stageId,
      timestamp: new Date().toISOString(),
      payload: { title: stage.title },
    });
  });
}

export function moveTask(taskId: string, newStageId: string) {
  updateWorkspaceState((state) => {
    const task = state.tasks.find((entry) => entry.id === taskId);
    if (!task || task.stage_id === newStageId) return;
    const oldStageId = task.stage_id;
    state.tasks = state.tasks.map((entry) => (entry.id === taskId ? { ...entry, stage_id: newStageId } : entry));
    moveEstimateItemToStage(taskId, newStageId);
    addEventToState(state, {
      id: `evt-auto-${Date.now()}`,
      project_id: task.project_id,
      actor_id: state.user.id,
      type: "task_moved",
      object_type: "task",
      object_id: taskId,
      timestamp: new Date().toISOString(),
      payload: { title: task.title, from_stage: oldStageId, to_stage: newStageId },
    });
  });
}

export function addComment(taskId: string, text: string) {
  updateWorkspaceState((state) => {
    const task = state.tasks.find((entry) => entry.id === taskId);
    if (!task) return;
    const comment = {
      id: `com-${Date.now()}`,
      author_id: state.user.id,
      text,
      created_at: new Date().toISOString(),
    };
    state.tasks = state.tasks.map((entry) =>
      entry.id === taskId ? { ...entry, comments: [...entry.comments, comment] } : entry,
    );
    addEventToState(state, {
      id: `evt-auto-${Date.now()}`,
      project_id: task.project_id,
      actor_id: state.user.id,
      type: "comment_added",
      object_type: "task",
      object_id: taskId,
      timestamp: new Date().toISOString(),
      payload: { title: task.title, text },
    });
  });
}

export function updateChecklist(taskId: string, checklist: ChecklistItem[]) {
  updateWorkspaceState((state) => {
    state.tasks = state.tasks.map((task) => (task.id === taskId ? { ...task, checklist } : task));
  });
}

export function getTask(id: string): Task | undefined {
  return getStateForMode().tasks.find((task) => task.id === id);
}

export function getStage(id: string): Stage | undefined {
  return getStateForMode().stages.find((stage) => stage.id === id);
}

export function deleteTask(id: string) {
  updateWorkspaceState((state) => {
    const task = state.tasks.find((entry) => entry.id === id);
    if (!task) return;
    deleteEstimateItemsForTask(id, task.checklist.map((item) => item.id));
    state.tasks = state.tasks.filter((entry) => entry.id !== id);
  });
}

export function updateTaskDescription(id: string, description: string) {
  updateWorkspaceState((state) => {
    state.tasks = state.tasks.map((task) => (task.id === id ? { ...task, description } : task));
  });
}

export function updateTaskDeadline(id: string, deadline: string | undefined) {
  updateWorkspaceState((state) => {
    state.tasks = state.tasks.map((task) => (task.id === id ? { ...task, deadline } : task));
  });
}

export function addChecklistItem(taskId: string, item: ChecklistItem) {
  updateWorkspaceState((state) => {
    state.tasks = state.tasks.map((task) =>
      task.id === taskId ? { ...task, checklist: [...task.checklist, item] } : task,
    );
  });
}

export function updateChecklistItem(taskId: string, itemId: string, text: string) {
  updateWorkspaceState((state) => {
    state.tasks = state.tasks.map((task) =>
      task.id === taskId
        ? {
            ...task,
            checklist: task.checklist.map((item) => (item.id === itemId ? { ...item, text } : item)),
          }
        : task,
    );
  });
}

export function deleteChecklistItem(taskId: string, itemId: string) {
  updateWorkspaceState((state) => {
    deleteEstimateItemsBySourceId(itemId);
    state.tasks = state.tasks.map((task) =>
      task.id === taskId ? { ...task, checklist: task.checklist.filter((item) => item.id !== itemId) } : task,
    );
  });
}

/**
 * Reset the demo workspace to its pristine seeded state so a later re-entry
 * in the same tab starts from the showcase data, not from whatever the
 * visitor edited while playing around.
 */
function resetDemoState() {
  try {
    sessionStorage.removeItem(DEMO_STATE_KEY);
  } catch {
    // Ignore storage failures; the in-memory reset below still applies.
  }
  demoState = sanitizeDemoState(createSeededDemoState());
  notify();
}

// Pristine-re-entry contract: the demo resets whenever the demo session ends,
// whatever the exit door — the explicit exit control, a login/signup success,
// or logout — since every door goes through clearDemoSession().
onDemoSessionDeactivated(resetDemoState);

export function __unsafeResetStoreForTests() {
  demoState = sanitizeDemoState(loadPersistedDemoState() ?? createSeededDemoState());
  localState = createEmptyLocalState(getStoredAuthProfile());
  localProfileId = localState.user.id;
  listeners.clear();
}
