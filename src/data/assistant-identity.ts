// Identity of the in-app AI assistant — the avatar image, and the Telegram
// channel he invites users to. The display NAME is not here on purpose: it is
// user-facing copy and therefore lives in i18n under `ai.assistant.name`, so
// that a Russian and an English surface can spell it differently.
//
// The same character also fronts the Telegram bot (rovno-bots), so whatever is
// shipped here should be the image set on the bot profile via BotFather
// `/setuserpic`. One helper, two channels — see vladosda0/rovno-bots#3.

// Served from `public/`, so this is a root-absolute URL, not a bundler import.
// Keeping it out of the module graph means a missing file degrades to the
// <Bot> fallback in AssistantAvatar instead of failing the build.
export const ASSISTANT_AVATAR_SRC = "/assistant/shurik.png";

// Shurik's own channel. Rendered as an invitation in the sidebar greeting and
// in the bot's welcome copy; deliberately a plain constant rather than env
// config, because unlike the bot handle it is the same in every environment.
export const ASSISTANT_TELEGRAM_CHANNEL_URL = "https://t.me/ai_v_stroike";
