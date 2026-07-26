import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { METRIKA_COUNTER_ID, hrefWithoutFragment } from "@/lib/analytics";

/**
 * Fires a Yandex Metrika SPA pageview hit on every react-router navigation.
 *
 * The initial pageview is sent automatically by the `ym(..., 'init', ...)`
 * call in `initMetrika()` (src/lib/analytics.ts, run from main.tsx), so we
 * deliberately skip the first effect run to avoid double-counting the landing
 * URL.
 *
 * Place inside <BrowserRouter> but outside <Routes>, so it stays mounted
 * across route changes. No-ops when no Metrika counter is configured.
 */
export function MetrikaPageviewTracker(): null {
  const location = useLocation();
  const isFirstHit = useRef(true);

  useEffect(() => {
    if (isFirstHit.current) {
      isFirstHit.current = false;
      return;
    }

    if (METRIKA_COUNTER_ID === null) return;
    if (typeof window === "undefined" || typeof window.ym !== "function") return;

    // Fragment stripped: the auth callback carries access/refresh tokens
    // there, and a fragment is never meaningful to analytics anyway.
    window.ym(METRIKA_COUNTER_ID, "hit", hrefWithoutFragment(), {
      referer: document.referrer,
      title: document.title,
    });
  }, [location.pathname, location.search]);

  return null;
}
