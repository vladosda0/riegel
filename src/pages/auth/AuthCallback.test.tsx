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
    // The component reads window.location directly for the link's error
    // params; MemoryRouter does not touch it, so reset it per test.
    window.history.replaceState({}, "", "/auth/callback");
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
      expect(trackEventOncePerUser).toHaveBeenCalledWith("email_verified", { user_id: "user-3" });
      expect(trackEventOncePerUser).toHaveBeenCalledWith("first_login", {
        user_id: "user-3",
        via: "email_confirm",
      });
    });
  });

  // Regression: the session now survives, so re-opening the same confirmation
  // email — routine on a phone — re-enters this route with a live session.
  // A bare trackEvent would re-report the verification and inflate the very
  // funnel step this route exists to measure.
  it("reports email_verified through the once-per-user guard, not a bare event", async () => {
    getSessionMock.mockResolvedValue({ data: { session: { user: { id: "user-3b" } } } });
    hasCompletedOnboardingMock.mockResolvedValue(true);

    renderCallback();

    await waitFor(() => {
      expect(trackEventOncePerUser).toHaveBeenCalledWith("email_verified", { user_id: "user-3b" });
    });
    expect(trackEvent).not.toHaveBeenCalled();
  });

  it("does not report first_login when onboarding is already complete", async () => {
    getSessionMock.mockResolvedValue({ data: { session: { user: { id: "user-4" } } } });
    hasCompletedOnboardingMock.mockResolvedValue(true);

    renderCallback();

    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent("/home");
    });
    expect(trackEventOncePerUser).not.toHaveBeenCalledWith(
      "first_login",
      expect.anything(),
    );
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

  /**
   * The one that matters. auth-js deliberately KEEPS a previously stored
   * session when a URL login fails, and leaves `error` / `error_code` in the
   * URL. Trusting the session alone would greet person B with "Email
   * confirmed" and drop them inside person A's account on a shared device.
   */
  it("rejects a failed link even when this browser already holds a session", async () => {
    setAuthRole("owner");
    window.history.replaceState({}, "", "/auth/callback#error=access_denied&error_code=otp_expired");
    getSessionMock.mockResolvedValue({
      data: { session: { user: { id: "somebody-elses-account" } } },
    });
    hasCompletedOnboardingMock.mockResolvedValue(true);

    renderCallback();

    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent("/auth/login");
    });
    expect(getAuthRole()).toBe("guest");
    expect(trackEventOncePerUser).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ variant: "destructive" }));
    // The role alone proves nothing: useWorkspaceModeState gates on the real
    // Supabase session, so person A must actually be signed out, otherwise
    // person B can reach /home from the landing CTA.
    expect(signOutMock).toHaveBeenCalled();
  });

  it("rejects a failed link reported through the query string too", async () => {
    window.history.replaceState({}, "", "/auth/callback?error_code=otp_expired");
    getSessionMock.mockResolvedValue({ data: { session: { user: { id: "user-x" } } } });

    renderCallback();

    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent("/auth/login");
    });
    expect(trackEventOncePerUser).not.toHaveBeenCalled();
  });

  it("downgrades the simulated role to guest when the link is rejected", async () => {
    setAuthRole("owner");
    getSessionMock.mockResolvedValue({ data: { session: null } });

    renderCallback();

    await waitFor(() => {
      expect(getAuthRole()).toBe("guest");
    });
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
