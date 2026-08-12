import { useEffect } from "react";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const COUNTER_ID = "99999";
const AUTH_FRAGMENT = "#access_token=FAKEQAACCESS&refresh_token=FAKEQAREFRESH&token_type=bearer&type=recovery";

type YmMock = ReturnType<typeof vi.fn>;

function Navigate({ to }: { to: string }) {
  const navigate = useNavigate();
  useEffect(() => {
    navigate(to);
  }, [navigate, to]);
  return null;
}

describe("MetrikaPageviewTracker", () => {
  let ym: YmMock;

  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("VITE_METRIKA_COUNTER_ID", COUNTER_ID);
    ym = vi.fn();
    (window as unknown as { ym?: unknown }).ym = ym;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    delete (window as unknown as { ym?: unknown }).ym;
    window.history.replaceState({}, "", "/");
  });

  it("sends a pageview whose url carries no auth fragment", async () => {
    window.history.replaceState({}, "", `/auth/reset-password?lang=ru${AUTH_FRAGMENT}`);
    const { MetrikaPageviewTracker } = await import("./MetrikaPageviewTracker");

    render(
      <MemoryRouter initialEntries={["/auth/reset-password"]}>
        <MetrikaPageviewTracker />
        <Navigate to="/home" />
      </MemoryRouter>,
    );

    await waitFor(() => expect(ym).toHaveBeenCalled());

    const hits = ym.mock.calls.filter((call) => call[1] === "hit");
    expect(hits).toHaveLength(1);
    expect(hits[0][2]).toBe(`${window.location.origin}/auth/reset-password?lang=ru`);
    expect(hits[0][2]).not.toContain("access_token");
  });
});
