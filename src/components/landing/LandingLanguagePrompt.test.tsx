// The prompt's whole value is in WHEN it stays silent. It must never appear for
// a Russian reader, never re-appear after an answer, and never switch anything
// on its own — auto-switching is what cost the Russian landing its canonical.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";

import { LandingLanguagePrompt } from "@/components/landing/LandingLanguagePrompt";
import i18n from "@/i18n";

const STORAGE_KEY = "app-language";

function setBrowserLanguages(languages: string[]): void {
  Object.defineProperty(navigator, "languages", { value: languages, configurable: true });
  Object.defineProperty(navigator, "language", { value: languages[0], configurable: true });
}

function LocationProbe() {
  const location = useLocation();
  return <span data-testid="location">{`${location.pathname}${location.search}`}</span>;
}

function renderPrompt(url = "/") {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <LandingLanguagePrompt />
      <LocationProbe />
    </MemoryRouter>,
  );
}

async function runInterfaceIn(lang: "ru" | "en") {
  await act(async () => {
    await i18n.changeLanguage(lang);
  });
}

const offer = () => screen.queryByText("Rovno is also available in English.");

beforeEach(async () => {
  localStorage.clear();
  await runInterfaceIn("ru");
});

afterEach(async () => {
  localStorage.clear();
  await runInterfaceIn("en");
});

describe("LandingLanguagePrompt", () => {
  it("offers English to a browser that does not ask for Russian", () => {
    setBrowserLanguages(["en-US"]);
    renderPrompt();

    expect(offer()).not.toBeNull();
  });

  it("offers English to a browser that asks for neither language", () => {
    // A German reader did not ask for Russian; English is the useful offer.
    setBrowserLanguages(["de-DE"]);
    renderPrompt();

    expect(offer()).not.toBeNull();
  });

  it("stays silent for a Russian browser", () => {
    setBrowserLanguages(["ru-RU", "en-US"]);
    renderPrompt();

    expect(offer()).toBeNull();
  });

  it("stays silent once the visitor has chosen a language themselves", () => {
    // A stored choice is an answer — including one made by opening a ?lang=
    // link — and must not be nagged.
    setBrowserLanguages(["en-US"]);
    localStorage.setItem(STORAGE_KEY, "ru");
    renderPrompt();

    expect(offer()).toBeNull();
  });

  it("stays silent while the page is already English", async () => {
    setBrowserLanguages(["en-US"]);
    await runInterfaceIn("en");
    renderPrompt();

    expect(offer()).toBeNull();
  });

  it("switches and puts ?lang=en in the URL when accepted", async () => {
    setBrowserLanguages(["en-US"]);
    renderPrompt();

    await act(async () => {
      fireEvent.click(screen.getByText("Switch to English"));
    });

    expect(i18n.language).toBe("en");
    expect(localStorage.getItem(STORAGE_KEY)).toBe("en");
    expect(screen.getByTestId("location")).toHaveTextContent("/?lang=en");
  });

  it("changes nothing when dismissed, and does not come back", () => {
    setBrowserLanguages(["en-US"]);
    const { unmount } = renderPrompt();

    fireEvent.click(screen.getByLabelText("Dismiss"));

    expect(offer()).toBeNull();
    // Dismissing is not choosing: the language must be untouched, so the
    // switcher still reads "no explicit choice".
    expect(i18n.language).toBe("ru");
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();

    unmount();
    renderPrompt();
    expect(offer()).toBeNull();
  });

  it("labels itself in English, since only a non-Russian reader ever sees it", () => {
    setBrowserLanguages(["en-US"]);
    renderPrompt();

    // A Russian aria-label on a lang="en" region hands a screen reader Cyrillic
    // to voice with an English synthesiser.
    expect(screen.getByRole("region", { name: "Language" })).not.toBeNull();
  });

  it("declares a ring colour that contrasts with its own blue strip", () => {
    // currentColor here was blue-on-blue: a 1.00:1 ring on the only action the
    // prompt has. The CSS falls back to currentColor, so losing the property
    // silently restores that.
    setBrowserLanguages(["en-US"]);
    renderPrompt();

    // Only the custom property is asserted: jsdom does not serialise a
    // `background` shorthand holding a var(), so reading the strip's own colour
    // back would test jsdom rather than this component.
    const region = screen.getByRole("region", { name: "Language" });
    expect(region.style.getPropertyValue("--rv-focus-ring")).toBe("var(--rv-cream)");
  });

  it("survives localStorage throwing instead of taking the landing down", () => {
    setBrowserLanguages(["en-US"]);
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });

    expect(() => renderPrompt()).not.toThrow();

    spy.mockRestore();
  });
});
