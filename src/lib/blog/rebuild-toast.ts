// Toast copy for the Timeweb rebuild that follows a takedown.
//
// A post that has ever been published leaves its static page, its sitemap entry
// and its RSS item on the site until a build runs (scripts/prerender-blog.mjs
// builds all three from `status=eq.published`), so unpublish and delete report
// the rebuild rather than a bare success. A draft that was never published
// leaves nothing behind and needs no rebuild.
//
// The three takedown call sites share one copy of the four outcomes here;
// publish and the manual «Обновить сайт» button still carry their own.

import { triggerFrontendRebuild, type DeletedBlogPost, type RebuildResult } from "./api";

export type TakedownAction = "unpublish" | "delete";

export interface RebuildToast {
  title: string;
  description: string;
  variant?: "destructive";
}

const DONE_TITLE: Record<TakedownAction, string> = {
  unpublish: "Статья снята с публикации",
  delete: "Статья удалена",
};

const STILL_LIVE_TITLE: Record<TakedownAction, string> = {
  unpublish: "Снята с публикации, но страница ещё в поиске",
  delete: "Удалена, но страница ещё на сайте",
};

const NOT_CONFIGURED: Record<TakedownAction, string> = {
  unpublish: "Автопересборка не настроена: страница исчезнет из поиска после следующего деплоя.",
  delete: "Автопересборка не настроена: страница исчезнет с сайта после следующего деплоя.",
};

export function rebuildToast(action: TakedownAction, rebuild: RebuildResult): RebuildToast {
  if (rebuild.ok) {
    return { title: DONE_TITLE[action], description: "Пересборка запущена." };
  }
  if (rebuild.notConfigured) {
    return { title: DONE_TITLE[action], description: NOT_CONFIGURED[action] };
  }
  if (rebuild.inProgress) {
    return {
      title: DONE_TITLE[action],
      description: "Пересборка уже идёт. Нажмите «Обновить сайт» после её завершения.",
    };
  }
  return {
    title: STILL_LIVE_TITLE[action],
    description: "Пересборка не запустилась. Повторите кнопкой «Обновить сайт».",
    variant: "destructive",
  };
}

/** How long a takedown waits for the rebuild call before reporting the outcome
 * without it. `triggerFrontendRebuild` has no timeout of its own. */
export const REBUILD_TIMEOUT_MS = 15_000;

const REJECTED: RebuildResult = {
  ok: false,
  notConfigured: false,
  inProgress: false,
  message: "rebuild request rejected",
};

/** Did this delete leave static artefacts behind? Only a post the server
 * actually removed, and only one that had ever been published, had a page, a
 * sitemap entry and an RSS item. A delete that removed nothing changed nothing
 * on the site either. */
export function needsRebuildAfterDelete(deleted: DeletedBlogPost[]): boolean {
  return deleted.some((row) => row.published_at !== null);
}

/** Rebuild after a takedown and report the outcome. The rejection handler is the
 * second argument of `then`, not a trailing `catch`, so it covers the rebuild
 * call alone: a `catch` there would also fire on a throw from `notify` and
 * report a failure for a rebuild that had succeeded.
 *
 * The race against REBUILD_TIMEOUT_MS is what guarantees a toast. The timeout is
 * here rather than in `triggerFrontendRebuild` so that it covers the two takedown
 * call sites only: publish (BlogEditorPage) and the manual «Обновить сайт» button
 * (BlogAdminList) call that function directly and keep waiting for a real answer. */
export function rebuildAfterTakedown(
  action: TakedownAction,
  notify: (toast: RebuildToast) => void,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<RebuildResult>((resolve) => {
    timer = setTimeout(() => resolve(REJECTED), REBUILD_TIMEOUT_MS);
  });
  const settle = (toast: RebuildToast) => {
    clearTimeout(timer);
    notify(toast);
  };
  return Promise.race([triggerFrontendRebuild(), timedOut]).then(
    (rebuild) => settle(rebuildToast(action, rebuild)),
    () => settle(rebuildToast(action, REJECTED)),
  );
}
