import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Event } from "@/types/entities";

// The caption layer is only as good as its wiring: the catalog tests prove a
// caption exists, and these prove the row actually renders it, with the actor
// and the gender that belongs to that actor. Without them, hardcoding the
// gender flag in either surface leaves the whole suite green.
vi.mock("react-router-dom", () => ({ useNavigate: () => vi.fn() }));
vi.mock("@/lib/permissions", () => ({
  usePermission: () => ({ seam: {} }),
  seamCanViewSensitiveDetail: () => true,
}));

const getUserById = vi.fn();
vi.mock("@/data/store", () => ({ getUserById: (id: string) => getUserById(id) }));

const isAIEvent = vi.fn();
vi.mock("@/components/ai/event-utils", () => ({ isAIEvent: (e: Event) => isAIEvent(e) }));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, string>) =>
      key === "ai.event.actorAI" ? "ИИ"
      : key === "ai.event.actorSystem" ? "Система"
      : key === "activity.event.document.created" ? `добавил${params?.a ?? "{{a}}"} документ`
      : key,
  }),
}));

const { EventFeedItem } = await import("@/components/ai/EventFeedItem");

function event(overrides: Partial<Event> = {}): Event {
  return {
    id: "evt-1",
    project_id: "project-1",
    actor_id: "profile-1",
    type: "document.created",
    object_type: "document",
    object_id: "doc-1",
    timestamp: "2026-08-26T09:00:00.000Z",
    payload: {},
    ...overrides,
  } as Event;
}

describe("EventFeedItem", () => {
  it("renders a resolved person with the masculine caption", () => {
    isAIEvent.mockReturnValue(false);
    getUserById.mockReturnValue({ id: "profile-1", name: "Анна Петрова" });

    render(<EventFeedItem event={event()} />);

    expect(screen.getByText("Анна Петрова")).toBeTruthy();
    expect(screen.getByText("добавил документ")).toBeTruthy();
  });

  it("renders the feminine caption only for the unresolved fallback actor", () => {
    isAIEvent.mockReturnValue(false);
    getUserById.mockReturnValue(undefined);

    render(<EventFeedItem event={event()} />);

    expect(screen.getByText("Система")).toBeTruthy();
    expect(screen.getByText("добавила документ")).toBeTruthy();
  });

  it("keeps an AI-origin row masculine even when the actor does not resolve", () => {
    isAIEvent.mockReturnValue(true);
    getUserById.mockReturnValue(undefined);

    render(<EventFeedItem event={event({ actor_id: "ai" })} />);

    expect(screen.getByText("ИИ")).toBeTruthy();
    expect(screen.getByText("добавил документ")).toBeTruthy();
  });

  it("never leaves an unfilled interpolation slot on screen", () => {
    isAIEvent.mockReturnValue(false);
    getUserById.mockReturnValue({ id: "profile-1", name: "Иван" });

    const { container } = render(<EventFeedItem event={event()} />);

    expect(container.textContent).not.toContain("{{");
  });
});
