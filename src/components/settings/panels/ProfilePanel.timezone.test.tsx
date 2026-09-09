// rovno #54: the timezone trigger must never render blank.
//
// `<SelectValue />` has no placeholder, so the trigger shows the text of the
// matching SelectItem and nothing at all when no option matches the value.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

// Radix Select in jsdom: pointer capture + scrollIntoView used by focus management.
if (typeof Element.prototype.hasPointerCapture !== "function") {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
}
if (typeof Element.prototype.scrollIntoView !== "function") {
  Element.prototype.scrollIntoView = () => {};
}

const currentUser = {
  id: "u1",
  email: "a@b.co",
  name: "Alex Builder",
  avatar: undefined as string | undefined,
  locale: "ru",
  timezone: "Europe/Moscow",
  plan: "free" as const,
  credits_free: 0,
  credits_paid: 0,
};
const contactInfo = { roleTitle: "", phone: "", bio: "", signatureBlock: "" };

vi.mock("@/hooks/use-mock-data", () => ({ useCurrentUser: () => currentUser }));
vi.mock("@/hooks/use-workspace-source", () => ({
  useWorkspaceMode: () => ({ kind: "supabase", profileId: "u1" }),
  useWorkspaceProfileContactInfoState: () => ({ contactInfo, isLoading: false }),
  useUpdateWorkspaceProfileIdentity: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateWorkspaceProfileContactInfo: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/use-avatar-upload", () => ({ useAvatarUpload: () => ({ uploadAvatar: vi.fn() }) }));
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));

import { ProfilePanel } from "@/components/settings/panels/ProfilePanel";

function timezoneTrigger() {
  return screen.getByRole("combobox");
}

describe("ProfilePanel timezone trigger", () => {
  beforeEach(() => {
    currentUser.timezone = "Europe/Moscow";
  });

  it("names the stored UTC default", () => {
    currentUser.timezone = "UTC";
    render(<ProfilePanel />);

    expect(timezoneTrigger().textContent?.trim()).not.toBe("");
    expect(timezoneTrigger()).toHaveTextContent("UTC");
  });

  it("names a stored zone the option list does not carry, exactly once", async () => {
    currentUser.timezone = "Asia/Yekaterinburg";
    render(<ProfilePanel />);

    expect(timezoneTrigger().textContent?.trim()).not.toBe("");
    expect(timezoneTrigger()).toHaveTextContent("Asia/Yekaterinburg");

    // On mount both anchors hold the same unlisted zone, so this is the path the
    // dedupe exists for.
    fireEvent.click(timezoneTrigger());
    const listbox = await screen.findByRole("listbox");
    expect(within(listbox).getAllByText("Asia/Yekaterinburg")).toHaveLength(1);
  });

  it("keeps the stored zone selectable after another zone is picked", async () => {
    currentUser.timezone = "Asia/Yekaterinburg";
    render(<ProfilePanel />);

    fireEvent.click(timezoneTrigger());
    fireEvent.click(within(await screen.findByRole("listbox")).getByText("Asia/Tokyo (UTC+9)"));

    fireEvent.click(timezoneTrigger());
    expect(within(await screen.findByRole("listbox")).getByText("Asia/Yekaterinburg")).toBeInTheDocument();
  });

  it("keeps naming the selected zone when the persisted one changes underneath", () => {
    currentUser.timezone = "Asia/Yekaterinburg";
    const { rerender } = render(<ProfilePanel />);
    expect(timezoneTrigger()).toHaveTextContent("Asia/Yekaterinburg");

    // The re-seed effect is keyed on user.id, so the selection survives a
    // persisted value changing underneath it. The option must survive with it.
    currentUser.timezone = "Europe/London";
    rerender(<ProfilePanel />);

    expect(timezoneTrigger()).toHaveTextContent("Asia/Yekaterinburg");
  });

  it("falls back to the auto option when the stored zone is an empty string", () => {
    currentUser.timezone = "";
    render(<ProfilePanel />);

    // Radix throws on a SelectItem with an empty value, so an uncoerced "" would
    // take the whole panel down rather than degrade.
    expect(timezoneTrigger()).toHaveTextContent("Browser (auto-detect)");
  });

  it("still names a listed zone with its own label, and offers it once", async () => {
    render(<ProfilePanel />);

    expect(timezoneTrigger()).toHaveTextContent("Europe/Moscow (UTC+3)");

    // A listed zone must not also arrive through the appended branch: that would
    // duplicate the option and its React key, and show the bare zone id next to
    // the real label.
    fireEvent.click(timezoneTrigger());
    const listbox = await screen.findByRole("listbox");
    expect(within(listbox).getAllByRole("option")).toHaveLength(7);
    expect(within(listbox).queryByText("Europe/Moscow")).not.toBeInTheDocument();
  });
});
