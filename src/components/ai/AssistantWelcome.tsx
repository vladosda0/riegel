import { Send } from "lucide-react";
import { useTranslation } from "react-i18next";
import { AssistantAvatar } from "@/components/ai/AssistantAvatar";
import { ASSISTANT_TELEGRAM_CHANNEL_URL } from "@/data/assistant-identity";

// Order matters: these read as a short pitch, widest-value first, and the
// sidebar is narrow enough that anything past five lines starts to scroll.
const CAPABILITY_KEYS = [
  "ai.sidebar.welcome.canDo.estimate",
  "ai.sidebar.welcome.canDo.procurement",
  "ai.sidebar.welcome.canDo.tasks",
  "ai.sidebar.welcome.canDo.photo",
  "ai.sidebar.welcome.canDo.documents",
] as const;

/**
 * First thing a user sees in an empty AI sidebar: who the assistant is, what he
 * can be asked for, and an invitation to his Telegram channel.
 *
 * Replaces the bare "Пока нет активности" line, which stated a fact about the
 * feed and told a first-time user nothing about the product (rovno-bots#2 and
 * rovno-bots#3, both split out of the proposals-scope epic rovno#299).
 */
export function AssistantWelcome() {
  const { t } = useTranslation();
  const name = t("ai.assistant.name");

  return (
    <div className="glass rounded-card px-3 py-4 space-y-3 min-w-0 max-w-full">
      <div className="flex items-center gap-2 min-w-0">
        <AssistantAvatar className="h-11 w-11" iconClassName="h-6 w-6" decorative />
        <div className="min-w-0">
          <p className="text-body-sm font-semibold text-foreground truncate">
            {t("ai.sidebar.welcome.title", { name })}
          </p>
          <p className="text-caption text-muted-foreground">{t("ai.assistant.role")}</p>
        </div>
      </div>

      <p className="text-caption text-foreground/90">{t("ai.sidebar.welcome.intro")}</p>

      <div className="space-y-1">
        <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {t("ai.sidebar.welcome.canDoTitle")}
        </p>
        <ul className="space-y-1">
          {CAPABILITY_KEYS.map((key) => (
            <li key={key} className="flex gap-1.5 text-caption text-foreground/90">
              <span aria-hidden="true" className="text-accent">•</span>
              <span className="min-w-0 [overflow-wrap:anywhere]">{t(key)}</span>
            </li>
          ))}
        </ul>
      </div>

      <p className="text-caption text-muted-foreground">{t("ai.sidebar.welcome.hint")}</p>

      <div className="rounded-card border border-accent/30 bg-accent/5 px-2.5 py-2 space-y-1.5">
        <p className="text-caption text-foreground/90">{t("ai.sidebar.welcome.channelLead")}</p>
        <a
          href={ASSISTANT_TELEGRAM_CHANNEL_URL}
          target="_blank"
          rel="noreferrer noopener"
          aria-label={t("ai.sidebar.welcome.channelAria", { name })}
          className="inline-flex items-center gap-1.5 rounded-pill bg-accent px-2.5 py-1 text-caption font-medium text-accent-foreground hover:bg-accent/90"
        >
          <Send className="h-3 w-3 shrink-0" aria-hidden="true" />
          {t("ai.sidebar.welcome.channelCta")}
        </a>
      </div>
    </div>
  );
}
