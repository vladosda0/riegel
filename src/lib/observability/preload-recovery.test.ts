import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createPreloadErrorHandler,
  reportDeferredRecovery,
} from "@/lib/observability/preload-recovery";
import { captureMessage } from "@/lib/observability/sentry";

vi.mock("@/lib/observability/sentry", () => ({
  captureMessage: vi.fn(),
}));

/** The real prod message (rovno-frontend-prod, 2026-07-27). */
const REAL_MESSAGE = "Unable to preload CSS for /assets/landing-CWgwIWFi.css";

function preloadErrorEvent(payload: unknown): Event {
  const event = new Event("vite:preloadError", { cancelable: true });
  return Object.assign(event, { payload });
}

function handler(reload: () => void, suppressReload = false) {
  return createPreloadErrorHandler({ reload, suppressReload });
}

beforeEach(() => {
  window.sessionStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(captureMessage).mockClear();
});

describe("createPreloadErrorHandler", () => {
  it("reloads on the first preload failure", () => {
    const reload = vi.fn();

    handler(reload)(preloadErrorEvent(new Error(REAL_MESSAGE)));

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("reloads only once per session, so a permanently broken asset cannot loop", () => {
    const reload = vi.fn();
    const onPreloadError = handler(reload);

    onPreloadError(preloadErrorEvent(new Error(REAL_MESSAGE)));
    onPreloadError(preloadErrorEvent(new Error(REAL_MESSAGE)));
    onPreloadError(preloadErrorEvent(new Error(REAL_MESSAGE)));

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("survives a fresh handler instance, because the guard lives in sessionStorage", () => {
    const first = vi.fn();
    const second = vi.fn();

    handler(first)(preloadErrorEvent(new Error(REAL_MESSAGE)));
    handler(second)(preloadErrorEvent(new Error(REAL_MESSAGE)));

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
  });

  it("never prevents the default, so a failed reload still reaches the error boundary", () => {
    const event = preloadErrorEvent(new Error(REAL_MESSAGE));

    handler(vi.fn())(event);

    expect(event.defaultPrevented).toBe(false);
  });

  it("does not reload in dev, so a broken dev server stays inspectable", () => {
    const reload = vi.fn();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    handler(reload, true)(preloadErrorEvent(new Error(REAL_MESSAGE)));

    expect(reload).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(REAL_MESSAGE));
  });

  it("does not reload when sessionStorage is unavailable (no guard, no loop)", () => {
    const reload = vi.fn();
    // Spied on the prototype: jsdom's `sessionStorage` is a Proxy, so an
    // instance-level spy is bypassed by the real accessor.
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("storage denied");
    });

    handler(reload)(preloadErrorEvent(new Error(REAL_MESSAGE)));

    expect(reload).not.toHaveBeenCalled();
  });

  it("still reloads when the payload is not an Error", () => {
    const reload = vi.fn();

    handler(reload)(preloadErrorEvent(undefined));

    expect(reload).toHaveBeenCalledTimes(1);
    reportDeferredRecovery();
    expect(captureMessage).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ extra: expect.objectContaining({ reason: "unknown preload failure" }) }),
    );
  });
});

describe("reportDeferredRecovery", () => {
  it("reports the failure recorded by the previous page load", () => {
    handler(vi.fn())(preloadErrorEvent(new Error(REAL_MESSAGE)));

    reportDeferredRecovery();

    expect(captureMessage).toHaveBeenCalledTimes(1);
    expect(captureMessage).toHaveBeenCalledWith(
      expect.stringContaining("preload failure"),
      expect.objectContaining({
        tags: { source: "preload-recovery" },
        extra: expect.objectContaining({ reason: REAL_MESSAGE, attemptedAt: expect.any(String) }),
      }),
    );
  });

  it("reports each recovery once, not on every subsequent boot", () => {
    handler(vi.fn())(preloadErrorEvent(new Error(REAL_MESSAGE)));

    reportDeferredRecovery();
    reportDeferredRecovery();

    expect(captureMessage).toHaveBeenCalledTimes(1);
  });

  it("stays silent when no recovery happened", () => {
    reportDeferredRecovery();

    expect(captureMessage).not.toHaveBeenCalled();
  });

  it("stays silent on a corrupt record instead of throwing into boot", () => {
    window.sessionStorage.setItem("rovno.preloadRecovery", "{not json");

    expect(() => reportDeferredRecovery()).not.toThrow();
    expect(captureMessage).not.toHaveBeenCalled();
  });

  it("keeps the guard after reporting, so the retry is not silently refunded", () => {
    const reload = vi.fn();
    handler(reload)(preloadErrorEvent(new Error(REAL_MESSAGE)));
    reportDeferredRecovery();

    handler(reload)(preloadErrorEvent(new Error(REAL_MESSAGE)));

    expect(reload).toHaveBeenCalledTimes(1);
  });
});
