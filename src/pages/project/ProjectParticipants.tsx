import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { describeInviteCreateError } from "@/lib/invite-create-error";
import { showTierLimitPaywall } from "@/lib/tier-limit-error";
import {
  AlertTriangle,
  BrainCircuit,
  Coins,
  Crown,
  Eye,
  FileText,
  History,
  Lock,
  Mail,
  MoreVertical,
  Plus,
  Send,
  Shield,
  SlidersHorizontal,
  Users,
  Wrench,
} from "lucide-react";
import { useCurrentUser, useProject, useProjectInvites, useWorkspaceMode } from "@/hooks/use-mock-data";
import ParticipantsScreen from "@/components/participants/ParticipantsScreen";
import { isParticipantsRedesignEnabled } from "@/lib/participants-redesign-feature";
import { useActiveOrg, useOrgMemberProfileIds } from "@/hooks/use-orgs";
import { usePermission } from "@/lib/permissions";
import { addEvent, getUserById } from "@/data/store";
import {
  createWorkspaceProjectInvite,
  sendWorkspaceProjectInviteEmail,
  updateWorkspaceProjectInvite,
  updateWorkspaceProjectMemberRole,
  type WorkspaceProjectInvite,
} from "@/data/workspace-source";
import { workspaceQueryKeys } from "@/hooks/use-workspace-source";
import { EmptyState } from "@/components/EmptyState";
import { SettingsSection } from "@/components/settings/SettingsSection";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/hooks/use-toast";
import type {
  AIAccess,
  FinanceVisibility,
  InternalDocsVisibility,
  Member,
  MemberRole,
  ViewerRegime,
} from "@/types/entities";
import {
  aiAccessLabels,
  canEditParticipantRole,
  describePermissionSummary,
  financeVisibilityLabels,
  getDefaultFinanceVisibility,
  getDefaultInternalDocsVisibility,
  getFinanceVisibilityOptions,
  getInternalDocsVisibilityOptions,
  getInviteAiAccessOptions,
  getInviteRoleOptions,
  getNonStandardAccessSummary,
  getPermissionWarnings,
  getReassignRoleOptions,
  hasNonStandardSupportedAccess,
  internalDocsVisibilityLabels,
  roleDescriptions,
  roleLabels,
  viewerRegimeLabels,
} from "@/lib/participant-role-policy";

const roleIcons: Record<MemberRole, typeof Crown> = {
  owner: Crown,
  co_owner: Shield,
  contractor: Wrench,
  viewer: Eye,
};

/**
 * Redesigned single-list screen (PRD 2026-07-10) behind a kill switch; the
 * legacy tabs screen below stays reachable via VITE_PARTICIPANTS_REDESIGN=false
 * (or localStorage `participants-redesign`) until the redesign graduates.
 */
export default function ProjectParticipants() {
  if (isParticipantsRedesignEnabled()) {
    return <ParticipantsScreen />;
  }
  return <LegacyProjectParticipants />;
}

type ParticipantTab = "members" | "invitations" | "permissions";
type RoleTarget =
  | { kind: "member"; userId: string }
  | { kind: "invite"; inviteId: string };

type InviteEmailDeliveryOutcome =
  | { kind: "not_applicable" }
  | { kind: "sent"; recipientEmail: string }
  | { kind: "failed"; message: string };

type CreateInviteWithDeliveryResult = {
  createdInvite: WorkspaceProjectInvite;
  emailDelivery: InviteEmailDeliveryOutcome;
};

type PermissionFormState = {
  role: MemberRole;
  aiAccess: AIAccess;
  financeVisibility: FinanceVisibility;
  internalDocsVisibility: InternalDocsVisibility;
  viewerRegime: ViewerRegime;
  creditLimit: string;
};

type ParticipantPermissionRecord = {
  target: RoleTarget;
  key: string;
  displayName: string;
  secondaryLabel: string;
  targetKindLabel: string;
  role: MemberRole;
  aiAccess: AIAccess;
  financeVisibility: FinanceVisibility;
  internalDocsVisibility: InternalDocsVisibility;
  viewerRegime?: ViewerRegime;
  creditLimit: number;
  usedCredits?: number;
  inviteStatus?: WorkspaceProjectInvite["status"];
};

function resolveViewerRegime(
  role: MemberRole,
  projectMode: "contractor" | "build_myself",
  currentViewerRegime?: ViewerRegime,
): ViewerRegime | undefined {
  if (role !== "viewer") return undefined;
  return currentViewerRegime
    ?? (projectMode === "build_myself" ? "build_myself" : "client");
}

const INVITE_STATUS_KEYS: Record<WorkspaceProjectInvite["status"], string> = {
  pending: "participants.inviteStatus.pending",
  accepted: "participants.inviteStatus.accepted",
  expired: "participants.inviteStatus.expired",
  revoked: "participants.inviteStatus.revoked",
};

function inviteStatusKey(status: WorkspaceProjectInvite["status"]) {
  return INVITE_STATUS_KEYS[status] ?? "participants.inviteStatus.revoked";
}

function inviteStatusClassName(status: WorkspaceProjectInvite["status"]) {
  if (status === "pending") return "bg-info/10 text-info";
  if (status === "accepted") return "bg-success/10 text-success";
  if (status === "expired") return "bg-warning/10 text-warning-foreground";
  return "bg-muted text-muted-foreground";
}

function readInternalDocsVisibility(record: unknown): InternalDocsVisibility | undefined {
  if (!record || typeof record !== "object") return undefined;
  const candidate = (record as { internal_docs_visibility?: unknown }).internal_docs_visibility;
  return candidate === "none" || candidate === "view" || candidate === "edit" ? candidate : undefined;
}

function buildPermissionForm(
  input: {
    role: MemberRole;
    aiAccess: AIAccess;
    financeVisibility?: FinanceVisibility;
    internalDocsVisibility?: InternalDocsVisibility;
    viewerRegime?: ViewerRegime;
    creditLimit: number;
  },
  projectMode: "contractor" | "build_myself",
): PermissionFormState {
  return {
    role: input.role,
    aiAccess: input.aiAccess,
    financeVisibility: input.financeVisibility ?? getDefaultFinanceVisibility(input.role),
    internalDocsVisibility: input.internalDocsVisibility ?? getDefaultInternalDocsVisibility(input.role),
    viewerRegime: resolveViewerRegime(input.role, projectMode, input.viewerRegime)
      ?? (projectMode === "build_myself" ? "build_myself" : "client"),
    creditLimit: String(input.creditLimit),
  };
}

function applyPermissionFormToMember(member: Member, form: PermissionFormState, projectMode: "contractor" | "build_myself"): Member {
  return {
    ...member,
    role: form.role,
    ai_access: form.aiAccess,
    viewer_regime: resolveViewerRegime(form.role, projectMode, form.viewerRegime),
    credit_limit: Math.max(0, parseInt(form.creditLimit, 10) || 0),
    finance_visibility: form.financeVisibility,
    internal_docs_visibility: form.internalDocsVisibility,
  } as Member;
}

function applyPermissionFormToInvite(
  invite: WorkspaceProjectInvite,
  form: PermissionFormState,
  projectMode: "contractor" | "build_myself",
): WorkspaceProjectInvite {
  return {
    ...invite,
    role: form.role,
    ai_access: form.aiAccess,
    viewer_regime: resolveViewerRegime(form.role, projectMode, form.viewerRegime) ?? null,
    credit_limit: Math.max(0, parseInt(form.creditLimit, 10) || 0),
    finance_visibility: form.financeVisibility,
    internal_docs_visibility: form.internalDocsVisibility,
  } as WorkspaceProjectInvite;
}

function PermissionFormSections(props: {
  form: PermissionFormState;
  onFormChange: (updater: (current: PermissionFormState) => PermissionFormState) => void;
  roleOptions: MemberRole[];
  aiOptions: AIAccess[];
  financeOptions: FinanceVisibility[];
  internalDocsOptions: InternalDocsVisibility[];
  availableViewerRegimes: readonly ViewerRegime[];
  projectMode: "contractor" | "build_myself";
}) {
  const { t } = useTranslation();
  const {
    form,
    onFormChange,
    roleOptions,
    aiOptions,
    financeOptions,
    internalDocsOptions,
    availableViewerRegimes,
    projectMode,
  } = props;

  const summary = describePermissionSummary({
    role: form.role,
    aiAccess: form.aiAccess,
    financeVisibility: form.financeVisibility,
    internalDocsVisibility: form.internalDocsVisibility,
    viewerRegime: form.role === "viewer" ? form.viewerRegime : undefined,
    creditLimit: Math.max(0, parseInt(form.creditLimit, 10) || 0),
  }, t);
  const warnings = getPermissionWarnings({
    role: form.role,
    aiAccess: form.aiAccess,
    financeVisibility: form.financeVisibility,
    internalDocsVisibility: form.internalDocsVisibility,
    viewerRegime: form.role === "viewer" ? form.viewerRegime : undefined,
    creditLimit: Math.max(0, parseInt(form.creditLimit, 10) || 0),
  }, t);

  const financeDanger = form.financeVisibility === "detail";
  const docsDanger = form.internalDocsVisibility === "edit";
  const aiDanger = form.aiAccess === "project_pool";
  const presetFinanceVisibility = getDefaultFinanceVisibility(form.role);
  const hasNonStandardFinanceAccess = hasNonStandardSupportedAccess({
    role: form.role,
    financeVisibility: form.financeVisibility,
  });
  const nonStandardSummary = getNonStandardAccessSummary({
    role: form.role,
    financeVisibility: form.financeVisibility,
  }, t);
  const financeExpansionOptions = financeOptions.filter((visibility) => visibility !== presetFinanceVisibility);
  const financeCanUnlock = (form.role === "viewer" || form.role === "contractor") && financeExpansionOptions.length > 0;
  const [financeUnlocked, setFinanceUnlocked] = useState(hasNonStandardFinanceAccess);

  useEffect(() => {
    if (hasNonStandardFinanceAccess) {
      setFinanceUnlocked(true);
      return;
    }
    setFinanceUnlocked(false);
  }, [form.role, hasNonStandardFinanceAccess]);

  return (
    <div className="space-y-sp-2">
      <SettingsSection
        title={t("participants.permission.rolePreset.title")}
        description={t("participants.permission.rolePreset.description")}
      >
        <div className="space-y-3">
          <div>
            <label className="text-caption font-medium text-foreground">{t("participants.permission.rolePreset.label")}</label>
            <Select
              value={form.role}
              onValueChange={(value) => {
                const nextRole = value as MemberRole;
                onFormChange((current) => ({
                  ...current,
                  role: nextRole,
                  viewerRegime: resolveViewerRegime(nextRole, projectMode, current.viewerRegime)
                    ?? current.viewerRegime,
                }));
              }}
            >
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {roleOptions.map((role) => (
                  <SelectItem key={role} value={role}>
                    {t(roleLabels[role])}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="mt-2 text-caption text-muted-foreground">{t(roleDescriptions[form.role])}</p>
          </div>

          <div className="rounded-card border border-border/70 bg-background/70 p-3">
            <p className="text-caption font-medium text-foreground">{t("participants.permission.currentSummary")}</p>
            <ul className="mt-2 space-y-1">
              {summary.map((line) => (
                <li key={line} className="text-caption text-muted-foreground">
                  {line}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </SettingsSection>

      <SettingsSection
        title={t("participants.permission.overrides.title")}
        description={t("participants.permission.overrides.description")}
      >
        <div className="grid gap-3 md:grid-cols-2">
          <div className={`rounded-card border p-3 ${aiDanger ? "border-warning/40 bg-warning/10" : "border-border/70 bg-background/70"}`}>
            <label className="text-caption font-medium text-foreground">{t("participants.permission.aiAccess")}</label>
            <Select
              value={form.aiAccess}
              onValueChange={(value) => {
                onFormChange((current) => ({ ...current, aiAccess: value as AIAccess }));
              }}
            >
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {aiOptions.map((aiAccess) => (
                  <SelectItem key={aiAccess} value={aiAccess}>
                    {t(aiAccessLabels[aiAccess])}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className={`rounded-card border p-3 ${financeDanger ? "border-warning/40 bg-warning/10" : "border-border/70 bg-background/70"}`}>
            <label className="text-caption font-medium text-foreground">{t("participants.permission.financeVisibility")}</label>
            {financeCanUnlock && !financeUnlocked && !hasNonStandardFinanceAccess ? (
              <div className="mt-2 space-y-3">
                <div className="flex items-start justify-between gap-3 rounded-lg border border-border/70 bg-background/80 p-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">
                      {t(financeVisibilityLabels[presetFinanceVisibility])}
                    </p>
                    <p className="mt-1 text-caption text-muted-foreground">
                      {t("participants.permission.financeNonStandard")}
                    </p>
                  </div>
                  <Lock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                </div>

                <div className="flex flex-wrap gap-2">
                  {financeExpansionOptions.map((visibility) => (
                    <span
                      key={visibility}
                      className="inline-flex items-center gap-1 rounded-pill border border-border/70 bg-muted/40 px-2 py-1 text-caption text-muted-foreground"
                    >
                      <Lock className="h-3 w-3" />
                      {t(financeVisibilityLabels[visibility])}
                    </span>
                  ))}
                </div>

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8"
                  onClick={() => setFinanceUnlocked(true)}
                >
                  {t("participants.permission.unlockFinance")}
                </Button>
              </div>
            ) : (
              <Select
                value={form.financeVisibility}
                onValueChange={(value) => {
                  onFormChange((current) => ({ ...current, financeVisibility: value as FinanceVisibility }));
                }}
              >
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {financeOptions.map((visibility) => (
                    <SelectItem key={visibility} value={visibility}>
                      {t(financeVisibilityLabels[visibility])}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          <div className={`rounded-card border p-3 ${docsDanger ? "border-warning/40 bg-warning/10" : "border-border/70 bg-background/70"}`}>
            <label className="text-caption font-medium text-foreground">{t("participants.permission.internalDocs")}</label>
            <Select
              value={form.internalDocsVisibility}
              onValueChange={(value) => {
                onFormChange((current) => ({ ...current, internalDocsVisibility: value as InternalDocsVisibility }));
              }}
            >
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {internalDocsOptions.map((visibility) => (
                  <SelectItem key={visibility} value={visibility}>
                    {t(internalDocsVisibilityLabels[visibility])}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {form.role === "viewer" && (
            <div className="rounded-card border border-border/70 bg-background/70 p-3">
              <label className="text-caption font-medium text-foreground">{t("participants.permission.viewerRegime")}</label>
              <Select
                value={form.viewerRegime}
                onValueChange={(value) => {
                  onFormChange((current) => ({ ...current, viewerRegime: value as ViewerRegime }));
                }}
              >
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {availableViewerRegimes.map((regime) => (
                    <SelectItem key={regime} value={regime}>
                      {t(viewerRegimeLabels[regime])}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="rounded-card border border-border/70 bg-background/70 p-3">
            <label className="text-caption font-medium text-foreground">{t("participants.permission.creditLimit")}</label>
            <Input
              type="number"
              min={0}
              value={form.creditLimit}
              onChange={(event) => {
                onFormChange((current) => ({ ...current, creditLimit: event.target.value }));
              }}
              className="mt-1"
            />
          </div>
        </div>
      </SettingsSection>

      {nonStandardSummary && (
        <SettingsSection title={t("participants.permission.customSummary.title")} description={t("participants.permission.customSummary.description")}>
          <Alert className="border-info/30 bg-info/10 text-foreground [&>svg]:text-info">
            <SlidersHorizontal className="h-4 w-4" />
            <AlertTitle>{nonStandardSummary.title}</AlertTitle>
            <AlertDescription>
              <ul className="space-y-1">
                {nonStandardSummary.lines.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        </SettingsSection>
      )}

      {warnings.length > 0 && (
        <SettingsSection title={t("participants.permission.sensitive.title")} description={t("participants.permission.sensitive.description")}>
          <Alert className="border-warning/40 bg-warning/10 text-foreground [&>svg]:text-warning-foreground">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>{t("participants.permission.reviewBeforeSave")}</AlertTitle>
            <AlertDescription>
              <ul className="space-y-1">
                {warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        </SettingsSection>
      )}
    </div>
  );
}

function LegacyProjectParticipants() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const projectId = id!;
  const { project, members } = useProject(projectId);
  const invites = useProjectInvites(projectId);
  const perm = usePermission(projectId);
  const workspaceMode = useWorkspaceMode();
  const queryClient = useQueryClient();
  const currentUser = useCurrentUser();

  const projectMode = project?.project_mode === "build_myself" ? "build_myself" : "contractor";
  const availableViewerRegimes = projectMode === "build_myself"
    ? (["build_myself", "contractor"] as const)
    : (["client", "contractor", "build_myself"] as const);
  const defaultViewerRegime = projectMode === "build_myself" ? "build_myself" : "client";

  const [activeTab, setActiveTab] = useState<ParticipantTab>("members");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteForm, setInviteForm] = useState<PermissionFormState>(() => buildPermissionForm({
    role: "contractor",
    aiAccess: "consult_only",
    financeVisibility: getDefaultFinanceVisibility("contractor"),
    internalDocsVisibility: getDefaultInternalDocsVisibility("contractor"),
    viewerRegime: defaultViewerRegime,
    creditLimit: 50,
  }, projectMode));
  const [inviteAddToOrg, setInviteAddToOrg] = useState(false);
  const activeOrg = useActiveOrg();
  const { data: orgMemberIds } = useOrgMemberProfileIds(activeOrg?.id);
  const orgMemberIdSet = useMemo(() => new Set(orgMemberIds ?? []), [orgMemberIds]);
  const [permissionDialogOpen, setPermissionDialogOpen] = useState(false);
  const [permissionTarget, setPermissionTarget] = useState<RoleTarget | null>(null);
  const [permissionForm, setPermissionForm] = useState<PermissionFormState>(() => buildPermissionForm({
    role: "contractor",
    aiAccess: "consult_only",
    financeVisibility: getDefaultFinanceVisibility("contractor"),
    internalDocsVisibility: getDefaultInternalDocsVisibility("contractor"),
    viewerRegime: defaultViewerRegime,
    creditLimit: 50,
  }, projectMode));

  const actorRole = perm.seam.membership?.role ?? "viewer";
  const actorMember = members.find((member) => member.user_id === currentUser.id) ?? null;
  const actorAiAccess = actorMember?.ai_access ?? perm.seam.membership?.ai_access ?? "none";
  const actorFinanceVisibility = actorMember?.finance_visibility
    ?? (actorRole === "owner" || actorRole === "co_owner" ? "detail" : "none");
  const actorInternalDocsVisibility = readInternalDocsVisibility(actorMember)
    ?? (actorRole === "owner" ? "edit" : actorRole === "co_owner" ? "view" : "none");
  const inviteRoleOptions = useMemo(() => getInviteRoleOptions(actorRole), [actorRole]);
  const aiOptions = useMemo(() => getInviteAiAccessOptions(actorAiAccess), [actorAiAccess]);
  const financeOptions = useMemo(
    () => getFinanceVisibilityOptions(actorRole, actorFinanceVisibility),
    [actorFinanceVisibility, actorRole],
  );
  const internalDocsOptions = useMemo(
    () => getInternalDocsVisibilityOptions(actorRole, actorInternalDocsVisibility),
    [actorInternalDocsVisibility, actorRole],
  );

  const canManageAccess = perm.can("member.invite") && workspaceMode.kind !== "pending-supabase";
  const workspaceKey = workspaceMode.kind === "supabase" ? workspaceMode.profileId : workspaceMode.kind;
  const membersQueryKey = workspaceQueryKeys.projectMembers(workspaceKey, projectId);
  const invitesQueryKey = workspaceQueryKeys.projectInvites(workspaceKey, projectId);

  const pendingInvites = useMemo(
    () => invites.filter((invite) => invite.status === "pending"),
    [invites],
  );
  const inviteHistory = useMemo(
    () => invites.filter((invite) => invite.status !== "pending"),
    [invites],
  );

  const memberEmailById = useMemo(
    () =>
      new Map(
        members.map((member) => [member.user_id, getUserById(member.user_id)?.email?.toLowerCase() ?? ""]),
      ),
    [members],
  );
  const pendingInviteEmailSet = useMemo(
    () => new Set(pendingInvites.map((invite) => invite.email.toLowerCase())),
    [pendingInvites],
  );

  const permissionMemberRecords = useMemo<ParticipantPermissionRecord[]>(() => (
    members.map((member) => {
      const user = getUserById(member.user_id);
      return {
        target: { kind: "member", userId: member.user_id },
        key: `member-${member.user_id}`,
        displayName: user?.name ?? member.user_id,
        secondaryLabel: user?.email ?? t("participants.noEmail"),
        targetKindLabel: t("participants.targetKind.member"),
        role: member.role,
        aiAccess: member.ai_access,
        financeVisibility: member.finance_visibility ?? getDefaultFinanceVisibility(member.role),
        internalDocsVisibility: readInternalDocsVisibility(member) ?? getDefaultInternalDocsVisibility(member.role),
        viewerRegime: member.viewer_regime,
        creditLimit: member.credit_limit,
        usedCredits: member.used_credits,
      };
    })
  ), [members]);

  const permissionInviteRecords = useMemo<ParticipantPermissionRecord[]>(() => (
    pendingInvites.map((invite) => ({
      target: { kind: "invite", inviteId: invite.id },
      key: `invite-${invite.id}`,
      displayName: invite.email,
      secondaryLabel: t("participants.invitedByLabel", { name: getUserById(invite.invited_by)?.name ?? invite.invited_by }),
      targetKindLabel: t("participants.targetKind.invite"),
      role: invite.role,
      aiAccess: invite.ai_access,
      financeVisibility: invite.finance_visibility ?? getDefaultFinanceVisibility(invite.role),
      internalDocsVisibility: readInternalDocsVisibility(invite) ?? getDefaultInternalDocsVisibility(invite.role),
      viewerRegime: invite.viewer_regime ?? undefined,
      creditLimit: invite.credit_limit,
      inviteStatus: invite.status,
    }))
  ), [pendingInvites]);

  const permissionTargetRecord = useMemo(() => {
    if (!permissionTarget) return null;
    const allRecords = [...permissionMemberRecords, ...permissionInviteRecords];
    return allRecords.find((record) => (
      permissionTarget.kind === "member"
        ? record.target.kind === "member" && record.target.userId === permissionTarget.userId
        : record.target.kind === "invite" && record.target.inviteId === permissionTarget.inviteId
    )) ?? null;
  }, [permissionInviteRecords, permissionMemberRecords, permissionTarget]);

  const editRoleOptions = useMemo(() => {
    if (!permissionTargetRecord) return [];
    return getReassignRoleOptions(actorRole, permissionTargetRecord.role);
  }, [actorRole, permissionTargetRecord]);

  useEffect(() => {
    if (!inviteOpen) return;
    if (!inviteRoleOptions.includes(inviteForm.role)) {
      const nextRole = inviteRoleOptions[0] ?? "contractor";
      setInviteForm((current) => ({
        ...current,
        role: nextRole,
        viewerRegime: resolveViewerRegime(nextRole, projectMode, current.viewerRegime) ?? current.viewerRegime,
      }));
    }
    if (!aiOptions.includes(inviteForm.aiAccess)) {
      setInviteForm((current) => ({ ...current, aiAccess: aiOptions[0] ?? "none" }));
    }
    if (!financeOptions.includes(inviteForm.financeVisibility)) {
      setInviteForm((current) => ({ ...current, financeVisibility: financeOptions[0] ?? "none" }));
    }
    if (!internalDocsOptions.includes(inviteForm.internalDocsVisibility)) {
      setInviteForm((current) => ({ ...current, internalDocsVisibility: internalDocsOptions[0] ?? "none" }));
    }
  }, [aiOptions, financeOptions, internalDocsOptions, inviteForm.aiAccess, inviteForm.financeVisibility, inviteForm.internalDocsVisibility, inviteForm.role, inviteOpen, inviteRoleOptions, projectMode]);

  useEffect(() => {
    if (!permissionDialogOpen || !permissionTargetRecord) return;
    if (!editRoleOptions.includes(permissionForm.role)) {
      setPermissionForm((current) => ({
        ...current,
        role: editRoleOptions[0] ?? permissionTargetRecord.role,
      }));
    }
  }, [editRoleOptions, permissionDialogOpen, permissionForm.role, permissionTargetRecord]);

  function resetInviteDialog() {
    setInviteEmail("");
    setInviteForm(buildPermissionForm({
      role: "contractor",
      aiAccess: "consult_only",
      financeVisibility: getDefaultFinanceVisibility("contractor"),
      internalDocsVisibility: getDefaultInternalDocsVisibility("contractor"),
      viewerRegime: defaultViewerRegime,
      creditLimit: 50,
    }, projectMode));
    setInviteAddToOrg(false);
  }

  function openPermissionEditor(record: ParticipantPermissionRecord) {
    setPermissionTarget(record.target);
    setPermissionForm(buildPermissionForm({
      role: record.role,
      aiAccess: record.aiAccess,
      financeVisibility: record.financeVisibility,
      internalDocsVisibility: record.internalDocsVisibility,
      viewerRegime: record.viewerRegime,
      creditLimit: record.creditLimit,
    }, projectMode));
    setPermissionDialogOpen(true);
  }

  function canEditPermissionRecord(record: ParticipantPermissionRecord) {
    if (!canManageAccess) return false;
    if (record.target.kind === "member" && record.target.userId === currentUser.id) return false;
    return canEditParticipantRole(actorRole, record.role);
  }

  const createInviteMutation = useMutation({
    mutationFn: async (): Promise<CreateInviteWithDeliveryResult> => {
      const trimmedEmail = inviteEmail.trim().toLowerCase();
      const modeForInvite =
        workspaceMode.kind === "pending-supabase" ? { kind: "local" as const } : workspaceMode;

      const createdInvite = await createWorkspaceProjectInvite(modeForInvite, {
        projectId,
        email: trimmedEmail,
        role: inviteForm.role,
        aiAccess: inviteForm.aiAccess,
        viewerRegime: resolveViewerRegime(inviteForm.role, projectMode, inviteForm.viewerRegime) ?? null,
        creditLimit: Math.max(0, parseInt(inviteForm.creditLimit, 10) || 0),
        invitedBy: currentUser.id,
        financeVisibility: inviteForm.financeVisibility,
        internalDocsVisibility: inviteForm.internalDocsVisibility,
        addToOrgId: inviteAddToOrg && activeOrg ? activeOrg.id : null,
      });

      if (workspaceMode.kind !== "supabase") {
        return { createdInvite, emailDelivery: { kind: "not_applicable" } };
      }

      try {
        const delivery = await sendWorkspaceProjectInviteEmail(workspaceMode, createdInvite.id);
        if (delivery.kind === "skipped") {
          return { createdInvite, emailDelivery: { kind: "not_applicable" } };
        }
        return {
          createdInvite,
          emailDelivery: {
            kind: "sent",
            recipientEmail: delivery.payload.recipientEmail || createdInvite.email,
          },
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : t("participants.error.emailSendFallback");
        return {
          createdInvite,
          emailDelivery: { kind: "failed", message },
        };
      }
    },
    onMutate: async () => {
      if (workspaceMode.kind !== "supabase") return undefined;
      await queryClient.cancelQueries({ queryKey: invitesQueryKey });
      const previousInvites = queryClient.getQueryData<WorkspaceProjectInvite[]>(invitesQueryKey) ?? [];
      const optimisticInvite = {
        id: `invite-optimistic-${Date.now()}`,
        project_id: projectId,
        email: inviteEmail.trim().toLowerCase(),
        role: inviteForm.role,
        ai_access: inviteForm.aiAccess,
        viewer_regime: resolveViewerRegime(inviteForm.role, projectMode, inviteForm.viewerRegime) ?? null,
        credit_limit: Math.max(0, parseInt(inviteForm.creditLimit, 10) || 0),
        invited_by: currentUser.id,
        status: "pending",
        invite_token: `invite-token-optimistic-${Date.now()}`,
        accepted_profile_id: null,
        created_at: new Date().toISOString(),
        accepted_at: null,
        finance_visibility: inviteForm.financeVisibility,
        internal_docs_visibility: inviteForm.internalDocsVisibility,
      } as WorkspaceProjectInvite;
      queryClient.setQueryData<WorkspaceProjectInvite[]>(invitesQueryKey, [optimisticInvite, ...previousInvites]);
      return { previousInvites };
    },
    onSuccess: ({ createdInvite, emailDelivery }) => {
      if (workspaceMode.kind !== "supabase") {
        addEvent({
          id: `evt-invite-${Date.now()}`,
          project_id: projectId,
          actor_id: currentUser.id,
          type: "member_added",
          object_type: "member",
          object_id: createdInvite.id,
          timestamp: new Date().toISOString(),
          payload: { email: createdInvite.email, role: createdInvite.role, source: "invite" },
        });
      }

      if (emailDelivery.kind === "failed") {
        toast({
          title: t("participants.toast.inviteCreated"),
          description: t("participants.toast.inviteCreatedFailDesc", { email: createdInvite.email, message: emailDelivery.message }),
          variant: "destructive",
        });
      } else if (emailDelivery.kind === "sent") {
        toast({
          title: t("participants.toast.invitationSent"),
          description: t("participants.toast.invitationSentDesc", { email: emailDelivery.recipientEmail, role: t(roleLabels[createdInvite.role]) }),
        });
      } else {
        toast({
          title: t("participants.toast.invitationSent"),
          description: t("participants.toast.invitationSentDesc", { email: createdInvite.email, role: t(roleLabels[createdInvite.role]) }),
        });
      }

      setInviteOpen(false);
      resetInviteDialog();
    },
    onError: (error, _variables, context) => {
      if (workspaceMode.kind === "supabase" && context?.previousInvites) {
        queryClient.setQueryData(invitesQueryKey, context.previousInvites);
      }
      if (showTierLimitPaywall(error, t)) return;
      toast({
        title: t("participants.toast.inviteFailed"),
        description: describeInviteCreateError(error, t, t("participants.toast.inviteFailedDesc")),
        variant: "destructive",
      });
    },
    onSettled: async () => {
      if (workspaceMode.kind === "supabase") {
        await queryClient.invalidateQueries({ queryKey: invitesQueryKey });
      }
    },
  });

  const resendInviteEmailMutation = useMutation({
    mutationFn: async (inviteId: string) => {
      if (workspaceMode.kind !== "supabase") {
        throw new Error(t("participants.error.resendNotInSupabase"));
      }
      return sendWorkspaceProjectInviteEmail(workspaceMode, inviteId);
    },
    onSuccess: (result) => {
      if (result.kind === "skipped") {
        toast({
          title: t("participants.toast.emailNotSent"),
          description: t("participants.toast.emailNotSentDesc"),
          variant: "destructive",
        });
        return;
      }
      toast({
        title: t("participants.toast.invitationEmailSent"),
        description: result.payload.recipientEmail
          ? t("participants.toast.invitationEmailSentTo", { email: result.payload.recipientEmail })
          : t("participants.toast.invitationEmailSentDefault"),
      });
    },
    onError: (error) => {
      toast({
        title: t("participants.toast.resendFailed"),
        description: error instanceof Error ? error.message : t("participants.toast.resendFailedDesc"),
        variant: "destructive",
      });
    },
  });

  const savePermissionsMutation = useMutation({
    mutationFn: async (input: { target: RoleTarget; form: PermissionFormState }) => {
      // Const (not `input.target`): property-path narrowing does not survive into
      // the find/map closures below, a narrowed const does.
      const target = input.target;
      if (target.kind === "member") {
        return updateWorkspaceProjectMemberRole(
          workspaceMode.kind === "pending-supabase" ? { kind: "local" } : workspaceMode,
          {
            projectId,
            userId: target.userId,
            role: input.form.role,
            aiAccess: input.form.aiAccess,
            viewerRegime: resolveViewerRegime(input.form.role, projectMode, input.form.viewerRegime),
            creditLimit: Math.max(0, parseInt(input.form.creditLimit, 10) || 0),
            financeVisibility: input.form.financeVisibility,
            internalDocsVisibility: input.form.internalDocsVisibility,
          },
        );
      }

      // Deliberately omit `status`: writing a stale cached status back could
      // resurrect a concurrently revoked/accepted invite to 'pending' and
      // re-arm its token. Status transitions belong to the revoke mutation and
      // the accept RPC only. (Mirrors the redesigned screen's fix.)
      return updateWorkspaceProjectInvite(
        workspaceMode.kind === "pending-supabase" ? { kind: "local" } : workspaceMode,
        {
          id: target.inviteId,
          projectId,
          role: input.form.role,
          aiAccess: input.form.aiAccess,
          viewerRegime: resolveViewerRegime(input.form.role, projectMode, input.form.viewerRegime) ?? null,
          creditLimit: Math.max(0, parseInt(input.form.creditLimit, 10) || 0),
          financeVisibility: input.form.financeVisibility,
          internalDocsVisibility: input.form.internalDocsVisibility,
        },
      );
    },
    onMutate: async (input) => {
      if (workspaceMode.kind !== "supabase") return undefined;

      const target = input.target;
      if (target.kind === "member") {
        await queryClient.cancelQueries({ queryKey: membersQueryKey });
        const previousMembers = queryClient.getQueryData<Member[]>(membersQueryKey) ?? [];
        queryClient.setQueryData<Member[]>(membersQueryKey, previousMembers.map((member) => (
          member.project_id === projectId && member.user_id === target.userId
            ? applyPermissionFormToMember(member, input.form, projectMode)
            : member
        )));
        return { previousMembers };
      }

      await queryClient.cancelQueries({ queryKey: invitesQueryKey });
      const previousInvites = queryClient.getQueryData<WorkspaceProjectInvite[]>(invitesQueryKey) ?? [];
      queryClient.setQueryData<WorkspaceProjectInvite[]>(invitesQueryKey, previousInvites.map((invite) => (
        invite.id === target.inviteId
          ? applyPermissionFormToInvite(invite, input.form, projectMode)
          : invite
      )));
      return { previousInvites };
    },
    onSuccess: (_result, variables) => {
      const name = permissionTargetRecord?.displayName ?? t("participants.permissionDialog.fallbackName");
      toast({
        title: t("participants.toast.accessUpdated"),
        description: t("participants.toast.accessUpdatedDesc", { name, role: t(roleLabels[variables.form.role]) }),
      });
      setPermissionDialogOpen(false);
      setPermissionTarget(null);
    },
    onError: (error, _variables, context) => {
      if (workspaceMode.kind === "supabase" && context?.previousMembers) {
        queryClient.setQueryData(membersQueryKey, context.previousMembers);
      }
      if (workspaceMode.kind === "supabase" && context?.previousInvites) {
        queryClient.setQueryData(invitesQueryKey, context.previousInvites);
      }
      if (showTierLimitPaywall(error, t)) return;
      toast({
        title: t("participants.toast.accessUpdateFailed"),
        description: error instanceof Error ? error.message : t("participants.toast.accessUpdateFailedDesc"),
        variant: "destructive",
      });
    },
    onSettled: async (_result, _error, variables) => {
      if (workspaceMode.kind !== "supabase") return;
      if (variables.target.kind === "member") {
        await queryClient.invalidateQueries({ queryKey: membersQueryKey });
      } else {
        await queryClient.invalidateQueries({ queryKey: invitesQueryKey });
      }
    },
  });

  function handleInvite() {
    const trimmedEmail = inviteEmail.trim().toLowerCase();
    if (!trimmedEmail) return;
    if (pendingInviteEmailSet.has(trimmedEmail)) {
      toast({
        title: t("participants.toast.alreadyInvited"),
        description: t("participants.toast.alreadyInvitedDesc"),
        variant: "destructive",
      });
      return;
    }
    const existingMember = Array.from(memberEmailById.values()).some((email) => email === trimmedEmail);
    if (existingMember) {
      toast({
        title: t("participants.toast.alreadyAdded"),
        description: t("participants.toast.alreadyAddedDesc"),
        variant: "destructive",
      });
      return;
    }

    createInviteMutation.mutate();
  }

  function handleSavePermissions() {
    if (!permissionTarget) return;
    savePermissionsMutation.mutate({ target: permissionTarget, form: permissionForm });
  }

  return (
    <div className="space-y-sp-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-h3 text-foreground">{t("participants.header")}</h2>
          <p className="text-caption text-muted-foreground">
            {t("participants.summary", { active: members.length, pending: pendingInvites.length })}
          </p>
        </div>
        {canManageAccess && (
          <Button
            onClick={() => {
              resetInviteDialog();
              setInviteOpen(true);
            }}
            className="bg-accent text-accent-foreground hover:bg-accent/90"
          >
            <Plus className="mr-1 h-4 w-4" /> {t("participants.invite")}
          </Button>
        )}
      </div>

      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as ParticipantTab)}>
        <TabsList className="h-auto w-full justify-start gap-1 bg-transparent p-0">
          <TabsTrigger value="members">{t("participants.tab.members")}</TabsTrigger>
          <TabsTrigger value="invitations">{t("participants.tab.invitations")}</TabsTrigger>
          <TabsTrigger value="permissions">{t("participants.tab.permissions")}</TabsTrigger>
        </TabsList>

        <TabsContent value="members" className="mt-3">
          <section className="space-y-2">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-accent" />
              <h3 className="text-body font-semibold text-foreground">{t("participants.section.activeMembers")}</h3>
            </div>
            <div className="glass overflow-hidden rounded-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("participants.table.member")}</TableHead>
                    <TableHead>{t("participants.table.role")}</TableHead>
                    <TableHead>{t("participants.table.aiAccess")}</TableHead>
                    <TableHead className="text-right">{t("participants.table.credits")}</TableHead>
                    {canManageAccess && <TableHead className="w-10" />}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {members.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={canManageAccess ? 5 : 4} className="text-center text-muted-foreground">
                        {t("participants.empty.noActive")}
                      </TableCell>
                    </TableRow>
                  ) : members.map((member) => {
                    const memberUser = getUserById(member.user_id);
                    const record = permissionMemberRecords.find((entry) => entry.target.kind === "member" && entry.target.userId === member.user_id);
                    const RoleIcon = roleIcons[member.role];
                    const isSelf = member.user_id === currentUser.id;

                    return (
                      <TableRow key={member.user_id}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-accent/10 text-caption font-semibold text-accent">
                              {(memberUser?.name ?? "?").charAt(0)}
                            </div>
                            <div>
                              <p className="text-body-sm font-medium text-foreground">
                                {memberUser?.name ?? member.user_id}
                                {isSelf && <span className="ml-1 text-caption text-muted-foreground">{t("participants.you")}</span>}
                                {activeOrg && orgMemberIdSet.has(member.user_id) && (
                                  <span
                                    className="ml-2 inline-flex items-center rounded-pill border border-accent/30 bg-accent/10 px-1.5 py-0 text-[10px] font-medium text-accent"
                                    title={activeOrg.name}
                                  >
                                    {t("participants.orgTag")}
                                  </span>
                                )}
                              </p>
                              <p className="text-caption text-muted-foreground">{memberUser?.email || t("participants.noEmail")}</p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1.5">
                            <RoleIcon className="h-3.5 w-3.5 text-muted-foreground" />
                            <span className="text-body-sm">{t(roleLabels[member.role])}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <span className={`rounded-pill px-2 py-0.5 text-caption font-medium ${
                            member.ai_access === "project_pool"
                              ? "bg-accent/10 text-accent"
                              : member.ai_access === "consult_only"
                                ? "bg-info/10 text-info"
                                : "bg-muted text-muted-foreground"
                          }`}>
                            {t(aiAccessLabels[member.ai_access])}
                          </span>
                        </TableCell>
                        <TableCell className="text-right">
                          <span className="text-body-sm">{member.used_credits}</span>
                          <span className="text-caption text-muted-foreground">/{member.credit_limit}</span>
                        </TableCell>
                        {canManageAccess && (
                          <TableCell>
                            {record && canEditPermissionRecord(record) ? (
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="ghost" size="icon" className="h-7 w-7">
                                    <MoreVertical className="h-3.5 w-3.5" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="glass-elevated rounded-card">
                                  <DropdownMenuItem onClick={() => openPermissionEditor(record)}>
                                    <Shield className="mr-2 h-3.5 w-3.5" /> {t("participants.dropdown.editAccess")}
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            ) : null}
                          </TableCell>
                        )}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </section>
        </TabsContent>

        <TabsContent value="invitations" className="mt-3 space-y-sp-3">
          <section className="space-y-2">
            <div className="flex items-center gap-2">
              <Mail className="h-4 w-4 text-accent" />
              <h3 className="text-body font-semibold text-foreground">{t("participants.section.pendingInvites")}</h3>
            </div>
            <div className="glass overflow-hidden rounded-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("participants.table.email")}</TableHead>
                    <TableHead>{t("participants.table.invitedBy")}</TableHead>
                    <TableHead>{t("participants.table.role")}</TableHead>
                    <TableHead>{t("participants.table.status")}</TableHead>
                    <TableHead>{t("participants.table.actions")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pendingInvites.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-muted-foreground">
                        {t("participants.empty.noPending")}
                      </TableCell>
                    </TableRow>
                  ) : pendingInvites.map((invite) => {
                    const inviter = getUserById(invite.invited_by);
                    const record = permissionInviteRecords.find((entry) => entry.target.kind === "invite" && entry.target.inviteId === invite.id);
                    const canEditInvite = record != null && canEditPermissionRecord(record);
                    const showResendEmail = workspaceMode.kind === "supabase" && canManageAccess;

                    return (
                      <TableRow key={invite.id}>
                        <TableCell className="text-body-sm text-foreground">{invite.email}</TableCell>
                        <TableCell className="text-body-sm text-muted-foreground">
                          {inviter?.name ?? inviter?.email ?? invite.invited_by}
                        </TableCell>
                        <TableCell className="text-body-sm text-foreground">{t(roleLabels[invite.role])}</TableCell>
                        <TableCell>
                          <span className={`rounded-pill px-2 py-0.5 text-caption font-medium ${inviteStatusClassName(invite.status)}`}>
                            {t(inviteStatusKey(invite.status))}
                          </span>
                        </TableCell>
                        <TableCell>
                          {canManageAccess ? (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-7 w-7">
                                  <MoreVertical className="h-3.5 w-3.5" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="glass-elevated rounded-card">
                                {showResendEmail && (
                                  <DropdownMenuItem
                                    disabled={
                                      resendInviteEmailMutation.isPending
                                      && resendInviteEmailMutation.variables === invite.id
                                    }
                                    onClick={() => {
                                      resendInviteEmailMutation.mutate(invite.id);
                                    }}
                                  >
                                    <Send className="mr-2 h-3.5 w-3.5" /> {t("participants.dropdown.resendEmail")}
                                  </DropdownMenuItem>
                                )}
                                {record && canEditInvite && (
                                  <DropdownMenuItem onClick={() => openPermissionEditor(record)}>
                                    <Shield className="mr-2 h-3.5 w-3.5" /> {t("participants.dropdown.editAccess")}
                                  </DropdownMenuItem>
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </section>

          {inviteHistory.length > 0 && (
            <section className="space-y-2">
              <div className="flex items-center gap-2">
                <History className="h-4 w-4 text-muted-foreground" />
                <h3 className="text-body font-semibold text-foreground">{t("participants.section.inviteHistory")}</h3>
              </div>
              <div className="glass overflow-hidden rounded-card">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("participants.table.email")}</TableHead>
                      <TableHead>{t("participants.table.role")}</TableHead>
                      <TableHead>{t("participants.table.status")}</TableHead>
                      <TableHead>{t("participants.table.created")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {inviteHistory.map((invite) => (
                      <TableRow key={invite.id}>
                        <TableCell className="text-body-sm text-foreground">{invite.email}</TableCell>
                        <TableCell className="text-body-sm text-foreground">{t(roleLabels[invite.role])}</TableCell>
                        <TableCell>
                          <span className={`rounded-pill px-2 py-0.5 text-caption font-medium ${inviteStatusClassName(invite.status)}`}>
                            {t(inviteStatusKey(invite.status))}
                          </span>
                        </TableCell>
                        <TableCell className="text-body-sm text-muted-foreground">
                          {new Date(invite.created_at).toLocaleDateString()}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </section>
          )}
        </TabsContent>

        <TabsContent value="permissions" className="mt-3 space-y-sp-3">
          <section className="space-y-2">
            <div className="flex items-center gap-2">
              <SlidersHorizontal className="h-4 w-4 text-accent" />
              <h3 className="text-body font-semibold text-foreground">{t("participants.section.memberPermissions")}</h3>
            </div>
            {permissionMemberRecords.length === 0 ? (
              <EmptyState
                icon={Users}
                title={t("participants.empty.noMembers.title")}
                description={t("participants.empty.noMembers.description")}
              />
            ) : (
              <div className="space-y-2">
                {permissionMemberRecords.map((record) => {
                  const warnings = getPermissionWarnings({
                    role: record.role,
                    aiAccess: record.aiAccess,
                    financeVisibility: record.financeVisibility,
                    internalDocsVisibility: record.internalDocsVisibility,
                    viewerRegime: record.viewerRegime,
                    creditLimit: record.creditLimit,
                  }, t);

                  return (
                    <div key={record.key} className="glass rounded-card border border-border/70 p-4">
                      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                        <div className="space-y-2">
                          <div>
                            <p className="text-body font-medium text-foreground">{record.displayName}</p>
                            <p className="text-caption text-muted-foreground">{record.secondaryLabel}</p>
                          </div>
                          <div className="flex flex-wrap gap-2 text-caption">
                            <span className="rounded-pill bg-muted px-2 py-0.5 text-muted-foreground">{record.targetKindLabel}</span>
                            <span className="rounded-pill bg-accent/10 px-2 py-0.5 text-accent">{t(roleLabels[record.role])}</span>
                            <span className="rounded-pill bg-muted px-2 py-0.5 text-muted-foreground">{t(aiAccessLabels[record.aiAccess])}</span>
                            <span className="rounded-pill bg-muted px-2 py-0.5 text-muted-foreground">{t(financeVisibilityLabels[record.financeVisibility])}</span>
                          </div>
                          <div className="grid gap-1 text-caption text-muted-foreground md:grid-cols-2">
                            <div className="flex items-center gap-1.5">
                              <BrainCircuit className="h-3.5 w-3.5" />
                              {t(aiAccessLabels[record.aiAccess])}
                            </div>
                            <div className="flex items-center gap-1.5">
                              <Coins className="h-3.5 w-3.5" />
                              {t("participants.creditLimit", { count: record.creditLimit })}
                              {typeof record.usedCredits === "number" ? ` · ${t("participants.usedCredits", { count: record.usedCredits })}` : ""}
                            </div>
                            <div className="flex items-center gap-1.5">
                              <Shield className="h-3.5 w-3.5" />
                              {t(financeVisibilityLabels[record.financeVisibility])}
                            </div>
                            <div className="flex items-center gap-1.5">
                              <FileText className="h-3.5 w-3.5" />
                              {t(internalDocsVisibilityLabels[record.internalDocsVisibility])}
                            </div>
                            {record.role === "viewer" && record.viewerRegime && (
                              <div className="flex items-center gap-1.5 md:col-span-2">
                                <Eye className="h-3.5 w-3.5" />
                                {t("participants.viewerRegimeRow", { regime: t(viewerRegimeLabels[record.viewerRegime]) })}
                              </div>
                            )}
                          </div>
                          {warnings.length > 0 && (
                            <div className="rounded-card border border-warning/40 bg-warning/10 p-3">
                              <p className="text-caption font-medium text-foreground">{t("participants.sensitiveAccess")}</p>
                              <ul className="mt-1 space-y-1 text-caption text-muted-foreground">
                                {warnings.map((warning) => (
                                  <li key={warning}>{warning}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                        {canEditPermissionRecord(record) && (
                          <Button variant="outline" onClick={() => openPermissionEditor(record)}>
                            {t("participants.editAccessButton")}
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <section className="space-y-2">
            <div className="flex items-center gap-2">
              <Mail className="h-4 w-4 text-accent" />
              <h3 className="text-body font-semibold text-foreground">{t("participants.section.invitePermissions")}</h3>
            </div>
            {permissionInviteRecords.length === 0 ? (
              <EmptyState
                icon={Mail}
                title={t("participants.empty.noPendingInvites.title")}
                description={t("participants.empty.noPendingInvites.description")}
              />
            ) : (
              <div className="space-y-2">
                {permissionInviteRecords.map((record) => {
                  const warnings = getPermissionWarnings({
                    role: record.role,
                    aiAccess: record.aiAccess,
                    financeVisibility: record.financeVisibility,
                    internalDocsVisibility: record.internalDocsVisibility,
                    viewerRegime: record.viewerRegime,
                    creditLimit: record.creditLimit,
                  }, t);

                  return (
                    <div key={record.key} className="glass rounded-card border border-border/70 p-4">
                      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                        <div className="space-y-2">
                          <div>
                            <p className="text-body font-medium text-foreground">{record.displayName}</p>
                            <p className="text-caption text-muted-foreground">{record.secondaryLabel}</p>
                          </div>
                          <div className="flex flex-wrap gap-2 text-caption">
                            <span className="rounded-pill bg-muted px-2 py-0.5 text-muted-foreground">{record.targetKindLabel}</span>
                            <span className="rounded-pill bg-accent/10 px-2 py-0.5 text-accent">{t(roleLabels[record.role])}</span>
                            {record.inviteStatus && (
                              <span className={`rounded-pill px-2 py-0.5 ${inviteStatusClassName(record.inviteStatus)}`}>
                                {t(inviteStatusKey(record.inviteStatus))}
                              </span>
                            )}
                          </div>
                          <div className="grid gap-1 text-caption text-muted-foreground md:grid-cols-2">
                            <div className="flex items-center gap-1.5">
                              <BrainCircuit className="h-3.5 w-3.5" />
                              {t(aiAccessLabels[record.aiAccess])}
                            </div>
                            <div className="flex items-center gap-1.5">
                              <Coins className="h-3.5 w-3.5" />
                              {t("participants.creditLimit", { count: record.creditLimit })}
                            </div>
                            <div className="flex items-center gap-1.5">
                              <Shield className="h-3.5 w-3.5" />
                              {t(financeVisibilityLabels[record.financeVisibility])}
                            </div>
                            <div className="flex items-center gap-1.5">
                              <FileText className="h-3.5 w-3.5" />
                              {t(internalDocsVisibilityLabels[record.internalDocsVisibility])}
                            </div>
                          </div>
                          {warnings.length > 0 && (
                            <div className="rounded-card border border-warning/40 bg-warning/10 p-3">
                              <p className="text-caption font-medium text-foreground">{t("participants.sensitiveAccess")}</p>
                              <ul className="mt-1 space-y-1 text-caption text-muted-foreground">
                                {warnings.map((warning) => (
                                  <li key={warning}>{warning}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                        {canEditPermissionRecord(record) && (
                          <Button variant="outline" onClick={() => openPermissionEditor(record)}>
                            {t("participants.editAccessButton")}
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </TabsContent>
      </Tabs>

      <Dialog
        open={inviteOpen}
        onOpenChange={(open) => {
          setInviteOpen(open);
          if (!open) resetInviteDialog();
        }}
      >
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("participants.inviteDialog.title")}</DialogTitle>
            <DialogDescription>
              {t("participants.inviteDialog.description")}
            </DialogDescription>
          </DialogHeader>

          <SettingsSection title={t("participants.inviteDialog.section.title")} description={t("participants.inviteDialog.section.description")}>
            <div>
              <label className="text-caption font-medium text-foreground">{t("participants.table.email")}</label>
              <Input
                placeholder={t("participants.inviteDialog.emailPlaceholder")}
                value={inviteEmail}
                onChange={(event) => setInviteEmail(event.target.value)}
                className="mt-1"
              />
            </div>
          </SettingsSection>

          <PermissionFormSections
            form={inviteForm}
            onFormChange={(updater) => setInviteForm((current) => updater(current))}
            roleOptions={inviteRoleOptions}
            aiOptions={aiOptions}
            financeOptions={financeOptions}
            internalDocsOptions={internalDocsOptions}
            availableViewerRegimes={availableViewerRegimes}
            projectMode={projectMode}
          />

          {activeOrg && (
            <label className="flex items-center gap-2 px-1 text-body-sm text-foreground cursor-pointer">
              <Checkbox
                checked={inviteAddToOrg}
                onCheckedChange={(checked) => setInviteAddToOrg(checked === true)}
              />
              <span>{t("participants.invite.addToOrgLabel", { name: activeOrg.name })}</span>
            </label>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setInviteOpen(false)}>{t("participants.inviteDialog.cancel")}</Button>
            <Button onClick={handleInvite} disabled={createInviteMutation.isPending}>
              {createInviteMutation.isPending ? t("participants.inviteDialog.sending") : t("participants.inviteDialog.send")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={permissionDialogOpen}
        onOpenChange={(open) => {
          setPermissionDialogOpen(open);
          if (!open) setPermissionTarget(null);
        }}
      >
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{permissionTargetRecord?.displayName ? t("participants.permissionDialog.title", { name: permissionTargetRecord.displayName }) : t("participants.permissionDialog.titleFallback")}</DialogTitle>
            <DialogDescription>
              {t("participants.permissionDialog.description")}
            </DialogDescription>
          </DialogHeader>

          {permissionTargetRecord && (
            <>
              <SettingsSection title={t("participants.permissionDialog.section.title")} description={t("participants.permissionDialog.section.description")}>
                <div className="flex flex-wrap gap-2 text-caption">
                  <span className="rounded-pill bg-muted px-2 py-0.5 text-muted-foreground">{permissionTargetRecord.targetKindLabel}</span>
                  <span className="rounded-pill bg-muted px-2 py-0.5 text-muted-foreground">{permissionTargetRecord.secondaryLabel}</span>
                </div>
              </SettingsSection>

              <PermissionFormSections
                form={permissionForm}
                onFormChange={(updater) => setPermissionForm((current) => updater(current))}
                roleOptions={editRoleOptions.length > 0 ? editRoleOptions : [permissionTargetRecord.role]}
                aiOptions={aiOptions}
                financeOptions={financeOptions}
                internalDocsOptions={internalDocsOptions}
                availableViewerRegimes={availableViewerRegimes}
                projectMode={projectMode}
              />
            </>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setPermissionDialogOpen(false)}>{t("participants.permissionDialog.cancel")}</Button>
            <Button onClick={handleSavePermissions} disabled={savePermissionsMutation.isPending || !permissionTargetRecord}>
              {savePermissionsMutation.isPending ? t("participants.permissionDialog.saving") : t("participants.permissionDialog.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
