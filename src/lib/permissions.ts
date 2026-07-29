import { useMemo } from "react";
import {
  useWorkspaceCurrentUser,
  useWorkspaceMode,
  useWorkspaceProjectState,
  useWorkspaceProjectMembersState,
  type WorkspaceModeState,
} from "@/hooks/use-workspace-source";
import { can, type Action } from "@/lib/permission-matrix";
import {
  buildProjectAuthoritySeam,
  type ProjectAuthoritySeam,
} from "@/lib/project-authority-seam";
import {
  resolveActionState,
  type ActionState,
  type ContractAction,
  type ContractDomain,
  type PermissionOverrides,
} from "@/lib/permission-contract-actions";
import { getAuthRole } from "@/lib/auth-state";
import { getDefaultFinanceVisibility } from "@/lib/participant-role-policy";
import type { FinanceVisibility, MemberRole } from "@/types/entities";

export type { Action } from "@/lib/permission-matrix";
export { can, isOwnerOrCoOwner } from "@/lib/permission-matrix";
export type { ProjectAuthoritySeam } from "@/lib/project-authority-seam";
export { buildProjectAuthoritySeam } from "@/lib/project-authority-seam";
export type { ActionState, ActionControlProps, ContractAction, ContractDomain, PermissionOverrides } from "@/lib/permission-contract-actions";
export { resolveActionState, actionStateToControlProps } from "@/lib/permission-contract-actions";

export type ProjectDomain =
  | "participants"
  | "invites"
  | "permissions"
  | "estimate"
  | "tasks"
  | "procurement"
  | "hr"
  | "documents"
  | "gallery"
  | "comments";

export type ProjectDomainAccess = "hidden" | "view" | "contribute" | "summary" | "manage";

export function getProjectRole(seam: ProjectAuthoritySeam): MemberRole {
  if (seam.membership?.role) return seam.membership.role;
  if (seam.project?.owner_id === seam.profileId) return "owner";
  return "viewer";
}

export function getProjectDomainAccessForRole(
  role: MemberRole,
  domain: ProjectDomain,
): ProjectDomainAccess {
  switch (domain) {
    case "participants":
    case "invites":
    case "permissions":
      return role === "owner" || role === "co_owner" ? "manage" : "hidden";
    case "estimate":
      return role === "owner" || role === "co_owner" ? "manage" : "view";
    case "tasks":
    case "documents":
    case "gallery":
    case "comments":
      if (role === "owner" || role === "co_owner") return "manage";
      return role === "contractor" ? "contribute" : "view";
    case "procurement":
      return role === "owner" || role === "co_owner" ? "manage" : "summary";
    case "hr":
      return role === "owner" || role === "co_owner" ? "manage" : "hidden";
    default:
      return "hidden";
  }
}

export function getProjectDomainAccess(
  seam: ProjectAuthoritySeam,
  domain: ProjectDomain,
): ProjectDomainAccess {
  return getProjectDomainAccessForRole(getProjectRole(seam), domain);
}

export function projectDomainAllowsView(access: ProjectDomainAccess): boolean {
  return access !== "hidden";
}

export function projectDomainAllowsContribute(access: ProjectDomainAccess): boolean {
  return access === "contribute" || access === "manage";
}

export function projectDomainAllowsManage(access: ProjectDomainAccess): boolean {
  return access === "manage";
}

export function projectDomainAllowsRoute(
  seam: ProjectAuthoritySeam,
  domain: ProjectDomain | null,
): boolean {
  if (!domain) return true;
  return projectDomainAllowsView(getProjectDomainAccess(seam, domain));
}

/**
 * UI and non-React callers (e.g. AI commit) should use this instead of re-lookup
 * in the demo store alone.
 *
 * For legacy `Action` keys this delegates to the coarse `can()` matrix.
 * Callers needing the full three-state result should use `seamResolveActionState` instead.
 */
export function seamAllowsAction(seam: ProjectAuthoritySeam, action: Action): boolean {
  const role = getProjectRole(seam);
  const aiAccess = seam.membership?.ai_access ?? "none";
  return can(role, action, aiAccess);
}

/**
 * Resolve contract-defined action state (hidden / disabled_visible / enabled)
 * from the authority seam. Accepts optional overrides for future Advanced permissions.
 */
export function seamResolveActionState(
  seam: ProjectAuthoritySeam,
  domain: ContractDomain,
  action: ContractAction,
  overrides?: PermissionOverrides,
): ActionState {
  const role = getProjectRole(seam);
  return resolveActionState(role, domain, action as never, overrides);
}

/**
 * Backend-aligned UX gate for “sensitive detail” module visibility.
 *
 * Backend RLS uses `public.can_view_sensitive_detail(project_id)`, which is derived
 * from `effective_finance_visibility(project_id)` and therefore:
 * - owner always has access, even when the owner membership row has not hydrated yet
 * - others have access iff their stored `finance_visibility` is `detail`
 *
 * Phase 6.1 must fail closed:
 * - when membership is unknown for non-owners return `false`
 * - when `finance_visibility` is missing or unknown return `false`
 */
export function seamCanViewSensitiveDetail(seam: ProjectAuthoritySeam): boolean {
  if (getProjectRole(seam) === "owner") return true;
  if (!seam.membership) return false;

  const financeVisibility = seam.membership.finance_visibility;
  if (financeVisibility == null) return false;

  return financeVisibility === "detail";
}

/**
 * Backend-aligned gate for loading non-money procurement/estimate rows via operational summary RPCs.
 * Matches `effective_finance_visibility in ('summary','detail')` for non-owners; owner always true.
 */
export function seamCanViewOperationalFinanceSummary(seam: ProjectAuthoritySeam): boolean {
  if (getProjectRole(seam) === "owner") return true;
  if (!seam.membership) return false;

  const financeVisibility = seam.membership.finance_visibility;
  if (financeVisibility == null) return false;

  return financeVisibility === "summary" || financeVisibility === "detail";
}

/**
 * Gate for loading operational domain semantics (resource types, titles, status)
 * without requiring any finance visibility. True for any authenticated project member.
 * After DB migration widens RPCs for visibility = none, this enables hydration
 * of non-money fields for all roles.
 */
export function seamCanLoadOperationalSemantics(seam: ProjectAuthoritySeam): boolean {
  if (getProjectRole(seam) === "owner") return true;
  return Boolean(seam.membership);
}

/** Mirrors `effective_finance_visibility` semantics for estimate UI (detail vs summary vs none). */
export type EstimateFinanceVisibilityMode = "detail" | "summary" | "none";

export function seamEstimateFinanceVisibilityMode(seam: ProjectAuthoritySeam): EstimateFinanceVisibilityMode {
  if (seamCanViewSensitiveDetail(seam)) return "detail";
  if (seamCanViewOperationalFinanceSummary(seam)) return "summary";
  return "none";
}

/** Estimate CSV export — owner/co_owner only, per `ESTIMATE_PRESETS.export_csv`. */
export function seamAllowsEstimateExportCsv(seam: ProjectAuthoritySeam): boolean {
  const role = getProjectRole(seam);
  return role === "owner" || role === "co_owner";
}

/** How Supabase row loads should hydrate money-bearing tables vs operational RPCs. */
export type FinanceRowLoadAccess = "full" | "operational_summary" | "none";

export function resolveFinanceRowLoadAccess(seam: ProjectAuthoritySeam): FinanceRowLoadAccess {
  if (seamCanViewSensitiveDetail(seam)) return "full";
  if (seamCanViewOperationalFinanceSummary(seam)) return "operational_summary";
  if (seamCanLoadOperationalSemantics(seam)) return "operational_summary";
  return "none";
}

/**
 * Demo/local auth simulator: overlay simulated role on the seam.
 *
 * Finance visibility:
 * - Same simulated role as the membership row: use stored value or that role’s default.
 * - Different role: if stored visibility differs from the **actual** role’s default, treat it as an
 *   explicit grant and keep it (e.g. owner row with `summary` while previewing as contractor).
 *   Otherwise use the simulated role’s default so owner `detail` is not carried into viewer/contractor
 *   preview (fail-safe for `seamCanViewSensitiveDetail`).
 */
export function applyWorkspaceDemoOverlayToSeam(
  seam: ProjectAuthoritySeam,
  workspaceMode: WorkspaceModeState,
): ProjectAuthoritySeam {
  if (workspaceMode.kind !== "demo" && workspaceMode.kind !== "local") {
    return seam;
  }

  const simulatedRoleRaw = getAuthRole();
  if (simulatedRoleRaw === "guest" || !seam.membership) {
    return seam;
  }

  const simulatedRole = simulatedRoleRaw as MemberRole;
  const actualRole = seam.membership.role;
  const storedFv = seam.membership.finance_visibility;
  const actualDefaultFv = getDefaultFinanceVisibility(actualRole);
  const simDefaultFv = getDefaultFinanceVisibility(simulatedRole);

  let finance_visibility: FinanceVisibility;
  if (simulatedRole === actualRole) {
    finance_visibility = storedFv ?? simDefaultFv;
  } else if (storedFv == null) {
    finance_visibility = simDefaultFv;
  } else if (storedFv !== actualDefaultFv) {
    finance_visibility = storedFv;
  } else {
    finance_visibility = simDefaultFv;
  }

  return {
    ...seam,
    membership: {
      ...seam.membership,
      role: simulatedRole,
      finance_visibility,
    },
  };
}

export function usePermission(projectId: string) {
  const user = useWorkspaceCurrentUser();
  const workspaceMode = useWorkspaceMode();
  const { members, isLoading: isMembersLoading } = useWorkspaceProjectMembersState(projectId);
  const { project, isLoading: isProjectLoading } = useWorkspaceProjectState(projectId);

  const seam = useMemo(
    () =>
      buildProjectAuthoritySeam({
        projectId,
        profileId: user.id,
        members,
        project,
      }),
    [projectId, user.id, members, project],
  );

  const effectiveSeam = useMemo(
    () => applyWorkspaceDemoOverlayToSeam(seam, workspaceMode),
    [seam, workspaceMode.kind],
  );

  return {
    seam: effectiveSeam,
    can: (action: Action) => seamAllowsAction(effectiveSeam, action),
    /** Resolve contract action state (hidden / disabled_visible / enabled). */
    actionState: (domain: ContractDomain, action: ContractAction, overrides?: PermissionOverrides) =>
      seamResolveActionState(effectiveSeam, domain, action, overrides),
    role: getProjectRole(effectiveSeam),
    isLoading: isMembersLoading || isProjectLoading,
  };
}
