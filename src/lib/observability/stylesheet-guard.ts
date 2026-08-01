import {
  attemptRecoveryReload,
  type PreloadErrorHandlerOptions,
} from "@/lib/observability/preload-recovery";

/**
 * Recovery for a stylesheet that loaded successfully but is not CSS.
 *
 * Timeweb's Caddy answers a missing `/assets/*` with the SPA fallback — `200`
 * and `text/html` — instead of a 404, and Timeweb has declined to make that
 * configurable (support, 2026-07-27; see docs/observability/alert-runbook.md
 * § A4). For a `<link rel=stylesheet>` that is the worst possible answer:
 * the request succeeds, so the browser fires `load`, not `error`, and neither
 * Vite's preload helper nor ./preload-recovery.ts ever hears about it. The page
 * renders completely unstyled and reports nothing.
 *
 * The signal is NOT `link.sheet === null`, which is the intuitive guess and is
 * wrong. Measured against prod on 2026-07-27 by injecting a link and reading it
 * back:
 *
 *   /assets/landing-DOESNOTEXIST.css  (SPA fallback)  load  CSSStyleSheet(0 rules)
 *   /assets/index-CB2HeGfr.css        (real)          load  CSSStyleSheet(1352 rules)
 *
 * The sheet object exists either way; HTML simply parses to zero CSS rules. So
 * the trigger is a sheet we expected to be non-empty that parsed to nothing.
 *
 * Zero rules alone is not enough to act on, because a legitimately empty CSS
 * chunk is indistinguishable from it. Every suspect is therefore CONFIRMED by
 * re-reading the response's `content-type`, and only a non-CSS type reloads.
 * Anything inconclusive — an offline confirm fetch, a cross-origin sheet whose
 * `cssRules` throws — declines, because reloading on a guess is worse than the
 * unstyled page we are trying to fix.
 *
 * Deliberately NOT handled: a stylesheet that fires `error`. Lazy-chunk CSS
 * already reaches `vite:preloadError`, and adding a second reload path for a
 * genuine network error would reload offline users on a failure that is not
 * this bug. If the host ever does start returning real 404s for `/assets/*`,
 * revisit that.
 */

/** Our own build output. External stylesheets (fonts, widgets) are not ours to judge. */
const ASSET_PATH_PREFIX = "/assets/";

export interface StylesheetGuardOptions extends PreloadErrorHandlerOptions {
  /** Injected so tests need no network and no jsdom CSS parser. */
  fetchImpl?: typeof fetch;
}

/**
 * A same-origin stylesheet emitted by our build.
 *
 * Same-origin matters twice: it is what makes `cssRules` readable at all, and
 * it keeps us from reloading the app because someone else's CDN had a bad day.
 */
function isOwnAssetStylesheet(link: HTMLLinkElement): boolean {
  // Lowercased because `rel` is case-insensitive in HTML; Vite emits lowercase,
  // but the stylesheets in index.html and the prerendered pages are not all ours.
  if (!link.rel.toLowerCase().split(/\s+/).includes("stylesheet")) return false;
  try {
    const url = new URL(link.href, window.location.href);
    return (
      url.origin === window.location.origin && url.pathname.startsWith(ASSET_PATH_PREFIX)
    );
  } catch {
    return false;
  }
}

/**
 * How many rules the browser actually parsed, or null when it cannot be known.
 *
 * Null covers both "not parsed yet" (no sheet) and "not allowed to look"
 * (`cssRules` throws on a cross-origin sheet). Both are inconclusive, and this
 * function must never report zero for either — a null that read as 0 would
 * reload the page on a stylesheet that is perfectly fine.
 */
function parsedRuleCount(link: HTMLLinkElement): number | null {
  const sheet = link.sheet;
  if (!sheet) return null;
  try {
    return sheet.cssRules.length;
  } catch {
    return null;
  }
}

/**
 * The response's content-type, lowercased, or null when it cannot be read.
 *
 * `force-cache` so the confirm normally costs no network at all: the browser
 * has just fetched this exact URL for the link. It also means we inspect the
 * response the link actually used rather than whatever a fresh request would
 * return, which is the honest question here.
 */
async function readContentType(
  href: string,
  fetchImpl: typeof fetch,
): Promise<string | null> {
  try {
    const response = await fetchImpl(href, { cache: "force-cache" });
    return (response.headers.get("content-type") ?? "").toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Judge one stylesheet and, if it is confirmed non-CSS, spend the session's
 * reload. Resolves to true only when a reload was actually triggered.
 */
export async function inspectStylesheet(
  link: HTMLLinkElement,
  options: StylesheetGuardOptions,
): Promise<boolean> {
  if (!isOwnAssetStylesheet(link)) return false;

  const ruleCount = parsedRuleCount(link);
  if (ruleCount === null || ruleCount > 0) return false;

  const contentType = await readContentType(link.href, options.fetchImpl ?? fetch);
  // Inconclusive, or a genuinely empty stylesheet. Either way, not our bug.
  if (contentType === null || contentType.includes("text/css")) return false;

  return attemptRecoveryReload(
    "stylesheet",
    `Stylesheet ${link.href} loaded but parsed to 0 rules and was served as ` +
      `"${contentType || "no content-type"}"`,
    options,
  );
}

/**
 * Watch for our own stylesheets and check each one once.
 *
 * Two entry points, because the damaging case arrives through the first:
 *   - links already in the document, which is `index.html`'s own stylesheet and
 *     the ones in every prerendered `/blog/**` page. A stale document names a
 *     dead hash right here, so this is the main path, not an edge case.
 *   - links added later, which is Vite's preload helper injecting a lazy route's
 *     CSS into `<head>`.
 *
 * The observer watches `document.head` WITHOUT `subtree`. Vite appends straight
 * to head, and observing the whole document for `childList` would fire on every
 * React commit for no benefit.
 *
 * Returns a teardown for tests. In the app it is installed once and never removed.
 */
export function installStylesheetGuard(options: StylesheetGuardOptions): () => void {
  if (typeof window === "undefined" || typeof MutationObserver === "undefined") {
    return () => {};
  }

  const seen = new WeakSet<HTMLLinkElement>();

  const check = (link: HTMLLinkElement): void => {
    if (!isOwnAssetStylesheet(link) || seen.has(link)) return;
    seen.add(link);
    // `inspectStylesheet` swallows its own failures; this is the belt-and-braces
    // that keeps a surprise from surfacing as an unhandled rejection.
    const run = () => void inspectStylesheet(link, options).catch(() => {});
    if (link.sheet) {
      run(); // already parsed: `load` has fired and will not fire again
    } else {
      link.addEventListener("load", run, { once: true });
    }
  };

  document
    .querySelectorAll<HTMLLinkElement>('link[rel~="stylesheet"]')
    .forEach(check);

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node instanceof HTMLLinkElement) check(node);
      }
    }
  });
  observer.observe(document.head, { childList: true });

  return () => observer.disconnect();
}
