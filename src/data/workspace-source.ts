import type { SupabaseClient } from "@supabase/supabase-js";
import * as store from "@/data/store";
import { cacheWorkspaceUsers } from "@/data/workspace-profile-cache";
import { getDefaultFinanceVisibility } from "@/lib/participant-role-policy";
import type {
  AIAccess,
  FinanceVisibility,
  InternalDocsVisibility,
  Member,
  Project,
  User,
  ViewerRegime,
} from "@/types/entities";
import { isDemoSessionActive } from "@/lib/auth-state";
import type { Database as WorkspaceDatabase } from "../../backend-truth/generated/supabase-types";

export type WorkspaceProjectInvite = WorkspaceDatabase["public"]["Tables"]["project_invites"]["Row"];
type ProfileRow = WorkspaceDatabase["public"]["Tables"]["profiles"]["Row"];
type ProfileSettingsRow = WorkspaceDatabase["public"]["Tables"]["profile_settings"]["Row"];
type ProfileSettingsInsert = WorkspaceDatabase["public"]["Tables"]["profile_settings"]["Insert"];
type NotificationPreferencesRow = WorkspaceDatabase["public"]["Tables"]["notification_preferences"]["Row"];
type NotificationPreferencesInsert = WorkspaceDatabase["public"]["Tables"]["notification_preferences"]["Insert"];
type ProfilesUpdate = WorkspaceDatabase["public"]["Tables"]["profiles"]["Update"];
type ProjectRow = WorkspaceDatabase["public"]["Tables"]["projects"]["Row"];
type ProjectMemberRow = WorkspaceDatabase["public"]["Tables"]["project_members"]["Row"];
type ProjectInsert = WorkspaceDatabase["public"]["Tables"]["projects"]["Insert"];
type ProjectMemberInsert = WorkspaceDatabase["public"]["Tables"]["project_members"]["Insert"];
type TypedSupabaseClient = SupabaseClient<WorkspaceDatabase>;
export type WorkspaceMode =
  | { kind: "demo" }
  | { kind: "local" }
  | { kind: "supabase"; profileId: string };
export type RuntimeWorkspaceMode = WorkspaceMode | { kind: "guest" };

/** Successful delivery from the `send-project-invite` edge function. */
export type SendWorkspaceProjectInviteEmailSuccessPayload = {
  ok: true;
  inviteId: string;
  recipientEmail: string;
  providerMessageId?: string;
};

/** Result of attempting to send invite email (skipped outside real Supabase workspace). */
export type SendWorkspaceProjectInviteEmailResult =
  | { kind: "sent"; payload: SendWorkspaceProjectInviteEmailSuccessPayload }
  | { kind: "skipped" };

export interface WorkspaceSource {
  mode: WorkspaceMode["kind"];
  getCurrentUser: () => Promise<User>;
  getProfilePreferences: () => Promise<ProfilePreferences>;
  updateProfilePreferences: (patch: ProfilePreferencesPatch) => Promise<ProfilePreferences>;
  getNotificationPreferences: () => Promise<NotificationPreferences>;
  updateNotificationPreferences: (patch: NotificationPreferencesPatch) => Promise<NotificationPreferences>;
  getProfileContactInfo: () => Promise<ProfileContactInfo>;
  updateProfileIdentity: (patch: ProfileIdentityPatch) => Promise<User>;
  updateProfileContactInfo: (patch: ProfileContactInfoPatch) => Promise<ProfileContactInfo>;
  getProjects: () => Promise<Project[]>;
  getProjectById: (projectId: string) => Promise<Project | undefined>;
  getProjectMembers: (projectId: string) => Promise<Member[]>;
  getProjectInvites: (projectId: string) => Promise<WorkspaceProjectInvite[]>;
  createProject: (input: CreateWorkspaceProjectInput) => Promise<Project>;
  deleteProject: (projectId: string) => Promise<void>;
}

export type ProfileCurrency = "RUB" | "USD" | "EUR" | "GBP";
export type ProfileUnits = "metric" | "imperial";
export type ProfileDateFormat = "dd.MM.yyyy" | "MM/dd/yyyy" | "yyyy-MM-dd";
export type ProfileWeekStart = "monday" | "sunday";
export type ProfileAiOutputLanguage = "ru" | "en" | "auto";
export type ProfileAutomationLevel = "manual" | "assisted" | "full" | "observer";

export interface ProfilePreferences {
  currency: ProfileCurrency;
  units: ProfileUnits;
  dateFormat: ProfileDateFormat;
  weekStart: ProfileWeekStart;
  aiOutputLanguage: ProfileAiOutputLanguage;
  automationLevel: ProfileAutomationLevel;
}

export type ProfilePreferencesPatch = Partial<ProfilePreferences>;

export type NotificationDigestFrequency = "instant" | "daily" | "weekly";

/** notification_preferences columns the user edits in Settings -> Notifications. */
export interface NotificationPreferences {
  inAppEnabled: boolean;
  emailEnabled: boolean;
  digestFrequency: NotificationDigestFrequency;
  eventToggles: Record<string, boolean>;
}

export type NotificationPreferencesPatch = Partial<NotificationPreferences>;

/** profiles columns the user edits in Settings (identity is also exposed via User). */
export interface ProfileIdentity {
  fullName: string | null;
  avatarUrl: string | null;
  locale: NonNullable<ProfilesUpdate["locale"]>;
  timezone: string;
}
export type ProfileIdentityPatch = Partial<ProfileIdentity>;

/** profile_settings free-text contact fields edited in Settings. */
export interface ProfileContactInfo {
  roleTitle: string | null;
  phone: string | null;
  bio: string | null;
  signatureBlock: string | null;
}
export type ProfileContactInfoPatch = Partial<ProfileContactInfo>;

export const DEFAULT_PROFILE_PREFERENCES: ProfilePreferences = {
  currency: "RUB",
  units: "metric",
  dateFormat: "dd.MM.yyyy",
  weekStart: "monday",
  aiOutputLanguage: "auto",
  automationLevel: "manual",
};

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  inAppEnabled: true,
  emailEnabled: false,
  digestFrequency: "instant",
  eventToggles: {},
};

export interface CreateWorkspaceProjectInput {
  title: string;
  type: string;
  projectMode: NonNullable<Project["project_mode"]>;
}

export class ProjectDeleteNotPermittedError extends Error {
  constructor(public readonly projectId: string) {
    super(`Delete affected 0 rows for project ${projectId}; the current user is likely not the owner.`);
    this.name = "ProjectDeleteNotPermittedError";
  }
}

function requireNonEmptyProjectTitle(input: CreateWorkspaceProjectInput): string {
  const title = input.title?.trim() ?? "";
  if (!title) {
    throw new Error("Project name is required.");
  }
  return title;
}

const SUPABASE_WORKSPACE_SOURCE = "supabase";
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const LOCAL_PROFILE_PREFERENCES_KEY = "profile-preferences";
const LOCAL_NOTIFICATION_PREFERENCES_KEY = "notification-preferences";

function normalizeProfilePreferences(raw: Partial<ProfilePreferences> | Record<string, unknown> | null | undefined): ProfilePreferences {
  const value = raw ?? {};
  const record = value as Record<string, unknown>;
  const currency = record.currency;
  const units = record.units;
  const dateFormat = record.dateFormat ?? record.date_format;
  const weekStart = record.weekStart ?? record.week_start;
  const aiOutputLanguage = record.aiOutputLanguage ?? record.ai_output_language;
  const automationLevel = record.automationLevel ?? record.automation_level;

  return {
    currency: currency === "RUB" || currency === "USD" || currency === "EUR" || currency === "GBP" ? currency : DEFAULT_PROFILE_PREFERENCES.currency,
    units: units === "metric" || units === "imperial" ? units : DEFAULT_PROFILE_PREFERENCES.units,
    dateFormat: dateFormat === "dd.MM.yyyy" || dateFormat === "MM/dd/yyyy" || dateFormat === "yyyy-MM-dd" ? dateFormat : DEFAULT_PROFILE_PREFERENCES.dateFormat,
    weekStart: weekStart === "monday" || weekStart === "sunday" ? weekStart : DEFAULT_PROFILE_PREFERENCES.weekStart,
    aiOutputLanguage: aiOutputLanguage === "ru" || aiOutputLanguage === "en" || aiOutputLanguage === "auto" ? aiOutputLanguage : DEFAULT_PROFILE_PREFERENCES.aiOutputLanguage,
    automationLevel: automationLevel === "manual" || automationLevel === "assisted" || automationLevel === "full" || automationLevel === "observer" ? automationLevel : DEFAULT_PROFILE_PREFERENCES.automationLevel,
  };
}

function readLocalProfilePreferences(): ProfilePreferences {
  if (typeof window === "undefined") return DEFAULT_PROFILE_PREFERENCES;
  const raw = window.localStorage.getItem(LOCAL_PROFILE_PREFERENCES_KEY);
  if (raw) {
    try {
      return normalizeProfilePreferences(JSON.parse(raw) as Record<string, unknown>);
    } catch {
      return DEFAULT_PROFILE_PREFERENCES;
    }
  }
  return normalizeProfilePreferences({
    currency: window.localStorage.getItem("profile-currency"),
    automationLevel: window.localStorage.getItem("profile-automation-level"),
  });
}

function writeLocalProfilePreferences(next: ProfilePreferences): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(LOCAL_PROFILE_PREFERENCES_KEY, JSON.stringify(next));
  window.localStorage.setItem("profile-currency", next.currency);
  window.localStorage.setItem("profile-automation-level", next.automationLevel);
}

function mapProfileSettingsRowToPreferences(
  row: Pick<ProfileSettingsRow, "currency" | "units" | "date_format" | "week_start" | "ai_output_language" | "automation_level"> | null | undefined,
): ProfilePreferences {
  return normalizeProfilePreferences(row as Record<string, unknown> | null | undefined);
}

function normalizeEventToggles(raw: unknown): Record<string, boolean> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const result: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    result[key] = Boolean(value);
  }
  return result;
}

function normalizeNotificationPreferences(
  raw: Partial<NotificationPreferences> | Record<string, unknown> | null | undefined,
): NotificationPreferences {
  const value = raw ?? {};
  const record = value as Record<string, unknown>;
  const inAppEnabled = record.inAppEnabled ?? record.in_app_enabled;
  const emailEnabled = record.emailEnabled ?? record.email_enabled;
  const digestFrequency = record.digestFrequency ?? record.digest_frequency;
  const eventToggles = record.eventToggles ?? record.event_toggles;

  return {
    inAppEnabled: typeof inAppEnabled === "boolean" ? inAppEnabled : DEFAULT_NOTIFICATION_PREFERENCES.inAppEnabled,
    emailEnabled: typeof emailEnabled === "boolean" ? emailEnabled : DEFAULT_NOTIFICATION_PREFERENCES.emailEnabled,
    digestFrequency: digestFrequency === "instant" || digestFrequency === "daily" || digestFrequency === "weekly" ? digestFrequency : DEFAULT_NOTIFICATION_PREFERENCES.digestFrequency,
    eventToggles: normalizeEventToggles(eventToggles),
  };
}

function readLocalNotificationPreferences(): NotificationPreferences {
  if (typeof window === "undefined") return DEFAULT_NOTIFICATION_PREFERENCES;
  const raw = window.localStorage.getItem(LOCAL_NOTIFICATION_PREFERENCES_KEY);
  if (raw) {
    try {
      return normalizeNotificationPreferences(JSON.parse(raw) as Record<string, unknown>);
    } catch {
      return DEFAULT_NOTIFICATION_PREFERENCES;
    }
  }
  return DEFAULT_NOTIFICATION_PREFERENCES;
}

function writeLocalNotificationPreferences(next: NotificationPreferences): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(LOCAL_NOTIFICATION_PREFERENCES_KEY, JSON.stringify(next));
}

function mapNotificationPreferencesRowToPreferences(
  row: Pick<NotificationPreferencesRow, "in_app_enabled" | "email_enabled" | "digest_frequency" | "event_toggles"> | null | undefined,
): NotificationPreferences {
  return normalizeNotificationPreferences(row as Record<string, unknown> | null | undefined);
}

function notificationPreferencesToDbPatch(
  profileId: string,
  preferences: NotificationPreferences,
): NotificationPreferencesInsert {
  return {
    profile_id: profileId,
    in_app_enabled: preferences.inAppEnabled,
    email_enabled: preferences.emailEnabled,
    digest_frequency: preferences.digestFrequency,
    event_toggles: preferences.eventToggles,
  };
}

function profilePreferencesToDbPatch(profileId: string, preferences: ProfilePreferences): ProfileSettingsInsert {
  return {
    profile_id: profileId,
    currency: preferences.currency,
    units: preferences.units,
    date_format: preferences.dateFormat,
    week_start: preferences.weekStart,
    ai_output_language: preferences.aiOutputLanguage,
    automation_level: preferences.automationLevel,
  };
}

function isBrowserWorkspaceMode(
  mode: WorkspaceMode | RuntimeWorkspaceMode,
): mode is Extract<WorkspaceMode, { kind: "demo" | "local" }> {
  return mode.kind === "demo" || mode.kind === "local";
}

async function ensureOwnerProjectMember(
  supabase: TypedSupabaseClient,
  input: {
    projectId: string;
    profileId: string;
  },
): Promise<void> {
  const { data, error } = await supabase
    .from("project_members")
    .select("*")
    .eq("project_id", input.projectId)
    .eq("profile_id", input.profileId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (data) {
    return;
  }

  const insert: ProjectMemberInsert = {
    project_id: input.projectId,
    profile_id: input.profileId,
    role: "owner",
    ai_access: "project_pool",
    viewer_regime: null,
    credit_limit: 500,
    used_credits: 0,
    finance_visibility: "detail",
  };

  const { error: insertError } = await supabase
    .from("project_members")
    .insert(insert);

  if (insertError) {
    throw insertError;
  }
}

function createBrowserWorkspaceSource(mode: store.BrowserWorkspaceKind): WorkspaceSource {
  return {
    mode,
    async getCurrentUser() {
      return store.getCurrentUserForMode(mode);
    },
    async getProfilePreferences() {
      return readLocalProfilePreferences();
    },
    async updateProfilePreferences(patch: ProfilePreferencesPatch) {
      const next = normalizeProfilePreferences({
        ...readLocalProfilePreferences(),
        ...patch,
      });
      writeLocalProfilePreferences(next);
      return next;
    },
    async getNotificationPreferences() {
      return readLocalNotificationPreferences();
    },
    async updateNotificationPreferences(patch: NotificationPreferencesPatch) {
      const next = normalizeNotificationPreferences({
        ...readLocalNotificationPreferences(),
        ...patch,
      });
      writeLocalNotificationPreferences(next);
      return next;
    },
    async getProfileContactInfo() {
      return { roleTitle: null, phone: null, bio: null, signatureBlock: null };
    },
    async updateProfileIdentity() {
      // Demo/local identity is seed data and not persisted; echo the current user.
      return store.getCurrentUserForMode(mode);
    },
    async updateProfileContactInfo(patch: ProfileContactInfoPatch) {
      return {
        roleTitle: patch.roleTitle ?? null,
        phone: patch.phone ?? null,
        bio: patch.bio ?? null,
        signatureBlock: patch.signatureBlock ?? null,
      };
    },
    async getProjects() {
      return store.getProjectsForMode(mode);
    },
    async getProjectById(projectId: string) {
      return store.getProjectForMode(mode, projectId);
    },
    async getProjectMembers(projectId: string) {
      return store.getMembersForMode(mode, projectId);
    },
    async getProjectInvites(projectId: string) {
      return store.getProjectInvitesForMode(mode, projectId);
    },
    async createProject(input: CreateWorkspaceProjectInput) {
      const user = store.getCurrentUserForMode(mode);
      const title = requireNonEmptyProjectTitle(input);
      const project: Project = {
        id: `project-manual-${Date.now()}`,
        owner_id: user.id,
        title,
        type: input.type,
        project_mode: input.projectMode,
        automation_level: "manual",
        current_stage_id: "",
        progress_pct: 0,
      };

      store.addProject(project);
      store.addMember({
        project_id: project.id,
        user_id: user.id,
        role: "owner",
        ai_access: "project_pool",
        finance_visibility: "detail",
        credit_limit: 500,
        used_credits: 0,
      });

      return project;
    },
    async deleteProject(projectId: string) {
      store.removeProject(projectId, mode);
    },
  };
}

export function mapProfileRowToUser(
  row: Pick<ProfileRow, "id" | "email" | "full_name" | "avatar_url" | "locale" | "timezone" | "plan" | "credits_free" | "credits_paid">,
): User {
  return {
    id: row.id,
    email: row.email ?? "",
    name: row.full_name ?? row.email ?? "Unknown user",
    avatar: row.avatar_url ?? undefined,
    locale: row.locale,
    timezone: row.timezone,
    plan: row.plan,
    credits_free: row.credits_free,
    credits_paid: row.credits_paid,
  };
}

export function mapProjectRowToProject(row: ProjectRow): Project {
  return {
    id: row.id,
    owner_id: row.owner_profile_id,
    title: row.title,
    type: row.project_type,
    project_mode: row.project_mode,
    automation_level: row.automation_level,
    current_stage_id: row.current_stage_id ?? "",
    progress_pct: row.progress_pct,
    address: row.address ?? undefined,
    ai_description: row.ai_description ?? undefined,
  };
}

export function mapProjectMemberRowToMember(row: ProjectMemberRow): Member {
  const internalDocsVisibility = (row as ProjectMemberRow & {
    internal_docs_visibility?: InternalDocsVisibility | null;
  }).internal_docs_visibility;

  return {
    project_id: row.project_id,
    user_id: row.profile_id,
    role: row.role,
    viewer_regime: row.viewer_regime ?? undefined,
    ai_access: row.ai_access,
    finance_visibility: row.finance_visibility,
    credit_limit: row.credit_limit,
    used_credits: row.used_credits,
    ...(internalDocsVisibility !== undefined
      ? { internal_docs_visibility: internalDocsVisibility ?? undefined }
      : {}),
  };
}

export function filterActiveProjectRows(rows: ProjectRow[]): ProjectRow[] {
  return rows.filter((row) => row.archived_at == null);
}

export function isSupabaseWorkspaceRequested(): boolean {
  return import.meta.env.VITE_WORKSPACE_SOURCE === SUPABASE_WORKSPACE_SOURCE;
}

export function hasSupabaseWorkspaceConfig(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY);
}

export function selectWorkspaceMode(input: {
  requestedSource?: string;
  hasSupabaseConfig: boolean;
  sessionProfileId?: string | null;
  demoSessionActive?: boolean;
}): WorkspaceMode {
  if (input.demoSessionActive) {
    return { kind: "demo" };
  }

  if (input.requestedSource !== SUPABASE_WORKSPACE_SOURCE) {
    return { kind: "local" };
  }

  if (!input.hasSupabaseConfig || !input.sessionProfileId) {
    return { kind: "local" };
  }

  return { kind: "supabase", profileId: input.sessionProfileId };
}

export function selectRuntimeWorkspaceMode(input: {
  requestedSource?: string;
  hasSupabaseConfig: boolean;
  sessionProfileId?: string | null;
  demoSessionActive?: boolean;
}): RuntimeWorkspaceMode {
  if (input.demoSessionActive) {
    return { kind: "demo" };
  }

  if (input.requestedSource !== SUPABASE_WORKSPACE_SOURCE) {
    return { kind: "local" };
  }

  if (!input.hasSupabaseConfig || !input.sessionProfileId) {
    return { kind: "guest" };
  }

  return { kind: "supabase", profileId: input.sessionProfileId };
}

async function loadSupabaseClient(): Promise<TypedSupabaseClient> {
  const { supabase } = await import("@/integrations/supabase/client");
  return supabase as unknown as TypedSupabaseClient;
}

/**
 * A failure message plus whether it is worth showing a user verbatim.
 *
 * `diagnostic: false` means the text is OUR OWN English -- something the edge
 * function put in its `{ "error": ... }` body, or a client-side assertion. It has
 * to be replaced before it reaches a Russian toast, and the caller has localized
 * copy for it.
 *
 * `diagnostic: true` means nobody planned this message: a network failure, a
 * proxy page, an HTTP status with no body. It is the only description of what
 * went wrong that exists, so swallowing it makes the toast useless exactly when
 * something unforeseen happened.
 *
 * Carrying the ORIGIN rather than the text is the point. `send-project-invite`
 * answers with fourteen fixed strings AND two dynamic branches that render
 * whatever `ProjectInviteEmailConfigError` carries (missing env var, malformed
 * PROJECT_INVITE_BASE_URL, and so on). Any list of strings kept on this side is
 * incomplete the moment the function grows a message, and the incompleteness is
 * silent: the new string simply falls through into the UI in English. A review
 * round caught exactly that after the first version of this enumerated eleven of
 * them and called the list exhaustive.
 */
interface EdgeFunctionFailure {
  readonly message: string;
  readonly diagnostic: boolean;
}

/**
 * Thrown by `sendWorkspaceProjectInviteEmail` so the UI can tell OUR English from
 * an unplanned failure without matching on message text. See EdgeFunctionFailure
 * for what `diagnostic` means; `describeInviteSendError` is the consumer.
 */
export class ProjectInviteEmailSendError extends Error {
  constructor(message: string, public readonly diagnostic: boolean) {
    super(message);
    this.name = "ProjectInviteEmailSendError";
  }
}

function messageFromEdgeFunctionFailure(error: unknown, data: unknown): EdgeFunctionFailure {
  const fromJson = parseEdgeFunctionErrorBody(data);
  if (fromJson) return { message: fromJson, diagnostic: false };
  if (error && typeof error === "object" && "message" in error && typeof (error as { message: unknown }).message === "string") {
    return { message: (error as { message: string }).message, diagnostic: true };
  }
  return { message: "Unable to send invite email", diagnostic: false };
}

/**
 * When `functions.invoke` fails with `FunctionsHttpError`, `error.context` is the raw `Response`
 * (body not yet consumed). Read JSON `{ error }` or text so toasts show the backend reason.
 */
async function messageFromFunctionsInvokeFailure(
  error: unknown,
  data: unknown,
): Promise<EdgeFunctionFailure> {
  const fromData = parseEdgeFunctionErrorBody(data);
  if (fromData) return { message: fromData, diagnostic: false };

  if (error && typeof error === "object" && "context" in error) {
    const ctx = (error as { context?: unknown }).context;
    if (typeof Response !== "undefined" && ctx instanceof Response) {
      const status = ctx.status;
      const raw = await ctx.clone().text().catch(() => "");
      const trimmed = raw.trim();
      if (trimmed) {
        // A parsed `{ error }` is the FUNCTION speaking. All SEVENTEEN of its
        // error responses use that key -- fourteen fixed strings plus two dynamic
        // branches -- and so does withSentry's uncaught-throw 500. The only
        // bodies that are not `{ error }` are the success payload and the OPTIONS
        // `"ok"`, neither of which reaches here. So this is our own English and
        // gets localized. (The `message:` occurrences in that file are fields of
        // console.error log objects, not response bodies.)
        //
        // A parsed `{ message }` is therefore NOT the function; it is the
        // platform in front of it. Most of those are whole-deployment conditions
        // whose text is the only clue which one it is -- a function not deployed
        // to this environment, a BOOT_ERROR -- and swallowing that while the
        // branches below surface a raw proxy page and a bare HTTP status, which
        // say strictly less, would be inconsistent as well as unhelpful.
        //
        // But NOT all of them, and the exception is the common one. A gateway 401
        // or 403 is per-USER, not per-deployment: a session that lapsed between
        // page load and pressing the button produces `{"code":401,"message":"Invalid
        // JWT"}`, and "Invalid JWT" is both English and useless to the person
        // reading it. Auth statuses therefore keep the localized copy; everything
        // else keeps its text.
        try {
          const j = JSON.parse(trimmed) as Record<string, unknown>;
          if (typeof j.error === "string") return { message: j.error, diagnostic: false };
          if (j.error && typeof j.error === "object" && j.error !== null && "message" in j.error) {
            const m = (j.error as { message?: unknown }).message;
            if (typeof m === "string") return { message: m, diagnostic: false };
          }
          if (typeof j.message === "string") {
            const isAuthStatus = status === 401 || status === 403;
            return { message: j.message, diagnostic: !isAuthStatus };
          }
        } catch {
          /* not JSON */
        }
        const body = trimmed.length <= 400 ? trimmed : `${trimmed.slice(0, 400)}…`;
        return { message: body, diagnostic: true };
      }
      const statusText = ctx.statusText?.trim();
      return {
        message: statusText ? `HTTP ${status} ${statusText}` : `HTTP ${status}`,
        diagnostic: true,
      };
    }
  }

  return messageFromEdgeFunctionFailure(error, data);
}

function parseEdgeFunctionErrorBody(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const record = data as Record<string, unknown>;
  if (typeof record.error === "string") return record.error;
  if (record.error && typeof record.error === "object" && "message" in record.error
    && typeof (record.error as { message: unknown }).message === "string") {
    return (record.error as { message: string }).message;
  }
  return null;
}

function parseSendProjectInviteSuccess(data: unknown, fallbackInviteId: string): SendWorkspaceProjectInviteEmailSuccessPayload | null {
  if (!data || typeof data !== "object") return null;
  const record = data as Record<string, unknown>;
  if (record.ok !== true) return null;
  const inviteId = typeof record.inviteId === "string" ? record.inviteId : fallbackInviteId;
  const recipientEmail = typeof record.recipientEmail === "string" ? record.recipientEmail : "";
  const providerMessageId = typeof record.providerMessageId === "string" ? record.providerMessageId : undefined;
  return {
    ok: true,
    inviteId,
    recipientEmail,
    providerMessageId,
  };
}

/**
 * Sends the invite email via Supabase Edge Function `send-project-invite`.
 * Only calls the backend when `mode.kind === "supabase"`; demo/local IDs are not valid for the sender.
 */
export async function sendWorkspaceProjectInviteEmail(
  mode: WorkspaceMode | RuntimeWorkspaceMode,
  inviteId: string,
): Promise<SendWorkspaceProjectInviteEmailResult> {
  if (mode.kind === "guest") {
    throw new Error("An authenticated Supabase session is required.");
  }

  if (mode.kind !== "supabase") {
    return { kind: "skipped" };
  }

  const supabase = await loadSupabaseClient();
  const { data, error } = await supabase.functions.invoke("send-project-invite", {
    body: { inviteId },
  });

  if (error) {
    const failure = await messageFromFunctionsInvokeFailure(error, data);
    throw new ProjectInviteEmailSendError(failure.message, failure.diagnostic);
  }

  const parsed = parseSendProjectInviteSuccess(data, inviteId);
  if (parsed) {
    return { kind: "sent", payload: parsed };
  }

  const bodyError = parseEdgeFunctionErrorBody(data);
  if (bodyError) {
    throw new ProjectInviteEmailSendError(bodyError, false);
  }

  // A 200 whose body is neither a success nor an `{ error }`. Not diagnostic: the
  // string names an internal contract and tells a user nothing they can act on.
  throw new ProjectInviteEmailSendError("Unexpected response from send-project-invite", false);
}

export async function resolveWorkspaceMode(): Promise<WorkspaceMode> {
  if (isDemoSessionActive()) {
    return { kind: "demo" };
  }

  if (!isSupabaseWorkspaceRequested()) {
    return { kind: "local" };
  }

  const hasSupabaseConfig = Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY);
  if (!hasSupabaseConfig) {
    return { kind: "local" };
  }

  try {
    const supabase = await loadSupabaseClient();
    const { data, error } = await supabase.auth.getSession();

    return selectWorkspaceMode({
      requestedSource: SUPABASE_WORKSPACE_SOURCE,
      hasSupabaseConfig,
      sessionProfileId: error ? null : data.session?.user?.id ?? null,
      demoSessionActive: false,
    });
  } catch {
    return { kind: "local" };
  }
}

export async function resolveRuntimeWorkspaceMode(): Promise<RuntimeWorkspaceMode> {
  if (isDemoSessionActive()) {
    return { kind: "demo" };
  }

  if (!isSupabaseWorkspaceRequested()) {
    return { kind: "local" };
  }

  if (!hasSupabaseWorkspaceConfig()) {
    return { kind: "guest" };
  }

  try {
    const supabase = await loadSupabaseClient();
    const { data, error } = await supabase.auth.getSession();

    return selectRuntimeWorkspaceMode({
      requestedSource: SUPABASE_WORKSPACE_SOURCE,
      hasSupabaseConfig: true,
      sessionProfileId: error ? null : data.session?.user?.id ?? null,
      demoSessionActive: false,
    });
  } catch {
    return { kind: "guest" };
  }
}

async function loadVisibleProfiles(
  supabase: TypedSupabaseClient,
  profileIds: string[],
): Promise<User[]> {
  const uniqueIds = Array.from(new Set(profileIds.filter(Boolean)));
  if (uniqueIds.length === 0) return [];

  const { data, error } = await supabase
    .from("profiles")
    .select("id, email, full_name, avatar_url, locale, timezone, plan, credits_free, credits_paid")
    .in("id", uniqueIds);

  if (error || !data) return [];

  const users = data.map(mapProfileRowToUser);
  cacheWorkspaceUsers(users);
  return users;
}

function createSupabaseWorkspaceSource(
  supabase: TypedSupabaseClient,
  profileId: string,
): WorkspaceSource {
  async function readRemoteProfilePreferences(): Promise<ProfilePreferences> {
    const { data, error } = await supabase
      .from("profile_settings")
      .select("currency, units, date_format, week_start, ai_output_language, automation_level")
      .eq("profile_id", profileId)
      .maybeSingle();

    if (error) {
      throw error;
    }

    return mapProfileSettingsRowToPreferences(data);
  }

  async function readRemoteNotificationPreferences(): Promise<NotificationPreferences> {
    const { data, error } = await supabase
      .from("notification_preferences")
      .select("in_app_enabled, email_enabled, digest_frequency, event_toggles")
      .eq("profile_id", profileId)
      .maybeSingle();

    if (error) {
      throw error;
    }

    return mapNotificationPreferencesRowToPreferences(data);
  }

  return {
    mode: "supabase",
    async getCurrentUser() {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, email, full_name, avatar_url, locale, timezone, plan, credits_free, credits_paid")
        .eq("id", profileId)
        .maybeSingle();

      if (error || !data) {
        throw error ?? new Error("Current workspace profile not found");
      }

      const user = mapProfileRowToUser(data);
      cacheWorkspaceUsers([user]);
      return user;
    },

    async getProfilePreferences() {
      return readRemoteProfilePreferences();
    },

    async updateProfilePreferences(patch: ProfilePreferencesPatch) {
      const current = await readRemoteProfilePreferences();
      const next = normalizeProfilePreferences({ ...current, ...patch });
      const { data, error } = await supabase
        .from("profile_settings")
        .upsert(profilePreferencesToDbPatch(profileId, next), { onConflict: "profile_id" })
        .select("currency, units, date_format, week_start, ai_output_language, automation_level")
        .single();

      if (error) {
        throw error;
      }

      return mapProfileSettingsRowToPreferences(data);
    },

    async getNotificationPreferences() {
      return readRemoteNotificationPreferences();
    },

    async updateNotificationPreferences(patch: NotificationPreferencesPatch) {
      const current = await readRemoteNotificationPreferences();
      const next = normalizeNotificationPreferences({ ...current, ...patch });
      const { data, error } = await supabase
        .from("notification_preferences")
        .upsert(notificationPreferencesToDbPatch(profileId, next), { onConflict: "profile_id" })
        .select("in_app_enabled, email_enabled, digest_frequency, event_toggles")
        .single();

      if (error) {
        throw error;
      }

      return mapNotificationPreferencesRowToPreferences(data);
    },

    async getProfileContactInfo() {
      const { data, error } = await supabase
        .from("profile_settings")
        .select("role_title, phone, bio, signature_block")
        .eq("profile_id", profileId)
        .maybeSingle();

      if (error) {
        throw error;
      }

      return {
        roleTitle: data?.role_title ?? null,
        phone: data?.phone ?? null,
        bio: data?.bio ?? null,
        signatureBlock: data?.signature_block ?? null,
      };
    },

    async updateProfileIdentity(patch: ProfileIdentityPatch) {
      const update: ProfilesUpdate = {};
      if (patch.fullName !== undefined) update.full_name = patch.fullName;
      if (patch.avatarUrl !== undefined) update.avatar_url = patch.avatarUrl;
      if (patch.locale !== undefined) update.locale = patch.locale;
      if (patch.timezone !== undefined) update.timezone = patch.timezone;

      const { data, error } = await supabase
        .from("profiles")
        .update(update)
        .eq("id", profileId)
        .select("id, email, full_name, avatar_url, locale, timezone, plan, credits_free, credits_paid")
        .single();

      if (error || !data) {
        throw error ?? new Error("Current workspace profile not found");
      }

      const user = mapProfileRowToUser(data);
      cacheWorkspaceUsers([user]);
      return user;
    },

    async updateProfileContactInfo(patch: ProfileContactInfoPatch) {
      const payload: ProfileSettingsInsert = {
        profile_id: profileId,
        role_title: patch.roleTitle ?? null,
        phone: patch.phone ?? null,
        bio: patch.bio ?? null,
        signature_block: patch.signatureBlock ?? null,
      };
      const { data, error } = await supabase
        .from("profile_settings")
        .upsert(payload, { onConflict: "profile_id" })
        .select("role_title, phone, bio, signature_block")
        .single();

      if (error) {
        throw error;
      }

      return {
        roleTitle: data.role_title ?? null,
        phone: data.phone ?? null,
        bio: data.bio ?? null,
        signatureBlock: data.signature_block ?? null,
      };
    },

    async getProjects() {
      const { data, error } = await supabase
        .from("projects")
        .select("*")
        .is("archived_at", null)
        .order("updated_at", { ascending: false });

      if (error) {
        throw error;
      }

      const activeRows = filterActiveProjectRows(data ?? []);
      return activeRows.map(mapProjectRowToProject);
    },

    async getProjectById(projectId: string) {
      const { data, error } = await supabase
        .from("projects")
        .select("*")
        .eq("id", projectId)
        .is("archived_at", null)
        .maybeSingle();

      if (error) {
        throw error;
      }

      if (!data) {
        return undefined;
      }

      await loadVisibleProfiles(supabase, [data.owner_profile_id]);
      return mapProjectRowToProject(data);
    },

    async getProjectMembers(projectId: string) {
      const { data, error } = await supabase
        .from("project_members")
        .select("*")
        .eq("project_id", projectId)
        .order("joined_at", { ascending: true });

      if (error) {
        throw error;
      }

      const rows = data ?? [];
      await loadVisibleProfiles(supabase, rows.map((row) => row.profile_id));
      return rows.map(mapProjectMemberRowToMember);
    },

    async getProjectInvites(projectId: string) {
      const { data, error } = await supabase
        .from("project_invites")
        .select("*")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false });

      if (error) {
        throw error;
      }

      const rows = data ?? [];
      await loadVisibleProfiles(supabase, rows.flatMap((row) => [row.invited_by, row.accepted_profile_id ?? ""]));
      return rows;
    },

    async createProject(input: CreateWorkspaceProjectInput) {
      const title = requireNonEmptyProjectTitle(input);
      const insert: ProjectInsert = {
        owner_profile_id: profileId,
        title,
        project_type: input.type,
        project_mode: input.projectMode,
        automation_level: "manual",
        progress_pct: 0,
      };

      const { data, error } = await supabase
        .from("projects")
        .insert(insert)
        .select("*")
        .single();

      if (error || !data) {
        throw error ?? new Error("Unable to create project");
      }

      await ensureOwnerProjectMember(supabase, {
        projectId: data.id,
        profileId,
      });

      return mapProjectRowToProject(data);
    },
    async deleteProject(projectId: string) {
      const { error, count } = await supabase
        .from("projects")
        .delete({ count: "exact" })
        .eq("id", projectId)
        .eq("owner_profile_id", profileId);

      if (error) {
        throw error;
      }

      if (!count) {
        throw new ProjectDeleteNotPermittedError(projectId);
      }
    },
  };
}

export async function getWorkspaceSource(
  mode?: WorkspaceMode | RuntimeWorkspaceMode,
): Promise<WorkspaceSource> {
  const resolvedMode = mode ?? await resolveWorkspaceMode();
  if (resolvedMode.kind === "guest") {
    throw new Error("An authenticated Supabase session is required.");
  }

  if (isBrowserWorkspaceMode(resolvedMode)) {
    return createBrowserWorkspaceSource(resolvedMode.kind);
  }

  const supabase = await loadSupabaseClient();
  return createSupabaseWorkspaceSource(supabase, resolvedMode.profileId);
}

export async function updateWorkspaceProjectMemberRole(
  mode: WorkspaceMode | RuntimeWorkspaceMode,
  input: {
    projectId: string;
    userId: string;
    role: Member["role"];
    aiAccess?: AIAccess;
    viewerRegime?: ViewerRegime;
    creditLimit?: number;
    financeVisibility?: FinanceVisibility;
    internalDocsVisibility?: InternalDocsVisibility;
  },
): Promise<Member> {
  if (mode.kind === "guest") {
    throw new Error("An authenticated Supabase session is required.");
  }

  if (isBrowserWorkspaceMode(mode)) {
    const updated = store.updateMember(input.projectId, input.userId, {
      role: input.role,
      ai_access: input.aiAccess,
      viewer_regime: input.viewerRegime,
      credit_limit: input.creditLimit,
      finance_visibility: input.financeVisibility,
      ...(input.internalDocsVisibility !== undefined
        ? { internal_docs_visibility: input.internalDocsVisibility }
        : {}),
    }, mode.kind);
    if (!updated) {
      throw new Error("Project member not found");
    }
    return updated;
  }

  const patch: Record<string, unknown> = {
    role: input.role,
    ai_access: input.aiAccess,
    viewer_regime: input.viewerRegime ?? null,
    credit_limit: input.creditLimit,
  };
  if (input.financeVisibility !== undefined) {
    patch.finance_visibility = input.financeVisibility;
  }
  if (input.internalDocsVisibility !== undefined) {
    patch.internal_docs_visibility = input.internalDocsVisibility;
  }

  const supabase = await loadSupabaseClient();
  const { data, error } = await supabase
    .from("project_members")
    .update(patch)
    .eq("project_id", input.projectId)
    .eq("profile_id", input.userId)
    .select("*")
    .single();

  if (error || !data) {
    throw error ?? new Error("Unable to update project member");
  }

  return mapProjectMemberRowToMember(data);
}

export class ProjectMemberRemoveNotPermittedError extends Error {
  constructor(public readonly projectId: string, public readonly userId: string) {
    super(`Delete affected 0 rows for member ${userId} on project ${projectId}; RLS allows only the project owner to remove non-owner members.`);
    this.name = "ProjectMemberRemoveNotPermittedError";
  }
}

/**
 * Removes a member row. DB truth: DELETE on project_members is owner-only and
 * never targets the owner's own row (rovno-db 20260325133000); callers must
 * pre-gate with `canRemoveMember` so this does not 0-row for expected reasons.
 */
export async function removeWorkspaceProjectMember(
  mode: WorkspaceMode | RuntimeWorkspaceMode,
  input: { projectId: string; userId: string },
): Promise<void> {
  if (mode.kind === "guest") {
    throw new Error("An authenticated Supabase session is required.");
  }

  if (isBrowserWorkspaceMode(mode)) {
    const removed = store.removeMember(input.projectId, input.userId, mode.kind);
    if (!removed) {
      throw new Error("Project member not found");
    }
    return;
  }

  const supabase = await loadSupabaseClient();
  const { error, count } = await supabase
    .from("project_members")
    .delete({ count: "exact" })
    .eq("project_id", input.projectId)
    .eq("profile_id", input.userId);

  if (error) {
    throw error;
  }

  if (!count) {
    throw new ProjectMemberRemoveNotPermittedError(input.projectId, input.userId);
  }
}

export class ProjectInviteNoLongerPendingError extends Error {
  constructor(public readonly inviteId: string) {
    super(`Invite ${inviteId} is no longer pending; it was accepted, revoked or expired concurrently.`);
    this.name = "ProjectInviteNoLongerPendingError";
  }
}

/**
 * A pending invite for this address already exists on this project, so the
 * insert hit `idx_project_invites_active_email`.
 *
 * This became reachable in ordinary use with rovno-db 20260729130100. Invites
 * now expire, but nothing flips an expired one to `expired` -- expiry is a
 * derived state, and the row stays `pending`, so it keeps its slot in that
 * partial index. Fifteen days after an invite is ignored, re-inviting the same
 * address fails here rather than at any check the UI performs, because the two
 * client-side pre-checks (`pendingInviteEmailSet` and friends) validate against
 * a React Query cache that has no idea the row is dead.
 *
 * Surfaced as a typed error rather than the raw PostgREST one because
 * "duplicate key value violates unique constraint" is both English and useless:
 * the actionable instruction is to revoke the outstanding invite, and the
 * revoke button is already in the participants list.
 */
export class ProjectInviteAlreadyOutstandingError extends Error {
  constructor(public readonly email: string) {
    super(`A pending invite for ${email} already exists on this project.`);
    this.name = "ProjectInviteAlreadyOutstandingError";
  }
}

/**
 * Narrow: a 23505 on this table can also come from the `unique (invite_token)`
 * constraint, which would be a collision of two gen_random_uuid() values and
 * emphatically not something to tell the user to fix by revoking an invite. So
 * match the index by name and let anything else through untouched.
 */
function isActiveInviteEmailConflict(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; message?: unknown };
  if (candidate.code !== "23505") return false;
  return typeof candidate.message === "string"
    && candidate.message.includes("idx_project_invites_active_email");
}

/**
 * Revokes a pending invite (status → 'revoked'), keeping the row for history.
 *
 * Deliberately a dedicated status-only UPDATE: `updateWorkspaceProjectInvite`
 * always writes `viewer_regime ?? null` and would clobber axes on a partial
 * call. The `.eq("status", "pending")` guard makes a concurrent accept lose
 * gracefully instead of flipping an accepted invite to revoked.
 *
 * DB truth: the UPDATE re-runs the delegation trigger against the row's final
 * values, so a co_owner cannot revoke a co_owner invite or one whose axes
 * exceed their caps — callers pre-gate with `canRevokeInvite`.
 */
export async function revokeWorkspaceProjectInvite(
  mode: WorkspaceMode | RuntimeWorkspaceMode,
  input: { id: string; projectId: string },
): Promise<WorkspaceProjectInvite> {
  if (mode.kind === "guest") {
    throw new Error("An authenticated Supabase session is required.");
  }

  if (isBrowserWorkspaceMode(mode)) {
    const current = store.getProjectInvitesForMode(mode.kind, input.projectId).find((invite) => invite.id === input.id);
    if (!current || current.status !== "pending") {
      throw new ProjectInviteNoLongerPendingError(input.id);
    }
    const updated = store.updateProjectInvite(input.id, { status: "revoked" }, mode.kind);
    if (!updated) {
      throw new Error("Project invite not found");
    }
    return updated;
  }

  const supabase = await loadSupabaseClient();
  const { data, error } = await supabase
    .from("project_invites")
    .update({ status: "revoked" })
    .eq("id", input.id)
    .eq("project_id", input.projectId)
    .eq("status", "pending")
    .select("*")
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data) {
    throw new ProjectInviteNoLongerPendingError(input.id);
  }

  return data;
}

export async function createWorkspaceProjectInvite(
  mode: WorkspaceMode | RuntimeWorkspaceMode,
  input: {
    projectId: string;
    email: string;
    role: WorkspaceProjectInvite["role"];
    aiAccess: WorkspaceProjectInvite["ai_access"];
    viewerRegime: WorkspaceProjectInvite["viewer_regime"];
    creditLimit: number;
    invitedBy: string;
    financeVisibility?: FinanceVisibility;
    internalDocsVisibility?: InternalDocsVisibility;
    /** When set, the invitee is also added to this org on accept. */
    addToOrgId?: string | null;
  },
): Promise<WorkspaceProjectInvite> {
  if (mode.kind === "guest") {
    throw new Error("An authenticated Supabase session is required.");
  }

  const resolvedFinanceVisibility = input.financeVisibility
    ?? getDefaultFinanceVisibility(input.role);
  const resolvedInternalDocsVisibility = input.internalDocsVisibility
    ?? (input.role === "viewer" ? "none" : "view");

  if (isBrowserWorkspaceMode(mode)) {
    const invite = {
      id: `invite-${Date.now()}`,
      project_id: input.projectId,
      email: input.email.trim(),
      role: input.role,
      ai_access: input.aiAccess,
      viewer_regime: input.viewerRegime ?? null,
      credit_limit: input.creditLimit,
      invited_by: input.invitedBy,
      status: "pending",
      invite_token: `invite-token-${Date.now()}`,
      accepted_profile_id: null,
      created_at: new Date().toISOString(),
      accepted_at: null,
      finance_visibility: resolvedFinanceVisibility,
      internal_docs_visibility: resolvedInternalDocsVisibility,
    } as WorkspaceProjectInvite;
    store.addProjectInvite(invite, mode.kind);
    return invite;
  }

  const supabase = await loadSupabaseClient();
  // `add_to_org_id` is added by the Session 2 migration; the generated
  // Insert type catches up on the next backend-truth sync. Until then,
  // build the payload as a record and cast through unknown for the
  // narrow window where the column exists in the DB but not in types.
  const basePayload = {
    project_id: input.projectId,
    email: input.email.trim(),
    role: input.role,
    ai_access: input.aiAccess,
    viewer_regime: input.viewerRegime ?? null,
    credit_limit: input.creditLimit,
    invited_by: input.invitedBy,
    finance_visibility: resolvedFinanceVisibility,
    internal_docs_visibility: resolvedInternalDocsVisibility,
  };
  const insertPayload = input.addToOrgId
    ? ({ ...basePayload, add_to_org_id: input.addToOrgId } as unknown as typeof basePayload)
    : basePayload;
  const { data, error } = await supabase
    .from("project_invites")
    .insert(insertPayload)
    .select("*")
    .single();

  if (isActiveInviteEmailConflict(error)) {
    throw new ProjectInviteAlreadyOutstandingError(basePayload.email);
  }

  if (error || !data) {
    throw error ?? new Error("Unable to create project invite");
  }

  return data;
}

export async function updateWorkspaceProjectInvite(
  mode: WorkspaceMode | RuntimeWorkspaceMode,
  input: {
    id: string;
    projectId: string;
    role?: WorkspaceProjectInvite["role"];
    aiAccess?: WorkspaceProjectInvite["ai_access"];
    viewerRegime?: WorkspaceProjectInvite["viewer_regime"];
    creditLimit?: number;
    financeVisibility?: FinanceVisibility;
    internalDocsVisibility?: InternalDocsVisibility;
    status?: WorkspaceProjectInvite["status"];
  },
): Promise<WorkspaceProjectInvite> {
  if (mode.kind === "guest") {
    throw new Error("An authenticated Supabase session is required.");
  }

  if (isBrowserWorkspaceMode(mode)) {
    const updated = store.updateProjectInvite(input.id, {
      role: input.role,
      ai_access: input.aiAccess,
      viewer_regime: input.viewerRegime,
      credit_limit: input.creditLimit,
      finance_visibility: input.financeVisibility,
      ...(input.internalDocsVisibility !== undefined
        ? { internal_docs_visibility: input.internalDocsVisibility }
        : {}),
      // status is spread only when explicitly provided — an axis/role edit must
      // never resurrect a concurrently revoked/accepted invite back to its
      // stale status. Status changes go through revokeWorkspaceProjectInvite /
      // accept_project_invite only.
      //
      // In supabase mode this is now belt AND braces: rovno-db 20260729130100
      // added guard_project_invite_status_transition, so a write back to
      // 'pending' is rejected by the database. This branch is the BROWSER store,
      // which has no such trigger, so the discipline still has to be kept here.
      ...(input.status !== undefined ? { status: input.status } : {}),
    }, mode.kind);
    if (!updated) {
      throw new Error("Project invite not found");
    }
    return updated;
  }

  const supabase = await loadSupabaseClient();
  const patch: Record<string, unknown> = {
    role: input.role,
    ai_access: input.aiAccess,
    viewer_regime: input.viewerRegime ?? null,
    credit_limit: input.creditLimit,
    finance_visibility: input.financeVisibility,
    internal_docs_visibility: input.internalDocsVisibility,
  };
  if (input.status !== undefined) {
    patch.status = input.status;
  }
  const { data, error } = await supabase
    .from("project_invites")
    .update(patch)
    .eq("id", input.id)
    .eq("project_id", input.projectId)
    .select("*")
    .single();

  if (error || !data) {
    throw error ?? new Error("Unable to update project invite");
  }

  return data;
}
