import { describe, expect, it, vi } from "vitest";
import { getEventGroupTimestampMs } from "@/lib/event-activity-timestamp";
import {
  getActivitySource,
  mapActivityEventRowToEvent,
  mapNotificationRowToActivityNotification,
} from "@/data/activity-source";

type MockSupabaseClient = {
  from: (table: string) => unknown;
};

const supabaseRef = vi.hoisted(() => ({
  current: null as MockSupabaseClient | null,
}));

vi.mock("@/integrations/supabase/client", () => ({
  get supabase() {
    return supabaseRef.current;
  },
}));

function setMockSupabase(client: MockSupabaseClient | null) {
  supabaseRef.current = client;
}

function activityEventRow(
  overrides: Partial<Parameters<typeof mapActivityEventRowToEvent>[0]> = {},
) {
  return {
    id: "evt-1",
    project_id: "project-1",
    actor_profile_id: "profile-1",
    entity_type: "task",
    entity_id: "task-1",
    action_type: "task_created",
    payload: { title: "Install lights" },
    created_at: "2026-03-01T09:00:00.000Z",
    ...overrides,
  };
}

function notificationRow(
  overrides: Partial<Parameters<typeof mapNotificationRowToActivityNotification>[0]> = {},
) {
  return {
    id: "notif-1",
    profile_id: "profile-1",
    project_id: "project-1",
    type: "activity.task_created",
    title: "Task created",
    body: null,
    is_read: false,
    payload: {
      event_id: "evt-1",
      eventId: "evt-2",
      entity_type: "task",
      entity_id: "task-1",
      action_type: "task_created",
    },
    created_at: "2026-03-01T10:00:00.000Z",
    read_at: null,
    ...overrides,
  };
}

describe("activity-source helpers", () => {
  it("maps activity event rows to the frontend Event contract with safe defaults", () => {
    const event = mapActivityEventRowToEvent(activityEventRow({
      actor_profile_id: null,
      entity_id: null,
      payload: null,
    }));

    expect(event).toEqual({
      id: "evt-1",
      project_id: "project-1",
      actor_id: "",
      type: "task_created",
      object_type: "task",
      object_id: "",
      timestamp: "2026-03-01T09:00:00.000Z",
      payload: {},
    });
  });

  it("prefers payload semantic timestamps over created_at when mapping activity rows", () => {
    const event = mapActivityEventRowToEvent(activityEventRow({
      action_type: "estimate.status_changed",
      entity_type: "estimate_v2_project",
      created_at: "2026-04-20T12:00:00.000Z",
      payload: {
        activityAt: "2026-04-07T15:42:00.000Z",
      },
    }));

    expect(event.timestamp).toBe("2026-04-07T15:42:00.000Z");
    expect(getEventGroupTimestampMs(event)).toBe(Date.parse("2026-04-07T15:42:00.000Z"));
  });

  it("extracts notification linkage fields in the configured priority order", () => {
    const mapped = mapNotificationRowToActivityNotification(notificationRow({
      payload: {
        event_id: "evt-direct",
        eventId: "evt-camel",
        activity_event_id: "evt-snake",
        activityEventId: "evt-alt",
        entityType: "comment",
        objectId: "comment-1",
        actionType: "comment_added",
      },
    }));

    expect(mapped.notification).toEqual({
      id: "notif-1",
      user_id: "profile-1",
      project_id: "project-1",
      event_id: "evt-direct",
      is_read: false,
    });
    expect(mapped.bridge).toEqual({
      notificationId: "notif-1",
      compatibilityEventId: "evt-direct",
      projectId: "project-1",
      createdAt: "2026-03-01T10:00:00.000Z",
      directEventId: "evt-direct",
      objectType: "comment",
      objectId: "comment-1",
      actionType: "comment_added",
    });
  });

  it("falls back to a deterministic compatibility event id when no direct event link exists", () => {
    const mapped = mapNotificationRowToActivityNotification(notificationRow({
      project_id: null,
      payload: {
        object_type: "task",
        object_id: "task-22",
        type: "task_updated",
      },
    }));

    expect(mapped.notification).toEqual({
      id: "notif-1",
      user_id: "profile-1",
      project_id: "",
      event_id: "compat:notif-1",
      is_read: false,
    });
    expect(mapped.bridge).toEqual({
      notificationId: "notif-1",
      compatibilityEventId: "compat:notif-1",
      projectId: undefined,
      createdAt: "2026-03-01T10:00:00.000Z",
      directEventId: undefined,
      objectType: "task",
      objectId: "task-22",
      actionType: "task_updated",
    });
  });
});

describe("supabase activity source getProjectEvents", () => {
  function createEventsChain(rows: ReturnType<typeof activityEventRow>[]) {
    const chain = {
      select: vi.fn(() => chain),
      eq: vi.fn(() => chain),
      order: vi.fn(() => chain),
      limit: vi.fn(() => chain),
      then: (resolve: (value: { data: unknown; error: null }) => unknown) =>
        Promise.resolve({ data: rows, error: null }).then(resolve),
    };

    return chain;
  }

  it("pushes the caller cap into the query instead of transferring every project event", async () => {
    const chain = createEventsChain([activityEventRow()]);
    setMockSupabase({ from: vi.fn(() => chain) });

    const source = await getActivitySource({ kind: "supabase", profileId: "profile-1" });
    const events = await source.getProjectEvents("project-1", 2);

    expect(chain.limit).toHaveBeenCalledWith(2);
    expect(events).toHaveLength(1);
  });

  it("leaves the query unbounded when no cap is given", async () => {
    const chain = createEventsChain([activityEventRow()]);
    setMockSupabase({ from: vi.fn(() => chain) });

    const source = await getActivitySource({ kind: "supabase", profileId: "profile-1" });
    await source.getProjectEvents("project-1");

    expect(chain.limit).not.toHaveBeenCalled();
  });
});
