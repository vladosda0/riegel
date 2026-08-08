import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import ProjectParticipants from "@/pages/project/ProjectParticipants";
import type { WorkspaceProjectInvite } from "@/data/workspace-source";
import * as workspaceSource from "@/data/workspace-source";
import {
  __unsafeResetStoreForTests,
  addMember,
  addProject,
  addProjectInvite,
  updateMember,
} from "@/data/store";
import {
  clearDemoSession,
  clearStoredAuthProfile,
  setAuthRole,
  setStoredAuthProfile,
} from "@/lib/auth-state";
import * as useMockData from "@/hooks/use-mock-data";
import * as toastModule from "@/hooks/use-toast";
import * as permissions from "@/lib/permissions";
import * as activeSubscription from "@/hooks/useActiveSubscription";
import { authenticateRuntimeAuth } from "@/test/runtime-auth";
import type { Member } from "@/types/entities";

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
}

function renderParticipants() {
  const queryClient = createQueryClient();
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/project/project-1/participants"]}>
        <Routes>
          <Route path="/project/:id/participants" element={<ProjectParticipants />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function participantRow(text: string): HTMLElement {
  const row = screen.getByText(text).closest('[role="button"]');
  expect(row).not.toBeNull();
  return row as HTMLElement;
}

async function openRowMenu(rowText: string) {
  const row = participantRow(rowText);
  fireEvent.pointerDown(within(row).getByRole("button", { name: "Actions" }), { button: 0, ctrlKey: false });
}

describe("ProjectParticipants", () => {
  let profileId: string;

  beforeEach(() => {
    Object.defineProperty(window, "PointerEvent", {
      configurable: true,
      writable: true,
      value: MouseEvent,
    });
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      writable: true,
      value: () => {},
    });

    vi.restoreAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    setAuthRole("guest");
    clearStoredAuthProfile();
    clearDemoSession();

    const profile = setStoredAuthProfile({
      email: "owner@example.com",
      name: "Owner User",
    });
    profileId = profile.id;
    setAuthRole("owner");
    __unsafeResetStoreForTests();

    addProject({
      id: "project-1",
      owner_id: profile.id,
      title: "Workspace Project",
      type: "residential",
      project_mode: "contractor",
      automation_level: "assisted",
      current_stage_id: "",
      progress_pct: 0,
    });
    addMember({
      project_id: "project-1",
      user_id: profile.id,
      role: "owner",
      ai_access: "project_pool",
      finance_visibility: "detail",
      credit_limit: 500,
      used_credits: 0,
    });
    addMember({
      project_id: "project-1",
      user_id: "member-2",
      role: "contractor",
      ai_access: "consult_only",
      finance_visibility: "summary",
      credit_limit: 100,
      used_credits: 10,
      internal_docs_visibility: "view",
    } as never);
    addProjectInvite({
      id: "invite-1",
      project_id: "project-1",
      email: "invitee@example.com",
      role: "contractor",
      ai_access: "consult_only",
      viewer_regime: null,
      credit_limit: 50,
      invited_by: profile.id,
      status: "pending",
      invite_token: "invite-token-1",
      accepted_profile_id: null,
      created_at: "2026-03-07T10:00:00.000Z",
      accepted_at: null,
      finance_visibility: "detail",
      internal_docs_visibility: "view",
    } as WorkspaceProjectInvite, "local");
  });

  describe("redesigned single-list screen (default)", () => {
    it("renders one unified list of members and pending invites without tabs (P0-1)", () => {
      renderParticipants();

      expect(screen.queryAllByRole("tab")).toHaveLength(0);
      expect(screen.getByRole("heading", { name: "All members and invitations" })).toBeInTheDocument();
      // Members and the pending invite live in the same list.
      expect(screen.getByText("Owner User")).toBeInTheDocument();
      expect(screen.getByText("member-2")).toBeInTheDocument();
      expect(screen.getByText("invitee@example.com")).toBeInTheDocument();
      expect(screen.getByText("Pending")).toBeInTheDocument();
    });

    it("shows the custom-access badge for members deviating from role defaults (P0-7)", () => {
      renderParticipants();

      // member-2: contractor with finance=summary (default is none).
      expect(screen.getAllByTitle("Access differs from the role defaults").length).toBeGreaterThan(0);
    });

    it("opens the drawer with role cards and a live access preview (P0-2, P0-3)", async () => {
      renderParticipants();

      fireEvent.click(participantRow("member-2"));
      const drawer = await screen.findByRole("dialog", { name: "member-2" });

      expect(within(drawer).getByRole("button", { name: /Co-owner/ })).toBeInTheDocument();
      expect(within(drawer).getByRole("button", { name: /Contractor/ })).toBeInTheDocument();
      expect(within(drawer).getByRole("button", { name: /Viewer/ })).toBeInTheDocument();
      expect(within(drawer).getByText("What member-2 will see")).toBeInTheDocument();
      // Contractor with finance=summary previews money as visible totals.
      expect(within(drawer).getByText(/· totals/)).toBeInTheDocument();
    });

    it("live-updates the preview when an axis changes without saving (P0-3)", async () => {
      renderParticipants();

      fireEvent.click(participantRow("member-2"));
      const drawer = await screen.findByRole("dialog", { name: "member-2" });

      fireEvent.click(within(drawer).getByRole("radio", { name: "Detailed" }));
      expect(within(drawer).getByText(/full detail/)).toBeInTheDocument();
    });

    it("requires confirmation before granting sensitive finance access (P0-4)", async () => {
      const updateSpy = vi.spyOn(workspaceSource, "updateWorkspaceProjectMemberRole");

      renderParticipants();

      fireEvent.click(participantRow("member-2"));
      const drawer = await screen.findByRole("dialog", { name: "member-2" });
      fireEvent.click(within(drawer).getByRole("radio", { name: "Detailed" }));
      fireEvent.click(within(drawer).getByRole("button", { name: "Save access" }));

      // Nothing saved yet: an explicit confirmation stands in the way.
      expect(updateSpy).not.toHaveBeenCalled();
      const confirm = await screen.findByRole("alertdialog", { name: "Grant sensitive access?" });
      expect(within(confirm).getByText(/member-2 will see all prices, payments and wages/)).toBeInTheDocument();

      fireEvent.click(within(confirm).getByRole("button", { name: "Grant" }));
      await waitFor(() => {
        expect(updateSpy).toHaveBeenCalledWith(
          expect.objectContaining({ kind: "local" }),
          expect.objectContaining({ userId: "member-2", financeVisibility: "detail" }),
        );
      });
    });

    it("saves without nagging when no sensitive value is raised (P0-4)", async () => {
      const updateSpy = vi.spyOn(workspaceSource, "updateWorkspaceProjectMemberRole");

      renderParticipants();

      fireEvent.click(participantRow("member-2"));
      const drawer = await screen.findByRole("dialog", { name: "member-2" });
      fireEvent.click(within(drawer).getByRole("radio", { name: "None" }));
      fireEvent.click(within(drawer).getByRole("button", { name: "Save access" }));

      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
      await waitFor(() => {
        expect(updateSpy).toHaveBeenCalledWith(
          expect.objectContaining({ kind: "local" }),
          expect.objectContaining({ userId: "member-2", aiAccess: "none" }),
        );
      });
    });

    it("removes a member from the row menu after confirmation (P0-5)", async () => {
      renderParticipants();

      await openRowMenu("member-2");
      fireEvent.click(await screen.findByRole("menuitem", { name: "Remove member" }));

      const confirm = await screen.findByRole("alertdialog", { name: "Remove member?" });
      fireEvent.click(within(confirm).getByRole("button", { name: "Remove" }));

      await waitFor(() => {
        expect(screen.queryByText("member-2")).not.toBeInTheDocument();
      });
    });

    it("revokes a pending invite and moves it to history (P0-5)", async () => {
      renderParticipants();

      await openRowMenu("invitee@example.com");
      fireEvent.click(await screen.findByRole("menuitem", { name: "Revoke invitation" }));

      const confirm = await screen.findByRole("alertdialog", { name: "Revoke invitation?" });
      fireEvent.click(within(confirm).getByRole("button", { name: "Revoke" }));

      await waitFor(() => {
        const historySection = screen.getByRole("heading", { name: "Invite history" }).closest("section");
        expect(historySection).not.toBeNull();
        expect(within(historySection as HTMLElement).getByText("invitee@example.com")).toBeInTheDocument();
        expect(within(historySection as HTMLElement).getByText("Revoked")).toBeInTheDocument();
      });
      expect(screen.queryByText("Pending")).not.toBeInTheDocument();
    });

    it("disables the co-owner role card for co_owner actors with a reason (P0-8)", async () => {
      const profile = setStoredAuthProfile({
        email: "owner@example.com",
        name: "Owner User",
      });
      setAuthRole("co_owner");
      updateMember("project-1", profile.id, {
        role: "co_owner",
        ai_access: "project_pool",
        finance_visibility: "detail",
        internal_docs_visibility: "view",
      } as never);

      renderParticipants();

      fireEvent.click(participantRow("member-2"));
      const drawer = await screen.findByRole("dialog", { name: "member-2" });

      const coOwnerCard = within(drawer).getByRole("button", { name: /Co-owner/ });
      expect(coOwnerCard).toBeDisabled();
      expect(within(drawer).getByText("Only the owner can assign co-owners")).toBeInTheDocument();
      // co_owner cannot remove anyone: DELETE on project_members is owner-only.
      expect(within(drawer).queryByRole("button", { name: "Remove member" })).not.toBeInTheDocument();
    });

    it("hides management entry points from contractor actors", () => {
      const profile = setStoredAuthProfile({
        email: "owner@example.com",
        name: "Owner User",
      });
      setAuthRole("contractor");
      updateMember("project-1", profile.id, {
        role: "contractor",
        ai_access: "consult_only",
        finance_visibility: "none",
      } as never);

      renderParticipants();

      expect(screen.queryByRole("button", { name: "Invite" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Actions" })).not.toBeInTheDocument();
    });

    describe("Invite email delivery (Supabase)", () => {
      beforeEach(() => {
        vi.restoreAllMocks();
        vi.spyOn(toastModule, "toast").mockImplementation(() => ({
          id: "toast-mock",
          dismiss: () => {},
          update: () => {},
        }));
        vi.spyOn(useMockData, "useWorkspaceMode").mockReturnValue({ kind: "supabase", profileId });
        vi.spyOn(useMockData, "useCurrentUser").mockReturnValue({
          id: profileId,
          email: "owner@example.com",
          name: "Owner User",
          locale: "en",
          timezone: "UTC",
          plan: "free",
          credits_free: 0,
          credits_paid: 0,
        });
        vi.spyOn(useMockData, "useProject").mockReturnValue({
          project: {
            id: "project-1",
            owner_id: profileId,
            title: "Workspace Project",
            type: "residential",
            project_mode: "contractor",
            automation_level: "assisted",
            current_stage_id: "",
            progress_pct: 0,
          },
          members: [{
            project_id: "project-1",
            user_id: profileId,
            role: "owner",
            ai_access: "project_pool",
            finance_visibility: "detail",
            credit_limit: 500,
            used_credits: 0,
            internal_docs_visibility: "edit",
          } as never],
          stages: [],
        });
        const ownerSeam = {
          projectId: "project-1",
          profileId,
          membership: {
            project_id: "project-1",
            user_id: profileId,
            role: "owner",
            ai_access: "project_pool",
            finance_visibility: "detail",
            credit_limit: 500,
            used_credits: 0,
            internal_docs_visibility: "edit",
          } as never,
          project: undefined,
        };
        vi.spyOn(permissions, "usePermission").mockReturnValue({
          seam: ownerSeam,
          can: () => true,
          // Contract-derived, not hardcoded: the owner seam resolves every
          // participant action to enabled today, and stays honest if it stops.
          actionState: (domain, action) => permissions.seamResolveActionState(ownerSeam, domain, action),
          role: "owner",
          isLoading: false,
        });
      });

      it("create invite + send success shows invitation sent", async () => {
        vi.spyOn(useMockData, "useProjectInvites").mockReturnValue([]);
        const uuidInvite = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";
        const created: WorkspaceProjectInvite = {
          id: uuidInvite,
          project_id: "project-1",
          email: "new@example.com",
          role: "contractor",
          ai_access: "consult_only",
          viewer_regime: null,
          credit_limit: 50,
          invited_by: profileId,
          status: "pending",
          invite_token: "tok",
          accepted_profile_id: null,
          created_at: new Date().toISOString(),
          accepted_at: null,
          finance_visibility: "detail",
          internal_docs_visibility: "view",
        } as WorkspaceProjectInvite;
        const createSpy = vi.spyOn(workspaceSource, "createWorkspaceProjectInvite").mockResolvedValue(created);
        const sendSpy = vi.spyOn(workspaceSource, "sendWorkspaceProjectInviteEmail").mockResolvedValue({
          kind: "sent",
          payload: {
            ok: true,
            inviteId: uuidInvite,
            recipientEmail: "new@example.com",
            providerMessageId: "msg-1",
          },
        });

        renderParticipants();

        fireEvent.click(screen.getByRole("button", { name: "Invite" }));
        fireEvent.change(await screen.findByPlaceholderText("member@example.com"), { target: { value: "new@example.com" } });
        fireEvent.click(screen.getByRole("button", { name: "Send Invite" }));

        await waitFor(() => {
          expect(createSpy).toHaveBeenCalled();
          expect(sendSpy).toHaveBeenCalledWith({ kind: "supabase", profileId }, uuidInvite);
        });

        await waitFor(() => {
          expect(toastModule.toast).toHaveBeenCalledWith(
            expect.objectContaining({
              title: "Invitation sent",
              description: expect.stringContaining("new@example.com"),
            }),
          );
        });
      });

      it("create invite + email failure keeps invite and reports truthful toast", async () => {
        vi.spyOn(useMockData, "useProjectInvites").mockReturnValue([]);
        const uuidInvite = "b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";
        const created: WorkspaceProjectInvite = {
          id: uuidInvite,
          project_id: "project-1",
          email: "fail@example.com",
          role: "contractor",
          ai_access: "consult_only",
          viewer_regime: null,
          credit_limit: 50,
          invited_by: profileId,
          status: "pending",
          invite_token: "tok",
          accepted_profile_id: null,
          created_at: new Date().toISOString(),
          accepted_at: null,
          finance_visibility: "detail",
          internal_docs_visibility: "view",
        } as WorkspaceProjectInvite;
        vi.spyOn(workspaceSource, "createWorkspaceProjectInvite").mockResolvedValue(created);
        vi.spyOn(workspaceSource, "sendWorkspaceProjectInviteEmail").mockRejectedValue(new Error("SMTP unavailable"));

        renderParticipants();

        fireEvent.click(screen.getByRole("button", { name: "Invite" }));
        fireEvent.change(await screen.findByPlaceholderText("member@example.com"), { target: { value: "fail@example.com" } });
        fireEvent.click(screen.getByRole("button", { name: "Send Invite" }));

        await waitFor(() => {
          expect(toastModule.toast).toHaveBeenCalledWith(
            expect.objectContaining({
              title: "Invite created",
              variant: "destructive",
              description: expect.stringContaining("SMTP unavailable"),
            }),
          );
        });
      });

      it("resend success shows confirmation toast", async () => {
        const inviteRow: WorkspaceProjectInvite = {
          id: "c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
          project_id: "project-1",
          email: "pending@example.com",
          role: "contractor",
          ai_access: "consult_only",
          viewer_regime: null,
          credit_limit: 50,
          invited_by: profileId,
          status: "pending",
          invite_token: "tok",
          accepted_profile_id: null,
          created_at: new Date().toISOString(),
          accepted_at: null,
          finance_visibility: "detail",
          internal_docs_visibility: "view",
        } as WorkspaceProjectInvite;
        vi.spyOn(useMockData, "useProjectInvites").mockReturnValue([inviteRow]);
        const sendSpy = vi.spyOn(workspaceSource, "sendWorkspaceProjectInviteEmail").mockResolvedValue({
          kind: "sent",
          payload: {
            ok: true,
            inviteId: inviteRow.id,
            recipientEmail: "pending@example.com",
            providerMessageId: "r-1",
          },
        });

        renderParticipants();

        await openRowMenu("pending@example.com");
        fireEvent.click(await screen.findByRole("menuitem", { name: "Resend email" }));

        await waitFor(() => {
          expect(sendSpy).toHaveBeenCalledWith({ kind: "supabase", profileId }, inviteRow.id);
        });
        await waitFor(() => {
          expect(toastModule.toast).toHaveBeenCalledWith(
            expect.objectContaining({ title: "Invitation email sent" }),
          );
        });
      });

      it("resend failure shows destructive toast", async () => {
        const inviteRow: WorkspaceProjectInvite = {
          id: "d0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
          project_id: "project-1",
          email: "bad@example.com",
          role: "contractor",
          ai_access: "consult_only",
          viewer_regime: null,
          credit_limit: 50,
          invited_by: profileId,
          status: "pending",
          invite_token: "tok",
          accepted_profile_id: null,
          created_at: new Date().toISOString(),
          accepted_at: null,
          finance_visibility: "detail",
          internal_docs_visibility: "view",
        } as WorkspaceProjectInvite;
        vi.spyOn(useMockData, "useProjectInvites").mockReturnValue([inviteRow]);
        vi.spyOn(workspaceSource, "sendWorkspaceProjectInviteEmail").mockRejectedValue(new Error("Rate limited"));

        renderParticipants();

        await openRowMenu("bad@example.com");
        fireEvent.click(await screen.findByRole("menuitem", { name: "Resend email" }));

        await waitFor(() => {
          expect(toastModule.toast).toHaveBeenCalledWith(
            expect.objectContaining({
              title: "Resend failed",
              variant: "destructive",
              description: "Rate limited",
            }),
          );
        });
      });
    });
  });

  describe("seat limits (Supabase owner)", () => {
    // The seat gate reads the OWNER's subscription plan (master = 2 editors,
    // unlimited viewers, 500 AI requests/mo). Mock the supabase surface so the
    // screen sees a fixed roster + plan without a live backend.
    function mountSupabaseOwner(opts: {
      members: Member[];
      invites?: WorkspaceProjectInvite[];
      planCode?: "free" | "master" | "brigade";
      subscriptionError?: boolean;
    }) {
      const ownerMember: Member = {
        project_id: "project-1",
        user_id: profileId,
        role: "owner",
        ai_access: "project_pool",
        finance_visibility: "detail",
        credit_limit: 500,
        used_credits: 0,
        internal_docs_visibility: "edit",
      };
      const allMembers = [ownerMember, ...opts.members];
      authenticateRuntimeAuth(profileId);
      vi.spyOn(toastModule, "toast").mockImplementation(() => ({ id: "t", dismiss: () => {}, update: () => {} }));
      vi.spyOn(useMockData, "useWorkspaceMode").mockReturnValue({ kind: "supabase", profileId });
      vi.spyOn(useMockData, "useCurrentUser").mockReturnValue({
        id: profileId, email: "owner@example.com", name: "Owner User",
        locale: "en", timezone: "UTC", plan: "free", credits_free: 0, credits_paid: 0,
      });
      vi.spyOn(useMockData, "useProject").mockReturnValue({
        project: {
          id: "project-1", owner_id: profileId, title: "P", type: "residential",
          project_mode: "contractor", automation_level: "assisted", current_stage_id: "", progress_pct: 0,
        },
        members: allMembers,
        stages: [],
      });
      vi.spyOn(useMockData, "useProjectInvites").mockReturnValue(opts.invites ?? []);
      vi.spyOn(activeSubscription, "useActiveSubscription").mockReturnValue({
        status: opts.subscriptionError ? "none" : "active",
        subscription: opts.subscriptionError ? null : ({ plan_code: opts.planCode ?? "master" } as never),
        readOnly: false,
        isLoading: false,
        isError: Boolean(opts.subscriptionError),
        refetch: () => {},
      });
      const ownerSeam = {
        projectId: "project-1", profileId,
        membership: ownerMember as never,
        project: undefined,
      };
      vi.spyOn(permissions, "usePermission").mockReturnValue({
        seam: ownerSeam,
        can: () => true,
        actionState: (domain, action) => permissions.seamResolveActionState(ownerSeam, domain, action),
        role: "owner",
        isLoading: false,
      });
    }

    function contractor(userId: string): Member {
      return {
        project_id: "project-1", user_id: userId, role: "contractor",
        ai_access: "consult_only", finance_visibility: "none",
        internal_docs_visibility: "view", credit_limit: 50, used_credits: 0,
      };
    }

    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it("at the editor cap, editor role cards are disabled and the invite defaults to viewer", async () => {
      mountSupabaseOwner({ members: [contractor("m-a"), contractor("m-b")], planCode: "master" });
      renderParticipants();

      expect(screen.getByText(/Editors: 2 of 2/)).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Invite" }));
      const drawer = await screen.findByRole("dialog", { name: "Invite participant" });

      // Viewer preselected (editors full, viewers unlimited); editor cards blocked.
      expect(within(drawer).getByRole("button", { name: /Viewer/ })).toHaveAttribute("aria-pressed", "true");
      expect(within(drawer).getByRole("button", { name: /Co-owner/ })).toBeDisabled();
      expect(within(drawer).getByRole("button", { name: /Contractor/ })).toBeDisabled();
      expect(within(drawer).getAllByText("Editor seat limit reached for the plan").length).toBeGreaterThan(0);
    });

    it("with every seat full, the invite button opens the paywall instead of the drawer", () => {
      // free plan = 0 editors / 0 viewers → both caps hit immediately.
      mountSupabaseOwner({ members: [], planCode: "free" });
      renderParticipants();

      fireEvent.click(screen.getByRole("button", { name: "Invite" }));

      expect(screen.queryByRole("dialog", { name: "Invite participant" })).not.toBeInTheDocument();
      expect(toastModule.toast).toHaveBeenCalledWith(
        expect.objectContaining({ title: expect.any(String) }),
      );
    });

    it("offers no editable credit limit, so there is no above-cap value to block", async () => {
      mountSupabaseOwner({ members: [contractor("m-a")], planCode: "master" });
      renderParticipants();

      fireEvent.click(screen.getByText("m-a"));
      const drawer = await screen.findByRole("dialog", { name: "m-a" });
      // contractor default ai=consult_only already shows the requests field.
      const requests = within(drawer).getByLabelText("Request limit");

      // project_members.credit_limit has no reader and consume_ai_credit meters
      // the member's own subscription, so the field is parked behind «Soon»
      // (rovno#301, option B). The above-cap guard it needed went with it: this
      // test previously typed 5000 against the owner plan's quota of 500.
      expect(requests).toBeDisabled();
      expect(within(drawer).queryByText(/At most 500/)).not.toBeInTheDocument();
      expect(within(drawer).getByRole("button", { name: "Save access" })).toBeEnabled();
    });
  });

  describe("legacy tabs screen (kill switch)", () => {
    beforeEach(() => {
      localStorage.setItem("participants-redesign", "0");
    });

    async function activateTab(name: "Members" | "Invitations" | "Permissions") {
      const tab = screen.getByRole("tab", { name });
      fireEvent.mouseDown(tab, { button: 0, ctrlKey: false });
      fireEvent.click(tab);
      await waitFor(() => {
        expect(tab).toHaveAttribute("data-state", "active");
      });
    }

    it("renders Members, Invitations, and Permissions tabs with Members open by default", () => {
      renderParticipants();

      expect(screen.getByRole("tab", { name: "Members" })).toHaveAttribute("data-state", "active");
      expect(screen.getByRole("tab", { name: "Invitations" })).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: "Permissions" })).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "Active members" })).toBeInTheDocument();
      expect(screen.queryByRole("heading", { name: "Pending invitations" })).not.toBeInTheDocument();
    });

    it("keeps pending invites primary and invite history secondary in Invitations", async () => {
      addProjectInvite({
        id: "invite-accepted",
        project_id: "project-1",
        email: "accepted@example.com",
        role: "viewer",
        ai_access: "none",
        viewer_regime: "client",
        credit_limit: 10,
        invited_by: profileId,
        status: "accepted",
        invite_token: "invite-token-accepted",
        accepted_profile_id: profileId,
        created_at: "2026-03-07T10:00:00.000Z",
        accepted_at: "2026-03-07T12:00:00.000Z",
        finance_visibility: "none",
        internal_docs_visibility: "none",
      } as WorkspaceProjectInvite, "local");

      renderParticipants();

      await activateTab("Invitations");

      const pendingSection = screen.getByRole("heading", { name: "Pending invitations" }).closest("section");
      const historySection = screen.getByRole("heading", { name: "Invite history" }).closest("section");
      expect(pendingSection).not.toBeNull();
      expect(historySection).not.toBeNull();

      const pendingTable = within(pendingSection as HTMLElement).getByRole("table");
      const historyTable = within(historySection as HTMLElement).getByRole("table");
      expect(within(pendingTable).getByText("invitee@example.com")).toBeInTheDocument();
      expect(within(historyTable).getByText("accepted@example.com")).toBeInTheDocument();
      expect(within(pendingTable).queryByText("accepted@example.com")).not.toBeInTheDocument();
    });

    it("opens the same canonical access dialog from Members and Invitations", async () => {
      renderParticipants();

      const membersTable = screen.getByRole("table");
      const memberRow = within(membersTable).getByText("member-2").closest("tr");
      fireEvent.pointerDown(within(memberRow as HTMLElement).getByRole("button"), { button: 0, ctrlKey: false });
      fireEvent.click(await screen.findByRole("menuitem", { name: "Edit access" }));

      let dialog = screen.getByRole("dialog", { name: "Edit access: member-2" });
      expect(within(dialog).getByText("This is the canonical Participants access editor. Role presets and bounded overrides are managed here together.")).toBeInTheDocument();
      fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

      await activateTab("Invitations");
      const inviteSection = screen.getByRole("heading", { name: "Pending invitations" }).closest("section");
      const inviteTable = within(inviteSection as HTMLElement).getByRole("table");
      const inviteRow = within(inviteTable).getByText("invitee@example.com").closest("tr");
      fireEvent.pointerDown(within(inviteRow as HTMLElement).getByRole("button"), { button: 0, ctrlKey: false });
      fireEvent.click(await screen.findByRole("menuitem", { name: "Edit access" }));

      dialog = screen.getByRole("dialog", { name: "Edit access: invitee@example.com" });
      expect(within(dialog).getByText("This is the canonical Participants access editor. Role presets and bounded overrides are managed here together.")).toBeInTheDocument();
    });

    it("updates access from the shared dialog", async () => {
      renderParticipants();

      await activateTab("Permissions");
      fireEvent.click(screen.getAllByRole("button", { name: "Edit access" })[0]);

      const dialog = screen.getByRole("dialog", { name: "Edit access: member-2" });
      const roleSelect = within(dialog).getAllByRole("combobox")[0];
      fireEvent.click(roleSelect);
      fireEvent.click(await screen.findByText("Viewer"));
      fireEvent.click(within(dialog).getByRole("button", { name: "Save access" }));

      await waitFor(() => {
        expect(screen.getByText("Viewer")).toBeInTheDocument();
      });
    });

    it("removes unsupported role transitions for co_owner", async () => {
      const profile = setStoredAuthProfile({
        email: "owner@example.com",
        name: "Owner User",
      });
      setAuthRole("co_owner");
      updateMember("project-1", profile.id, {
        role: "co_owner",
        ai_access: "project_pool",
        finance_visibility: "detail",
        internal_docs_visibility: "view",
      } as never);

      renderParticipants();

      await activateTab("Permissions");
      fireEvent.click(screen.getAllByRole("button", { name: "Edit access" })[0]);

      const dialog = screen.getByRole("dialog", { name: /Edit access:/ });
      fireEvent.click(within(dialog).getAllByRole("combobox")[0]);
      const listbox = await screen.findByRole("listbox");
      expect(within(listbox).getByText("Contractor")).toBeInTheDocument();
      expect(within(listbox).getByText("Viewer")).toBeInTheDocument();
      expect(within(listbox).queryByText("Co-owner")).not.toBeInTheDocument();
      expect(within(listbox).queryByText("Owner")).not.toBeInTheDocument();
    });

    it("shows no permission edit entry points for contractor actors", () => {
      const profile = setStoredAuthProfile({
        email: "owner@example.com",
        name: "Owner User",
      });
      setAuthRole("contractor");
      updateMember("project-1", profile.id, {
        role: "contractor",
        ai_access: "consult_only",
        finance_visibility: "none",
      } as never);

      renderParticipants();

      expect(screen.queryByRole("button", { name: "Invite" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Edit access" })).not.toBeInTheDocument();
    });

    it("does not show Resend email for pending invites in local workspace mode", async () => {
      renderParticipants();

      await activateTab("Invitations");
      const inviteSection = screen.getByRole("heading", { name: "Pending invitations" }).closest("section");
      const inviteTable = within(inviteSection as HTMLElement).getByRole("table");
      const inviteRow = within(inviteTable).getByText("invitee@example.com").closest("tr");
      fireEvent.pointerDown(within(inviteRow as HTMLElement).getByRole("button"), { button: 0, ctrlKey: false });

      expect(await screen.findByRole("menuitem", { name: "Edit access" })).toBeInTheDocument();
      expect(screen.queryByRole("menuitem", { name: "Resend email" })).not.toBeInTheDocument();
    });

    it("defaults contractor invite finance visibility to non-detail and requires unlock for non-standard expansion", async () => {
      renderParticipants();

      fireEvent.click(screen.getByRole("button", { name: "Invite" }));
      const dialog = screen.getByRole("dialog", { name: "Invite participant" });

      expect(within(dialog).getByText("No finance visibility")).toBeInTheDocument();
      expect(within(dialog).getByRole("button", { name: "Unlock non-standard finance access" })).toBeInTheDocument();
    });

    it("shows non-standard customization summary after unlocking contractor finance expansion", async () => {
      renderParticipants();

      fireEvent.click(screen.getByRole("button", { name: "Invite" }));
      const dialog = screen.getByRole("dialog", { name: "Invite participant" });
      fireEvent.click(within(dialog).getByRole("button", { name: "Unlock non-standard finance access" }));

      const comboBoxes = within(dialog).getAllByRole("combobox");
      fireEvent.click(comboBoxes[2]);
      fireEvent.click(await screen.findByText("Finance summary"));

      expect(within(dialog).getByText("Contractor has non-standard access settings")).toBeInTheDocument();
    });
  });
});
