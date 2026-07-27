// rovno #186: Настройки > Предпочтения is the ONLY control for the interface
// language, and it must show the language the interface is actually running.
//
// That second half is the whole of the original bug. Профиль carried a duplicate
// selector seeded from profiles.locale, so it rendered "English" over a Russian
// UI; choosing the language already on screen is not a change, so Save never
// enabled and English was unreachable in one pass. This control seeds from
// getStoredLanguage(), the same source i18n boots from, so it cannot drift from
// what the user sees.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const preferencesMutate = vi.fn();

vi.mock("@/hooks/use-workspace-source", () => ({
  useWorkspaceMode: () => ({ kind: "supabase", profileId: "u1" }),
  useWorkspaceProfilePreferencesState: () => ({ preferences: undefined, isLoading: false }),
  useUpdateWorkspaceProfilePreferences: () => ({ mutateAsync: preferencesMutate, isPending: false }),
}));
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));

import { PreferencesPanel } from "@/components/settings/panels/PreferencesPanel";

/** The interface-language Select is the first combobox in the panel. */
function languageTrigger(): HTMLElement {
  return screen.getAllByRole("combobox")[0];
}

describe("PreferencesPanel interface language", () => {
  beforeEach(() => {
    preferencesMutate.mockReset().mockResolvedValue({});
    localStorage.clear();
  });

  it("seeds from the language the UI is actually running", () => {
    localStorage.setItem("app-language", "en");
    render(<PreferencesPanel />);

    expect(languageTrigger()).toHaveTextContent("English");
  });

  it("seeds Русский when nothing is stored, matching what i18n boots", () => {
    // getStoredLanguage() returns "ru" for an unset or unrecognised value, so the
    // control agrees with the UI on a fresh browser rather than guessing English.
    render(<PreferencesPanel />);

    expect(languageTrigger()).toHaveTextContent("Русский");
  });
});
