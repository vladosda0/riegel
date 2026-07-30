import { describe, expect, it } from "vitest";
import { ProjectInviteAlreadyOutstandingError } from "@/data/workspace-source";
import ruLocale from "@/locales/ru.json";
import { describeInviteCreateError, describeInviteSendError } from "@/lib/invite-error-copy";

// Stands in for i18next: returns the key so a test can assert WHICH key was
// asked for, which is the thing that must not drift from locales/ru.json.
const t = (key: string) => key;

/**
 * The real shape of a PostgREST failure. It is a PLAIN OBJECT, not an Error:
 * `PostgrestError` is constructed only when `throwOnError` is set, and no invite
 * path sets it. Using `new Error(...)` here instead is what made the previous
 * version of this suite certify behaviour the code does not have.
 */
function postgrestError(code: string, message: string) {
  return { code, message, details: "", hint: null };
}

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

    expect(error.message).toContain("A pending invite for");
    expect(describeInviteCreateError(error, t, "fallback")).not.toContain("A pending invite for");
  });

  it("gives a PostgREST error the localized fallback, because it is not an Error", () => {
    // Pins the ACTUAL behaviour, which is narrower than "backend errors keep
    // their message". A plain object fails `instanceof Error`, so raw backend
    // English never reaches the toast on this path. Asserted explicitly because
    // the previous version of this test passed an Error instance and therefore
    // would have gone green whichever way the branch went.
    const message = describeInviteCreateError(
      postgrestError("42501", "permission denied for table project_invites"),
      t,
      "fallback",
    );

    expect(message).toBe("fallback");
  });

  it("passes our own thrown Error message through", () => {
    // The branch that IS live: `throw new Error("Unable to create project invite")`
    // and the guest-mode throw in workspace-source.
    expect(describeInviteCreateError(new Error("Unable to create project invite"), t, "fallback"))
      .toBe("Unable to create project invite");
  });

  it("falls back for a non-Error throw", () => {
    expect(describeInviteCreateError("boom", t, "fallback")).toBe("fallback");
    expect(describeInviteCreateError(null, t, "fallback")).toBe("fallback");
  });
});

/**
 * `send-project-invite` answers with `{"error": "<English>"}` for fifteen
 * conditions and the client rethrew every one of them as an Error whose message
 * went straight into a Russian toast. These pin that none of them can now.
 */
describe("describeInviteSendError", () => {
  it("maps the expiry 409 to its own localized key", () => {
    expect(describeInviteSendError(new Error("Invite has expired"), t, "fallback"))
      .toBe("participants.error.sendExpired");
  });

  it("maps the not-pending 409", () => {
    expect(describeInviteSendError(new Error("Invite is no longer pending"), t, "fallback"))
      .toBe("participants.error.sendNoLongerPending");
  });

  it("maps the 404", () => {
    expect(describeInviteSendError(new Error("Invite not found"), t, "fallback"))
      .toBe("participants.error.sendNotFound");
  });

  it("gives every OTHER backend string the localized fallback rather than English", () => {
    // The whole remaining surface of the edge function, verbatim from
    // supabase/functions/send-project-invite/index.ts. None is actionable by the
    // owner, so none earns its own copy; what matters is that none is rendered.
    const serverFaults = [
      "Method not allowed",
      "Authorization header is required",
      "Invalid JSON body",
      "inviteId must be a UUID string",
      "Failed to load invite",
      "Failed to load project",
      "Project not found",
      "Failed to load inviter profile",
      "Inviter profile not found",
      "Inviter profile is missing a displayable name",
      "Failed to send invite email",
    ];

    for (const fault of serverFaults) {
      expect(describeInviteSendError(new Error(fault), t, "fallback")).toBe("fallback");
    }
  });

  it("PRESERVES the message of an error the function never produced", () => {
    // The counter-direction, and the reason the fault list is enumerated rather
    // than being a catch-all. A network failure, a timeout or a supabase-js
    // fault carries the only description of what went wrong that exists;
    // replacing it with a generic would make the toast useless precisely when
    // something unforeseen happened. Two pre-existing tests in
    // ProjectParticipants.test.tsx assert this end to end.
    expect(describeInviteSendError(new Error("SMTP unavailable"), t, "fallback"))
      .toBe("SMTP unavailable");
    expect(describeInviteSendError(new Error("Rate limited"), t, "fallback"))
      .toBe("Rate limited");
  });

  it("falls back for a non-Error throw", () => {
    expect(describeInviteSendError("boom", t, "fallback")).toBe("fallback");
    expect(describeInviteSendError(null, t, "fallback")).toBe("fallback");
  });
});

/**
 * The keys above are asserted as strings, which proves the branch was taken but
 * not that anything is written for it. This closes that: a mapped key with no RU
 * string renders the raw key to the user, which is worse than the English it
 * replaced.
 */
describe("invite send/create copy exists in RU", () => {
  it.each([
    "participants.error.inviteAlreadyOutstanding",
    "participants.error.sendExpired",
    "participants.error.sendNoLongerPending",
    "participants.error.sendNotFound",
  ])("has a non-empty RU string for %s", (key) => {
    const label = (ruLocale as Record<string, string>)[key];

    expect(typeof label).toBe("string");
    expect(label?.trim() ?? "").not.toBe("");
  });
});
