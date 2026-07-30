import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: rpcMock },
}));

import { acceptProjectInvite } from "@/lib/accept-project-invite";

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

  it("returns ok with the invite row on success", async () => {
    rpcMock.mockResolvedValue({ data: { id: "invite-1" }, error: null });

    const result = await acceptProjectInvite("token-live");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.invite).toEqual({ id: "invite-1" });
  });
});
