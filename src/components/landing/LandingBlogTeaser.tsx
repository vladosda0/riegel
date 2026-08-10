// Landing "Блог" section — three freshest published posts.
//
// Sits right after FinalCTA («Стройка, которая идёт ровно»). Renders nothing
// until posts exist (and nothing on fetch errors), so the landing stays
// intact for a brand-new environment with an empty blog.

import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { usePublishedBlogPosts } from "@/hooks/use-blog";
import { BlogPostCard } from "@/components/blog/BlogPostCard";
import "@/components/blog/blog.css";

export function BlogTeaser() {
  const { t } = useTranslation();
  const { data: posts } = usePublishedBlogPosts(3);
  if (!posts || posts.length === 0) return null;

  return (
    <section id="blog" className="rv-section blue" style={{ padding: "96px 48px" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 48 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 24, flexWrap: "wrap" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <span className="rv-caption" style={{ fontSize: 12, letterSpacing: ".02em" }}>{t("landing.blog.eyebrow")}</span>
            <h2 style={{ fontFamily: "var(--font-display)", fontSize: 48, lineHeight: 1, letterSpacing: "-0.03em", margin: 0 }}>
              {t("landing.blog.title")}
            </h2>
          </div>
          <Link className="rv-btn rv-btn--secondary" to="/blog/">
            {t("landing.blog.allPosts")}
          </Link>
        </div>
        <div className="rv-cols rv-cols-3 rv-blog-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 24 }}>
          {posts.map((post) => (
            <BlogPostCard key={post.id} post={post} />
          ))}
        </div>
      </div>
    </section>
  );
}
