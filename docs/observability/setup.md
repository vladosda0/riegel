# Observability v1 — setup & operations checklist

Everything the **code** needs a human to configure once: Sentry projects,
secrets, alert rules, the Telegram bot, Metrika goals, retention reports, and
the uptime canary. The code ships dormant — no DSN / no bot token = no-op — so
this can be done incrementally without breaking anything.

Legend: **[Vlad]** = manual account/console step, **[deploy]** = a secret or
migration to push.

---

## 0. What's already in code

- **Frontend Sentry** — `src/lib/observability/sentry.ts`, lazy-loaded, gated
  on `VITE_SENTRY_DSN`. User tagging, release = git SHA, env = `VITE_APP_ENV`.
  App-wide React Query error reporting + a root error boundary.
- **Edge-function Sentry** — `_shared/sentry.ts` `withSentry(name, handler)`,
  gated on `SENTRY_DSN`. Wraps ai-inference, both tbank webhooks + init + card,
  invites, refunds, blog-rebuild, submit-feedback.
- **PII scrubbing** — both SDKs, fail-closed. See `sentry-scrubbing.md`.
- **Feedback widget** — `submit-feedback` function stores to `user_feedback`
  and emails the inbox.
- **Alert relay** — `sentry-alert-telegram` function: Sentry webhook → Telegram,
  rate-limited 3 / 15 min via `observability_alert_log`.
- **Metrika funnel goals** — fired from code (see §5).

---

## 1. Sentry projects & DSNs (R-1, R-2)

1. **[Vlad]** Create a Sentry org (free tier). Create **two projects per side**
   so staging never pollutes prod:
   - `rovno-frontend-prod`, `rovno-frontend-staging` (platform: React)
   - `rovno-backend-prod`, `rovno-backend-staging` (platform: Deno)
   Front/back can share a project if you prefer fewer — the `app` /
   `function_name` tags disambiguate — but env **must** stay split.
2. **[deploy] Frontend** — set `VITE_SENTRY_DSN` per environment:
   - Timeweb prod app → prod DSN
   - Timeweb staging app → staging DSN
   - local `.env.local` → leave empty (enable only to debug the integration)
3. **[deploy] Backend** — set the edge-function secrets per Supabase project:
   - `SENTRY_DSN` = that project's backend DSN
   - `SENTRY_ENVIRONMENT` = `production` (self-host) / `staging` (cloud) —
     also becomes the `app_env` label on `user_feedback` rows
   - `SENTRY_RELEASE` = optional, a version string if you want release grouping
   Cloud staging: `cdeploy`-style `supabase secrets set`. Self-host prod: set
   in the VPS function env. (Functions read env at runtime — no redeploy needed
   beyond restarting the functions container.)
4. **Verify (acceptance criteria):**
   - Frontend: `throw new Error("test")` in a component → appears in the prod
     project within a minute, with `user.id` tag when logged in.
   - Backend: force a 500 in a function → appears with `function_name` +
     `user.id` tags.
   - Confirm staging errors land in the staging project only.
   - Bundle: the Sentry chunk is a separate lazy chunk (see §7), not in the
     entry bundle.

---

## 2. Source maps (R-13, P1 — optional but recommended)

Readable stack traces need source maps uploaded at build. Use the Sentry Vite
plugin **or** `sentry-cli` in the Timeweb build step, keyed to the same git SHA
as `VITE_COMMIT_SHA`/release. Deferred if time-boxed — errors still group
without it, frames are just minified.

---

## 3. Telegram alert bot (R-4)

1. **[Vlad]** BotFather → `/newbot` → get `TELEGRAM_BOT_TOKEN`. (A dedicated
   alerts bot, separate from `@rovno_ai_bot`.)
2. **[Vlad]** Send the bot a message, then read
   `https://api.telegram.org/bot<TOKEN>/getUpdates` → copy your chat id =
   `TELEGRAM_ALERT_CHAT_ID`.
3. **[Vlad]** Invent a long random string = `SENTRY_ALERT_WEBHOOK_TOKEN`.
4. **[deploy]** Set all three as secrets on the **prod** Supabase project
   (that's where prod errors are), and deploy `sentry-alert-telegram`.
5. **Test:** `curl -X POST "https://<project>.functions.supabase.co/sentry-alert-telegram?token=<SENTRY_ALERT_WEBHOOK_TOKEN>" -H 'content-type: application/json' -d '{"message":"test alert","url":"https://sentry.io"}'`
   → a Telegram message arrives. A wrong `token` must return 401.

---

## 4. Sentry alert rules (R-4) — wire to the relay

For each rule, add a **webhook / "internal integration" action** pointing at
`…/sentry-alert-telegram?token=<SENTRY_ALERT_WEBHOOK_TOKEN>`. Runbook responses
for each live in `alert-runbook.md`.

- **A1 "Prod health degraded"** — Metric alert on event count, prod env:
  trigger when the 5-minute count is ≳ 10× the 7-day median. Start with a
  concrete floor (e.g. > 25 events / 5 min) and tune after a week of real
  baseline. Environment filter: `production` only.
- **A2 "Critical RPC failure"** — Issue alert filtered to
  `function_name:apply_template_stage_to_estimate OR
  function_name:search_canonical_library` (backend) and the matching
  `tags.rpc` / `tags.query_key` on the frontend project; trigger on > 3 events
  in 5 min affecting > 1 user.
- **A3 "Full outage"** — not a Sentry rule; see §6.

Set the Sentry-side **rate limit** on each rule too (belt-and-braces with the
relay's own 3/15-min cap).

---

## 5. Yandex Metrika — goals, funnels, retention (R-6, R-7)

Counter already exists (`109644835` prod; separate staging/dev counters). The
events below already fire from code as `reachGoal`. In Metrika you only need to
**register them as goals** (type: JavaScript event, matching the goal id) and
**assemble funnels**.

Signup funnel goals: `landing_view` → `registration_start` →
`registration_complete` → `email_verified` → `first_login`.
Activation: `first_login` → `project_created` → `template_applied` →
`estimate_saved_first_time`.
Catalog upload: `catalog_tab_visit` → `catalog_template_downloaded` →
`catalog_uploaded` → `catalog_editor_opened` → `catalog_saved`.
Constructor: `estimate_constructor_opened` → `library_searched` →
`work_applied_via_constructor`.

AI sidebar baseline: `ai_thread_first_move`, one per started thread, params
`entry` (`chip` | `manual`), `chip_key`, `project_id`, `prompt_length`. Register
it BEFORE the collection window opens: goals are not retroactive, so a goal
created late reports nothing for the days already elapsed.

Notes:
- Every event carries a `user_id` param for segmentation.
- Once-only guards: `estimate_saved_first_time` and `first_login` are guarded
  (per-user localStorage / onboarding flag) so they approximate "first time".
  `library_searched` is once-per-session (it would fire per keystroke).
- **Retention (R-7):** Metrika → Reports → Retention (cohorts by signup week).
  DAU/WAU/MAU: add the "Attendance" widgets to a dashboard. Bookmark that
  dashboard URL for the weekly ritual.
- **Verify:** Metrika real-time / "проверка счётчика" shows the goals firing;
  the funnel report shows per-step conversion.

---

## 6. Uptime canary for A3 (R-4)

**[Vlad]** UptimeRobot (free) → HTTP(s) monitor on `https://rovno.ai` (and
`https://api.rovno.ai/…/health` if you want API-level). Interval 5 min, alert
after 2 consecutive failures (~10 min). Point its alert contact at the same
Telegram (UptimeRobot has a Telegram integration) or email. This is the
"Sentry went silent" detector that error tracking structurally can't be.

---

## 7. Bundle-size acceptance (R-1: SDK ≤ 30 KB gz, non-blocking)

`initErrorTracking()` uses a dynamic `import("@sentry/react")`, so the SDK is a
**separate lazy chunk** downloaded in parallel with render, never in the entry
bundle. Confirm after `npm run build` that the sentry chunk is its own file and
the entry chunk didn't grow. Tree-shaking flags (`__SENTRY_TRACING__: false`
etc.) are set in `vite.config.ts` to drop the unused tracing/replay paths.

---

## 8. Weekly digest (R-5)

Use Sentry's built-in **Weekly Reports** (org setting) delivered to Vlad's
email — top issues, new issues, regressions, resolution stats, zero code to
maintain. Turn it on and confirm the first one arrives after a week. (A custom
digest that also pulls Metrika DAU is a possible later upgrade; not worth the
generation complexity for v1.)

---

## 9. 152-ФЗ sign-off (Open Question #2 — blocking for prod enable)

Do **not** enable the prod frontend/backend DSNs until the scrubbing review in
`sentry-scrubbing.md` is signed off (or Vlad explicitly accepts the risk).
Staging can be enabled immediately to validate the integration.
