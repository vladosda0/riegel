import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cacheWorkspaceUsers, __unsafeResetWorkspaceUserCacheForTests } from "@/data/workspace-profile-cache";
import {
  __unsafeResetStoreForTests,
  addComment,
  addProject,
  addTask,
  getCurrentUser,
  getEvents,
  getNotifications,
  getTasks,
  getProjects,
  getUserById,
} from "@/data/store";
import {
  clearDemoSession,
  clearStoredAuthProfile,
  enterDemoSession,
  setAuthRole,
  setStoredAuthProfile,
} from "@/lib/auth-state";
import type { Task } from "@/types/entities";

describe("store", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    setAuthRole("guest");
    clearStoredAuthProfile();
    clearDemoSession();
    __unsafeResetWorkspaceUserCacheForTests();
    __unsafeResetStoreForTests();
  });

  it("returns cached workspace users before falling back to seeded demo users in local mode", () => {
    cacheWorkspaceUsers([
      {
        id: "user-2",
        email: "supabase@example.com",
        name: "Supabase Maria",
        locale: "en",
        timezone: "UTC",
        plan: "pro",
        credits_free: 0,
        credits_paid: 100,
      },
    ]);

    expect(getUserById("user-2")?.name).toBe("Supabase Maria");
    expect(getUserById("user-3")?.name).toBe("Дмитрий Соколов");
  });

  it("ignores cached workspace users while demo session is active", () => {
    cacheWorkspaceUsers([
      {
        id: "user-2",
        email: "supabase@example.com",
        name: "Supabase Maria",
        locale: "en",
        timezone: "UTC",
        plan: "pro",
        credits_free: 0,
        credits_paid: 100,
      },
    ]);
    enterDemoSession("project-1");
    __unsafeResetStoreForTests();

    expect(getCurrentUser()).toMatchObject({
      id: "user-1",
      email: "alex@rovno.ai",
      name: "Алексей Петров",
    });
    expect(getUserById("user-2")?.name).toBe("Мария Иванова");
  });

  it("starts authenticated local workspaces empty instead of inheriting demo projects", () => {
    setStoredAuthProfile({
      email: "new-user@example.com",
      name: "New User",
    });
    setAuthRole("owner");
    __unsafeResetStoreForTests();

    expect(getCurrentUser()).toMatchObject({
      email: "new-user@example.com",
      name: "New User",
    });
    expect(getProjects()).toEqual([]);
  });

  it("hydrates persisted demo state from session storage during the active demo session", () => {
    enterDemoSession("project-1");
    __unsafeResetStoreForTests();

    addProject({
      id: "project-demo-persisted",
      owner_id: "user-1",
      title: "Persisted Demo Project",
      type: "residential",
      automation_level: "manual",
      current_stage_id: "",
      progress_pct: 0,
    });

    expect(getProjects().some((project) => project.id === "project-demo-persisted")).toBe(true);

    __unsafeResetStoreForTests();

    expect(getProjects().some((project) => project.id === "project-demo-persisted")).toBe(true);
  });

  it("sanitizes polluted persisted demo user identity before reads", () => {
    sessionStorage.setItem(
      "workspace-demo-state",
      JSON.stringify({
        user: {
          id: "real-user-id",
          email: "real@example.com",
          name: "Real User",
          locale: "en",
          timezone: "UTC",
          plan: "pro",
          credits_free: 0,
          credits_paid: 999,
        },
      }),
    );

    enterDemoSession("project-1");
    __unsafeResetStoreForTests();

    expect(getCurrentUser()).toMatchObject({
      id: "user-1",
      email: "alex@rovno.ai",
      name: "Алексей Петров",
    });
  });
});

describe("store auto-minted ids", () => {
  // Both ids are built from Date.now(). Pin the clock so these prove the disambiguating
  // counter rather than the clock.
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    setAuthRole("guest");
    clearStoredAuthProfile();
    clearDemoSession();
    __unsafeResetWorkspaceUserCacheForTests();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-31T00:00:00.000Z"));
    __unsafeResetStoreForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function task(id: string, projectId: string): Task {
    return {
      id,
      project_id: projectId,
      stage_id: "stage-loop",
      title: id,
      description: "",
      status: "not_started",
      assignee_id: "",
      checklist: [],
      comments: [],
      attachments: [],
      photos: [],
      linked_estimate_item_ids: [],
      created_at: "2026-08-31T00:00:00.000Z",
    };
  }

  it("mints a distinct activity-event id for every task created in one loop", () => {
    for (const id of ["t-1", "t-2", "t-3", "t-4", "t-5"]) {
      addTask(task(id, "project-loop"));
    }

    const eventIds = getEvents("project-loop").map((event) => event.id);
    expect(eventIds).toHaveLength(5);
    expect(new Set(eventIds).size).toBe(eventIds.length);
  });

  it("mints a distinct comment id for every comment added in one loop", () => {
    addTask(task("t-comments", "project-loop"));

    for (const text of ["a", "b", "c"]) {
      addComment("t-comments", text);
    }

    const commentIds = (getTasks("project-loop").find((entry) => entry.id === "t-comments")?.comments ?? [])
      .map((comment) => comment.id);
    expect(commentIds).toHaveLength(3);
    expect(new Set(commentIds).size).toBe(commentIds.length);
  });

  it("mints a distinct notification id across events raised in the same millisecond", () => {
    enterDemoSession("project-1");
    __unsafeResetStoreForTests();

    const before = new Set(getNotifications("user-2").map((notification) => notification.id));

    addTask(task("t-notif-1", "project-1"));
    addTask(task("t-notif-2", "project-1"));

    const minted = getNotifications("user-2")
      .map((notification) => notification.id)
      .filter((id) => !before.has(id));

    expect(minted).toHaveLength(2);
    expect(new Set(minted).size).toBe(minted.length);
  });
});
