import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const toastMock = vi.fn();
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: toastMock }) }));

vi.mock("@/components/blog/editor/RichTextEditor", () => ({
  RichTextEditor: () => <div data-testid="rich-text-editor" />,
}));

vi.mock("@/lib/blog/api", () => ({
  fetchPublishedPosts: vi.fn(),
  fetchPostBySlug: vi.fn(),
  fetchPostById: vi.fn(),
  fetchAllPostsForAdmin: vi.fn(),
  fetchMyBlogAuthor: vi.fn(),
  createBlogPost: vi.fn(),
  updateBlogPost: vi.fn(),
  deleteBlogPost: vi.fn(),
  triggerFrontendRebuild: vi.fn(),
  uploadBlogImage: vi.fn(),
  BLOG_IMAGES_BUCKET: "blog-images",
}));

import BlogEditorPage from "@/pages/blog/admin/BlogEditorPage";
import {
  deleteBlogPost,
  fetchMyBlogAuthor,
  fetchPostById,
  triggerFrontendRebuild,
  updateBlogPost,
} from "@/lib/blog/api";
import { authenticateRuntimeAuth } from "@/test/runtime-auth";
import type { BlogPostWithAuthor } from "@/lib/blog/types";

const POST = {
  id: "post-1",
  author_id: "author-1",
  slug: "kak-schitat-smetu",
  title: "Как считать смету",
  subtitle: null,
  excerpt: null,
  content: {},
  content_html: "",
  cover_image_url: null,
  seo_title: null,
  seo_description: null,
  tags: [],
  locale: "ru",
  status: "published",
  published_at: "2026-08-01T10:00:00.000Z",
  reading_time_minutes: 3,
  word_count: 400,
  created_at: "2026-08-01T10:00:00.000Z",
  updated_at: "2026-08-02T10:00:00.000Z",
  author: { id: "author-1", display_name: "Влад", avatar_url: null, bio: null },
} as unknown as BlogPostWithAuthor;

function renderEditor() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/blog/admin/post-1"]}>
        <Routes>
          <Route path="/blog/admin/:id" element={<BlogEditorPage />} />
          <Route path="/blog/admin" element={<div>Все статьи</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function confirmDelete() {
  fireEvent.click(await screen.findByTitle("Удалить статью"));
  const dialog = await screen.findByRole("alertdialog");
  fireEvent.click(within(dialog).getByText("Удалить"));
}

describe("BlogEditorPage delete", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authenticateRuntimeAuth();
    (fetchMyBlogAuthor as Mock).mockResolvedValue({ id: "author-1", profile_id: "profile-1" });
    (fetchPostById as Mock).mockResolvedValue(POST);
    (deleteBlogPost as Mock).mockResolvedValue([{ published_at: POST.published_at }]);
    (updateBlogPost as Mock).mockResolvedValue(POST);
    (triggerFrontendRebuild as Mock).mockResolvedValue({ ok: true });
  });

  it("triggers the frontend rebuild so the static page stops being served", async () => {
    renderEditor();
    await confirmDelete();

    await waitFor(() => expect(deleteBlogPost).toHaveBeenCalledWith("post-1"));
    await waitFor(() => expect(triggerFrontendRebuild).toHaveBeenCalledTimes(1));
  });

  it("does not rebuild for a post that was never published", async () => {
    (fetchPostById as Mock).mockResolvedValue({ ...POST, status: "draft", published_at: null });
    (deleteBlogPost as Mock).mockResolvedValue([{ published_at: null }]);
    renderEditor();
    await confirmDelete();

    await waitFor(() => expect(deleteBlogPost).toHaveBeenCalledWith("post-1"));
    // The editor navigates away on success, which is how we know onSuccess ran.
    await waitFor(() => expect(screen.queryByTitle("Удалить статью")).not.toBeInTheDocument());
    expect(triggerFrontendRebuild).not.toHaveBeenCalled();
  });

  it("rebuilds when the loaded form is stale and the deleted row was published", async () => {
    (fetchPostById as Mock).mockResolvedValue({ ...POST, status: "draft", published_at: null });
    (deleteBlogPost as Mock).mockResolvedValue([{ published_at: "2026-08-01T10:00:00.000Z" }]);
    renderEditor();
    await confirmDelete();

    await waitFor(() => expect(triggerFrontendRebuild).toHaveBeenCalledTimes(1));
  });

  it("reports a failed delete instead of staying silent", async () => {
    (deleteBlogPost as Mock).mockRejectedValue(new Error("нет прав"));
    renderEditor();
    await confirmDelete();

    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Не удалось удалить", variant: "destructive" }),
      ),
    );
    expect(triggerFrontendRebuild).not.toHaveBeenCalled();
  });
});

describe("BlogEditorPage unpublish", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authenticateRuntimeAuth();
    (fetchMyBlogAuthor as Mock).mockResolvedValue({ id: "author-1", profile_id: "profile-1" });
    (fetchPostById as Mock).mockResolvedValue(POST);
    (updateBlogPost as Mock).mockResolvedValue(POST);
    (triggerFrontendRebuild as Mock).mockResolvedValue({ ok: true });
  });

  it("reports the started rebuild", async () => {
    renderEditor();
    fireEvent.click(await screen.findByText("Снять с публикации"));

    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith({
        title: "Статья снята с публикации",
        description: "Пересборка запущена.",
      }),
    );
  });

  it("says the page is still in search when the rebuild does not start", async () => {
    (triggerFrontendRebuild as Mock).mockResolvedValue({
      ok: false,
      notConfigured: false,
      inProgress: false,
      message: "Timeweb API error",
    });
    renderEditor();
    fireEvent.click(await screen.findByText("Снять с публикации"));

    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Снята с публикации, но страница ещё в поиске",
          variant: "destructive",
        }),
      ),
    );
  });
});
