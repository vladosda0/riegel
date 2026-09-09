import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import {
  getWorkspaceSource,
  hasSupabaseWorkspaceConfig,
  isSupabaseWorkspaceRequested,
  type ProfileContactInfo,
  type ProfileContactInfoPatch,
  type ProfileIdentityPatch,
  type NotificationPreferences,
  type NotificationPreferencesPatch,
  type ProfilePreferences,
  type ProfilePreferencesPatch,
  type WorkspaceMode,
  type WorkspaceProjectInvite,
} from "@/data/workspace-source";
import type { Member, Project, User } from "@/types/entities";
import * as store from "@/data/store";
import { isDemoSessionActive, subscribeAuthState } from "@/lib/auth-state";
import { useRuntimeAuth } from "@/hooks/use-runtime-auth";

const WORKSPACE_QUERY_STALE_TIME_MS = 60_000;

type PendingWorkspaceMode = { kind: "pending-supabase" };
type GuestWorkspaceMode = { kind: "guest" };
export type WorkspaceModeState = WorkspaceMode | PendingWorkspaceMode | GuestWorkspaceMode;

export const EMPTY_WORKSPACE_USER: User = {
  id: "",
  email: "",
  name: "",
  locale: "en",
  timezone: "UTC",
  plan: "free",
  credits_free: 0,
  credits_paid: 0,
};

export const workspaceQueryKeys = {
  mode: () => ["workspace", "mode"] as const,
  currentUser: (profileId: string) => ["workspace", "current-user", profileId] as const,
  profilePreferences: (profileId: string) => ["workspace", "profile-preferences", profileId] as const,
  notificationPreferences: (profileId: string) => ["workspace", "notification-preferences", profileId] as const,
  profileContactInfo: (profileId: string) => ["workspace", "profile-contact-info", profileId] as const,
  projects: (profileId: string) => ["workspace", "projects", profileId] as const,
  project: (profileId: string, projectId: string) => ["workspace", "project", profileId, projectId] as const,
  projectMembers: (profileId: string, projectId: string) => ["workspace", "project-members", profileId, projectId] as const,
  projectInvites: (profileId: string, projectId: string) => ["workspace", "project-invites", profileId, projectId] as const,
};

function getDemoSessionSnapshot(): string {
  return isDemoSessionActive() ? "demo" : "standard";
}

function useWorkspaceModeState(): WorkspaceModeState {
  useSyncExternalStore(subscribeAuthState, getDemoSessionSnapshot);
  const runtimeAuth = useRuntimeAuth();
  const demoSessionActive = isDemoSessionActive();

  const supabaseRequested = isSupabaseWorkspaceRequested();
  const supabaseConfig = hasSupabaseWorkspaceConfig();

  let mode: WorkspaceModeState;
  if (demoSessionActive) {
    mode = { kind: "demo" };
  } else if (!supabaseRequested) {
    mode = { kind: "local" };
  } else if (!supabaseConfig) {
    mode = { kind: "guest" };
  } else if (runtimeAuth.status === "loading") {
    mode = { kind: "pending-supabase" };
  } else if (runtimeAuth.status !== "authenticated" || !runtimeAuth.profileId) {
    mode = { kind: "guest" };
  } else {
    mode = { kind: "supabase", profileId: runtimeAuth.profileId };
  }

  return mode;
}

export function useWorkspaceMode(): WorkspaceModeState {
  return useWorkspaceModeState();
}

export function useWorkspaceCurrentUserState(): {
  user: User;
  isLoading: boolean;
} {
  const mode = useWorkspaceModeState();
  const supabaseMode = mode.kind === "supabase" ? mode : null;
  const userQuery = useQuery({
    queryKey: supabaseMode
      ? workspaceQueryKeys.currentUser(supabaseMode.profileId)
      : workspaceQueryKeys.currentUser("demo"),
    queryFn: async () => {
      const source = await getWorkspaceSource(supabaseMode ?? undefined);
      return source.getCurrentUser();
    },
    enabled: Boolean(supabaseMode),
    staleTime: WORKSPACE_QUERY_STALE_TIME_MS,
  });

  let user: User;
  let isLoading: boolean;
  if (mode.kind === "demo" || mode.kind === "local") {
    user = store.getCurrentUser();
    isLoading = false;
  } else if (mode.kind === "pending-supabase") {
    user = EMPTY_WORKSPACE_USER;
    isLoading = true;
  } else {
    user = userQuery.data ?? EMPTY_WORKSPACE_USER;
    isLoading = userQuery.isPending;
  }

  return { user, isLoading };
}

export function useWorkspaceCurrentUser(): User {
  return useWorkspaceCurrentUserState().user;
}

export function useWorkspaceProfilePreferencesState(): {
  preferences: ProfilePreferences | undefined;
  isLoading: boolean;
} {
  const mode = useWorkspaceModeState();
  const supabaseMode = mode.kind === "supabase" ? mode : null;
  const queryProfileId = supabaseMode?.profileId ?? mode.kind;
  const preferencesQuery = useQuery({
    queryKey: workspaceQueryKeys.profilePreferences(queryProfileId),
    queryFn: async () => {
      const source = await getWorkspaceSource(
        mode.kind === "local" || mode.kind === "demo" || mode.kind === "supabase" ? mode : undefined,
      );
      return source.getProfilePreferences();
    },
    enabled: mode.kind === "local" || mode.kind === "demo" || mode.kind === "supabase",
    staleTime: WORKSPACE_QUERY_STALE_TIME_MS,
  });

  if (mode.kind === "pending-supabase") {
    return { preferences: undefined, isLoading: true };
  }

  return {
    preferences: preferencesQuery.data,
    isLoading: preferencesQuery.isPending,
  };
}

export function useWorkspaceProfilePreferences(): ProfilePreferences | undefined {
  return useWorkspaceProfilePreferencesState().preferences;
}

export function useUpdateWorkspaceProfilePreferences() {
  const mode = useWorkspaceModeState();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (patch: ProfilePreferencesPatch) => {
      if (mode.kind !== "local" && mode.kind !== "demo" && mode.kind !== "supabase") {
        throw new Error("Profile preferences are not available yet.");
      }
      const source = await getWorkspaceSource(mode);
      return source.updateProfilePreferences(patch);
    },
    onSuccess: (preferences) => {
      const profileId = mode.kind === "supabase" ? mode.profileId : mode.kind;
      queryClient.setQueryData(workspaceQueryKeys.profilePreferences(profileId), preferences);
      void queryClient.invalidateQueries({ queryKey: workspaceQueryKeys.profilePreferences(profileId) });
    },
  });
}

export function useWorkspaceNotificationPreferencesState(): {
  preferences: NotificationPreferences | undefined;
  isLoading: boolean;
} {
  const mode = useWorkspaceModeState();
  const supabaseMode = mode.kind === "supabase" ? mode : null;
  const queryProfileId = supabaseMode?.profileId ?? mode.kind;
  const preferencesQuery = useQuery({
    queryKey: workspaceQueryKeys.notificationPreferences(queryProfileId),
    queryFn: async () => {
      const source = await getWorkspaceSource(
        mode.kind === "local" || mode.kind === "demo" || mode.kind === "supabase" ? mode : undefined,
      );
      return source.getNotificationPreferences();
    },
    enabled: mode.kind === "local" || mode.kind === "demo" || mode.kind === "supabase",
    staleTime: WORKSPACE_QUERY_STALE_TIME_MS,
  });

  if (mode.kind === "pending-supabase") {
    return { preferences: undefined, isLoading: true };
  }

  return {
    preferences: preferencesQuery.data,
    isLoading: preferencesQuery.isPending,
  };
}

export function useUpdateWorkspaceNotificationPreferences() {
  const mode = useWorkspaceModeState();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (patch: NotificationPreferencesPatch) => {
      if (mode.kind !== "local" && mode.kind !== "demo" && mode.kind !== "supabase") {
        throw new Error("Notification preferences are not available yet.");
      }
      const source = await getWorkspaceSource(mode);
      return source.updateNotificationPreferences(patch);
    },
    onSuccess: (preferences) => {
      const profileId = mode.kind === "supabase" ? mode.profileId : mode.kind;
      queryClient.setQueryData(workspaceQueryKeys.notificationPreferences(profileId), preferences);
      void queryClient.invalidateQueries({ queryKey: workspaceQueryKeys.notificationPreferences(profileId) });
    },
  });
}

export function useWorkspaceProfileContactInfoState(): {
  contactInfo: ProfileContactInfo | undefined;
  isLoading: boolean;
} {
  const mode = useWorkspaceModeState();
  const supabaseMode = mode.kind === "supabase" ? mode : null;
  const queryProfileId = supabaseMode?.profileId ?? mode.kind;
  const query = useQuery({
    queryKey: workspaceQueryKeys.profileContactInfo(queryProfileId),
    queryFn: async () => {
      const source = await getWorkspaceSource(
        mode.kind === "local" || mode.kind === "demo" || mode.kind === "supabase" ? mode : undefined,
      );
      return source.getProfileContactInfo();
    },
    enabled: mode.kind === "local" || mode.kind === "demo" || mode.kind === "supabase",
    staleTime: WORKSPACE_QUERY_STALE_TIME_MS,
  });

  if (mode.kind === "pending-supabase") {
    return { contactInfo: undefined, isLoading: true };
  }

  return { contactInfo: query.data, isLoading: query.isPending };
}

export function useUpdateWorkspaceProfileIdentity() {
  const mode = useWorkspaceModeState();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (patch: ProfileIdentityPatch) => {
      if (mode.kind !== "local" && mode.kind !== "demo" && mode.kind !== "supabase") {
        throw new Error("Profile is not available yet.");
      }
      const source = await getWorkspaceSource(mode);
      return source.updateProfileIdentity(patch);
    },
    onSuccess: (user) => {
      const profileId = mode.kind === "supabase" ? mode.profileId : mode.kind;
      // Refresh the app-wide current user (header avatar / name) after a save.
      queryClient.setQueryData(workspaceQueryKeys.currentUser(profileId), user);
      void queryClient.invalidateQueries({ queryKey: workspaceQueryKeys.currentUser(profileId) });
    },
  });
}

export function useUpdateWorkspaceProfileContactInfo() {
  const mode = useWorkspaceModeState();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (patch: ProfileContactInfoPatch) => {
      if (mode.kind !== "local" && mode.kind !== "demo" && mode.kind !== "supabase") {
        throw new Error("Profile is not available yet.");
      }
      const source = await getWorkspaceSource(mode);
      return source.updateProfileContactInfo(patch);
    },
    onSuccess: (contactInfo) => {
      const profileId = mode.kind === "supabase" ? mode.profileId : mode.kind;
      queryClient.setQueryData(workspaceQueryKeys.profileContactInfo(profileId), contactInfo);
      void queryClient.invalidateQueries({ queryKey: workspaceQueryKeys.profileContactInfo(profileId) });
    },
  });
}

export function useWorkspaceProjectsState(): { projects: Project[]; isLoading: boolean } {
  const mode = useWorkspaceModeState();
  const supabaseMode = mode.kind === "supabase" ? mode : null;
  const projectsQuery = useQuery({
    queryKey: supabaseMode
      ? workspaceQueryKeys.projects(supabaseMode.profileId)
      : workspaceQueryKeys.projects("demo"),
    queryFn: async () => {
      const source = await getWorkspaceSource(supabaseMode ?? undefined);
      return source.getProjects();
    },
    enabled: Boolean(supabaseMode),
    staleTime: WORKSPACE_QUERY_STALE_TIME_MS,
  });

  if (mode.kind === "demo" || mode.kind === "local") {
    return { projects: store.getProjects(), isLoading: false };
  }

  return {
    projects: projectsQuery.data ?? [],
    isLoading: Boolean(supabaseMode) && projectsQuery.isPending,
  };
}

export function useWorkspaceProjects(): Project[] {
  return useWorkspaceProjectsState().projects;
}

export function useWorkspaceProjectState(projectId: string): {
  project: Project | undefined;
  isLoading: boolean;
} {
  const mode = useWorkspaceModeState();
  const supabaseMode = mode.kind === "supabase" ? mode : null;
  const projectQuery = useQuery({
    queryKey: supabaseMode
      ? workspaceQueryKeys.project(supabaseMode.profileId, projectId)
      : workspaceQueryKeys.project("demo", projectId),
    queryFn: async () => {
      const source = await getWorkspaceSource(supabaseMode ?? undefined);
      return source.getProjectById(projectId);
    },
    enabled: Boolean(supabaseMode && projectId),
    staleTime: WORKSPACE_QUERY_STALE_TIME_MS,
  });

  if (mode.kind === "demo" || mode.kind === "local") {
    return {
      project: store.getProject(projectId),
      isLoading: false,
    };
  }

  if (mode.kind === "pending-supabase") {
    return {
      project: undefined,
      isLoading: true,
    };
  }

  return {
    project: projectQuery.data,
    // A disabled query stays "pending" with nothing in flight, so without this it
    // reports loading forever. Guarded the way the sibling projects hook already is.
    isLoading: Boolean(supabaseMode && projectId) && projectQuery.isPending,
  };
}

export function useWorkspaceProject(projectId: string): Project | undefined {
  return useWorkspaceProjectState(projectId).project;
}

export function useWorkspaceProjectMembersState(projectId: string): {
  members: Member[];
  isLoading: boolean;
} {
  const mode = useWorkspaceModeState();
  const supabaseMode = mode.kind === "supabase" ? mode : null;
  const membersQuery = useQuery({
    queryKey: supabaseMode
      ? workspaceQueryKeys.projectMembers(supabaseMode.profileId, projectId)
      : workspaceQueryKeys.projectMembers("demo", projectId),
    queryFn: async () => {
      const source = await getWorkspaceSource(supabaseMode ?? undefined);
      return source.getProjectMembers(projectId);
    },
    enabled: Boolean(supabaseMode && projectId),
    staleTime: WORKSPACE_QUERY_STALE_TIME_MS,
    // P2: focus refetch is the catch-up path the realtime members self-echo
    // skip relies on (a same-user second tab drops its own 'members' event, so
    // it must refresh on return). usePermission derives its authority seam from
    // this query, so the same staleness would otherwise reach role-gated UI.
    refetchOnWindowFocus: true,
  });

  if (mode.kind === "demo" || mode.kind === "local") {
    return {
      members: store.getMembers(projectId),
      isLoading: false,
    };
  }

  if (mode.kind === "pending-supabase") {
    return {
      members: [],
      isLoading: true,
    };
  }

  return {
    members: membersQuery.data ?? [],
    isLoading: membersQuery.isPending,
  };
}

export function useWorkspaceProjectMembers(projectId: string): Member[] {
  return useWorkspaceProjectMembersState(projectId).members;
}

export function useWorkspaceProjectInvites(projectId: string): WorkspaceProjectInvite[] {
  const mode = useWorkspaceModeState();
  const supabaseMode = mode.kind === "supabase" ? mode : null;
  const invitesQuery = useQuery({
    queryKey: supabaseMode
      ? workspaceQueryKeys.projectInvites(supabaseMode.profileId, projectId)
      : workspaceQueryKeys.projectInvites("demo", projectId),
    queryFn: async () => {
      const source = await getWorkspaceSource(supabaseMode ?? undefined);
      return source.getProjectInvites(projectId);
    },
    enabled: Boolean(supabaseMode && projectId),
    staleTime: WORKSPACE_QUERY_STALE_TIME_MS,
  });

  if (mode.kind === "demo" || mode.kind === "local") {
    return store.getProjectInvites(projectId);
  }

  if (!supabaseMode) {
    return [];
  }

  return invitesQuery.data ?? [];
}
