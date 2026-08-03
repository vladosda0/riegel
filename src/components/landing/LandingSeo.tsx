// LandingSeo — per-language head tags for the marketing landing.
//
// The landing is client-rendered from a single static shell (index.html), so
// the shell can only ever hardcode one language's title, description and
// canonical. This component owns the parts that must follow the ACTIVE
// language, and only for `/`:
//
//   <title>, <meta name=description>, og:title, og:description  — localized
//   <link rel=canonical>                                        — self, per language
//   <link rel=alternate hreflang=ru|en|x-default>               — the pair
//
// Scoped to the landing on purpose. The same shell is served for /privacy,
// /offer and every other client-rendered route, so hreflang or a canonical
// baked into index.html would claim, on those pages, that their alternate is
// the homepage. Everything here is therefore torn down on unmount, and the
// prerendered /blog/* pages — which ship their own head — are never touched.
//
// Crawlers that do not execute JS still get the sitemap's xhtml:link
// annotations (scripts/prerender-blog.mjs), which carry the same pairing.

import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { getActiveLanguage, type AppLanguage } from "@/i18n";

/** Matches SITE_ORIGIN in scripts/prerender-blog.mjs — one canonical host. */
const SITE_ORIGIN = "https://rovno.ai";

/** The landing's URL per language. Russian is the default and stays param-free. */
const LANDING_URLS: Record<AppLanguage, string> = {
  ru: `${SITE_ORIGIN}/`,
  en: `${SITE_ORIGIN}/?lang=en`,
};

/**
 * What a meta tag looked like before this component touched it, so unmount can
 * put it back exactly. `existed` is tracked separately from `previous` because
 * a tag can be present with no `content` attribute at all: collapsing the two
 * would delete a tag that index.html actually ships.
 */
type MetaSnapshot = { attr: "name" | "property"; key: string; existed: boolean; previous: string | null };

function upsertMeta(attr: "name" | "property", key: string, content: string): MetaSnapshot {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  const snapshot: MetaSnapshot = { attr, key, existed: el !== null, previous: el?.getAttribute("content") ?? null };
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
  return snapshot;
}

function restoreMeta({ attr, key, existed, previous }: MetaSnapshot): void {
  const el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  if (!el) return;
  if (!existed) el.remove();
  else if (previous === null) el.removeAttribute("content");
  else el.setAttribute("content", previous);
}

/** Owned link tags carry a data attribute so teardown can't remove anyone else's. */
const OWNED = "data-landing-seo";

function addLink(rel: string, href: string, hreflang?: string): void {
  const el = document.createElement("link");
  el.setAttribute("rel", rel);
  el.setAttribute("href", href);
  if (hreflang) el.setAttribute("hreflang", hreflang);
  el.setAttribute(OWNED, "");
  document.head.appendChild(el);
}

function removeOwnedLinks(): void {
  document.head.querySelectorAll(`link[${OWNED}]`).forEach((el) => el.remove());
}

export function LandingSeo() {
  // useTranslation() subscribes the effect below to language changes; `t` and
  // the active language are both read fresh on every such re-render.
  const { t } = useTranslation();
  const lang = getActiveLanguage();

  useEffect(() => {
    const previousTitle = document.title;
    const title = t("landing.meta.title");
    const description = t("landing.meta.description");

    document.title = title;
    // Snapshot every tag on the way in. The same shell serves /offer, /privacy,
    // /refund and /contacts, none of which manage their own head, so anything
    // left behind here follows the visitor onto those pages — an English
    // description and an og:url of `/?lang=en` on the Russian public offer.
    const metas = [
      upsertMeta("name", "description", description),
      upsertMeta("property", "og:title", title),
      upsertMeta("property", "og:description", description),
      upsertMeta("name", "twitter:title", title),
      upsertMeta("property", "og:url", LANDING_URLS[lang]),
    ];

    // Rebuilt wholesale on every language change: a stale canonical pointing at
    // the other language is worse than none at all.
    removeOwnedLinks();
    addLink("canonical", LANDING_URLS[lang]);
    addLink("alternate", LANDING_URLS.ru, "ru");
    addLink("alternate", LANDING_URLS.en, "en");
    // x-default is what a crawler serves a visitor we have no better guess for.
    // That is the same audience the app itself defaults to English for, so the
    // two must agree — pointing it at the Russian page would contradict the
    // runtime behaviour a crawler can observe.
    addLink("alternate", LANDING_URLS.en, "x-default");

    // og:locale and og:locale:alternate are deliberately NOT restored here:
    // they are language-level rather than route-level, i18n.ts owns them, and
    // they stay correct on whatever route the visitor lands on next.
    return () => {
      removeOwnedLinks();
      metas.forEach(restoreMeta);
      document.title = previousTitle;
    };
  }, [t, lang]);

  return null;
}
