import { afterEach, describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { useDocumentHead } from "./seo";

/** Read from the shell rather than hand-copied, so it cannot go stale in silence. */
const SHELL_OG_TITLE =
  /<meta property="og:title" content="([^"]*)"/.exec(
    readFileSync(resolve(__dirname, "../../../index.html"), "utf8"),
  )?.[1] ?? "";

function getMeta(attr: "name" | "property", key: string): string | null {
  return document.head.querySelector(`meta[${attr}="${key}"]`)?.getAttribute("content") ?? null;
}

afterEach(() => {
  // Each test unmounts its hook (renderHook cleanup runs in afterEach via
  // testing-library auto-cleanup), so the head should already be restored.
  document.head.querySelectorAll("[data-rv-seo]").forEach((el) => el.remove());
  document.getElementById("rv-jsonld")?.remove();
});

describe("useDocumentHead", () => {
  it("sets title, description, canonical and og tags", () => {
    const { unmount } = renderHook(() =>
      useDocumentHead({
        title: "Как вести смету — Блог Ровно",
        description: "Разбор типовых ошибок в смете.",
        canonicalPath: "/blog/kak-vesti-smetu/",
        ogType: "article",
        ogImage: "https://cdn.example/cover.jpg",
      }),
    );

    expect(document.title).toBe("Как вести смету — Блог Ровно");
    expect(getMeta("name", "description")).toBe("Разбор типовых ошибок в смете.");
    expect(getMeta("property", "og:type")).toBe("article");
    expect(getMeta("property", "og:image")).toBe("https://cdn.example/cover.jpg");
    expect(getMeta("name", "twitter:card")).toBe("summary_large_image");
    expect(
      document.head.querySelector('link[rel="canonical"]')?.getAttribute("href"),
    ).toBe("https://rovno.ai/blog/kak-vesti-smetu/");
    expect(getMeta("property", "og:url")).toBe("https://rovno.ai/blog/kak-vesti-smetu/");

    unmount();
  });

  it("restores previous title and removes created tags on unmount", () => {
    const initialTitle = document.title;

    const { unmount } = renderHook(() =>
      useDocumentHead({
        title: "Временный заголовок",
        description: "x",
        canonicalPath: "/blog/",
      }),
    );
    expect(document.title).toBe("Временный заголовок");

    unmount();
    expect(document.title).toBe(initialTitle);
    expect(document.head.querySelector('link[rel="canonical"]')).toBeNull();
    expect(getMeta("property", "og:url")).toBeNull();
  });

  it("updates existing tags in place and restores their content", () => {
    const meta = document.createElement("meta");
    meta.setAttribute("name", "description");
    meta.setAttribute("content", "Статическое описание");
    document.head.appendChild(meta);

    const { unmount } = renderHook(() =>
      useDocumentHead({ title: "T", description: "Новое описание" }),
    );

    expect(getMeta("name", "description")).toBe("Новое описание");
    expect(document.head.querySelectorAll('meta[name="description"]').length).toBe(1);

    unmount();
    expect(getMeta("name", "description")).toBe("Статическое описание");
    meta.remove();
  });

  it("writes JSON-LD into a single #rv-jsonld script", () => {
    const { unmount } = renderHook(() =>
      useDocumentHead({
        title: "T",
        jsonLd: { "@context": "https://schema.org", "@type": "Article", headline: "T" },
      }),
    );

    const script = document.getElementById("rv-jsonld");
    expect(script).not.toBeNull();
    expect(JSON.parse(script!.textContent ?? "{}")["@type"]).toBe("Article");

    unmount();
    expect(document.getElementById("rv-jsonld")).toBeNull();
  });

  it("does nothing when options are null", () => {
    const before = document.head.innerHTML;
    const { unmount } = renderHook(() => useDocumentHead(null));
    expect(document.head.innerHTML).toBe(before);
    unmount();
  });
});

describe("prerendered head tags do not leak across a client-side navigation", () => {
  /** Simulate booting on a PRERENDERED page: the static head already has these. */
  function seedPrerenderedHead(robots: string | null, jsonLd: unknown | null) {
    if (robots) {
      const meta = document.createElement("meta");
      meta.setAttribute("name", "robots");
      meta.setAttribute("content", robots);
      document.head.appendChild(meta);
    }
    if (jsonLd) {
      const script = document.createElement("script");
      script.type = "application/ld+json";
      script.id = "rv-jsonld";
      script.textContent = JSON.stringify(jsonLd);
      document.head.appendChild(script);
    }
  }

  afterEach(() => {
    document.head.querySelector('meta[name="robots"]')?.remove();
    document.getElementById("rv-jsonld")?.remove();
    // Tests here seed prerender-only tags; leaving one behind would let the NEXT test
    // pass for the wrong reason (the tag it expects removed was never there to begin with).
    for (const sel of ['link[rel="canonical"]', 'meta[property="og:url"]',
      'meta[property="og:site_name"]', 'meta[name="twitter:description"]',
      'meta[property="article:published_time"]', 'meta[property="article:modified_time"]']) {
      document.head.querySelector(sel)?.remove();
    }
    document.head.querySelectorAll('meta[property="article:tag"]').forEach((el) => el.remove());
  });

  // The half-closed version of this fix only removed a prerendered tag when the NEXT page
  // also called useDocumentHead. No public route outside the blog does — the landing page
  // in particular does not. Navigate from a prerendered thin hub to the landing page and
  // nothing ran to clear it, so `/` carried `noindex` in the live DOM for the rest of the
  // session.

  it("UNMOUNTING to a page that never calls the hook still removes robots", () => {
    seedPrerenderedHead("noindex, follow", null);
    const { unmount } = renderHook(() =>
      useDocumentHead({ title: "#тег", robots: "noindex, follow" }),
    );
    expect(getMeta("name", "robots")).toBe("noindex, follow");
    unmount(); // -> Landing, which does not manage the head at all
    expect(getMeta("name", "robots")).toBeNull();
  });

  it("UNMOUNTING to a page that never calls the hook still removes the JSON-LD", () => {
    seedPrerenderedHead(null, { "@type": "Article", headline: "Статья" });
    const { unmount } = renderHook(() =>
      useDocumentHead({ title: "Статья", jsonLd: [{ "@type": "Article" }] }),
    );
    expect(document.getElementById("rv-jsonld")).not.toBeNull();
    unmount();
    expect(document.getElementById("rv-jsonld")).toBeNull();
  });

  it("a prerendered CANONICAL is removed, not restored — it names the page we booted on", () => {
    // Caught in a real browser: hard-load the prerendered /blog/a/, SPA-navigate away, and
    // the next route still declared `canonical: https://rovno.ai/blog/a/`. The canonical
    // found at mount time here is the prerendered article's own, and "restoring" it tells a
    // crawler the landing page is a duplicate of a blog post. (The shell ships a canonical
    // of its own nowadays, but the DOM cannot tell the two apart — removal is the safe branch.)
    // An earlier version of THIS test asserted the leak as intended behaviour.
    const canonical = document.createElement("link");
    canonical.setAttribute("rel", "canonical");
    canonical.setAttribute("href", "https://rovno.ai/blog/a/"); // as the prerenderer emits it
    document.head.appendChild(canonical);

    const { unmount } = renderHook(() =>
      useDocumentHead({ title: "Б", canonicalPath: "/blog/b/" }),
    );
    expect(document.head.querySelector('link[rel="canonical"]')?.getAttribute("href"))
      .toBe("https://rovno.ai/blog/b/");
    unmount();
    expect(document.head.querySelector('link[rel="canonical"]')).toBeNull();
  });

  it("article:published_time / article:modified_time are prerender-only too", () => {
    for (const key of ["article:published_time", "article:modified_time"]) {
      const el = document.createElement("meta");
      el.setAttribute("property", key);
      el.setAttribute("content", "2026-01-01T00:00:00Z");
      document.head.appendChild(el);
    }
    const { unmount } = renderHook(() =>
      useDocumentHead({
        title: "Статья",
        article: { publishedTime: "2026-07-01T00:00:00Z", modifiedTime: "2026-07-02T00:00:00Z" },
      }),
    );
    unmount();
    expect(document.head.querySelector('meta[property="article:published_time"]')).toBeNull();
    expect(document.head.querySelector('meta[property="article:modified_time"]')).toBeNull();
  });

  it("article:tag is not duplicated while mounted, and none survive unmount", () => {
    // Repeatable, so it never goes through upsertTag. The prerendered copies used to sit
    // alongside the freshly created ones, and then outlive them.
    for (const tag of ["приёмка", "смета"]) {
      const el = document.createElement("meta");
      el.setAttribute("property", "article:tag");
      el.setAttribute("content", tag);
      document.head.appendChild(el);
    }
    const { unmount } = renderHook(() =>
      useDocumentHead({
        title: "Статья",
        article: { publishedTime: "2026-07-01T00:00:00Z", tags: ["приёмка", "смета"] },
      }),
    );
    expect(document.head.querySelectorAll('meta[property="article:tag"]').length).toBe(2);
    unmount();
    expect(document.head.querySelectorAll('meta[property="article:tag"]').length).toBe(0);
  });

  it("og:url / og:site_name / twitter:description are prerender-only too", () => {
    // The full set of head tags the prerenderer emits that index.html does not.
    for (const [attr, key] of [["property", "og:url"], ["property", "og:site_name"], ["name", "twitter:description"]]) {
      const el = document.createElement("meta");
      el.setAttribute(attr, key);
      el.setAttribute("content", "из статьи");
      document.head.appendChild(el);
    }
    const { unmount } = renderHook(() =>
      useDocumentHead({ title: "Статья", description: "Описание", canonicalPath: "/blog/a/" }),
    );
    unmount();
    expect(document.head.querySelector('meta[property="og:url"]')).toBeNull();
    expect(document.head.querySelector('meta[property="og:site_name"]')).toBeNull();
    expect(document.head.querySelector('meta[name="twitter:description"]')).toBeNull();
  });

  it("og:title and description ARE restored — index.html really does ship those", () => {
    expect(SHELL_OG_TITLE).not.toBe("");
    const og = document.createElement("meta");
    og.setAttribute("property", "og:title");
    og.setAttribute("content", SHELL_OG_TITLE);
    document.head.appendChild(og);

    const { unmount } = renderHook(() => useDocumentHead({ title: "Статья" }));
    expect(og.getAttribute("content")).toBe("Статья");
    unmount();
    expect(og.getAttribute("content")).toBe(SHELL_OG_TITLE);
    og.remove();
  });

  it("a page that sets no robots REMOVES a prerendered noindex", () => {
    // Land on a prerendered thin tag hub (static `noindex, follow`), then navigate
    // to an article. Restoring the original on unmount left the article noindex,
    // and so did every page after it for the rest of the session.
    seedPrerenderedHead("noindex, follow", null);
    const { unmount } = renderHook(() => useDocumentHead({ title: "Статья" }));
    expect(getMeta("name", "robots")).toBeNull();
    unmount();
    expect(document.head.querySelector('meta[name="robots"]')).toBeNull();
  });

  it("a page that DOES set robots still wins", () => {
    seedPrerenderedHead("index, follow", null);
    renderHook(() => useDocumentHead({ title: "Черновик", robots: "noindex, nofollow" }));
    expect(getMeta("name", "robots")).toBe("noindex, nofollow");
  });

  it("a page with no JSON-LD REMOVES a prerendered #rv-jsonld", () => {
    // Prerendered article carries Article+BreadcrumbList+FAQPage; a thin tag hub
    // (jsonLd: null) must not keep declaring the article's structured data.
    seedPrerenderedHead(null, [{ "@type": "Article" }, { "@type": "FAQPage" }]);
    const { unmount } = renderHook(() => useDocumentHead({ title: "#тег", jsonLd: null }));
    expect(document.getElementById("rv-jsonld")).toBeNull();
    unmount();
    expect(document.getElementById("rv-jsonld")).toBeNull();
  });

  it("a page with JSON-LD overwrites the prerendered one", () => {
    seedPrerenderedHead(null, [{ "@type": "Article" }]);
    renderHook(() => useDocumentHead({ title: "#тег", jsonLd: [{ "@type": "CollectionPage" }] }));
    const payload = JSON.parse(document.getElementById("rv-jsonld")!.textContent!);
    expect(payload).toEqual({ "@type": "CollectionPage" });
  });
});
