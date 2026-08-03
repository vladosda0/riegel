// LanguageSwitcher — the RU / EN toggle on the marketing landing.
//
// One click does three things that have to stay in step: flip i18n, persist the
// choice, and rewrite `?lang=` so whatever is in the address bar can be copied
// and shared as-is. English carries the param; Russian drops it, so the default
// language keeps the clean canonical URL (`/`, not `/?lang=ru`).
//
// The nav and the footer sit on opposite backgrounds, hence `tone`.

import { useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { LANGUAGE_QUERY_PARAM, getActiveLanguage, setAppLanguage, type AppLanguage } from "@/i18n";

const LANGUAGES: { code: AppLanguage; label: string }[] = [
  { code: "ru", label: "RU" },
  { code: "en", label: "EN" },
];

const TONES = {
  blue: { ink: "var(--rv-blue)", activeInk: "var(--rv-cream)", activeBg: "var(--rv-blue)", line: "var(--line-blue-soft)" },
  cream: { ink: "var(--rv-cream)", activeInk: "var(--rv-blue)", activeBg: "var(--rv-cream)", line: "rgba(237,235,215,0.32)" },
} as const;

export function LanguageSwitcher({ tone = "blue" }: { tone?: keyof typeof TONES }) {
  // useTranslation() is what subscribes this component to `languageChanged`;
  // getActiveLanguage() then reads the value through the same normalisation the
  // rest of the app uses, so "en-GB" can't render as neither-button-selected.
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const active = getActiveLanguage();
  const c = TONES[tone];

  const applyLanguage = (next: AppLanguage) => {
    if (next === active) return;
    setAppLanguage(next);
    const params = new URLSearchParams(location.search);
    if (next === "ru") params.delete(LANGUAGE_QUERY_PARAM);
    else params.set(LANGUAGE_QUERY_PARAM, next);
    const search = params.toString();
    // Explicit pathname/hash: setSearchParams would drop the hash, and switching
    // language from `/#pricing` must not bounce the reader to the top. `replace`
    // keeps the toggle out of the back-button history.
    navigate(
      { pathname: location.pathname, search: search ? `?${search}` : "", hash: location.hash },
      { replace: true },
    );
  };

  return (
    <div
      role="group"
      className="rv-lang-switch"
      aria-label={t("landing.language.switcherLabel")}
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: 2,
        gap: 2,
        borderRadius: 999,
        border: `1px solid ${c.line}`,
        flexShrink: 0,
      }}
    >
      {LANGUAGES.map((lang) => {
        const isActive = lang.code === active;
        return (
          <button
            key={lang.code}
            type="button"
            lang={lang.code}
            onClick={() => applyLanguage(lang.code)}
            aria-pressed={isActive}
            title={t("landing.language.switchTo", { language: t(`landing.language.name.${lang.code}`) })}
            style={{
              all: "unset",
              cursor: isActive ? "default" : "pointer",
              boxSizing: "border-box",
              padding: "3px 9px",
              borderRadius: 999,
              fontFamily: "var(--font-mono-ui)",
              fontSize: 11,
              letterSpacing: ".06em",
              lineHeight: "16px",
              textAlign: "center",
              background: isActive ? c.activeBg : "transparent",
              color: isActive ? c.activeInk : c.ink,
              opacity: isActive ? 1 : 0.64,
              transition: "background .16s, color .16s, opacity .16s",
            }}
          >
            {lang.label}
          </button>
        );
      })}
    </div>
  );
}
