import { useTranslation } from "react-i18next";
import type { AIMessage } from "@/types/ai";
import { AssistantAvatar } from "./AssistantAvatar";
import { PreviewCard } from "./PreviewCard";
import { ActionBar } from "./ActionBar";

interface ChatMessageProps {
  message: AIMessage;
  onConfirm?: () => void;
  onCancel?: () => void;
  onNewVersion?: () => void;
}

export function ChatMessage({ message, onConfirm, onCancel, onNewVersion }: ChatMessageProps) {
  const { t } = useTranslation();
  const isUser = message.role === "user";
  const proposal = message.proposal;
  const isPending = proposal?.status === "pending";

  return (
    <div className={`flex gap-2 w-full min-w-0 ${isUser ? "justify-end" : "justify-start"}`}>
      {!isUser && <AssistantAvatar className="h-6 w-6 mt-0.5" iconClassName="h-3.5 w-3.5" />}
      <div className={`min-w-0 space-y-1.5 ${isUser ? "max-w-[85%] items-end ml-auto" : "flex-1"}`}>
        <div
          className={`rounded-card px-3 py-2 text-body-sm break-words ${
            isUser
              ? "bg-accent/10 text-foreground ml-auto w-fit max-w-full"
              : "glass text-foreground w-full"
          }`}
          style={{ overflowWrap: "anywhere" }}
        >
          {message.content}
        </div>
        {proposal && (
          <div className="space-y-1 w-full min-w-0">
            <PreviewCard summary={proposal.summary} changes={proposal.changes} />
            {isPending && onConfirm && onCancel && (
              <ActionBar
                onConfirm={onConfirm}
                onCancel={onCancel}
                onNewVersion={onNewVersion}
                showNewVersion={proposal.type === "update_estimate"}
              />
            )}
            {proposal.status === "confirmed" && (
              <span className="text-caption text-success">{t("ai.chat.confirmed")}</span>
            )}
            {proposal.status === "cancelled" && (
              <span className="text-caption text-muted-foreground">{t("ai.chat.cancelled")}</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
