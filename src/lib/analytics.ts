export type AnalyticsEventName =
  | "estimate_editor_started"
  | "estimate_status_change_requested"
  | "estimate_status_change_succeeded"
  | "estimate_status_change_failed"
  | "estimate_work_created"
  | "estimate_work_updated"
  | "estimate_work_deleted"
  | "estimate_line_created"
  | "estimate_line_updated"
  | "estimate_line_deleted"
  | "estimate_version_submitted"
  | "estimate_version_approved"
  | "estimate_in_work_transition_requested"
  | "estimate_in_work_transition_succeeded"
  | "estimate_in_work_transition_failed"
  | "estimate_stage_created"
  | "project_stage_created"
  | "procurement_item_opened"
  | "procurement_item_updated"
  | "procurement_item_archived"
  | "procurement_item_relinked_to_estimate_line"
  | "procurement_item_used_from_stock"
  | "procurement_tab_changed"
  | "procurement_order_draft_created"
  | "procurement_order_placed"
  | "hr_item_status_changed"
  | "hr_item_assignees_changed"
  | "hr_payment_created"
  | "hr_filter_changed"
  | "pricing_page_viewed"
  | "billing_panel_compare_plans_clicked"
  | "billing_panel_upgrade_clicked"
  | "plans_dialog_plan_selected"
  | "billing_downgrade_scheduled"
  | "billing_downgrade_cleared"
  | "quota_gate_upgrade_clicked"
  | "tier_lock_cta_clicked"
  | "billing_plan_selected"
  | "billing_checkout_started"
  | "billing_init_payment_succeeded"
  | "billing_init_payment_failed"
  | "billing_payment_confirmed"
  | "billing_payment_failed"
  | "billing_auto_renew_toggled"
  | "billing_subscription_cancel_requested"
  | "promo_redeem_link_clicked"
  | "promo_redeem_page_viewed"
  | "promo_redeem_attempted"
  | "upgrade_prompt_shown"
  | "documents_page_opened"
  | "document_opened"
  | "document_uploaded"
  | "media_uploaded"
  | "ai_answer_saved_to_documents"
  | "ai_sidebar_opened"
  | "ai_prompt_submitted"
  | "ai_response_received"
  | "ai_proposal_generated"
  | "ai_proposal_revised"
  | "ai_proposal_applied"
  | "ai_proposal_rejected"
  | "ai_live_text_completed"
  // ─── New events added during Mixpanel → Yandex Metrika migration (2026-06).
  // Call sites for these will be wired in a follow-up step.
  | "estimate_created_empty"
  | "estimate_first_resource_added"
  | "estimate_constructor_opened"
  | "ai_photo_analyzed"
  | "custom_catalog_created"
  | "custom_estimate_template_created"
  // ─── Task status transitions (2026-06). One marker event per terminal
  // status the user moves a task into. Payload includes `from_status` for
  // funnel breakdown ("how often does in_progress → done vs in_progress → blocked").
  | "task_marked_in_progress"
  | "task_marked_done"
  | "task_marked_blocked"
  // ─── Registered call sites that were missing from the union (2026-07). These
  // events already fire in code; they were never added here because the
  // `typecheck` script was a no-op (solution-style tsconfig checked 0 files).
  // Sources: ChangePaymentMethodDialog, BrigadeAiFeature, legal/* pages.
  | "billing_change_card_started"
  | "billing_change_card_succeeded"
  | "portfolio_feature_upgrade_clicked"
  | "legal_contacts_viewed"
  | "legal_offer_viewed"
  | "legal_privacy_viewed"
  | "legal_refund_viewed"
  // ─── User Catalog Upload v1 (2026-07). Measurement contract from the spec:
  // template download → upload → save funnel + editor/estimate usage signals.
  | "catalog_template_downloaded"
  | "catalog_uploaded"
  | "catalog_saved"
  | "catalog_row_edited"
  | "catalog_item_used_in_estimate"
  // ─── Participants management redesign (2026-07, PRD roles & access UX v1).
  // Measurement contract: time-to-invite (drawer_opened → invite_sent),
  // preset-sufficiency (invite_sent.manual_axes), sensitive-grant funnel,
  // reset-to-role usage — all gates for the v2 per-capability decision.
  | "participants_invite_drawer_opened"
  | "participants_invite_sent"
  | "participants_access_updated"
  | "participants_member_removed"
  | "participants_invite_revoked"
  | "participants_invite_resent"
  | "participants_role_preset_selected"
  | "participants_axes_reset_to_role"
  | "participants_sensitive_confirm_shown"
  | "participants_sensitive_confirm_accepted"
  | "participants_sensitive_confirm_cancelled"
  | "participants_seat_paywall_shown"
  // ─── Observability v1 (2026-07): signup/activation/catalog/constructor
  // funnels from the observability spec (R-6). Metrika composite goals are
  // built from these — the goal list lives in docs/observability/setup.md.
  // Spec-name mapping where an event already existed:
  //   template_downloaded → catalog_template_downloaded (2026-07, above)
  //   constructor_opened  → estimate_constructor_opened (2026-06, above)
  //   estimate_saved_from_constructor → deliberately not distinct: the
  //     estimate autosaves; covered by template_applied /
  //     work_applied_via_constructor + estimate_saved_first_time.
  | "landing_view"
  | "registration_start"
  | "registration_complete"
  | "email_verified"
  | "first_login"
  | "project_created"
  | "template_applied"
  | "estimate_saved_first_time"
  | "catalog_tab_visit"
  | "catalog_editor_opened"
  | "library_searched"
  | "work_applied_via_constructor"
  | "feedback_submitted"
  // ─── Demo funnel (2026-07): the demo is a sandboxed mockup, not an account.
  // Entered from the landing/blog "Посмотреть демо" CTAs; exited via the
  // explicit "Выйти из демо" control; the signup CTA is the demo→registration
  // bridge (feeds the landing_view → registration_start composite funnel).
  | "demo_entered"
  | "demo_exited"
  | "demo_signup_cta_clicked"
  // ─── Grounded sidebar opener, phase 0 baseline (2026-08). Fires once per AI
  // thread, on the message that starts it, carrying whether that message came
  // from a suggestion chip or was typed. Collected for two weeks BEFORE the
  // opener ships so its own click-through has a comparison point; see
  // rovno-docs/specs/rovno-ai-sidebar-opener-prd.md requirement 6.10.
  | "ai_thread_first_move"
  // ─── Grounded sidebar opener (2026-08). One per appearance of the block, so
  // `ai_thread_first_move` divided by this is its click-through. The first-move
  // event carries the same `opener_shown_id`, which is what links the two; it is
  // deliberately the SAME event the phase-0 baseline collected, so before and
  // after are one series rather than two.
  | "ai_opener_shown";

export type AnalyticsEventPayload = Record<string, unknown>;

/**
 * Product analytics provider: Yandex Metrika.
 *
 * History: this module previously used Mixpanel (api-eu.mixpanel.com).
 * Migrated to Yandex Metrika in 2026-06 to comply with 152-ФЗ
 * (personal-data localization) — see project_analytics_migration memory.
 *
 * The public API (`trackEvent`, `setAnalyticsUserId`, `AnalyticsEventName`)
 * is preserved unchanged so call sites do not need to be touched.
 *
 * The counter ID comes from `VITE_METRIKA_COUNTER_ID` (see `METRIKA_COUNTER_ID`
 * below); the tag itself is bootstrapped by `initMetrika()`, called once from
 * `main.tsx`. Per-route SPA hits are emitted by `MetrikaPageviewTracker`.
 * When no counter is configured, everything in this module is an inert no-op.
 */

/**
 * Single source of truth for the Metrika counter ID, read once from the
 * per-environment env var (prod / staging / dev each get their own counter,
 * so non-prod traffic never lands in the production counter).
 *
 * `null` when the env var is empty or missing — in that case Metrika is fully
 * disabled: `initMetrika()` injects nothing and `trackEvent` / pageviews no-op.
 */
export const METRIKA_COUNTER_ID: number | null = (() => {
  const raw = import.meta.env.VITE_METRIKA_COUNTER_ID;
  if (raw === undefined || raw === null || `${raw}`.trim() === "") return null;
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
})();

type YandexMetrikaFn = ((counterId: number, action: string, ...args: unknown[]) => void) & {
  a?: unknown[];
  l?: number;
};

declare global {
  interface Window {
    ym?: YandexMetrikaFn;
  }
}

const SESSION_ID =
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `session-${Date.now()}`;

let currentUserId: string | null = null;

export function setAnalyticsUserId(userId: string | null): void {
  currentUserId = userId;

  if (METRIKA_COUNTER_ID === null) return;

  if (typeof window === "undefined" || typeof window.ym !== "function") {
    // ym is queued by the Metrika snippet, so calls before tag.js loads
    // are normally buffered. Bail out only if the snippet itself is missing.
    return;
  }

  if (!userId) {
    // Metrika has no explicit "logout" call. Future events from this
    // browser will simply stop carrying a UserID until setAnalyticsUserId
    // is called again with a new value.
    return;
  }

  try {
    window.ym(METRIKA_COUNTER_ID, "setUserID", userId);
  } catch (error) {
    console.warn("[analytics] Metrika setUserID failed:", error);
  }
}

function getAnalyticsIdentity() {
  return {
    user_id: currentUserId ?? "anonymous",
    session_id: SESSION_ID,
  };
}

export function trackEvent(
  event: AnalyticsEventName,
  payload: AnalyticsEventPayload = {},
): void {
  const identity = getAnalyticsIdentity();
  const fullPayload = { ...identity, ...payload };

  if (import.meta.env.DEV) {
    console.info("[analytics]", event, fullPayload);
  }

  if (METRIKA_COUNTER_ID === null) return;

  if (typeof window === "undefined" || typeof window.ym !== "function") {
    return;
  }

  try {
    window.ym(METRIKA_COUNTER_ID, "reachGoal", event, fullPayload);
  } catch (error) {
    console.warn("[analytics] Metrika reachGoal failed:", error);
  }
}

const ONCE_PER_USER_PREFIX = "analytics-once";

/**
 * Fire an event at most once per user per browser (localStorage-guarded).
 * For first-time activation markers (e.g. `estimate_saved_first_time`) where
 * the backend keeps no dedicated flag. Cross-device duplicates are an
 * accepted approximation; when storage is unavailable a duplicate beats
 * losing the signal.
 */
export function trackEventOncePerUser(
  event: AnalyticsEventName,
  payload: AnalyticsEventPayload = {},
): void {
  if (typeof window === "undefined") return;
  const key = `${ONCE_PER_USER_PREFIX}:${event}:${currentUserId ?? "anonymous"}`;
  try {
    if (localStorage.getItem(key) !== null) return;
    localStorage.setItem(key, new Date().toISOString());
  } catch {
    // Storage unavailable (private mode / quota) — fall through and fire.
  }
  trackEvent(event, payload);
}

const firedThisSession = new Set<AnalyticsEventName>();

/**
 * Fire an event at most once per page session (in-memory guard). For
 * high-frequency funnel steps (e.g. `library_searched` fires per keystroke
 * otherwise) where the funnel only needs "did it happen this session".
 */
export function trackEventOncePerSession(
  event: AnalyticsEventName,
  payload: AnalyticsEventPayload = {},
): void {
  if (firedThisSession.has(event)) return;
  firedThisSession.add(event);
  trackEvent(event, payload);
}

/**
 * Query parameters allowed through to Metrika, by exact name or by prefix.
 * An allowlist rather than a denylist: this app puts one-time credentials,
 * e-mail addresses and promo codes in the query string, and a denylist would
 * leak the next such parameter by default.
 */
const ANALYTICS_QUERY_ALLOWED_KEYS = new Set(["lang", "from", "yclid", "ymclid", "gclid", "_openstat"]);
const ANALYTICS_QUERY_ALLOWED_PREFIXES = ["utm_"];

/**
 * The pageview URL handed to Metrika: origin + path + allowlisted query, never
 * the fragment. Metrika transmits the URL it is given verbatim.
 */
export function analyticsPageUrl(): string {
  const { origin, pathname, search } = window.location;
  const kept = new URLSearchParams();
  for (const [key, value] of new URLSearchParams(search)) {
    const allowed =
      ANALYTICS_QUERY_ALLOWED_KEYS.has(key) ||
      ANALYTICS_QUERY_ALLOWED_PREFIXES.some((prefix) => key.startsWith(prefix));
    if (allowed) kept.append(key, value);
  }
  const query = kept.toString();
  return `${origin}${pathname}${query === "" ? "" : `?${query}`}`;
}

/**
 * Parameter names that can establish a session. Supabase carries them in the
 * fragment (implicit grant) or in the query (`/auth/confirm?token_hash=…`, the
 * fallback link in the confirmation e-mail template), and `parseParametersFromURL`
 * reads both.
 *
 * `code` is deliberately absent: PKCE is not in use, and `code` is also the
 * promo-redeem parameter, which must not stall analytics forever.
 */
const AUTH_CREDENTIAL_KEYS = [
  "access_token",
  "refresh_token",
  "provider_token",
  "provider_refresh_token",
  "token_hash",
  "token",
] as const;

function carriesCredential(params: URLSearchParams): boolean {
  return AUTH_CREDENTIAL_KEYS.some((key) => (params.get(key) ?? "") !== "");
}

function urlCarriesAuthCredential(): boolean {
  const { hash, search } = window.location;
  return (
    carriesCredential(new URLSearchParams(hash.replace(/^#/, ""))) ||
    carriesCredential(new URLSearchParams(search))
  );
}

const AUTH_CREDENTIAL_POLL_INTERVAL_MS = 100;
/**
 * When to stop waiting for the credential to leave the address bar. A failed
 * landing never clears it, so the wait needs an end. `ensureMetrikaStarted()`
 * is what recovers from here, so giving up costs the current page view rather
 * than the whole session.
 */
const AUTH_CREDENTIAL_POLL_TIMEOUT_MS = 10_000;

/**
 * Bootstrap the Yandex Metrika tag. Call exactly once at app startup
 * (`main.tsx`), before the first render.
 *
 * The body is gated on the raw env var, which Vite statically replaces at
 * build time, so when no counter is configured esbuild dead-code-eliminates
 * this whole loader from the bundle — no `mc.yandex.ru` request, no init.
 *
 * Sanitising the `url` we pass is not enough on its own while the credential is
 * still in the address bar: `tag.js` reads `location.href` itself for clickmap
 * beacons (v2610, module `clm.p`: `p = kd(a).href`, sent as `page-url` to
 * `mc.yandex.ru/clmap/<id>`), a value the `url` option does not feed. So the tag
 * is not loaded at all until the credential is gone.
 *
 * Polled rather than driven by `hashchange`, so that the check does not depend
 * on how the credential is removed or on which part of the URL holds it.
 */
export function initMetrika(): void {
  if (!import.meta.env.VITE_METRIKA_COUNTER_ID) return;
  if (METRIKA_COUNTER_ID === null) return;
  if (typeof window === "undefined" || typeof document === "undefined") return;

  // Install the command queue immediately, even while waiting: it makes no
  // network call, and without it trackEvent() drops every event fired before
  // the tag loads (AuthCallback fires email_verified in exactly that window).
  ensureYmQueue();

  if (!urlCarriesAuthCredential()) {
    bootstrapMetrika();
    return;
  }

  const startedAt = Date.now();
  const timer = window.setInterval(() => {
    if (!urlCarriesAuthCredential()) {
      window.clearInterval(timer);
      bootstrapMetrika();
      return;
    }
    if (Date.now() - startedAt >= AUTH_CREDENTIAL_POLL_TIMEOUT_MS) {
      window.clearInterval(timer);
    }
  }, AUTH_CREDENTIAL_POLL_INTERVAL_MS);
}

/**
 * Start Metrika if it is not running yet and the address bar is clean. Called on
 * every SPA navigation, so a landing whose credential never cleared costs that
 * page view rather than the rest of the session.
 */
export function ensureMetrikaStarted(): void {
  if (!import.meta.env.VITE_METRIKA_COUNTER_ID) return;
  if (METRIKA_COUNTER_ID === null) return;
  if (typeof window === "undefined" || typeof document === "undefined") return;
  if (metrikaStarted) return;
  if (urlCarriesAuthCredential()) return;

  bootstrapMetrika();
}

function ensureYmQueue(): YandexMetrikaFn {
  const w = window;
  // The official snippet's queue, so calls issued before tag.js finishes
  // loading are buffered rather than dropped.
  return (w.ym =
    w.ym ||
    function (...args: unknown[]) {
      (w.ym!.a = w.ym!.a || []).push(args);
    });
}

let metrikaStarted = false;

/**
 * Session replay is deliberately disabled below: it records PII and is gated
 * behind a separate consent + field-masking workstream (152-ФЗ). Only
 * clickmap / accurateTrackBounce / trackLinks remain on.
 */
function bootstrapMetrika(): void {
  if (METRIKA_COUNTER_ID === null) return;
  if (metrikaStarted) return;

  const counterId = METRIKA_COUNTER_ID;
  const src = `https://mc.yandex.ru/metrika/tag.js?id=${counterId}`;

  // The module-scope flag resets on an HMR reload, so still check the DOM.
  const existingScripts = document.getElementsByTagName("script");
  for (let i = 0; i < existingScripts.length; i++) {
    if (existingScripts[i].src === src) return;
  }
  metrikaStarted = true;

  const ym = ensureYmQueue();
  ym.l = Date.now();

  // tag.js replays the queue in order, so anything buffered while we waited has
  // to be re-queued behind init or it lands on a counter that does not exist.
  const buffered = (ym.a ?? []) as unknown[][];
  ym.a = [];

  const script = document.createElement("script");
  script.async = true;
  script.src = src;
  const firstScript = document.getElementsByTagName("script")[0];
  if (firstScript?.parentNode) {
    firstScript.parentNode.insertBefore(script, firstScript);
  } else {
    document.head.appendChild(script);
  }

  ym(counterId, "init", {
    webvisor: false,
    clickmap: true,
    accurateTrackBounce: true,
    trackLinks: true,
    referrer: document.referrer,
    url: analyticsPageUrl(),
  });

  for (const args of buffered) {
    (ym as (...a: unknown[]) => void)(...args);
  }
}
