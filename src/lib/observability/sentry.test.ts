import { describe, expect, it } from "vitest";

import { isThirdPartyNoise } from "@/lib/observability/sentry";

/**
 * Shape copied from the real production event (GlitchTip issue 7,
 * rovno-frontend-prod, 2026-07-24): iPhone in a "Mobile Safari UI/WKWebView"
 * in-app browser. Note the frames carry OUR origin — the shim is injected
 * inline into the document — which is exactly why denyUrls cannot catch it.
 */
const inAppBrowserBridgeEvent = {
  exception: {
    values: [
      {
        type: "TypeError",
        value: "undefined is not an object (evaluating 'window.webkit.messageHandlers')",
        stacktrace: {
          frames: [
            { filename: "https://rovno.ai/", function: "sendDataToNative", lineno: 1, colno: 1142 },
            {
              filename: "https://rovno.ai/",
              function: "sendPageHideMessage",
              lineno: 1,
              colno: 3712,
            },
          ],
        },
      },
    ],
  },
};

const realAppError = {
  exception: {
    values: [
      {
        type: "TypeError",
        value: "Cannot read properties of undefined (reading 'estimateId')",
        stacktrace: {
          frames: [
            { filename: "https://rovno.ai/assets/index-abc123.js", function: "useEstimate" },
          ],
        },
      },
    ],
  },
};

describe("isThirdPartyNoise", () => {
  it("drops the in-app browser bridge error seen in production", () => {
    expect(isThirdPartyNoise(inAppBrowserBridgeEvent)).toBe(true);
  });

  it("keeps a genuine application error", () => {
    expect(isThirdPartyNoise(realAppError)).toBe(false);
  });

  it("drops anything thrown from a browser extension frame", () => {
    for (const origin of [
      "chrome-extension://abcdef/inject.js",
      "moz-extension://abcdef/inject.js",
      "safari-web-extension://abcdef/inject.js",
      "safari-extension://abcdef/inject.js",
    ]) {
      const event = {
        exception: {
          values: [
            {
              value: "Something exploded",
              stacktrace: { frames: [{ filename: origin }] },
            },
          ],
        },
      };
      expect(isThirdPartyNoise(event)).toBe(true);
    }
  });

  /**
   * The case that separates "any frame" from Sentry's own denyUrls semantics.
   * Password managers, translators and ad blockers wrap addEventListener and
   * fetch, so a genuine regression in our bundle routinely carries one
   * extension frame lower in the stack. Dropping it would defeat the entire
   * point of the module.
   */
  it("keeps our own error when the stack merely passes through an extension", () => {
    const event = {
      exception: {
        values: [
          {
            value: "Cannot read properties of undefined (reading 'total')",
            stacktrace: {
              frames: [
                { filename: "chrome-extension://abcdef/inject.js", function: "wrappedListener" },
                { filename: "https://rovno.ai/assets/index-abc.js", function: "useEstimateTotals" },
              ],
            },
          },
        ],
      },
    };

    expect(isThirdPartyNoise(event)).toBe(false);
  });

  it("still drops an error thrown from an extension below our frames", () => {
    const event = {
      exception: {
        values: [
          {
            value: "Something exploded",
            stacktrace: {
              frames: [
                { filename: "https://rovno.ai/assets/index-abc.js", function: "boot" },
                { filename: "chrome-extension://abcdef/inject.js", function: "thrower" },
              ],
            },
          },
        ],
      },
    };

    expect(isThirdPartyNoise(event)).toBe(true);
  });

  it("ignores frames without a usable filename when deciding", () => {
    const event = {
      exception: {
        values: [
          {
            value: "Something exploded",
            stacktrace: {
              frames: [
                { filename: "chrome-extension://abcdef/inject.js" },
                { filename: "" },
                { function: "anonymous" },
              ],
            },
          },
        ],
      },
    };

    expect(isThirdPartyNoise(event)).toBe(true);
  });

  /**
   * `linkedErrorsIntegration` is a default browser integration, so
   * `new Error(msg, { cause })` — used across estimate-v2-hero-transition —
   * arrives as several exception.values. Only the ROOT one (no
   * mechanism.parent_id) may decide, exactly as Sentry's own
   * _getEventFilterUrl does; scanning them all would discard a real
   * regression because some wrapped cause came from an extension.
   */
  it("keeps a chained error whose root is ours even when a cause is third-party", () => {
    const event = {
      exception: {
        values: [
          {
            value: "network hiccup",
            mechanism: { type: "chained", parent_id: 0 },
            stacktrace: {
              frames: [{ filename: "chrome-extension://abcdef/fetch-wrapper.js" }],
            },
          },
          {
            value: "hero transition failed",
            mechanism: { type: "generic" },
            stacktrace: {
              frames: [{ filename: "https://rovno.ai/assets/hero.js" }],
            },
          },
        ],
      },
    };

    expect(isThirdPartyNoise(event)).toBe(false);
  });

  it("still drops a chained error whose root itself is third-party", () => {
    const event = {
      exception: {
        values: [
          {
            value: "inner",
            mechanism: { type: "chained", parent_id: 0 },
            stacktrace: { frames: [{ filename: "https://rovno.ai/assets/a.js" }] },
          },
          {
            value: "outer",
            mechanism: { type: "generic" },
            stacktrace: { frames: [{ filename: "moz-extension://abcdef/inject.js" }] },
          },
        ],
      },
    };

    expect(isThirdPartyNoise(event)).toBe(true);
  });

  it("ignores frame filenames Sentry itself treats as unusable", () => {
    const event = {
      exception: {
        values: [
          {
            value: "boom",
            stacktrace: {
              frames: [
                { filename: "chrome-extension://abcdef/inject.js" },
                { filename: "<anonymous>" },
                { filename: "[native code]" },
              ],
            },
          },
        ],
      },
    };

    // The last USABLE filename is the extension one, so this is still noise.
    expect(isThirdPartyNoise(event)).toBe(true);
  });

  it("keeps an error whose frames are all ours", () => {
    const event = {
      exception: {
        values: [
          {
            value: "Something exploded",
            stacktrace: {
              frames: [
                { filename: "https://rovno.ai/assets/a.js" },
                { filename: "https://rovno.ai/assets/b.js" },
              ],
            },
          },
        ],
      },
    };

    expect(isThirdPartyNoise(event)).toBe(false);
  });

  it("matches on a message-only event too", () => {
    expect(
      isThirdPartyNoise({ message: "undefined is not an object (window.webkit.messageHandlers)" }),
    ).toBe(true);
  });

  it("fails open on malformed events rather than dropping them", () => {
    expect(isThirdPartyNoise({})).toBe(false);
    expect(isThirdPartyNoise({ exception: null })).toBe(false);
    expect(isThirdPartyNoise({ exception: { values: "not-an-array" } })).toBe(false);
    expect(isThirdPartyNoise({ exception: { values: [null] } })).toBe(false);
    expect(isThirdPartyNoise({ exception: { values: [{ stacktrace: { frames: 7 } }] } })).toBe(
      false,
    );
  });
});
