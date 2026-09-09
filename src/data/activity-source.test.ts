import { beforeEach, describe, expect, it, vi } from "vitest";
import { getEventGroupTimestampMs } from "@/lib/event-activity-timestamp";
import {
  __unsafeResetWorkspaceUserCacheForTests,
  cacheWorkspaceUsers,
  clearWorkspaceUserCache,
  getCachedWorkspaceUser,
} from "@/data/workspace-profile-cache";
import {
  __unsafeResetActorLookupsForTests,
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
      // The source also reads `profiles` to fill in actor names. Without `in`
      // here the cases below would reach getProjectEvents through a thrown
      // TypeError swallowed by the actor lookup's guard, rather than through
      // the code they are about to assert on.
      in: vi.fn(() => chain),
      order: vi.fn(() => chain),
      limit: vi.fn(() => chain),
      then: (resolve: (value: { data: unknown; error: null }) => unknown) =>
        Promise.resolve({ data: rows, error: null }).then(resolve),
    };

    return chain;
  }

  // The cache is module state shared by every test in the process; without this
  // the id filter below would find it already warm and the assertions would pass
  // without the code under test running at all.
  beforeEach(() => {
    __unsafeResetWorkspaceUserCacheForTests();
    __unsafeResetActorLookupsForTests();
  });

  function profileRow(id: string, fullName: string) {
    return {
      id,
      email: `${id}@example.test`,
      full_name: fullName,
      avatar_url: null,
      locale: "ru",
      timezone: "Europe/Moscow",
      plan: "free",
      credits_free: 0,
      credits_paid: 0,
    };
  }

  function createProfilesChain(rows: ReturnType<typeof profileRow>[]) {
    const chain = {
      select: vi.fn(() => chain),
      in: vi.fn((_column: string, _values: string[]) => chain),
      then: (resolve: (value: { data: unknown; error: null }) => unknown) =>
        Promise.resolve({ data: rows, error: null }).then(resolve),
    };

    return chain;
  }

  it("resolves actor names without the member screens having been opened", async () => {
    const eventsChain = createEventsChain([
      activityEventRow({ id: "evt-1", actor_profile_id: "profile-7" }),
      activityEventRow({ id: "evt-2", actor_profile_id: "profile-7" }),
      activityEventRow({ id: "evt-3", actor_profile_id: "profile-9" }),
    ]);
    const profilesChain = createProfilesChain([
      profileRow("profile-7", "Анна Петрова"),
      profileRow("profile-9", "Иван Смирнов"),
    ]);
    setMockSupabase({
      from: vi.fn((table: string) => (table === "profiles" ? profilesChain : eventsChain)),
    });

    const source = await getActivitySource({ kind: "supabase", profileId: "profile-1" });
    await source.getProjectEvents("project-1");

    // One request per distinct actor, each asked for once, and the names are
    // there for the first render rather than after a visit to the participants
    // screen. Two events share profile-7, so it is fetched once, not twice.
    expect(profilesChain.in).toHaveBeenCalledTimes(2);
    expect(profilesChain.in.mock.calls.map((call) => call[1])).toEqual([
      ["profile-7"],
      ["profile-9"],
    ]);
    expect(getCachedWorkspaceUser("profile-7")?.name).toBe("Анна Петрова");
    expect(getCachedWorkspaceUser("profile-9")?.name).toBe("Иван Смирнов");
  });

  it("asks once when several feeds want the same actor at the same time", async () => {
    // Home's real shape: one feed per project, each with its own actors, and a
    // shared one between them. A key built from the whole id list would only
    // dedup projects whose actor sets are byte-identical, which is not this.
    const sharedActor = activityEventRow({ id: "evt-a", actor_profile_id: "profile-7" });
    const otherActor = activityEventRow({ id: "evt-b", actor_profile_id: "profile-9" });
    const profilesChain = createProfilesChain([
      profileRow("profile-7", "Анна Петрова"),
      profileRow("profile-9", "Иван Смирнов"),
    ]);
    let feed = 0;
    const chains = [
      createEventsChain([sharedActor]),
      createEventsChain([sharedActor, otherActor]),
    ];
    setMockSupabase({
      from: vi.fn((table: string) => (table === "profiles" ? profilesChain : chains[feed++ % 2])),
    });

    const source = await getActivitySource({ kind: "supabase", profileId: "profile-1" });
    await Promise.all([
      source.getProjectEvents("project-1"),
      source.getProjectEvents("project-2"),
    ]);

    // profile-7 is wanted by both feeds and asked for once; profile-9 once.
    expect(profilesChain.in).toHaveBeenCalledTimes(2);
    expect(profilesChain.in.mock.calls.map((c) => c[1])).toEqual([["profile-7"], ["profile-9"]]);
  });

  it("stops asking for an actor the server will not return", async () => {
    const eventsChain = createEventsChain([activityEventRow({ actor_profile_id: "profile-8" })]);
    // profiles_select does not expose one member's profile to another, so the
    // row simply does not come back; asking again cannot change that.
    const profilesChain = createProfilesChain([]);
    setMockSupabase({
      from: vi.fn((table: string) => (table === "profiles" ? profilesChain : eventsChain)),
    });

    const source = await getActivitySource({ kind: "supabase", profileId: "profile-1" });
    await source.getProjectEvents("project-1");
    await source.getProjectEvents("project-1");

    expect(profilesChain.in).toHaveBeenCalledTimes(1);
  });

  it("drops a lookup that lands after the account changed", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const eventsChain = createEventsChain([activityEventRow({ actor_profile_id: "profile-7" })]);
    const profilesChain = {
      select: vi.fn(() => profilesChain),
      in: vi.fn(() => profilesChain),
      then: (resolve: (value: { data: unknown; error: null }) => unknown) =>
        gate.then(() => resolve({ data: [profileRow("profile-7", "Прошлый Аккаунт")], error: null })),
    };
    setMockSupabase({
      from: vi.fn((table: string) => (table === "profiles" ? profilesChain : eventsChain)),
    });

    const source = await getActivitySource({ kind: "supabase", profileId: "profile-1" });
    const pending = source.getProjectEvents("project-1");
    // Wait until the profile request has actually gone out, so the sign-out
    // below lands mid-flight rather than before the lookup started.
    await vi.waitFor(() => expect(profilesChain.in).toHaveBeenCalled());

    // The user signs out while the profile request is still in the air.
    clearWorkspaceUserCache();
    release?.();
    await pending;

    // The answer belongs to an account that is no longer signed in.
    expect(getCachedWorkspaceUser("profile-7")).toBeUndefined();
  });

  it("keeps asking after a lookup fails, rather than stranding the id", async () => {
    const eventsChain = createEventsChain([activityEventRow({ actor_profile_id: "profile-7" })]);
    // A client that throws the moment the query is built: the failure must not
    // leave a settled promise registered under the id and disable the lookup
    // for the rest of the tab's life.
    const throwingChain = {
      select: vi.fn(() => throwingChain),
      in: vi.fn(() => { throw new Error("profiles unreachable"); }),
    };
    const healthyChain = createProfilesChain([profileRow("profile-7", "Анна Петрова")]);
    let profilesCall = 0;
    setMockSupabase({
      from: vi.fn((table: string) =>
        table === "profiles" ? (profilesCall++ === 0 ? throwingChain : healthyChain) : eventsChain),
    });

    const source = await getActivitySource({ kind: "supabase", profileId: "profile-1" });
    await source.getProjectEvents("project-1");
    await source.getProjectEvents("project-1");

    expect(healthyChain.in).toHaveBeenCalledTimes(1);
    expect(getCachedWorkspaceUser("profile-7")?.name).toBe("Анна Петрова");
  });

  it("does not re-request an actor the cache already holds", async () => {
    cacheWorkspaceUsers([
      { id: "profile-7", email: "a@b.test", name: "Анна Петрова", locale: "ru",
        timezone: "Europe/Moscow", plan: "free", credits_free: 0, credits_paid: 0 },
    ]);

    const eventsChain = createEventsChain([activityEventRow({ actor_profile_id: "profile-7" })]);
    const profilesChain = createProfilesChain([]);
    setMockSupabase({
      from: vi.fn((table: string) => (table === "profiles" ? profilesChain : eventsChain)),
    });

    const source = await getActivitySource({ kind: "supabase", profileId: "profile-1" });
    await source.getProjectEvents("project-1");

    expect(profilesChain.in).not.toHaveBeenCalled();
  });

  // The lookup is a second network call, and it must never be able to take the
  // feed down with it.
  function createFailingProfilesChain(behaviour: "throws" | "errors") {
    const chain = {
      select: vi.fn(() => chain),
      in: vi.fn(() => {
        if (behaviour === "throws") throw new Error("profiles unreachable");
        return chain;
      }),
      then: (resolve: (value: { data: unknown; error: unknown }) => unknown) =>
        Promise.resolve({ data: null, error: { message: "denied" } }).then(resolve),
    };

    return chain;
  }

  it.each(["throws", "errors"] as const)(
    "still returns the feed when the actor-name lookup %s",
    async (behaviour) => {
      const eventsChain = createEventsChain([activityEventRow()]);
      const profilesChain = createFailingProfilesChain(behaviour);
      setMockSupabase({
        from: vi.fn((table: string) => (table === "profiles" ? profilesChain : eventsChain)),
      });

      const source = await getActivitySource({ kind: "supabase", profileId: "profile-1" });
      const events = await source.getProjectEvents("project-1");

      expect(events).toHaveLength(1);
    },
  );

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

  it("orders by a tiebreaker so the capped top-N is stable across ties", async () => {
    const chain = createEventsChain([activityEventRow()]);
    setMockSupabase({ from: vi.fn(() => chain) });

    const source = await getActivitySource({ kind: "supabase", profileId: "profile-1" });
    await source.getProjectEvents("project-1", 2);

    // created_at ties for rows written by one transaction, and a LIMIT would then
    // return an arbitrary member of the tie group. Assert PRECEDENCE, not just
    // presence: if id came first it would become the primary key and the query
    // would return arbitrary rows instead of the newest ones.
    expect(chain.order.mock.calls).toEqual([
      ["created_at", { ascending: false }],
      ["id", { ascending: false }],
    ]);
  });

  it.each([[0], [-1], [2.5], [Number.POSITIVE_INFINITY], [Number.NaN]])(
    "ignores a cap that is not a positive integer (%p)",
    async (badLimit) => {
      const chain = createEventsChain([activityEventRow()]);
      setMockSupabase({ from: vi.fn(() => chain) });

      const source = await getActivitySource({ kind: "supabase", profileId: "profile-1" });
      await source.getProjectEvents("project-1", badLimit);

      // postgrest-js writes the value into the query string verbatim, so a bad cap
      // would 400 and blank the feed; unbounded merely costs bandwidth.
      expect(chain.limit).not.toHaveBeenCalled();
    },
  );
});
