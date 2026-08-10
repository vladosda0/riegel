import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import * as store from "@/data/store";
import {
  buildNotificationEventMap,
  countUnreadNotifications,
  getActivitySource,
  mapBrowserNotificationToActivityNotification,
  type ActivityNotificationBridge,
  type ActivityNotificationsResult,
} from "@/data/activity-source";
import { useWorkspaceMode } from "@/hooks/use-workspace-source";
import type { Event } from "@/types/entities";

const ACTIVITY_QUERY_STALE_TIME_MS = 60_000;
const EMPTY_PROJECT_EVENTS: Event[] = [];
const EMPTY_EVENTS_BY_PROJECT: Record<string, Event[]> = {};
const EMPTY_ACTIVITY_NOTIFICATIONS_RESULT: ActivityNotificationsResult = {
  notifications: [],
  bridges: [],
};

export const activityQueryKeys = {
  projectEvents: (profileId: string, projectId: string) =>
    ["activity", "project-events", profileId, projectId] as const,
  currentUserNotifications: (profileId: string) =>
    ["activity", "current-user-notifications", profileId] as const,
  notificationProjectEvents: (profileId: string, projectIds: string[]) =>
    ["activity", "notification-project-events", profileId, projectIds] as const,
  projectsRecentEvents: (profileId: string, projectIds: string[], perProjectLimit: number) =>
    ["activity", "projects-recent-events", profileId, projectIds, perProjectLimit] as const,
};

function useStoreValue<T>(getter: () => T, enabled: boolean, fallback: T): T {
  const [value, setValue] = useState<T>(() => enabled ? getter() : fallback);

  useEffect(() => {
    if (!enabled) {
      setValue(fallback);
      return;
    }

    setValue(getter());
    const update = () => setValue(getter());
    return store.subscribe(update);
  }, [enabled, fallback, getter]);

  return enabled ? value : fallback;
}

function createBrowserNotificationsResult(mode: "demo" | "local"): ActivityNotificationsResult {
  const user = store.getCurrentUserForMode(mode);
  const mapped = store.getNotifications(user.id).map(mapBrowserNotificationToActivityNotification);

  return {
    notifications: mapped.map((entry) => entry.notification),
    bridges: mapped.map((entry) => entry.bridge),
  };
}

function createProjectEventsMap(
  projectIds: string[],
  perProjectLimit?: number,
): Record<string, Event[]> {
  return Object.fromEntries(
    projectIds.map((projectId) => {
      const events = store.getEvents(projectId);
      // This, not the browser ActivitySource, is what actually caps demo/local.
      // Use the same positive-integer predicate as the supabase path, or the two
      // modes disagree: 2.5 would render 2 rows here and none in supabase mode.
      const bounded = typeof perProjectLimit === "number"
        && Number.isInteger(perProjectLimit)
        && perProjectLimit > 0;
      return [projectId, bounded ? events.slice(0, perProjectLimit) : events];
    }),
  );
}

function areStringArraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function useStableStringArray(values: string[]): string[] {
  const valueRef = useRef(values);

  // Keep array identity stable when only the reference changes.
  if (!areStringArraysEqual(valueRef.current, values)) {
    valueRef.current = values;
  }

  return valueRef.current;
}

export function useProjectEvents(projectId: string): Event[] {
  const mode = useWorkspaceMode();
  const supabaseMode = mode.kind === "supabase" ? mode : null;
  const getEvents = useCallback(() => store.getEvents(projectId), [projectId]);
  const browserEvents = useStoreValue(
    getEvents,
    mode.kind === "demo" || mode.kind === "local",
    EMPTY_PROJECT_EVENTS,
  );
  const eventsQuery = useQuery({
    queryKey: supabaseMode
      ? activityQueryKeys.projectEvents(supabaseMode.profileId, projectId)
      : activityQueryKeys.projectEvents("browser", projectId),
    queryFn: async () => {
      const source = await getActivitySource(supabaseMode ?? undefined);
      return source.getProjectEvents(projectId);
    },
    enabled: Boolean(supabaseMode && projectId),
    staleTime: ACTIVITY_QUERY_STALE_TIME_MS,
  });

  if (mode.kind === "demo" || mode.kind === "local") {
    return browserEvents;
  }

  return eventsQuery.data ?? EMPTY_PROJECT_EVENTS;
}

export function useActivityNotificationsBridge(): {
  notifications: ActivityNotificationsResult["notifications"];
  unreadCount: number;
  bridges: ActivityNotificationsResult["bridges"];
} {
  const mode = useWorkspaceMode();
  const supabaseMode = mode.kind === "supabase" ? mode : null;
  const getNotifications = useCallback(
    () => createBrowserNotificationsResult(mode.kind === "demo" ? "demo" : "local"),
    [mode.kind],
  );
  const browserNotifications = useStoreValue(
    getNotifications,
    mode.kind === "demo" || mode.kind === "local",
    EMPTY_ACTIVITY_NOTIFICATIONS_RESULT,
  );
  const notificationsQuery = useQuery({
    queryKey: supabaseMode
      ? activityQueryKeys.currentUserNotifications(supabaseMode.profileId)
      : activityQueryKeys.currentUserNotifications("browser"),
    queryFn: async () => {
      const source = await getActivitySource(supabaseMode ?? undefined);
      return source.getCurrentUserNotifications();
    },
    enabled: Boolean(supabaseMode),
    staleTime: ACTIVITY_QUERY_STALE_TIME_MS,
  });

  if (mode.kind === "demo" || mode.kind === "local") {
    return {
      notifications: browserNotifications.notifications,
      unreadCount: countUnreadNotifications(browserNotifications.notifications),
      bridges: browserNotifications.bridges,
    };
  }

  const notificationsResult = notificationsQuery.data ?? EMPTY_ACTIVITY_NOTIFICATIONS_RESULT;
  return {
    notifications: notificationsResult.notifications,
    unreadCount: countUnreadNotifications(notificationsResult.notifications),
    bridges: notificationsResult.bridges,
  };
}

export function useNotificationEventMap(
  bridges: ActivityNotificationBridge[],
): Record<string, Event> {
  const mode = useWorkspaceMode();
  const supabaseMode = mode.kind === "supabase" ? mode : null;
  const projectIds = useStableStringArray(Array.from(new Set(
    bridges.flatMap((bridge) => bridge.projectId ? [bridge.projectId] : []),
  )));
  const getProjectEvents = useCallback(
    () => createProjectEventsMap(projectIds),
    [projectIds],
  );
  const browserEventsByProject = useStoreValue(
    getProjectEvents,
    mode.kind === "demo" || mode.kind === "local",
    EMPTY_EVENTS_BY_PROJECT,
  );
  const projectEventsQuery = useQuery({
    queryKey: supabaseMode
      ? activityQueryKeys.notificationProjectEvents(supabaseMode.profileId, projectIds)
      : activityQueryKeys.notificationProjectEvents("browser", projectIds),
    queryFn: async () => {
      const source = await getActivitySource(supabaseMode ?? undefined);
      const entries = await Promise.all(projectIds.map(async (projectId) => (
        [projectId, await source.getProjectEvents(projectId)] as const
      )));
      return Object.fromEntries(entries);
    },
    enabled: Boolean(supabaseMode && projectIds.length > 0),
    staleTime: ACTIVITY_QUERY_STALE_TIME_MS,
  });

  const eventsByProject = mode.kind === "demo" || mode.kind === "local"
    ? browserEventsByProject
    : projectEventsQuery.data ?? EMPTY_EVENTS_BY_PROJECT;

  return buildNotificationEventMap({
    bridges,
    eventsByProjectId: eventsByProject,
  });
}

export function useProjectsRecentEventsMap(
  projectIds: string[],
  perProjectLimit: number,
): Record<string, Event[]> {
  const mode = useWorkspaceMode();
  const supabaseMode = mode.kind === "supabase" ? mode : null;
  const normalizedProjectIds = useStableStringArray(projectIds.filter(Boolean));
  const getRecentEvents = useCallback(
    () => createProjectEventsMap(normalizedProjectIds, perProjectLimit),
    [normalizedProjectIds, perProjectLimit],
  );
  const browserRecentEvents = useStoreValue(
    getRecentEvents,
    mode.kind === "demo" || mode.kind === "local",
    EMPTY_EVENTS_BY_PROJECT,
  );
  const recentEventsQuery = useQuery({
    queryKey: supabaseMode
      ? activityQueryKeys.projectsRecentEvents(supabaseMode.profileId, normalizedProjectIds, perProjectLimit)
      : activityQueryKeys.projectsRecentEvents("browser", normalizedProjectIds, perProjectLimit),
    queryFn: async () => {
      const source = await getActivitySource(supabaseMode ?? undefined);
      const entries = await Promise.all(normalizedProjectIds.map(async (projectId) => (
        [projectId, (await source.getProjectEvents(projectId, perProjectLimit)).slice(0, perProjectLimit)] as const
      )));
      return Object.fromEntries(entries);
    },
    // Integer, not merely > 0: the cap reaches the query string verbatim, so a
    // fractional or Infinite value would be rejected and blank the whole feed.
    enabled: Boolean(
      supabaseMode
      && normalizedProjectIds.length > 0
      && Number.isInteger(perProjectLimit)
      && perProjectLimit > 0,
    ),
    staleTime: ACTIVITY_QUERY_STALE_TIME_MS,
  });

  if (mode.kind === "demo" || mode.kind === "local") {
    return browserRecentEvents;
  }

  return recentEventsQuery.data ?? EMPTY_EVENTS_BY_PROJECT;
}
