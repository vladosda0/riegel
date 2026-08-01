import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  inspectStylesheet,
  installStylesheetGuard,
  type StylesheetGuardOptions,
} from "@/lib/observability/stylesheet-guard";
import {
  createPreloadErrorHandler,
  reportDeferredRecovery,
} from "@/lib/observability/preload-recovery";
import { captureMessage } from "@/lib/observability/sentry";

vi.mock("@/lib/observability/sentry", () => ({
  captureMessage: vi.fn(),
}));

/** What Timeweb's Caddy actually answers for a missing asset (verified on prod). */
const SPA_FALLBACK = "text/html; charset=utf-8";
const REAL_CSS = "text/css; charset=utf-8";

/**
 * jsdom never fetches external stylesheets, so `link.sheet` stays null forever.
 * Every test therefore states the parse result it wants to simulate.
 */
type SheetSpec = null | { rules: number } | "throws";

function fakeSheet(spec: SheetSpec): CSSStyleSheet | null {
  if (spec === null) return null;
  if (spec === "throws") {
    return {
      get cssRules(): CSSRuleList {
        throw new DOMException("cross-origin", "SecurityError");
      },
    } as unknown as CSSStyleSheet;
  }
  return { cssRules: { length: spec.rules } } as unknown as CSSStyleSheet;
}

function makeLink(
  href: string,
  sheet: SheetSpec,
  rel = "stylesheet",
): HTMLLinkElement {
  const link = document.createElement("link");
  link.rel = rel;
  link.href = href;
  Object.defineProperty(link, "sheet", { value: fakeSheet(sheet), configurable: true });
  return link;
}

/** A `fetch` that reports one content-type, or rejects when given null. */
function fetchReturning(contentType: string | null): typeof fetch {
  if (contentType === null) {
    return vi.fn().mockRejectedValue(new TypeError("Failed to fetch")) as unknown as typeof fetch;
  }
  return vi.fn().mockResolvedValue({
    headers: { get: (name: string) => (name.toLowerCase() === "content-type" ? contentType : null) },
  }) as unknown as typeof fetch;
}

function options(
  reload: () => void,
  contentType: string | null = SPA_FALLBACK,
  suppressReload = false,
): StylesheetGuardOptions {
  return { reload, suppressReload, fetchImpl: fetchReturning(contentType) };
}

beforeEach(() => {
  window.sessionStorage.clear();
  document.head.querySelectorAll("link").forEach((link) => link.remove());
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(captureMessage).mockClear();
});

describe("inspectStylesheet", () => {
  it("reloads a stylesheet that parsed to 0 rules and was served as HTML", async () => {
    const reload = vi.fn();

    const reloaded = await inspectStylesheet(
      makeLink("/assets/landing-DOESNOTEXIST.css", { rules: 0 }),
      options(reload, SPA_FALLBACK),
    );

    expect(reloaded).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("leaves a stylesheet that parsed rules alone", async () => {
    const reload = vi.fn();

    await inspectStylesheet(
      makeLink("/assets/index-CB2HeGfr.css", { rules: 1352 }),
      options(reload, SPA_FALLBACK),
    );

    expect(reload).not.toHaveBeenCalled();
  });

  it("does not reload a genuinely empty stylesheet, which also parses to 0 rules", async () => {
    const reload = vi.fn();

    await inspectStylesheet(
      makeLink("/assets/empty-chunk.css", { rules: 0 }),
      options(reload, REAL_CSS),
    );

    expect(reload).not.toHaveBeenCalled();
  });

  it("does not reload when the confirm fetch fails, because offline is not this bug", async () => {
    const reload = vi.fn();

    await inspectStylesheet(
      makeLink("/assets/landing-DOESNOTEXIST.css", { rules: 0 }),
      options(reload, null),
    );

    expect(reload).not.toHaveBeenCalled();
  });

  it("does not reload while the sheet is still unparsed", async () => {
    const reload = vi.fn();

    await inspectStylesheet(
      makeLink("/assets/index-CB2HeGfr.css", null),
      options(reload, SPA_FALLBACK),
    );

    expect(reload).not.toHaveBeenCalled();
  });

  it("does not reload when cssRules throws, so a cross-origin sheet cannot trigger it", async () => {
    const reload = vi.fn();

    await inspectStylesheet(
      makeLink("/assets/index-CB2HeGfr.css", "throws"),
      options(reload, SPA_FALLBACK),
    );

    expect(reload).not.toHaveBeenCalled();
  });

  it("ignores stylesheets outside /assets/, which are not our build output", async () => {
    const reload = vi.fn();

    await inspectStylesheet(
      makeLink("/static/theme.css", { rules: 0 }),
      options(reload, SPA_FALLBACK),
    );

    expect(reload).not.toHaveBeenCalled();
  });

  it("ignores a cross-origin stylesheet even under an /assets/ path", async () => {
    const reload = vi.fn();

    await inspectStylesheet(
      makeLink("https://cdn.example.com/assets/vendor.css", { rules: 0 }),
      options(reload, SPA_FALLBACK),
    );

    expect(reload).not.toHaveBeenCalled();
  });

  it("ignores a link that is not a stylesheet", async () => {
    const reload = vi.fn();

    await inspectStylesheet(
      makeLink("/assets/landing-DOESNOTEXIST.css", { rules: 0 }, "preload"),
      options(reload, SPA_FALLBACK),
    );

    expect(reload).not.toHaveBeenCalled();
  });

  it("does not reload in dev, so a broken dev server stays inspectable", async () => {
    const reload = vi.fn();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await inspectStylesheet(
      makeLink("/assets/landing-DOESNOTEXIST.css", { rules: 0 }),
      options(reload, SPA_FALLBACK, true),
    );

    expect(reload).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("0 rules"));
  });

  it("reports the stylesheet wording, not the preload wording", async () => {
    await inspectStylesheet(
      makeLink("/assets/landing-DOESNOTEXIST.css", { rules: 0 }),
      options(vi.fn(), SPA_FALLBACK),
    );

    reportDeferredRecovery();

    expect(captureMessage).toHaveBeenCalledWith(
      "Recovered from a stylesheet served as non-CSS by reloading",
      expect.objectContaining({
        tags: { source: "preload-recovery", recoveryKind: "stylesheet" },
        extra: expect.objectContaining({ reason: expect.stringContaining("text/html") }),
      }),
    );
  });

  it("shares one reload budget with the preload handler", async () => {
    const stylesheetReload = vi.fn();
    const preloadReload = vi.fn();

    await inspectStylesheet(
      makeLink("/assets/landing-DOESNOTEXIST.css", { rules: 0 }),
      options(stylesheetReload, SPA_FALLBACK),
    );
    createPreloadErrorHandler({ reload: preloadReload, suppressReload: false })(
      Object.assign(new Event("vite:preloadError"), { payload: new Error("boom") }),
    );

    expect(stylesheetReload).toHaveBeenCalledTimes(1);
    expect(preloadReload).not.toHaveBeenCalled();
  });
});

describe("installStylesheetGuard", () => {
  /** Lets a queued `void inspectStylesheet(...)` settle before asserting. */
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  it("checks a stylesheet that is already in the document at boot", async () => {
    const reload = vi.fn();
    document.head.appendChild(makeLink("/assets/index-STALE.css", { rules: 0 }));

    const teardown = installStylesheetGuard(options(reload, SPA_FALLBACK));
    await flush();
    teardown();

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("checks a stylesheet Vite appends to head later, once it has loaded", async () => {
    const reload = vi.fn();
    const teardown = installStylesheetGuard(options(reload, SPA_FALLBACK));

    // Appended unparsed, exactly as the preload helper does it.
    const link = makeLink("/assets/route-STALE.css", null);
    document.head.appendChild(link);
    await flush();
    expect(reload).not.toHaveBeenCalled();

    // The browser then parses it (to nothing) and fires load.
    Object.defineProperty(link, "sheet", {
      value: fakeSheet({ rules: 0 }),
      configurable: true,
    });
    link.dispatchEvent(new Event("load"));
    await flush();
    teardown();

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("checks each link once, however many times head changes", async () => {
    const reload = vi.fn();
    const link = makeLink("/assets/index-STALE.css", { rules: 0 });
    const teardown = installStylesheetGuard(options(reload, SPA_FALLBACK));

    document.head.appendChild(link);
    await flush();
    link.remove();
    document.head.appendChild(link);
    await flush();
    teardown();

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("stops checking after teardown", async () => {
    const reload = vi.fn();
    const teardown = installStylesheetGuard(options(reload, SPA_FALLBACK));

    teardown();
    document.head.appendChild(makeLink("/assets/index-STALE.css", { rules: 0 }));
    await flush();

    expect(reload).not.toHaveBeenCalled();
  });
});
