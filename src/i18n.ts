import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import ru from "@/locales/ru.json";
import en from "@/locales/en.json";

const STORAGE_KEY = "app-language";

/** Query param that opens — and shares — a specific language: `/?lang=en`. */
export const LANGUAGE_QUERY_PARAM = "lang";

export type AppLanguage = "ru" | "en";

/**
 * The product is Russian first and stays Russian unless the visitor says
 * otherwise, either with `?lang=` or with the switcher.
 *
 * An earlier revision defaulted to English whenever the browser did not rank
 * Russian first. That broke two things at once: `/` emitted a different
 * canonical per visitor (so Googlebot, which renders as en-US, saw the Russian
 * landing declare itself a duplicate of `/?lang=en` and the Russian page lost
 * its indexable URL), and every existing user on an English-locale OS would
 * have found the WHOLE app in English on their next load. Non-Russian speakers
 * are now offered English by LandingLanguagePrompt instead of being switched.
 */
const DEFAULT_LANGUAGE: AppLanguage = "ru";

/**
 * Map a BCP-47 tag onto a language we actually ship. Prefix-matched, so
 * "en-GB", "ru-BY" and "ru_RU" all resolve; anything else is null (not ours),
 * which is what lets a caller fall through to the next signal.
 */
function matchLanguage(tag: string | null | undefined): AppLanguage | null {
  if (!tag) return null;
  const normalized = tag.trim().toLowerCase().replace(/_/g, "-");
  if (normalized === "ru" || normalized.startsWith("ru-")) return "ru";
  if (normalized === "en" || normalized.startsWith("en-")) return "en";
  return null;
}

// localStorage is not always readable — Safari private mode and "block all
// cookies" make the accessor itself throw. This module runs at boot, before any
// error boundary exists, so an unguarded read takes down the whole app rather
// than merely losing a preference.
function readStorage(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStorage(value: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, value);
  } catch {
    // Preference just won't survive the reload; not worth failing over.
  }
}

/** `?lang=` from the current URL, when it names a language we ship. */
export function getUrlLanguage(search?: string): AppLanguage | null {
  const query = search ?? (typeof window === "undefined" ? "" : window.location.search);
  if (!query) return null;
  return matchLanguage(new URLSearchParams(query).get(LANGUAGE_QUERY_PARAM));
}

/**
 * The language the visitor chose themselves — via the switcher, the settings
 * panel, or by opening a `?lang=` link. Null means "never chose", which is the
 * only case where auto-detection gets a say.
 */
export function getStoredLanguage(): AppLanguage | null {
  return matchLanguage(readStorage());
}

/**
 * Would this visitor rather not read Russian?
 *
 * This does NOT decide the interface language — see resolveInitialLanguage.
 * It only decides whether LandingLanguagePrompt offers the switch. Keeping the
 * browser's preference out of the boot path is the whole point: a guess that
 * changes what a page IS breaks canonical stability, whereas a guess that
 * changes what a page OFFERS is free to be wrong.
 *
 * Walks navigator.languages in preference order and answers on the first tag we
 * ship. A browser that asks for neither (German only, say) resolves to true:
 * they certainly did not ask for Russian, and English is the better offer.
 * Note this cannot be expressed as `detectBrowserLanguage() !== "ru"` — that
 * would fold a German browser into the Russian default and never offer at all.
 */
export function prefersNonRussian(): boolean {
  if (typeof navigator === "undefined") return false;
  const tags = navigator.languages?.length ? navigator.languages : [navigator.language];
  for (const tag of tags) {
    const match = matchLanguage(tag);
    if (match) return match !== "ru";
  }
  return true;
}

/**
 * Boot language, most explicit signal first: the URL, then the visitor's own
 * stored choice, then Russian.
 *
 * `?lang=` outranks the stored choice on purpose: a shared link has to open in
 * the language it promises, even for someone who once picked the other one.
 * Opening such a link counts as choosing, so it is persisted — otherwise the
 * first in-app navigation (which drops the query) would silently switch back.
 *
 * The browser's own preference is deliberately NOT a rung here. Every URL must
 * render the same language for every visitor, or its canonical is a function of
 * who is asking, and a crawler and a reader disagree about what the page is.
 */
export function resolveInitialLanguage(): AppLanguage {
  const fromUrl = getUrlLanguage();
  if (fromUrl) {
    writeStorage(fromUrl);
    return fromUrl;
  }
  return getStoredLanguage() ?? DEFAULT_LANGUAGE;
}

/** The language the UI is actually rendering in right now. */
export function getActiveLanguage(): AppLanguage {
  return matchLanguage(i18n.language) ?? DEFAULT_LANGUAGE;
}

export function setStoredLanguage(lang: AppLanguage): void {
  writeStorage(lang);
}

/**
 * Apply a language everywhere in one call: switch i18n live AND persist it for the
 * next boot. Use this from every language switcher so the UI, localStorage, and
 * subsequent reloads stay consistent.
 */
export function setAppLanguage(lang: AppLanguage): void {
  setStoredLanguage(lang);
  void i18n.changeLanguage(lang);
}

void i18n.use(initReactI18next).init({
  resources: {
    ru: { translation: ru },
    en: { translation: en },
  },
  lng: resolveInitialLanguage(),
  fallbackLng: "en",
  interpolation: {
    escapeValue: false,
  },
});

// Keep <html lang> in sync with the active UI language. The static index.html
// can only hardcode one language; without this it never reflects the real one
// (a11y / screen-reader correctness, and what a crawler reads).
//
// og:locale is deliberately NOT touched here. It describes the PAGE, not the
// chrome around it, and the landing is the only route that has a second
// language version — so LandingSeo owns it, scoped to `/`. Writing it globally
// made /blog/, /offer and the other Russian-only routes advertise an English
// translation that does not exist, and contradicted the prerenderer's own
// `inLanguage: "ru-RU"` on the very same pages.
function syncDocumentLanguage(lng: string): void {
  if (typeof document === "undefined") return;
  document.documentElement.lang = matchLanguage(lng) ?? DEFAULT_LANGUAGE;
}
syncDocumentLanguage(i18n.language);
i18n.on("languageChanged", syncDocumentLanguage);

export default i18n;
