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
// Crawlers that do not execute JS get no hreflang pairing at all: the sitemap
// deliberately advertises only the Russian landing, because `/?lang=en` serves
// byte-identical Russian HTML without JS. See scripts/prerender-blog.mjs.

import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { getActiveLanguage, getUrlLanguage, type AppLanguage } from "@/i18n";

/** Matches SITE_ORIGIN in scripts/prerender-blog.mjs — one canonical host. */
const SITE_ORIGIN = "https://rovno.ai";

/** The landing's URL per language. Russian is the default and stays param-free. */
const LANDING_URLS: Record<AppLanguage, string> = {
  ru: `${SITE_ORIGIN}/`,
  en: `${SITE_ORIGIN}/?lang=en`,
};

const OG_LOCALES: Record<AppLanguage, string> = { ru: "ru_RU", en: "en_US" };

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
  // The canonical is a property of the URL, never of the visitor. Deriving it
  // from getActiveLanguage() meant bare `rovno.ai/` told an English-locale
  // browser its canonical was `/?lang=en` — and Googlebot renders as en-US, so
  // the Russian landing declared itself a duplicate of the English one and lost
  // its indexable URL. `useLocation` re-reads it on every client-side nav.
  const { search } = useLocation();
  const urlLang = getUrlLanguage(search) ?? "ru";

  useEffect(() => {
    const previousTitle = document.title;
    const title = t("landing.meta.title");
    const description = t("landing.meta.description");

    // The head deliberately splits into two groups, and on bare `/` they can
    // disagree: a returning visitor with a stored English choice reads an
    // English page whose og:locale says ru_RU.
    //
    // That is intended, not an oversight. The URL-keyed tags (canonical,
    // og:url, og:locale) exist only for consumers that fetch the URL fresh —
    // crawlers and social scrapers — and those never carry localStorage, so
    // they always see, and must always be told, Russian for `/`. The
    // language-keyed tags (title, description) describe what the reader is
    // actually looking at, and a reader who chose English should not get a
    // Russian tab title.
    //
    // No consumer can observe both groups at once: the only context where they
    // differ is a returning reader's own browser, where nothing consumes
    // og:locale. Verified by loading `/` with empty storage on an en-US
    // browser — every tag comes out Russian. The alternatives are worse: making
    // titles follow the URL shows an English page under a Russian title, and
    // making `/` re-assert Russian throws an English reader back to Russian the
    // moment they click any nav link (they all drop the query).
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
      // og:url and og:locale describe THIS url, so both follow urlLang, not the
      // rendered language. The landing is the only route with a second language
      // version, which is why og:locale lives here and not in i18n.ts.
      upsertMeta("property", "og:url", LANDING_URLS[urlLang]),
      upsertMeta("property", "og:locale", OG_LOCALES[urlLang]),
      upsertMeta("property", "og:locale:alternate", OG_LOCALES[urlLang === "ru" ? "en" : "ru"]),
    ];

    // Rebuilt wholesale on every change: a stale canonical pointing at the
    // other language is worse than none at all.
    removeOwnedLinks();
    addLink("canonical", LANDING_URLS[urlLang]);
    addLink("alternate", LANDING_URLS.ru, "ru");
    addLink("alternate", LANDING_URLS.en, "en");
    // x-default is what a crawler shows a visitor it has no better guess for.
    // `/` is now that page for everyone — it renders Russian for every visitor
    // and no longer auto-switches — so x-default and the ru entry agree.
    addLink("alternate", LANDING_URLS.ru, "x-default");

    return () => {
      removeOwnedLinks();
      metas.forEach(restoreMeta);
      document.title = previousTitle;
    };
  }, [t, lang, urlLang]);

  return null;
}
