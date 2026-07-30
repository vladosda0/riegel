import { ProjectInviteAlreadyOutstandingError } from "@/data/workspace-source";

type Translate = (key: string) => string;

/**
 * Turns a failure from `createWorkspaceProjectInvite` into a string fit for a
 * toast.
 *
 * Exists because all three invite-creation screens (ParticipantsScreen,
 * ProjectParticipants, ProjectEstimate) previously rendered `error.message`
 * verbatim, which is correct for a PostgREST error carrying an actionable
 * backend reason and wrong for a domain error whose message is developer
 * English. `ProjectInviteAlreadyOutstandingError` is the case that made this
 * worth centralising: it became reachable in ordinary use when invites got an
 * expiry (rovno-db 20260729130100), it needs a specific instruction rather than
 * a generic failure notice, and three copies of that instruction would drift.
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
