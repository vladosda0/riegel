// LandingKeyFeatures — "Шесть инструментов — одна среда" section.
// Ported from the Claude Design handoff `ui_kits/website/Features.jsx`.
// Blue panel on cream. Desktop: scroll-pinned horizontal reveal of 6 honest
// feature cards (Variant A). Mobile / prefers-reduced-motion: native swipe
// strip with arrows + dots (Variant B). Tokens come from landing.css.
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

const KF_EMERALD = "oklch(0.60 0.085 158)"; // restrained success tone for "Получено"

// Lets us pass progressive CSS props (e.g. text-wrap) that older csstype
// versions don't expose, without losing type-checking on normal styles.
const sx = (s: Record<string, string | number | undefined>): CSSProperties => s as CSSProperties;

// ---- Iconography (Lucide-language: 2px round strokes, 24 viewbox) ----------
function KFIcon({
  name,
  size = 18,
  stroke = "currentColor",
  sw = 1.8,
  style,
}: {
  name: string;
  size?: number;
  stroke?: string;
  sw?: number;
  style?: CSSProperties;
}) {
  const P: Record<string, ReactNode> = {
    receipt: (
      <>
        <path d="M14 8H8" />
        <path d="M16 12H8" />
        <path d="M13 16H8" />
        <path d="M4 22V4a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v18l-3-2-2 2-2-2-2 2-2-2-3 2Z" />
      </>
    ),
    layers: (
      <>
        <path d="M12 2 2 8l10 6 10-6-10-6Z" />
        <path d="m2 17 10 6 10-6M2 12l10 6 10-6" />
      </>
    ),
    box: (
      <>
        <path d="M11 21.7a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.7l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.7z" />
        <path d="M12 22V12" />
        <path d="m3.3 7 8.7 5 8.7-5" />
        <path d="m7.5 4.3 9 5.1" />
      </>
    ),
    bot: (
      <>
        <path d="M12 8V4H8" />
        <rect width="16" height="12" x="4" y="8" rx="2" />
        <path d="M2 14h2M20 14h2M15 13v2M9 13v2" />
      </>
    ),
    image: (
      <>
        <rect width="18" height="18" x="3" y="3" rx="2" />
        <circle cx="9" cy="9" r="2" />
        <path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21" />
      </>
    ),
    files: (
      <>
        <path d="M20 7h-3a2 2 0 0 1-2-2V2" />
        <path d="M9 18a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h7l4 4v10a2 2 0 0 1-2 2Z" />
        <path d="M3 7.6v12.8A1.6 1.6 0 0 0 4.6 22h9.8" />
      </>
    ),
    send: (
      <>
        <path d="M22 2 11 13" />
        <path d="M22 2 15 22 11 13 2 9z" />
      </>
    ),
    check: <path d="M20 6 9 17l-5-5" />,
    arrowDown: (
      <>
        <path d="M12 5v14" />
        <path d="m5 12 7 7 7-7" />
      </>
    ),
    chevL: <path d="m15 18-6-6 6-6" />,
    chevR: <path d="m9 18 6-6-6-6" />,
  };
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke={stroke}
      strokeWidth={sw}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ display: "block", flexShrink: 0, ...style }}
    >
      {P[name]}
    </svg>
  );
}

// ---- Mini-UI primitives ----------------------------------------------------
function KFRow({ children, highlight, style }: { children: ReactNode; highlight?: boolean; style?: CSSProperties }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "9px 11px",
        borderRadius: 8,
        boxSizing: "border-box",
        background: highlight ? "rgba(30,92,203,0.10)" : "rgba(30,92,203,0.04)",
        border: "1px solid " + (highlight ? "rgba(30,92,203,0.40)" : "rgba(30,92,203,0.12)"),
        color: "var(--rv-blue)",
        fontFamily: "var(--font-mono-ui)",
        fontSize: 12,
        lineHeight: "15px",
        fontWeight: highlight ? 600 : 400,
        ...style,
      }}
    >
      {children}
    </div>
  );
}
const KFLabel = ({ children }: { children: ReactNode }) => (
  <span style={{ flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
    {children}
  </span>
);
const KFNum = ({ children }: { children: ReactNode }) => (
  <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 600, whiteSpace: "nowrap" }}>{children}</span>
);
const KFMeta = ({ children }: { children: ReactNode }) => (
  <span style={{ fontSize: 11, opacity: 0.58, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{children}</span>
);
const KFDot = ({ c }: { c: string }) => (
  <span style={{ width: 7, height: 7, borderRadius: 999, background: c, flexShrink: 0, display: "inline-block" }} />
);
function KFChip({ tone = "muted", children }: { tone?: "muted" | "accent"; children: ReactNode }) {
  const a = tone === "accent";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "5px 9px",
        borderRadius: 999,
        whiteSpace: "nowrap",
        fontFamily: "var(--font-mono-ui)",
        fontSize: 11,
        fontVariantNumeric: "tabular-nums",
        fontWeight: a ? 600 : 500,
        background: a ? "rgba(30,92,203,0.10)" : "transparent",
        border: "1px solid " + (a ? "rgba(30,92,203,0.32)" : "rgba(30,92,203,0.16)"),
        color: a ? "var(--rv-blue)" : "rgba(30,92,203,0.66)",
      }}
    >
      {children}
    </span>
  );
}
function KFBadge({ tone = "muted", children }: { tone?: "muted" | "accent"; children: ReactNode }) {
  const a = tone === "accent";
  return (
    <span
      style={{
        flexShrink: 0,
        padding: "4px 9px",
        borderRadius: 999,
        fontFamily: "var(--font-mono-ui)",
        fontSize: 10.5,
        letterSpacing: ".02em",
        whiteSpace: "nowrap",
        fontWeight: a ? 600 : 500,
        background: a ? "var(--rv-blue)" : "transparent",
        color: a ? "var(--rv-cream)" : "rgba(30,92,203,0.62)",
        border: "1px solid " + (a ? "var(--rv-blue)" : "rgba(30,92,203,0.16)"),
      }}
    >
      {children}
    </span>
  );
}
const KFCheck = ({ on }: { on?: boolean }) => (
  <span
    style={{
      width: 16,
      height: 16,
      borderRadius: 5,
      flexShrink: 0,
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      background: on ? "var(--rv-blue)" : "transparent",
      border: "1.5px solid " + (on ? "var(--rv-blue)" : "rgba(30,92,203,0.40)"),
    }}
  >
    {on && <KFIcon name="check" size={11} stroke="var(--rv-cream)" sw={3} />}
  </span>
);

// ---- The six mini-UIs ------------------------------------------------------
const MiniEstimate = () => {
  const { t } = useTranslation();
  return (
    <>
      <KFRow>
        <KFLabel>{t("landing.features.mini.estimate.tiling")}</KFLabel>
        <KFNum>{t("landing.features.mini.estimate.tilingQty")}</KFNum>
      </KFRow>
      <KFRow>
        <KFLabel>{t("landing.features.mini.estimate.sockets")}</KFLabel>
        <KFNum>{t("landing.features.mini.estimate.socketsQty")}</KFNum>
      </KFRow>
      <KFRow highlight>
        <KFLabel>{t("landing.features.mini.estimate.total")}</KFLabel>
        <KFNum>{t("landing.features.mini.estimate.totalAmount")}</KFNum>
      </KFRow>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 2 }}>
        <KFChip tone="muted">{t("landing.features.mini.estimate.internal")}</KFChip>
        <KFChip tone="accent">{t("landing.features.mini.estimate.client")}</KFChip>
      </div>
    </>
  );
};

const MiniBuilder = () => {
  const { t } = useTranslation();
  const rows: [string, string, boolean][] = [
    [t("landing.features.mini.builder.foundation"), t("landing.features.mini.builder.foundationMeta"), true],
    [t("landing.features.mini.builder.electrical"), t("landing.features.mini.builder.electricalMeta"), true],
    [t("landing.features.mini.builder.roofing"), t("landing.features.mini.builder.roofingMeta"), false],
  ];
  return (
    <>
      {rows.map(([n, c, on]) => (
        <KFRow key={n} style={{ opacity: on ? 1 : 0.6 }}>
          <KFCheck on={on} />
          <KFLabel>{n}</KFLabel>
          <KFMeta>{c}</KFMeta>
        </KFRow>
      ))}
      <div
        style={{
          marginTop: 2,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          background: "var(--rv-blue)",
          color: "var(--rv-cream)",
          borderRadius: 10,
          padding: "9px 12px",
          fontFamily: "var(--font-body)",
          fontSize: 12.5,
          fontWeight: 600,
          lineHeight: 1.2,
          textAlign: "center",
        }}
      >
        <KFIcon name="check" size={14} stroke="var(--rv-cream)" sw={2.4} />
        {t("landing.features.mini.builder.apply")}
      </div>
    </>
  );
};

const MiniProcurement = () => {
  const { t } = useTranslation();
  return (
  <>
    <KFRow>
      <KFLabel>{t("landing.features.mini.procure.order")}</KFLabel>
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          color: "var(--rv-orange)",
          fontWeight: 600,
          whiteSpace: "nowrap",
        }}
      >
        <KFDot c="var(--rv-orange)" />{t("landing.features.mini.procure.inTransit")}
      </span>
    </KFRow>
    <div style={{ borderTop: "1px dashed rgba(30,92,203,0.28)", margin: "3px 0" }} />
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        fontFamily: "var(--font-mono-ui)",
        fontSize: 11,
        color: "var(--rv-blue)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span style={{ opacity: 0.7, whiteSpace: "nowrap" }}>{t("landing.features.mini.procure.budget")}</span>
        <KFNum>{t("landing.features.mini.procure.budgetAmount")}</KFNum>
      </div>
      <div
        style={{
          height: 8,
          borderRadius: 999,
          background: "rgba(30,92,203,0.06)",
          border: "1px solid rgba(30,92,203,0.12)",
          overflow: "hidden",
          display: "flex",
        }}
      >
        <span style={{ width: "59.7%", background: KF_EMERALD }} />
        <span style={{ width: "40.3%", background: "rgba(30,92,203,0.55)" }} />
      </div>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, opacity: 0.78, whiteSpace: "nowrap" }}>
          <KFDot c={KF_EMERALD} />{t("landing.features.mini.procure.received")}{" "}
          <b style={{ fontWeight: 600 }}>{t("landing.features.mini.procure.receivedAmount")}</b>
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontWeight: 600, whiteSpace: "nowrap" }}>
          <KFDot c="var(--rv-blue)" />{t("landing.features.mini.procure.remaining")}
        </span>
      </div>
    </div>
  </>
  );
};

const MiniChat = () => {
  const { t } = useTranslation();
  return (
  <>
    <div style={{ display: "flex", justifyContent: "flex-end" }}>
      <span
        style={{
          maxWidth: "82%",
          background: "rgba(30,92,203,0.10)",
          border: "1px solid rgba(30,92,203,0.18)",
          color: "var(--rv-blue)",
          borderRadius: "12px 12px 4px 12px",
          padding: "8px 11px",
          fontFamily: "var(--font-mono-ui)",
          fontSize: 12,
          lineHeight: "16px",
        }}
      >
        {t("landing.features.mini.chat.question")}
      </span>
    </div>
    <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
      <span
        style={{
          width: 26,
          height: 26,
          borderRadius: 8,
          flexShrink: 0,
          background: "rgba(30,92,203,0.10)",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <KFIcon name="bot" size={15} stroke="var(--rv-blue)" sw={1.9} />
      </span>
      <span
        style={{
          background: "rgba(30,92,203,0.04)",
          border: "1px solid rgba(30,92,203,0.12)",
          color: "var(--rv-blue)",
          borderRadius: "12px 12px 12px 4px",
          padding: "9px 11px",
          fontFamily: "var(--font-mono-ui)",
          fontSize: 12,
          lineHeight: "17px",
        }}
      >
        {t("landing.features.mini.chat.answerBefore")}{" "}
        <b style={{ fontWeight: 600 }}>{t("landing.features.mini.chat.answerAmount")}</b>{" "}
        {t("landing.features.mini.chat.answerAfter")}
      </span>
    </div>
    <div
      style={{
        marginTop: 2,
        display: "flex",
        alignItems: "center",
        gap: 8,
        border: "1px solid rgba(30,92,203,0.16)",
        borderRadius: 999,
        padding: "6px 6px 6px 13px",
      }}
    >
      <span style={{ flex: 1, fontFamily: "var(--font-mono-ui)", fontSize: 12, color: "rgba(30,92,203,0.5)" }}>
        {t("landing.features.mini.chat.placeholder")}
      </span>
      <span
        style={{
          width: 28,
          height: 28,
          borderRadius: 999,
          flexShrink: 0,
          background: "var(--rv-blue)",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <KFIcon name="send" size={14} stroke="var(--rv-cream)" sw={2} />
      </span>
    </div>
  </>
  );
};

const MiniPhoto = () => {
  const { t } = useTranslation();
  return (
  <>
    <div style={{ display: "flex", gap: 11, alignItems: "center" }}>
      <span
        style={{
          width: 58,
          height: 46,
          borderRadius: 8,
          flexShrink: 0,
          background: "repeating-linear-gradient(135deg, rgba(30,92,203,0.11) 0 6px, rgba(30,92,203,0.04) 6px 12px)",
          border: "1px solid rgba(30,92,203,0.16)",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <KFIcon name="image" size={18} stroke="rgba(30,92,203,0.55)" sw={1.8} />
      </span>
      <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
        <span style={{ fontFamily: "var(--font-body)", fontSize: 13, fontWeight: 600, color: "var(--rv-blue)" }}>
          {t("landing.features.mini.photo.caption")}
        </span>
        <span style={{ fontFamily: "var(--font-mono-ui)", fontSize: 11, opacity: 0.56, color: "var(--rv-blue)" }}>
          {t("landing.features.mini.photo.source")}
        </span>
      </div>
    </div>
    <div style={{ borderTop: "1px dashed rgba(30,92,203,0.28)", margin: "3px 0" }} />
    <div
      style={{
        display: "flex",
        gap: 8,
        alignItems: "flex-start",
        background: "rgba(30,92,203,0.07)",
        border: "1px solid rgba(30,92,203,0.22)",
        borderRadius: 8,
        padding: "9px 11px",
      }}
    >
      <KFIcon name="bot" size={15} stroke="var(--rv-blue)" sw={1.9} style={{ marginTop: 1 }} />
      <span style={{ fontFamily: "var(--font-mono-ui)", fontSize: 11.5, lineHeight: "16px", color: "var(--rv-blue)" }}>
        <b style={{ fontWeight: 600 }}>{t("landing.features.mini.photo.analysisLabel")}</b>{" "}
        {t("landing.features.mini.photo.analysisText")}
      </span>
    </div>
  </>
  );
};

const MiniDocs = () => {
  const { t } = useTranslation();
  const internal = t("landing.features.mini.docs.internal");
  const docs: [string, string, "muted" | "accent"][] = [
    [t("landing.features.mini.docs.windows"), internal, "muted"],
    [t("landing.features.mini.docs.plan"), t("landing.features.mini.docs.shared"), "accent"],
    [t("landing.features.mini.docs.act"), internal, "muted"],
  ];
  return (
    <>
      {docs.map(([n, b, tone]) => (
        <KFRow key={n}>
          <KFIcon name="files" size={15} stroke="rgba(30,92,203,0.7)" sw={1.7} />
          <KFLabel>{n}</KFLabel>
          <KFBadge tone={tone}>{b}</KFBadge>
        </KFRow>
      ))}
    </>
  );
};

// Copy lives in the locale files; the card only carries the key, so this stays a
// module-level constant (no hook) while still re-rendering on a language switch.
type KFFeature = { id: string; icon: string; mini: ReactNode };
const KF_FEATURES: KFFeature[] = [
  { id: "estimate", icon: "receipt", mini: <MiniEstimate /> },
  { id: "builder", icon: "layers", mini: <MiniBuilder /> },
  { id: "procure", icon: "box", mini: <MiniProcurement /> },
  { id: "chat", icon: "bot", mini: <MiniChat /> },
  { id: "photo", icon: "image", mini: <MiniPhoto /> },
  { id: "docs", icon: "files", mini: <MiniDocs /> },
];

const KFPill = ({ icon, children }: { icon: string; children: ReactNode }) => (
  <div
    style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 7,
      alignSelf: "flex-start",
      padding: "6px 12px 6px 9px",
      borderRadius: 999,
      background: "rgba(30,92,203,0.08)",
      color: "var(--rv-blue)",
      fontFamily: "var(--font-body)",
      fontSize: 13,
      fontWeight: 600,
      lineHeight: 1,
    }}
  >
    <KFIcon name={icon} size={15} stroke="var(--rv-blue)" sw={1.9} />
    {children}
  </div>
);

// ===========================================================================
export function KeyFeatures() {
  const { t } = useTranslation();
  const [pinned, setPinned] = useState(true);
  const [idx, setIdx] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const fillRef = useRef<HTMLDivElement>(null);
  const cardsRef = useRef<(HTMLDivElement | null)[]>([]);
  const ovRef = useRef(0);
  const [pinH, setPinH] = useState("180vh");

  // Mode: pin on desktop with motion; swipe on mobile / reduced-motion.
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const decide = () => setPinned(!(mq.matches || window.innerWidth < 900));
    decide();
    mq.addEventListener?.("change", decide);
    window.addEventListener("resize", decide);
    return () => {
      mq.removeEventListener?.("change", decide);
      window.removeEventListener("resize", decide);
    };
  }, []);

  // Variant A — scroll-pinned horizontal reveal.
  useEffect(() => {
    if (!pinned) return;
    let raf = 0;
    const update = () => {
      const wrap = wrapRef.current,
        track = trackRef.current,
        view = viewRef.current;
      if (!wrap || !track || !view) return;
      const ov = ovRef.current;
      const total = wrap.offsetHeight - window.innerHeight;
      const top = wrap.getBoundingClientRect().top;
      const p = total > 0 ? Math.min(1, Math.max(0, -top / total)) : 0;
      const x = -p * ov;
      track.style.transform = `translate3d(${x}px,0,0)`;
      if (fillRef.current) fillRef.current.style.transform = `scaleX(${Math.max(0.05, p)})`;
      const vw = view.clientWidth,
        vl = view.getBoundingClientRect().left;
      cardsRef.current.forEach((el) => {
        if (!el) return;
        const r = el.getBoundingClientRect();
        const k = Math.min(1, Math.max(0, (vw - (r.left - vl)) / r.width));
        el.style.opacity = (0.3 + 0.7 * k).toFixed(3);
        el.style.transform = `translateY(${((1 - k) * 20).toFixed(1)}px)`;
      });
    };
    const measure = () => {
      const view = viewRef.current,
        track = trackRef.current;
      if (!view || !track) return;
      ovRef.current = Math.max(0, Math.min(track.scrollWidth - view.clientWidth, KF_FEATURES.length * 480));
      setPinH(window.innerHeight + Math.ceil(ovRef.current / window.innerHeight) * window.innerHeight + "px");
      update();
    };
    const onScroll = () => {
      if (!raf)
        raf = requestAnimationFrame(() => {
          raf = 0;
          update();
        });
    };
    measure();
    const t1 = setTimeout(measure, 80),
      t2 = setTimeout(measure, 360);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", measure);
      clearTimeout(t1);
      clearTimeout(t2);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [pinned]);

  // Variant B — track active dot + pointer drag.
  useEffect(() => {
    if (pinned) return;
    const v = viewRef.current;
    if (!v) return;
    const step = () => ((v.firstChild as HTMLElement | null)?.offsetWidth ?? 300) + 16;
    const onScroll = () => setIdx(Math.round(v.scrollLeft / step()));
    let down = false,
      sx0 = 0,
      sl = 0;
    const dn = (e: PointerEvent) => {
      down = true;
      sx0 = e.clientX;
      sl = v.scrollLeft;
    };
    const mv = (e: PointerEvent) => {
      if (down) v.scrollLeft = sl - (e.clientX - sx0);
    };
    const up = () => {
      down = false;
    };
    v.addEventListener("scroll", onScroll, { passive: true });
    v.addEventListener("pointerdown", dn);
    v.addEventListener("pointermove", mv);
    window.addEventListener("pointerup", up);
    return () => {
      v.removeEventListener("scroll", onScroll);
      v.removeEventListener("pointerdown", dn);
      v.removeEventListener("pointermove", mv);
      window.removeEventListener("pointerup", up);
    };
  }, [pinned]);

  const scrollBy = (dir: number) => {
    const v = viewRef.current;
    if (!v) return;
    const w = ((v.firstChild as HTMLElement | null)?.offsetWidth ?? 300) + 16;
    v.scrollBy({ left: dir * w, behavior: "smooth" });
  };

  const heading = (
    <h2
      style={sx({
        fontFamily: "var(--font-display)",
        fontSize: 44,
        lineHeight: 1.02,
        letterSpacing: "-0.02em",
        color: "var(--rv-cream)",
        margin: 0,
        textWrap: "balance",
      })}
    >
      {t("landing.features.title")}
    </h2>
  );
  const sub = (
    <p
      style={{
        fontFamily: "var(--font-body)",
        fontSize: 16,
        lineHeight: "23px",
        color: "rgba(237,235,215,0.74)",
        margin: 0,
        maxWidth: 360,
      }}
    >
      {t("landing.features.subtitle")}
    </p>
  );

  const renderCard = (f: KFFeature, i: number) => {
    const inner = (
      <>
        <KFPill icon={f.icon}>{t(`landing.features.${f.id}.pill`)}</KFPill>
        <div style={{ display: "flex", flexDirection: "column", gap: 9, minHeight: 0 }}>{f.mini}</div>
        <p
          style={sx({
            fontFamily: "var(--font-body)",
            fontSize: 13,
            lineHeight: "18px",
            color: "rgba(30,92,203,0.64)",
            margin: "auto 0 0",
            paddingTop: 12,
            textWrap: "pretty",
            flexShrink: 0,
          })}
        >
          {t(`landing.features.${f.id}.note`)}
        </p>
      </>
    );
    const base: CSSProperties = {
      background: "var(--rv-white)",
      borderRadius: "var(--r-lg)",
      border: "1px solid rgba(30,92,203,0.10)",
      boxShadow: "var(--shadow-2)",
      boxSizing: "border-box",
      padding: "24px 22px 22px",
      display: "flex",
      flexDirection: "column",
      gap: 16,
    };
    if (pinned) {
      return (
        <div
          key={f.id}
          ref={(el) => {
            cardsRef.current[i] = el;
          }}
          style={{ ...base, flex: "0 0 320px", width: 320, opacity: 0.3, transform: "translateY(20px)", willChange: "opacity, transform" }}
        >
          {inner}
        </div>
      );
    }
    return (
      <div key={f.id} style={{ ...base, flex: "0 0 84%", maxWidth: 380, scrollSnapAlign: "start" }}>
        {inner}
      </div>
    );
  };

  if (pinned) {
    return (
      <section id="features" className="rv-section" data-screen-label="Возможности" style={{ background: "var(--rv-blue)", padding: 0 }}>
        <div ref={wrapRef} style={{ position: "relative", height: pinH }}>
          <div
            style={{
              position: "sticky",
              top: 0,
              height: "100vh",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
              padding: "92px 48px 48px",
              boxSizing: "border-box",
            }}
          >
            <div style={{ display: "flex", justifyContent: "flex-start", marginBottom: 48 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 18, textAlign: "left", maxWidth: 360 }}>
                {heading}
                {sub}
              </div>
            </div>
            <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "flex-end", minHeight: 0 }}>
              <div ref={viewRef} style={{ display: "flex", alignItems: "center", minHeight: 0, overflow: "hidden", marginBottom: 24 }}>
                <div ref={trackRef} style={{ display: "flex", gap: 20, paddingRight: 4, willChange: "transform" }}>
                  {KF_FEATURES.map(renderCard)}
                </div>
              </div>
              <div style={{ height: 3, borderRadius: 999, background: "rgba(237,235,215,0.16)", overflow: "hidden" }}>
                <div
                  ref={fillRef}
                  style={{ height: "100%", background: "var(--rv-cream)", opacity: 0.85, transformOrigin: "left", transform: "scaleX(0.05)" }}
                />
              </div>
            </div>
          </div>
        </div>
      </section>
    );
  }

  // Variant B — swipe strip
  return (
    <section id="features" className="rv-section" data-screen-label="Возможности" style={{ background: "var(--rv-blue)", padding: 0 }}>
      <div className="rv-kf-pad" style={{ padding: "60px 48px", display: "flex", flexDirection: "column", gap: 32 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 400 }}>
          {heading}
          {sub}
        </div>
        <div>
          <div
            ref={viewRef}
            style={sx({
              display: "flex",
              gap: 16,
              overflowX: "auto",
              scrollSnapType: "x mandatory",
              WebkitOverflowScrolling: "touch",
              padding: 0,
              cursor: "grab",
              scrollbarWidth: "none",
            })}
          >
            {KF_FEATURES.map(renderCard)}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
          <div style={{ display: "flex", gap: 7 }}>
            {KF_FEATURES.map((f, i) => (
              <span
                key={f.id}
                style={{
                  width: i === idx ? 20 : 7,
                  height: 7,
                  borderRadius: 999,
                  background: i === idx ? "var(--rv-cream)" : "rgba(237,235,215,0.34)",
                  transition: "width .2s, background .2s",
                }}
              />
            ))}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {([["chevL", -1], ["chevR", 1]] as const).map(([ic, d]) => (
              <button
                key={ic}
                onClick={() => scrollBy(d)}
                aria-label={d < 0 ? t("landing.features.prev") : t("landing.features.next")}
                style={{
                  all: "unset",
                  cursor: "pointer",
                  width: 40,
                  height: 40,
                  borderRadius: 999,
                  border: "1px solid rgba(237,235,215,0.4)",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  boxSizing: "border-box",
                }}
              >
                <KFIcon name={ic} size={18} stroke="var(--rv-cream)" sw={2} />
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
