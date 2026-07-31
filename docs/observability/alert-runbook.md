# Alert runbook (observability v1, R-4 / R-9)

What each alert means, what to do when it fires, and how to keep alerts sane.
This is the "3am test" document — when the phone buzzes, read the matching
section, don't improvise.

## Design philosophy (do not weaken without discussing with Vlad)

- **Two P0 delivery paths only:** Telegram bot (primary), email (fallback via
  Sentry's own notification). Nothing else pages.
- **P1 is weekly, never paging.** The weekly digest (Sentry's scheduled report,
  see `setup.md`) is read on Monday, it does not interrupt.
- **Rate limit: max 3 Telegram alerts per 15 minutes.** Enforced in the
  `sentry-alert-telegram` relay via `observability_alert_log`; excess alerts
  are logged as `suppressed`, not delivered. This is the anti-fatigue backstop
  — if you find yourself wanting to raise it, the alert *rules* are too noisy,
  fix those instead.
- **Target: < 1 false-positive P0 per week.** If you get more than one useless
  page in a week, tune the triggering rule (thresholds below) before you start
  ignoring the channel. An ignored alert channel is worse than no channel.

Every alert message contains a direct Sentry link — always click through to
the issue before acting. The Telegram message is a summary, the Sentry issue
is the truth.

## Alerts

### A1 — "Prod health degraded" (error-rate spike)

- **Fires when:** prod error events in a 5-minute window exceed ~10× the
  7-day baseline (exact rule in `setup.md`).
- **Means:** something started failing for *many* users at once — a bad deploy,
  a backend/RPC outage, or an expired credential.
- **Do:**
  1. Open the Sentry issue from the link. Look at the top error group and its
     first-seen time.
  2. Correlate with the last deploy — Sentry `release` tag = git SHA. If the
     spike starts at a deploy, that's your suspect.
  3. If it's a frontend deploy: consider a Timeweb rollback (redeploy the
     previous commit). If backend: check Supabase edge-function logs / DB.
  4. If it's an expired secret (T-Bank, Resend, LLM provider), rotate it.
- **Stand down when:** the error rate returns to baseline for 15 minutes.

### A2 — "Critical RPC failure"

- **Fires when:** `apply_template_stage_to_estimate` **or**
  `search_canonical_library` produces 5xx / captured exceptions more than 3
  times in 5 minutes across different users.
- **Means:** a core estimate flow is broken (users literally cannot build an
  estimate). These are tagged in Sentry: frontend `tags.rpc` /
  `tags.query_key`, backend `tags.function_name`.
- **Do:**
  1. Open the issue; read the exception. A PostgREST message like
     `function … does not exist` or `permission denied` points at a migration
     / grant problem.
  2. Reproduce in staging with the same inputs if possible.
  3. If it's a migration drift, apply the fix cloud-first then prod (the
     standard `/deploy-migration` order).
- **Note:** single-user one-off RPC errors do **not** page (the "different
  users" + count condition filters them) — they show up in the weekly digest.

### A3 — "Full outage" (canary silence)

- **Fires when:** the external uptime canary (UptimeRobot, see `setup.md`)
  cannot reach the app for > 10 minutes, i.e. Sentry itself might be getting
  no events because nothing is running.
- **Means:** the site is down (Timeweb app dead, DNS, cert) — the case Sentry
  alone can't detect, because a dead app sends no error events.
- **Do:**
  1. Load rovno.ai yourself. If it's down, check the Timeweb dashboard
     (app status, latest deploy) and the VPS (`sstatus`).
  2. Check `api.rovno.ai` health — a dead DB/API looks like a dead site.
  3. Escalation path if the self-host stack is the problem is the
     docker-compose recovery in `rovno-db/infra` (see the PG17 override note).

### A4 — "Unable to preload CSS for /assets/…" / "Failed to fetch dynamically imported module"

Not a paging alert on its own (a single event lands in the weekly digest), but
it has its own section because the message looks alarming and reads like a
broken deploy when it usually isn't.

- **Means:** a route chunk's dependency failed to load. Every route is
  `lazy(() => import(...))`, so Vite's preload helper injects a `<link>` per
  dependency and rejects when one fires `error`. Two very different causes:
  1. **Transient client-side network loss** (mobile operator, DPI, in-app
     browser such as the Telegram WebView) while the asset is served fine. This
     is the common case, and it is a single-user, single-event issue.
  2. **A stale `index.html`** naming asset hashes that a later deploy removed.
     This arrives as a burst right after a deploy, across several users.
- **Do:**
  1. `curl -I https://rovno.ai/assets/<the-exact-file-from-the-message>`.
     A `200` with `content-type: text/css` (or `application/javascript`) means
     the asset is live and you are looking at cause 1 — **stand down**, nothing
     to fix.
  2. Cross-check the event count and unique-user count. One user, one event,
     first-seen not adjacent to a deploy → cause 1.
  3. If it is a burst after a deploy, confirm with `grep` that the *current*
     prod bundle still references that hash. If it does not, it is cause 2 and
     it self-heals: see the recovery below.
- **Recovery in the app:** `src/lib/observability/preload-recovery.ts` listens
  for `vite:preloadError` and reloads the page **once per browsing session**,
  which fixes both causes. The retry is capped at one because a permanently
  broken asset would otherwise reload forever; the second failure falls through
  to `RootErrorBoundary` and its manual «Обновить страницу» button. A recovery
  is reported to Sentry on the *next* load as
  `Recovered from a Vite preload failure by reloading`, tagged
  `source=preload-recovery` — so a rise in **that** message, not in the raw
  preload error, is the signal that something is actually wrong. It is captured
  at **error** level on purpose (decided 2026-07-27): a recovery is something to
  look at when it shows up, so it belongs in the weekly digest rather than being
  filed away as a silent counter. It still does not page — A1 needs a ~10×
  spike, which a healthy trickle of single-user recoveries will never reach.
- **Recovery for the silent CSS case:** `src/lib/observability/stylesheet-guard.ts`
  covers the half `vite:preloadError` cannot see, where the host answers a dead
  `/assets/*.css` with `index.html` and the browser fires `load`. It reports as
  `Recovered from a stylesheet served as non-CSS by reloading`, tagged
  `recoveryKind=stylesheet`, and **shares the one-reload-per-session budget**
  above, so a deploy that breaks a stylesheet and a chunk at once still reloads
  only once. Details of the detection are under the gaps below.

#### Two known host-side gaps behind this alert (Timeweb / Caddy)

Verified against prod on 2026-07-27, and both still present on the host. They
originate in its web server, but Timeweb has declined to make either
configurable and has no plans to (see below), so closing them is on us.

Status: **gap 2's user-visible symptom is now mitigated in the app**
(`stylesheet-guard.ts`, below). Gap 1 is not, and neither gap is *fixed* — the
host still serves no `Cache-Control` and still answers a dead asset with `200`.

1. **No `Cache-Control` header at all** on `index.html` or the hashed assets
   (`curl -I https://rovno.ai/` shows only `etag` / `last-modified`). Browsers
   then apply heuristic freshness, roughly 10% of the document's age, so a
   client can hold a stale `index.html` for hours and walk straight into cause 2
   after a deploy. Wanted: `no-cache` on `index.html`,
   `public, max-age=31536000, immutable` on `/assets/*` (safe — the filenames
   are content-hashed).
2. **A missing asset is answered by the SPA fallback**, not a 404:
   `/assets/landing-DOESNOTEXIST.css` returns `200 text/html`. Consequences:
   real 404s are invisible in server logs, and Chromium fires `load` (not
   `error`) for a stylesheet served as HTML, so a stale **CSS** hash silently
   renders the page **unstyled** and never reaches the recovery handler. A stale
   **JS** hash does reach it, because an HTML MIME type is a hard module-import
   failure. Wanted: serve the SPA fallback for navigation requests only, and
   return a real 404 under `/assets/*`.

**Both are permanent on App Platform. Do not re-investigate the platform.**
Timeweb support answered on 2026-07-27, for apps `Rovno.ai` (ID 183673) and
`rovno-staging` (ID 189624), which have the two gaps identically:

> В App Platform отсутствует возможность изменять конфигурацию Caddy. Доступны
> только те настройки, которые предусмотрены в панели управления. […] Планов на
> реализацию подобного функционала нет.

They recommended moving the project to a VDS for full server control, and
suggested filing the request at <https://timeweb.cloud/my/ideas>.

Three platform routes were checked and are all dead ends, so that nobody spends
the afternoon again:

- **The panel.** An App Platform frontend app's «Настройки» tab exposes exactly
  five blocks — «Настройки деплоя» (framework, Node version, build command,
  dependencies, build dir, project path, env vars, branch, autodeploy),
  «Конфигурация», «Лимит входящих запросов», «Домены», «Проект». No header
  setting, no routing or rewrite setting.
- **A repo-level config file.** App Platform reads none. There is no documented
  or supported `_headers` / `_redirects` / `.htaccess` / `Caddyfile` equivalent.
- **Timeweb CDN in front of the app.** Its «Кэширование в браузере» option does
  add a `Cache-Control` header, but as a *single global TTL* for the whole
  resource, with no per-path or per-extension rules anywhere in its settings. It
  therefore cannot express the split this needs (`no-cache` on HTML *and*
  `immutable` on `/assets/*`), it does nothing at all for gap 2 (the origin
  still answers `200 text/html`), and it is designed to serve a separate
  delivery domain rather than front the apex. Not a fix.

##### How gap 2 is detected in the app (built 2026-07-27)

The signal is not the one you would first guess. Measured against prod by
injecting a `<link rel=stylesheet>` and reading it back:

| href | event | `link.sheet` | `content-type` |
| --- | --- | --- | --- |
| `/assets/landing-DOESNOTEXIST.css` (SPA fallback) | `load` | `CSSStyleSheet(0 rules)` | `text/html` |
| `/assets/index-CB2HeGfr.css` (real) | `load` | `CSSStyleSheet(1352 rules)` | `text/css` |

`link.sheet` is **not** `null`. The sheet object exists and parses to zero rules,
because HTML is not valid CSS. So the trigger is a sheet that parsed to nothing,
and the check is deliberately two-stage: zero rules alone is only a *suspect*,
because a legitimately empty CSS chunk looks identical. Each suspect is confirmed
by re-reading its `content-type` (`cache: "force-cache"`, so it normally costs no
network), and only a non-CSS type reloads. Anything inconclusive declines —
an offline confirm fetch, or a cross-origin sheet whose `cssRules` throws —
because reloading on a guess is worse than the unstyled page being fixed.

Not handled on purpose: a stylesheet that fires `error`. Lazy-chunk CSS already
reaches `vite:preloadError`, and a second reload path for a genuine network error
would reload offline users for something that is not this bug. Revisit if the
host ever does start returning real 404s.

##### Still open

1. **Gap 1 has no mitigation yet.** The intended one is a build-stamped version
   check: `__APP_RELEASE__` is already baked into the bundle (see
   `vite.config.ts`), so a small artifact fetched with `cache: "no-store"` and
   compared against it would detect that the loaded document is stale. What that
   should *do* on detection is an open product call (silent reload on the next
   navigation, a prompt, or nothing but telemetry), which is why it is not built.
2. **A Dockerfile deploy** on App Platform, shipping our own web server config.
   Actually fixes both gaps at the layer where they belong, and restores real
   404s in the access logs, which no in-app guard can do. Changes the app type
   and its pricing model.
3. **A VDS**, Timeweb's own suggestion. Full control, most ops burden, and it
   couples frontend availability to a server we maintain.

## Muting / vacation mode (Open Question #8)

There is no in-app UI for this in v1. To go quiet:

- **Preferred:** in Sentry → Alerts, toggle the alert rules off (or set them
  to a snooze). This stops A1/A2 at the source and is reversible in two clicks.
- **Blunt:** mute the Telegram bot chat, or revoke `TELEGRAM_ALERT_CHAT_ID`.
  The relay keeps logging `sent`/`failed` in `observability_alert_log`, so you
  can see what you missed.
- **A3 canary:** pause the monitor in UptimeRobot.

Re-enable everything when back. (If muting becomes routine, that's the signal
to build the vacation-mode toggle — revisit with Vlad.)

## Weekly 30-minute ritual (R-9, success metric: ≥ 80% weeks completed)

Monday morning, bookmarkable dashboards (URLs in `setup.md`):

1. **Sentry issues, last 7 days, sorted by events** — triage the top 5. Assign
   each: fix now / backlog / ignore (mark resolved or ignored so it stops
   counting). ~10 min.
2. **Sentry weekly digest email** — skim new error types + any regressions
   (resolved issues that reappeared). ~5 min.
3. **Yandex Metrika funnels** (signup, activation, catalog, constructor) —
   note the biggest drop-off step. ~5 min.
4. **Yandex Metrika retention cohorts + DAU/WAU** — is the trend up or down vs
   last week? ~5 min.
5. **Feedback inbox** (`user_feedback` table via Studio, or the emails) — read
   what users wrote; anything actionable goes to the roadmap. ~5 min.

The point is one decision per surface, not deep analysis. If a surface is
empty/healthy, move on.
