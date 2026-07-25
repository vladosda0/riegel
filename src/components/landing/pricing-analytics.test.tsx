import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import { Pricing } from "@/components/landing/LandingSections";
import { trackEventOncePerSession } from "@/lib/analytics";

vi.mock("@/lib/analytics", () => ({
  trackEventOncePerSession: vi.fn(),
}));

type ObserverCallback = (entries: Array<{ isIntersecting: boolean }>) => void;

let lastCallback: ObserverCallback | null = null;
let lastOptions: IntersectionObserverInit | undefined;
const disconnect = vi.fn();
const observe = vi.fn();

class FakeIntersectionObserver {
  constructor(callback: ObserverCallback, options?: IntersectionObserverInit) {
    lastCallback = callback;
    lastOptions = options;
  }
  observe = observe;
  disconnect = disconnect;
  unobserve = vi.fn();
  takeRecords = vi.fn();
}

function renderPricing() {
  return render(
    <MemoryRouter>
      <Pricing startPath="/auth/signup" />
    </MemoryRouter>,
  );
}

describe("pricing_page_viewed", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lastCallback = null;
    lastOptions = undefined;
    vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
  });

  it("does not report until the section is actually on screen", () => {
    renderPricing();

    expect(observe).toHaveBeenCalledTimes(1);
    expect(trackEventOncePerSession).not.toHaveBeenCalled();
  });

  it("reports once the section enters the viewport", () => {
    renderPricing();

    lastCallback?.([{ isIntersecting: true }]);

    expect(trackEventOncePerSession).toHaveBeenCalledWith("pricing_page_viewed");
  });

  it("ignores a callback where nothing is intersecting", () => {
    renderPricing();

    lastCallback?.([{ isIntersecting: false }]);

    expect(trackEventOncePerSession).not.toHaveBeenCalled();
  });

  it("stops observing after the first report", () => {
    renderPricing();

    lastCallback?.([{ isIntersecting: true }]);

    expect(disconnect).toHaveBeenCalled();
  });

  /**
   * Regression guard. A ratio `threshold` is a fraction of the ELEMENT, so on a
   * phone — where this section stacks into a tall column — a quarter of it can
   * exceed the whole viewport and the event would never fire, on exactly the
   * traffic we care about. The margin must stay viewport-relative.
   */
  it("uses a viewport-relative margin, not an element-ratio threshold", () => {
    renderPricing();

    expect(lastOptions?.rootMargin).toBe("-25% 0px -25% 0px");
    expect(lastOptions?.threshold).toBe(0);
  });

  it("does nothing when the browser has no IntersectionObserver", () => {
    vi.stubGlobal("IntersectionObserver", undefined);

    expect(() => renderPricing()).not.toThrow();
    expect(trackEventOncePerSession).not.toHaveBeenCalled();
  });
});
