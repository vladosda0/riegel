#!/usr/bin/env node
// Build-time blog prerenderer (runs after `vite build`, see package.json).
//
// Why: the site is a static SPA on Timeweb (no server control), while the
// crawlers that matter for the blog's mission — YandexBot, GPTBot, ClaudeBot,
// PerplexityBot — fetch raw HTML and execute little or no JS. This script
// gives every published article a real static HTML file on the SAME domain:
//
//   dist/blog/index.html            — article list (crawlable <a> links)
//   dist/blog/<slug>/index.html     — full article HTML + meta + JSON-LD
//   dist/sitemap.xml                — static routes + articles
//   dist/blog/feed.xml              — RSS 2.0 with full content
//   dist/llms.txt                   — LLM-crawler orientation file
//
// Mechanics: takes dist/index.html as the app shell, swaps the head tags for
// per-page SEO tags, injects the article markup into #root (React re-renders
// over it on hydration; the inlined __BLOG_*_DATA__ JSON feeds React Query's
// initialData so the client paints identical content with no refetch), and
// links the CSS chunks that carry the .rv-landing/.rv-article styles (they
// are code-split out of the entry CSS).
//
// Fail-soft by design: with no reachable Supabase (CI placeholder env, local
// offline builds) it still writes a static-routes-only sitemap and exits 0 —
// a broken blog fetch must never fail the product build. Publishing flow:
// articles appear on the site instantly (SPA reads the DB), and get their
// static SEO snapshot on the next deploy.
//
// Keep the head/JSON-LD shapes in sync with src/lib/blog/seo.ts and
// src/lib/blog/jsonld.ts (the runtime twins).

import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import createDOMPurify from "dompurify";
import { sanitizeArticleHtmlWith } from "../src/lib/blog/sanitizeConfig.mjs";
import { annotateArticleHtml } from "../src/lib/blog/anchorsConfig.mjs";
import { faqJsonLdFromDoc } from "../src/lib/blog/faqConfig.mjs";
import { collectTagHubs, isIndexableTag, pluralizeRu, postsForTagSlug, tagNamesForSlug, tagSlug } from "../src/lib/blog/tagsConfig.mjs";

// fileURLToPath (not new URL().pathname) so a build path containing a space or
// non-ASCII char decodes correctly instead of staying percent-encoded.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "dist");

const SITE_ORIGIN = "https://rovno.ai";
const SITE_NAME = "Ровно ИИ";
const BLOG_TITLE = "Блог Ровно";
const BLOG_DESCRIPTION =
  "Статьи команды Ровно о том, как вести стройку без хаоса: сметы, закупки, приёмка работ, контроль подрядчиков и ИИ на объекте.";

// Trailing slashes are the canonical form for everything served out of a
// directory: Caddy resolves dist/<route>/index.html for both /offer and
// /offer/, 308-ing the bare form to the slashed one. Advertising the bare form
// here would put a redirecting URL in the sitemap.
const STATIC_ROUTES = ["/", "/blog/", "/offer/", "/privacy/", "/refund/", "/contacts/"];

// Public routes that ship no prerendered body but still need a self-canonical.
//
// Why: the app answers on several hosts (rovno.ai, www.rovno.ai, стройагент.рф)
// and Timeweb App Platform serves the same files on all of them. index.html
// carries a client-side www -> apex redirect, but a crawler that does not run JS
// (YandexBot) never executes it, so without a canonical every one of those hosts
// is an independent, indexable copy of the site.
//
// These four are 1:1 files, so they are written unconditionally. The landing "/"
// is NOT in this list: it is dist/index.html, which doubles as Caddy's SPA
// fallback, so its canonical is inherited by every URL that has no file of its
// own. That makes WHEN it is written load-bearing — see the write in main().
const LEGAL_SHELL_ROUTES = ["/offer/", "/privacy/", "/refund/", "/contacts/"];

// ---------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const escapeXml = escapeHtml;

// Sanitize article body HTML for the static snapshot, using the SAME allow-list
// as the live SPA render (sanitizeConfig.mjs). This static file is served to
// anonymous visitors and crawlers before React hydrates, so it must not carry
// any HTML the live path would strip. Lazy jsdom init preserves the script's
// fail-soft contract; if the sanitizer itself ever throws, fall back to escaped
// (inert) text rather than emitting raw content_html or breaking the build.
let _articlePurify = null;
function sanitizeArticleBody(html) {
  try {
    if (!_articlePurify) _articlePurify = createDOMPurify(new JSDOM("").window);
    return sanitizeArticleHtmlWith(_articlePurify, html ?? "");
  } catch (err) {
    log(`sanitize failed, escaping article body: ${err?.message ?? err}`);
    return escapeHtml(html ?? "");
  }
}

// Sanitize, then stamp heading ids and prepend the TOC — the same order, and
// the same anchorsConfig.mjs pass, that BlogPostPage runs at render time. If the two
// disagreed, every #deep-link a crawler indexed from the static snapshot would
// break the moment React hydrated and replaced the markup.
//
// One lazily-built jsdom window, reused across articles (same shape as the
// purify singleton above). `new JSDOM(html)` per post would build and leak a
// full window each time, and would run jsdom's CSS parser over any <style> in
// the body just to spray parse errors into the build log. DOMParser skips both
// and mirrors what BlogPostPage does in the browser.
let _articleDom = null;
function parseArticleHtml(source) {
  if (!_articleDom) _articleDom = new JSDOM("");
  return new _articleDom.window.DOMParser().parseFromString(source, "text/html");
}

function renderArticleBody(html) {
  const safe = sanitizeArticleBody(html);
  try {
    return annotateArticleHtml(safe, parseArticleHtml).html;
  } catch (err) {
    log(`anchor pass failed, serving unanchored body: ${err?.message ?? err}`);
    return safe;
  }
}

/** JSON safe to embed in <script> (no `</script>` breakout). */
function jsonForScriptTag(value) {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}

function formatDateRu(iso) {
  if (!iso) return "";
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric" }).format(
    new Date(iso),
  );
}

function readingTimeLabel(minutes) {
  if (!minutes || minutes < 1) return null;
  return `${minutes} мин чтения`;
}

function log(message) {
  console.log(`[prerender-blog] ${message}`);
}

// ---------------------------------------------------------------------------
// Env: process.env first, then .env.local / .env (KEY=VALUE lines)
// ---------------------------------------------------------------------------

async function loadEnvFallback() {
  const wanted = ["VITE_SUPABASE_URL", "VITE_SUPABASE_PUBLISHABLE_KEY"];
  const out = {};
  for (const key of wanted) {
    if (process.env[key]) out[key] = process.env[key];
  }
  for (const file of [".env.local", ".env"]) {
    if (wanted.every((k) => out[k])) break;
    const filePath = path.join(ROOT, file);
    if (!existsSync(filePath)) continue;
    const text = await readFile(filePath, "utf8");
    for (const line of text.split("\n")) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*("?)(.*)\2\s*$/);
      if (match && wanted.includes(match[1]) && !out[match[1]]) {
        out[match[1]] = match[3];
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

const POST_COLUMNS =
  "id,author_id,slug,title,subtitle,excerpt,content,content_html,cover_image_url," +
  "seo_title,seo_description,tags,locale,status,published_at,reading_time_minutes," +
  "word_count,created_at,updated_at,author:blog_authors(id,display_name,avatar_url,bio)";

/**
 * Project a full post down to the columns the runtime LIST query actually selects.
 *
 * `__BLOG_LIST_DATA__` seeds React Query's ["blog-posts","published","all"] key, whose
 * queryFn selects POST_LIST_COLUMNS -- no `content`, no `content_html`, no `seo_*`. The
 * prerenderer fetched the full rows because it needs `content` to build the FAQPage and
 * `content_html` to render the body. Inlining them into the LIST feed shipped every
 * article's entire HTML into /blog/index.html and into EVERY tag hub, N x M.
 */
function toListPost(post) {
  const { content, content_html, seo_title, seo_description, ...rest } = post;
  void content;
  void content_html;
  void seo_title;
  void seo_description;
  return rest;
}

async function fetchPublishedPosts(env) {
  const base = env.VITE_SUPABASE_URL?.replace(/\/$/, "");
  const key = env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!base || !key) {
    throw new Error("VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY are not set");
  }
  const url =
    `${base}/rest/v1/blog_posts?select=${encodeURIComponent(POST_COLUMNS)}` +
    `&status=eq.published&order=published_at.desc`;
  const response = await fetch(url, {
    headers: { apikey: key, authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    throw new Error(`PostgREST ${response.status}: ${(await response.text()).slice(0, 300)}`);
  }
  return await response.json();
}

// ---------------------------------------------------------------------------
// Template handling
// ---------------------------------------------------------------------------

/** CSS chunks carrying the landing/blog design system (code-split away from
 * the entry CSS, so prerendered pages must link them explicitly). */
async function findBlogCssAssets() {
  const assetsDir = path.join(DIST, "assets");
  const result = [];
  for (const file of await readdir(assetsDir)) {
    if (!file.endsWith(".css")) continue;
    const text = await readFile(path.join(assetsDir, file), "utf8");
    if (text.includes(".rv-landing") || text.includes(".rv-article")) {
      result.push(`/assets/${file}`);
    }
  }
  return result;
}

function buildHeadTags(page) {
  const tags = [];
  if (page.canonicalPath) {
    const canonical = `${SITE_ORIGIN}${page.canonicalPath}`;
    tags.push(`<link rel="canonical" href="${escapeHtml(canonical)}" />`);
    tags.push(`<meta property="og:url" content="${escapeHtml(canonical)}" />`);
  }
  tags.push(`<meta property="og:site_name" content="${escapeHtml(SITE_NAME)}" />`);
  // Thin tag hubs are served but must not be indexed. Mirrors useDocumentHead's
  // `robots` option, so the static snapshot and the hydrated page agree.
  if (page.robots) {
    tags.push(`<meta name="robots" content="${escapeHtml(page.robots)}" />`);
  }
  if (page.article) {
    if (page.article.publishedTime) {
      tags.push(`<meta property="article:published_time" content="${escapeHtml(page.article.publishedTime)}" />`);
    }
    if (page.article.modifiedTime) {
      tags.push(`<meta property="article:modified_time" content="${escapeHtml(page.article.modifiedTime)}" />`);
    }
    for (const tag of page.article.tags ?? []) {
      tags.push(`<meta property="article:tag" content="${escapeHtml(tag)}" />`);
    }
  }
  if (page.jsonLd) {
    tags.push(`<script type="application/ld+json" id="rv-jsonld">${jsonForScriptTag(page.jsonLd)}</script>`);
  }
  for (const href of page.cssAssets ?? []) {
    tags.push(`<link rel="stylesheet" href="${escapeHtml(href)}" />`);
  }
  return tags.join("\n    ");
}

/** Render a page from the app-shell template: swap title/description/OG,
 * append head extras, inject #root markup + inlined data script. */
function renderPage(template, page) {
  let html = template;

  // Use FUNCTION replacements everywhere below. The replacement values interpolate
  // author-controlled content (titles, descriptions, and page.rootHtml, the whole
  // rendered article body). String.prototype.replace interprets `$&`, `` $` ``,
  // `$'`, `$$` and `$n` in a replacement STRING, so a `$` sequence in a title or
  // post body would splice app-shell template fragments into the output. A function
  // replacement returns its value literally, disabling that interpretation.
  html = html.replace(/<title>[\s\S]*?<\/title>/, () => `<title>${escapeHtml(page.title)}</title>`);
  html = html.replace(
    /<meta name="description"[^>]*\/>/,
    () => `<meta name="description" content="${escapeHtml(page.description)}" />`,
  );
  html = html.replace(
    /<meta property="og:title"[^>]*\/>/,
    () => `<meta property="og:title" content="${escapeHtml(page.title)}" />`,
  );
  html = html.replace(
    /<meta property="og:description"[^>]*\/>/,
    () => `<meta property="og:description" content="${escapeHtml(page.description)}" />`,
  );
  html = html.replace(
    /<meta property="og:type"[^>]*\/>/,
    () => `<meta property="og:type" content="${page.ogType ?? "website"}" />`,
  );
  if (page.ogImage) {
    html = html.replace(
      /<meta property="og:image"[^>]*\/>/,
      () => `<meta property="og:image" content="${escapeHtml(page.ogImage)}" />`,
    );
    html = html.replace(
      /<meta name="twitter:card"[^>]*\/>/,
      () => `<meta name="twitter:card" content="summary_large_image" />`,
    );
  }
  html = html.replace(
    /<meta name="twitter:title"[^>]*\/>/,
    () => `<meta name="twitter:title" content="${escapeHtml(page.title)}" />`,
  );

  html = html.replace("</head>", () => `    ${buildHeadTags(page)}\n  </head>`);

  const dataScript = page.inlineData
    ? `<script type="application/json" id="${page.inlineData.id}">${jsonForScriptTag(page.inlineData.value)}</script>\n    `
    : "";
  html = html.replace(
    /<div id="root"><\/div>/,
    () => `<div id="root">${page.rootHtml}</div>\n    ${dataScript}`,
  );

  return html;
}

/**
 * Drop any canonical/og:url already present in the app shell.
 *
 * dist/index.html is BOTH a page we stamp a canonical into and the template
 * every blog page is rendered from. Running `npm run prerender` twice without a
 * fresh `vite build` would otherwise feed a stamped shell back in as the
 * template, and buildHeadTags would append a second canonical to every article —
 * two canonicals make a crawler ignore both. Normalizing on read makes the whole
 * script idempotent.
 */
function stripCanonicalTags(html) {
  return html
    .replace(/[ \t]*<link rel="canonical"[^>]*>\n?/g, "")
    .replace(/[ \t]*<meta property="og:url"[^>]*>\n?/g, "");
}

/**
 * App shell for a route that has no prerendered body: same markup as the SPA
 * fallback, plus the self-canonical that tells a non-JS crawler which host and
 * path own this document. Function replacement, per the note in renderPage.
 *
 * Canonical ONLY, deliberately no og:url. dist/index.html is Caddy's catch-all,
 * so an og:url there would be served for /share/estimate/<id>, /invite/accept/
 * <token> and /promo/redeem too, and the platforms that treat og:url as the
 * object's permanent id would point every shared preview card at the marketing
 * home page instead of the thing that was shared. canonical does not have that
 * failure mode (search engines consolidating those URLs onto "/" is wanted), and
 * a scraper with no og:url just uses the URL it fetched, which is already right.
 * Blog pages still get og:url from buildHeadTags: those are real 1:1 documents.
 */
function renderCanonicalShell(template, routePath) {
  const canonical = `${SITE_ORIGIN}${routePath}`;
  return template.replace(
    "</head>",
    () => `    <link rel="canonical" href="${escapeHtml(canonical)}" />\n  </head>`,
  );
}

// ---------------------------------------------------------------------------
// Markup builders (mirror the React components' classes so the linked CSS
// chunks style the static HTML identically)
// ---------------------------------------------------------------------------

function postCardHtml(post) {
  const meta = [formatDateRu(post.published_at), readingTimeLabel(post.reading_time_minutes)]
    .filter(Boolean)
    .join(" · ");
  const cover = post.cover_image_url
    ? `<img class="rv-blog-card__cover" src="${escapeHtml(post.cover_image_url)}" alt="${escapeHtml(post.title)}" loading="lazy" />`
    : `<div class="rv-blog-card__cover--empty" aria-hidden="true">ровно</div>`;
  const excerpt = post.excerpt ?? post.subtitle;
  return `<a class="rv-blog-card" href="/blog/${escapeHtml(post.slug)}/">
    ${cover}
    <div class="rv-blog-card__body">
      ${meta ? `<span class="rv-blog-card__meta">${escapeHtml(meta)}</span>` : ""}
      <h3 class="rv-blog-card__title">${escapeHtml(post.title)}</h3>
      ${excerpt ? `<p class="rv-blog-card__excerpt">${escapeHtml(excerpt)}</p>` : ""}
    </div>
  </a>`;
}

function pageChromeStart() {
  return `<div class="rv-landing"><header style="padding:24px 48px;border-bottom:1px solid var(--line-blue-soft)"><a href="/" style="display:inline-flex"><img src="/logo.svg" alt="ровно" style="height:52px;width:auto" /></a></header>`;
}

function pageChromeEnd() {
  return `<footer style="padding:48px;background:var(--rv-ink);color:var(--rv-cream);font-family:var(--font-body);font-size:13px"><a href="/" style="color:var(--rv-cream)">rovno.ai</a> — ИИ-супервайзер стройки</footer></div>`;
}

function blogIndexHtml(posts) {
  return `${pageChromeStart()}
  <main>
    <section class="rv-section" style="padding:64px 48px 48px">
      <span class="rv-caption" style="font-size:12px;color:var(--rv-blue)">БЛОГ</span>
      <h1 style="font-family:var(--font-display);font-size:64px;line-height:1;letter-spacing:-0.03em;color:var(--rv-blue);margin:16px 0 0">Разбираем, как строить ровно</h1>
      <p style="font-family:var(--font-body);font-size:18px;line-height:26px;color:var(--rv-blue);opacity:.8;max-width:560px">${escapeHtml(BLOG_DESCRIPTION)}</p>
    </section>
    <section class="rv-section" style="padding:0 48px 128px">
      <div class="rv-blog-grid" style="display:grid;grid-template-columns:repeat(3,1fr);gap:24px">
        ${posts.map(postCardHtml).join("\n        ")}
      </div>
    </section>
  </main>
  ${pageChromeEnd()}`;
}

// Mirrors articleBreadcrumbTrail() in src/lib/blog/jsonld.ts. The visible trail and
// the BreadcrumbList markup must name the same things, or Google distrusts the markup.
function breadcrumbTrail(post) {
  return [
    { name: "Главная", path: "/" },
    { name: BLOG_TITLE, path: "/blog/" },
    { name: post.title, path: `/blog/${post.slug}/` },
  ];
}

function breadcrumbsHtml(post) {
  const trail = breadcrumbTrail(post);
  const items = trail
    .map((entry, i) =>
      i === trail.length - 1
        ? `<li><span aria-current="page">${escapeHtml(entry.name)}</span></li>`
        : `<li><a href="${escapeHtml(entry.path)}">${escapeHtml(entry.name)}</a></li>`,
    )
    .join("");
  return `<nav class="rv-breadcrumbs" aria-label="Навигация по разделам"><ol>${items}</ol></nav>`;
}

// Mirrors <AuthorBio> in src/pages/blog/BlogPostPage.tsx. Nothing renders without a bio.
function authorBioHtml(post) {
  const author = post.author;
  if (!author?.bio) return "";
  const avatar = author.avatar_url
    ? `<img src="${escapeHtml(author.avatar_url)}" alt="" width="56" height="56" loading="lazy" decoding="async" />`
    : `<span class="rv-author-bio__initial" aria-hidden="true">${escapeHtml(author.display_name.slice(0, 1).toUpperCase())}</span>`;
  return (
    `<aside class="rv-author-bio">${avatar}<div>` +
    `<p class="rv-author-bio__label">Об авторе</p>` +
    `<p class="rv-author-bio__name">${escapeHtml(author.display_name)}</p>` +
    `<p class="rv-author-bio__text">${escapeHtml(author.bio)}</p>` +
    `</div></aside>`
  );
}

// Mirrors the meta line in BlogPostPage: tags are LINKS to their cluster hub, so a
// crawler reading the static snapshot can walk article -> hub -> sibling articles.
function tagLinksHtml(tags) {
  return (tags ?? [])
    .map((t) =>
      tagSlug(t)
        ? `<a href="/blog/tag/${escapeHtml(tagSlug(t))}/" class="rv-tag-link">#${escapeHtml(t)}</a>`
        : `<span class="rv-tag-link">#${escapeHtml(t)}</span>`,
    )
    .join("");
}

function articleHtml(post) {
  const meta = [formatDateRu(post.published_at), readingTimeLabel(post.reading_time_minutes)]
    .filter(Boolean)
    .join(" · ");
  return `${pageChromeStart()}
  <main>
    <article>
      <section class="rv-section" style="padding:64px 48px 0">
        ${breadcrumbsHtml(post)}
        <header class="rv-article-header">
          <span class="rv-caption" style="font-size:12px;color:var(--rv-blue)">${escapeHtml(meta)}${tagLinksHtml(post.tags)}</span>
          <h1 class="rv-article-title">${escapeHtml(post.title)}</h1>
          ${post.subtitle ? `<p class="rv-article-subtitle">${escapeHtml(post.subtitle)}</p>` : ""}
          ${post.author ? `<p style="font-family:var(--font-body);font-size:14px;color:var(--rv-blue)">${escapeHtml(post.author.display_name)}</p>` : ""}
        </header>
        ${post.cover_image_url ? `<div class="rv-article-cover"><img src="${escapeHtml(post.cover_image_url)}" alt="${escapeHtml(post.title)}" /></div>` : ""}
      </section>
      <section class="rv-section" style="padding:48px 48px 96px">
        <div class="rv-article">${renderArticleBody(post.content_html)}</div>
        ${authorBioHtml(post)}
      </section>
    </article>
    <nav class="rv-section" style="padding:0 48px 96px;font-family:var(--font-body)">
      <a href="/blog/" style="color:var(--rv-blue)">← Все статьи</a>
    </nav>
  </main>
  ${pageChromeEnd()}`;
}

// ---------------------------------------------------------------------------
// JSON-LD (mirrors src/lib/blog/jsonld.ts)
// ---------------------------------------------------------------------------

const PUBLISHER = {
  "@type": "Organization",
  name: SITE_NAME,
  url: SITE_ORIGIN,
  logo: { "@type": "ImageObject", url: `${SITE_ORIGIN}/rovno-logo.png` },
};

function articleJsonLd(post) {
  const url = `${SITE_ORIGIN}/blog/${post.slug}/`;
  const article = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: post.title,
    description: post.seo_description ?? post.excerpt ?? undefined,
    url,
    mainEntityOfPage: { "@type": "WebPage", "@id": url },
    inLanguage: post.locale === "en" ? "en" : "ru-RU",
    datePublished: post.published_at ?? undefined,
    dateModified: post.updated_at,
    publisher: PUBLISHER,
  };
  if (post.cover_image_url) article.image = [post.cover_image_url];
  if (post.author) {
    // Mirrors authorPersonJsonLd() in src/lib/blog/jsonld.ts.
    const person = { "@type": "Person", name: post.author.display_name };
    if (post.author.bio) person.description = post.author.bio;
    if (post.author.avatar_url) person.image = post.author.avatar_url;
    article.author = person;
  }
  if (post.word_count) article.wordCount = post.word_count;
  if (post.tags?.length) article.keywords = post.tags.join(", ");
  const breadcrumbs = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: breadcrumbTrail(post).map((entry, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: entry.name,
      item: entry.path === "/" ? SITE_ORIGIN : `${SITE_ORIGIN}${entry.path}`,
    })),
  };
  // Mirrors src/lib/blog/jsonld.ts — the static snapshot and the hydrated page
  // must declare the SAME structured data. Read from the TipTap doc, not the HTML.
  const faq = faqJsonLdFromDoc(post.content);
  return faq ? [article, breadcrumbs, faq] : [article, breadcrumbs];
}

function tagBreadcrumbTrail(tagName, slug) {
  return [
    { name: "Главная", path: "/" },
    { name: BLOG_TITLE, path: "/blog/" },
    { name: `#${tagName}`, path: `/blog/tag/${slug}/` },
  ];
}

/** Mirrors tagPageJsonLd() in src/lib/blog/jsonld.ts. */
function tagPageJsonLd(tagName, slug, posts) {
  const url = `${SITE_ORIGIN}/blog/tag/${slug}/`;
  const collection = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: `#${tagName}`,
    url,
    inLanguage: "ru-RU",
    publisher: PUBLISHER,
    mainEntity: {
      "@type": "ItemList",
      numberOfItems: posts.length,
      itemListElement: posts.map((post, index) => ({
        "@type": "ListItem",
        position: index + 1,
        url: `${SITE_ORIGIN}/blog/${post.slug}/`,
        name: post.title,
      })),
    },
  };
  const breadcrumbs = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: tagBreadcrumbTrail(tagName, slug).map((entry, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: entry.name,
      item: entry.path === "/" ? SITE_ORIGIN : `${SITE_ORIGIN}${entry.path}`,
    })),
  };
  return [collection, breadcrumbs];
}

function tagPageHtml(tagName, slug, posts) {
  const trail = tagBreadcrumbTrail(tagName, slug);
  const crumbs = trail
    .map((e, i) =>
      i === trail.length - 1
        ? `<li><span aria-current="page">${escapeHtml(e.name)}</span></li>`
        : `<li><a href="${escapeHtml(e.path)}">${escapeHtml(e.name)}</a></li>`,
    )
    .join("");
  return `${pageChromeStart()}
  <main>
    <section class="rv-section" style="padding:64px 48px 40px">
      <nav class="rv-breadcrumbs" aria-label="Навигация по разделам"><ol>${crumbs}</ol></nav>
      <span class="rv-caption" style="font-size:12px;color:var(--rv-blue)">ТЕМА</span>
      <h1 style="font-family:var(--font-display);font-size:56px;line-height:1;letter-spacing:-0.03em;color:var(--rv-blue);margin:16px 0 0">#${escapeHtml(tagName)}</h1>
      <p style="font-family:var(--font-body);font-size:18px;color:var(--rv-blue);opacity:.8;margin-top:12px">${posts.length} ${pluralizeRu(posts.length, ["статья", "статьи", "статей"])} по этой теме</p>
    </section>
    <section class="rv-section" style="padding:0 48px 128px">
      <div class="rv-blog-grid" style="display:grid;grid-template-columns:repeat(3,1fr);gap:24px">
        ${posts.map(postCardHtml).join("\n        ")}
      </div>
    </section>
  </main>
  ${pageChromeEnd()}`;
}

function blogIndexJsonLd(posts) {
  return {
    "@context": "https://schema.org",
    "@type": "Blog",
    name: BLOG_TITLE,
    url: `${SITE_ORIGIN}/blog/`,
    inLanguage: "ru-RU",
    publisher: PUBLISHER,
    blogPost: posts.map((post) => ({
      "@type": "BlogPosting",
      headline: post.title,
      url: `${SITE_ORIGIN}/blog/${post.slug}/`,
      datePublished: post.published_at ?? undefined,
    })),
  };
}

// ---------------------------------------------------------------------------
// Feeds / sitemap / llms.txt
// ---------------------------------------------------------------------------

function sitemapXml(posts) {
  const today = new Date().toISOString().slice(0, 10);
  const urls = [];
  for (const route of STATIC_ROUTES) {
    urls.push(`  <url><loc>${escapeXml(SITE_ORIGIN + route)}</loc><lastmod>${today}</lastmod></url>`);
  }
  for (const post of posts) {
    const lastmod = (post.updated_at ?? post.published_at ?? "").slice(0, 10) || today;
    urls.push(
      `  <url><loc>${escapeXml(`${SITE_ORIGIN}/blog/${post.slug}/`)}</loc><lastmod>${lastmod}</lastmod></url>`,
    );
  }
  // Tag hubs enter the sitemap only once they have real depth. A one-post tag page
  // competes with the article it links to; listing it is asking for index bloat.
  //
  // Gate on the SAME quantity the page itself uses (distinct posts at that slug).
  // Anything else and the sitemap advertises a URL this very build stamped
  // `noindex` — Search Console calls that "Submitted URL marked 'noindex'".
  for (const hub of collectTagHubs(posts)) {
    if (!isIndexableTag(postsForTagSlug(posts, hub.slug).length)) continue;
    urls.push(`  <url><loc>${escapeXml(`${SITE_ORIGIN}/blog/tag/${hub.slug}/`)}</loc><lastmod>${today}</lastmod></url>`);
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join("\n")}
</urlset>
`;
}

function rssXml(posts) {
  const items = posts
    .map((post) => {
      const url = `${SITE_ORIGIN}/blog/${post.slug}/`;
      const pubDate = post.published_at ? new Date(post.published_at).toUTCString() : "";
      return `    <item>
      <title>${escapeXml(post.title)}</title>
      <link>${escapeXml(url)}</link>
      <guid isPermaLink="true">${escapeXml(url)}</guid>
      ${pubDate ? `<pubDate>${pubDate}</pubDate>` : ""}
      ${post.excerpt ? `<description>${escapeXml(post.excerpt)}</description>` : ""}
      <content:encoded><![CDATA[${sanitizeArticleBody(post.content_html).replaceAll("]]>", "]]]]><![CDATA[>")}]]></content:encoded>
    </item>`;
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(BLOG_TITLE)}</title>
    <link>${SITE_ORIGIN}/blog/</link>
    <atom:link href="${SITE_ORIGIN}/blog/feed.xml" rel="self" type="application/rss+xml" />
    <description>${escapeXml(BLOG_DESCRIPTION)}</description>
    <language>ru</language>
${items}
  </channel>
</rss>
`;
}

function llmsTxt(posts) {
  const lines = [
    `# ${SITE_NAME} (rovno.ai)`,
    "",
    "> Ровно — ИИ-супервайзер стройки: рабочее пространство, где смета, задачи,",
    "> закупки, фотофиксация и документы собраны в одном месте. Для заказчиков,",
    "> подрядчиков и строительных компаний в России.",
    "",
    "## Продукт",
    `- [Главная](${SITE_ORIGIN}/): что делает Ровно`,
    `- [Тарифы](${SITE_ORIGIN}/#pricing): Бесплатно / Мастер / Бригада`,
    "",
    "## Блог — статьи о стройке",
    `- [Все статьи](${SITE_ORIGIN}/blog/)`,
    `- [RSS](${SITE_ORIGIN}/blog/feed.xml)`,
  ];
  for (const post of posts) {
    const desc = (post.seo_description ?? post.excerpt ?? "").replace(/\s+/g, " ").trim();
    lines.push(`- [${post.title}](${SITE_ORIGIN}/blog/${post.slug}/)${desc ? `: ${desc}` : ""}`);
  }
  lines.push("", "## Контакты", `- Email: vlad@rovno.ai`, `- Telegram: https://t.me/stroyrovno`, "");
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const templatePath = path.join(DIST, "index.html");
  if (!existsSync(templatePath)) {
    console.error("[prerender-blog] dist/index.html not found — run `vite build` first.");
    process.exit(1);
  }
  const template = stripCanonicalTags(await readFile(templatePath, "utf8"));

  let posts = [];
  let dataOk = false;
  try {
    const env = await loadEnvFallback();
    posts = await fetchPublishedPosts(env);
    dataOk = true;
    log(`fetched ${posts.length} published post(s)`);
  } catch (error) {
    log(`WARN: blog fetch failed — emitting static-only artifacts (${error.message})`);
  }

  // sitemap.xml is always written (static routes at minimum).
  await writeFile(path.join(DIST, "sitemap.xml"), sitemapXml(posts), "utf8");
  log("wrote sitemap.xml");

  await writeFile(path.join(DIST, "llms.txt"), llmsTxt(posts), "utf8");
  log("wrote llms.txt");

  // Legal shells are 1:1 files: each answers exactly one URL and nothing else, so
  // an unreachable Supabase must not be what leaves them uncanonicalized. Safe
  // above the gate for the same reason the landing shell is not.
  for (const routePath of LEGAL_SHELL_ROUTES) {
    const dir = path.join(DIST, ...routePath.split("/").filter(Boolean));
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "index.html"), renderCanonicalShell(template, routePath), "utf8");
  }
  log(`wrote ${LEGAL_SHELL_ROUTES.length} legal shell page(s)`);

  if (!dataOk) return;

  const cssAssets = await findBlogCssAssets();
  log(`blog css chunks: ${cssAssets.join(", ") || "none found"}`);

  // Blog index
  const indexHtml = renderPage(template, {
    title: `${BLOG_TITLE} — стройка без хаоса`,
    description: BLOG_DESCRIPTION,
    canonicalPath: "/blog/",
    ogType: "website",
    jsonLd: posts.length > 0 ? blogIndexJsonLd(posts) : null,
    cssAssets,
    rootHtml: blogIndexHtml(posts),
    inlineData: { id: "__BLOG_LIST_DATA__", value: posts.map(toListPost) },
  });
  await mkdir(path.join(DIST, "blog"), { recursive: true });
  await writeFile(path.join(DIST, "blog", "index.html"), indexHtml, "utf8");
  log("wrote blog/index.html");

  // Articles
  for (const post of posts) {
    const pageHtml = renderPage(template, {
      title: `${post.seo_title ?? post.title} — ${BLOG_TITLE}`,
      description: post.seo_description ?? post.excerpt ?? BLOG_DESCRIPTION,
      canonicalPath: `/blog/${post.slug}/`,
      ogType: "article",
      ogImage: post.cover_image_url,
      article: {
        publishedTime: post.published_at,
        modifiedTime: post.updated_at,
        tags: post.tags ?? [],
      },
      jsonLd: articleJsonLd(post),
      cssAssets,
      rootHtml: articleHtml(post),
      inlineData: { id: "__BLOG_POST_DATA__", value: post },
    });
    const dir = path.join(DIST, "blog", post.slug);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "index.html"), pageHtml, "utf8");
  }
  log(`wrote ${posts.length} article page(s)`);

  // Tag hubs. Every tag gets a page (an inbound link must never 404); only the
  // ones with real depth are indexable — the rest carry noindex,follow so the
  // crawler still walks through to the articles.
  const hubs = collectTagHubs(posts);
  let indexableHubs = 0;
  for (const hub of hubs) {
    const hubPosts = postsForTagSlug(posts, hub.slug);
    const names = tagNamesForSlug(posts, hub.slug);
    const name = names[0] ?? hub.slug;
    const indexable = isIndexableTag(hubPosts.length);
    if (indexable) indexableHubs += 1;
    const pageHtml = renderPage(template, {
      title: `#${name} — ${BLOG_TITLE}`,
      description: `Статьи Ровно по теме «${name}»: ${hubPosts.length} ${pluralizeRu(hubPosts.length, ["материал", "материала", "материалов"])}.`,
      canonicalPath: `/blog/tag/${hub.slug}/`,
      ogType: "website",
      robots: indexable ? undefined : "noindex, follow",
      jsonLd: indexable ? tagPageJsonLd(name, hub.slug, hubPosts) : null,
      cssAssets,
      rootHtml: tagPageHtml(name, hub.slug, hubPosts),
      // The FULL published list, not just this hub's posts. __BLOG_LIST_DATA__ is
      // React Query initialData for the global ["blog-posts","published","all"]
      // key; seeding it with a filtered subset would poison /blog/ for the rest
      // of the session. BlogTagPage narrows it client-side.
      inlineData: { id: "__BLOG_LIST_DATA__", value: posts.map(toListPost) },
    });
    const dir = path.join(DIST, "blog", "tag", hub.slug);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "index.html"), pageHtml, "utf8");
  }
  log(`wrote ${hubs.length} tag hub(s), ${indexableHubs} indexable`);

  await writeFile(path.join(DIST, "blog", "feed.xml"), rssXml(posts), "utf8");
  log("wrote blog/feed.xml");

  // Landing shell LAST, and only on a build that actually wrote article files.
  //
  // dist/index.html is Caddy's SPA fallback, so whatever canonical it carries is
  // inherited by every URL with no file of its own — including every article URL
  // search engines have already indexed, on any build that did not write that
  // article. Stamping the landing canonical then hands each of those URLs an
  // explicit "duplicate of /" verdict, which deindexes the blog outright instead
  // of merely thinning it, and consolidation is far stickier to undo than missing
  // content. `vite build` empties dist before this runs, so the previous deploy's
  // files are never there to cover.
  //
  // TWO inputs reach that state and `dataOk` only excludes the first: a fetch that
  // THREW (returns above), and a fetch that SUCCEEDED WITH AN EMPTY LIST — an RLS
  // change on blog_posts, a rotated publishable key, or a build pointed at the
  // wrong Supabase project all produce a perfectly healthy `200 []`. Gate on the
  // artifacts actually written, not on how the fetch went.
  //
  // Rendered from the pristine in-memory `template`, after every page that reads
  // it, so no page can end up with two canonicals.
  //
  // RESIDUAL: an article published AFTER this build is served by the fallback
  // until the next deploy, and so reports "/" as its canonical for that window.
  // Content-wise it is an empty shell to a non-JS crawler either way; the article
  // gets its own canonical the moment a deploy renders it. Closing it properly
  // means rebuilding on publish (blog-rebuild-frontend, dormant on prod today).
  if (posts.length > 0) {
    await writeFile(path.join(DIST, "index.html"), renderCanonicalShell(template, "/"), "utf8");
    log("wrote landing canonical shell");
  } else {
    log("skipped landing canonical shell — no article files were written");
  }
}

await main();
