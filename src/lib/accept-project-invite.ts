import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { Database as WorkspaceDatabase } from "../../backend-truth/generated/supabase-types";

export type AcceptProjectInviteErrorCode =
  | "invite_email_mismatch"
  | "invite_invalid_or_unavailable"
  | "invite_expired"
  | "auth_required"
  | "project_owner_over_limit"
  | "unknown";

export interface AcceptProjectInviteError {
  code: AcceptProjectInviteErrorCode;
  message: string;
  rawError: PostgrestError | Error | null;
}

export interface AcceptProjectInviteResult {
  ok: true;
  invite: WorkspaceDatabase["public"]["Tables"]["project_invites"]["Row"];
}

export interface AcceptProjectInviteFailure {
  ok: false;
  error: AcceptProjectInviteError;
}

function mapAcceptInviteError(error: PostgrestError | Error | null): AcceptProjectInviteError {
  const message = error?.message ?? "Unable to accept invite.";
  const normalized = message.toLowerCase();

  if (normalized.includes("email does not match")) {
    return {
      code: "invite_email_mismatch",
      message: "This invite was sent to a different email address.",
      rawError: error,
    };
  }

  // Raised by accept_project_invite when `expires_at` has passed and this is a
  // FIRST acceptance (rovno-db 20260729130100). Kept separate from the
  // invalid/used bucket on purpose: the recipient's next move is different --
  // there is nothing wrong with their link or their account, they just need the
  // inviter to send a new one. Without this branch the raw Postgres string
  // reaches the invitee untranslated, because InviteAccept renders
  // `invite.error.<code>` and falls back to `message` for `unknown`.
  if (normalized.includes("invite has expired")) {
    return {
      code: "invite_expired",
      message: "This invite link has expired. Ask whoever invited you to send a new one.",
      rawError: error,
    };
  }

  if (normalized.includes("invite not found") || normalized.includes("no longer pending")) {
    return {
      code: "invite_invalid_or_unavailable",
      message: "This invite link is invalid, expired, or has already been used.",
      rawError: error,
    };
  }

  if (normalized.includes("authentication required")) {
    return {
      code: "auth_required",
      message: "You need to sign in before accepting this invite.",
      rawError: error,
    };
  }

  // Backend trigger: enforce_project_member_limits raises P0001 with one of
  // these exception names when the owner's tier seat limit is reached. The
  // invitee can't fix this from their account, so the message is owner-framed.
  if (
    normalized.includes("project_editor_limit_exceeded")
    || normalized.includes("project_viewer_limit_exceeded")
  ) {
    return {
      code: "project_owner_over_limit",
      message:
        "The project owner is at their plan's member limit. They need to upgrade or remove a member before you can join.",
      rawError: error,
    };
  }

  return {
    code: "unknown",
    message,
    rawError: error,
  };
}

export async function acceptProjectInvite(
  inviteToken: string,
): Promise<AcceptProjectInviteResult | AcceptProjectInviteFailure> {
  try {
    const typedClient = supabase as unknown as SupabaseClient<WorkspaceDatabase>;
    const { data, error } = await typedClient.rpc("accept_project_invite", {
      p_invite_token: inviteToken,
    });

    if (error) {
      return {
        ok: false,
        error: mapAcceptInviteError(error),
      };
    }

    if (!data) {
      return {
        ok: false,
        error: {
          code: "unknown",
          message: "Invite acceptance returned no data.",
          rawError: null,
        },
      };
    }

    return {
      ok: true,
      invite: data,
    };
  } catch (error) {
    return {
      ok: false,
      error: mapAcceptInviteError(error instanceof Error ? error : null),
    };
  }
}
