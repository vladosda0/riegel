import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { analyticsPageUrl, ensureMetrikaStarted, METRIKA_COUNTER_ID } from "@/lib/analytics";

/**
 * Fires a Yandex Metrika SPA pageview hit on every react-router navigation.
 *
 * The initial pageview is normally sent by the `ym(..., 'init', ...)` call in
 * `initMetrika()` (src/lib/analytics.ts, run from main.tsx), so we deliberately
 * skip the first effect run to avoid double-counting the landing URL. On an
 * auth landing that init is deferred until the credential leaves the address
 * bar, so the skipped first hit may have no counterpart; `ensureMetrikaStarted()`
 * below is what starts the tag when the deferral timed out.
 *
 * Place inside <BrowserRouter> but outside <Routes>, so it stays mounted
 * across route changes. No-ops when no Metrika counter is configured.
 */
export function MetrikaPageviewTracker(): null {
  const location = useLocation();
  const isFirstHit = useRef(true);

  useEffect(() => {
    ensureMetrikaStarted();

    if (isFirstHit.current) {
      isFirstHit.current = false;
      return;
    }

    if (METRIKA_COUNTER_ID === null) return;
    if (typeof window === "undefined" || typeof window.ym !== "function") return;

    window.ym(METRIKA_COUNTER_ID, "hit", analyticsPageUrl(), {
      referer: document.referrer,
      title: document.title,
    });
  }, [location.pathname, location.search]);

  return null;
}
