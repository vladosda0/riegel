// LandingLanguagePrompt — offers English to a visitor whose browser does not
// ask for Russian, without switching anything on their behalf.
//
// Why an offer and not a redirect: the language a URL renders has to be the
// same for every visitor, or its canonical becomes a function of who is asking.
// Auto-switching on `navigator.languages` made bare `rovno.ai/` serve English
// to Googlebot (which renders as en-US) while declaring `/?lang=en` canonical,
// which cost the Russian landing its indexable URL. Offering costs nothing if
// the guess is wrong; switching costs the page its identity.
//
// Why the browser language and not the IP: an IP says where the packets came
// from, not what the reader reads. A large share of Russian traffic arrives
// through non-RU VPN exits and would be told, wrongly and on every visit, that
// this site is not in their language. It would also need a geo lookup, and this
// is a static SPA with no server — so the answer could only arrive after first
// paint, as a flash.
//
// Why a bottom strip and not a modal: a full-screen overlay over the main
// content on load is what Google's intrusive-interstitial policy targets, and
// Googlebot renders as en-US, so it would meet exactly that overlay on the page
// we most want ranked. A dismissible strip is the pattern that policy exempts.

import { useState, type CSSProperties } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { LANGUAGE_QUERY_PARAM, getActiveLanguage, getStoredLanguage, prefersNonRussian, setAppLanguage } from "@/i18n";

const DISMISS_KEY = "landing-language-prompt-dismissed";

// Same guarded access as @/i18n: the accessor itself throws in Safari private
// mode and with cookies blocked, and this renders on the landing's first paint.
function readDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

function writeDismissed(): void {
  try {
    localStorage.setItem(DISMISS_KEY, "1");
  } catch {
    // Worst case the offer reappears next visit; still better than throwing.
  }
}

export function LandingLanguagePrompt() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const [dismissed, setDismissed] = useState(readDismissed);
  const active = getActiveLanguage();

  // Offer only when all of these hold: the visitor has never chosen a language
  // (a stored choice, including one made by opening a `?lang=` link, is an
  // answer and must not be nagged), the page is currently Russian, and the
  // browser asks for something else.
  const shouldOffer = !dismissed && active === "ru" && getStoredLanguage() === null && prefersNonRussian();
  if (!shouldOffer) return null;

  const switchToEnglish = () => {
    setAppLanguage("en");
    const params = new URLSearchParams(location.search);
    params.set(LANGUAGE_QUERY_PARAM, "en");
    // Mirrors LanguageSwitcher: explicit pathname/hash, because setSearchParams
    // drops the hash and would bounce the reader to the top of the page.
    navigate(
      { pathname: location.pathname, search: `?${params.toString()}`, hash: location.hash },
      { replace: true },
    );
  };

  const dismiss = () => {
    writeDismissed();
    setDismissed(true);
  };

  return (
    <div
      role="region"
      className="rv-lang-prompt"
      // The copy is English in BOTH locales on purpose: the only person who
      // sees this cannot read the Russian page it is sitting on. That includes
      // the accessible name: labelling an English region with the Russian
      // "Язык интерфейса" would hand a screen reader Cyrillic to voice with an
      // English synthesiser, which is the failure DocumentLanguage exists to
      // prevent. It also needs to differ from the switcher's own group label,
      // or the page carries two identically named regions.
      lang="en"
      aria-label={t("landing.languagePrompt.regionLabel")}
      style={{
        // The strip is blue, so the focus ring must be cream. currentColor here
        // resolved to blue on the primary button and painted an invisible ring
        // on the only action this prompt has.
        "--rv-focus-ring": "var(--rv-cream)",
        position: "fixed",
        left: 16,
        right: 16,
        bottom: 16,
        zIndex: 90,
        margin: "0 auto",
        maxWidth: 560,
        boxSizing: "border-box",
        display: "flex",
        alignItems: "center",
        gap: 12,
        flexWrap: "wrap",
        padding: "12px 14px",
        borderRadius: 14,
        background: "var(--rv-blue)",
        color: "var(--rv-cream)",
        boxShadow: "var(--shadow-3)",
        fontFamily: "var(--font-body)",
        fontSize: 14,
        lineHeight: "20px",
      } as CSSProperties}
    >
      <span style={{ flex: 1, minWidth: 180 }}>{t("landing.languagePrompt.text")}</span>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
        <button
          type="button"
          onClick={switchToEnglish}
          style={{
            all: "unset",
            cursor: "pointer",
            boxSizing: "border-box",
            minHeight: 32,
            display: "inline-flex",
            alignItems: "center",
            padding: "6px 14px",
            borderRadius: 999,
            background: "var(--rv-cream)",
            color: "var(--rv-blue)",
            fontWeight: 600,
          }}
        >
          {t("landing.languagePrompt.action")}
        </button>
        <button
          type="button"
          onClick={dismiss}
          aria-label={t("landing.languagePrompt.dismiss")}
          style={{
            all: "unset",
            cursor: "pointer",
            boxSizing: "border-box",
            minHeight: 32,
            minWidth: 32,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 999,
            border: "1px solid rgba(237,235,215,0.4)",
            fontSize: 16,
            lineHeight: 1,
          }}
        >
          ✕
        </button>
      </div>
    </div>
  );
}
