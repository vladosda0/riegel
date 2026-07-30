import {
  ProjectInviteAlreadyOutstandingError,
  ProjectInviteEmailSendError,
} from "@/data/workspace-source";

type Translate = (key: string) => string;

/**
 * Turns a failure from `createWorkspaceProjectInvite` into a string fit for a
 * toast.
 *
 * Exists because all three invite-creation screens (ParticipantsScreen,
 * ProjectParticipants, ProjectEstimate) rendered `error.message` verbatim, and
 * `ProjectInviteAlreadyOutstandingError` needs a specific instruction that would
 * drift if it were written out three times.
 *
 * READ THE `instanceof Error` CHECK CAREFULLY, because its reach is narrower
 * than it looks and an earlier version of this comment claimed the opposite. A
 * PostgREST error is a PLAIN OBJECT, not an `Error`: `PostgrestError` is only
 * constructed when `throwOnError` is set, and no invite path sets it. So a
 * backend failure (RLS denial, 42501 from the column revoke, a constraint) takes
 * the FALLBACK branch, not the message branch. What actually reaches
 * `error.message` is our own `new Error(...)` throws. That is the pre-existing
 * behaviour of all three screens and this helper deliberately preserves it
 * rather than changing what users see as a side effect of a refactor; widening
 * it to duck-type (as `parseTierLimitError` does) would start surfacing raw
 * backend English that has never been shown before, which is a product call.
 */
export function describeInviteCreateError(
  error: unknown,
  t: Translate,
  localizedFallback: string,
): string {
  if (error instanceof ProjectInviteAlreadyOutstandingError) {
    return t("participants.error.inviteAlreadyOutstanding");
  }
  return error instanceof Error ? error.message : localizedFallback;
}

/**
 * The `send-project-invite` edge function answers with `{"error": "<English>"}`
 * for fourteen fixed conditions AND two dynamic branches that render whatever a
 * `ProjectInviteEmailConfigError` carries (a missing env var, a malformed
 * PROJECT_INVITE_BASE_URL, and so on). Every one of them used to reach a Russian
 * toast, because `sendWorkspaceProjectInviteEmail` rethrew the body text and all
 * five call sites rendered `error.message`.
 *
 * rovno-db#131 made that worse where it is easiest to hit: once invites expire,
 * «Отправить повторно» on a 14-day-old invite answers "Invite has expired", and
 * it is the only action left in the menu at that point, because the list still
 * shows «Ожидает» and a fresh invite is blocked by «Уже приглашён».
 *
 * WHY THIS DOES NOT ENUMERATE THE FUNCTION'S STRINGS. The first version did, and
 * a review round showed the list was already incomplete: it covered the eleven
 * literals and missed both dynamic branches, so a deployment with an unset
 * RESEND_API_KEY would have shown "Missing required environment variable:
 * RESEND_API_KEY" to every user who pressed resend. That is not a bug in the
 * list, it is a bug in the approach -- a list maintained in this repo against
 * strings written in another one is incomplete the moment the other side adds a
 * message, and it fails SILENTLY, which is the worst way to fail.
 *
 * So the origin is carried instead of guessed: `ProjectInviteEmailSendError`
 * records whether the text came from the function's own error payload (our
 * English, localize it) or from an unplanned failure (a network error, a proxy
 * page, a bare HTTP status -- the only description of the problem there is, show
 * it). Complete by construction, and it stays complete when the function grows a
 * fifteenth message.
 *
 * Three conditions still match on text, and only those three: they are the ones
 * an owner can act on, so they earn specific copy rather than the generic
 * fallback. Being wrong about one of them costs a less helpful message, never an
 * English one.
 */
export function describeInviteSendError(
  error: unknown,
  t: Translate,
  localizedFallback: string,
): string {
  const message = error instanceof Error ? error.message : "";
  const normalized = message.toLowerCase();

  if (normalized.includes("invite has expired")) {
    return t("participants.error.sendExpired");
  }

  if (normalized.includes("no longer pending")) {
    return t("participants.error.sendNoLongerPending");
  }

  if (normalized.includes("invite not found")) {
    return t("participants.error.sendNotFound");
  }

  if (error instanceof ProjectInviteEmailSendError) {
    return error.diagnostic ? error.message : localizedFallback;
  }

  // Not from the send path at all: a caller-supplied Error, or a throw from
  // somewhere else in the mutation. Preserving it matches what all five call
  // sites did before this helper existed, and two pre-existing tests in
  // ProjectParticipants.test.tsx assert exactly that.
  return error instanceof Error ? error.message : localizedFallback;
}
