// Regression cover for rovno #201: a Профиль save used to force-apply the DB
// locale to i18n even when the user never touched the Язык control, silently
// wiping a language chosen in Настройки > Предпочтения (which writes
// localStorage only). Also pins the normalizeSelectableLanguage fallback, which
// must match what i18n actually boots (ru), not English.
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

/** The panel renders two Selects: [0] is Timezone, [1] is Язык. */
function languageTrigger(): HTMLElement {
  return screen.getAllByRole("combobox")[1];
}

describe("ProfilePanel interface language", () => {
  beforeEach(() => {
    identityMutate.mockReset().mockResolvedValue(currentUser);
    contactMutate.mockReset().mockResolvedValue(contactInfo);
    setAppLanguageMock.mockReset();
    currentUser.locale = "en";
    // Radix Select moves focus to the active item when the listbox opens, and
    // jsdom has no scrollIntoView. Without this the popover never settles.
    Element.prototype.scrollIntoView = vi.fn();
  });

  it("does not touch i18n when saving a profile edit that is not the language", async () => {
    render(<ProfilePanel />);

    // Edit only the display name, exactly as a user updating their name would.
    fireEvent.change(screen.getByDisplayValue("Alex Builder"), { target: { value: "Alex B" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(identityMutate).toHaveBeenCalledTimes(1));
    // The locale still rides along to the backend, unchanged. What must NOT
    // happen is the live UI language being reset from it.
    expect(identityMutate).toHaveBeenCalledWith(expect.objectContaining({ locale: "en" }));
    expect(setAppLanguageMock).not.toHaveBeenCalled();
  });

  it("applies the language to i18n when the user actually changes the control", async () => {
    currentUser.locale = "ru";
    render(<ProfilePanel />);

    fireEvent.keyDown(languageTrigger(), { key: "ArrowDown" });
    fireEvent.click(await screen.findByRole("option", { name: "English" }));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(identityMutate).toHaveBeenCalledTimes(1));
    expect(identityMutate).toHaveBeenCalledWith(expect.objectContaining({ locale: "en" }));
    expect(setAppLanguageMock).toHaveBeenCalledWith("en");
  });

  it("falls back to Русский for a locale that is not a real bundle", () => {
    // de/fr/es are disabled placeholders the DB CHECK still admits, and an
    // undefined locale is possible too. Either way the control must agree with
    // the Russian UI that i18n boots, or Save can never enable: selecting the
    // language already shown is not a dirty change.
    currentUser.locale = "de";
    render(<ProfilePanel />);

    expect(languageTrigger()).toHaveTextContent("Русский");
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
  });
});
