// LandingSeo mutates document.head directly, which makes its TEARDOWN the risky
// half: the same static shell serves /offer, /privacy, /refund and /contacts,
// and none of them manage their own head. Anything this component leaves behind
// follows the visitor onto those pages — an English description and an og:url
// of `/?lang=en` sitting on the Russian public offer.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import { LandingSeo } from "@/components/landing/LandingSeo";
import i18n from "@/i18n";

/** The head tags index.html actually ships, recreated for jsdom. */
const SHELL_TITLE = "Ровно ИИ — управление строительными проектами";
const SHELL_META: [string, string, string][] = [
  ["name", "description", "Управляйте строительными проектами: сметы, задачи, закупки, фото и документы в одном пространстве с ИИ."],
  ["property", "og:title", "Ровно ИИ — управление строительными проектами"],
  ["property", "og:description", "Управляйте строительными проектами: сметы, задачи, закупки, фото и документы в одном пространстве с ИИ."],
  ["name", "twitter:title", "Ровно ИИ — управление строительными проектами"],
  // index.html ships og:locale, and LandingSeo overwrites it — so it must be
  // seeded here, or the restore test silently exercises the create-and-remove
  // path instead of the snapshot-and-restore one it exists to guard.
  ["property", "og:locale", "ru_RU"],
];

function meta(attr: string, key: string): HTMLMetaElement | null {
  return document.head.querySelector(`meta[${attr}="${key}"]`);
}

function seedShellHead(): void {
  document.head.innerHTML = "";
  document.title = SHELL_TITLE;
  for (const [attr, key, content] of SHELL_META) {
    const el = document.createElement("meta");
    el.setAttribute(attr, key);
    el.setAttribute("content", content);
    document.head.appendChild(el);
  }
}

/** LandingSeo derives the canonical from the URL, so tests must supply one. */
function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <LandingSeo />
    </MemoryRouter>,
  );
}

async function runInterfaceIn(lang: "ru" | "en") {
  await act(async () => {
    await i18n.changeLanguage(lang);
  });
}

beforeEach(seedShellHead);

afterEach(async () => {
  document.head.innerHTML = "";
  await runInterfaceIn("en");
});

describe("LandingSeo", () => {
  it("localizes the head while mounted", async () => {
    await runInterfaceIn("en");
    renderAt("/");

    expect(document.title).toBe(i18n.t("landing.meta.title"));
    expect(meta("name", "description")?.content).toBe(i18n.t("landing.meta.description"));
  });

  it("publishes a reciprocal hreflang cluster with x-default on the Russian page", async () => {
    await runInterfaceIn("en");
    renderAt("/");

    const alternates = [...document.head.querySelectorAll("link[rel=alternate][hreflang]")].map(
      (el) => `${el.getAttribute("hreflang")}=${el.getAttribute("href")}`,
    );
    expect(alternates).toEqual([
      "ru=https://rovno.ai/",
      "en=https://rovno.ai/?lang=en",
      // `/` renders Russian for everyone now, so it is also the page to serve a
      // visitor we have no better guess for.
      "x-default=https://rovno.ai/",
    ]);
  });

  /**
   * The regression guard for the blocking audit finding. The canonical is a
   * property of the URL, never of the visitor. Deriving it from the rendered
   * language meant bare `rovno.ai/` told an English-locale client its canonical
   * was `/?lang=en` — and Googlebot renders as en-US, so the Russian landing
   * declared itself a duplicate of the English one and lost its indexable URL.
   */
  it("keeps / self-canonical even while rendering English", async () => {
    await runInterfaceIn("en");
    renderAt("/");

    expect(document.head.querySelector('link[rel="canonical"]')?.getAttribute("href")).toBe(
      "https://rovno.ai/",
    );
    expect(meta("property", "og:url")?.content).toBe("https://rovno.ai/");
    expect(meta("property", "og:locale")?.content).toBe("ru_RU");
  });

  it("makes /?lang=en self-canonical", async () => {
    await runInterfaceIn("en");
    renderAt("/?lang=en");

    expect(document.head.querySelector('link[rel="canonical"]')?.getAttribute("href")).toBe(
      "https://rovno.ai/?lang=en",
    );
    expect(meta("property", "og:url")?.content).toBe("https://rovno.ai/?lang=en");
    expect(meta("property", "og:locale")?.content).toBe("en_US");
    expect(meta("property", "og:locale:alternate")?.content).toBe("ru_RU");
  });

  /**
   * Pins the deliberate split between the two tag groups, which nothing covered
   * before. A returning reader with a stored English choice lands on bare `/`
   * (every nav link drops the query) and reads English, while the URL-keyed
   * tags must keep describing `/` as the Russian page — because the only things
   * that read them fetch the URL fresh, with no stored choice, and must be told
   * Russian.
   */
  it("keeps URL-keyed tags on the URL's language while the reader sees theirs", async () => {
    await runInterfaceIn("en");
    renderAt("/");

    // What the reader sees.
    expect(document.title).toBe(i18n.t("landing.meta.title"));
    expect(meta("name", "description")?.content).toBe(i18n.t("landing.meta.description"));
    // What a crawler or scraper is told about this URL.
    expect(document.head.querySelector('link[rel="canonical"]')?.getAttribute("href")).toBe(
      "https://rovno.ai/",
    );
    expect(meta("property", "og:url")?.content).toBe("https://rovno.ai/");
    expect(meta("property", "og:locale")?.content).toBe("ru_RU");
    expect(meta("property", "og:locale:alternate")?.content).toBe("en_US");
  });

  it("gives one URL the same canonical regardless of the rendered language", async () => {
    await runInterfaceIn("ru");
    const { unmount } = renderAt("/");
    const asRussian = document.head.querySelector('link[rel="canonical"]')?.getAttribute("href");
    unmount();

    await runInterfaceIn("en");
    renderAt("/");
    const asEnglish = document.head.querySelector('link[rel="canonical"]')?.getAttribute("href");

    expect(asEnglish).toBe(asRussian);
  });

  /**
   * The regression this file exists for. Leaving the landing must not leave its
   * meta behind on a route that ships no head of its own.
   */
  it("restores every overwritten tag on unmount", async () => {
    await runInterfaceIn("en");
    const { unmount } = renderAt("/");
    unmount();

    expect(document.title).toBe(SHELL_TITLE);
    for (const [attr, key, content] of SHELL_META) {
      expect(meta(attr, key)?.content, `${key} must be restored`).toBe(content);
    }
  });

  it("removes the tags it created rather than leaving them empty", async () => {
    await runInterfaceIn("en");
    const { unmount } = renderAt("/");

    // og:url is absent from the shell, so it is ours and must go entirely.
    expect(meta("property", "og:url")).not.toBeNull();
    unmount();

    expect(meta("property", "og:url")).toBeNull();
    expect(document.head.querySelector('link[rel="canonical"]')).toBeNull();
    expect(document.head.querySelectorAll("link[rel=alternate][hreflang]")).toHaveLength(0);
  });

  it("does not leak the other language's tags across a switch", async () => {
    await runInterfaceIn("en");
    const { unmount } = renderAt("/");
    await runInterfaceIn("ru");

    expect(document.head.querySelectorAll('link[rel="canonical"]')).toHaveLength(1);
    expect(document.head.querySelector('link[rel="canonical"]')?.getAttribute("href")).toBe(
      "https://rovno.ai/",
    );

    unmount();
    expect(document.title).toBe(SHELL_TITLE);
    expect(meta("name", "description")?.content).toBe(SHELL_META[0][2]);
  });
});
