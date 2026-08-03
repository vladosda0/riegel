// Keeps <html lang> describing the CONTENT of the current route, not the
// chrome around it.
//
// Most of the app is translated, so there the interface language is also the
// content language and i18n.ts's own sync is right. A few routes are not: the
// blog's articles and the legal pages exist only in Russian, whatever language
// the reader picked for the UI. Left alone, a reader who chose English got
// `<html lang="en">` over Russian legal prose — which tells a screen reader to
// voice Cyrillic with an English synthesiser, and contradicts the prerenderer,
// which stamps `inLanguage: "ru-RU"` on those very pages.
//
// Mounted once inside the router. It runs after i18n.ts's languageChanged
// listener (that fires synchronously during changeLanguage, this is an effect),
// so it has the last word on both a language change and a route change.

import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { getActiveLanguage } from "@/i18n";

/**
 * Routes whose content is Russian regardless of the interface language.
 * Matched on the segment boundary, so `/offerta` or `/blogger` would not count.
 */
const RUSSIAN_ONLY_ROUTES = ["/blog", "/offer", "/privacy", "/refund", "/contacts"];

function isRussianOnly(pathname: string): boolean {
  return RUSSIAN_ONLY_ROUTES.some((route) => pathname === route || pathname.startsWith(`${route}/`));
}

export function DocumentLanguage() {
  // useTranslation() is what re-runs this on a language change; useLocation on
  // a navigation.
  const { i18n } = useTranslation();
  const { pathname } = useLocation();

  useEffect(() => {
    document.documentElement.lang = isRussianOnly(pathname) ? "ru" : getActiveLanguage();
  }, [pathname, i18n.language]);

  return null;
}
