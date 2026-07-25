import { act, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as activitySource from "@/data/activity-source";
import * as store from "@/data/store";
import {
  useActivityNotificationsBridge,
  useNotificationEventMap,
  useProjectEvents,
  useProjectsRecentEventsMap,
} from "@/hooks/use-activity-source";
import { authenticateRuntimeAuth } from "@/test/runtime-auth";
import type { Event, Notification } from "@/types/entities";

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
}

function event(partial: Partial<Event> = {}): Event {
  return {
    id: "evt-1",
    project_id: "project-1",
    actor_id: "profile-1",
    type: "task_created",
    object_type: "task",
    object_id: "task-1",
    timestamp: "2026-03-01T09:00:00.000Z",
    payload: { title: "Task One" },
    ...partial,
  };
}

function notification(partial: Partial<Notification> = {}): Notification {
  return {
    id: "notif-1",
    user_id: "profile-1",
    project_id: "project-1",
    event_id: "evt-1",
    is_read: false,
    ...partial,
  };
}

function bridge(
  partial: Partial<activitySource.ActivityNotificationBridge> = {},
): activitySource.ActivityNotificationBridge {
  return {
    notificationId: "notif-1",
    compatibilityEventId: "evt-1",
    projectId: "project-1",
    createdAt: "2026-03-01T10:00:00.000Z",
    directEventId: "evt-1",
    objectType: undefined,
    objectId: undefined,
    actionType: undefined,
    ...partial,
  };
}

function ActivityReadProbe({ projectId }: { projectId: string }) {
  const events = useProjectEvents(projectId);
  const { notifications, unreadCount } = useActivityNotificationsBridge();

  return (
    <div>
      <span data-testid="event-count">{events.length}</span>
      <span data-testid="event-ids">{events.map((item) => item.id).join("|")}</span>
      <span data-testid="notification-count">{notifications.length}</span>
      <span data-testid="notification-ids">{notifications.map((item) => item.id).join("|")}</span>
      <span data-testid="unread-count">{unreadCount}</span>
    </div>
  );
}

function NotificationResolutionProbe() {
  const { bridges } = useActivityNotificationsBridge();
  const eventMap = useNotificationEventMap(bridges);
  const resolved = Object.entries(eventMap)
    .map(([notificationId, resolvedEvent]) => `${notificationId}:${resolvedEvent.id}`)
    .sort()
    .join("|");

  return <span data-testid="resolved-links">{resolved}</span>;
}

function NotificationEventMapProbe({
  bridges,
}: {
  bridges: activitySource.ActivityNotificationBridge[];
}) {
  const eventMap = useNotificationEventMap(bridges);
  const resolved = Object.entries(eventMap)
    .map(([notificationId, resolvedEvent]) => `${notificationId}:${resolvedEvent.id}`)
    .sort()
    .join("|");

  return <span data-testid="resolved-links">{resolved}</span>;
}

function RecentEventsProbe({
  projectIds,
  perProjectLimit,
}: {
  projectIds: string[];
  perProjectLimit: number;
}) {
  const eventsByProject = useProjectsRecentEventsMap(projectIds, perProjectLimit);

  return (
    <div>
      {projectIds.map((projectId) => (
        <span key={projectId} data-testid={`recent-${projectId}`}>
          {(eventsByProject[projectId] ?? []).map((item) => item.id).join("|")}
        </span>
      ))}
    </div>
  );
}

describe("use-activity-source hooks", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("returns store-backed events and notifications in browser modes and reacts to subscriptions", async () => {
    const queryClient = createQueryClient();
    let currentEvents = [event({ id: "evt-1" })];
    let currentNotifications = [notification({ id: "notif-1", is_read: false })];
    const listeners = new Set<() => void>();

    vi.spyOn(store, "getCurrentUserForMode").mockReturnValue({
      id: "profile-1",
      email: "owner@example.com",
      name: "Owner",
      locale: "en",
      timezone: "UTC",
      plan: "pro",
      credits_free: 10,
      credits_paid: 20,
    });
    const getEventsSpy = vi.spyOn(store, "getEvents").mockImplementation(() => currentEvents);
    const getNotificationsSpy = vi.spyOn(store, "getNotifications").mockImplementation(() => currentNotifications);
    vi.spyOn(store, "subscribe").mockImplementation((callback) => {
      listeners.add(callback);
      return () => {
        listeners.delete(callback);
      };
    });

    render(
      <QueryClientProvider client={queryClient}>
        <ActivityReadProbe projectId="project-1" />
      </QueryClientProvider>,
    );

    expect(screen.getByTestId("event-count")).toHaveTextContent("1");
    expect(screen.getByTestId("notification-count")).toHaveTextContent("1");
    expect(screen.getByTestId("unread-count")).toHaveTextContent("1");

    act(() => {
      currentEvents = [event({ id: "evt-2" })];
      currentNotifications = [notification({ id: "notif-2", is_read: true })];
      listeners.forEach((listener) => listener());
    });

    await waitFor(() => {
      expect(screen.getByTestId("event-ids")).toHaveTextContent("evt-2");
    });
    expect(screen.getByTestId("notification-ids")).toHaveTextContent("notif-2");
    expect(screen.getByTestId("unread-count")).toHaveTextContent("0");
    expect(getEventsSpy).toHaveBeenCalledWith("project-1");
    expect(getNotificationsSpy).toHaveBeenCalledWith("profile-1");
  });

  it("keeps recent project events stable across equivalent browser-mode rerenders", async () => {
    const queryClient = createQueryClient();
    const subscribeSpy = vi.spyOn(store, "subscribe").mockImplementation(() => () => {});
    const getEventsSpy = vi.spyOn(store, "getEvents").mockImplementation((projectId: string) => [
      event({ id: `evt-${projectId}`, project_id: projectId }),
      event({
        id: `evt-${projectId}-older`,
        project_id: projectId,
        timestamp: "2026-02-28T09:00:00.000Z",
      }),
    ]);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <RecentEventsProbe projectIds={["project-1", "project-2"]} perProjectLimit={1} />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("recent-project-1")).toHaveTextContent("evt-project-1");
    });

    expect(screen.getByTestId("recent-project-2")).toHaveTextContent("evt-project-2");
    expect(getEventsSpy).toHaveBeenCalledTimes(4);
    expect(subscribeSpy).toHaveBeenCalledTimes(1);

    await act(async () => {
      rerender(
        <QueryClientProvider client={queryClient}>
          <RecentEventsProbe projectIds={["project-1", "project-2"]} perProjectLimit={1} />
        </QueryClientProvider>,
      );
      await Promise.resolve();
    });

    expect(getEventsSpy).toHaveBeenCalledTimes(4);
    expect(subscribeSpy).toHaveBeenCalledTimes(1);
    expect(
      errorSpy.mock.calls.map((args) => args.map(String).join(" ")).join(" "),
    ).not.toContain("Maximum update depth exceeded");
  });

  it("returns empty activity state while Supabase queries are loading, then the mapped results", async () => {
    vi.stubEnv("VITE_WORKSPACE_SOURCE", "supabase");

    const queryClient = createQueryClient();
    let resolveEvents: (value: Event[]) => void;
    let resolveNotifications: (value: activitySource.ActivityNotificationsResult) => void;
    const eventsPromise = new Promise<Event[]>((resolve) => {
      resolveEvents = resolve;
    });
    const notificationsPromise = new Promise<activitySource.ActivityNotificationsResult>((resolve) => {
      resolveNotifications = resolve;
    });
    const source = {
      mode: "supabase" as const,
      getProjectEvents: vi.fn(() => eventsPromise),
      getCurrentUserNotifications: vi.fn(() => notificationsPromise),
      getCurrentUserUnreadNotificationCount: vi.fn(() => Promise.resolve(0)),
    };

    authenticateRuntimeAuth();
    vi.spyOn(activitySource, "getActivitySource").mockResolvedValue(source);
    const getEventsSpy = vi.spyOn(store, "getEvents");
    const getNotificationsSpy = vi.spyOn(store, "getNotifications");

    render(
      <QueryClientProvider client={queryClient}>
        <ActivityReadProbe projectId="project-1" />
      </QueryClientProvider>,
    );

    expect(screen.getByTestId("event-count")).toHaveTextContent("0");
    expect(screen.getByTestId("notification-count")).toHaveTextContent("0");
    expect(screen.getByTestId("unread-count")).toHaveTextContent("0");
    expect(getEventsSpy).not.toHaveBeenCalled();
    expect(getNotificationsSpy).not.toHaveBeenCalled();

    await act(async () => {
      resolveEvents!([event({ id: "evt-supabase" })]);
      resolveNotifications!({
        notifications: [notification({ id: "notif-supabase", event_id: "evt-supabase" })],
        bridges: [bridge({
          notificationId: "notif-supabase",
          compatibilityEventId: "evt-supabase",
          directEventId: "evt-supabase",
        })],
      });
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByTestId("event-count")).toHaveTextContent("1");
    });
    expect(screen.getByTestId("event-ids")).toHaveTextContent("evt-supabase");
    expect(screen.getByTestId("notification-count")).toHaveTextContent("1");
    expect(screen.getByTestId("notification-ids")).toHaveTextContent("notif-supabase");
    expect(screen.getByTestId("unread-count")).toHaveTextContent("1");
  });

  it("resolves notification events by direct id first, then by object/action compatibility", async () => {
    vi.stubEnv("VITE_WORKSPACE_SOURCE", "supabase");

    const queryClient = createQueryClient();
    const source = {
      mode: "supabase" as const,
      getProjectEvents: vi.fn(async () => [
        event({
          id: "evt-late",
          type: "task_updated",
          object_id: "task-1",
          timestamp: "2026-03-03T12:00:00.000Z",
        }),
        event({
          id: "evt-fallback",
          type: "task_updated",
          object_id: "task-1",
          timestamp: "2026-03-03T09:00:00.000Z",
        }),
        event({
          id: "evt-direct",
          type: "task_created",
          object_id: "task-9",
          timestamp: "2026-03-02T09:00:00.000Z",
        }),
      ]),
      getCurrentUserNotifications: vi.fn(async () => ({
        notifications: [
          notification({ id: "notif-direct", event_id: "evt-direct" }),
          notification({ id: "notif-fallback", event_id: "compat:notif-fallback" }),
          notification({ id: "notif-unresolved", event_id: "compat:notif-unresolved" }),
        ],
        bridges: [
          bridge({
            notificationId: "notif-direct",
            compatibilityEventId: "evt-direct",
            directEventId: "evt-direct",
          }),
          bridge({
            notificationId: "notif-fallback",
            compatibilityEventId: "compat:notif-fallback",
            directEventId: undefined,
            objectType: "task",
            objectId: "task-1",
            actionType: "task_updated",
            createdAt: "2026-03-03T10:00:00.000Z",
          }),
          bridge({
            notificationId: "notif-unresolved",
            compatibilityEventId: "compat:notif-unresolved",
            directEventId: undefined,
            objectType: "task",
            objectId: "missing-task",
            actionType: "task_updated",
            createdAt: "2026-03-03T10:00:00.000Z",
          }),
        ],
      })),
      getCurrentUserUnreadNotificationCount: vi.fn(async () => 3),
    };

    authenticateRuntimeAuth();
    vi.spyOn(activitySource, "getActivitySource").mockResolvedValue(source);

    render(
      <QueryClientProvider client={queryClient}>
        <NotificationResolutionProbe />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("resolved-links")).toHaveTextContent(
        "notif-direct:evt-direct|notif-fallback:evt-fallback",
      );
    });
  });

  it("keeps notification event subscriptions stable across equivalent browser-mode rerenders", async () => {
    const queryClient = createQueryClient();
    const subscribeSpy = vi.spyOn(store, "subscribe").mockImplementation(() => () => {});
    const getEventsSpy = vi.spyOn(store, "getEvents").mockImplementation((projectId: string) => [
      event({ id: `evt-${projectId}`, project_id: projectId }),
    ]);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const bridges = [
      bridge({
        notificationId: "notif-1",
        projectId: "project-1",
        compatibilityEventId: "evt-project-1",
        directEventId: "evt-project-1",
      }),
      bridge({
        notificationId: "notif-2",
        projectId: "project-2",
        compatibilityEventId: "evt-project-2",
        directEventId: "evt-project-2",
      }),
    ];

    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <NotificationEventMapProbe bridges={bridges.map((entry) => ({ ...entry }))} />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("resolved-links")).toHaveTextContent(
        "notif-1:evt-project-1|notif-2:evt-project-2",
      );
    });

    expect(getEventsSpy).toHaveBeenCalledTimes(4);
    expect(subscribeSpy).toHaveBeenCalledTimes(1);

    await act(async () => {
      rerender(
        <QueryClientProvider client={queryClient}>
          <NotificationEventMapProbe bridges={bridges.map((entry) => ({ ...entry }))} />
        </QueryClientProvider>,
      );
      await Promise.resolve();
    });

    expect(getEventsSpy).toHaveBeenCalledTimes(4);
    expect(subscribeSpy).toHaveBeenCalledTimes(1);
    expect(
      errorSpy.mock.calls.map((args) => args.map(String).join(" ")).join(" "),
    ).not.toContain("Maximum update depth exceeded");
  });

  it("returns a recent-events map capped per project", async () => {
    vi.stubEnv("VITE_WORKSPACE_SOURCE", "supabase");

    const queryClient = createQueryClient();
    const source = {
      mode: "supabase" as const,
      getProjectEvents: vi.fn(async (projectId: string) => {
        if (projectId === "project-1") {
          return [
            event({ id: "evt-1a", project_id: "project-1" }),
            event({ id: "evt-1b", project_id: "project-1" }),
            event({ id: "evt-1c", project_id: "project-1" }),
          ];
        }

        return [
          event({ id: "evt-2a", project_id: "project-2" }),
          event({ id: "evt-2b", project_id: "project-2" }),
          event({ id: "evt-2c", project_id: "project-2" }),
        ];
      }),
      getCurrentUserNotifications: vi.fn(async () => ({
        notifications: [],
        bridges: [],
      })),
      getCurrentUserUnreadNotificationCount: vi.fn(async () => 0),
    };

    authenticateRuntimeAuth();
    vi.spyOn(activitySource, "getActivitySource").mockResolvedValue(source);

    render(
      <QueryClientProvider client={queryClient}>
        <RecentEventsProbe projectIds={["project-1", "project-2"]} perProjectLimit={2} />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("recent-project-1")).toHaveTextContent("evt-1a|evt-1b");
    });
    expect(screen.getByTestId("recent-project-2")).toHaveTextContent("evt-2a|evt-2b");
    expect(source.getProjectEvents).toHaveBeenCalledWith("project-1", 2);
    expect(source.getProjectEvents).toHaveBeenCalledWith("project-2", 2);
  });
});
