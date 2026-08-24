import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import InviteAccept from "@/pages/invite/InviteAccept";

const { useRuntimeAuthMock, acceptProjectInviteMock } = vi.hoisted(() => ({
  useRuntimeAuthMock: vi.fn(),
  acceptProjectInviteMock: vi.fn(),
}));

vi.mock("@/hooks/use-runtime-auth", () => ({
  useRuntimeAuth: () => useRuntimeAuthMock(),
}));

vi.mock("@/lib/accept-project-invite", () => ({
  acceptProjectInvite: acceptProjectInviteMock,
}));

function renderInvitePage(path = "/invite/accept/token-123") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/invite/accept/:inviteToken" element={<InviteAccept />} />
        <Route path="/project/:id/dashboard" element={<div>Project dashboard</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("InviteAccept", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("shows auth continuation links when user is not authenticated", () => {
    useRuntimeAuthMock.mockReturnValue({
      status: "guest",
      session: null,
      user: null,
      profileId: null,
    });

    renderInvitePage();

    const signInLink = screen.getByRole("link", { name: /sign in/i });
    const signUpLink = screen.getByRole("link", { name: /create account/i });

    expect(signInLink).toHaveAttribute("href", "/auth/login?next=%2Finvite%2Faccept%2Ftoken-123");
    expect(signUpLink).toHaveAttribute("href", "/auth/signup?next=%2Finvite%2Faccept%2Ftoken-123");
    expect(acceptProjectInviteMock).not.toHaveBeenCalled();
  });

  it("accepts invite and redirects to project dashboard for authenticated users", async () => {
    useRuntimeAuthMock.mockReturnValue({
      status: "authenticated",
      session: null,
      user: { id: "profile-1" },
      profileId: "profile-1",
    });
    acceptProjectInviteMock.mockResolvedValue({
      ok: true,
      invite: {
        id: "invite-1",
        project_id: "project-1",
        invite_token: "token-123",
      },
    });

    renderInvitePage();

    await waitFor(() => {
      expect(acceptProjectInviteMock).toHaveBeenCalledWith("token-123");
    });

    expect(await screen.findByText(/Invitation accepted successfully/i)).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText("Project dashboard")).toBeInTheDocument();
    }, { timeout: 3000 });
  });

  it("shows backend error message when acceptance fails", async () => {
    useRuntimeAuthMock.mockReturnValue({
      status: "authenticated",
      session: null,
      user: { id: "profile-1" },
      profileId: "profile-1",
    });
    acceptProjectInviteMock.mockResolvedValue({
      ok: false,
      error: {
        code: "invite_email_mismatch",
        message: "This invite was sent to a different email address.",
        rawError: null,
      },
    });

    renderInvitePage();

    expect(await screen.findByText("This invite was sent to a different email address.")).toBeInTheDocument();
  });

  it("retries acceptance when the user clicks try again", async () => {
    useRuntimeAuthMock.mockReturnValue({
      status: "authenticated",
      session: null,
      user: { id: "profile-1" },
      profileId: "profile-1",
    });
    acceptProjectInviteMock.mockResolvedValue({
      ok: false,
      error: {
        code: "unknown",
        message: "Failed to fetch",
        rawError: null,
      },
    });

    renderInvitePage();

    expect(await screen.findByText("Unable to accept invite.")).toBeInTheDocument();
    expect(acceptProjectInviteMock).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: /try again/i }));

    await waitFor(() => {
      expect(acceptProjectInviteMock).toHaveBeenCalledTimes(2);
    });
    expect(await screen.findByText("Unable to accept invite.")).toBeInTheDocument();
  });

  it("completes acceptance when the retried attempt succeeds", async () => {
    useRuntimeAuthMock.mockReturnValue({
      status: "authenticated",
      session: null,
      user: { id: "profile-1" },
      profileId: "profile-1",
    });
    acceptProjectInviteMock
      .mockResolvedValueOnce({
        ok: false,
        error: {
          code: "unknown",
          message: "Failed to fetch",
          rawError: null,
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        invite: {
          id: "invite-1",
          project_id: "project-1",
          invite_token: "token-123",
        },
      });

    renderInvitePage();

    expect(await screen.findByText("Unable to accept invite.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /try again/i }));

    expect(await screen.findByText(/Invitation accepted successfully/i)).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText("Project dashboard")).toBeInTheDocument();
    }, { timeout: 3000 });
  });
});
