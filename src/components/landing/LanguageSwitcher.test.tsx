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

function renderToned(tone: "blue" | "cream") {
  return render(
    <MemoryRouter>
      <LanguageSwitcher tone={tone} />
    </MemoryRouter>,
  );
}

const group = () => screen.getByRole("group");

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

  /**
   * The focus ring has regressed three times: absent, then absent again in a
   * new component, then present but painted 1.00:1 against its own background.
   * jsdom cannot evaluate :focus-visible or the cascade, so this is the cheap
   * tripwire instead: the ring colour must be declared, and must differ from
   * the colour the ACTIVE button paints itself in — which is exactly what
   * `currentColor` resolved to when the ring was invisible. A refactor that
   * drops the custom property silently restores that bug, because the CSS
   * fallback is `currentColor`.
   */
  it.each([
    ["blue", "var(--rv-blue)", "var(--rv-cream)"],
    ["cream", "var(--rv-cream)", "var(--rv-blue)"],
  ] as const)("declares a %s-tone ring that contrasts with the active button", (tone, ring, activeInk) => {
    renderToned(tone);

    expect(group().style.getPropertyValue("--rv-focus-ring")).toBe(ring);
    // The active pill inverts fg/bg, so the colour it paints ITSELF in is the
    // wrong ring colour — that inversion is what made currentColor invisible.
    // (Asserted against the tone constant rather than the rendered style: the
    // buttons set `all: unset`, after which jsdom stops serialising `color`.)
    expect(ring).not.toBe(activeInk);
  });

  it("gives the nav and footer switchers distinct accessible names", () => {
    const { unmount } = renderToned("blue");
    const nav = group().getAttribute("aria-label");
    unmount();

    renderToned("cream");
    expect(group().getAttribute("aria-label")).not.toBe(nav);
  });

  /**
   * The label carries the TARGET language, the title is in the READER's. Both
   * on the button meant the title inherited the target language, so a screen
   * reader announced it with the wrong synthesiser.
   */
  it("scopes lang to the label, not the button that holds the title", () => {
    renderSwitcher();

    // The inactive button is the one that still has a tooltip; the active one
    // deliberately has none, since its click is a no-op.
    const inactive = screen.getByRole("button", { pressed: false });
    expect(inactive.hasAttribute("lang")).toBe(false);
    expect(inactive.querySelector("span[lang]")?.getAttribute("lang")).toBe("ru");
    expect(inactive.getAttribute("title")).toBeTruthy();
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
