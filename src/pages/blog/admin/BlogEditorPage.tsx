// Blog admin — article editor (/blog/admin/new, /blog/admin/:id).
//
// Medium-style editing: big title/subtitle fields + TipTap body with bubble
// and "+" menus, drag-drop image upload, autosave (debounced, creates the
// draft row on first save), slug derived from the title until touched,
// SEO panel with live snippet preview, publish/unpublish, draft preview at
// the public URL (RLS shows drafts to authors).
//
// Hardcoded Russian on purpose — the blog is a RU-first editorial surface,
// same convention as the landing (no i18n keys there either).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { Editor } from "@tiptap/react";
import {
  ArrowLeft, ChevronDown, ExternalLink, ImagePlus, Loader2, Trash2, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import {
  useBlogPostById, useCreateBlogPost, useDeleteBlogPost, useMyBlogAuthor, useUpdateBlogPost,
} from "@/hooks/use-blog";
import { triggerFrontendRebuild, uploadBlogImage } from "@/lib/blog/api";
import { needsRebuildAfterDelete, rebuildAfterTakedown } from "@/lib/blog/rebuild-toast";
import { slugifyTitle, validateSlug, type SlugIssue } from "@/lib/blog/slug";
import { countWords, formatReadingTime, readingTimeMinutes } from "@/lib/blog/reading-time";
import { blogPostPath } from "@/lib/blog/jsonld";
import { sanitizeArticleHtml } from "@/lib/blog/sanitize";
import { useDocumentHead } from "@/lib/blog/seo";
import type { BlogPostPatch, BlogPostStatus } from "@/lib/blog/types";
import { BlogAdminGuard } from "@/components/blog/admin/BlogAdminGuard";
import { RichTextEditor } from "@/components/blog/editor/RichTextEditor";
import "@/components/landing/landing.css";
import "@/components/blog/blog.css";

const EDITOR_TITLE = "Блог — редактор статьи";

const AUTOSAVE_DELAY_MS = 1500;

const SLUG_ISSUE_TEXT: Record<SlugIssue, string> = {
  empty: "Слаг пустой — задайте название",
  too_short: "Слаг короче 3 символов",
  too_long: "Слаг длиннее 120 символов",
  format: "Только строчные латинские буквы, цифры и дефисы",
  reserved: "Этот адрес зарезервирован системой",
};

type SaveState = "idle" | "waiting" | "saving" | "saved" | "error";

interface FormState {
  title: string;
  subtitle: string;
  slug: string;
  slugTouched: boolean;
  excerpt: string;
  tags: string[];
  coverUrl: string | null;
  seoTitle: string;
  seoDescription: string;
  status: BlogPostStatus;
  publishedAt: string | null;
}

const EMPTY_FORM: FormState = {
  title: "",
  subtitle: "",
  slug: "",
  slugTouched: false,
  excerpt: "",
  tags: [],
  coverUrl: null,
  seoTitle: "",
  seoDescription: "",
  status: "draft",
  publishedAt: null,
};

function deriveExcerpt(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= 180) return normalized;
  const cut = normalized.slice(0, 180);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), 120))}…`;
}

function useAutoResize(): (el: HTMLTextAreaElement | null) => void {
  return useCallback((el: HTMLTextAreaElement | null) => {
    if (!el) return;
    const resize = () => {
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight}px`;
    };
    resize();
    el.addEventListener("input", resize);
  }, []);
}

export default function BlogEditorPage() {
  // Same as BlogAdminList, including the caveat: this holds for a signed-in session,
  // while a guest is redirected away and AuthLayout's tag is what a crawler sees.
  // Set before the early returns below so the loading and not-found branches carry it.
  useDocumentHead({ title: EDITOR_TITLE, robots: "noindex, nofollow" });

  const { id: routeId } = useParams<{ id: string }>();
  const isNew = !routeId;
  const navigate = useNavigate();
  const { toast } = useToast();
  const { author } = useMyBlogAuthor();

  const { data: loadedPost, isLoading: postLoading } = useBlogPostById(routeId);
  const createMutation = useCreateBlogPost();
  const updateMutation = useUpdateBlogPost();
  const deleteMutation = useDeleteBlogPost();

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [tagsInput, setTagsInput] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [seoOpen, setSeoOpen] = useState(false);
  const [coverUploading, setCoverUploading] = useState(false);
  const [stats, setStats] = useState({ words: 0, minutes: 0 });
  /**
   * The stored document did not fit this bundle's schema, so the editor is NOT
   * showing the real post. Every write path has to freeze: an autosave from here
   * would overwrite a good article with whatever partial document we managed to
   * build. Reachable when a tab that predates a node-type deploy (e.g. `figure`)
   * opens a post written by a newer one.
   */
  const [contentBroken, setContentBroken] = useState(false);

  const editorRef = useRef<Editor | null>(null);
  const postIdRef = useRef<string | null>(routeId ?? null);
  const formRef = useRef(form);
  formRef.current = form;
  const hydratedRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savingRef = useRef(false);
  const pendingRef = useRef(false);
  const dirtyRef = useRef(false);
  const contentBrokenRef = useRef(false);
  const coverInputRef = useRef<HTMLInputElement>(null);

  const titleResize = useAutoResize();
  const subtitleResize = useAutoResize();

  // Hydrate the form once when editing an existing post.
  useEffect(() => {
    if (!loadedPost || hydratedRef.current) return;
    hydratedRef.current = true;
    postIdRef.current = loadedPost.id;
    setForm({
      title: loadedPost.title === "Без названия" ? "" : loadedPost.title,
      subtitle: loadedPost.subtitle ?? "",
      slug: loadedPost.slug,
      slugTouched: true,
      excerpt: loadedPost.excerpt ?? "",
      tags: loadedPost.tags,
      coverUrl: loadedPost.cover_image_url,
      seoTitle: loadedPost.seo_title ?? "",
      seoDescription: loadedPost.seo_description ?? "",
      status: loadedPost.status,
      publishedAt: loadedPost.published_at,
    });
    setStats({
      words: loadedPost.word_count ?? 0,
      minutes: loadedPost.reading_time_minutes ?? 0,
    });
    setSaveState("saved");
    setLastSavedAt(new Date(loadedPost.updated_at));
  }, [loadedPost]);

  const effectiveSlug = useMemo(() => {
    if (form.slugTouched || form.status === "published") return form.slug;
    return slugifyTitle(form.title);
  }, [form.slug, form.slugTouched, form.status, form.title]);

  const slugIssue = useMemo(() => validateSlug(effectiveSlug), [effectiveSlug]);

  const buildPayload = useCallback((): BlogPostPatch => {
    const state = formRef.current;
    const editor = editorRef.current;
    const text = editor?.getText() ?? "";
    const words = countWords(text);
    return {
      title: state.title.trim() || "Без названия",
      subtitle: state.subtitle.trim() || null,
      slug: state.slugTouched || state.status === "published" ? state.slug : slugifyTitle(state.title),
      excerpt: state.excerpt.trim() || deriveExcerpt(text) || null,
      content: editor?.getJSON() ?? {},
      // Sanitize at write time too (defense in depth): the render paths already
      // sanitize, but this keeps the DB value itself free of anything the
      // allow-list drops, so a service-role/SQL reader never trusts raw HTML.
      content_html: sanitizeArticleHtml(editor?.getHTML() ?? ""),
      cover_image_url: state.coverUrl,
      seo_title: state.seoTitle.trim() || null,
      seo_description: state.seoDescription.trim() || null,
      tags: state.tags,
      word_count: words,
      reading_time_minutes: readingTimeMinutes(words),
    };
  }, []);

  const saveNow = useCallback(async (): Promise<boolean> => {
    // Hard stop: the editor is not holding the stored document (see contentBroken).
    // Anything we write from here is data loss, not a save.
    if (contentBrokenRef.current) return false;
    if (savingRef.current) {
      pendingRef.current = true;
      return false;
    }
    const payload = buildPayload();
    const issue = validateSlug(payload.slug ?? "");
    if (issue) {
      // No valid slug yet (e.g. the title is still empty) — stay unsaved.
      setSaveState(dirtyRef.current ? "waiting" : "idle");
      return false;
    }

    savingRef.current = true;
    setSaveState("saving");
    try {
      if (!postIdRef.current) {
        if (!author) throw new Error("Автор не найден");
        const created = await createMutation.mutateAsync({ ...payload, author_id: author.id } as never);
        postIdRef.current = created.id;
        navigate(`/blog/admin/${created.id}`, { replace: true });
      } else {
        await updateMutation.mutateAsync({ id: postIdRef.current, patch: payload });
      }
      dirtyRef.current = false;
      setSaveState("saved");
      setLastSavedAt(new Date());
      const editor = editorRef.current;
      if (editor) {
        const words = countWords(editor.getText());
        setStats({ words, minutes: readingTimeMinutes(words) });
      }
      return true;
    } catch (error) {
      // Unique-slug collision on the first save: suffix and retry once.
      const message = error instanceof Error ? error.message : String(error);
      if (/duplicate key|23505/.test(message) && !formRef.current.slugTouched) {
        const suffix = Math.random().toString(36).slice(2, 6);
        setForm((f) => ({ ...f, slug: `${payload.slug}-${suffix}`, slugTouched: true }));
        setSaveState("waiting");
      } else {
        setSaveState("error");
        toast({ title: "Не удалось сохранить", description: message, variant: "destructive" });
      }
      return false;
    } finally {
      savingRef.current = false;
      if (pendingRef.current) {
        pendingRef.current = false;
        void saveNow();
      }
    }
  }, [author, buildPayload, createMutation, navigate, toast, updateMutation]);

  const scheduleSave = useCallback(() => {
    dirtyRef.current = true;
    setSaveState("waiting");
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      void saveNow();
    }, AUTOSAVE_DELAY_MS);
  }, [saveNow]);

  useEffect(() => () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
  }, []);

  // Warn about unsaved changes on tab close.
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (dirtyRef.current) {
        event.preventDefault();
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);

  // Ctrl/Cmd+S — save immediately.
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void saveNow();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [saveNow]);

  const patchForm = useCallback(
    (patch: Partial<FormState>) => {
      setForm((f) => ({ ...f, ...patch }));
      scheduleSave();
    },
    [scheduleSave],
  );

  const handleEditorReady = useCallback((editor: Editor) => {
    editorRef.current = editor;
  }, []);

  const handleEditorChange = useCallback(() => {
    if (contentBrokenRef.current) return;
    scheduleSave();
  }, [scheduleSave]);

  const handleContentError = useCallback(
    (error: Error) => {
      // Set the ref synchronously: an onUpdate can fire before React commits the
      // state, and scheduleSave reads the ref.
      contentBrokenRef.current = true;
      setContentBroken(true);
      setSaveState("idle");
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      toast({
        title: "Не удалось открыть статью",
        description:
          "Похоже, страница устарела. Обновите её (Cmd+Shift+R) — редактирование заблокировано, чтобы не перезаписать статью.",
        variant: "destructive",
      });
      console.error("[blog editor] content schema mismatch:", error);
    },
    [toast],
  );

  const addTagsFromInput = useCallback(() => {
    const parts = tagsInput.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);
    if (parts.length === 0) return;
    setTagsInput("");
    setForm((f) => {
      const merged = Array.from(new Set([...f.tags, ...parts])).slice(0, 5);
      return { ...f, tags: merged };
    });
    scheduleSave();
  }, [scheduleSave, tagsInput]);

  const handleCoverUpload = useCallback(
    async (file: File) => {
      setCoverUploading(true);
      try {
        const { url } = await uploadBlogImage(file);
        patchForm({ coverUrl: url });
      } catch (error) {
        toast({
          title: "Не удалось загрузить обложку",
          description: error instanceof Error ? error.message : String(error),
          variant: "destructive",
        });
      } finally {
        setCoverUploading(false);
      }
    },
    [patchForm, toast],
  );

  const publish = useCallback(async () => {
    const editor = editorRef.current;
    if (contentBrokenRef.current) {
      toast({ title: "Обновите страницу — статья открыта не полностью", variant: "destructive" });
      return;
    }
    if (!formRef.current.title.trim()) {
      toast({ title: "Дайте статье название", variant: "destructive" });
      return;
    }
    if (!editor || countWords(editor.getText()) < 10) {
      toast({ title: "Статья слишком короткая для публикации", variant: "destructive" });
      return;
    }
    const slug = formRef.current.slugTouched ? formRef.current.slug : slugifyTitle(formRef.current.title);
    const issue = validateSlug(slug);
    if (issue) {
      toast({ title: "Проверьте слаг", description: SLUG_ISSUE_TEXT[issue], variant: "destructive" });
      return;
    }
    const publishedAt = formRef.current.publishedAt ?? new Date().toISOString();
    setForm((f) => ({ ...f, status: "published", publishedAt, slug, slugTouched: true }));
    formRef.current = { ...formRef.current, status: "published", publishedAt, slug, slugTouched: true };
    // Persist with the status flip included.
    const ok = await (async () => {
      const payloadExtra = { status: "published" as const, published_at: publishedAt };
      const payload = { ...buildPayload(), ...payloadExtra };
      try {
        setSaveState("saving");
        if (!postIdRef.current) {
          if (!author) throw new Error("Автор не найден");
          const created = await createMutation.mutateAsync({ ...payload, author_id: author.id } as never);
          postIdRef.current = created.id;
          navigate(`/blog/admin/${created.id}`, { replace: true });
        } else {
          await updateMutation.mutateAsync({ id: postIdRef.current, patch: payload });
        }
        dirtyRef.current = false;
        setSaveState("saved");
        setLastSavedAt(new Date());
        return true;
      } catch (error) {
        setSaveState("error");
        toast({
          title: "Не удалось опубликовать",
          description: error instanceof Error ? error.message : String(error),
          variant: "destructive",
        });
        return false;
      }
    })();
    if (ok) {
      // Fire the Timeweb rebuild so the static (crawler-visible) blog pages
      // regenerate. Failure here must not read as a failed publish.
      void triggerFrontendRebuild().then((rebuild) => {
        if (rebuild.ok) {
          toast({
            title: "Статья опубликована",
            description: "Пересборка сайта запущена — статья станет видна поисковикам через несколько минут.",
          });
        } else if (rebuild.notConfigured) {
          toast({
            title: "Статья опубликована",
            description: "Автопересборка не настроена: в поисковики статья попадёт после следующего деплоя.",
          });
        } else if (rebuild.inProgress) {
          // Routine, not a failure: a previous build is still running and the
          // function refuses to queue a second one (it could redeploy an older
          // commit over the newer in-flight one).
          toast({
            title: "Статья опубликована",
            description: "Пересборка уже идёт. Когда она закончится, нажмите «Обновить сайт», чтобы статья попала к поисковикам.",
          });
        } else {
          toast({
            title: "Статья опубликована, но пересборка не запустилась",
            description: "Повторите кнопкой «Обновить сайт» в списке статей.",
            variant: "destructive",
          });
        }
      });
    }
  }, [author, buildPayload, createMutation, navigate, toast, updateMutation]);

  const unpublish = useCallback(async () => {
    if (!postIdRef.current) return;
    setForm((f) => ({ ...f, status: "draft" }));
    formRef.current = { ...formRef.current, status: "draft" };
    try {
      await updateMutation.mutateAsync({ id: postIdRef.current, patch: { status: "draft" } });
      // The static page must disappear from the site too — rebuild. Never swallow
      // the result: the article's static page, its sitemap entry and its RSS item
      // stay crawler-visible until a build runs, and the admin would show only the
      // reassuring "снята с публикации".
      void rebuildAfterTakedown("unpublish", toast);
    } catch (error) {
      toast({
        title: "Не удалось снять с публикации",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      });
    }
  }, [toast, updateMutation]);

  const openPreview = useCallback(async () => {
    const saved = savingRef.current || dirtyRef.current ? await saveNow() : true;
    const slug = formRef.current.slugTouched ? formRef.current.slug : slugifyTitle(formRef.current.title);
    if (saved && !validateSlug(slug)) {
      window.open(blogPostPath(slug), "_blank", "noopener");
    }
  }, [saveNow]);

  const saveStatusText = useMemo(() => {
    switch (saveState) {
      case "saving":
        return "Сохранение…";
      case "waiting":
        return "Есть несохранённые изменения";
      case "saved":
        return lastSavedAt
          ? `Сохранено в ${new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit" }).format(lastSavedAt)}`
          : "Сохранено";
      case "error":
        return "Ошибка сохранения";
      default:
        return "";
    }
  }, [lastSavedAt, saveState]);

  const snippetTitle = form.seoTitle.trim() || form.title.trim() || "Название статьи";
  const snippetDescription =
    form.seoDescription.trim() || form.excerpt.trim() || "Описание появится из первых абзацев статьи.";

  if (!isNew && postLoading) {
    return (
      <BlogAdminGuard>
        <div className="flex min-h-[50vh] items-center justify-center text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Загружаем статью…
        </div>
      </BlogAdminGuard>
    );
  }

  if (!isNew && !postLoading && !loadedPost) {
    return (
      <BlogAdminGuard>
        <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3">
          <p className="text-sm text-muted-foreground">Статья не найдена.</p>
          <Button variant="outline" asChild>
            <Link to="/blog/admin">К списку статей</Link>
          </Button>
        </div>
      </BlogAdminGuard>
    );
  }

  return (
    <BlogAdminGuard>
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 px-4 py-6">
        {/* Top bar */}
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="ghost" size="sm" asChild>
            <Link to="/blog/admin">
              <ArrowLeft className="mr-1 h-4 w-4" />
              Все статьи
            </Link>
          </Button>
          <Badge variant={form.status === "published" ? "default" : "secondary"}>
            {form.status === "published" ? "Опубликовано" : "Черновик"}
          </Badge>
          <span className={`text-xs ${saveState === "error" ? "text-destructive" : "text-muted-foreground"}`}>
            {saveStatusText}
          </span>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => void openPreview()}>
              <ExternalLink className="mr-1 h-4 w-4" />
              Предпросмотр
            </Button>
            {form.status === "published" ? (
              <Button variant="outline" size="sm" onClick={() => void unpublish()}>
                Снять с публикации
              </Button>
            ) : (
              <Button size="sm" onClick={() => void publish()}>
                Опубликовать
              </Button>
            )}
            {postIdRef.current && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="ghost" size="icon" title="Удалить статью">
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Удалить статью?</AlertDialogTitle>
                    <AlertDialogDescription>Это действие необратимо.</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Отмена</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => {
                        if (!postIdRef.current) return;
                        deleteMutation.mutate(postIdRef.current, {
                          onSuccess: (deleted) => {
                            dirtyRef.current = false;
                            // Same rule as unpublish above, and the same exception as
                            // the list: only a post that has ever been published left
                            // anything on the site to clear, decided from the rows the
                            // delete returned rather than from this form.
                            if (needsRebuildAfterDelete(deleted)) {
                              void rebuildAfterTakedown("delete", toast);
                            } else {
                              toast({ title: "Статья удалена" });
                            }
                            navigate("/blog/admin");
                          },
                          onError: (error) =>
                            toast({
                              title: "Не удалось удалить",
                              description: error instanceof Error ? error.message : String(error),
                              variant: "destructive",
                            }),
                        });
                      }}
                    >
                      Удалить
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>
        </div>

        {/* Editorial surface — landing design system for WYSIWYG parity */}
        <div className="rv-landing rounded-2xl border" style={{ background: "#FDFCF6" }}>
          <div style={{ maxWidth: 760, margin: "0 auto", padding: "48px 24px 64px", display: "flex", flexDirection: "column", gap: 8 }}>
            {/* Cover */}
            {form.coverUrl ? (
              <div style={{ position: "relative", marginBottom: 24 }}>
                <img
                  src={form.coverUrl}
                  alt="Обложка"
                  style={{ width: "100%", borderRadius: 16, display: "block" }}
                />
                <div style={{ position: "absolute", top: 12, right: 12, display: "flex", gap: 8 }}>
                  <Button variant="secondary" size="sm" onClick={() => coverInputRef.current?.click()} disabled={coverUploading}>
                    Заменить
                  </Button>
                  <Button variant="secondary" size="icon" className="h-8 w-8" onClick={() => patchForm({ coverUrl: null })} title="Убрать обложку">
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => coverInputRef.current?.click()}
                disabled={coverUploading}
                className="mb-6 flex items-center justify-center gap-2 rounded-xl border border-dashed py-8 text-sm"
                style={{ color: "var(--rv-blue)", borderColor: "rgba(30,92,203,0.32)", background: "rgba(30,92,203,0.03)", cursor: "pointer" }}
              >
                {coverUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
                {coverUploading ? "Загружаем обложку…" : "Добавить обложку"}
              </button>
            )}
            <input
              ref={coverInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void handleCoverUpload(file);
              }}
            />

            {/* Title / subtitle */}
            <textarea
              ref={titleResize}
              value={form.title}
              onChange={(e) => patchForm({ title: e.target.value })}
              placeholder="Название"
              rows={1}
              style={{
                fontFamily: "var(--font-display)", fontSize: 44, lineHeight: 1.05, letterSpacing: "-0.02em",
                color: "var(--rv-blue)", background: "transparent", border: 0, outline: "none",
                resize: "none", width: "100%", padding: 0,
              }}
            />
            <textarea
              ref={subtitleResize}
              value={form.subtitle}
              onChange={(e) => patchForm({ subtitle: e.target.value })}
              placeholder="Подзаголовок (необязательно)"
              rows={1}
              style={{
                fontFamily: "var(--font-body)", fontSize: 20, lineHeight: 1.45,
                color: "var(--rv-blue)", opacity: 0.85, background: "transparent", border: 0,
                outline: "none", resize: "none", width: "100%", padding: 0, marginBottom: 16,
              }}
            />

            {contentBroken && (
              <div
                role="alert"
                style={{
                  border: "1px solid #b3261e", background: "rgba(179,38,30,0.06)", color: "#b3261e",
                  borderRadius: 8, padding: "12px 16px", marginBottom: 16, fontSize: 14, lineHeight: 1.5,
                }}
              >
                Эта версия страницы не умеет открывать статью, поэтому сохранение заблокировано.
                Обновите страницу (Cmd+Shift+R). Ничего не потеряно.
              </div>
            )}

            {/* Body */}
            <RichTextEditor
              initialContent={loadedPost?.content ?? null}
              placeholder="Расскажите историю… Выделите текст для форматирования, «+» на пустой строке — фото и блоки."
              onReady={handleEditorReady}
              onChange={handleEditorChange}
              onContentError={handleContentError}
            />
          </div>
        </div>

        {/* Meta: slug + tags */}
        <div className="grid gap-4 md:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="blog-slug">Адрес статьи</Label>
            <div className="flex items-center gap-1">
              <span className="whitespace-nowrap text-xs text-muted-foreground">rovno.ai/blog/</span>
              <Input
                id="blog-slug"
                value={effectiveSlug}
                disabled={form.status === "published"}
                onChange={(e) => patchForm({ slug: e.target.value.toLowerCase(), slugTouched: true })}
                className="font-mono text-sm"
              />
            </div>
            {form.status === "published" ? (
              <p className="text-xs text-muted-foreground">
                Адрес опубликованной статьи не меняется — иначе сломаются ссылки из поисковиков.
              </p>
            ) : slugIssue ? (
              <p className="text-xs text-destructive">{SLUG_ISSUE_TEXT[slugIssue]}</p>
            ) : (
              <p className="text-xs text-muted-foreground">Формируется из названия, можно поправить вручную.</p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="blog-tags">Теги (до 5)</Label>
            <div className="flex flex-wrap items-center gap-1.5 rounded-md border px-2 py-1.5">
              {form.tags.map((tag) => (
                <span key={tag} className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-xs">
                  {tag}
                  <button
                    type="button"
                    title={`Убрать тег ${tag}`}
                    onClick={() => patchForm({ tags: form.tags.filter((t) => t !== tag) })}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
              <input
                id="blog-tags"
                value={tagsInput}
                onChange={(e) => setTagsInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === ",") {
                    e.preventDefault();
                    addTagsFromInput();
                  }
                }}
                onBlur={addTagsFromInput}
                placeholder={form.tags.length === 0 ? "смета, приёмка…" : ""}
                className="min-w-24 flex-1 border-0 bg-transparent text-sm outline-none"
              />
            </div>
          </div>
        </div>

        {/* SEO panel */}
        <Collapsible open={seoOpen} onOpenChange={setSeoOpen} className="rounded-lg border">
          <CollapsibleTrigger className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium">
            SEO и сниппет
            <ChevronDown className={`h-4 w-4 transition-transform ${seoOpen ? "rotate-180" : ""}`} />
          </CollapsibleTrigger>
          <CollapsibleContent className="flex flex-col gap-4 border-t px-4 py-4">
            <div className="rounded-md border bg-muted/30 p-4">
              <p className="text-xs text-muted-foreground">rovno.ai › blog › {effectiveSlug || "…"}</p>
              <p className="mt-0.5 text-base text-blue-700">{snippetTitle}</p>
              <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">{snippetDescription}</p>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="seo-title">
                SEO-заголовок <span className="text-muted-foreground">({form.seoTitle.length}/60)</span>
              </Label>
              <Input
                id="seo-title"
                value={form.seoTitle}
                maxLength={70}
                onChange={(e) => patchForm({ seoTitle: e.target.value })}
                placeholder={form.title || "По умолчанию — название статьи"}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="seo-description">
                SEO-описание <span className="text-muted-foreground">({form.seoDescription.length}/160)</span>
              </Label>
              <Textarea
                id="seo-description"
                value={form.seoDescription}
                maxLength={180}
                rows={3}
                onChange={(e) => patchForm({ seoDescription: e.target.value })}
                placeholder="1–2 предложения для сниппета в поиске. Если пусто — первые абзацы статьи."
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="blog-excerpt">Анонс в списке статей</Label>
              <Textarea
                id="blog-excerpt"
                value={form.excerpt}
                rows={2}
                onChange={(e) => patchForm({ excerpt: e.target.value })}
                placeholder="Если пусто — сформируется из начала статьи."
              />
            </div>
          </CollapsibleContent>
        </Collapsible>

        <p className="text-xs text-muted-foreground">
          {stats.words > 0 && `${stats.words} слов · ${formatReadingTime(stats.minutes) ?? ""}`}
        </p>
      </div>
    </BlogAdminGuard>
  );
}
