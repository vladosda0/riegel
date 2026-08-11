// Blog admin — article list (/blog/admin).

import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ExternalLink, Loader2, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { triggerFrontendRebuild } from "@/lib/blog/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { useAdminBlogPosts, useDeleteBlogPost, useMyBlogAuthor } from "@/hooks/use-blog";
import { BlogAdminGuard } from "@/components/blog/admin/BlogAdminGuard";
import { blogPostPath } from "@/lib/blog/jsonld";
import { useDocumentHead } from "@/lib/blog/seo";
import type { BlogPostWithAuthor } from "@/lib/blog/types";

const ADMIN_TITLE = "Блог — управление";

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  }).format(new Date(iso));
}

function PostRow({ post }: { post: BlogPostWithAuthor }) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const deleteMutation = useDeleteBlogPost();

  return (
    <div className="flex items-center gap-4 rounded-lg border bg-card px-4 py-3">
      <div className="min-w-0 flex-1">
        <button
          type="button"
          className="block w-full truncate text-left font-medium hover:underline"
          onClick={() => navigate(`/blog/admin/${post.id}`)}
        >
          {post.title}
        </button>
        <p className="truncate text-xs text-muted-foreground">/blog/{post.slug}/</p>
      </div>
      <Badge variant={post.status === "published" ? "default" : "secondary"}>
        {post.status === "published" ? "Опубликовано" : "Черновик"}
      </Badge>
      <div className="hidden w-40 text-xs text-muted-foreground sm:block">
        <p>изм. {formatDateTime(post.updated_at)}</p>
        <p>публ. {formatDateTime(post.published_at)}</p>
      </div>
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="icon" title="Редактировать" onClick={() => navigate(`/blog/admin/${post.id}`)}>
          <Pencil className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          title="Открыть на сайте"
          onClick={() => window.open(blogPostPath(post.slug), "_blank", "noopener")}
        >
          <ExternalLink className="h-4 w-4" />
        </Button>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="ghost" size="icon" title="Удалить">
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Удалить статью?</AlertDialogTitle>
              <AlertDialogDescription>
                «{post.title}» будет удалена безвозвратно. Если статья была опубликована,
                её адрес перестанет открываться.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Отмена</AlertDialogCancel>
              <AlertDialogAction
                onClick={() =>
                  deleteMutation.mutate(post.id, {
                    onSuccess: () => toast({ title: "Статья удалена" }),
                    onError: (error) =>
                      toast({
                        title: "Не удалось удалить",
                        description: error instanceof Error ? error.message : String(error),
                        variant: "destructive",
                      }),
                  })
                }
              >
                Удалить
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}

export default function BlogAdminList() {
  // robots.txt disallows /blog/admin, but its path matching is octet-exact while the
  // router resolves the route case-insensitively, so /blog/ADMIN reaches this page
  // uncovered. A disallow also suppresses crawling, not indexing. This meta covers
  // every spelling and is the control that actually keeps the surface out of results.
  useDocumentHead({ title: ADMIN_TITLE, robots: "noindex, nofollow" });

  const { isAuthor } = useMyBlogAuthor();
  const { data: posts, isLoading } = useAdminBlogPosts(isAuthor);
  const { toast } = useToast();
  const [rebuilding, setRebuilding] = useState(false);

  const handleRebuild = async () => {
    setRebuilding(true);
    const result = await triggerFrontendRebuild();
    setRebuilding(false);
    if (result.ok) {
      toast({
        title: "Пересборка запущена",
        description: "Статические страницы блога, sitemap и RSS обновятся через несколько минут.",
      });
    } else if (result.notConfigured) {
      toast({
        title: "Автопересборка не настроена",
        description: "Нужны секреты TIMEWEB_API_TOKEN и TIMEWEB_APP_ID у функции blog-rebuild-frontend.",
      });
    } else if (result.inProgress) {
      toast({
        title: "Пересборка уже идёт",
        description: "Дождитесь её окончания и нажмите ещё раз — вторая сборка могла бы откатить сайт на предыдущий коммит.",
      });
    } else {
      // result.message is the function's English log string; do not show it.
      toast({
        title: "Не удалось запустить пересборку",
        description: "Проверьте логи функции blog-rebuild-frontend.",
        variant: "destructive",
      });
    }
  };

  return (
    <BlogAdminGuard>
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-8">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">Блог</h1>
            <p className="text-sm text-muted-foreground">
              Статьи на <a className="underline" href="/blog/" target="_blank" rel="noopener noreferrer">rovno.ai/blog</a>
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() => void handleRebuild()}
              disabled={rebuilding}
              title="Пересобрать сайт, чтобы поисковики увидели актуальные статьи"
            >
              {rebuilding ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              Обновить сайт
            </Button>
            <Button asChild>
              <Link to="/blog/admin/new">
                <Plus className="mr-2 h-4 w-4" />
                Новая статья
              </Link>
            </Button>
          </div>
        </div>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Загрузка…</p>
        ) : !posts || posts.length === 0 ? (
          <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
            Статей пока нет. Начните с первой — «Новая статья».
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {posts.map((post) => (
              <PostRow key={post.id} post={post} />
            ))}
          </div>
        )}
      </div>
    </BlogAdminGuard>
  );
}
