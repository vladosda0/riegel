import { ProjectInviteAlreadyOutstandingError } from "@/data/workspace-source";

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
 * for fifteen distinct conditions, and `messageFromEdgeFunctionFailure` hands
 * that string through unchanged for `sendWorkspaceProjectInviteEmail` to rethrow
 * as an Error. Every call site then rendered `error.message`, so ALL fifteen
 * have been landing untranslated in a Russian toast.
 *
 * rovno-db#131 made that worse in the place it is easiest to hit: once invites
 * expire, «Отправить повторно» on a 14-day-old invite answers "Invite has
 * expired", and it is the only action left in the menu at that point, because
 * the list still shows «Ожидает» and a fresh invite is blocked by «Уже
 * приглашён».
 *
 * Mapped on the CLIENT rather than by adding a machine-readable code to the
 * function. The strings are ours and stable, `mapAcceptInviteError` already
 * matches Postgres messages the same way, and a code would mean changing the
 * function's contract plus a deploy for no behavioural gain.
 *
 * Only the three an owner can act on get their own copy. Everything else is a
 * server-side fault they cannot fix, so it gets the localized generic rather
 * than fifteen strings nobody will read: the point is that NOTHING reaches the
 * user in English, not that every internal condition gets a translation.
 */
/**
 * Every remaining `{"error": ...}` the function can answer with, verbatim from
 * `supabase/functions/send-project-invite/index.ts`. None is actionable by the
 * owner, so none earns its own copy, but each must still be replaced rather than
 * rendered.
 *
 * Enumerated rather than treated as a catch-all, and that distinction is the
 * whole design. A catch-all also swallows errors the FUNCTION never produced --
 * a network failure, a supabase-js fault, a timeout -- and those carry the only
 * diagnostic text there is. Two existing tests caught exactly that by asserting
 * "SMTP unavailable" and "Rate limited" survive to the toast, and they were
 * right to. Keep this list in sync when the function grows a new response.
 */
const EDGE_FUNCTION_FAULTS = [
  "method not allowed",
  "authorization header is required",
  "invalid json body",
  "inviteid must be a uuid string",
  "failed to load invite",
  "failed to load project",
  "project not found",
  "failed to load inviter profile",
  "inviter profile not found",
  "inviter profile is missing a displayable name",
  "failed to send invite email",
];

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

  if (EDGE_FUNCTION_FAULTS.some((fault) => normalized.includes(fault))) {
    return localizedFallback;
  }

  // Not something the function said, so it is the only description of what went
  // wrong that anyone has. Preserving it matches what all five call sites did
  // before this helper existed.
  return error instanceof Error ? error.message : localizedFallback;
}
