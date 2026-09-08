import { useState } from "react";
import { Bot } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ASSISTANT_AVATAR_SRC } from "@/data/assistant-identity";

interface AssistantAvatarProps {
  /** Tailwind sizing for the circular frame, e.g. "h-6 w-6". */
  className?: string;
  /** Tailwind sizing for the fallback glyph, e.g. "h-3.5 w-3.5". */
  iconClassName?: string;
  /** Decorative next to a visible "Шурик" label; true drops it from the a11y tree. */
  decorative?: boolean;
}

/**
 * The assistant's face. Renders the mascot portrait, and falls back to the old
 * generic <Bot> glyph if the image is missing or fails to decode.
 *
 * The fallback is not defensive noise: `public/assistant/shurik.png` is an
 * asset a human drops in, not something the build produces, so a fresh clone or
 * a half-finished branch would otherwise render a broken-image icon in every
 * chat row. Failing back to the previous look keeps the sidebar shippable
 * independently of the artwork.
 */
export function AssistantAvatar({
  className = "h-6 w-6",
  iconClassName = "h-3.5 w-3.5",
  decorative = false,
}: AssistantAvatarProps) {
  const { t } = useTranslation();
  const [failed, setFailed] = useState(false);

  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-accent/10 ${className}`}
    >
      {failed ? (
        <Bot className={`${iconClassName} text-accent`} aria-hidden="true" />
      ) : (
        <img
          src={ASSISTANT_AVATAR_SRC}
          alt={decorative ? "" : t("ai.assistant.name")}
          aria-hidden={decorative ? "true" : undefined}
          className="h-full w-full object-cover"
          onError={() => setFailed(true)}
          draggable={false}
        />
      )}
    </span>
  );
}
