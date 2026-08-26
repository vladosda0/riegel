import {
  Activity, Bot, Calculator, CheckCircle2, ClipboardList, FileText, GitBranch,
  Image, MessageSquare, Plus, ShoppingCart, Users, XCircle, type LucideIcon,
} from "lucide-react";
import { EVENT_TYPES, type EventType } from "@/types/entities";

export interface EventCatalogEntry {
  /** i18n key holding the caption, e.g. "создал{{a}} задачу". */
  labelKey: string;
  icon: LucideIcon;
}

const FALLBACK_KEY = "activity.event.unknown";

export function eventLabelKey(type: string): string {
  return `activity.event.${type}`;
}

const icons: Record<EventType, LucideIcon> = {
  task_created: Plus,
  task_updated: ClipboardList,
  task_completed: CheckCircle2,
  task_moved: GitBranch,
  estimate_created: Calculator,
  estimate_approved: CheckCircle2,
  estimate_archived: Calculator,
  estimate_deleted: XCircle,
  estimate_paid_updated: Calculator,
  "estimate.version_submitted": Calculator,
  "estimate.version_approved": CheckCircle2,
  "estimate.status_changed": Activity,
  "estimate.tax_changed": Calculator,
  "estimate.discount_changed": Calculator,
  "estimate.dependency_added": GitBranch,
  "estimate.dependency_removed": XCircle,
  "estimate.viewer_regime_set": Users,
  "estimate.project_mode_set": Activity,
  procurement_created: ShoppingCart,
  procurement_updated: ShoppingCart,
  procurement_deleted: XCircle,
  document_created: FileText,
  "document.created": FileText,
  document_version_created: FileText,
  document_archived: FileText,
  document_deleted: XCircle,
  document_acknowledged: FileText,
  document_uploaded: FileText,
  photo_deleted: XCircle,
  photo_uploaded: Image,
  contractor_proposal_submitted: Calculator,
  contractor_proposal_accepted: CheckCircle2,
  contractor_proposal_rejected: XCircle,
  member_added: Users,
  comment_added: MessageSquare,
  stage_created: Plus,
  stage_completed: CheckCircle2,
  stage_deleted: XCircle,
  proposal_confirmed: CheckCircle2,
  proposal_cancelled: XCircle,
  project_created: Plus,
};

export const EVENT_CATALOG: Record<EventType, EventCatalogEntry> = Object.fromEntries(
  EVENT_TYPES.map((type) => [type, { labelKey: eventLabelKey(type), icon: icons[type] }]),
) as Record<EventType, EventCatalogEntry>;

function entryFor(type: string): EventCatalogEntry | undefined {
  return (EVENT_CATALOG as Record<string, EventCatalogEntry | undefined>)[type];
}

/** The i18n key an event type renders through. Exported for tests. */
export function getEventLabelKey(type: string): string {
  return entryFor(type)?.labelKey ?? FALLBACK_KEY;
}

export function getEventIcon(type: string, aiOrigin = false): LucideIcon {
  if (aiOrigin) return Bot;
  return entryFor(type)?.icon ?? Activity;
}

type Translate = (key: string, params?: Record<string, string>) => string;

/**
 * The one way to turn an event type into a caption.
 *
 * Russian past-tense agrees with the actor's gender and profiles carry no
 * gender field, so the template holds a slot the caller must fill; a caller
 * that resolved the key itself and forgot the slot would render the literal
 * "{{a}}" on screen. Keeping key and slot behind one call makes that
 * unreachable, and keeps the two surfaces from disagreeing about the same row.
 *
 * `feminineActor` is true only for the non-human fallback actor ("Система").
 * English ignores the slot.
 */
export function getEventCaption(t: Translate, type: string, feminineActor: boolean): string {
  return t(getEventLabelKey(type), { a: feminineActor ? "а" : "" });
}

/**
 * The one rule both feed surfaces use to pick the caption's gender, so they
 * cannot disagree about the same row. Only the non-human fallback actor
 * ("Система") is feminine: "ИИ" is masculine, and so is a person, until
 * profiles carry a gender field.
 */
export function isFallbackActor(aiOrigin: boolean, actorResolved: boolean): boolean {
  return !aiOrigin && !actorResolved;
}
