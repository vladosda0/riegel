// The two Home widget controls are icon-only, so their aria-label is the whole
// accessible name a screen reader gets on the first screen after login.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import { OverviewTab } from "@/components/home/OverviewTab";
import i18n from "@/i18n";

const mocks = vi.hoisted(() => ({
  useProjects: vi.fn(() => []),
  useCurrentUser: vi.fn(() => null),
  useWorkspaceMode: vi.fn(() => ({ kind: "demo" as const })),
  useProjectsRecentEventsMap: vi.fn(() => ({})),
  useWorkspaceProjectsSensitiveDetailMap: vi.fn(() => ({
    canViewSensitiveDetailByProjectId: new Map<string, boolean>(),
    isLoading: false,
  })),
  getAllTasks: vi.fn(() => []),
  getProject: vi.fn(() => undefined),
  getUserById: vi.fn(() => undefined),
}));

vi.mock("@/hooks/use-mock-data", () => ({
  useProjects: mocks.useProjects,
  useCurrentUser: mocks.useCurrentUser,
  useWorkspaceMode: mocks.useWorkspaceMode,
}));

vi.mock("@/hooks/use-activity-source", () => ({
  useProjectsRecentEventsMap: mocks.useProjectsRecentEventsMap,
}));

vi.mock("@/hooks/use-home-sensitive-detail-map", () => ({
  useWorkspaceProjectsSensitiveDetailMap: mocks.useWorkspaceProjectsSensitiveDetailMap,
}));

vi.mock("@/data/store", () => ({
  getAllTasks: mocks.getAllTasks,
  getProject: mocks.getProject,
  getUserById: mocks.getUserById,
}));

vi.mock("@/components/home/OrgBlock", () => ({
  OrgBlock: () => null,
}));

vi.mock("@/components/home/PendingInvitationsBlock", () => ({
  PendingInvitationsBlock: () => null,
}));

async function switchLanguage(lang: string) {
  await act(async () => {
    await i18n.changeLanguage(lang);
  });
}

beforeEach(async () => {
  await switchLanguage("ru");
});

afterEach(async () => {
  await switchLanguage("en");
});

describe("OverviewTab view-all controls", () => {
  it("names both widget controls in Russian", () => {
    render(
      <MemoryRouter>
        <OverviewTab />
      </MemoryRouter>,
    );

    expect(screen.getByRole("button", { name: "Все проекты" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Все задачи" })).toBeInTheDocument();
  });

  it("leaves no English accessible name on the widgets", () => {
    const { container } = render(
      <MemoryRouter>
        <OverviewTab />
      </MemoryRouter>,
    );

    const english = Array.from(container.querySelectorAll("[aria-label]")).filter((el) =>
      (el.getAttribute("aria-label") ?? "").startsWith("View all"),
    );
    expect(english).toEqual([]);
  });
});
