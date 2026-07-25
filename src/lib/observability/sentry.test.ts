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
