import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

type StatusVariant = "task" | "estimate" | "procurement";

interface StatusBadgeProps {
  status: string;
  variant: StatusVariant;
  className?: string;
}

const statusStyles: Record<StatusVariant, Record<string, string>> = {
  task: {
    "Not started": "bg-muted text-muted-foreground",
    "In progress": "bg-info/15 text-info",
    "Done": "bg-success/15 text-success",
    "Blocked": "bg-destructive/15 text-destructive",
  },
  estimate: {
    "Draft": "bg-muted text-muted-foreground",
    "Approved": "bg-success/15 text-success",
    "Archived": "border border-border text-muted-foreground bg-transparent",
  },
  procurement: {
    "To buy": "bg-warning/15 text-warning-foreground",
    "Ordered": "bg-info/15 text-info",
    // A part-delivered order is still in flight, so it shares the 'Ordered' tint.
    // NOTE: this map is keyed on ENGLISH label text while the procurement callers pass an
    // already-translated label, so this entry only takes effect in the English locale. In
    // Russian (the default) every procurement badge here already falls through to the grey
    // default. That is pre-existing and affects all five order statuses equally; fixing it
    // means keying on the raw status token, which recolours the other badges too.
    "Partially received": "bg-info/15 text-info",
    "In stock": "bg-success/15 text-success",
    "Voided": "bg-muted text-muted-foreground",
    "Not purchased": "bg-muted text-muted-foreground",
    "Purchased": "bg-success/15 text-success",
  },
};

const statusI18nKey: Record<string, string> = {
  "Not started": "status.notStarted",
  "In progress": "status.inProgress",
  "Done": "status.done",
  "Blocked": "status.blocked",
  "Draft": "status.draft",
  "Approved": "status.approved",
  "Archived": "status.archived",
  "To buy": "status.toBuy",
  "Ordered": "status.ordered",
  "In stock": "status.inStock",
  "Voided": "status.voided",
  "Not purchased": "status.notPurchased",
  "Purchased": "status.purchased",
};

export function StatusBadge({ status, variant, className }: StatusBadgeProps) {
  const { t } = useTranslation();
  const style = statusStyles[variant]?.[status] ?? "bg-muted text-muted-foreground";
  const key = statusI18nKey[status];
  const label = key ? t(key, { defaultValue: status }) : status;

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-pill px-2.5 py-0.5 text-caption font-medium",
        style,
        className,
      )}
    >
      {label}
    </span>
  );
}
