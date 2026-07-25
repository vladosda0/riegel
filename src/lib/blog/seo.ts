// Per-page document <head> management (title / meta / canonical / JSON-LD).
//
// The app is a static-hosted SPA with a single index.html, so per-route SEO
// tags have to be managed at runtime. Two consumers rely on the exact
// mechanics here:
//  - JS-executing crawlers (Googlebot, Yandex rendering) read the updated
//    tags from the live DOM;
//  - the build-time prerenderer (scripts/prerender-blog.mjs) writes the SAME
//    tags statically into dist/blog/**/index.html — this hook then finds the
//    existing elements and updates them in place (no duplicates on hydrated
//    prerendered pages).
//
// Existing elements are updated and restored on unmount; elements this hook
// created are marked data-rv-seo and removed on unmount, so app routes keep
// the index.html defaults.

import { useEffect } from "react";

/** Primary public origin — canonical URLs always point here, including when
 * the site is served from the стройагент.рф mirror domain. */
export const SITE_ORIGIN = "https://rovno.ai";
export const SITE_NAME = "Ровно ИИ";

export interface ArticleHeadMeta {
  publishedTime: string;
  modifiedTime?: string;
  authorName?: string;
  tags?: string[];
}

export interface DocumentHeadOptions {
  title: string;
  description?: string | null;
  /** Path starting with "/" — combined with SITE_ORIGIN into the canonical URL. */
  canonicalPath?: string;
  ogType?: "website" | "article";
  ogImage?: string | null;
  article?: ArticleHeadMeta;
  /** e.g. "noindex, nofollow" for the admin surface. */
  robots?: string;
  jsonLd?: object | object[] | null;
}

const MANAGED_ATTR = "data-rv-seo";
const JSONLD_ID = "rv-jsonld";

type TagSelector = { kind: "meta"; attr: "name" | "property"; key: string } | { kind: "link"; rel: string };

interface AppliedTag {
  element: Element;
  created: boolean;
  originalContent: string | null;
  /** Its value at mount time may be the booted page's own rather than an app-shell
   *  default, so it must not be restored on unmount. See PRERENDER_ONLY_TAGS. */
  prerenderOnly: boolean;
}

/**
 * Head tags whose value at mount time cannot be trusted to be an app-shell default.
 *
 * This used to read "tags index.html does NOT ship", and for most of the list that
 * is still the reason. It stopped being the whole truth once prerender-blog.mjs
 * began stamping a self-canonical into the shell as well (the www.rovno.ai
 * duplicate-host fix): `canonical` is now sometimes a shell default and sometimes
 * the booted page's own, and nothing in the DOM distinguishes them. It stays on
 * this list because the two failure modes are asymmetric — see the note beside it.
 *
 * For these, "the value that was there when this component mounted" is not the app
 * shell's default — it is the STATIC SNAPSHOT OF THE PAGE WE BOOTED ON. Restoring it on
 * unmount carries one page's SEO onto the next: navigate from a prerendered article to
 * the landing page and `/` ends up declaring `canonical: /blog/<the-article>/`, which
 * tells a crawler the landing page is a duplicate of a blog post. Verified in a browser.
 *
 * Removing them leaves the page with nothing — which for six of the seven is exactly what
 * `/` boots with when it is served for real. For `canonical` it is no longer, and the note
 * beside that entry explains why removal is still the branch we want.
 *
 * KNOWN RESIDUAL, and it is bigger than this list. `prerender-blog.mjs` also OVERWRITES, in
 * place, eight tags index.html does ship: `<title>`, `description`, `og:title`,
 * `og:description`, `og:type`, `og:image`, `twitter:card`, `twitter:title`. On a prerendered
 * boot their mount-state is the article's too, so "restore" reinstates the article's values
 * on the next route — the same mechanism, one layer down. We do not fix it here because the
 * DOM cannot answer the question that matters ("was this value written by index.html or by
 * the prerenderer?"), and removing them would break the non-prerendered boot, where restore
 * is exactly right and a visitor who opens the blog and comes back must get the shell's
 * og:title.
 *
 * Bounded: crawlers and social scrapers fetch each URL fresh and never SPA-navigate, so no
 * indexing or preview consumer ever observes ANY of this class — including, honestly, the
 * `noindex` leak that started this. The one human-visible symptom is the browser tab, which
 * reads the article's title on `/` after a client-side navigation. Fixing it properly means
 * the prerenderer stamping `data-rv-shell-default` beside each value it overwrites, or the
 * landing route managing its own head. Neither belongs in this PR.
 */
const PRERENDER_ONLY_TAGS: TagSelector[] = [
  // `canonical` STAYS here even though the shell now ships one of its own (see
  // the note above): removal is the fail-safe branch. The DOM cannot tell whose
  // canonical it found, and the two mistakes are not equal. Restoring after a
  // boot on /blog/a/ re-declares the next route a duplicate of that article —
  // the browser-verified bug the seo.test.ts case below exists to prevent.
  // Removing after a boot on the landing shell merely leaves that session with
  // no canonical, i.e. exactly what every page had before the shell carried one.
  { kind: "link", rel: "canonical" },
  { kind: "meta", attr: "name", key: "robots" },
  { kind: "meta", attr: "property", key: "og:url" },
  { kind: "meta", attr: "property", key: "og:site_name" },
  { kind: "meta", attr: "property", key: "article:published_time" },
  { kind: "meta", attr: "property", key: "article:modified_time" },
  // NOT emitted by the prerenderer today — it writes only twitter:card and twitter:title.
  // The entry is inert, and it stays because the PREDICATE is "index.html does not ship it",
  // which is true. The day the prerenderer emits it, this is already correct.
  { kind: "meta", attr: "name", key: "twitter:description" },
];

/** Repeatable, so it never goes through upsertTag; handled by hand below. */
const ARTICLE_TAG_SELECTOR = 'meta[property="article:tag"]';

function sameSelector(a: TagSelector, b: TagSelector): boolean {
  if (a.kind === "link") return b.kind === "link" && a.rel === b.rel;
  return b.kind === "meta" && a.attr === b.attr && a.key === b.key;
}

const isPrerenderOnly = (selector: TagSelector) =>
  PRERENDER_ONLY_TAGS.some((only) => sameSelector(only, selector));

function upsertTag(selector: TagSelector, value: string, applied: AppliedTag[]): void {
  let element: Element | null;
  if (selector.kind === "meta") {
    element = document.head.querySelector(`meta[${selector.attr}="${selector.key}"]`);
  } else {
    element = document.head.querySelector(`link[rel="${selector.rel}"]`);
  }
  const prerenderOnly = isPrerenderOnly(selector);

  if (element) {
    const attrName = selector.kind === "meta" ? "content" : "href";
    applied.push({ element, created: false, originalContent: element.getAttribute(attrName), prerenderOnly });
    element.setAttribute(attrName, value);
    return;
  }

  if (selector.kind === "meta") {
    element = document.createElement("meta");
    element.setAttribute(selector.attr, selector.key);
    element.setAttribute("content", value);
  } else {
    element = document.createElement("link");
    element.setAttribute("rel", selector.rel);
    element.setAttribute("href", value);
  }
  element.setAttribute(MANAGED_ATTR, "1");
  document.head.appendChild(element);
  applied.push({ element, created: true, originalContent: null, prerenderOnly });
}

/** Apply head tags for the current page; restores previous state on unmount.
 * Pass null to leave the head untouched (e.g. while data is loading). */
export function useDocumentHead(options: DocumentHeadOptions | null): void {
  // Serialize for the dependency array: options is a fresh object every render.
  const serialized = options ? JSON.stringify(options) : null;

  useEffect(() => {
    if (!serialized) return;
    const opts = JSON.parse(serialized) as DocumentHeadOptions;

    const previousTitle = document.title;
    const applied: AppliedTag[] = [];

    document.title = opts.title;
    upsertTag({ kind: "meta", attr: "property", key: "og:title" }, opts.title, applied);

    if (opts.description) {
      upsertTag({ kind: "meta", attr: "name", key: "description" }, opts.description, applied);
      upsertTag({ kind: "meta", attr: "property", key: "og:description" }, opts.description, applied);
      upsertTag({ kind: "meta", attr: "name", key: "twitter:description" }, opts.description, applied);
    }

    upsertTag({ kind: "meta", attr: "property", key: "og:type" }, opts.ogType ?? "website", applied);
    upsertTag({ kind: "meta", attr: "property", key: "og:site_name" }, SITE_NAME, applied);
    upsertTag({ kind: "meta", attr: "name", key: "twitter:title" }, opts.title, applied);

    if (opts.canonicalPath) {
      const canonicalUrl = `${SITE_ORIGIN}${opts.canonicalPath}`;
      upsertTag({ kind: "link", rel: "canonical" }, canonicalUrl, applied);
      upsertTag({ kind: "meta", attr: "property", key: "og:url" }, canonicalUrl, applied);
    }

    if (opts.ogImage) {
      upsertTag({ kind: "meta", attr: "property", key: "og:image" }, opts.ogImage, applied);
      upsertTag({ kind: "meta", attr: "name", key: "twitter:card" }, "summary_large_image", applied);
      upsertTag({ kind: "meta", attr: "name", key: "twitter:image" }, opts.ogImage, applied);
    } else {
      upsertTag({ kind: "meta", attr: "name", key: "twitter:card" }, "summary", applied);
    }

    if (opts.article) {
      upsertTag(
        { kind: "meta", attr: "property", key: "article:published_time" },
        opts.article.publishedTime,
        applied,
      );
      if (opts.article.modifiedTime) {
        upsertTag(
          { kind: "meta", attr: "property", key: "article:modified_time" },
          opts.article.modifiedTime,
          applied,
        );
      }
      // `article:tag` is repeatable, so it can never go through upsertTag. On a prerendered
      // article the static head already carries one per tag; creating more left DUPLICATES
      // while mounted, and the prerendered copies then survived unmount forever. Clear the
      // whole family first — index.html ships none, so this is the boot state.
      document.head.querySelectorAll(ARTICLE_TAG_SELECTOR).forEach((el) => el.remove());
      for (const tag of opts.article.tags ?? []) {
        const el = document.createElement("meta");
        el.setAttribute("property", "article:tag");
        el.setAttribute("content", tag);
        el.setAttribute(MANAGED_ATTR, "1");
        document.head.appendChild(el);
        // Freshly created, so `created: true` already removes it; `prerenderOnly` is moot.
        applied.push({ element: el, created: true, originalContent: null, prerenderOnly: false });
      }
    }

    // `robots` and `#rv-jsonld` are the two tags a page may need to CLEAR rather than
    // overwrite: an article sets no robots, and a thin hub sets no JSON-LD, so without
    // this a prerendered value would simply survive into the next page's head.
    //
    // That is only half the story. Removing a tag when THIS page sets none happens in
    // this page's effect; a prerendered tag also has to go when we unmount to a page that
    // never calls this hook at all. See PRERENDER_ONLY_TAGS and the cleanup below —
    // `robots` is one of six, not one of two.
    if (opts.robots) {
      upsertTag({ kind: "meta", attr: "name", key: "robots" }, opts.robots, applied);
    } else {
      document.head.querySelector('meta[name="robots"]')?.remove();
    }

    if (opts.jsonLd) {
      const payload = JSON.stringify(Array.isArray(opts.jsonLd) && opts.jsonLd.length === 1 ? opts.jsonLd[0] : opts.jsonLd);
      let jsonLdEl = document.getElementById(JSONLD_ID) as HTMLScriptElement | null;
      if (!jsonLdEl) {
        jsonLdEl = document.createElement("script");
        jsonLdEl.type = "application/ld+json";
        jsonLdEl.id = JSONLD_ID;
        document.head.appendChild(jsonLdEl);
      }
      jsonLdEl.textContent = payload;
    } else {
      document.getElementById(JSONLD_ID)?.remove();
    }

    return () => {
      document.title = previousTitle;
      for (const tag of applied) {
        // Tags index.html does not ship are REMOVED, never restored — even when this page
        // merely overwrote one the prerenderer had put there. See PRERENDER_ONLY_TAGS: for
        // those, "the value at mount time" is the static snapshot of the page we booted on,
        // so restoring it walks one article's canonical and noindex onto the next route.
        //
        // Removing them only when the NEXT page sets none (above) half-closed this: that
        // branch lives in the next page's effect, and only BlogIndex / BlogPostPage /
        // BlogTagPage call this hook at all. Navigate to the landing page and nothing ran.
        if (tag.prerenderOnly || tag.created) {
          tag.element.remove();
        } else if (tag.originalContent !== null) {
          const attrName = tag.element.tagName === "LINK" ? "href" : "content";
          tag.element.setAttribute(attrName, tag.originalContent);
        }
      }
      document.getElementById(JSONLD_ID)?.remove();
    };
  }, [serialized]);
}
