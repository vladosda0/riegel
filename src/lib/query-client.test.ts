import { describe, expect, it } from "vitest";
import { redactQueryKey } from "@/lib/query-client";

describe("redactQueryKey", () => {
  it("strips the credential from a share query key", () => {
    // These keys are attached to Sentry events as `extra.queryKey`. The second
    // element is the credential for a public route, not an id.
    expect(redactQueryKey(["document-share", "a".repeat(48)])).toEqual([
      "document-share",
      "[FILTERED]",
    ]);
    expect(redactQueryKey(["estimate-share", "share_abc123"])).toEqual([
      "estimate-share",
      "[FILTERED]",
    ]);
    expect(redactQueryKey(["invite-token", "1f0c2d3e-4a5b-6c7d-8e9f-0a1b2c3d4e5f"])).toEqual([
      "invite-token",
      "[FILTERED]",
    ]);
  });

  it("leaves ordinary keys intact, so per-resource reporting still works", () => {
    expect(redactQueryKey(["project-documents", "proj-1", { archived: true }])).toEqual([
      "project-documents",
      "proj-1",
      { archived: true },
    ]);
    expect(redactQueryKey([])).toEqual([]);
    expect(redactQueryKey([42, "x"])).toEqual([42, "x"]);
  });

  it("returns a copy, never the live key array", () => {
    const key = ["project-documents", "proj-1"];
    expect(redactQueryKey(key)).not.toBe(key);
  });
});
