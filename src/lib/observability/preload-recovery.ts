import { captureMessage } from "@/lib/observability/sentry";

/**
 * Recovery for Vite's dynamic-import preload failures.
 *
 * Every route is `lazy(() => import(...))`, so Vite wraps it in its preload
 * helper: the helper injects a `<link>` for each dependency of the chunk and
 * rejects with `Unable to preload CSS for <url>` when one of them fires
 * `error`. It dispatches a cancelable `vite:preloadError` first and rethrows if
 * nothing prevents the default — and nothing did, so the rejection reached
 * `React.lazy` and dropped the whole page into RootErrorBoundary. One 16KB
 * stylesheet losing its connection took out the landing page (prod, 2026-07-27).
 *
 * Two causes, both cured by re-requesting the document:
 *   - a transient client-side network loss (mobile operator, DPI, in-app
 *     browser) while the asset itself is served fine — the retry succeeds;
 *   - a stale index.html after a deploy, naming hashes that no longer exist —
 *     the retry fetches the current document.
 *
 * Hence: reload, once, then stop. The retry is capped at ONE per browsing
 * session because a permanently broken asset would otherwise reload in a tight
 * loop forever. On a second failure the error is allowed through to
 * RootErrorBoundary, whose «Обновить страницу» button hands the decision back
 * to the user instead of trapping them in a reload cycle.
 *
 * What does NOT reach this handler: Timeweb's Caddy answers a missing
 * `/assets/*` with the SPA fallback (`200 text/html`, verified against prod),
 * and Chromium fires `load` — not `error` — for a stylesheet served as HTML. So
 * a stale *CSS* hash yields an unstyled page and no event here; a stale *JS*
 * hash does reach us, because a module script with an HTML MIME type is a hard
 * import failure.
 *
 * Timeweb has declined to make that 404 configurable and has no plans to
 * (support, 2026-07-27 — see docs/observability/alert-runbook.md § A4), so the
 * CSS half is covered from here instead, by ./stylesheet-guard.ts. It shares
 * this module's reload budget through `attemptRecoveryReload`: the cap is ONE
 * reload per browsing session across BOTH detectors, so a deploy that breaks a
 * stylesheet and a chunk at once still cannot produce two reloads.
 */

/** sessionStorage key. Its presence is the "retry already spent" guard. */
const SESSION_KEY = "rovno.preloadRecovery";

/**
 * Which detector spent the reload. Only affects the wording of the deferred
 * Sentry message: the two failures have different causes and want to be told
 * apart in the weekly digest, even though they share one budget.
 */
export type RecoveryKind = "preload" | "stylesheet";

interface RecoveryRecord {
  /** Vite's error message, which carries the asset URL that failed. */
  reason: string;
  /** ISO timestamp of the reload attempt. */
  at: string;
  /** True once the deferred Sentry report has gone out. */
  reported: boolean;
  /**
   * Absent on records written before this field existed, and on anything a
   * future version writes that we do not recognise; both read back as
   * "preload", which is the older of the two behaviours.
   */
  kind: RecoveryKind;
}

const RECOVERY_MESSAGES: Record<RecoveryKind, string> = {
  preload: "Recovered from a Vite preload failure by reloading",
  stylesheet: "Recovered from a stylesheet served as non-CSS by reloading",
};

function parseKind(value: unknown): RecoveryKind {
  return value === "stylesheet" ? "stylesheet" : "preload";
}

/** `vite:preloadError` is a plain Event with the rejection hung off `payload`. */
interface VitePreloadErrorEvent extends Event {
  payload?: unknown;
}

function readRecord(): RecoveryRecord | null {
  let raw: string | null;
  try {
    raw = window.sessionStorage.getItem(SESSION_KEY);
  } catch {
    // Storage disabled (private mode, blocked cookies). Treated as "no record"
    // by the reader and as "cannot guard" by the writer, which is what stops
    // the reload loop below.
    return null;
  }
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const { reason, at, reported, kind } = parsed as Record<string, unknown>;
    if (typeof reason !== "string" || typeof at !== "string") return null;
    return { reason, at, reported: reported === true, kind: parseKind(kind) };
  } catch {
    return null;
  }
}

/** Returns false when the record could not be persisted. */
function writeRecord(record: RecoveryRecord): boolean {
  try {
    window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(record));
    return true;
  } catch {
    return false;
  }
}

/**
 * Kept as the whole message rather than a URL parsed out of it: the message is
 * the only place Vite puts the failing asset, and its wording differs between
 * the CSS branch and the module branch.
 */
function describeFailure(payload: unknown): string {
  if (payload instanceof Error && payload.message) return payload.message;
  if (typeof payload === "string" && payload.trim() !== "") return payload;
  return "unknown preload failure";
}

export interface PreloadErrorHandlerOptions {
  /** Injected so tests never hit jsdom's unimplemented navigation. */
  reload: () => void;
  /** True in dev: a broken dev server must stay inspectable, not reload. */
  suppressReload: boolean;
}

/**
 * Spend the session's single reload, or decline.
 *
 * The one place that owns the budget, so every detector competes for the same
 * one reload. Returns true only when a reload was actually triggered, which is
 * what lets a caller fall back to its own honest-failure path.
 */
export function attemptRecoveryReload(
  kind: RecoveryKind,
  reason: string,
  options: PreloadErrorHandlerOptions,
): boolean {
  if (options.suppressReload) {
    console.warn(`[${kind}] ${reason} — automatic reload suppressed in dev`);
    return false;
  }

  // Retry already spent this session: decline.
  if (readRecord()) return false;

  // No storage means no loop guard, and an unguarded reload on a
  // permanently broken asset is worse than the error screen.
  if (!writeRecord({ kind, reason, at: new Date().toISOString(), reported: false })) {
    return false;
  }

  options.reload();
  return true;
}

export function createPreloadErrorHandler(
  options: PreloadErrorHandlerOptions,
): (event: Event) => void {
  return (event: Event) => {
    const reason = describeFailure((event as VitePreloadErrorEvent).payload);

    // Deliberately NO event.preventDefault(). Preventing it would let the
    // helper continue into the module import and render the route with a
    // missing stylesheet; letting it throw means that if the reload does not
    // land we show an honest error screen instead of a silently broken page.

    attemptRecoveryReload("preload", reason, options);
  };
}

/**
 * Reports a reload that already happened. Deliberately deferred to the next
 * load: the Sentry SDK is a lazy chunk, so anything captured in the handler
 * would still be queued when the reload throws the page away.
 */
export function reportDeferredRecovery(): void {
  const record = readRecord();
  if (!record || record.reported) return;

  // Marked before reporting, so a throw inside capture cannot double-report.
  writeRecord({ ...record, reported: true });

  captureMessage(RECOVERY_MESSAGES[record.kind], {
    tags: { source: "preload-recovery", recoveryKind: record.kind },
    extra: { reason: record.reason, attemptedAt: record.at },
  });
}

/** Call once at boot, before the router mounts any lazy route. */
export function installPreloadErrorRecovery(): void {
  if (typeof window === "undefined") return;

  reportDeferredRecovery();

  window.addEventListener(
    "vite:preloadError",
    createPreloadErrorHandler({
      reload: () => window.location.reload(),
      suppressReload: import.meta.env.DEV,
    }) as EventListener,
  );
}
