import type {
  AIAccess,
  FinanceVisibility,
  InternalDocsVisibility,
  MemberRole,
  ViewerRegime,
} from "@/types/entities";

// All label maps now hold i18n keys. Callers must translate via useTranslation's t().
export const roleLabels: Record<MemberRole, string> = {
  owner: "participants.role.owner",
  co_owner: "participants.role.coOwner",
  contractor: "participants.role.contractor",
  viewer: "participants.role.viewer",
};

export const roleDescriptions: Record<MemberRole, string> = {
  owner: "participants.roleDescription.owner",
  co_owner: "participants.roleDescription.coOwner",
  contractor: "participants.roleDescription.contractor",
  viewer: "participants.roleDescription.viewer",
};

export const aiAccessLabels: Record<AIAccess, string> = {
  none: "participants.aiAccess.none",
  consult_only: "participants.aiAccess.consultOnly",
  project_pool: "participants.aiAccess.projectPool",
};

export const financeVisibilityLabels: Record<FinanceVisibility, string> = {
  none: "participants.financeVisibility.none",
  summary: "participants.financeVisibility.summary",
  detail: "participants.financeVisibility.detail",
};

export const internalDocsVisibilityLabels: Record<InternalDocsVisibility, string> = {
  none: "participants.internalDocs.none",
  view: "participants.internalDocs.view",
  edit: "participants.internalDocs.edit",
};

export const viewerRegimeLabels: Record<ViewerRegime, string> = {
  contractor: "participants.viewerRegime.contractor",
  client: "participants.viewerRegime.client",
  build_myself: "participants.viewerRegime.buildMyself",
};

export const MEMBER_INVITE_ROLES: readonly MemberRole[] = ["co_owner", "contractor", "viewer"];

const INVITE_ROLE_OPTIONS_BY_ACTOR: Record<MemberRole, MemberRole[]> = {
  owner: ["co_owner", "contractor", "viewer"],
  co_owner: ["contractor", "viewer"],
  contractor: [],
  viewer: [],
};

export const AI_ACCESS_RANK: readonly AIAccess[] = ["none", "consult_only", "project_pool"];
export const FINANCE_VISIBILITY_RANK: readonly FinanceVisibility[] = ["none", "summary", "detail"];
export const INTERNAL_DOCS_VISIBILITY_RANK: readonly InternalDocsVisibility[] = ["none", "view", "edit"];

export type PermissionSummaryInput = {
  role: MemberRole;
  aiAccess: AIAccess;
  financeVisibility?: FinanceVisibility;
  internalDocsVisibility?: InternalDocsVisibility;
  viewerRegime?: ViewerRegime | null;
};

export type NonStandardAccessSummary = {
  title: string;
  lines: string[];
};

// Minimal translator signature — matches react-i18next's t() without requiring an import
// that would add coupling between the policy module and i18n infrastructure at type-check time.
export type Translator = (key: string, options?: Record<string, unknown>) => string;

export function getInviteRoleOptions(actorRole: MemberRole): MemberRole[] {
  return INVITE_ROLE_OPTIONS_BY_ACTOR[actorRole];
}

export function getReassignRoleOptions(
  actorRole: MemberRole,
  targetCurrentRole: MemberRole,
): MemberRole[] {
  if (targetCurrentRole === "owner") return [];

  if (actorRole === "owner") return ["co_owner", "contractor", "viewer"];

  if (actorRole === "co_owner") {
    return targetCurrentRole === "contractor" || targetCurrentRole === "viewer"
      ? ["contractor", "viewer"]
      : [];
  }

  return [];
}

export function canEditParticipantRole(actorRole: MemberRole, targetCurrentRole: MemberRole): boolean {
  return getReassignRoleOptions(actorRole, targetCurrentRole).length > 0;
}

export function getInviteAiAccessOptions(actorAiAccess: AIAccess): AIAccess[] {
  return sliceRank(AI_ACCESS_RANK, actorAiAccess, ["none"]);
}

export function getFinanceVisibilityOptions(
  actorRole: MemberRole,
  actorFinanceVisibility?: FinanceVisibility,
): FinanceVisibility[] {
  const caps = getActorDelegateCaps({ role: actorRole, financeVisibility: actorFinanceVisibility });
  return sliceRank(FINANCE_VISIBILITY_RANK, caps.financeVisibility, ["none"]);
}

export function getInternalDocsVisibilityOptions(
  actorRole: MemberRole,
  actorInternalDocsVisibility?: InternalDocsVisibility,
): InternalDocsVisibility[] {
  const caps = getActorDelegateCaps({ role: actorRole, internalDocsVisibility: actorInternalDocsVisibility });
  return sliceRank(INTERNAL_DOCS_VISIBILITY_RANK, caps.internalDocsVisibility, ["none"]);
}

export function describePermissionSummary(input: PermissionSummaryInput, t: Translator): string[] {
  const summary = [
    t(roleDescriptions[input.role]),
    t("participants.summary.ai", { value: t(aiAccessLabels[input.aiAccess]) }),
    t("participants.summary.finance", { value: t(financeVisibilityLabels[input.financeVisibility ?? "none"]) }),
    t("participants.summary.internalDocs", { value: t(internalDocsVisibilityLabels[input.internalDocsVisibility ?? "none"]) }),
  ];

  if (input.role === "viewer") {
    summary.push(t("participants.summary.viewerRegime", { value: t(viewerRegimeLabels[input.viewerRegime ?? "client"]) }));
  }

  return summary;
}

export function getPermissionWarnings(input: PermissionSummaryInput, t: Translator): string[] {
  const warnings: string[] = [];
  const financeVisibility = input.financeVisibility ?? getDefaultFinanceVisibility(input.role);

  if (input.role === "viewer" && financeVisibility !== getDefaultFinanceVisibility("viewer")) {
    warnings.push(t("participants.warning.viewerNonStandard1"));
    warnings.push(t("participants.warning.viewerNonStandard2"));
    warnings.push(t("participants.warning.viewerNonStandard3"));
    return warnings;
  }

  if (input.role === "contractor" && financeVisibility !== getDefaultFinanceVisibility("contractor")) {
    warnings.push(t("participants.warning.contractorNonStandard1"));
    warnings.push(t("participants.warning.contractorNonStandard2"));
    warnings.push(t("participants.warning.contractorNonStandard3"));
    return warnings;
  }

  if (input.role === "co_owner") {
    warnings.push(t("participants.warning.coOwnerManage"));
  }

  if (input.aiAccess === "project_pool") {
    warnings.push(t("participants.warning.aiProjectPool"));
  }

  if (financeVisibility === "detail") {
    warnings.push(t("participants.warning.financeDetail"));
  }

  if ((input.internalDocsVisibility ?? "none") === "edit") {
    warnings.push(t("participants.warning.docsEdit"));
  }

  return warnings;
}

export function getDefaultFinanceVisibility(role: MemberRole): FinanceVisibility {
  if (role === "owner" || role === "co_owner") return "detail";
  return "none";
}

export function getDefaultInternalDocsVisibility(role: MemberRole): InternalDocsVisibility {
  // Owner mirrors `handle_project_owner_membership`, which force-sets the
  // owner membership row to internal_docs_visibility='edit'.
  if (role === "owner") return "edit";
  return role === "viewer" ? "none" : "view";
}

export function getDefaultAiAccess(role: MemberRole): AIAccess {
  if (role === "owner" || role === "co_owner") return "project_pool";
  if (role === "contractor") return "consult_only";
  return "none";
}

// ---------------------------------------------------------------------------
// Delegation caps — mirror of `assert_project_participant_delegate_ok` and the
// `actor_*_delegate_cap` SQL helpers (rovno-db 20260324140000 + 20260325100000).
// The DB enforces these in BEFORE INSERT/UPDATE triggers on project_members and
// project_invites; the client cannot call the assert directly, so this mirror
// is what keeps the UI from offering writes the DB will reject (PRD P0-8).
// ---------------------------------------------------------------------------

export type ActorDelegationContext = {
  role: MemberRole;
  aiAccess?: AIAccess;
  financeVisibility?: FinanceVisibility;
  internalDocsVisibility?: InternalDocsVisibility;
};

export type ParticipantAxisValues = {
  aiAccess: AIAccess;
  financeVisibility: FinanceVisibility;
  internalDocsVisibility: InternalDocsVisibility;
};

export type DelegateCaps = {
  aiAccess: AIAccess;
  financeVisibility: FinanceVisibility;
  internalDocsVisibility: InternalDocsVisibility;
};

/**
 * The highest value of each axis the actor may grant to someone else.
 *
 * Deliberate SQL asymmetry, preserved exactly: a co_owner whose stored finance
 * visibility is `none` is floored to `summary` (and internal docs to `view`),
 * but the AI axis has NO floor — a co_owner with ai_access='none' cannot grant
 * any AI access. Do not symmetrize.
 */
export function getActorDelegateCaps(actor: ActorDelegationContext): DelegateCaps {
  if (actor.role === "owner") {
    return { aiAccess: "project_pool", financeVisibility: "detail", internalDocsVisibility: "edit" };
  }

  const finance = actor.financeVisibility ?? "none";
  const docs = actor.internalDocsVisibility ?? "none";
  const isCoOwner = actor.role === "co_owner";

  return {
    aiAccess: actor.aiAccess ?? "none",
    financeVisibility: isCoOwner && finance === "none" ? "summary" : finance,
    internalDocsVisibility: isCoOwner && docs === "none" ? "view" : docs,
  };
}

function rankOf<T extends string>(rank: readonly T[], value: T): number {
  return rank.indexOf(value);
}

/**
 * True when every axis value is within the actor's delegate caps — i.e. the
 * delegation trigger would accept a row carrying these values. Note the DB
 * re-runs the check on ANY project_invites UPDATE (including a status-only
 * revoke) and on any project_members UPDATE that touches a delegated column,
 * validating the row's FINAL values against the ACTOR's caps.
 */
export function axesWithinDelegateCaps(
  actor: ActorDelegationContext,
  axes: ParticipantAxisValues,
): boolean {
  const caps = getActorDelegateCaps(actor);
  return (
    rankOf(AI_ACCESS_RANK, axes.aiAccess) <= rankOf(AI_ACCESS_RANK, caps.aiAccess)
    && rankOf(FINANCE_VISIBILITY_RANK, axes.financeVisibility) <= rankOf(FINANCE_VISIBILITY_RANK, caps.financeVisibility)
    && rankOf(INTERNAL_DOCS_VISIBILITY_RANK, axes.internalDocsVisibility) <= rankOf(INTERNAL_DOCS_VISIBILITY_RANK, caps.internalDocsVisibility)
  );
}

/**
 * Mirror of the role part of `assert_project_participant_delegate_ok` for a
 * target role value: what the actor may assign at all.
 */
export function canActorAssignRole(actorRole: MemberRole, targetRole: MemberRole): boolean {
  if (targetRole === "owner") return false;
  if (actorRole === "owner") return true;
  if (actorRole === "co_owner") return targetRole === "contractor" || targetRole === "viewer";
  return false;
}

/**
 * Member removal is DELETE on project_members: RLS allows ONLY the project
 * owner, and never for the owner's own row (rovno-db 20260325133000). There is
 * no self-leave path in the DB.
 */
export function canRemoveMember(actorRole: MemberRole, targetRole: MemberRole): boolean {
  return actorRole === "owner" && targetRole !== "owner";
}

/**
 * Invite revocation is UPDATE status='revoked' under `can_manage_project`
 * (owner/co_owner), but the delegation trigger re-runs on every UPDATE with the
 * row's final values — so a co_owner cannot revoke a co_owner invite, nor an
 * invite whose axes exceed the co_owner's own delegate caps.
 */
export function canRevokeInvite(
  actor: ActorDelegationContext,
  invite: { role: MemberRole } & ParticipantAxisValues,
): boolean {
  if (actor.role === "owner") return true;
  if (actor.role !== "co_owner") return false;
  if (!canActorAssignRole(actor.role, invite.role)) return false;
  return axesWithinDelegateCaps(actor, invite);
}

export function hasNonStandardSupportedAccess(input: Pick<PermissionSummaryInput, "role" | "financeVisibility">): boolean {
  if (input.role !== "viewer" && input.role !== "contractor") return false;
  return (input.financeVisibility ?? getDefaultFinanceVisibility(input.role)) !== getDefaultFinanceVisibility(input.role);
}

export function getNonStandardAccessSummary(
  input: Pick<PermissionSummaryInput, "role" | "financeVisibility">,
  t: Translator,
): NonStandardAccessSummary | null {
  if (!hasNonStandardSupportedAccess(input)) return null;

  if (input.role === "viewer") {
    return {
      title: t("participants.nonStandard.viewer.title"),
      lines: [t("participants.nonStandard.viewer.line1")],
    };
  }

  if (input.role === "contractor") {
    return {
      title: t("participants.nonStandard.contractor.title"),
      lines: [t("participants.nonStandard.contractor.line1")],
    };
  }

  return null;
}

function sliceRank<T extends string>(rank: readonly T[], current: T, fallback: T[]): T[] {
  const maxIndex = rank.indexOf(current);
  if (maxIndex < 0) return fallback;
  return rank.slice(0, maxIndex + 1);
}
