import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { isAnalyticsOptedOut } from "@/lib/analytics";

const OPT_OUT_KEY = "rovno-analytics-opt-out";

/** Simulate landing on a URL with the given query string. */
function visit(search: string): void {
  window.history.replaceState({}, "", `/${search}`);
}

describe("analytics opt-out", () => {
  beforeEach(() => {
    localStorage.clear();
    visit("");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("tracks normal visitors by default", () => {
    expect(isAnalyticsOptedOut()).toBe(false);
    expect(localStorage.getItem(OPT_OUT_KEY)).toBeNull();
  });

  it("marks the browser on ?no-analytics=1", () => {
    visit("?no-analytics=1");

    expect(isAnalyticsOptedOut()).toBe(true);
    expect(localStorage.getItem(OPT_OUT_KEY)).toBe("1");
  });

  it("keeps the mark on later navigations without the param", () => {
    visit("?no-analytics=1");
    expect(isAnalyticsOptedOut()).toBe(true);

    // The whole point: one visit marks the browser for good.
    visit("");
    expect(isAnalyticsOptedOut()).toBe(true);

    visit("?utm_source=telegram");
    expect(isAnalyticsOptedOut()).toBe(true);
  });

  it("clears the mark on ?no-analytics=0", () => {
    visit("?no-analytics=1");
    expect(isAnalyticsOptedOut()).toBe(true);

    visit("?no-analytics=0");
    expect(isAnalyticsOptedOut()).toBe(false);
    expect(localStorage.getItem(OPT_OUT_KEY)).toBeNull();
  });

  it("ignores values other than 1 and 0", () => {
    visit("?no-analytics=yes");
    expect(isAnalyticsOptedOut()).toBe(false);

    visit("?no-analytics=");
    expect(isAnalyticsOptedOut()).toBe(false);
  });

  it("does not opt out a marked browser's neighbours (key is exact)", () => {
    localStorage.setItem("rovno-analytics-opt-out-other", "1");

    expect(isAnalyticsOptedOut()).toBe(false);
  });

  it("fails open when storage is unavailable", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage disabled");
    });

    // A real visitor in private mode must still be counted.
    expect(isAnalyticsOptedOut()).toBe(false);
  });
});
