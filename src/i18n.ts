import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import ru from "@/locales/ru.json";
import en from "@/locales/en.json";

const STORAGE_KEY = "app-language";

/** Query param that opens — and shares — a specific language: `/?lang=en`. */
export const LANGUAGE_QUERY_PARAM = "lang";

export type AppLanguage = "ru" | "en";

/**
 * What a visitor gets when nothing points at Russian. The product is Russian
 * first, but the landing is also its pitch to a non-Russian audience, and for
 * them a Cyrillic page is a bounce. So Russian has to be asked for — by the
 * browser, the URL, or the switcher — and English is what's left.
 */
const DEFAULT_LANGUAGE: AppLanguage = "en";

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
 * What the browser asks for, in preference order. The first entry that is one
 * of ours wins, so Russian is chosen only when the visitor actually ranks
 * Russian above English — everyone else, including "no opinion", gets English.
 */
export function detectBrowserLanguage(): AppLanguage {
  if (typeof navigator === "undefined") return DEFAULT_LANGUAGE;
  const tags = navigator.languages?.length ? navigator.languages : [navigator.language];
  for (const tag of tags) {
    const match = matchLanguage(tag);
    if (match) return match;
  }
  return DEFAULT_LANGUAGE;
}

/**
 * Boot language, most explicit signal first.
 *
 * `?lang=` outranks the stored choice on purpose: a shared link has to open in
 * the language it promises, even for someone who once picked the other one.
 * Opening such a link counts as choosing, so it is persisted — otherwise the
 * first in-app navigation (which drops the query) would silently switch back.
 */
export function resolveInitialLanguage(): AppLanguage {
  const fromUrl = getUrlLanguage();
  if (fromUrl) {
    writeStorage(fromUrl);
    return fromUrl;
  }
  return getStoredLanguage() ?? detectBrowserLanguage();
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
// (a11y / screen-reader correctness, and what a crawler reads). og:locale rides
// along for the same reason — a shared `?lang=en` link should not preview as
// Russian. Set on boot and on every change.
const OG_LOCALES: Record<AppLanguage, string> = { ru: "ru_RU", en: "en_US" };

function syncDocumentLanguage(lng: string): void {
  if (typeof document === "undefined") return;
  const lang = matchLanguage(lng) ?? DEFAULT_LANGUAGE;
  document.documentElement.lang = lang;
  document.querySelector('meta[property="og:locale"]')?.setAttribute("content", OG_LOCALES[lang]);
  document
    .querySelector('meta[property="og:locale:alternate"]')
    ?.setAttribute("content", OG_LOCALES[lang === "ru" ? "en" : "ru"]);
}
syncDocumentLanguage(i18n.language);
i18n.on("languageChanged", syncDocumentLanguage);

export default i18n;
