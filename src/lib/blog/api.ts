// Supabase access for the blog feature.
//
// Uses the untyped client until the backend-truth sync PR adds blog tables
// to the generated Database type (same pattern as subscriptions/billing).
// RLS drives visibility: anon/regular users receive published rows only;
// registered blog authors (public.blog_authors) also receive drafts and hold
// the write surface. See rovno-db 20260706120000_blog_schema.sql.

import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { isImage, optimizeImageForUpload } from "@/lib/image-optimization";
import { uploadFileToBucket } from "@/data/org-source";
import type {
  BlogAuthor,
  BlogPost,
  BlogPostInsert,
  BlogPostPatch,
  BlogPostWithAuthor,
} from "./types";

const rawSupabase = supabase as unknown as SupabaseClient;

export const BLOG_IMAGES_BUCKET = "blog-images";

const AUTHOR_EMBED = "author:blog_authors(id, display_name, avatar_url, bio)";

const POST_LIST_COLUMNS =
  `id, author_id, slug, title, subtitle, excerpt, cover_image_url, tags, locale, status, published_at, reading_time_minutes, word_count, created_at, updated_at, ${AUTHOR_EMBED}`;

const POST_FULL_COLUMNS =
  `id, author_id, slug, title, subtitle, excerpt, content, content_html, cover_image_url, seo_title, seo_description, tags, locale, status, published_at, reading_time_minutes, word_count, created_at, updated_at, ${AUTHOR_EMBED}`;

/** Published posts for the public list / landing teaser (newest first).
 * List projection: no content/content_html on the wire. */
export async function fetchPublishedPosts(limit?: number): Promise<BlogPostWithAuthor[]> {
  let query = rawSupabase
    .from("blog_posts")
    .select(POST_LIST_COLUMNS)
    .eq("status", "published")
    .order("published_at", { ascending: false });
  if (limit) query = query.limit(limit);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as unknown as BlogPostWithAuthor[];
}

/** One post by slug. RLS decides draft visibility: for a blog author this
 * returns their draft (used by the editor's preview), for everyone else
 * drafts read as "not found". */
export async function fetchPostBySlug(slug: string): Promise<BlogPostWithAuthor | null> {
  const { data, error } = await rawSupabase
    .from("blog_posts")
    .select(POST_FULL_COLUMNS)
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as unknown as BlogPostWithAuthor | null;
}

export async function fetchPostById(id: string): Promise<BlogPostWithAuthor | null> {
  const { data, error } = await rawSupabase
    .from("blog_posts")
    .select(POST_FULL_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as unknown as BlogPostWithAuthor | null;
}

/** Admin list: RLS already scopes drafts to authors; order by freshest edit. */
export async function fetchAllPostsForAdmin(): Promise<BlogPostWithAuthor[]> {
  const { data, error } = await rawSupabase
    .from("blog_posts")
    .select(POST_LIST_COLUMNS)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as BlogPostWithAuthor[];
}

/** The caller's blog_authors row, or null when they are not an author. */
export async function fetchMyBlogAuthor(profileId: string): Promise<BlogAuthor | null> {
  const { data, error } = await rawSupabase
    .from("blog_authors")
    .select("id, profile_id, display_name, bio, avatar_url, created_at, updated_at")
    .eq("profile_id", profileId)
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as BlogAuthor | null;
}

export async function createBlogPost(input: BlogPostInsert): Promise<BlogPost> {
  const { data, error } = await rawSupabase
    .from("blog_posts")
    .insert(input)
    .select()
    .single();
  if (error) throw error;
  return data as BlogPost;
}

export async function updateBlogPost(id: string, patch: BlogPostPatch): Promise<BlogPost> {
  const { data, error } = await rawSupabase
    .from("blog_posts")
    .update(patch)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data as BlogPost;
}

/** Deletes the post and returns the rows the server actually removed, so the
 * caller can tell from server truth (not from a cached list row) whether it had
 * ever been published and therefore left static artefacts behind. Empty when the
 * DELETE affected no rows: the post was already gone, or RLS refused the delete.
 * PostgREST answers that case 200/no-rows, not an error, so an empty list is a
 * normal result and not a failure the caller can distinguish from a race. */
export async function deleteBlogPost(id: string): Promise<DeletedBlogPost[]> {
  const { data, error } = await rawSupabase
    .from("blog_posts")
    .delete()
    .eq("id", id)
    .select("published_at");
  if (error) throw error;
  return (data ?? []) as DeletedBlogPost[];
}

export interface DeletedBlogPost {
  published_at: string | null;
}

export type RebuildResult =
  | { ok: true }
  | { ok: false; notConfigured: boolean; inProgress: boolean; message: string };

/** Ask the blog-rebuild-frontend edge function to kick a Timeweb rebuild so
 * the static blog pages / sitemap / RSS regenerate with current content.
 * Author-only (the function re-checks blog_authors server-side).
 *
 * Two non-failures the caller must NOT surface as errors:
 *  - 501 → the webhook secrets are not set on this environment;
 *  - 409 `rebuild_in_progress` → a build is already running. That is the routine
 *    answer while a previous publish's build is still going (minutes), and the
 *    function refuses to queue a second one because it could redeploy an older
 *    commit over a newer in-flight one.
 *
 * The function's `error` strings are English and meant for logs; the UI keys off
 * `code`/`notConfigured` and writes its own Russian copy. */
export async function triggerFrontendRebuild(): Promise<RebuildResult> {
  const { error } = await rawSupabase.functions.invoke("blog-rebuild-frontend", {
    body: {},
  });
  if (!error) return { ok: true };

  let status: number | null = null;
  let code: string | null = null;
  let message = error.message ?? "Unknown error";
  const context = (error as { context?: Response }).context;
  if (context && typeof context.status === "number") {
    status = context.status;
    try {
      const body = (await context.json()) as { error?: string; code?: string };
      if (body?.error) message = body.error;
      if (body?.code) code = body.code;
    } catch {
      // non-JSON body — keep the generic message
    }
  }
  return {
    ok: false,
    notConfigured: status === 501,
    // DEPLOY ORDER: `code` is only sent by blog-rebuild-frontend from rovno-db#75 on.
    // Until that function is deployed to this environment, a rebuild failure lands in
    // the generic destructive toast — correct, if less specific.
    //
    // Not relaxable to a bare `status === 409`: the endpoint answers 409 for BOTH
    // `rebuild_in_progress` (harmless, retry in a minute) and `no_live_commit` (the app
    // has no successful deploy, or its history cannot be ordered — a human must look).
    // Telling an author "a deploy is already running" for the latter is a lie that
    // makes them wait for something that will never arrive.
    inProgress: status === 409 && code === "rebuild_in_progress",
    message,
  };
}

export interface BlogImageUploadResult {
  url: string;
  path: string;
  /** Intrinsic size of the stored JPEG; null when the browser can't decode it. */
  width: number | null;
  height: number | null;
}

/** Intrinsic pixel size of an encoded image, or null if it can't be decoded.
 * Used to stamp width/height on article <img>s so the browser reserves the
 * box before the photo arrives (Cumulative Layout Shift). */
async function readImageDimensions(file: Blob): Promise<{ width: number; height: number } | null> {
  if (typeof createImageBitmap !== "function") return null;
  try {
    const bitmap = await createImageBitmap(file);
    const { width, height } = bitmap;
    bitmap.close();
    return width > 0 && height > 0 ? { width, height } : null;
  } catch {
    return null; // never fail an upload over a missing layout hint
  }
}

/** Upload an article image (cover or inline figure) to the public
 * blog-images bucket. Re-encoded to JPEG (EXIF/GPS stripped — the bucket is
 * world-readable), stored under the uploader's uid prefix to satisfy the
 * bucket RLS, rendered via getPublicUrl. */
export async function uploadBlogImage(file: File): Promise<BlogImageUploadResult> {
  const { data: sessionData } = await supabase.auth.getSession();
  const uid = sessionData.session?.user?.id;
  if (!uid) throw new Error("Not authenticated");
  if (!isImage(file)) throw new Error("Selected file is not an image");

  const { file: optimized } = await optimizeImageForUpload(file, { forceReencode: true });
  const dimensions = await readImageDimensions(optimized);
  const path = `${uid}/${crypto.randomUUID()}.jpg`;
  await uploadFileToBucket(BLOG_IMAGES_BUCKET, path, optimized, { upsert: false });

  const { data } = supabase.storage.from(BLOG_IMAGES_BUCKET).getPublicUrl(path);
  return {
    url: data.publicUrl,
    path,
    width: dimensions?.width ?? null,
    height: dimensions?.height ?? null,
  };
}
