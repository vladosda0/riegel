// The switcher has to keep three things in step: the rendered language, the
// persisted choice, and the URL that gets copied out of the address bar.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";

import { LanguageSwitcher } from "@/components/landing/LanguageSwitcher";
import i18n from "@/i18n";

const STORAGE_KEY = "app-language";

function LocationProbe() {
  const location = useLocation();
  return <span data-testid="location">{`${location.pathname}${location.search}${location.hash}`}</span>;
}

function renderSwitcher(initialEntry = "/") {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <LanguageSwitcher />
      <LocationProbe />
    </MemoryRouter>,
  );
}

// Every changeLanguage re-renders whatever is mounted, so each one is wrapped —
// including the fixtures, which otherwise trip the act() warning on teardown.
async function switchLanguage(lang: string) {
  await act(async () => {
    await i18n.changeLanguage(lang);
  });
}

beforeEach(async () => {
  localStorage.clear();
  await switchLanguage("en");
});

afterEach(async () => {
  localStorage.clear();
  await switchLanguage("en");
});

describe("LanguageSwitcher", () => {
  it("marks the active language pressed and the other not", () => {
    renderSwitcher();

    expect(screen.getByRole("button", { name: "EN" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "RU" })).toHaveAttribute("aria-pressed", "false");
  });

  it("switches the UI language and persists the choice", async () => {
    renderSwitcher();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "RU" }));
    });

    expect(i18n.language).toBe("ru");
    expect(localStorage.getItem(STORAGE_KEY)).toBe("ru");
  });

  it("puts ?lang=en in the URL so the page can be shared as English", async () => {
    await switchLanguage("ru");
    renderSwitcher();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "EN" }));
    });

    expect(screen.getByTestId("location")).toHaveTextContent("/?lang=en");
  });

  it("drops the param for Russian, keeping the default URL canonical", async () => {
    renderSwitcher("/?lang=en");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "RU" }));
    });

    expect(screen.getByTestId("location").textContent).toBe("/");
  });

  /**
   * Regression guard: setSearchParams would drop the hash, bouncing a reader
   * who switched language while looking at #pricing back to the top of the page.
   */
  it("preserves the in-page hash when switching", async () => {
    await switchLanguage("ru");
    renderSwitcher("/#pricing");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "EN" }));
    });

    expect(screen.getByTestId("location")).toHaveTextContent("/?lang=en#pricing");
  });

  it("keeps unrelated query params intact", async () => {
    await switchLanguage("ru");
    renderSwitcher("/?utm_source=telegram");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "EN" }));
    });

    expect(screen.getByTestId("location")).toHaveTextContent("utm_source=telegram");
    expect(screen.getByTestId("location")).toHaveTextContent("lang=en");
  });
});
