import { useTranslation } from "react-i18next";
import { BrainCircuit, Eye, EyeOff, Pencil } from "lucide-react";
import {
  computeAccessPreview,
  type ParticipantAxes,
} from "@/lib/participant-access-preview";
import type { MemberRole } from "@/types/entities";

const STATE_META = {
  edits: { icon: Pencil, labelKey: "participants.preview.state.edits", className: "text-success" },
  views: { icon: Eye, labelKey: "participants.preview.state.views", className: "text-info" },
  hidden: { icon: EyeOff, labelKey: "participants.preview.state.hidden", className: "text-muted-foreground" },
} as const;

type AccessPreviewPanelProps = {
  name?: string;
  role: MemberRole;
  axes: ParticipantAxes;
  className?: string;
};

/**
 * Live "what will this person see" summary (PRD P0-3). Recomputes on every
 * role/axis change — no save required.
 */
export function AccessPreviewPanel({ name, role, axes, className }: AccessPreviewPanelProps) {
  const { t } = useTranslation();
  const items = computeAccessPreview({ role, axes });

  return (
    <div className={className}>
      <p className="text-caption font-medium text-foreground">
        {name
          ? t("participants.preview.title", { name })
          : t("participants.preview.titleGeneric")}
      </p>
      <ul className="mt-2 divide-y divide-border/50 rounded-card border border-border bg-card">
        {items.map((item) => {
          const meta = STATE_META[item.state];
          const StateIcon = item.key === "ai" && item.state !== "hidden" ? BrainCircuit : meta.icon;
          return (
            <li key={item.key} className="flex items-center justify-between gap-3 px-3 py-1.5">
              <span className={`text-caption ${item.state === "hidden" ? "text-muted-foreground" : "text-foreground"}`}>
                {t(item.labelKey)}
              </span>
              <span className={`flex shrink-0 items-center gap-1.5 text-caption ${meta.className}`}>
                <StateIcon className="h-3.5 w-3.5" />
                {t(item.stateLabelKey ?? meta.labelKey)}
                {item.detailKey && (
                  <span className="text-muted-foreground">
                    · {t(item.detailKey, item.detailParams)}
                  </span>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
