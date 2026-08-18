import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const toastMock = vi.fn();
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: toastMock }) }));

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
}));

import BlogAdminList from "@/pages/blog/admin/BlogAdminList";
import {
  deleteBlogPost,
  fetchAllPostsForAdmin,
  fetchMyBlogAuthor,
  triggerFrontendRebuild,
} from "@/lib/blog/api";
import { authenticateRuntimeAuth } from "@/test/runtime-auth";
import type { BlogPostWithAuthor } from "@/lib/blog/types";

const POST = {
  id: "post-1",
  slug: "kak-schitat-smetu",
  title: "Как считать смету",
  status: "published",
  published_at: "2026-08-01T10:00:00.000Z",
  updated_at: "2026-08-02T10:00:00.000Z",
  author: { id: "author-1", display_name: "Влад", avatar_url: null, bio: null },
} as unknown as BlogPostWithAuthor;

function renderList() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/blog/admin"]}>
        <BlogAdminList />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function confirmDelete() {
  fireEvent.click(await screen.findByTitle("Удалить"));
  const dialog = await screen.findByRole("alertdialog");
  fireEvent.click(within(dialog).getByText("Удалить"));
}

describe("BlogAdminList delete", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authenticateRuntimeAuth();
    (fetchMyBlogAuthor as Mock).mockResolvedValue({ id: "author-1", profile_id: "profile-1" });
    (fetchAllPostsForAdmin as Mock).mockResolvedValue([POST]);
    (deleteBlogPost as Mock).mockResolvedValue([{ published_at: POST.published_at }]);
    (triggerFrontendRebuild as Mock).mockResolvedValue({ ok: true });
  });

  it("triggers the frontend rebuild so the static page stops being served", async () => {
    renderList();
    await confirmDelete();

    await waitFor(() => expect(deleteBlogPost).toHaveBeenCalledWith("post-1"));
    await waitFor(() => expect(triggerFrontendRebuild).toHaveBeenCalledTimes(1));
  });

  it("says the page is still live when the rebuild does not start", async () => {
    (triggerFrontendRebuild as Mock).mockResolvedValue({
      ok: false,
      notConfigured: false,
      inProgress: false,
      message: "Timeweb API error",
    });
    renderList();
    await confirmDelete();

    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ variant: "destructive" })),
    );
  });

  it("does not rebuild for a post that was never published", async () => {
    (fetchAllPostsForAdmin as Mock).mockResolvedValue([
      { ...POST, status: "draft", published_at: null },
    ]);
    (deleteBlogPost as Mock).mockResolvedValue([{ published_at: null }]);
    renderList();
    await confirmDelete();

    await waitFor(() => expect(deleteBlogPost).toHaveBeenCalledWith("post-1"));
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith({ title: "Статья удалена" }));
    expect(triggerFrontendRebuild).not.toHaveBeenCalled();
  });

  it("rebuilds when the list row is stale and the deleted row was published", async () => {
    // Another tab published this post after the list was cached, so the cached
    // row says draft while the row the delete returned says otherwise.
    (fetchAllPostsForAdmin as Mock).mockResolvedValue([
      { ...POST, status: "draft", published_at: null },
    ]);
    (deleteBlogPost as Mock).mockResolvedValue([{ published_at: "2026-08-01T10:00:00.000Z" }]);
    renderList();
    await confirmDelete();

    await waitFor(() => expect(triggerFrontendRebuild).toHaveBeenCalledTimes(1));
  });

  it("keeps reporting a failed delete", async () => {
    (deleteBlogPost as Mock).mockRejectedValue(new Error("нет прав"));
    renderList();
    await confirmDelete();

    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Не удалось удалить", variant: "destructive" }),
      ),
    );
    expect(triggerFrontendRebuild).not.toHaveBeenCalled();
  });
});
