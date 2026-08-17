/// <reference types="vite/client" />

/**
 * Git commit SHA injected at build time via `define` in vite.config.ts.
 * "unknown" when built outside a git checkout without VITE_COMMIT_SHA.
 */
declare const __APP_RELEASE__: string;

interface ImportMetaEnv {
  /** Set to `1` or `true` to enable Wave 1 live text assistant (mock client until backend). */
  readonly VITE_AI_LIVE_TEXT_ASSISTANT?: string;
  /** Set to `0`, `false`, `no` or `off` to disable the grounded AI sidebar opener. */
  readonly VITE_AI_SIDEBAR_OPENER?: string;
  /** Sentry DSN for error tracking. Empty/unset disables Sentry entirely. */
  readonly VITE_SENTRY_DSN?: string;
  /** Set to `"true"` to show Settings → Интеграции (Telegram linking). Also
   *  requires VITE_TELEGRAM_BOT_USERNAME; either one alone keeps the tab hidden. */
  readonly VITE_TELEGRAM_LINKING_ENABLED?: string;
  /** Handle of the bot serving THIS environment's database, without "@"
   *  (staging `rovno_ai_bot`, prod `rovnoai_bot`). */
  readonly VITE_TELEGRAM_BOT_USERNAME?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
