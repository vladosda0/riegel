import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Link, MemoryRouter, Route, Routes } from "react-router-dom";
import AuthLayout from "@/layouts/AuthLayout";

// Guards the noindex on /auth/*. It took three review rounds to get there, and
// nothing in the suite failed while it was missing or while it was set somewhere
// a crawler never reaches, so the behaviour is pinned rather than re-derived.
//
// Why the layout and not the admin pages: a crawler is always a guest, and
// BlogAdminGuard sends guests from /blog/admin (and from case variants like
// /blog/ADMIN, which robots.txt cannot express) to /auth/login. The admin pages'
// own tag is removed when they unmount on that redirect.

function readRobots(): string | null {
  return document.head.querySelector('meta[name="robots"]')?.getAttribute("content") ?? null;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<AuthLayout />}>
          <Route path="/auth/login" element={<div>login form</div>} />
          <Route path="/auth/signup" element={<div>signup form</div>} />
        </Route>
        <Route path="/" element={<div>landing</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("AuthLayout", () => {
  beforeEach(() => {
    document.head.querySelector('meta[name="robots"]')?.remove();
  });

  it("marks the route noindex while mounted", () => {
    renderAt("/auth/login");
    expect(screen.getByText("login form")).toBeInTheDocument();
    expect(readRobots()).toBe("noindex, nofollow");
  });

  // Navigating for real inside the router, so the layout stays mounted and only the
  // child swaps. A rerender with a fresh MemoryRouter would tear the tree down and
  // test nothing.
  it("keeps the tag across a child route change, because the layout stays mounted", () => {
    render(
      <MemoryRouter initialEntries={["/auth/login"]}>
        <Routes>
          <Route element={<AuthLayout />}>
            <Route path="/auth/login" element={<Link to="/auth/signup">to signup</Link>} />
            <Route path="/auth/signup" element={<div>signup form</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
    expect(readRobots()).toBe("noindex, nofollow");

    fireEvent.click(screen.getByText("to signup"));

    expect(screen.getByText("signup form")).toBeInTheDocument();
    expect(readRobots()).toBe("noindex, nofollow");
    expect(document.head.querySelectorAll('meta[name="robots"]')).toHaveLength(1);
  });

  // The dangerous direction. A noindex stranded on a public page deindexes the
  // site, which is worse than the problem the tag solves.
  it("removes the tag on unmount, leaving nothing behind for a public route", () => {
    const { unmount } = renderAt("/auth/login");
    expect(readRobots()).toBe("noindex, nofollow");

    unmount();

    expect(readRobots()).toBeNull();
    expect(document.head.querySelectorAll('meta[name="robots"]')).toHaveLength(0);
  });

  it("writes exactly one robots tag, not one per auth route visited", () => {
    renderAt("/auth/login");
    renderAt("/auth/signup");
    expect(document.head.querySelectorAll('meta[name="robots"]')).toHaveLength(1);
  });
});
