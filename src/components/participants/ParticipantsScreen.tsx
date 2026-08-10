import { useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  BrainCircuit,
  Coins,
  Crown,
  Eye,
  FileText,
  History,
  Mail,
  MoreVertical,
  Plus,
  Send,
  Shield,
  SlidersHorizontal,
  Trash2,
  Users,
  Wrench,
  XCircle,
} from "lucide-react";
import { useCurrentUser, useProject, useProjectInvites, useWorkspaceMode } from "@/hooks/use-mock-data";
import { useActiveOrg, useOrgMemberProfileIds } from "@/hooks/use-orgs";
import { useActiveSubscription } from "@/hooks/useActiveSubscription";
import { useRuntimeAuth } from "@/hooks/use-runtime-auth";
import { usePermission } from "@/lib/permissions";
import { addEvent, getUserById } from "@/data/store";
import {
  createWorkspaceProjectInvite,
  ProjectInviteNoLongerPendingError,
  ProjectMemberRemoveNotPermittedError,
  removeWorkspaceProjectMember,
  revokeWorkspaceProjectInvite,
  sendWorkspaceProjectInviteEmail,
  updateWorkspaceProjectInvite,
  updateWorkspaceProjectMemberRole,
  type WorkspaceProjectInvite,
} from "@/data/workspace-source";
import { workspaceQueryKeys } from "@/hooks/use-workspace-source";
import { describeInviteCreateError, describeInviteSendError } from "@/lib/invite-error-copy";
import { showTierLimitPaywall, showTierLimitPaywallByType } from "@/lib/tier-limit-error";
import { getTierLimits } from "@/data/tier-limits";
import { trackEvent } from "@/lib/analytics";
import { EmptyState } from "@/components/EmptyState";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "@/hooks/use-toast";
import {
  aiAccessLabels,
  canRemoveMember,
  canRevokeInvite,
  financeVisibilityLabels,
  getDefaultFinanceVisibility,
  getDefaultInternalDocsVisibility,
  internalDocsVisibilityLabels,
  roleLabels,
  type ActorDelegationContext,
} from "@/lib/participant-role-policy";
import {
  effectiveFinanceVisibility,
  effectiveInternalDocsVisibility,
  hasManualAxisConfig,
} from "@/lib/participant-access-preview";
import {
  ParticipantDrawer,
  type ParticipantDrawerMode,
} from "@/components/participants/ParticipantDrawer";
import {
  AI_SEGMENT_LABELS,
  DOCS_SEGMENT_LABELS,
  FINANCE_SEGMENT_LABELS,
  isEditorSeatRole,
  parseCreditLimit,
  recordAxes,
  resolveViewerRegime,
  seatLimitReached,
  type ParticipantFormState,
  type ParticipantRecord,
  type SeatInfo,
} from "@/components/participants/participants-shared";
import type { Member, MemberRole, UserPlan } from "@/types/entities";

const ROLE_ICONS: Record<MemberRole, typeof Crown> = {
  owner: Crown,
  co_owner: Shield,
  contractor: Wrench,
  viewer: Eye,
};

const ROLE_SORT_ORDER: Record<MemberRole, number> = { owner: 0, co_owner: 1, contractor: 2, viewer: 3 };

const INVITE_STATUS_KEYS: Record<WorkspaceProjectInvite["status"], string> = {
  pending: "participants.inviteStatus.pending",
  accepted: "participants.inviteStatus.accepted",
  expired: "participants.inviteStatus.expired",
  revoked: "participants.inviteStatus.revoked",
};

function inviteStatusClassName(status: WorkspaceProjectInvite["status"]) {
  if (status === "pending") return "bg-info/10 text-info";
  if (status === "accepted") return "bg-success/10 text-success";
  // text-warning, not text-warning-foreground: the foreground token is white
  // and unreadable on the 10% tint.
  if (status === "expired") return "bg-warning/10 text-warning";
  return "bg-muted text-muted-foreground";
}

function readInternalDocsVisibility(record: unknown): Member["internal_docs_visibility"] {
  if (!record || typeof record !== "object") return undefined;
  const candidate = (record as { internal_docs_visibility?: unknown }).internal_docs_visibility;
  return candidate === "none" || candidate === "view" || candidate === "edit" ? candidate : undefined;
}

/**
 * Our own domain-error classes carry developer-English messages that must not
 * reach a Russian toast; show the localized fallback for those. Supabase /
 * PostgREST errors keep their message (often the actionable backend reason).
 */
function describeMutationError(error: unknown, localizedFallback: string): string {
  if (error instanceof ProjectMemberRemoveNotPermittedError
    || error instanceof ProjectInviteNoLongerPendingError) {
    return localizedFallback;
  }
  return error instanceof Error ? error.message : localizedFallback;
}

/**
 * Demo/local only: the legacy `UserPlan` vocabulary (free|pro|business) maps
 * onto the billing tier codes (free|master|brigade) so seeded workspaces show
 * realistic seat counters. Real environments read `subscriptions.plan_code`.
 */
function mapLegacyPlanToTierCode(plan: UserPlan): string {
  if (plan === "pro") return "master";
  if (plan === "business") return "brigade";
  return "free";
}

type ConfirmAction =
  | { kind: "remove"; record: ParticipantRecord }
  | { kind: "revoke"; record: ParticipantRecord };

type InviteEmailDeliveryOutcome =
  | { kind: "not_applicable" }
  | { kind: "sent"; recipientEmail: string }
  | { kind: "failed"; message: string };

export default function ParticipantsScreen() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const projectId = id!;
  const { project, members } = useProject(projectId);
  const invites = useProjectInvites(projectId);
  const perm = usePermission(projectId);
  const workspaceMode = useWorkspaceMode();
  const queryClient = useQueryClient();
  const currentUser = useCurrentUser();
  const activeOrg = useActiveOrg();
  const { data: orgMemberIds } = useOrgMemberProfileIds(activeOrg?.id);
  const orgMemberIdSet = useMemo(() => new Set(orgMemberIds ?? []), [orgMemberIds]);
  const subscription = useActiveSubscription();
  const runtimeAuth = useRuntimeAuth();

  const projectMode = project?.project_mode === "build_myself" ? "build_myself" : "contractor";

  const actorRole = perm.role;
  const actorMember = members.find((member) => member.user_id === currentUser.id) ?? null;
  const actor: ActorDelegationContext = {
    role: actorRole,
    aiAccess: actorMember?.ai_access ?? perm.seam.membership?.ai_access ?? undefined,
    financeVisibility: actorMember?.finance_visibility ?? perm.seam.membership?.finance_visibility ?? undefined,
    internalDocsVisibility: readInternalDocsVisibility(actorMember) ?? undefined,
  };

  const canManageAccess = perm.can("member.invite") && workspaceMode.kind !== "pending-supabase";
  const workspaceKey = workspaceMode.kind === "supabase" ? workspaceMode.profileId : workspaceMode.kind;
  const membersQueryKey = workspaceQueryKeys.projectMembers(workspaceKey, projectId);
  const invitesQueryKey = workspaceQueryKeys.projectInvites(workspaceKey, projectId);

  const pendingInvites = useMemo(() => invites.filter((invite) => invite.status === "pending"), [invites]);
  const inviteHistory = useMemo(() => invites.filter((invite) => invite.status !== "pending"), [invites]);

  const memberRecords = useMemo<ParticipantRecord[]>(() => (
    [...members]
      .sort((a, b) => ROLE_SORT_ORDER[a.role] - ROLE_SORT_ORDER[b.role])
      .map((member) => {
        const user = getUserById(member.user_id);
        return {
          target: { kind: "member" as const, userId: member.user_id },
          key: `member-${member.user_id}`,
          displayName: user?.name ?? member.user_id,
          secondaryLabel: user?.email || t("participants.noEmail"),
          role: member.role,
          aiAccess: member.ai_access,
          financeVisibility: member.finance_visibility ?? getDefaultFinanceVisibility(member.role),
          internalDocsVisibility: readInternalDocsVisibility(member) ?? getDefaultInternalDocsVisibility(member.role),
          viewerRegime: member.viewer_regime,
          creditLimit: member.credit_limit,
          usedCredits: member.used_credits,
          isSelf: member.user_id === currentUser.id,
        };
      })
  ), [members, currentUser.id, t]);

  const inviteRecords = useMemo<ParticipantRecord[]>(() => (
    pendingInvites.map((invite) => ({
      target: { kind: "invite" as const, inviteId: invite.id },
      key: `invite-${invite.id}`,
      displayName: invite.email,
      secondaryLabel: t("participants.invitedByLabel", { name: getUserById(invite.invited_by)?.name ?? invite.invited_by }),
      role: invite.role,
      aiAccess: invite.ai_access,
      financeVisibility: invite.finance_visibility ?? getDefaultFinanceVisibility(invite.role),
      internalDocsVisibility: readInternalDocsVisibility(invite) ?? getDefaultInternalDocsVisibility(invite.role),
      viewerRegime: invite.viewer_regime ?? undefined,
      creditLimit: invite.credit_limit,
      inviteStatus: invite.status,
      isSelf: false,
    }))
  ), [pendingInvites, t]);

  const allRecords = useMemo(() => [...memberRecords, ...inviteRecords], [memberRecords, inviteRecords]);

  // ── Seat limits (PRD P0-6). DB truth: the limits trigger counts MEMBER rows
  // (never the owner's own row, never pending invites) against the OWNER's
  // current subscription plan; enforcement happens when an invite is accepted.
  const seat = useMemo<SeatInfo>(() => {
    const editorsUsed = members.filter((member) => isEditorSeatRole(member.role)).length;
    const viewersUsed = members.filter((member) => member.role === "viewer").length;
    const editorsPending = pendingInvites.filter((invite) => isEditorSeatRole(invite.role)).length;
    const viewersPending = pendingInvites.filter((invite) => invite.role === "viewer").length;

    // Limits are knowable only for the owner (the trigger reads the OWNER's
    // subscription, and RLS hides other people's subscriptions). Unknown plan
    // (co_owner actor, auth still loading, local dev mode) → count-only header,
    // no proactive gating; the reactive paywall still catches DB rejections.
    let planCode: string | null = null;
    if (actorRole === "owner") {
      if (workspaceMode.kind === "supabase") {
        // A FETCH ERROR is not "no subscription": treating it as free (0/0)
        // would hard-paywall a paying owner on a transient blip. Only a clean
        // load with no row means free; error/loading → unknown (count-only).
        planCode = runtimeAuth.status === "authenticated" && !subscription.isLoading && !subscription.isError
          ? (subscription.subscription?.plan_code ?? "free")
          : null;
      } else if (workspaceMode.kind === "demo") {
        planCode = mapLegacyPlanToTierCode(currentUser.plan);
      }
    }
    const limits = planCode ? getTierLimits(planCode) : null;

    return {
      editorsUsed,
      editorsPending,
      viewersUsed,
      viewersPending,
      editorsLimit: limits ? limits.editors_per_project : null,
      viewersLimit: limits ? limits.viewers_per_project : null,
    };
  }, [members, pendingInvites, actorRole, workspaceMode.kind, subscription.subscription, subscription.isLoading, subscription.isError, runtimeAuth.status, currentUser.plan]);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerMode, setDrawerMode] = useState<ParticipantDrawerMode>({ kind: "create" });
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  // Content survives the null-out on close so the exit animation (and screen
  // readers) never see the dialog with an empty {{name}}/{{email}}.
  const lastConfirmActionRef = useRef<ConfirmAction | null>(null);
  const confirmContent = confirmAction ?? lastConfirmActionRef.current;

  const drawerRecord = useMemo(() => {
    if (drawerMode.kind !== "edit") return null;
    // Re-resolve from fresh data so optimistic updates flow into an open drawer.
    return allRecords.find((record) => record.key === drawerMode.record.key) ?? drawerMode.record;
  }, [drawerMode, allRecords]);

  const memberEmails = useMemo(
    () => new Set(members
      .map((member) => getUserById(member.user_id)?.email?.toLowerCase() ?? "")
      .filter(Boolean)),
    [members],
  );
  const pendingInviteEmails = useMemo(
    () => new Set(pendingInvites.map((invite) => invite.email.toLowerCase())),
    [pendingInvites],
  );

  // ── Mutations ─────────────────────────────────────────────────────────────

  const createInviteMutation = useMutation({
    mutationFn: async (input: { email: string; form: ParticipantFormState; addToOrg: boolean }) => {
      const modeForInvite = workspaceMode.kind === "pending-supabase" ? { kind: "local" as const } : workspaceMode;
      const createdInvite = await createWorkspaceProjectInvite(modeForInvite, {
        projectId,
        email: input.email,
        role: input.form.role,
        aiAccess: input.form.aiAccess,
        viewerRegime: resolveViewerRegime(input.form.role, projectMode, input.form.viewerRegime) ?? null,
        creditLimit: parseCreditLimit(input.form.creditLimit),
        invitedBy: currentUser.id,
        financeVisibility: input.form.financeVisibility,
        internalDocsVisibility: input.form.internalDocsVisibility,
        addToOrgId: input.addToOrg && activeOrg ? activeOrg.id : null,
      });

      let emailDelivery: InviteEmailDeliveryOutcome = { kind: "not_applicable" };
      if (workspaceMode.kind === "supabase") {
        try {
          const delivery = await sendWorkspaceProjectInviteEmail(workspaceMode, createdInvite.id);
          emailDelivery = delivery.kind === "skipped"
            ? { kind: "not_applicable" }
            : { kind: "sent", recipientEmail: delivery.payload.recipientEmail || createdInvite.email };
        } catch (err) {
          emailDelivery = {
            kind: "failed",
            message: describeInviteSendError(err, t, t("participants.error.emailSendFallback")),
          };
        }
      }
      return { createdInvite, emailDelivery };
    },
    onSuccess: ({ createdInvite, emailDelivery }, variables) => {
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
      } else {
        toast({
          title: t("participants.toast.invitationSent"),
          description: t("participants.toast.invitationSentDesc", {
            email: emailDelivery.kind === "sent" ? emailDelivery.recipientEmail : createdInvite.email,
            role: t(roleLabels[createdInvite.role]),
          }),
        });
      }

      trackEvent("participants_invite_sent", {
        role: variables.form.role,
        manual_axes: hasManualAxisConfig(variables.form.role, {
          aiAccess: variables.form.aiAccess,
          financeVisibility: variables.form.financeVisibility,
          internalDocsVisibility: variables.form.internalDocsVisibility,
        }),
      });
      setDrawerOpen(false);
    },
    onError: (error) => {
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

  const savePermissionsMutation = useMutation({
    mutationFn: async (input: { record: ParticipantRecord; form: ParticipantFormState }) => {
      const target = input.record.target;
      const mode = workspaceMode.kind === "pending-supabase" ? { kind: "local" as const } : workspaceMode;
      if (target.kind === "member") {
        return updateWorkspaceProjectMemberRole(mode, {
          projectId,
          userId: target.userId,
          role: input.form.role,
          aiAccess: input.form.aiAccess,
          viewerRegime: resolveViewerRegime(input.form.role, projectMode, input.form.viewerRegime),
          creditLimit: parseCreditLimit(input.form.creditLimit),
          financeVisibility: input.form.financeVisibility,
          internalDocsVisibility: input.form.internalDocsVisibility,
        });
      }
      // Deliberately omit `status`: an access edit must not write a stale
      // cached status back onto the row, which would resurrect a concurrently
      // revoked/accepted invite to 'pending' and re-arm its token. Status
      // transitions are owned by the revoke mutation and the accept RPC.
      return updateWorkspaceProjectInvite(mode, {
        id: target.inviteId,
        projectId,
        role: input.form.role,
        aiAccess: input.form.aiAccess,
        viewerRegime: resolveViewerRegime(input.form.role, projectMode, input.form.viewerRegime) ?? null,
        creditLimit: parseCreditLimit(input.form.creditLimit),
        financeVisibility: input.form.financeVisibility,
        internalDocsVisibility: input.form.internalDocsVisibility,
      });
    },
    onMutate: async (input) => {
      if (workspaceMode.kind !== "supabase") return undefined;
      const target = input.record.target;
      if (target.kind === "member") {
        await queryClient.cancelQueries({ queryKey: membersQueryKey });
        const previousMembers = queryClient.getQueryData<Member[]>(membersQueryKey) ?? [];
        queryClient.setQueryData<Member[]>(membersQueryKey, previousMembers.map((member) => (
          member.project_id === projectId && member.user_id === target.userId
            ? {
                ...member,
                role: input.form.role,
                ai_access: input.form.aiAccess,
                viewer_regime: resolveViewerRegime(input.form.role, projectMode, input.form.viewerRegime),
                credit_limit: parseCreditLimit(input.form.creditLimit),
                finance_visibility: input.form.financeVisibility,
                internal_docs_visibility: input.form.internalDocsVisibility,
              } as Member
            : member
        )));
        return { previousMembers };
      }
      await queryClient.cancelQueries({ queryKey: invitesQueryKey });
      const previousInvites = queryClient.getQueryData<WorkspaceProjectInvite[]>(invitesQueryKey) ?? [];
      queryClient.setQueryData<WorkspaceProjectInvite[]>(invitesQueryKey, previousInvites.map((invite) => (
        invite.id === target.inviteId
          ? {
              ...invite,
              role: input.form.role,
              ai_access: input.form.aiAccess,
              viewer_regime: resolveViewerRegime(input.form.role, projectMode, input.form.viewerRegime) ?? null,
              credit_limit: parseCreditLimit(input.form.creditLimit),
              finance_visibility: input.form.financeVisibility,
              internal_docs_visibility: input.form.internalDocsVisibility,
            } as WorkspaceProjectInvite
          : invite
      )));
      return { previousInvites };
    },
    onSuccess: (_result, variables) => {
      toast({
        title: t("participants.toast.accessUpdated"),
        description: t("participants.toast.accessUpdatedDesc", {
          name: variables.record.displayName,
          role: t(roleLabels[variables.form.role]),
        }),
      });
      trackEvent("participants_access_updated", {
        target: variables.record.target.kind,
        role: variables.form.role,
        role_changed: variables.form.role !== variables.record.role,
      });
      setDrawerOpen(false);
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
      if (variables.record.target.kind === "member") {
        await queryClient.invalidateQueries({ queryKey: membersQueryKey });
      } else {
        await queryClient.invalidateQueries({ queryKey: invitesQueryKey });
      }
    },
  });

  const removeMemberMutation = useMutation({
    mutationFn: async (record: ParticipantRecord) => {
      if (record.target.kind !== "member") throw new Error("not a member");
      const mode = workspaceMode.kind === "pending-supabase" ? { kind: "local" as const } : workspaceMode;
      await removeWorkspaceProjectMember(mode, { projectId, userId: record.target.userId });
    },
    onSuccess: (_result, record) => {
      toast({
        title: t("participants.toast.memberRemoved"),
        description: t("participants.toast.memberRemovedDesc", { name: record.displayName }),
      });
      trackEvent("participants_member_removed", { role: record.role });
      setDrawerOpen(false);
    },
    onError: (error) => {
      toast({
        title: t("participants.toast.memberRemoveFailed"),
        description: describeMutationError(error, t("participants.toast.memberRemoveFailedDesc")),
        variant: "destructive",
      });
    },
    onSettled: async () => {
      if (workspaceMode.kind === "supabase") {
        await queryClient.invalidateQueries({ queryKey: membersQueryKey });
      }
    },
  });

  const revokeInviteMutation = useMutation({
    mutationFn: async (record: ParticipantRecord) => {
      if (record.target.kind !== "invite") throw new Error("not an invite");
      const mode = workspaceMode.kind === "pending-supabase" ? { kind: "local" as const } : workspaceMode;
      return revokeWorkspaceProjectInvite(mode, { id: record.target.inviteId, projectId });
    },
    onSuccess: (_result, record) => {
      toast({
        title: t("participants.toast.inviteRevoked"),
        description: t("participants.toast.inviteRevokedDesc", { email: record.displayName }),
      });
      trackEvent("participants_invite_revoked", { role: record.role });
      setDrawerOpen(false);
    },
    onError: (error) => {
      toast({
        title: t("participants.toast.inviteRevokeFailed"),
        description: describeMutationError(error, t("participants.toast.inviteRevokeFailedDesc")),
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
    mutationFn: async (record: ParticipantRecord) => {
      if (record.target.kind !== "invite") throw new Error("not an invite");
      if (workspaceMode.kind !== "supabase") {
        throw new Error(t("participants.error.resendNotInSupabase"));
      }
      return sendWorkspaceProjectInviteEmail(workspaceMode, record.target.inviteId);
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
      trackEvent("participants_invite_resent", {});
    },
    onError: (error) => {
      toast({
        title: t("participants.toast.resendFailed"),
        description: describeInviteSendError(error, t, t("participants.toast.resendFailedDesc")),
        variant: "destructive",
      });
    },
  });

  // ── Handlers ──────────────────────────────────────────────────────────────

  function openCreateDrawer() {
    const editorsBlocked = seatLimitReached(seat.editorsUsed, seat.editorsLimit);
    const viewersBlocked = seatLimitReached(seat.viewersUsed, seat.viewersLimit);
    if (editorsBlocked && viewersBlocked) {
      showTierLimitPaywallByType("editors_per_project", t);
      trackEvent("participants_seat_paywall_shown", { source: "invite_button" });
      return;
    }
    setDrawerMode({ kind: "create" });
    setDrawerOpen(true);
    trackEvent("participants_invite_drawer_opened", {});
  }

  function openRecordDrawer(record: ParticipantRecord) {
    setDrawerMode({ kind: "edit", record });
    setDrawerOpen(true);
  }

  function handleCreate(input: { email: string; form: ParticipantFormState; addToOrg: boolean }) {
    if (pendingInviteEmails.has(input.email)) {
      toast({
        title: t("participants.toast.alreadyInvited"),
        description: t("participants.toast.alreadyInvitedDesc"),
        variant: "destructive",
      });
      return;
    }
    if (memberEmails.has(input.email)) {
      toast({
        title: t("participants.toast.alreadyAdded"),
        description: t("participants.toast.alreadyAddedDesc"),
        variant: "destructive",
      });
      return;
    }
    createInviteMutation.mutate(input);
  }

  function requestRemove(record: ParticipantRecord) {
    const action: ConfirmAction = { kind: "remove", record };
    lastConfirmActionRef.current = action;
    setConfirmAction(action);
  }

  function requestRevoke(record: ParticipantRecord) {
    const action: ConfirmAction = { kind: "revoke", record };
    lastConfirmActionRef.current = action;
    setConfirmAction(action);
  }

  function proceedConfirmAction() {
    if (!confirmAction) return;
    if (confirmAction.kind === "remove") {
      removeMemberMutation.mutate(confirmAction.record);
    } else {
      revokeInviteMutation.mutate(confirmAction.record);
    }
    setConfirmAction(null);
  }

  // ── Render helpers ────────────────────────────────────────────────────────

  const resendAvailable = workspaceMode.kind === "supabase" && canManageAccess;

  function seatLine(used: number, pending: number, limit: number | null, labelKey: string): string {
    const base = limit == null
      ? t(`${labelKey}.unknown`, { used })
      : limit < 0
        ? t(`${labelKey}.unlimited`, { used })
        : t(`${labelKey}.limited`, { used, limit });
    return pending > 0 ? `${base} ${t("participants.seats.pendingSuffix", { count: pending })}` : base;
  }

  const editorsAtLimit = seatLimitReached(seat.editorsUsed, seat.editorsLimit);

  function renderAccessIndicators(record: ParticipantRecord) {
    const finance = effectiveFinanceVisibility(record.role, record.financeVisibility);
    const docs = effectiveInternalDocsVisibility(record.role, record.internalDocsVisibility);
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        <span
          title={`${t("participants.drawer.axis.finance")}: ${t(financeVisibilityLabels[finance])}`}
          className={`inline-flex items-center gap-1 rounded-pill px-1.5 py-0.5 text-caption ${
            finance === "detail" ? "bg-warning/10 text-warning" : finance === "summary" ? "bg-info/10 text-info" : "bg-muted text-muted-foreground"
          }`}
        >
          <Coins className="h-3 w-3" />
          <span className="hidden lg:inline">{t(FINANCE_SEGMENT_LABELS[finance])}</span>
        </span>
        <span
          title={`${t("participants.drawer.axis.internalDocs")}: ${t(internalDocsVisibilityLabels[docs])}`}
          className={`inline-flex items-center gap-1 rounded-pill px-1.5 py-0.5 text-caption ${
            docs === "edit" ? "bg-warning/10 text-warning" : docs === "view" ? "bg-info/10 text-info" : "bg-muted text-muted-foreground"
          }`}
        >
          <FileText className="h-3 w-3" />
          <span className="hidden lg:inline">{t(DOCS_SEGMENT_LABELS[docs])}</span>
        </span>
        <span
          title={`${t("participants.drawer.axis.ai")}: ${t(aiAccessLabels[record.aiAccess])}`}
          className={`inline-flex items-center gap-1 rounded-pill px-1.5 py-0.5 text-caption ${
            record.aiAccess === "project_pool" ? "bg-accent/10 text-accent" : record.aiAccess === "consult_only" ? "bg-info/10 text-info" : "bg-muted text-muted-foreground"
          }`}
        >
          <BrainCircuit className="h-3 w-3" />
          <span className="hidden lg:inline">{t(AI_SEGMENT_LABELS[record.aiAccess])}</span>
        </span>
      </div>
    );
  }

  function renderRow(record: ParticipantRecord) {
    const RoleIcon = ROLE_ICONS[record.role];
    const isInvite = record.target.kind === "invite";
    const manual = hasManualAxisConfig(record.role, recordAxes(record));
    const removable = record.target.kind === "member" && !record.isSelf && canRemoveMember(actorRole, record.role);
    const revocable = isInvite && record.inviteStatus === "pending"
      && canRevokeInvite(actor, { role: record.role, ...recordAxes(record) });
    const showMenu = canManageAccess;

    return (
      <li key={record.key}>
        <div
          role="button"
          tabIndex={0}
          onClick={() => openRecordDrawer(record)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              openRecordDrawer(record);
            }
          }}
          className="flex w-full cursor-pointer items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted/40 sm:px-4"
        >
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent/10 text-caption font-semibold text-accent">
            {isInvite ? <Mail className="h-3.5 w-3.5" /> : record.displayName.charAt(0)}
          </div>

          <div className="min-w-0 flex-1">
            <p className="truncate text-body-sm font-medium text-foreground">
              {record.displayName}
              {record.isSelf && <span className="ml-1 text-caption text-muted-foreground">{t("participants.you")}</span>}
              {!isInvite && activeOrg && record.target.kind === "member" && orgMemberIdSet.has(record.target.userId) && (
                <span className="ml-2 inline-flex items-center rounded-pill border border-accent/30 bg-accent/10 px-1.5 py-0 text-[10px] font-medium text-accent" title={activeOrg.name}>
                  {t("participants.orgTag")}
                </span>
              )}
            </p>
            <p className="truncate text-caption text-muted-foreground">{record.secondaryLabel}</p>
          </div>

          <div className="hidden shrink-0 items-center gap-1.5 sm:flex">
            <span className="inline-flex items-center gap-1 rounded-pill bg-accent/10 px-2 py-0.5 text-caption text-accent">
              <RoleIcon className="h-3 w-3" />
              {t(roleLabels[record.role])}
            </span>
            {isInvite && record.inviteStatus && (
              <span className={`rounded-pill px-2 py-0.5 text-caption font-medium ${inviteStatusClassName(record.inviteStatus)}`}>
                {t(INVITE_STATUS_KEYS[record.inviteStatus])}
              </span>
            )}
            {manual && (
              <Badge variant="outline" className="gap-1 border-info/40 bg-info/10 text-info" title={t("participants.manualBadgeTitle")}>
                <SlidersHorizontal className="h-3 w-3" />
                <span className="hidden xl:inline">{t("participants.manualBadge")}</span>
              </Badge>
            )}
          </div>

          <div className="hidden shrink-0 md:block">{renderAccessIndicators(record)}</div>

          {showMenu ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0"
                  onClick={(event) => event.stopPropagation()}
                  aria-label={t("participants.table.actions")}
                >
                  <MoreVertical className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="glass-elevated rounded-card" onClick={(event) => event.stopPropagation()}>
                <DropdownMenuItem onClick={() => openRecordDrawer(record)}>
                  <Shield className="mr-2 h-3.5 w-3.5" /> {t("participants.dropdown.editAccess")}
                </DropdownMenuItem>
                {isInvite && record.inviteStatus === "pending" && resendAvailable && (
                  <DropdownMenuItem
                    disabled={resendInviteEmailMutation.isPending}
                    onClick={() => resendInviteEmailMutation.mutate(record)}
                  >
                    <Send className="mr-2 h-3.5 w-3.5" /> {t("participants.dropdown.resendEmail")}
                  </DropdownMenuItem>
                )}
                {(revocable || removable) && <DropdownMenuSeparator />}
                {revocable && (
                  <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => requestRevoke(record)}>
                    <XCircle className="mr-2 h-3.5 w-3.5" /> {t("participants.actions.revokeInvite")}
                  </DropdownMenuItem>
                )}
                {removable && (
                  <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => requestRemove(record)}>
                    <Trash2 className="mr-2 h-3.5 w-3.5" /> {t("participants.actions.removeMember")}
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : <div className="h-7 w-7 shrink-0" />}
        </div>
      </li>
    );
  }

  return (
    <div className="space-y-sp-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-h3 text-foreground">{t("participants.header")}</h2>
          <p className="text-caption text-muted-foreground">
            {seatLine(seat.editorsUsed, seat.editorsPending, seat.editorsLimit, "participants.seats.editors")}
            {" · "}
            {seatLine(seat.viewersUsed, seat.viewersPending, seat.viewersLimit, "participants.seats.viewers")}
            {editorsAtLimit && (
              <>
                {" · "}
                <Link to="/#pricing" className="text-accent underline-offset-2 hover:underline">
                  {t("participants.seats.upgrade")}
                </Link>
              </>
            )}
          </p>
        </div>
        {canManageAccess && (
          <Button onClick={openCreateDrawer} className="bg-accent text-accent-foreground hover:bg-accent/90">
            <Plus className="mr-1 h-4 w-4" /> {t("participants.invite")}
          </Button>
        )}
      </div>

      <section className="space-y-2">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-accent" />
          <h3 className="text-body font-semibold text-foreground">{t("participants.list.title")}</h3>
        </div>
        {allRecords.length === 0 ? (
          <EmptyState
            icon={Users}
            title={t("participants.empty.noMembers.title")}
            description={t("participants.empty.noMembers.description")}
          />
        ) : (
          <div className="glass overflow-hidden rounded-card">
            <ul className="divide-y divide-border/50">
              {allRecords.map(renderRow)}
            </ul>
          </div>
        )}
      </section>

      {inviteHistory.length > 0 && (
        <section className="space-y-2">
          <div className="flex items-center gap-2">
            <History className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-body font-semibold text-foreground">{t("participants.section.inviteHistory")}</h3>
          </div>
          <div className="glass overflow-hidden rounded-card">
            <ul className="divide-y divide-border/50">
              {inviteHistory.map((invite) => (
                <li key={invite.id} className="flex items-center gap-3 px-3 py-2 sm:px-4">
                  <Mail className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate text-body-sm text-foreground">{invite.email}</span>
                  <span className="hidden text-caption text-muted-foreground sm:inline">{t(roleLabels[invite.role])}</span>
                  <span className={`rounded-pill px-2 py-0.5 text-caption font-medium ${inviteStatusClassName(invite.status)}`}>
                    {t(INVITE_STATUS_KEYS[invite.status])}
                  </span>
                  <span className="hidden text-caption text-muted-foreground sm:inline">
                    {new Date(invite.created_at).toLocaleDateString()}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      <ParticipantDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        mode={drawerRecord ? { kind: "edit", record: drawerRecord } : { kind: "create" }}
        actor={actor}
        projectMode={projectMode}
        seat={seat}
        resendAvailable={resendAvailable}
        activeOrgName={activeOrg?.name ?? null}
        saving={createInviteMutation.isPending || savePermissionsMutation.isPending}
        removing={removeMemberMutation.isPending}
        revoking={revokeInviteMutation.isPending}
        resending={resendInviteEmailMutation.isPending}
        onCreate={handleCreate}
        onSave={(input) => savePermissionsMutation.mutate(input)}
        onRemoveMember={requestRemove}
        onRevokeInvite={requestRevoke}
        onResendInvite={(record) => resendInviteEmailMutation.mutate(record)}
      />

      <AlertDialog open={confirmAction != null} onOpenChange={(open) => { if (!open) setConfirmAction(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmContent?.kind === "remove"
                ? t("participants.confirm.remove.title")
                : t("participants.confirm.revoke.title")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmContent?.kind === "remove"
                ? t("participants.confirm.remove.body", { name: confirmContent.record.displayName })
                : t("participants.confirm.revoke.body", { email: confirmContent?.record.displayName ?? "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("participants.confirm.sensitive.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={proceedConfirmAction}
            >
              {confirmContent?.kind === "remove"
                ? t("participants.confirm.remove.confirmAction")
                : t("participants.confirm.revoke.confirmAction")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
