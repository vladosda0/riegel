import type { Member, Project } from "@/types/entities";

/**
 * Canonical read model for project-scoped authority in the app shell.
 *
 * Permission presets: src/lib/permission-contract-actions.ts
 *
 * Sourced from workspace membership + project rows (Supabase queries or demo/local store).
 * `Member.internal_docs_visibility` is hydrated by workspace mappers when present on rows;
 * use `effectiveInternalDocsVisibilityForSeam` from `@/lib/internal-docs-visibility` for UI parity
 * with `public.effective_internal_docs_visibility` (backend remains authoritative).
 */
export interface ProjectAuthoritySeam {
  projectId: string;
  /** Current workspace profile id (`Member.user_id` / `profiles.id`). */
  profileId: string;
  /** Membership row for `profileId`, or null if not in the project. */
  membership: Member | null;
  project: Project | undefined;
}

export function buildProjectAuthoritySeam(input: {
  projectId: string;
  profileId: string;
  members: Member[];
  project: Project | undefined;
}): ProjectAuthoritySeam {
  const membership = input.members.find((m) => m.user_id === input.profileId) ?? null;
  return {
    projectId: input.projectId,
    profileId: input.profileId,
    membership,
    project: input.project,
  };
}
