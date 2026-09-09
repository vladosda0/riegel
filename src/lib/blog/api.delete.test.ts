import { beforeEach, describe, expect, it, vi } from "vitest";

// Capture the query deleteBlogPost builds. The whole point of the returned rows
// is that they come from the server, so the request has to actually ask for
// them: without the select, PostgREST answers 204 with no body, the caller sees
// an empty list and skips the rebuild for every delete — including a published
// post, which is the zombie page this guard exists to prevent.
const fromSpy = vi.fn();
const deleteSpy = vi.fn();
const eqSpy = vi.fn();
const selectSpy = vi.fn();
let response: { data: unknown; error: unknown } = { data: [], error: null };

vi.mock("@/integrations/supabase/client", () => {
  const makeBuilder = () => {
    const builder = {
      delete: () => {
        deleteSpy();
        return builder;
      },
      eq: (column: string, value: string) => {
        eqSpy(column, value);
        return builder;
      },
      select: (columns: string) => {
        selectSpy(columns);
        return Promise.resolve(response);
      },
    };
    return builder;
  };
  return {
    supabase: {
      from: (table: string) => {
        fromSpy(table);
        return makeBuilder();
      },
      functions: { invoke: vi.fn() },
      storage: { from: vi.fn() },
      auth: { getSession: vi.fn() },
    },
  };
});

import { deleteBlogPost } from "@/lib/blog/api";

describe("deleteBlogPost", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    response = { data: [], error: null };
  });

  it("asks the server for the deleted row's published_at", async () => {
    response = { data: [{ published_at: "2026-08-01T10:00:00.000Z" }], error: null };

    const deleted = await deleteBlogPost("post-1");

    expect(fromSpy).toHaveBeenCalledWith("blog_posts");
    expect(deleteSpy).toHaveBeenCalledTimes(1);
    expect(eqSpy).toHaveBeenCalledWith("id", "post-1");
    expect(selectSpy).toHaveBeenCalledWith("published_at");
    expect(deleted).toEqual([{ published_at: "2026-08-01T10:00:00.000Z" }]);
  });

  it("returns an empty list when the delete removed nothing", async () => {
    response = { data: [], error: null };

    await expect(deleteBlogPost("post-1")).resolves.toEqual([]);
  });

  it("treats a null payload as nothing removed rather than throwing", async () => {
    response = { data: null, error: null };

    await expect(deleteBlogPost("post-1")).resolves.toEqual([]);
  });

  it("throws when the delete itself failed", async () => {
    response = { data: null, error: new Error("нет прав") };

    await expect(deleteBlogPost("post-1")).rejects.toThrow("нет прав");
  });
});
