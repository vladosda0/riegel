import {
  getProjectDomainAccessForRole,
  type ProjectDomain,
  type ProjectDomainAccess,
} from "@/lib/permissions";
import {
  getDefaultAiAccess,
  getDefaultFinanceVisibility,
  getDefaultInternalDocsVisibility,
  type ParticipantAxisValues,
} from "@/lib/participant-role-policy";
import type {
  FinanceVisibility,
  InternalDocsVisibility,
  MemberRole,
} from "@/types/entities";

/**
 * Live "what will this person see" summary for the participant drawer (PRD P0-3).
 *
 * Derived from the same sources the app itself uses to gate UI:
 * - `getProjectDomainAccessForRole` for per-domain route/manage access,
 * - the three participant axes (finance / internal docs / AI) resolved through
 *   the SQL-mirroring `effective*` helpers below.
 * Pure module — UI translates `labelKey`/`detailKey` via i18n.
 */

export type ParticipantAxes = ParticipantAxisValues;

export type AccessPreviewState = "edits" | "views" | "hidden";

export type AccessPreviewItem = {
  key: string;
  labelKey: string;
  state: AccessPreviewState;
  /**
   * Overrides the generic state badge text ("views"/"edits"/"hidden") when the
   * domain has more precise wording — e.g. the AI row says "Консультации" /
   * "Полный доступ" instead of the nonsensical "Только видит".
   */
  stateLabelKey?: string;
  /** Optional qualifier shown next to the state (e.g. finance level, AI limit). */
  detailKey?: string;
  detailParams?: Record<string, unknown>;
};

/**
 * Mirror of SQL `effective_finance_visibility` (rovno-db 20260325100000):
 * owner is always `detail`; a co_owner whose stored value is `none`/missing is
 * floored to `summary`; everyone else falls back to `none` when unset. This is
 * what RLS actually returns, so the preview and gates must use it (P1-2).
 */
export function effectiveFinanceVisibility(
  role: MemberRole,
  stored: FinanceVisibility | undefined,
): FinanceVisibility {
  if (role === "owner") return "detail";
  const value = stored ?? "none";
  if (role === "co_owner" && value === "none") return "summary";
  return value;
}

/**
 * Mirror of SQL `effective_internal_docs_visibility`: owner → `edit`,
 * co_owner `none`/missing → `view`, else stored (`none` fallback). The AI axis
 * deliberately has NO such floor in SQL — do not add one.
 */
export function effectiveInternalDocsVisibility(
  role: MemberRole,
  stored: InternalDocsVisibility | undefined,
): InternalDocsVisibility {
  if (role === "owner") return "edit";
  const value = stored ?? "none";
  if (role === "co_owner" && value === "none") return "view";
  return value;
}

function domainState(access: ProjectDomainAccess): AccessPreviewState {
  switch (access) {
    case "manage":
    case "contribute":
      return "edits";
    case "view":
    case "summary":
      return "views";
    default:
      return "hidden";
  }
}

/** Operational domains shown in the preview, reusing the project-tab labels. */
const PREVIEW_DOMAINS: ReadonlyArray<{ domain: ProjectDomain; labelKey: string }> = [
  { domain: "estimate", labelKey: "projectTabs.estimate" },
  { domain: "tasks", labelKey: "projectTabs.tasks" },
  { domain: "procurement", labelKey: "projectTabs.procurement" },
  { domain: "hr", labelKey: "projectTabs.hr" },
  { domain: "documents", labelKey: "projectTabs.documents" },
  { domain: "gallery", labelKey: "projectTabs.gallery" },
];

export function computeAccessPreview(input: {
  role: MemberRole;
  axes: ParticipantAxes;
}): AccessPreviewItem[] {
  const { role, axes } = input;
  const items: AccessPreviewItem[] = PREVIEW_DOMAINS.map(({ domain, labelKey }) => ({
    key: domain,
    labelKey,
    state: domainState(getProjectDomainAccessForRole(role, domain)),
  }));

  const finance = effectiveFinanceVisibility(role, axes.financeVisibility);
  items.push({
    key: "money",
    labelKey: "participants.preview.money",
    state: finance === "none"
      ? "hidden"
      : finance === "detail" && (role === "owner" || role === "co_owner")
        ? "edits"
        : "views",
    ...(finance !== "none"
      ? { detailKey: `participants.preview.moneyLevel.${finance}` }
      : {}),
  });

  const docs = effectiveInternalDocsVisibility(role, axes.internalDocsVisibility);
  items.push({
    key: "internalDocs",
    labelKey: "participants.preview.internalDocs",
    state: docs === "edit" ? "edits" : docs === "view" ? "views" : "hidden",
  });

  // The AI row gets its own badge wording: the person USES the assistant, so
  // "views/edits" would mislead. consult_only → «Консультации», project_pool →
  // «Полный доступ» (state drives only color/icon). No limit line: credit_limit
  // has no reader (rovno-db 20260522130400_create_usage_rpcs.sql meters the
  // member's own subscription instead), so naming a number here promised an
  // enforcement that does not exist (rovno#301).
  items.push({
    key: "ai",
    labelKey: "participants.preview.ai",
    state: axes.aiAccess === "none" ? "hidden" : axes.aiAccess === "project_pool" ? "edits" : "views",
    ...(axes.aiAccess === "consult_only"
      ? { stateLabelKey: "participants.preview.aiState.consult" }
      : {}),
    ...(axes.aiAccess === "project_pool"
      ? { stateLabelKey: "participants.preview.aiState.full" }
      : {}),
  });

  items.push({
    key: "participants",
    labelKey: "projectTabs.participants",
    state: domainState(getProjectDomainAccessForRole(role, "participants")),
  });

  return items;
}

// ---------------------------------------------------------------------------
// Manual configuration detection (PRD P0-7)
// ---------------------------------------------------------------------------

export type AxisKey = keyof ParticipantAxes;

export function getRoleAxisDefaults(role: MemberRole): ParticipantAxes {
  return {
    aiAccess: getDefaultAiAccess(role),
    financeVisibility: getDefaultFinanceVisibility(role),
    internalDocsVisibility: getDefaultInternalDocsVisibility(role),
  };
}

/** Axes that differ from the role preset — drives the "настроено вручную" badge. */
export function listManualAxisDeviations(role: MemberRole, axes: ParticipantAxes): AxisKey[] {
  const defaults = getRoleAxisDefaults(role);
  return (Object.keys(defaults) as AxisKey[]).filter((key) => axes[key] !== defaults[key]);
}

export function hasManualAxisConfig(role: MemberRole, axes: ParticipantAxes): boolean {
  return listManualAxisDeviations(role, axes).length > 0;
}

// ---------------------------------------------------------------------------
// Sensitive-grant confirmation (PRD P0-4)
// ---------------------------------------------------------------------------

export type SensitiveGrant = "finance_detail" | "docs_edit";

/**
 * Which sensitive grants require an explicit confirmation before saving.
 *
 * Confirmation fires only for contractor/viewer (owner/co_owner hold these by
 * role design) and only when the value is being RAISED relative to `baseline`
 * (the saved record, or the role defaults for a brand-new invite). Re-saving
 * an unchanged record does not nag.
 */
export function listSensitiveGrantsRequiringConfirmation(input: {
  role: MemberRole;
  axes: ParticipantAxes;
  baseline?: ParticipantAxes;
}): SensitiveGrant[] {
  const { role, axes } = input;
  if (role !== "contractor" && role !== "viewer") return [];

  const baseline = input.baseline ?? getRoleAxisDefaults(role);
  const grants: SensitiveGrant[] = [];

  if (axes.financeVisibility === "detail" && baseline.financeVisibility !== "detail") {
    grants.push("finance_detail");
  }
  if (axes.internalDocsVisibility === "edit" && baseline.internalDocsVisibility !== "edit") {
    grants.push("docs_edit");
  }

  return grants;
}
