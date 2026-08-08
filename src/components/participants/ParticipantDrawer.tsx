import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Crown, Eye, Info, Lock, RotateCcw, Send, Shield, SlidersHorizontal, Trash2, Wrench, XCircle } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ToastAction } from "@/components/ui/toast";
import { toast } from "@/hooks/use-toast";
import { useIsMobile } from "@/hooks/use-mobile";
import { trackEvent } from "@/lib/analytics";
import {
  AI_ACCESS_RANK,
  FINANCE_VISIBILITY_RANK,
  INTERNAL_DOCS_VISIBILITY_RANK,
  axesWithinDelegateCaps,
  canRemoveMember,
  canRevokeInvite,
  getActorDelegateCaps,
  getInviteRoleOptions,
  getReassignRoleOptions,
  roleDescriptions,
  roleLabels,
  type ActorDelegationContext,
} from "@/lib/participant-role-policy";
import {
  getRoleAxisDefaults,
  hasManualAxisConfig,
  listSensitiveGrantsRequiringConfirmation,
  type SensitiveGrant,
} from "@/lib/participant-access-preview";
import { AccessPreviewPanel } from "@/components/participants/AccessPreviewPanel";
import {
  AI_SEGMENT_LABELS,
  DOCS_SEGMENT_LABELS,
  FINANCE_SEGMENT_LABELS,
  buildCreateForm,
  buildFormFromRecord,
  formAxes,
  parseCreditLimit,
  recordAxes,
  resolveViewerRegime,
  seatLimitReached,
  isEditorSeatRole,
  type ParticipantFormState,
  type ParticipantRecord,
  type ProjectParticipantsMode,
  type SeatInfo,
} from "@/components/participants/participants-shared";
import type {
  AIAccess,
  FinanceVisibility,
  InternalDocsVisibility,
  MemberRole,
} from "@/types/entities";

export type ParticipantDrawerMode =
  | { kind: "create" }
  | { kind: "edit"; record: ParticipantRecord };

type ParticipantDrawerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: ParticipantDrawerMode;
  actor: ActorDelegationContext;
  projectMode: ProjectParticipantsMode;
  seat: SeatInfo;
  resendAvailable: boolean;
  /** Non-null in create mode shows the "also add to org" checkbox. */
  activeOrgName?: string | null;
  saving: boolean;
  removing: boolean;
  revoking: boolean;
  resending: boolean;
  onCreate: (input: { email: string; form: ParticipantFormState; addToOrg: boolean }) => void;
  onSave: (input: { record: ParticipantRecord; form: ParticipantFormState }) => void;
  onRemoveMember: (record: ParticipantRecord) => void;
  onRevokeInvite: (record: ParticipantRecord) => void;
  onResendInvite: (record: ParticipantRecord) => void;
};

const ROLE_CARD_ICONS: Record<MemberRole, typeof Crown> = {
  owner: Crown,
  co_owner: Shield,
  contractor: Wrench,
  viewer: Eye,
};

const ASSIGNABLE_ROLES: readonly MemberRole[] = ["co_owner", "contractor", "viewer"];

// Plain-language meaning of each axis level; shown under the segment and
// updated live so the owner understands exactly what they grant (feedback #5).
const FINANCE_HELP: Record<FinanceVisibility, string> = {
  none: "participants.axisHelp.finance.none",
  summary: "participants.axisHelp.finance.summary",
  detail: "participants.axisHelp.finance.detail",
};

const DOCS_HELP: Record<InternalDocsVisibility, string> = {
  none: "participants.axisHelp.docs.none",
  view: "participants.axisHelp.docs.view",
  edit: "participants.axisHelp.docs.edit",
};

const AI_HELP: Record<AIAccess, string> = {
  none: "participants.axisHelp.ai.none",
  consult_only: "participants.axisHelp.ai.consult_only",
  project_pool: "participants.axisHelp.ai.project_pool",
};

function rankIndex<T extends string>(rank: readonly T[], value: T): number {
  return rank.indexOf(value);
}

type AxisSegmentProps<T extends string> = {
  label: string;
  values: readonly T[];
  value: T;
  capIndex: number;
  labelFor: (value: T) => string;
  onChange: (value: T) => void;
  disabled?: boolean;
  hint?: string;
  /** Plain-language meaning of the CURRENTLY selected level (updates on switch). */
  helpText?: string;
};

function AxisSegment<T extends string>({
  label,
  values,
  value,
  capIndex,
  labelFor,
  onChange,
  disabled,
  hint,
  helpText,
}: AxisSegmentProps<T>) {
  const anyAboveCap = values.some((_, index) => index > capIndex);
  return (
    <div>
      <p className="text-caption font-medium text-foreground">{label}</p>
      <ToggleGroup
        type="single"
        value={value}
        onValueChange={(next) => {
          if (next) onChange(next as T);
        }}
        className="mt-1 grid w-full gap-1"
        style={{ gridTemplateColumns: `repeat(${values.length}, minmax(0, 1fr))` }}
      >
        {values.map((option, index) => {
          const aboveCap = index > capIndex;
          return (
            <ToggleGroupItem
              key={option}
              value={option}
              disabled={disabled || aboveCap}
              className="h-8 w-full rounded-lg border border-border bg-card px-1 text-caption text-muted-foreground data-[state=on]:border-accent data-[state=on]:bg-accent/10 data-[state=on]:font-medium data-[state=on]:text-accent"
            >
              <span className="flex items-center gap-1 truncate">
                {aboveCap && <Lock className="h-3 w-3 shrink-0" />}
                {labelFor(option)}
              </span>
            </ToggleGroupItem>
          );
        })}
      </ToggleGroup>
      {helpText && (
        <p className="mt-1.5 text-caption text-muted-foreground">{helpText}</p>
      )}
      {anyAboveCap && !disabled && (
        <p className="mt-1 text-caption text-muted-foreground">{hint}</p>
      )}
    </div>
  );
}

export function ParticipantDrawer(props: ParticipantDrawerProps) {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const {
    open,
    onOpenChange,
    mode,
    actor,
    projectMode,
    seat,
    resendAvailable,
    activeOrgName,
    saving,
    removing,
    revoking,
    resending,
  } = props;

  const isEdit = mode.kind === "edit";
  const record = isEdit ? mode.record : null;
  const modeKey = record ? record.key : "create";

  const [form, setForm] = useState<ParticipantFormState>(() => (
    record ? buildFormFromRecord(record, projectMode) : buildCreateForm(projectMode)
  ));
  const [email, setEmail] = useState("");
  const [addToOrg, setAddToOrg] = useState(false);
  const [confirmGrants, setConfirmGrants] = useState<SensitiveGrant[] | null>(null);
  // Content survives the null-out on close so the exit animation never shows
  // an empty consequences list.
  const lastGrantsRef = useRef<SensitiveGrant[]>([]);
  const confirmGrantsContent = confirmGrants ?? lastGrantsRef.current;

  useEffect(() => {
    if (!open) return;
    if (record) {
      setForm(buildFormFromRecord(record, projectMode));
    } else {
      // Default invite role is contractor, but when editor seats are already
      // at the plan cap (and viewer seats are not) starting there would only
      // lead to a blocked save — start from viewer instead (codex P2, PR #160).
      const base = buildCreateForm(projectMode);
      const editorsFull = seatLimitReached(seat.editorsUsed, seat.editorsLimit);
      const viewersFull = seatLimitReached(seat.viewersUsed, seat.viewersLimit);
      setForm(editorsFull && !viewersFull
        ? { ...base, role: "viewer", ...getRoleAxisDefaults("viewer") }
        : base);
    }
    setEmail("");
    setAddToOrg(false);
    setConfirmGrants(null);
    // record identity (modeKey), not object identity: reopening the same row resets once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, modeKey, projectMode]);

  const roleOptions = useMemo(() => (
    record
      ? getReassignRoleOptions(actor.role, record.role)
      : getInviteRoleOptions(actor.role)
  ), [actor.role, record]);

  const readOnly = Boolean(record && (record.role === "owner" || record.isSelf || roleOptions.length === 0));
  const readOnlyReasonKey = !record
    ? null
    : record.role === "owner"
      ? "participants.drawer.readOnly.owner"
      : record.isSelf
        ? "participants.drawer.readOnly.self"
        : roleOptions.length === 0
          ? "participants.drawer.readOnly.aboveLevel"
          : null;

  const caps = useMemo(() => getActorDelegateCaps(actor), [actor]);
  const axes = formAxes(form);
  const axesAllowed = axesWithinDelegateCaps(actor, axes);
  const targetName = record ? record.displayName : (email.trim() || t("participants.drawer.newParticipant"));

  const emailValid = !isEdit ? /\S+@\S+\.\S+/.test(email.trim()) : true;
  const roleAllowed = readOnly || roleOptions.includes(form.role);
  // The seat gate must also hold for the CURRENTLY selected role, not only for
  // switching cards — otherwise the default role sails past the cap on submit.
  const selectedRoleSeatBlocked = !readOnly && Boolean(seatBlockReasonFor(form.role));
  const canSubmit = !readOnly && roleAllowed && axesAllowed && emailValid
    && !selectedRoleSeatBlocked && !saving;

  function seatBlockReasonFor(role: MemberRole): string | null {
    if (!ASSIGNABLE_ROLES.includes(role)) return null;
    const becomesEditor = isEditorSeatRole(role) && (!record || !isEditorSeatRole(record.role));
    const becomesViewer = role === "viewer" && (!record || record.role !== "viewer");
    if (becomesEditor && seatLimitReached(seat.editorsUsed, seat.editorsLimit)) {
      return "participants.drawer.role.seatLimitEditors";
    }
    if (becomesViewer && seatLimitReached(seat.viewersUsed, seat.viewersLimit)) {
      return "participants.drawer.role.seatLimitViewers";
    }
    return null;
  }

  function applyRole(nextRole: MemberRole) {
    if (nextRole === form.role) return;
    const snapshot = form;
    const defaults = getRoleAxisDefaults(nextRole);
    const axesChanged = snapshot.aiAccess !== defaults.aiAccess
      || snapshot.financeVisibility !== defaults.financeVisibility
      || snapshot.internalDocsVisibility !== defaults.internalDocsVisibility;

    setForm((current) => ({
      ...current,
      role: nextRole,
      aiAccess: defaults.aiAccess,
      financeVisibility: defaults.financeVisibility,
      internalDocsVisibility: defaults.internalDocsVisibility,
      viewerRegime: resolveViewerRegime(nextRole, projectMode, current.viewerRegime) ?? current.viewerRegime,
    }));
    trackEvent("participants_role_preset_selected", { role: nextRole, context: isEdit ? "edit" : "invite" });

    if (axesChanged) {
      toast({
        title: t("participants.drawer.roleResetToast", { role: t(roleLabels[nextRole]) }),
        description: t("participants.drawer.roleResetToastDesc"),
        action: (
          <ToastAction altText={t("participants.drawer.undo")} onClick={() => setForm(snapshot)}>
            {t("participants.drawer.undo")}
          </ToastAction>
        ),
      });
    }
  }

  function resetAxesToRole() {
    const defaults = getRoleAxisDefaults(form.role);
    setForm((current) => ({ ...current, ...defaults }));
    trackEvent("participants_axes_reset_to_role", { role: form.role });
  }

  function submit() {
    if (record) {
      props.onSave({ record, form });
    } else {
      props.onCreate({ email: email.trim().toLowerCase(), form, addToOrg });
    }
  }

  function handleSaveClick() {
    if (!canSubmit) return;
    const grants = listSensitiveGrantsRequiringConfirmation({
      role: form.role,
      axes,
      baseline: record ? recordAxes(record) : undefined,
    });
    if (grants.length > 0) {
      lastGrantsRef.current = grants;
      setConfirmGrants(grants);
      trackEvent("participants_sensitive_confirm_shown", { grants: grants.join(",") });
      return;
    }
    submit();
  }

  const manualConfig = hasManualAxisConfig(form.role, axes);
  const showRemove = Boolean(
    record && record.target.kind === "member" && !record.isSelf
    && canRemoveMember(actor.role, record.role),
  );
  const showRevoke = Boolean(
    record && record.target.kind === "invite" && record.inviteStatus === "pending"
    && canRevokeInvite(actor, { role: record.role, ...recordAxes(record) }),
  );
  const showResend = Boolean(
    record && record.target.kind === "invite" && record.inviteStatus === "pending" && resendAvailable,
  );

  const grantLine = (grant: SensitiveGrant) => (
    grant === "finance_detail"
      ? t("participants.confirm.sensitive.financeDetail", { name: targetName })
      : t("participants.confirm.sensitive.docsEdit", { name: targetName })
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={isMobile ? "bottom" : "right"}
        className={`flex w-full flex-col gap-0 overflow-y-auto p-0 ${isMobile ? "h-[92dvh] rounded-t-2xl" : "sm:max-w-xl"}`}
      >
        <SheetHeader className="border-b border-border px-4 py-3 text-left sm:px-6">
          <SheetTitle className="text-h3 text-foreground">
            {record ? record.displayName : t("participants.drawer.titleCreate")}
          </SheetTitle>
          <SheetDescription className="text-caption text-muted-foreground">
            {record ? record.secondaryLabel : t("participants.drawer.descriptionCreate")}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-sp-2 px-4 py-4 sm:px-6">
          {readOnly && readOnlyReasonKey && (
            <div className="flex items-start gap-2 rounded-card border border-border/70 bg-muted/40 p-3 text-caption text-muted-foreground">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {t(readOnlyReasonKey)}
            </div>
          )}

          {!isEdit && (
            <div>
              <label className="text-caption font-medium text-foreground" htmlFor="participant-invite-email">
                {t("participants.table.email")}
              </label>
              <Input
                id="participant-invite-email"
                type="email"
                placeholder={t("participants.inviteDialog.emailPlaceholder")}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="mt-1"
              />
            </div>
          )}

          <div>
            <div className="flex items-center justify-between">
              <p className="text-caption font-medium text-foreground">{t("participants.drawer.roleTitle")}</p>
              {manualConfig && !readOnly && (
                <Badge variant="outline" className="gap-1 border-info/40 bg-info/10 text-info">
                  <SlidersHorizontal className="h-3 w-3" />
                  {t("participants.manualBadge")}
                </Badge>
              )}
            </div>
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              {(readOnly && record ? [record.role] : ASSIGNABLE_ROLES).map((role) => {
                const RoleIcon = ROLE_CARD_ICONS[role];
                const allowed = readOnly ? true : roleOptions.includes(role);
                const seatReason = readOnly ? null : seatBlockReasonFor(role);
                const disabled = readOnly || !allowed || Boolean(seatReason);
                const selected = form.role === role;
                const reasonKey = !allowed
                  ? (role === "co_owner" ? "participants.drawer.role.onlyOwnerAssignsCoOwner" : "participants.drawer.readOnly.aboveLevel")
                  : seatReason;
                return (
                  <button
                    key={role}
                    type="button"
                    disabled={disabled}
                    onClick={() => applyRole(role)}
                    aria-pressed={selected}
                    className={`rounded-card border p-3 text-left transition-colors ${
                      selected
                        ? "border-accent bg-accent/10"
                        : "border-border bg-card hover:border-accent/40"
                    } ${disabled && !selected ? "opacity-60" : ""}`}
                  >
                    <span className="flex items-center gap-1.5 text-body-sm font-medium text-foreground">
                      <RoleIcon className="h-3.5 w-3.5" />
                      {t(roleLabels[role])}
                    </span>
                    <span className="mt-1 block text-caption text-muted-foreground">
                      {t(roleDescriptions[role])}
                    </span>
                    {reasonKey && (
                      <span className="mt-1 flex items-center gap-1 text-caption text-warning">
                        <Lock className="h-3 w-3" />
                        {t(reasonKey)}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-3">
            <AxisSegment
              label={t("participants.drawer.axis.finance")}
              values={FINANCE_VISIBILITY_RANK}
              value={form.financeVisibility}
              capIndex={rankIndex(FINANCE_VISIBILITY_RANK, caps.financeVisibility)}
              labelFor={(value) => t(FINANCE_SEGMENT_LABELS[value])}
              onChange={(value) => setForm((current) => ({ ...current, financeVisibility: value }))}
              disabled={readOnly}
              hint={t("participants.drawer.aboveYourLevel")}
              helpText={t(FINANCE_HELP[form.financeVisibility])}
            />
            <AxisSegment
              label={t("participants.drawer.axis.internalDocs")}
              values={INTERNAL_DOCS_VISIBILITY_RANK}
              value={form.internalDocsVisibility}
              capIndex={rankIndex(INTERNAL_DOCS_VISIBILITY_RANK, caps.internalDocsVisibility)}
              labelFor={(value) => t(DOCS_SEGMENT_LABELS[value])}
              onChange={(value) => setForm((current) => ({ ...current, internalDocsVisibility: value }))}
              disabled={readOnly}
              hint={t("participants.drawer.aboveYourLevel")}
              helpText={t(DOCS_HELP[form.internalDocsVisibility])}
            />
            <AxisSegment
              label={t("participants.drawer.axis.ai")}
              values={AI_ACCESS_RANK}
              value={form.aiAccess}
              capIndex={rankIndex(AI_ACCESS_RANK, caps.aiAccess)}
              labelFor={(value) => t(AI_SEGMENT_LABELS[value])}
              onChange={(value) => setForm((current) => ({ ...current, aiAccess: value }))}
              disabled={readOnly}
              hint={t("participants.drawer.aboveYourLevel")}
              helpText={t(AI_HELP[form.aiAccess])}
            />

            {form.aiAccess !== "none" && (
              // All cells share one grid row: labels reserve two caption lines
              // (sm:min-h-9) so texts top-align and the inputs sit on one line
              // even when a label wraps.
              <div className="grid gap-3 sm:grid-cols-3">
                {/* The request limit joins them: project_members.credit_limit
                    has no reader, and consume_ai_credit meters the member's own
                    subscription, so an editable number promised an enforcement
                    that does not exist (rovno#301). */}
                <div>
                  <span className="flex items-start justify-between gap-1.5 text-caption font-medium text-muted-foreground sm:min-h-9">
                    {t("participants.drawer.requestsLimit")}
                    <Badge variant="outline" className="shrink-0 border-border px-1.5 py-0 text-[10px] font-medium text-muted-foreground">
                      {t("participants.drawer.soon")}
                    </Badge>
                  </span>
                  <Input
                    id="participant-credit-limit"
                    type="number"
                    disabled
                    placeholder="—"
                    className="mt-1"
                    aria-label={t("participants.drawer.requestsLimit")}
                  />
                </div>
                {/* Photo/document analysis are pool-only features; they get
                    per-member limits once shipped — the disabled fields
                    reserve the slot. Consultations use chat requests only. */}
                {form.aiAccess === "project_pool" && (
                  <>
                    <div>
                      <span className="flex items-start justify-between gap-1.5 text-caption font-medium text-muted-foreground sm:min-h-9">
                        {t("participants.drawer.photoLimit")}
                        <Badge variant="outline" className="shrink-0 border-border px-1.5 py-0 text-[10px] font-medium text-muted-foreground">
                          {t("participants.drawer.soon")}
                        </Badge>
                      </span>
                      <Input type="number" disabled placeholder="—" className="mt-1" aria-label={t("participants.drawer.photoLimit")} />
                    </div>
                    <div>
                      <span className="flex items-start justify-between gap-1.5 text-caption font-medium text-muted-foreground sm:min-h-9">
                        {t("participants.drawer.docLimit")}
                        <Badge variant="outline" className="shrink-0 border-border px-1.5 py-0 text-[10px] font-medium text-muted-foreground">
                          {t("participants.drawer.soon")}
                        </Badge>
                      </span>
                      <Input type="number" disabled placeholder="—" className="mt-1" aria-label={t("participants.drawer.docLimit")} />
                    </div>
                  </>
                )}
              </div>
            )}

            {!axesAllowed && !readOnly && (
              <p className="rounded-card border border-warning/40 bg-warning/10 p-2 text-caption text-warning">
                {t("participants.drawer.axesAboveCap")}
              </p>
            )}

            {manualConfig && !readOnly && (
              <Button type="button" variant="ghost" size="sm" className="h-8 gap-1.5 px-2" onClick={resetAxesToRole}>
                <RotateCcw className="h-3.5 w-3.5" />
                {t("participants.drawer.resetToRole")}
              </Button>
            )}
          </div>

          <AccessPreviewPanel
            name={targetName}
            role={form.role}
            axes={axes}
            creditLimit={parseCreditLimit(form.creditLimit)}
          />

          {!isEdit && activeOrgName && (
            <label className="flex cursor-pointer items-center gap-2 text-body-sm text-foreground">
              <Checkbox checked={addToOrg} onCheckedChange={(checked) => setAddToOrg(checked === true)} />
              <span>{t("participants.invite.addToOrgLabel", { name: activeOrgName })}</span>
            </label>
          )}

          {(showResend || showRevoke || showRemove) && (
            <div className="space-y-2 border-t border-border/60 pt-3">
              {showResend && record && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-full justify-start gap-2"
                  disabled={resending}
                  onClick={() => props.onResendInvite(record)}
                >
                  <Send className="h-3.5 w-3.5" />
                  {t("participants.dropdown.resendEmail")}
                </Button>
              )}
              {showRevoke && record && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-full justify-start gap-2 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                  disabled={revoking}
                  onClick={() => props.onRevokeInvite(record)}
                >
                  <XCircle className="h-3.5 w-3.5" />
                  {t("participants.actions.revokeInvite")}
                </Button>
              )}
              {showRemove && record && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-full justify-start gap-2 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                  disabled={removing}
                  onClick={() => props.onRemoveMember(record)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {t("participants.actions.removeMember")}
                </Button>
              )}
            </div>
          )}
        </div>

        {!readOnly && (
          <div className="flex items-center justify-end gap-2 border-t border-border/60 px-4 py-3 sm:px-6">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("participants.inviteDialog.cancel")}
            </Button>
            <Button type="button" onClick={handleSaveClick} disabled={!canSubmit}>
              {isEdit
                ? (saving ? t("participants.permissionDialog.saving") : t("participants.permissionDialog.save"))
                : (saving ? t("participants.inviteDialog.sending") : t("participants.inviteDialog.send"))}
            </Button>
          </div>
        )}
      </SheetContent>

      <AlertDialog
        open={confirmGrants != null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setConfirmGrants(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("participants.confirm.sensitive.title")}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                {confirmGrantsContent.map((grant) => (
                  <p key={grant}>{grantLine(grant)}</p>
                ))}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => trackEvent("participants_sensitive_confirm_cancelled", {})}>
              {t("participants.confirm.sensitive.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmGrants(null);
                trackEvent("participants_sensitive_confirm_accepted", { grants: (confirmGrants ?? []).join(",") });
                submit();
              }}
            >
              {t("participants.confirm.sensitive.confirmAction")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </Sheet>
  );
}
