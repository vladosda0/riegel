import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

import AuthCallback from "@/pages/auth/AuthCallback";
import { getAuthRole, setAuthRole } from "@/lib/auth-state";
import { toast } from "@/hooks/use-toast";
import { trackEvent, trackEventOncePerUser } from "@/lib/analytics";

const { getSessionMock, signOutMock, hasCompletedOnboardingMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  signOutMock: vi.fn(),
  hasCompletedOnboardingMock: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: getSessionMock,
      signOut: signOutMock,
    },
  },
}));

vi.mock("@/hooks/use-toast", () => ({
  toast: vi.fn(),
}));

vi.mock("@/lib/analytics", () => ({
  trackEvent: vi.fn(),
  trackEventOncePerUser: vi.fn(),
  setAnalyticsUserId: vi.fn(),
}));

vi.mock("@/lib/auth-state", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth-state")>("@/lib/auth-state");
  return { ...actual, hasCompletedOnboarding: hasCompletedOnboardingMock };
});

function LocationMarker() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

function renderCallback() {
  return render(
    <MemoryRouter initialEntries={["/auth/callback"]}>
      <Routes>
        <Route path="/auth/callback" element={<AuthCallback />} />
        <Route path="*" element={<LocationMarker />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("AuthCallback", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.clearAllMocks();
    signOutMock.mockResolvedValue({ error: null });
  });

  it("keeps the confirmed session instead of signing the user out", async () => {
    getSessionMock.mockResolvedValue({ data: { session: { user: { id: "user-1" } } } });
    hasCompletedOnboardingMock.mockResolvedValue(false);

    renderCallback();

    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent("/onboarding");
    });
    // The whole point of the change: no forced re-login.
    expect(signOutMock).not.toHaveBeenCalled();
  });

  it("sets the simulated role to owner", async () => {
    setAuthRole("guest");
    getSessionMock.mockResolvedValue({ data: { session: { user: { id: "user-1" } } } });
    hasCompletedOnboardingMock.mockResolvedValue(false);

    renderCallback();

    await waitFor(() => {
      expect(getAuthRole()).toBe("owner");
    });
  });

  it("sends an already-onboarded user to /home", async () => {
    getSessionMock.mockResolvedValue({ data: { session: { user: { id: "user-2" } } } });
    hasCompletedOnboardingMock.mockResolvedValue(true);

    renderCallback();

    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent("/home");
    });
  });

  it("reports email_verified and, for a new user, first_login", async () => {
    getSessionMock.mockResolvedValue({ data: { session: { user: { id: "user-3" } } } });
    hasCompletedOnboardingMock.mockResolvedValue(false);

    renderCallback();

    await waitFor(() => {
      expect(trackEvent).toHaveBeenCalledWith("email_verified", { user_id: "user-3" });
      expect(trackEventOncePerUser).toHaveBeenCalledWith("first_login", {
        user_id: "user-3",
        via: "email_confirm",
      });
    });
  });

  it("does not report first_login when onboarding is already complete", async () => {
    getSessionMock.mockResolvedValue({ data: { session: { user: { id: "user-4" } } } });
    hasCompletedOnboardingMock.mockResolvedValue(true);

    renderCallback();

    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent("/home");
    });
    expect(trackEventOncePerUser).not.toHaveBeenCalled();
  });

  it("sends a used or expired link back to login without entering the app", async () => {
    setAuthRole("guest");
    getSessionMock.mockResolvedValue({ data: { session: null } });

    renderCallback();

    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent("/auth/login");
    });
    expect(getAuthRole()).toBe("guest");
    expect(trackEvent).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ variant: "destructive" }),
    );
  });

  it("treats a failing getSession as a bad link rather than crashing", async () => {
    setAuthRole("guest");
    getSessionMock.mockRejectedValue(new Error("network down"));

    renderCallback();

    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent("/auth/login");
    });
    expect(getAuthRole()).toBe("guest");
  });
});
