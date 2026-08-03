// <html lang> must describe the content, not the chrome. The failure this
// guards is quiet: a reader who picked English gets Russian legal prose voiced
// by an English screen-reader synthesiser, and a crawler is told a Russian page
// is English.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import { DocumentLanguage } from "@/components/system/DocumentLanguage";
import i18n from "@/i18n";

function renderAt(pathname: string) {
  return render(
    <MemoryRouter initialEntries={[pathname]}>
      <DocumentLanguage />
    </MemoryRouter>,
  );
}

async function runInterfaceIn(lang: "ru" | "en") {
  await act(async () => {
    await i18n.changeLanguage(lang);
  });
}

beforeEach(async () => {
  await runInterfaceIn("en");
});

afterEach(async () => {
  await runInterfaceIn("en");
  document.documentElement.lang = "en";
});

describe("DocumentLanguage", () => {
  it("follows the interface language on translated routes", async () => {
    await runInterfaceIn("en");
    renderAt("/home");

    expect(document.documentElement.lang).toBe("en");
  });

  it.each(["/blog", "/offer", "/privacy", "/refund", "/contacts"])(
    "pins %s to Russian even when the interface is English",
    async (route) => {
      await runInterfaceIn("en");
      renderAt(route);

      expect(document.documentElement.lang).toBe("ru");
    },
  );

  it("pins nested Russian-only routes too", async () => {
    await runInterfaceIn("en");
    renderAt("/blog/kak-stroit-rovno/");

    expect(document.documentElement.lang).toBe("ru");
  });

  it("does not pin a route that merely starts with the same letters", async () => {
    // Segment-boundary matching: /blogger is not /blog.
    await runInterfaceIn("en");
    renderAt("/blogger");

    expect(document.documentElement.lang).toBe("en");
  });

  it("does not pin the blog admin screens, which are app chrome", async () => {
    // They match the /blog prefix but are translated like the rest of the app.
    await runInterfaceIn("en");
    renderAt("/blog/admin");

    expect(document.documentElement.lang).toBe("en");
  });

  it("pins a case-variant path, since the router matches case-insensitively", async () => {
    await runInterfaceIn("en");
    renderAt("/OFFER");

    expect(document.documentElement.lang).toBe("ru");
  });

  it("leaves Russian-only routes Russian when the interface is Russian too", async () => {
    await runInterfaceIn("ru");
    renderAt("/offer");

    expect(document.documentElement.lang).toBe("ru");
  });
});
