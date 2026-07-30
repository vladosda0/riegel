import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: rpcMock },
}));

import ruLocale from "@/locales/ru.json";
import { acceptProjectInvite } from "@/lib/accept-project-invite";
import type { AcceptProjectInviteErrorCode } from "@/lib/accept-project-invite";

/**
 * `mapAcceptInviteError` is module-private, so these drive it through the only
 * public entry point, which is also the shape the app actually uses.
 *
 * The point of the suite is the CODE, not the message: InviteAccept renders
 * `t("invite.error." + code, { defaultValue: message })`, so a raise that maps
 * to `unknown` reaches the invitee as the raw untranslated Postgres string.
 * Every message the RPC can raise therefore needs a code, and every code needs
 * a locale key.
 */
function rpcError(message: string) {
  return { data: null, error: { message, code: "P0001", details: "", hint: "" } };
}

describe("acceptProjectInvite error mapping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("maps 'Invite has expired' to invite_expired, not unknown", async () => {
    rpcMock.mockResolvedValue(rpcError("Invite has expired"));

    const result = await acceptProjectInvite("token-expired");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("invite_expired");
    // The distinction that earns a separate code: nothing is wrong with the
    // link or the account, so the instruction is "ask for a new one" rather
    // than the invalid/used copy.
    expect(result.error.message).toContain("expired");
    expect(result.error.message).not.toContain("already been used");
  });

  it("keeps 'Invite not found' in the invalid/unavailable bucket", async () => {
    rpcMock.mockResolvedValue(rpcError("Invite not found"));

    const result = await acceptProjectInvite("token-missing");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("invite_invalid_or_unavailable");
  });

  it("keeps 'Invite is no longer pending' in the invalid/unavailable bucket", async () => {
    rpcMock.mockResolvedValue(rpcError("Invite is no longer pending"));

    const result = await acceptProjectInvite("token-revoked");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("invite_invalid_or_unavailable");
  });

  it("still maps the email mismatch and auth branches", async () => {
    rpcMock.mockResolvedValue(rpcError("Invite email does not match the current account"));
    const mismatch = await acceptProjectInvite("token-a");
    expect(mismatch.ok).toBe(false);
    if (!mismatch.ok) expect(mismatch.error.code).toBe("invite_email_mismatch");

    rpcMock.mockResolvedValue(rpcError("Authentication required"));
    const unauth = await acceptProjectInvite("token-b");
    expect(unauth.ok).toBe(false);
    if (!unauth.ok) expect(unauth.error.code).toBe("auth_required");
  });

  it("maps the owner's seat-limit raises to project_owner_over_limit, not unknown", async () => {
    // enforce_project_member_limits raises the bare exception name, so this is
    // the literal message the RPC returns.
    rpcMock.mockResolvedValue(rpcError("project_editor_limit_exceeded"));
    const editor = await acceptProjectInvite("token-editor-limit");
    expect(editor.ok).toBe(false);
    if (editor.ok) return;
    expect(editor.error.code).toBe("project_owner_over_limit");
    // Owner-framed: the invitee cannot fix a limit on someone else's plan, so
    // the copy must not tell them to change anything about their own account.
    expect(editor.error.message).not.toContain("project_editor_limit_exceeded");

    // Same branch, other half of the condition. Asserted so deleting the viewer
    // clause cannot pass on the editor case alone.
    rpcMock.mockResolvedValue(rpcError("project_viewer_limit_exceeded"));
    const viewer = await acceptProjectInvite("token-viewer-limit");
    expect(viewer.ok).toBe(false);
    if (viewer.ok) return;
    expect(viewer.error.code).toBe("project_owner_over_limit");
  });

  it("returns ok with the invite row on success", async () => {
    rpcMock.mockResolvedValue({ data: { id: "invite-1" }, error: null });

    const result = await acceptProjectInvite("token-live");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.invite).toEqual({ id: "invite-1" });
  });
});

/**
 * A Record over the union rather than a plain array: adding a code to
 * AcceptProjectInviteErrorCode fails TYPECHECK here until it is listed, and then
 * fails the TEST below until it has a RU key. That two-step is the guard. The
 * per-code test alone would not catch a new code, because a test nobody wrote
 * cannot fail.
 *
 * RU only, deliberately. InviteAccept passes the mapper's English as
 * `defaultValue`, so a missing EN key is invisible, while a missing RU key is
 * exactly how `project_owner_over_limit` shipped English to Russian invitees.
 */
const ALL_ERROR_CODES: Record<AcceptProjectInviteErrorCode, true> = {
  invite_email_mismatch: true,
  invite_invalid_or_unavailable: true,
  invite_expired: true,
  auth_required: true,
  project_owner_over_limit: true,
  unknown: true,
};

describe("invite.error locale coverage", () => {
  it.each(Object.keys(ALL_ERROR_CODES))("has a non-empty RU string for the '%s' code", (code) => {
    const label = (ruLocale as Record<string, string>)[`invite.error.${code}`];

    expect(typeof label).toBe("string");
    expect(label?.trim() ?? "").not.toBe("");
  });
});
