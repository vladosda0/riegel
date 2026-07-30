import { describe, expect, it } from "vitest";
import {
  ProjectInviteAlreadyOutstandingError,
  ProjectInviteEmailSendError,
} from "@/data/workspace-source";
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
  // The three the owner can act on keep their own copy, matched on text.
  it("maps the expiry 409 to its own localized key", () => {
    expect(describeInviteSendError(new ProjectInviteEmailSendError("Invite has expired", false), t, "fallback"))
      .toBe("participants.error.sendExpired");
  });

  it("maps the not-pending 409", () => {
    expect(describeInviteSendError(new ProjectInviteEmailSendError("Invite is no longer pending", false), t, "fallback"))
      .toBe("participants.error.sendNoLongerPending");
  });

  it("maps the 404", () => {
    expect(describeInviteSendError(new ProjectInviteEmailSendError("Invite not found", false), t, "fallback"))
      .toBe("participants.error.sendNotFound");
  });

  /**
   * The assertion that replaced an enumerated fault list. These are not a sample
   * of known strings: they include the DYNAMIC config-error branch, which no list
   * in this repo could have covered, and which a review round found missing from
   * the first version. What makes them localize is the origin flag, so a message
   * the function grows tomorrow localizes too, without touching this file.
   */
  it("localizes ANY non-diagnostic message from the function, listed or not", () => {
    const fromTheFunction = [
      "Failed to send invite email",
      "Inviter profile is missing a displayable name",
      "inviteId must be a UUID string",
      // the dynamic branches, i.e. the ones an enumeration missed
      "Missing required environment variable: RESEND_API_KEY",
      "PROJECT_INVITE_BASE_URL must be a valid absolute URL",
      "Accept URL is required",
      // and a string that does not exist yet, standing in for the next one added
      "Some condition nobody has written yet",
    ];

    for (const message of fromTheFunction) {
      expect(describeInviteSendError(new ProjectInviteEmailSendError(message, false), t, "fallback"))
        .toBe("fallback");
    }
  });

  it("PRESERVES a diagnostic message, which is the counter-direction", () => {
    // An unplanned failure: a proxy page, a bare HTTP status, a network error.
    // Nobody wrote this text, so it is the only description of the problem there
    // is; collapsing it to a generic would make the toast useless precisely when
    // something unforeseen happened.
    expect(describeInviteSendError(new ProjectInviteEmailSendError("HTTP 502 Bad Gateway", true), t, "fallback"))
      .toBe("HTTP 502 Bad Gateway");
  });

  it("PRESERVES the message of a plain Error from outside the send path", () => {
    // Two pre-existing tests in ProjectParticipants.test.tsx assert this end to
    // end with "SMTP unavailable" and "Rate limited".
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
