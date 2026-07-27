// rovno #186: Настройки > Предпочтения is the ONLY control for the interface
// language, and it is now the only writer of profiles.locale.
//
// Профиль carried a duplicate selector that wrote the column while this one wrote
// localStorage, so the two disagreed. The fix removed that selector and moved
// persistence here. What matters and is pinned below:
//   - the control still switches the language locally (localStorage is what i18n
//     boots from, so this is the part the user actually depends on)
//   - it ALSO records the choice server-side
//   - a backend that refuses the write must not break the local switch
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const identityMutate = vi.fn();
const preferencesMutate = vi.fn();
const setAppLanguageMock = vi.fn();
let workspaceKind = "supabase";

vi.mock("@/hooks/use-workspace-source", () => ({
  useWorkspaceMode: () => ({ kind: workspaceKind, profileId: "u1" }),
  useWorkspaceProfilePreferencesState: () => ({ preferences: undefined, isLoading: false }),
  useUpdateWorkspaceProfilePreferences: () => ({ mutateAsync: preferencesMutate, isPending: false }),
  useUpdateWorkspaceProfileIdentity: () => ({ mutateAsync: identityMutate, isPending: false }),
}));
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));
vi.mock("@/i18n", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/i18n")>();
  return { ...actual, setAppLanguage: (lang: unknown) => setAppLanguageMock(lang) };
});

import { PreferencesPanel } from "@/components/settings/panels/PreferencesPanel";

/** The interface-language Select is the first combobox in the panel. */
function languageTrigger(): HTMLElement {
  return screen.getAllByRole("combobox")[0];
}

async function chooseEnglish() {
  fireEvent.keyDown(languageTrigger(), { key: "ArrowDown" });
  fireEvent.click(await screen.findByRole("option", { name: "English" }));
}

describe("PreferencesPanel interface language", () => {
  beforeEach(() => {
    identityMutate.mockReset().mockResolvedValue({});
    preferencesMutate.mockReset().mockResolvedValue({});
    setAppLanguageMock.mockReset();
    workspaceKind = "supabase";
    localStorage.clear();
    // Radix Select focuses the active item on open and jsdom has no scrollIntoView.
    Element.prototype.scrollIntoView = vi.fn();
  });

  it("applies the language locally and records it on the profile", async () => {
    render(<PreferencesPanel />);
    await chooseEnglish();

    expect(setAppLanguageMock).toHaveBeenCalledWith("en");
    await waitFor(() => expect(identityMutate).toHaveBeenCalledWith({ locale: "en" }));
    // Only the locale. Sending a wider patch from a language control is how the
    // duplicate-writer problem started.
    expect(identityMutate.mock.calls[0][0]).toEqual({ locale: "en" });
  });

  it("still switches the language when the profile write is refused", async () => {
    identityMutate.mockRejectedValue(new Error("Profile is not available yet."));
    render(<PreferencesPanel />);

    await chooseEnglish();

    // The rejection must not surface as an unhandled rejection or undo the switch:
    // localStorage is the boot authority, so the user loses nothing.
    expect(setAppLanguageMock).toHaveBeenCalledWith("en");
    await waitFor(() => expect(identityMutate).toHaveBeenCalledTimes(1));
  });

  it("does not attempt the profile write in a session that has no profile", async () => {
    // guest and pending-supabase have a backend but no session, so the mutation
    // would throw. The language must still switch.
    workspaceKind = "guest";
    render(<PreferencesPanel />);

    await chooseEnglish();

    expect(setAppLanguageMock).toHaveBeenCalledWith("en");
    expect(identityMutate).not.toHaveBeenCalled();
  });

  it("seeds from the language the UI is actually running, not from the database", () => {
    // The whole of #186 was a control that showed one language over a UI running
    // another. Seeding from localStorage keeps the control honest.
    localStorage.setItem("app-language", "en");
    render(<PreferencesPanel />);

    expect(languageTrigger()).toHaveTextContent("English");
  });
});
