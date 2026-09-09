import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { usePermission, seamCanViewSensitiveDetail } from "@/lib/permissions";
import { getActivityDisplayDetail } from "@/lib/activity-display";
import { getEventGroupTimestampMs } from "@/lib/event-activity-timestamp";
import { getUserById } from "@/data/store";
import type { Event } from "@/types/entities";
import { isAIEvent } from "@/components/ai/event-utils";
import { getEventCaption, getEventIcon, isFallbackActor } from "@/lib/event-catalog";

function getEventRoute(evt: Event): string | null {
  const base = `/project/${evt.project_id}`;
  switch (evt.object_type) {
    case "task": return `${base}/tasks`;
    case "estimate_version": return `${base}/estimate`;
    case "estimate_v2_project": return `${base}/estimate`;
    case "procurement_item": return `${base}/procurement`;
    case "document": return `${base}/documents`;
    case "media": return `${base}/gallery`;
    default: return null;
  }
}

interface EventFeedItemProps {
  event: Event;
  compact?: boolean;
  highlighted?: boolean;
}

export function EventFeedItem({ event, compact, highlighted }: EventFeedItemProps) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const perm = usePermission(event.project_id);
  const actor = getUserById(event.actor_id);
  const detail = getActivityDisplayDetail(event, {
    canViewFinanceDetail: seamCanViewSensitiveDetail(perm.seam),
  });
  const route = getEventRoute(event);
  const isAiOrigin = isAIEvent(event);
  const Icon = getEventIcon(event.type, isAiOrigin);
  const fallbackActor = isFallbackActor(isAiOrigin, Boolean(actor));
  const actorLabel = isAiOrigin ? t("ai.event.actorAI") : (actor?.name ?? t("ai.event.actorSystem"));
  const caption = getEventCaption(t, event.type, fallbackActor);

  const handleClick = () => {
    if (route) navigate(route);
  };

  return (
    <button
      onClick={handleClick}
      disabled={!route}
      className={`flex items-start gap-2 w-full text-left rounded-lg px-2 py-1.5 transition-colors ${
        route ? "hover:bg-accent/10 cursor-pointer" : "cursor-default"
      } ${compact ? "py-1" : ""} ${highlighted ? "bg-destructive/15" : ""}`}
      style={{ transitionDuration: "2500ms" }}
    >
      <div className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md mt-0.5 ${
        isAiOrigin ? "bg-accent/10" : "bg-muted"
      }`}>
        <Icon className={`h-3.5 w-3.5 ${isAiOrigin ? "text-accent" : "text-muted-foreground"}`} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-caption leading-tight">
          <span className="font-medium text-foreground">{actorLabel}</span>
          <span className="text-muted-foreground"> {caption}</span>
        </p>
        {detail && <p className="text-caption text-muted-foreground truncate">{detail}</p>}
      </div>
      <span className="text-[10px] text-muted-foreground whitespace-nowrap mt-0.5 shrink-0">
        {new Date(getEventGroupTimestampMs(event)).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
      </span>
    </button>
  );
}
