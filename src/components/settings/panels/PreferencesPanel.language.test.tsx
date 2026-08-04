// rovno #186: Настройки > Предпочтения is the ONLY control for the interface
// language, and it must show the language the interface is actually running.
//
// That second half is the whole of the original bug. Профиль carried a duplicate
// selector seeded from profiles.locale, so it rendered "English" over a Russian
// UI; choosing the language already on screen is not a change, so Save never
// enabled and English was unreachable in one pass.
//
// The control now seeds from getActiveLanguage(), which reads the live i18n
// language rather than a stored value with a hardcoded fallback. That makes the
// drift structurally impossible instead of merely unlikely: there is no second
// source left to disagree with the UI. (Seeding from getStoredLanguage() could
// still drift, because it answered "ru" for an unset value even when i18n had
// resolved English from the browser — the last test below is that case.)
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";

import i18n from "@/i18n";

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

/** changeLanguage re-renders anything mounted, so every call is wrapped. */
async function runInterfaceIn(lang: "ru" | "en") {
  await act(async () => {
    await i18n.changeLanguage(lang);
  });
}

describe("PreferencesPanel interface language", () => {
  beforeEach(() => {
    preferencesMutate.mockReset().mockResolvedValue({});
    localStorage.clear();
  });

  afterEach(async () => {
    // setup.ts runs the suite in English; restore it so this file cannot leak a
    // language into whatever runs next.
    await runInterfaceIn("en");
  });

  it("shows English when the interface is running English", async () => {
    await runInterfaceIn("en");
    render(<PreferencesPanel />);

    expect(languageTrigger()).toHaveTextContent("English");
  });

  it("shows Русский when the interface is running Russian", async () => {
    await runInterfaceIn("ru");
    render(<PreferencesPanel />);

    expect(languageTrigger()).toHaveTextContent("Русский");
  });

  it("reports the running language even when a stored value disagrees", async () => {
    // The #186 drift, reproduced directly: a stored "en" against a Russian UI.
    // The control must follow the interface, not the storage.
    await runInterfaceIn("ru");
    localStorage.setItem("app-language", "en");
    render(<PreferencesPanel />);

    expect(languageTrigger()).toHaveTextContent("Русский");
  });
});
