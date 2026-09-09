import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import ru from "@/locales/ru.json";
import en from "@/locales/en.json";

/**
 * The landing's title and description live in two places that must agree: the
 * static shell in index.html, which is what a crawler that does not run JS
 * sees, and `landing.meta.*`, which LandingSeo swaps in once JS has run.
 *
 * The bounds encode the finding this file was written for (rovno#129 ·
 * landing-meta-title-description): the Russian title was eight characters long,
 * while the English pair shipping beside it was a full sentence. The upper
 * bounds are the other half of the same guard, so "make it more descriptive"
 * cannot turn a snippet into a paragraph.
 */
const MIN_TITLE_CHARS = 30;
const MAX_TITLE_CHARS = 60;
const MIN_DESCRIPTION_CHARS = 90;
const MAX_DESCRIPTION_CHARS = 160;

const shell = readFileSync(resolve(__dirname, "../../../index.html"), "utf8");

function shellTitle(): string {
  return /<title>([^<]*)<\/title>/.exec(shell)?.[1] ?? "";
}

function shellMeta(attr: "name" | "property", key: string): string {
  const pattern = new RegExp(`<meta ${attr}="${key}" content="([^"]*)"`);
  return pattern.exec(shell)?.[1] ?? "";
}

describe("landing meta", () => {
  it("says enough about the product to stand alone in a search result", () => {
    for (const pair of [ru, en]) {
      expect(pair["landing.meta.title"].length).toBeGreaterThanOrEqual(MIN_TITLE_CHARS);
      expect(pair["landing.meta.title"].length).toBeLessThanOrEqual(MAX_TITLE_CHARS);
      expect(pair["landing.meta.description"].length).toBeGreaterThanOrEqual(MIN_DESCRIPTION_CHARS);
      expect(pair["landing.meta.description"].length).toBeLessThanOrEqual(MAX_DESCRIPTION_CHARS);
    }
  });

  it("keeps the static shell and the Russian locale in sync", () => {
    expect(shellTitle()).toBe(ru["landing.meta.title"]);
    expect(shellMeta("name", "description")).toBe(ru["landing.meta.description"]);
    expect(shellMeta("property", "og:title")).toBe(ru["landing.meta.title"]);
    expect(shellMeta("property", "og:description")).toBe(ru["landing.meta.description"]);
    expect(shellMeta("name", "twitter:title")).toBe(ru["landing.meta.title"]);
  });
});
