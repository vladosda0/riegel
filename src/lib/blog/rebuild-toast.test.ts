import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

vi.mock("@/lib/blog/api", () => ({ triggerFrontendRebuild: vi.fn() }));

import { triggerFrontendRebuild } from "@/lib/blog/api";
import {
  needsRebuildAfterDelete,
  REBUILD_TIMEOUT_MS,
  rebuildAfterTakedown,
  rebuildToast,
  type TakedownAction,
} from "@/lib/blog/rebuild-toast";

const ACTIONS: TakedownAction[] = ["unpublish", "delete"];

describe("rebuildToast", () => {
  it.each(ACTIONS)("reports a started rebuild for %s", (action) => {
    expect(rebuildToast(action, { ok: true })).toEqual({
      title: action === "delete" ? "Статья удалена" : "Статья снята с публикации",
      description: "Пересборка запущена.",
    });
  });

  it.each(ACTIONS)("does not call an unconfigured rebuild a failure for %s", (action) => {
    const toast = rebuildToast(action, {
      ok: false,
      notConfigured: true,
      inProgress: false,
      message: "not configured",
    });
    expect(toast.variant).toBeUndefined();
    expect(toast.description).toContain("Автопересборка не настроена");
    expect(toast.description).toContain(action === "delete" ? "с сайта" : "из поиска");
  });

  it.each(ACTIONS)("does not call a build already running a failure for %s", (action) => {
    const toast = rebuildToast(action, {
      ok: false,
      notConfigured: false,
      inProgress: true,
      message: "rebuild_in_progress",
    });
    expect(toast.variant).toBeUndefined();
    expect(toast.description).toContain("Пересборка уже идёт");
  });

  it.each(ACTIONS)("warns that the page is still live for %s", (action) => {
    const toast = rebuildToast(action, {
      ok: false,
      notConfigured: false,
      inProgress: false,
      message: "Timeweb API error",
    });
    expect(toast.variant).toBe("destructive");
    expect(toast.title).toContain(action === "delete" ? "ещё на сайте" : "ещё в поиске");
  });
});

describe("needsRebuildAfterDelete", () => {
  it("skips the rebuild for a row the server said was never published", () => {
    expect(needsRebuildAfterDelete([{ published_at: null }])).toBe(false);
  });

  it("rebuilds for a published row", () => {
    expect(needsRebuildAfterDelete([{ published_at: "2026-08-01T10:00:00.000Z" }])).toBe(true);
  });

  it("skips the rebuild when the delete removed nothing", () => {
    expect(needsRebuildAfterDelete([])).toBe(false);
  });
});

describe("rebuildAfterTakedown", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reports the outcome the rebuild returned", async () => {
    (triggerFrontendRebuild as Mock).mockResolvedValue({ ok: true });
    const notify = vi.fn();
    await rebuildAfterTakedown("delete", notify);
    expect(notify).toHaveBeenCalledWith({
      title: "Статья удалена",
      description: "Пересборка запущена.",
    });
  });

  it("still warns when the rebuild request rejects", async () => {
    (triggerFrontendRebuild as Mock).mockRejectedValue(new Error("network down"));
    const notify = vi.fn();
    await rebuildAfterTakedown("delete", notify);
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ variant: "destructive" }));
  });

  it("still warns when the rebuild call never settles", async () => {
    vi.useFakeTimers();
    try {
      (triggerFrontendRebuild as Mock).mockReturnValue(new Promise<never>(() => {}));
      const notify = vi.fn();
      void rebuildAfterTakedown("delete", notify);
      await vi.advanceTimersByTimeAsync(REBUILD_TIMEOUT_MS);
      expect(notify).toHaveBeenCalledWith({
        title: "Удалена, но страница ещё на сайте",
        description: "Пересборка не запустилась. Повторите кнопкой «Обновить сайт».",
        variant: "destructive",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("notifies once and leaves no timer behind when the rebuild answers", async () => {
    vi.useFakeTimers();
    try {
      (triggerFrontendRebuild as Mock).mockResolvedValue({ ok: true });
      const notify = vi.fn();
      await rebuildAfterTakedown("delete", notify);
      expect(notify).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
