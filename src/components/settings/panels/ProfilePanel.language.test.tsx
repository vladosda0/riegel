// rovno #186: the interface language has exactly ONE control, and it is not here.
//
// Профиль used to carry a second language selector that wrote profiles.locale
// while Настройки > Предпочтения wrote localStorage. The two stores disagreed,
// so saving any unrelated Профиль field silently overwrote a language chosen in
// Предпочтения (#201 stopped the clobber; this removes the second writer).
//
// These tests are the tripwire against re-adding it. They assert absence, which
// is weak by nature, so they also pin the two consequences that made the
// duplicate control harmful: the save payload must not carry `locale`, and
// saving must not touch i18n.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const currentUser = {
  id: "u1",
  email: "a@b.co",
  name: "Alex Builder",
  avatar: undefined as string | undefined,
  locale: "en",
  timezone: "Europe/Moscow",
  plan: "free" as const,
  credits_free: 0,
  credits_paid: 0,
};
const contactInfo = { roleTitle: "Foreman", phone: "+7900", bio: "Bio text", signatureBlock: "Sig" };
const identityMutate = vi.fn();
const contactMutate = vi.fn();
const setAppLanguageMock = vi.fn();

vi.mock("@/hooks/use-mock-data", () => ({ useCurrentUser: () => currentUser }));
vi.mock("@/hooks/use-workspace-source", () => ({
  useWorkspaceMode: () => ({ kind: "supabase", profileId: "u1" }),
  useWorkspaceProfileContactInfoState: () => ({ contactInfo, isLoading: false }),
  useUpdateWorkspaceProfileIdentity: () => ({ mutateAsync: identityMutate, isPending: false }),
  useUpdateWorkspaceProfileContactInfo: () => ({ mutateAsync: contactMutate, isPending: false }),
}));
vi.mock("@/hooks/use-avatar-upload", () => ({ useAvatarUpload: () => ({ uploadAvatar: vi.fn() }) }));
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));
vi.mock("@/i18n", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/i18n")>();
  return { ...actual, setAppLanguage: (lang: unknown) => setAppLanguageMock(lang) };
});

import { ProfilePanel } from "@/components/settings/panels/ProfilePanel";

describe("ProfilePanel no longer owns the interface language", () => {
  beforeEach(() => {
    identityMutate.mockReset().mockResolvedValue(currentUser);
    contactMutate.mockReset().mockResolvedValue(contactInfo);
    setAppLanguageMock.mockReset();
  });

  it("renders no language control", () => {
    render(<ProfilePanel />);

    // Timezone is the only Select left in this panel. Asserting the count rather
    // than just the absence of "Русский" catches a re-added control whatever it
    // is labelled.
    expect(screen.getAllByRole("combobox")).toHaveLength(1);
    expect(screen.queryByText("Русский")).not.toBeInTheDocument();
    expect(screen.queryByText("English")).not.toBeInTheDocument();
  });

  it("does not send locale when saving, so it cannot overwrite the chosen language", () => {
    render(<ProfilePanel />);

    fireEvent.change(screen.getByDisplayValue("Alex Builder"), { target: { value: "Alex B" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    return waitFor(() => {
      expect(identityMutate).toHaveBeenCalledTimes(1);
      // updateProfileIdentity is a partial update, so an absent key leaves the
      // column untouched. Present-but-stale is the failure mode being prevented.
      expect(identityMutate.mock.calls[0][0]).not.toHaveProperty("locale");
    });
  });

  it("does not touch i18n on save", async () => {
    render(<ProfilePanel />);

    fireEvent.change(screen.getByDisplayValue("Alex Builder"), { target: { value: "Alex C" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(identityMutate).toHaveBeenCalledTimes(1));
    expect(setAppLanguageMock).not.toHaveBeenCalled();
  });
});
