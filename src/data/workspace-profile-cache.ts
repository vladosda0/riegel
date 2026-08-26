import type { User } from "@/types/entities";

const workspaceUsers = new Map<string, User>();

// Ids a lookup asked for and did not get back. profiles_select does not expose
// one member's profile to another, so without this every feed fetch re-asks for
// the same unreachable ids for the lifetime of the tab.
const missingWorkspaceUsers = new Set<string>();

export function cacheWorkspaceUsers(users: User[]): void {
  users.forEach((user) => {
    if (!user.id) return;
    workspaceUsers.set(user.id, user);
    // An id that has become reachable is no longer missing; without this the
    // negative entry would outlive the fact it recorded.
    missingWorkspaceUsers.delete(user.id);
  });
}

export function getCachedWorkspaceUser(id: string): User | undefined {
  return workspaceUsers.get(id);
}

/** True once a lookup has asked for this id and come back without it. */
export function isKnownMissingWorkspaceUser(id: string): boolean {
  return missingWorkspaceUsers.has(id);
}

export function markWorkspaceUsersMissing(ids: string[]): void {
  ids.forEach((id) => {
    if (!workspaceUsers.has(id)) missingWorkspaceUsers.add(id);
  });
}

/**
 * Every identity change drops this along with the React Query cache: the map is
 * module state, keyed by profile id and not by account, so the next account on
 * the same tab would otherwise read names the previous one had loaded, which
 * profiles_select would not have shown them.
 *
 * The epoch is what makes that reliable. A profile request already in flight
 * when the identity changes would otherwise land afterwards and re-seed the map
 * it was just cleared from, so a writer captures the epoch before its request
 * and drops the result if it no longer matches.
 */
export function clearWorkspaceUserCache(): void {
  workspaceUsers.clear();
  missingWorkspaceUsers.clear();
  epoch += 1;
}

let epoch = 0;

export function currentWorkspaceUserEpoch(): number {
  return epoch;
}

export function __unsafeResetWorkspaceUserCacheForTests(): void {
  workspaceUsers.clear();
  missingWorkspaceUsers.clear();
}
