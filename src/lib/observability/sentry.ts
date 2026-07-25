/**
 * Error-tracking façade (Sentry) — the ONLY module the app imports for error
 * reporting. The real `@sentry/react` SDK is loaded lazily via dynamic import
 * so it never blocks first render and never lands in the entry chunk; until
 * it arrives, captures are queued and unhandled errors are buffered by two
 * tiny window handlers installed synchronously from `initErrorTracking()`.
 *
 * Fully disabled (zero network, zero SDK bytes requested) when
 * `VITE_SENTRY_DSN` is empty or unset — mirrors how Metrika is gated in
 * src/lib/analytics.ts. Fail-open by design: any failure inside this module
 * must never break the app for the user.
 */

import { scrubEventSafe } from "./scrub";

type SentryLib = typeof import("@sentry/react");

/** Injected by vite.config.ts `define` (git SHA at build time). */
declare const __APP_RELEASE__: string;

export const SENTRY_DSN: string | null = (() => {
  const raw = import.meta.env.VITE_SENTRY_DSN;
  if (raw === undefined || raw === null) return null;
  const trimmed = `${raw}`.trim();
  return trimmed === "" ? null : trimmed;
})();

/** Same source + default as EnvBanner: unset behaves like production. */
const ENVIRONMENT: string = `${import.meta.env.VITE_APP_ENV ?? "production"}`;

const RELEASE: string = typeof __APP_RELEASE__ !== "undefined" ? __APP_RELEASE__ : "unknown";

export interface CaptureContext {
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
}

type Command = (lib: SentryLib) => void;

const MAX_QUEUED_COMMANDS = 100;
const MAX_BUFFERED_ERRORS = 20;

let sentry: SentryLib | null = null;
let initStarted = false;
let commandQueue: Command[] = [];

const earlyErrorBuffer: unknown[] = [];
let onEarlyError: ((event: ErrorEvent) => void) | null = null;
let onEarlyRejection: ((event: PromiseRejectionEvent) => void) | null = null;

function enqueue(command: Command): void {
  if (sentry) {
    try {
      command(sentry);
    } catch {
      // Fail-open: reporting must never throw into app code.
    }
    return;
  }
  if (commandQueue.length < MAX_QUEUED_COMMANDS) commandQueue.push(command);
}

function installEarlyHandlers(): void {
  onEarlyError = (event: ErrorEvent) => {
    if (earlyErrorBuffer.length < MAX_BUFFERED_ERRORS) {
      earlyErrorBuffer.push(event.error ?? event.message);
    }
  };
  onEarlyRejection = (event: PromiseRejectionEvent) => {
    if (earlyErrorBuffer.length < MAX_BUFFERED_ERRORS) {
      earlyErrorBuffer.push(event.reason);
    }
  };
  window.addEventListener("error", onEarlyError);
  window.addEventListener("unhandledrejection", onEarlyRejection);
}

function removeEarlyHandlers(): void {
  if (onEarlyError) window.removeEventListener("error", onEarlyError);
  if (onEarlyRejection) window.removeEventListener("unhandledrejection", onEarlyRejection);
  onEarlyError = null;
  onEarlyRejection = null;
}

/**
 * Message patterns produced by scripts we do not ship.
 *
 * `window.webkit.messageHandlers` is the WKWebView native bridge. In-app
 * browsers (Threads, VK, Telegram) inject their own shim that calls it on
 * `pagehide` without checking it exists. Verified against a real production
 * event: iPhone / "Mobile Safari UI/WKWebView", frames `sendPageHideMessage`
 * → `sendDataToNative`. Those frames are injected INLINE into the document,
 * so they report our own origin — `denyUrls` cannot catch them and matching
 * the message is the only reliable handle.
 */
const THIRD_PARTY_MESSAGE_PATTERNS: readonly RegExp[] = [/webkit\.messageHandlers/i];

/** Stack frames served from these origins are never our bundle. */
const THIRD_PARTY_FRAME_PREFIXES: readonly string[] = [
  "chrome-extension://",
  "moz-extension://",
  "safari-extension://",
  "safari-web-extension://",
];

interface SentryFrameLike {
  filename?: unknown;
}
interface SentryExceptionLike {
  value?: unknown;
  stacktrace?: { frames?: unknown };
}

function matchesNoisePattern(text: unknown): boolean {
  return typeof text === "string" && THIRD_PARTY_MESSAGE_PATTERNS.some((re) => re.test(text));
}

/**
 * True when an event comes from an injected third-party script rather than
 * from our code. Such events are unactionable: we cannot fix a bridge shim
 * that a social app's in-app browser installs, and they crowd out real
 * regressions plus burn the GlitchTip quota.
 *
 * Applied in `beforeSend` rather than `ignoreErrors` so it is one testable
 * pure function covering every path into the SDK, including the early-buffer
 * replay in `initErrorTracking`.
 */
export function isThirdPartyNoise(event: Record<string, unknown>): boolean {
  try {
    if (matchesNoisePattern(event.message)) return true;

    const values = (event.exception as { values?: unknown } | undefined)?.values;
    if (!Array.isArray(values)) return false;

    return values.some((raw) => {
      const value = raw as SentryExceptionLike;
      if (matchesNoisePattern(value?.value)) return true;

      const frames = value?.stacktrace?.frames;
      if (!Array.isArray(frames)) return false;

      // ONLY the frame the error was actually thrown from decides — Sentry
      // orders frames oldest-first, so that is the last one carrying a
      // filename, which is also what Sentry's own denyUrls matches. Checking
      // "any frame" would be strictly broader and would silently discard a
      // real regression in our bundle whose stack merely passes THROUGH an
      // extension: password managers, translators and ad blockers routinely
      // wrap addEventListener/fetch and leave an extension frame behind.
      for (let i = frames.length - 1; i >= 0; i--) {
        const filename = (frames[i] as SentryFrameLike)?.filename;
        if (typeof filename !== "string" || filename === "") continue;
        return THIRD_PARTY_FRAME_PREFIXES.some((prefix) => filename.startsWith(prefix));
      }
      return false;
    });
  } catch {
    // Never let the filter itself drop or break a real report.
    return false;
  }
}

/**
 * Kick off error tracking. Called once from main.tsx BEFORE render; returns
 * immediately (the SDK chunk downloads in parallel with the app rendering).
 * No-op without a DSN.
 */
export function initErrorTracking(): void {
  if (!SENTRY_DSN) return;
  if (typeof window === "undefined") return;
  if (initStarted) return;
  initStarted = true;

  // Catch errors thrown before the SDK chunk arrives; replayed after init.
  installEarlyHandlers();

  void import("@sentry/react")
    .then((lib) => {
      lib.init({
        dsn: SENTRY_DSN,
        environment: ENVIRONMENT,
        release: RELEASE,
        // Errors only for v1 — no tracing, no replay (cost + 152-ФЗ).
        sendDefaultPii: false,
        // PostgREST / edge-function error messages carry useful detail past
        // Sentry's 250-char default.
        maxValueLength: 1000,
        beforeSend: (event) => {
          const raw = event as unknown as Record<string, unknown>;
          if (isThirdPartyNoise(raw)) return null;
          return scrubEventSafe(raw) as typeof event | null;
        },
        ignoreErrors: [
          // Benign browser noise, standard Sentry hygiene.
          "ResizeObserver loop limit exceeded",
          "ResizeObserver loop completed with undelivered notifications",
        ],
      });
      lib.setTag("app", "rovno-frontend");
      sentry = lib;

      // Same synchronous block: replay buffered early errors, then hand
      // global handling over to the SDK's own hooks (installed by init).
      removeEarlyHandlers();
      for (const buffered of earlyErrorBuffer.splice(0)) {
        try {
          lib.captureException(buffered);
        } catch {
          // Fail-open.
        }
      }
      const queued = commandQueue;
      commandQueue = [];
      for (const command of queued) {
        try {
          command(lib);
        } catch {
          // Fail-open.
        }
      }
    })
    .catch(() => {
      // SDK chunk failed to load (offline, adblock). Product keeps working.
      removeEarlyHandlers();
      earlyErrorBuffer.length = 0;
      commandQueue = [];
    });
}

/** Tag every subsequent event with the (pseudonymous) user id, or clear it. */
export function setSentryUser(userId: string | null): void {
  if (!SENTRY_DSN) return;
  enqueue((lib) => lib.setUser(userId ? { id: userId } : null));
}

/** Report a handled exception. Safe to call any time, even before init. */
export function captureException(error: unknown, context?: CaptureContext): void {
  if (!SENTRY_DSN) {
    if (import.meta.env.DEV) {
      // Local visibility so instrumented paths are debuggable without a DSN.
      console.warn("[observability] captureException (reporting disabled):", error, context);
    }
    return;
  }
  enqueue((lib) => lib.captureException(error, { tags: context?.tags, extra: context?.extra }));
}

/** Report a message-level event (no exception object). */
export function captureMessage(message: string, context?: CaptureContext): void {
  if (!SENTRY_DSN) {
    if (import.meta.env.DEV) {
      console.warn("[observability] captureMessage (reporting disabled):", message, context);
    }
    return;
  }
  enqueue((lib) =>
    lib.captureMessage(message, {
      level: "error",
      tags: context?.tags,
      extra: context?.extra,
    }),
  );
}
