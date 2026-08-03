// LandingSections — marketing landing sections, ported from the Claude Design
// handoff `ui_kits/website/Sections.jsx`. Faithful to the Figma 1728 design:
// alternating cream / blue / olive / orange full-bleed sections, Rostov display
// + Involve body, blue-as-text-on-cream. Tokens live in landing.css.
//
// Differences from the static handoff (the "port to React" wiring):
//  - CTAs route through the app: the primary one -> getStartedPath (auth-aware),
//    log-in -> /auth/login, the demo one -> a demo session.
//  - Nav + footer links are real in-page anchors / router routes.
//  - Footer requisites use the real entity (see landing.footer.legalLine).
//  - All copy is localized (RU/EN) through the `landing.*` keys; the pricing
//    section reuses the shared `pricing.*` namespace so the landing and the
//    in-app pricing block can't drift apart.
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { PLANS, type PlanCode } from "@/data/plans";
import { formatRubFromKopecks } from "@/lib/billing";
import type { RuntimeAuthStatus } from "@/hooks/use-runtime-auth";
import { getActiveLanguage } from "@/i18n";
import { LanguageSwitcher } from "./LanguageSwitcher";

const E = "cubic-bezier(0.4,0,0.2,1)";

export type LandingCtaProps = {
  /** Auth-aware "get started" target: /home when signed in, else /auth/signup. */
  startPath: string;
  /** Enter a demo session and open the demo project. */
  onDemo: () => void;
};

/** Anchors are stable; only the label is localized (hence the key, not the text). */
const NAV_LINKS = [
  { key: "landing.nav.features", href: "#features" },
  { key: "landing.nav.process", href: "#process" },
  { key: "landing.nav.pricing", href: "#pricing" },
  { key: "landing.nav.faq", href: "#faq" },
];

export function Nav({ startPath, homeLink = false, authStatus = "guest" }: { startPath: string; homeLink?: boolean; authStatus?: RuntimeAuthStatus }) {
  const { t } = useTranslation();
  // homeLink: rendered on a subpage (e.g. /blog) — the logo routes to "/"
  // instead of scrolling to top. (Section anchors are always absolute "/#..."
  // links now, so they land on the landing page from any origin regardless.)
  // authStatus drives the CTA. A signed-in visitor gets a single "В приложение"
  // instead of the "Войти" + "Начать проект" pair (offering "Войти" to someone
  // already logged in was the double-login trap). On a hard load the session
  // resolves async, so status is "loading" for the first frames: we keep the
  // "Войти" slot but render it invisible (visibility:hidden) so it reserves its
  // width — a guest then sees it appear in place with no layout shift, and an
  // authenticated user never sees a "Войти" flash. Only a definitive "guest"
  // shows the link; "loading" hides it, "authenticated" drops it entirely.
  const isAuthed = authStatus === "authenticated";
  const [c, setC] = useState(false);
  useEffect(() => {
    const onScroll = () => setC(window.scrollY > 64);
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  const navT = `max-width .42s ${E}, padding .42s ${E}, background .42s ${E}, border-radius .42s ${E}, box-shadow .42s ${E}, border-bottom-color .42s ${E}, outline-color .42s ${E}`;
  return (
    <>
      <div aria-hidden="true" style={{ height: 113 }} />
      <div
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          zIndex: 100,
          padding: c ? "14px 16px 0" : "0",
          transition: `padding .42s ${E}`,
          pointerEvents: "none",
        }}
      >
        <nav
          className="rv-nav"
          // The chrome is translated even where the PAGE is not. On /blog/ and
          // the legal routes DocumentLanguage pins <html lang="ru"> for the
          // Russian prose, which is right for the article and wrong for this
          // bar: an English reader's "Features / Log in / Start a project"
          // would be voiced by a Russian synthesiser. Declaring the interface
          // language on the subtree is what <html lang> + nested lang is for.
          lang={getActiveLanguage()}
          style={{
            pointerEvents: "auto",
            boxSizing: "border-box",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            whiteSpace: "nowrap",
            width: "100%",
            margin: "0 auto",
            transition: navT,
            maxWidth: c ? 272 : 1728,
            padding: c ? "8px 8px 8px 12px" : "24px 48px",
            background: c ? "var(--bg-alt)" : "var(--bg)",
            borderRadius: c ? 999 : 0,
            boxShadow: c ? "var(--shadow-3)" : "0 0 0 0 rgba(0,0,0,0)",
            borderBottom: "1px solid",
            borderBottomColor: c ? "transparent" : "var(--line-blue-soft)",
            outline: "1px solid",
            outlineColor: c ? "var(--line-blue-soft)" : "transparent",
          }}
        >
          {homeLink ? (
            <Link to="/" title={t("landing.nav.home")} aria-label={t("landing.nav.home")} style={{ display: "flex", alignItems: "center", flexShrink: 0 }}>
              <img
                src="/logo.svg"
                alt={t("landing.nav.logoAlt")}
                style={{ display: "block", height: c ? 34 : 52, width: "auto", transition: `height .42s ${E}` }}
              />
            </Link>
          ) : (
            <div
              onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
              title={t("landing.nav.toTop")}
              role="button"
              aria-label={t("landing.nav.toTop")}
              style={{ display: "flex", alignItems: "center", flexShrink: 0, cursor: "pointer" }}
            >
              {/* App's canonical logo lockup (public/logo.svg), shown larger than in-app. */}
              <img
                src="/logo.svg"
                alt={t("landing.nav.logoAlt")}
                style={{ display: "block", height: c ? 34 : 52, width: "auto", transition: `height .42s ${E}` }}
              />
            </div>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 0, flexShrink: 0 }}>
            <div
              className="rv-nav-tools"
              style={{
                display: "flex",
                gap: 32,
                alignItems: "center",
                overflow: "hidden",
                maxWidth: c ? 0 : 700,
                opacity: c ? 0 : 1,
                marginRight: c ? 0 : 32,
                // Collapsing to zero width with opacity 0 hides these controls
                // visually but leaves every one of them — the anchors, the blog
                // link, the language switcher and «Войти» — in the tab order, so
                // a keyboard user who has scrolled tabs into things that are
                // painted nowhere. visibility:hidden takes the whole subtree out
                // of the tab order; it is delayed by the collapse duration so
                // the fade-out still plays, and applied instantly on the way
                // back so the fade-in does. Layout is untouched either way.
                visibility: c ? "hidden" : "visible",
                transition: `max-width .42s ${E}, opacity .3s ${E}, margin-right .42s ${E}, visibility 0s linear ${c ? ".42s" : "0s"}`,
              }}
            >
              <div className="rv-nav-anchors" style={{ display: "flex", gap: 32, alignItems: "center" }}>
                {/* Always route to the landing section (pathname "/" + hash), so
                    the same link works whether we're on the landing or a subpage
                    like /blog. As a router <Link> it stays a client-side nav (no
                    full reload) and ScrollToHash lands it on the section. */}
                {NAV_LINKS.map((x) => (
                  <Link key={x.key} to={{ pathname: "/", hash: x.href }} style={{ fontFamily: "var(--font-body)", fontSize: 15, color: "var(--rv-blue)", textDecoration: "none", opacity: 0.72 }}>
                    {t(x.key)}
                  </Link>
                ))}
                <Link to="/blog/" style={{ fontFamily: "var(--font-body)", fontSize: 15, color: "var(--rv-blue)", textDecoration: "none", opacity: 0.72 }}>
                  {t("landing.nav.blog")}
                </Link>
              </div>
              <LanguageSwitcher tone="blue" />
              {authStatus !== "authenticated" && (
                <Link
                  className="rv-btn rv-btn--secondary"
                  to="/auth/login"
                  aria-hidden={authStatus === "loading"}
                  tabIndex={authStatus === "loading" ? -1 : undefined}
                  style={{ fontSize: 20, padding: "8px 14px", visibility: authStatus === "loading" ? "hidden" : "visible" }}
                >
                  {t("landing.nav.login")}
                </Link>
              )}
            </div>
            {authStatus === "loading" ? (
              // Auth not resolved yet: keep the primary CTA visible and
              // pixel-identical, but inert. During loading the caller's
              // startPath defaults to the guest /auth/signup, so a premature
              // click by an already-signed-in visitor would misroute to signup;
              // pointer-events:none keeps the button inert (and aria-hidden
              // drops the transient placeholder from the a11y tree) until status
              // resolves (a beat later), when it becomes the real link with the
              // correct label + target. NB: aria-disabled is deliberately avoided
              // here — it matches .rv-btn[aria-disabled] { opacity:.32 } and would
              // dim the CTA, reintroducing the very flash this branch removes.
              <span
                className="rv-btn rv-btn--primary"
                aria-hidden="true"
                style={{ fontSize: 20, padding: "8px 16px", flexShrink: 0, borderRadius: c ? 999 : "var(--r-md)", pointerEvents: "none", transition: `background .12s ${E}, color .12s ${E}, border-color .12s ${E}, transform .12s ${E}, border-radius .42s ${E}` }}
              >
                {t("landing.nav.getStarted")}
              </span>
            ) : (
              <Link
                className="rv-btn rv-btn--primary"
                to={startPath}
                style={{ fontSize: 20, padding: "8px 16px", flexShrink: 0, borderRadius: c ? 999 : "var(--r-md)", transition: `background .12s ${E}, color .12s ${E}, border-color .12s ${E}, transform .12s ${E}, border-radius .42s ${E}` }}
              >
                {isAuthed ? t("landing.nav.openApp") : t("landing.nav.getStarted")}
              </Link>
            )}
          </div>
        </nav>
      </div>
    </>
  );
}

function LogStream() {
  const { t } = useTranslation();
  const items = [
    { icon: "list", text: t("landing.hero.log.plan") },
    { icon: "check", text: t("landing.hero.log.checklist") },
    { icon: "layers", text: t("landing.hero.log.photos") },
  ];
  const icons: Record<string, ReactNode> = {
    list: <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />,
    check: <path d="M20 6L9 17l-5-5" />,
    layers: (
      <>
        <path d="M12 2l10 6-10 6L2 8l10-6z" />
        <path d="M2 17l10 6 10-6M2 12l10 6 10-6" />
      </>
    ),
  };
  return (
    // width:480 as a FIXED width was the landing's horizontal-scroll bug: once the
    // hero stacks to a single column, a grid item's default `min-width: auto`
    // refuses to shrink below this child, so the track — and the page — stayed
    // 480px wide on a 375px phone. Cap it instead of demanding it.
    <div style={{ display: "flex", flexDirection: "column", gap: 24, width: "100%", maxWidth: 480 }}>
      {items.map((it, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 16, color: "var(--rv-blue)", opacity: 0.72 }}>
          <span style={{ flex: 1, fontFamily: "var(--font-body)", fontSize: 14, lineHeight: "20px" }}>{it.text}</span>
          <svg viewBox="0 0 24 24" width={24} height={24} fill="none" stroke="var(--rv-blue)" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
            {icons[it.icon]}
          </svg>
        </div>
      ))}
    </div>
  );
}

export function Hero({ startPath, onDemo }: LandingCtaProps) {
  const { t } = useTranslation();
  return (
    <section className="rv-section rv-hero" style={{ padding: "96px 48px 64px", display: "grid", gridTemplateColumns: "512px 1fr", gap: 48 }}>
      {/* minWidth:0 on both grid items: without it they inherit `min-width: auto`
          and refuse to shrink below their content, which is how a single wide
          child turns into a horizontally scrollable page on a phone. */}
      <div style={{ display: "flex", flexDirection: "column", gap: 32, justifyContent: "center", minWidth: 0 }}>
        <span className="rv-caption" style={{ fontSize: 12, color: "var(--rv-blue)", letterSpacing: ".02em" }}>
          {t("landing.hero.eyebrow")}
        </span>
        <h1 style={{ fontFamily: "var(--font-display)", fontSize: 72, lineHeight: 1, letterSpacing: "-0.03em", color: "var(--rv-blue)", margin: 0 }}>
          {t("landing.hero.title")}
        </h1>
        <p style={{ fontFamily: "var(--font-body)", fontSize: 18, lineHeight: "24px", color: "var(--rv-blue)", opacity: 0.8, maxWidth: 440 }}>
          {t("landing.hero.subtitle")}
        </p>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          <Link className="rv-btn rv-btn--primary" to={startPath}>
            {t("landing.hero.ctaPrimary")}
          </Link>
          <button className="rv-btn rv-btn--secondary" onClick={onDemo}>
            {t("landing.hero.ctaSecondary")}
          </button>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", justifyContent: "flex-end", alignItems: "flex-end", minWidth: 0 }}>
        <LogStream />
      </div>
    </section>
  );
}

export function Problem() {
  const { t } = useTranslation();
  return (
    <section className="rv-section" style={{ padding: "128px 48px", display: "flex", justifyContent: "center" }}>
      <div style={{ maxWidth: 560, display: "flex", flexDirection: "column", gap: 24, textAlign: "left" }}>
        <h2 style={{ fontFamily: "var(--font-display)", fontSize: 48, lineHeight: 1, letterSpacing: "-0.03em", color: "var(--rv-blue)" }}>
          {t("landing.problem.title")}
        </h2>
        <p style={{ fontFamily: "var(--font-body)", fontSize: 18, lineHeight: "26px", color: "var(--rv-blue)" }}>
          {t("landing.problem.p1")}
          <br />
          <br />
          {t("landing.problem.p2")}
          <br />
          <br />
          {t("landing.problem.p3")}
          <br />
          <br />
          <b>{t("landing.problem.emphasis")}</b>
          <br />
          {t("landing.problem.p4")}
        </p>
      </div>
    </section>
  );
}

export function Process() {
  const { t } = useTranslation();
  const steps = [
    { n: "01", title: t("landing.process.step1.title"), d: t("landing.process.step1.desc") },
    { n: "02", title: t("landing.process.step2.title"), d: t("landing.process.step2.desc") },
    { n: "03", title: t("landing.process.step3.title"), d: t("landing.process.step3.desc") },
    { n: "04", title: t("landing.process.step4.title"), d: t("landing.process.step4.desc") },
  ];
  return (
    <section id="process" className="rv-section olive" style={{ padding: "96px 48px" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 48 }}>
        <h2 style={{ fontFamily: "var(--font-display)", fontSize: 48, lineHeight: 1, letterSpacing: "-0.03em", maxWidth: 600 }}>{t("landing.process.title")}</h2>
        <div className="rv-cols rv-cols-4" style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 24 }}>
          {steps.map((s) => (
            <div key={s.n} style={{ display: "flex", flexDirection: "column", gap: 12, borderTop: "1px solid var(--line-cream)", paddingTop: 16 }}>
              <span style={{ fontFamily: "var(--font-mono-ui)", fontSize: 11, letterSpacing: ".08em", opacity: 0.72 }}>{s.n}</span>
              <span style={{ fontFamily: "var(--font-display)", fontSize: 28, lineHeight: 1, letterSpacing: "-0.02em" }}>{s.title}</span>
              <span style={{ fontFamily: "var(--font-body)", fontSize: 14, lineHeight: "20px", opacity: 0.88 }}>{s.d}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// BrandArc — the Rovno logo's concentric-arc motif as a full-width band.
const RV_ARC_LINES: { d: string; w: number }[] = [
  { d: "M1632 -52L1041 -52A1119 1119 0 0 0 159.2 378.1", w: 1.6 },
  { d: "M1632 85L1041 85A982 982 0 0 0 340.6 378.7", w: 26 },
  { d: "M1632 152L1041 152A915 915 0 0 0 434.7 381.7", w: 1.6 },
  { d: "M1632 222L1041 222A845 845 0 0 0 550.3 379.1", w: 1.6 },
  { d: "M1632 285L1041 285A782 782 0 0 0 667.9 379.8", w: 28 },
  { d: "M1632 332L1041 332A735 735 0 0 0 777.6 380.8", w: 1.6 },
];
const RV_ARC_BLOCKS: [number, number][] = [
  [-4, 77],
  [129, 249],
  [298, 388],
];
type ArcTone = "sage" | "cream" | "blue";
const RV_ARC_TONES: Record<ArcTone, { panel: string; ink: string }> = {
  sage: { panel: "rgba(30,92,203,0.06)", ink: "var(--rv-blue)" },
  cream: { panel: "var(--rv-cream-soft)", ink: "var(--rv-blue)" },
  blue: { panel: "var(--rv-blue)", ink: "var(--rv-cream)" },
};

export function BrandArc({ tone = "sage" }: { tone?: ArcTone }) {
  const { t } = useTranslation();
  const c = RV_ARC_TONES[tone] || RV_ARC_TONES.sage;
  const cid = "rvArcClip-" + tone;
  return (
    <svg viewBox="0 0 1632 382" width="100%" preserveAspectRatio="xMidYMid meet" style={{ display: "block", height: "auto" }} role="img" aria-label={t("landing.brandArc.alt")}>
      <defs>
        <clipPath id={cid}>
          <rect width="1632" height="382" rx="32" />
        </clipPath>
      </defs>
      <rect width="1632" height="382" rx="32" fill={c.panel} />
      <g clipPath={`url(#${cid})`}>
        {RV_ARC_LINES.map((a, i) => (
          <path key={i} d={a.d} fill="none" stroke={c.ink} strokeWidth={a.w} strokeLinejoin="round" />
        ))}
        {RV_ARC_BLOCKS.map(([y0, y1], i) => (
          <rect key={i} x={1511} y={y0} width={153} height={y1 - y0} rx={17} fill={c.ink} />
        ))}
      </g>
    </svg>
  );
}

export function Interlude({ tone = "sage" }: { tone?: ArcTone }) {
  return (
    <section className="rv-section" data-screen-label="Brand Arc" style={{ padding: "104px 48px" }}>
      <div style={{ maxWidth: "var(--content-max)", margin: "0 auto" }}>
        <BrandArc tone={tone} />
      </div>
    </section>
  );
}

// Brand line-art illustrations for the "Кому подходит" section.
const RV_SCENES: Record<string, ReactNode> = {
  apartment: (
    <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 58V26l16-10 16 10v32" />
      <path d="M30 16V8" />
      <rect x="22" y="30" width="7" height="7" />
      <rect x="31" y="30" width="7" height="7" />
      <rect x="22" y="41" width="7" height="7" />
      <rect x="31" y="41" width="7" height="7" />
      <path d="M46 58V34l12 6v18" />
      <path d="M50 44h4M50 50h4" />
      <path d="M8 58h54" />
    </g>
  ),
  office: (
    <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="16" y="12" width="24" height="46" />
      <path d="M22 18h4M30 18h4M22 26h4M30 26h4M22 34h4M30 34h4M22 42h4M30 42h4" />
      <path d="M40 28h12v30H40" />
      <path d="M44 34h4M44 42h4M44 50h4" />
      <path d="M8 58h54" />
    </g>
  ),
  house: (
    <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 58V32l18-13 18 13v26" />
      <path d="M26 58V44h12v14" />
      <path d="M10 32l22-16 22 16" />
      <path d="M50 24v-6h5v10" />
      <path d="M8 58h54" />
      <path d="M48 54c2-3 5-3 7 0" />
    </g>
  ),
  company: (
    <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="10" y="24" width="16" height="34" />
      <rect x="28" y="14" width="16" height="44" />
      <rect x="46" y="30" width="12" height="28" />
      <path d="M15 30h6M15 38h6M15 46h6" />
      <path d="M33 20h6M33 28h6M33 36h6M33 44h6" />
      <path d="M50 36h4M50 44h4" />
      <path d="M8 58h54" />
    </g>
  ),
};

function UseCaseScene({ kind, sceneStyle }: { kind: string; sceneStyle: string }) {
  const solid = sceneStyle === "Заливка";
  return (
    <div
      style={{
        height: 96,
        borderRadius: 8,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: solid ? "var(--rv-cream)" : "rgba(237,235,215,0.08)",
        border: solid ? "none" : "1px solid var(--line-cream)",
        color: solid ? "var(--rv-blue)" : "var(--rv-cream)",
      }}
    >
      <svg viewBox="0 0 70 66" width="84" height="80" style={{ display: "block" }}>
        {RV_SCENES[kind]}
      </svg>
    </div>
  );
}

export function UseCases({ showScenes = true, sceneStyle = "Контур" }: { showScenes?: boolean; sceneStyle?: string }) {
  const { t } = useTranslation();
  const cases = [
    { kind: "apartment", title: t("landing.usecases.apartment.title"), d: t("landing.usecases.apartment.desc") },
    { kind: "office", title: t("landing.usecases.office.title"), d: t("landing.usecases.office.desc") },
    { kind: "house", title: t("landing.usecases.house.title"), d: t("landing.usecases.house.desc") },
    { kind: "company", title: t("landing.usecases.company.title"), d: t("landing.usecases.company.desc") },
  ];
  return (
    <section id="usecases" className="rv-section blue" style={{ padding: "96px 48px" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 48 }}>
        <h2 style={{ fontFamily: "var(--font-display)", fontSize: 48, lineHeight: 1, letterSpacing: "-0.03em" }}>{t("landing.usecases.title")}</h2>
        <div className="rv-cols rv-cols-4" style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 16 }}>
          {cases.map((c) => (
            <div key={c.kind} style={{ border: "1px solid var(--line-cream)", borderRadius: 16, padding: 24, display: "flex", flexDirection: "column", gap: 16, minHeight: 220, justifyContent: "space-between" }}>
              {showScenes ? <UseCaseScene kind={c.kind} sceneStyle={sceneStyle} /> : <div style={{ height: 72, background: "rgba(237,235,215,0.08)", borderRadius: 8 }} />}
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <span style={{ fontFamily: "var(--font-display)", fontSize: 22, lineHeight: 1, letterSpacing: "-0.02em" }}>{c.title}</span>
                <span style={{ fontFamily: "var(--font-body)", fontSize: 13, lineHeight: "18px", opacity: 0.8 }}>{c.d}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

type Plan = {
  code: PlanCode;
  name: string;
  cap: string;
  featured?: boolean;
  badge?: string;
  ai: { label: string; quotas: string[] };
  feat: string[];
  cta: string;
};

// Struck-through "regular" prices are marketing-only display data and mirror
// PricingBlock's ORIGINAL_PRICES_KOPECKS. The live monthly prices come from the
// @/data/plans source of truth (sync-checked against the backend) so they can't
// drift away from billing.
const PRICING_ORIGINAL_KOPECKS: Partial<Record<PlanCode, number>> = {
  master: 169000, // 1 690 ₽
  brigade: 420000, // 4 200 ₽
};

export function Pricing({ startPath }: { startPath: string }) {
  const { t } = useTranslation();
  // Plan names, AI tier labels and quota lines come from the shared `pricing.*`
  // namespace that the in-app pricing block already uses, so the two can't drift
  // apart. `PLANS[code].display_name` stays the fallback: it mirrors backend
  // billing truth, and a missing key must never render a raw key string here.
  const plans: Plan[] = [
    {
      code: "free",
      name: t("pricing.plans.free.name", PLANS.free.display_name),
      cap: t("landing.pricing.free.cap"),
      ai: {
        label: t("pricing.plans.free.ai.title"),
        quotas: [t("pricing.plans.free.ai.chat"), t("pricing.plans.free.ai.doc"), t("pricing.plans.free.ai.photo")],
      },
      feat: [t("landing.pricing.free.feat1"), t("landing.pricing.free.feat2")],
      cta: t("landing.pricing.free.cta"),
    },
    {
      code: "master",
      name: t("pricing.plans.master.name", PLANS.master.display_name),
      cap: t("landing.pricing.master.cap"),
      featured: true,
      badge: t("pricing.recommendedBadge"),
      ai: {
        label: t("pricing.plans.master.ai.title"),
        quotas: [t("pricing.plans.master.ai.chat"), t("pricing.plans.master.ai.doc"), t("pricing.plans.master.ai.photo")],
      },
      feat: [t("landing.pricing.master.feat1"), t("landing.pricing.master.feat2"), t("landing.pricing.master.feat3")],
      cta: t("pricing.cta.continue"),
    },
    {
      code: "brigade",
      name: t("pricing.plans.brigade.name", PLANS.brigade.display_name),
      cap: t("landing.pricing.brigade.cap"),
      ai: {
        label: t("pricing.plans.brigade.ai.title"),
        quotas: [t("pricing.plans.brigade.ai.chat"), t("pricing.plans.brigade.ai.doc"), t("pricing.plans.brigade.ai.photo")],
      },
      feat: [
        t("landing.pricing.brigade.feat1"),
        t("landing.pricing.brigade.feat2"),
        t("landing.pricing.brigade.feat3"),
        t("landing.pricing.brigade.feat4"),
      ],
      cta: t("pricing.cta.continue"),
    },
  ];
  const Check = ({ c }: { c: string }) => (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" style={{ marginTop: 3, flexShrink: 0 }}>
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
  return (
    <section id="pricing" className="rv-section" style={{ padding: "96px 48px 72px" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <h2 style={{ fontFamily: "var(--font-display)", fontSize: 48, lineHeight: 1, letterSpacing: "-0.03em", color: "var(--rv-blue)" }}>{t("landing.pricing.title")}</h2>
        <p style={{ fontFamily: "var(--font-body)", fontSize: 18, lineHeight: "24px", color: "var(--rv-blue)", opacity: 0.72, marginBottom: 32 }}>
          {t("landing.pricing.subtitle")}
        </p>
        <div className="rv-cols rv-cols-3" style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 24, alignItems: "start" }}>
          {plans.map((p) => {
            const fg = p.featured ? "var(--rv-cream)" : "var(--rv-blue)";
            const line = p.featured ? "var(--line-cream)" : "var(--line-blue)";
            const amountKopecks = PLANS[p.code].amount_kopecks;
            const priceLabel = formatRubFromKopecks(amountKopecks);
            const originalKopecks = PRICING_ORIGINAL_KOPECKS[p.code];
            const oldLabel = originalKopecks != null ? formatRubFromKopecks(originalKopecks) : null;
            return (
              <div
                key={p.code}
                style={{
                  padding: 32,
                  borderRadius: 16,
                  background: p.featured ? "var(--rv-blue)" : "transparent",
                  border: p.featured ? "none" : "1px solid var(--line-blue-soft)",
                  color: fg,
                  display: "flex",
                  flexDirection: "column",
                  gap: 24,
                }}
              >
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <span style={{ fontFamily: "var(--font-display)", fontSize: 32, lineHeight: 1, letterSpacing: "-0.02em" }}>{p.name}</span>
                    {p.badge && (
                      <span style={{ fontFamily: "var(--font-mono-ui)", fontSize: 10, letterSpacing: ".06em", textTransform: "uppercase", padding: "4px 8px", borderRadius: 999, background: "var(--rv-cream)", color: "var(--rv-blue)" }}>
                        {p.badge}
                      </span>
                    )}
                  </div>
                  <span style={{ fontFamily: "var(--font-mono-ui)", fontSize: 12, opacity: 0.72 }}>{p.cap}</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 2, minHeight: 62, justifyContent: "flex-end" }}>
                  {oldLabel && <span style={{ fontFamily: "var(--font-body)", fontSize: 15, opacity: 0.5, textDecoration: "line-through" }}>{oldLabel}</span>}
                  <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                    <span style={{ fontFamily: "var(--font-display)", fontSize: 48, lineHeight: 1, letterSpacing: "-0.03em" }}>{priceLabel}</span>
                    {amountKopecks !== 0 && <span style={{ fontFamily: "var(--font-body)", fontSize: 14, opacity: 0.56 }}>{t("landing.pricing.perMonth")}</span>}
                  </div>
                </div>
                <Link
                  className="rv-btn rv-btn--primary"
                  to={startPath}
                  style={{ fontSize: 20, padding: "12px 14px", alignSelf: "stretch", ...(p.featured ? { background: "var(--rv-cream)", color: "var(--rv-blue)" } : {}) }}
                >
                  {p.cta}
                </Link>
                <div style={{ height: 1, background: line, opacity: 0.48 }} />
                <div style={{ display: "flex", flexDirection: "column", gap: 16, flex: 1 }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <span style={{ fontFamily: "var(--font-body)", fontSize: 14, fontWeight: 600, lineHeight: "18px" }}>{p.ai.label}</span>
                    {p.ai.quotas.map((q) => (
                      <span key={q} style={{ fontFamily: "var(--font-body)", fontSize: 13, lineHeight: "18px", opacity: 0.72, paddingLeft: 2 }}>
                        {q}
                      </span>
                    ))}
                  </div>
                  {p.feat.map((f) => (
                    <div key={f} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                      <Check c={fg} />
                      <span style={{ fontFamily: "var(--font-body)", fontSize: 14, lineHeight: "20px" }}>{f}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        <div className="rv-card" style={{ padding: 32, marginTop: 24 }}>
          <span style={{ fontFamily: "var(--font-body)", fontSize: 16, fontWeight: 600, color: "var(--rv-blue)" }}>{t("pricing.allIncluded.title")}</span>
          <div className="rv-cols rv-cols-2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", columnGap: 48, rowGap: 14, marginTop: 20 }}>
            {[
              t("pricing.allIncluded.f1"),
              t("pricing.allIncluded.f2"),
              t("pricing.allIncluded.f3"),
              t("pricing.allIncluded.f4"),
              t("pricing.allIncluded.f5"),
            ].map((f) => (
              <div key={f} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="var(--rv-blue)" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" style={{ marginTop: 3, flexShrink: 0 }}>
                  <path d="M20 6L9 17l-5-5" />
                </svg>
                <span style={{ fontFamily: "var(--font-body)", fontSize: 15, lineHeight: "20px", color: "var(--rv-blue)" }}>{f}</span>
              </div>
            ))}
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "center", marginTop: 24 }}>
          <Link to="/promo/redeem" style={{ fontFamily: "var(--font-body)", fontSize: 15, color: "var(--rv-blue)", textDecoration: "underline", textUnderlineOffset: 3, opacity: 0.8 }}>
            {t("pricing.promoLink")}
          </Link>
        </div>
      </div>
    </section>
  );
}

export function FAQ() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(0);
  const qs = [
    { q: t("landing.faq.q1"), a: t("landing.faq.a1") },
    { q: t("landing.faq.q2"), a: t("landing.faq.a2") },
    { q: t("landing.faq.q3"), a: t("landing.faq.a3") },
    { q: t("landing.faq.q4"), a: t("landing.faq.a4") },
    { q: t("landing.faq.q5"), a: t("landing.faq.a5") },
  ];
  return (
    <section id="faq" className="rv-section orange" style={{ padding: "96px 48px" }}>
      <div className="rv-faq-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr", gap: 48 }}>
        <h2 style={{ fontFamily: "var(--font-display)", fontSize: 48, lineHeight: 1, letterSpacing: "-0.03em" }}>{t("landing.faq.title")}</h2>
        <div style={{ display: "flex", flexDirection: "column" }}>
          {qs.map((it, i) => (
            <div key={i} style={{ borderTop: "1px solid var(--line-cream)", padding: "20px 0" }}>
              <button onClick={() => setOpen(open === i ? -1 : i)} style={{ all: "unset", cursor: "pointer", display: "flex", width: "100%", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontFamily: "var(--font-display)", fontSize: 24, lineHeight: 1.2, letterSpacing: "-0.02em" }}>{it.q}</span>
                <span style={{ fontFamily: "var(--font-display)", fontSize: 28, lineHeight: 1, opacity: 0.8 }}>{open === i ? "–" : "+"}</span>
              </button>
              {open === i && <div style={{ marginTop: 12, fontFamily: "var(--font-body)", fontSize: 15, lineHeight: "22px", opacity: 0.92, maxWidth: 520 }}>{it.a}</div>}
            </div>
          ))}
          <div style={{ borderTop: "1px solid var(--line-cream)" }} />
        </div>
      </div>
    </section>
  );
}

export function FinalCTA({ startPath, onDemo }: LandingCtaProps) {
  const { t } = useTranslation();
  return (
    <section className="rv-section" style={{ padding: "128px 48px", display: "flex", flexDirection: "column", alignItems: "center", gap: 32, textAlign: "center" }}>
      <h2 style={{ fontFamily: "var(--font-display)", fontSize: 64, lineHeight: 1, letterSpacing: "-0.03em", color: "var(--rv-blue)", maxWidth: 800 }}>{t("landing.finalCta.title")}</h2>
      <p style={{ fontFamily: "var(--font-body)", fontSize: 18, lineHeight: "26px", color: "var(--rv-blue)", opacity: 0.8, maxWidth: 520 }}>
        {t("landing.finalCta.subtitle")}
      </p>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", justifyContent: "center" }}>
        <Link className="rv-btn rv-btn--primary" to={startPath}>
          {t("landing.hero.ctaPrimary")}
        </Link>
        <button className="rv-btn rv-btn--secondary" onClick={onDemo}>
          {t("landing.hero.ctaSecondary")}
        </button>
      </div>
    </section>
  );
}

const footerLinkStyle: CSSProperties = { fontFamily: "var(--font-body)", fontSize: 14, color: "var(--rv-cream)", textDecoration: "none", opacity: 0.88 };
const footerColStyle: CSSProperties = { display: "flex", flexDirection: "column", gap: 10 };
const footerHeadStyle: CSSProperties = { fontFamily: "var(--font-mono-ui)", fontSize: 11, letterSpacing: ".08em", opacity: 0.56, color: "var(--rv-cream)" };
const legalLinkStyle: CSSProperties = { fontFamily: "var(--font-body)", fontSize: 13, color: "var(--rv-cream)", textDecoration: "none", opacity: 0.72 };

export function Footer({ onDemo }: { onDemo: () => void }) {
  const { t } = useTranslation();
  const pays = [
    { src: "visa.svg", h: 17 },
    { src: "mastercard.svg", h: 26 },
    { src: "mir.svg", h: 18 },
    { src: "sbp.svg", h: 26 },
    { src: "tpay.svg", h: 21 },
    { src: "sberpay.svg", h: 23 },
    { src: "alfapay.svg", h: 23 },
  ];
  const legal: { key: string; label: string; to: string }[] = [
    { key: "offer", label: t("landing.footer.offer"), to: "/offer" },
    { key: "privacy", label: t("landing.footer.privacy"), to: "/privacy" },
    { key: "refund", label: t("landing.footer.refund"), to: "/refund" },
    { key: "requisites", label: t("landing.footer.requisites"), to: "/contacts" },
    { key: "contacts", label: t("landing.footer.contacts"), to: "/contacts" },
  ];
  return (
    // Translated chrome, same reasoning as the nav above.
    <footer lang={getActiveLanguage()} className="rv-section ink" style={{ padding: "48px", display: "flex", flexDirection: "column", gap: 40, borderTop: "1px solid rgba(237,235,215,0.12)" }}>
      <div className="rv-cols rv-cols-4" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 24 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <span style={{ fontFamily: "var(--font-display)", fontSize: 28, lineHeight: 1, letterSpacing: "-0.02em", color: "var(--rv-cream)" }}>{t("landing.footer.brand")}</span>
          <span style={{ fontFamily: "var(--font-body)", fontSize: 13, opacity: 0.56, color: "var(--rv-cream)", maxWidth: 200, lineHeight: "18px" }}>
            {t("landing.footer.tagline")}
          </span>
          <LanguageSwitcher tone="cream" />
        </div>

        <div style={footerColStyle}>
          <span style={footerHeadStyle}>{t("landing.footer.productHeading")}</span>
          <Link to={{ pathname: "/", hash: "#features" }} style={footerLinkStyle}>{t("landing.nav.features")}</Link>
          <Link to={{ pathname: "/", hash: "#process" }} style={footerLinkStyle}>{t("landing.nav.process")}</Link>
          <Link to={{ pathname: "/", hash: "#pricing" }} style={footerLinkStyle}>{t("landing.nav.pricing")}</Link>
          <Link to="/blog/" style={footerLinkStyle}>{t("landing.nav.blog")}</Link>
          <button type="button" onClick={onDemo} style={{ background: "none", border: 0, padding: 0, margin: 0, cursor: "pointer", textAlign: "left", ...footerLinkStyle }}>{t("landing.footer.demo")}</button>
        </div>

        <div style={footerColStyle}>
          <span style={footerHeadStyle}>{t("landing.footer.audienceHeading")}</span>
          <Link to={{ pathname: "/", hash: "#usecases" }} style={footerLinkStyle}>{t("landing.footer.forClients")}</Link>
          <Link to={{ pathname: "/", hash: "#usecases" }} style={footerLinkStyle}>{t("landing.footer.forContractors")}</Link>
          <Link to={{ pathname: "/", hash: "#usecases" }} style={footerLinkStyle}>{t("landing.footer.forCompanies")}</Link>
        </div>

        <div style={footerColStyle}>
          <span style={footerHeadStyle}>{t("landing.footer.contactsHeading")}</span>
          <a href="mailto:vlad@rovno.ai" style={footerLinkStyle}>vlad@rovno.ai</a>
          <a href="https://t.me/stroyrovno" target="_blank" rel="noreferrer noopener" style={footerLinkStyle}>Telegram</a>
        </div>
      </div>

      <div style={{ height: 1, background: "rgba(237,235,215,0.12)" }} />

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 24, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          {pays.map((p) => (
            <span key={p.src} style={{ height: 40, minWidth: 56, padding: "0 12px", boxSizing: "border-box", background: "#fff", borderRadius: 8, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
              <img src={"/payment-logos/" + p.src} style={{ height: p.h, width: "auto", display: "block" }} alt="" />
            </span>
          ))}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontFamily: "var(--font-body)", fontSize: 13, opacity: 0.64, color: "var(--rv-cream)" }}>{t("landing.footer.paymentsBy")}</span>
          <span style={{ height: 40, minWidth: 56, padding: "0 12px", boxSizing: "border-box", background: "#fff", borderRadius: 8, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
            <img src="/payment-logos/tbank.svg" style={{ height: 20, width: "auto", display: "block" }} alt={t("landing.footer.tbankAlt")} />
          </span>
        </div>
      </div>

      <div style={{ height: 1, background: "rgba(237,235,215,0.12)" }} />

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 24, flexWrap: "wrap" }}>
        <span style={{ fontFamily: "var(--font-mono-ui)", fontSize: 12, opacity: 0.56, color: "var(--rv-cream)" }}>{t("landing.footer.legalLine")}</span>
        <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
          {legal.map((x) => (
            <Link key={x.key} to={x.to} style={legalLinkStyle}>
              {x.label}
            </Link>
          ))}
        </div>
      </div>
    </footer>
  );
}
