import { describe, expect, it } from "vitest";
import { ProjectInviteAlreadyOutstandingError } from "@/data/workspace-source";
import { describeInviteCreateError } from "@/lib/invite-create-error";

// Stands in for i18next: returns the key so a test can assert WHICH key was
// asked for, which is the thing that must not drift from locales/ru.json.
const t = (key: string) => key;

describe("describeInviteCreateError", () => {
  it("maps the outstanding-invite error to its own localized key", () => {
    const message = describeInviteCreateError(
      new ProjectInviteAlreadyOutstandingError("someone@example.com"),
      t,
      "fallback",
    );

    expect(message).toBe("participants.error.inviteAlreadyOutstanding");
  });

  it("does NOT leak the domain error's developer English", () => {
    const error = new ProjectInviteAlreadyOutstandingError("someone@example.com");

    // Proves the branch above is load-bearing: the raw message is English and
    // names an internal concept, and it is what these three screens rendered
    // before this helper existed.
    expect(error.message).toContain("A pending invite for");
    expect(describeInviteCreateError(error, t, "fallback")).not.toContain("A pending invite for");
  });

  it("passes a PostgREST error's own message through", () => {
    // Deliberate: a backend error usually carries the actionable reason, and
    // swallowing it behind a generic fallback loses information. Only our own
    // domain errors are translated.
    const message = describeInviteCreateError(
      new Error("new row violates row-level security policy"),
      t,
      "fallback",
    );

    expect(message).toBe("new row violates row-level security policy");
  });

  it("falls back for a non-Error throw", () => {
    expect(describeInviteCreateError("boom", t, "fallback")).toBe("fallback");
    expect(describeInviteCreateError(null, t, "fallback")).toBe("fallback");
  });
});
