/**
 * Contract-driven action state resolution.
 *
 * The preset tables below ARE the permission contract. `docs/permissions.contract.json`
 * and `Permissions.md` were removed in 9b4c292 and nothing replaced them, so editing a
 * preset cell here changes the product rule directly WHEREVER THAT CELL IS READ.
 *
 * That qualifier is load-bearing, because six of the sixteen cells are read by
 * nothing in production today: `edit_estimate_structure`, `export_csv`,
 * `edit_checklist`, `upload_document`, `upload_media` and `classify` appear only in
 * their type unions, in the tables below, and in a self-referential expectation
 * table in `permissions.test.tsx`. Editing one of those is a no-op until a call
 * site reads it, and the golden test will still go red, which makes the no-op look
 * like a real change. See rovno#241. The cells that ARE live:
 * estimate/`edit_estimate_rows`, tasks/{`manage_tasks`,`comment`,`change_status`},
 * procurement/{`order`,`receive`,`use_from_stock`},
 * documents_media/{`upload`,`delete`,`rename_or_archive`}.
 *
 * This module maps (role, domain, action) → ActionState using preset defaults.
 * It replaces ad-hoc boolean checks wherever a surface needs
 * hidden / disabled_visible / enabled.
 *
 * The resolver accepts an optional `overrides` parameter (forward-compatible
 * stub for future Advanced permissions). When undefined, preset behavior is
 * used unchanged.
 */

import type { MemberRole } from "@/types/entities";

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

export type ActionState = "hidden" | "disabled_visible" | "enabled";

// ---------------------------------------------------------------------------
// Contract action keys — the bounded set of actions each domain exposes
// ---------------------------------------------------------------------------

export type EstimateAction = "edit_estimate_rows" | "edit_estimate_structure" | "export_csv";
export type TaskAction = "change_status" | "edit_checklist" | "comment" | "upload_document" | "upload_media" | "manage_tasks";
export type ProcurementAction = "order" | "receive" | "use_from_stock";

/**
 * Documents/media actions.
 *
 * `upload` = contribute-level (shared_project by default; internal gated separately
 *   by `canViewInternalDocuments` at call sites — Option 1 keeps view/edit equivalent).
 * `delete`, `rename_or_archive`, `classify` = manage-level.
 */
export type DocumentsMediaAction = "upload" | "delete" | "rename_or_archive" | "classify";

export type ContractAction = EstimateAction | TaskAction | ProcurementAction | DocumentsMediaAction;

export type ContractDomain = "estimate" | "tasks" | "procurement" | "documents_media";

// ---------------------------------------------------------------------------
// Preset tables — the canonical per-role action states
// ---------------------------------------------------------------------------

const ESTIMATE_PRESETS: Record<MemberRole, Record<EstimateAction, ActionState>> = {
  owner:      { edit_estimate_rows: "enabled",  edit_estimate_structure: "enabled",  export_csv: "enabled" },
  co_owner:   { edit_estimate_rows: "enabled",  edit_estimate_structure: "enabled",  export_csv: "enabled" },
  contractor: { edit_estimate_rows: "hidden",   edit_estimate_structure: "hidden",   export_csv: "hidden" },
  viewer:     { edit_estimate_rows: "hidden",   edit_estimate_structure: "hidden",   export_csv: "hidden" },
};

const TASK_PRESETS: Record<MemberRole, Record<TaskAction, ActionState>> = {
  owner:      { change_status: "enabled", edit_checklist: "enabled", comment: "enabled", upload_document: "enabled", upload_media: "enabled", manage_tasks: "enabled" },
  co_owner:   { change_status: "enabled", edit_checklist: "enabled", comment: "enabled", upload_document: "enabled", upload_media: "enabled", manage_tasks: "enabled" },
  contractor: { change_status: "enabled", edit_checklist: "enabled", comment: "enabled", upload_document: "enabled", upload_media: "enabled", manage_tasks: "hidden" },
  viewer:     { change_status: "hidden",  edit_checklist: "hidden",  comment: "hidden",  upload_document: "hidden",  upload_media: "hidden",  manage_tasks: "hidden" },
};

const PROCUREMENT_PRESETS: Record<MemberRole, Record<ProcurementAction, ActionState>> = {
  owner:      { order: "enabled",          receive: "enabled",          use_from_stock: "enabled" },
  co_owner:   { order: "enabled",          receive: "enabled",          use_from_stock: "enabled" },
  contractor: { order: "disabled_visible", receive: "disabled_visible", use_from_stock: "disabled_visible" },
  viewer:     { order: "hidden",           receive: "hidden",           use_from_stock: "hidden" },
};

const DOCUMENTS_MEDIA_PRESETS: Record<MemberRole, Record<DocumentsMediaAction, ActionState>> = {
  owner:      { upload: "enabled", delete: "enabled", rename_or_archive: "enabled", classify: "enabled" },
  co_owner:   { upload: "enabled", delete: "enabled", rename_or_archive: "enabled", classify: "enabled" },
  contractor: { upload: "enabled", delete: "hidden",  rename_or_archive: "hidden",  classify: "hidden" },
  viewer:     { upload: "hidden",  delete: "hidden",  rename_or_archive: "hidden",  classify: "hidden" },
};

type DomainPresetMap = {
  estimate: Record<MemberRole, Record<EstimateAction, ActionState>>;
  tasks: Record<MemberRole, Record<TaskAction, ActionState>>;
  procurement: Record<MemberRole, Record<ProcurementAction, ActionState>>;
  documents_media: Record<MemberRole, Record<DocumentsMediaAction, ActionState>>;
};

const DOMAIN_PRESETS: DomainPresetMap = {
  estimate: ESTIMATE_PRESETS,
  tasks: TASK_PRESETS,
  procurement: PROCUREMENT_PRESETS,
  documents_media: DOCUMENTS_MEDIA_PRESETS,
};

// ---------------------------------------------------------------------------
// Override types (stub — no persistence, no UI in this track)
// ---------------------------------------------------------------------------

/**
 * Forward-compatible override shape for Advanced permissions.
 * Each key is optional; when present it overrides the preset default.
 *
 * Constraints (enforced by future UI, not by this resolver):
 * - Overrides must not violate `forbidden_forever` rules per contract.
 * - Overrides must not exceed the acting user's own authority.
 * - Backend enforcement remains authoritative regardless of frontend overrides.
 */
export type PermissionOverrides = {
  estimate?: Partial<Record<EstimateAction, ActionState>>;
  tasks?: Partial<Record<TaskAction, ActionState>>;
  procurement?: Partial<Record<ProcurementAction, ActionState>>;
  documents_media?: Partial<Record<DocumentsMediaAction, ActionState>>;
};

// ---------------------------------------------------------------------------
// Resolver
// ---------------------------------------------------------------------------

export function resolveActionState(
  role: MemberRole,
  domain: "estimate",
  action: EstimateAction,
  overrides?: PermissionOverrides,
): ActionState;
export function resolveActionState(
  role: MemberRole,
  domain: "tasks",
  action: TaskAction,
  overrides?: PermissionOverrides,
): ActionState;
export function resolveActionState(
  role: MemberRole,
  domain: "procurement",
  action: ProcurementAction,
  overrides?: PermissionOverrides,
): ActionState;
export function resolveActionState(
  role: MemberRole,
  domain: "documents_media",
  action: DocumentsMediaAction,
  overrides?: PermissionOverrides,
): ActionState;
/**
 * Generic-dispatch overload: `domain` as a union matches none of the specific
 * overloads, so dynamic callers must cast `action as never` (nothing but a cast
 * reaches `never`, so per-domain call sites keep full checking).
 */
export function resolveActionState(
  role: MemberRole,
  domain: ContractDomain,
  action: never,
  overrides?: PermissionOverrides,
): ActionState;
export function resolveActionState(
  role: MemberRole,
  domain: ContractDomain,
  action: ContractAction,
  overrides?: PermissionOverrides,
): ActionState {
  const domainOverrides = overrides?.[domain] as Record<string, ActionState> | undefined;
  if (domainOverrides?.[action] != null) {
    return domainOverrides[action];
  }
  const presets = DOMAIN_PRESETS[domain] as Record<MemberRole, Record<string, ActionState>>;
  return presets[role]?.[action] ?? "hidden";
}

// ---------------------------------------------------------------------------
// Convenience: boolean bridge for callers that still need can-style checks
// ---------------------------------------------------------------------------

/** True only when the resolved state is `enabled`. Strict — disabled_visible is NOT allowed. */
export function isActionEnabled(
  role: MemberRole,
  domain: ContractDomain,
  action: ContractAction,
  overrides?: PermissionOverrides,
): boolean {
  return resolveActionState(role, domain, action as never, overrides) === "enabled";
}

// ---------------------------------------------------------------------------
// UI rendering helper
// ---------------------------------------------------------------------------

export type ActionControlProps = {
  /** Whether the control should render at all. */
  visible: boolean;
  /** Whether the control is interactive. */
  disabled: boolean;
  /** Tooltip / title for disabled controls. Undefined when enabled or hidden. */
  disabledReason: string | undefined;
};

/**
 * Map an ActionState to render-time props for buttons / checkboxes / menu items.
 *
 * - `hidden`          → `{ visible: false, disabled: true }`
 * - `disabled_visible` → `{ visible: true,  disabled: true, disabledReason }`
 * - `enabled`         → `{ visible: true,  disabled: false }`
 */
export function actionStateToControlProps(
  state: ActionState,
  opts?: { disabledReason?: string },
): ActionControlProps {
  switch (state) {
    case "hidden":
      return { visible: false, disabled: true, disabledReason: undefined };
    case "disabled_visible":
      return {
        visible: true,
        disabled: true,
        disabledReason: opts?.disabledReason ?? "This action is not available for your role.",
      };
    case "enabled":
      return { visible: true, disabled: false, disabledReason: undefined };
  }
}
