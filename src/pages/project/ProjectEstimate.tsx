import { useQueryClient } from "@tanstack/react-query";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  Fragment,
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
} from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Download,
  ExternalLink,
  HardHat,
  House,
  Wrench,
  Info,
  Layers,
  Loader2,
  Pause,
  Plus,
  Trash2,
  User,
  type LucideIcon,
} from "lucide-react";
import { TutorialModal } from "@/components/onboarding/TutorialModal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmModal } from "@/components/ConfirmModal";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/EmptyState";
import { useToast } from "@/hooks/use-toast";
import { useIsMobile } from "@/hooks/use-mobile";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { AssigneeCell } from "@/components/estimate-v2/AssigneeCell";
import { EstimateFinanceHeader, type EstimateFinanceView } from "@/components/estimate-v2/EstimateFinanceHeader";
import { InlineEditableNumber } from "@/components/estimate-v2/InlineEditableNumber";
import { ResourceTypeBadge } from "@/components/estimate-v2/ResourceTypeBadge";
import {
  useHRItems,
  useHRPayments,
  useProcurementV2,
  useTasks,
} from "@/hooks/use-mock-data";
import { useLocations } from "@/hooks/use-inventory-data";
import {
  useWorkspaceCurrentUserState,
  useWorkspaceMode,
  useWorkspaceProjectInvites,
  useWorkspaceProjectMembersState,
  useWorkspaceProjectState,
} from "@/hooks/use-workspace-source";
import { trackEvent } from "@/lib/analytics";
import { buildCsvDocument, CSV_BOM } from "@/lib/csv";
import { useTierQuota } from "@/hooks/useTierQuota";
import { showTierLimitPaywallByType } from "@/lib/tier-limit-error";
import {
  approveVersion,
  clearEstimateV2ProjectAccessContext,
  computeVersionDiff,
  createLine,
  createStage,
  createVersionSnapshot,
  createWork,
  deleteLine,
  deleteStage,
  deleteWork,
  registerEstimateV2ProjectAccessContext,
  refreshVersionSnapshot,
  setProjectEstimateStatus,
  transitionEstimateV2ProjectToInWork,
  submitVersion,
  updateEstimateV2Project,
  updateLine,
  updateStage,
  updateWork,
} from "@/data/estimate-v2-store";
import { useEstimateV2Project } from "@/hooks/use-estimate-v2-data";
import type { EstimateV2ProjectSyncState } from "@/data/estimate-v2-store";
import { getPlanningSource } from "@/data/planning-source";
import { addEvent, getUserById } from "@/data/store";
import { createWorkspaceProjectInvite, sendWorkspaceProjectInviteEmail } from "@/data/workspace-source";
import { describeInviteCreateError, describeInviteSendError } from "@/lib/invite-error-copy";
import {
  computeEffectiveDiscountBps,
  computeEffectiveMarkupBps,
  computeEffectiveTaxBps,
  computeLineTotals,
  computeProjectTotals,
  computeStageTotals,
  displayLineClientAmounts,
  roundHalfUpDiv,
  type ComputeLineTotalsOptions,
  type EstimateLineClientDisplayMode,
} from "@/lib/estimate-v2/pricing";
import { SHOW_ESTIMATE_VERSION_UI } from "@/lib/estimate-v2/show-estimate-version-ui";
import { canPublishClientShare, resolveProjectEstimateCtaState } from "@/lib/estimate-v2/project-estimate-cta";
import { getDefaultFinanceVisibility } from "@/lib/participant-role-policy";
import {
  combinePlanFact,
  computeFactFromDataSources,
  computePlannedFromEstimateV2,
  hasActualFinancialData as hasActualFinancialDataFor,
} from "@/lib/estimate-v2/rollups";
import { fromDayIndex, toDayIndex } from "@/lib/estimate-v2/schedule";
import { computeEac, computeFinishedAccuracy } from "@/lib/estimate-v2/finance-insights";
import { useOrders } from "@/hooks/use-order-data";
import { activityQueryKeys } from "@/hooks/use-activity-source";
import { hrQueryKeys } from "@/hooks/use-hr-source";
import { planningQueryKeys } from "@/hooks/use-planning-source";
import { procurementProjectItemsQueryRoot } from "@/hooks/use-procurement-source";
import {
  getProjectDomainAccess,
  projectDomainAllowsView,
  projectDomainAllowsManage,
  seamAllowsEstimateExportCsv,
  seamCanViewOperationalFinanceSummary,
  seamCanViewSensitiveDetail,
  seamEstimateFinanceVisibilityMode,
  usePermission,
} from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { publishEstimateShareSnapshot } from "@/data/estimate-share-source";
import { ApprovalStampCard } from "@/components/estimate-v2/ApprovalStampCard";
import { ApprovalStampFormModal } from "@/components/estimate-v2/ApprovalStampFormModal";
import { EstimateExportModal } from "@/components/estimate-v2/EstimateExportModal";
import { ResourceModal } from "@/components/estimate-v2/ResourceModal";
import { LibraryNameInput } from "@/components/estimate-v2/LibraryNameInput";
import type { CanonicalSuggestion } from "@/hooks/use-canonical-search";
import type { CatalogResource } from "@/hooks/use-canonical-catalog";
import type { UserCatalogItem } from "@/types/user-catalog";
import { EstimateConstructor } from "@/components/estimate-v2/EstimateConstructor";
import { useCurrentEstimateVersionId } from "@/hooks/use-current-estimate-version";
import type {
  ExportLineRow,
  ExportPayload,
  ExportStageGroup,
  ExportWorkGroup,
} from "@/lib/estimate-export-data";
import { VersionBanner } from "@/components/estimate-v2/VersionBanner";
import { VersionDiffList } from "@/components/estimate-v2/VersionDiffList";
import { EstimateGantt } from "@/components/estimate-v2/gantt/EstimateGantt";
import {
  buildUnitSelectOptions,
  CUSTOM_UNIT_SENTINEL,
  getUnitLabel,
  getUnitOptionsForType,
  resolveUnitSelectValue,
} from "@/lib/estimate-v2/resource-units";
import { buildDefaultResourceLineName, getDefaultResourceLinePrefix } from "@/lib/estimate-v2/default-resource-line-name";
import {
  parsePersistedEstimateResourceType,
  resourceLineSemanticLabel,
  resourceLineTypeFromPersisted,
} from "@/lib/estimate-v2/resource-type-contract";
import {
  assessResourceDelete,
  assessStageDelete,
  assessWorkDelete,
  getNextDeleteStep,
  type DeleteAssessment,
  type DeleteDialogStep,
} from "@/lib/estimate-v2/delete-safeguards";
import type {
  ApprovalStamp,
  EstimateV2ResourceLine,
  EstimateV2Stage,
  EstimateV2Version,
  EstimateV2Work,
  EstimateExecutionStatus,
  ResourceLineType,
} from "@/types/estimate-v2";
import type { Task, UserPlan } from "@/types/entities";

type ChecklistFallbackEstimateRow = {
  id: string;
  workId: string;
  title: string;
  type: ResourceLineType;
  typeLabel: string | null;
  qtyMilli: number | null;
  unit: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  assigneeEmail: string | null;
};

function money(cents: number, currency: string): string {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

function qtyFromMilli(qtyMilli: number): string {
  return (qtyMilli / 1000).toString();
}

function toQtyMilli(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 1000;
  return Math.max(1, Math.round(parsed * 1000));
}

function toCentsFromMajor(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.max(0, Math.round(parsed * 100));
}

function toBpsFromPercent(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.min(10_000, Math.max(0, Math.round(parsed * 100)));
}

function fromBpsToPercent(bps: number): string {
  return (bps / 100).toString();
}

function labelForType(type: ResourceLineType): string {
  return resourceLineSemanticLabel(type);
}

function semanticLabelKeyForType(type: ResourceLineType): string {
  return `estimate.resource.semantic.${type}`;
}

function labelForRpcResourceTypeKey(key: string, t: (k: string) => string): string {
  const parsed = parsePersistedEstimateResourceType(key);
  return parsed.ok ? t(semanticLabelKeyForType(resourceLineTypeFromPersisted(parsed.db))) : key;
}

function isAssignableResourceType(type: ResourceLineType): boolean {
  return type === "labor" || type === "subcontractor";
}

function resolveChecklistFallbackRowType(task: Task, checklistIndex: number): ResourceLineType | null {
  const checklistItem = task.checklist[checklistIndex];
  if (!checklistItem) return null;
  if (checklistItem.estimateV2ResourceType) return checklistItem.estimateV2ResourceType;
  if (checklistItem.type === "material") return "material";
  if (checklistItem.type === "tool") return "tool";
  if (checklistItem.estimateV2LineId || checklistItem.estimateV2WorkId) return "other";
  return null;
}

function resolveChecklistFallbackRowLabel(task: Task, checklistIndex: number): string | null {
  const checklistItem = task.checklist[checklistIndex];
  if (!checklistItem) return null;
  if (checklistItem.estimateV2ResourceType) return null;
  return null;
}

function resolveTaskAssignee(task: Task): {
  assigneeId: string | null;
  assigneeName: string | null;
  assigneeEmail: string | null;
} {
  const fromList = task.assignees?.length
    ? (
      task.assignee_id
        ? task.assignees.find((entry) => entry.id === task.assignee_id)
        : task.assignees.find((entry) => entry.name?.trim() || entry.email?.trim())
    ) ?? task.assignees[0]
    : null;

  if (fromList) {
    const user = fromList.id ? getUserById(fromList.id) : null;
    return {
      assigneeId: fromList.id ?? null,
      assigneeName: fromList.name?.trim() || user?.name || null,
      assigneeEmail: fromList.email?.trim() || user?.email || null,
    };
  }

  const user = task.assignee_id ? getUserById(task.assignee_id) : null;
  return {
    assigneeId: task.assignee_id || null,
    assigneeName: user?.name ?? null,
    assigneeEmail: user?.email ?? null,
  };
}

function buildHierarchyNumbers(
  sortedStages: EstimateV2Stage[],
  worksByStage: Map<string, EstimateV2Work[]>,
): {
  stageNumberById: Map<string, number>;
  workNumberById: Map<string, string>;
} {
  const stageNumberById = new Map<string, number>();
  const workNumberById = new Map<string, string>();

  sortedStages.forEach((stage, stageIndex) => {
    const stageNumber = stageIndex + 1;
    stageNumberById.set(stage.id, stageNumber);

    const stageWorks = worksByStage.get(stage.id) ?? [];
    stageWorks.forEach((work, workIndex) => {
      workNumberById.set(work.id, `${stageNumber}.${workIndex + 1}`);
    });
  });

  return { stageNumberById, workNumberById };
}

/**
 * Display-side wrappers over the pricing resolvers. They exist only to adapt the
 * call shape: the screen has a bare `projectXBps` number where pricing wants the
 * project object.
 *
 * They DELEGATE rather than reimplement, deliberately. Two earlier revisions of
 * this PR wrote the resolution rule out a second time here and it drifted both
 * times: first with no clamp at all (an out-of-band value printed raw while
 * pricing charged the clamped figure), then with a hand-rolled
 * `Math.max(0, Math.min(10_000, raw))` that still missed clampBps's rounding and
 * non-finite guard, so Infinity printed 100% against a charged 0% and 1250.6
 * printed 12.506% against a charged 12.51%.
 *
 * Whatever the table, the CSV and the PDF show must be the number the client is
 * actually charged. Delegation makes that structural instead of a promise: there
 * is one resolution rule and one clamp, and pricing.test.ts covers them.
 *
 * The discount resolver also has the deliberate absence of a stage tier: it used
 * to take a stage and discard it as `_stage`, advertising a capability neither
 * side implements (#207).
 */
function effectiveDiscountForDisplay(line: EstimateV2ResourceLine, projectDiscountBps: number): number {
  return computeEffectiveDiscountBps(line, { discountBps: projectDiscountBps });
}

function effectiveMarkupForDisplay(line: EstimateV2ResourceLine, projectMarkupBps: number): number {
  return computeEffectiveMarkupBps(line, { markupBps: projectMarkupBps });
}

function effectiveTaxForDisplay(line: EstimateV2ResourceLine, projectTaxBps: number): number {
  return computeEffectiveTaxBps(line, { taxBps: projectTaxBps });
}

function estimateStatusLabelKey(status: EstimateExecutionStatus): string {
  if (status === "planning") return "estimate.status.planning";
  if (status === "in_work") return "estimate.status.inWork";
  if (status === "paused") return "estimate.status.paused";
  return "estimate.status.finished";
}

function estimateStatusRailLabelKey(status: EstimateExecutionStatus, activeStatus: EstimateExecutionStatus): string {
  if (status === "in_work") {
    return activeStatus === "in_work" ? "estimate.status.rail.inWork" : "estimate.status.rail.startWork";
  }
  if (status === "finished") {
    return activeStatus === "finished" ? "estimate.status.rail.finished" : "estimate.status.rail.finish";
  }
  if (status === "paused") {
    return activeStatus === "paused" ? "estimate.status.rail.paused" : "estimate.status.rail.pause";
  }
  return "estimate.status.planning";
}

const ESTIMATE_STATUS_RAIL_MAIN: EstimateExecutionStatus[] = ["planning", "in_work", "finished"];
const ESTIMATE_STATUS_RAIL_PAUSED: EstimateExecutionStatus = "paused";
const ESTIMATE_TAB_ACTION_CLASSNAME = [
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-sm px-3 py-1.5",
  "text-sm font-medium text-muted-foreground ring-offset-background transition-all",
  "hover:bg-background hover:text-foreground",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
  "disabled:pointer-events-none disabled:opacity-50 [&_svg]:h-4 [&_svg]:w-4",
].join(" ");

function durationDays(startDay: number | null, endDay: number | null): number | null {
  if (startDay == null || endDay == null) return null;
  return Math.max(endDay - startDay + 1, 1);
}

function worksRangeDays(works: EstimateV2Work[]): { startDay: number; endDay: number } | null {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;

  works.forEach((work) => {
    const start = toDayIndex(work.plannedStart);
    const end = toDayIndex(work.plannedEnd);
    if (start == null || end == null) return;
    min = Math.min(min, start);
    max = Math.max(max, end);
  });

  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  return { startDay: min, endDay: max };
}

const dayRangeFormatter = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

function formatDayIndex(dayIndex: number | null): string {
  if (dayIndex == null) return "—";
  return dayRangeFormatter.format(new Date(fromDayIndex(dayIndex)));
}

const RESOURCE_TYPE_OPTIONS: Array<{ value: ResourceLineType; labelKey: string }> = [
  { value: "material", labelKey: "estimate.resource.type.material" },
  { value: "tool", labelKey: "estimate.resource.type.tool" },
  { value: "labor", labelKey: "estimate.resource.type.labor" },
  { value: "subcontractor", labelKey: "estimate.resource.type.subcontractor" },
  { value: "overhead", labelKey: "estimate.resource.type.overhead" },
  { value: "other", labelKey: "estimate.resource.type.other" },
];

const RESOURCE_LINE_TYPES = new Set<ResourceLineType>(RESOURCE_TYPE_OPTIONS.map((option) => option.value));

const RESOURCE_CREATE_OPTIONS: Array<{ labelKey: string; value: ResourceLineType }> = [
  { labelKey: "estimate.resource.createOption.material", value: "material" },
  { labelKey: "estimate.resource.createOption.tool", value: "tool" },
  { labelKey: "estimate.resource.createOption.hr", value: "labor" },
  { labelKey: "estimate.resource.createOption.overheads", value: "overhead" },
  { labelKey: "estimate.resource.createOption.subcontractor", value: "subcontractor" },
  { labelKey: "estimate.resource.createOption.other", value: "other" },
];

const PLAN_PARTICIPANT_CAP: Record<UserPlan, number> = {
  free: 1,
  pro: 5,
  business: 15,
};

interface PendingDeleteState {
  assessment: DeleteAssessment;
  step: DeleteDialogStep;
}

type TFn = (key: string, options?: Record<string, unknown>) => string;

function deleteEntityLabel(kind: DeleteAssessment["kind"], t: TFn): string {
  if (kind === "resource") return t("estimate.delete.entity.resource");
  if (kind === "work") return t("estimate.delete.entity.work");
  return t("estimate.delete.entity.stage");
}

function deleteDialogTitle(assessment: DeleteAssessment, step: DeleteDialogStep, t: TFn): string {
  const label = deleteEntityLabel(assessment.kind, t);
  if (step === "financial") return t("estimate.delete.title.permanent", { entity: label });
  return t("estimate.delete.title.simple", { entity: label });
}

function simpleDeleteDescription(assessment: DeleteAssessment, t: TFn): string {
  if (assessment.kind === "resource") {
    return t("estimate.delete.desc.simple.resource");
  }
  if (assessment.kind === "work") {
    return t("estimate.delete.desc.simple.work");
  }
  return t("estimate.delete.desc.simple.stage");
}

function workExecutionDescription(assessment: DeleteAssessment, t: TFn): string {
  if (assessment.kind !== "work") return "";
  if (assessment.execution.isDone) {
    return t("estimate.delete.desc.execution.work.done");
  }
  if (assessment.execution.status === "in_progress") {
    return t("estimate.delete.desc.execution.work.inProgress");
  }
  if (assessment.execution.status === "blocked") {
    return t("estimate.delete.desc.execution.work.blocked");
  }
  return t("estimate.delete.desc.execution.work.started");
}

function executionDeleteDescription(assessment: DeleteAssessment, t: TFn): string {
  if (assessment.kind === "work") return workExecutionDescription(assessment, t);
  if (assessment.kind === "stage") {
    return t("estimate.delete.desc.execution.stage");
  }
  return simpleDeleteDescription(assessment, t);
}

function financialDeleteDescription(assessment: DeleteAssessment, t: TFn): string {
  const label = deleteEntityLabel(assessment.kind, t);
  return t("estimate.delete.desc.financial", { entity: label });
}

function pendingDeleteDescription(pendingDelete: PendingDeleteState, t: TFn): string {
  if (pendingDelete.step === "simple") return simpleDeleteDescription(pendingDelete.assessment, t);
  if (pendingDelete.step === "execution") return executionDeleteDescription(pendingDelete.assessment, t);
  return financialDeleteDescription(pendingDelete.assessment, t);
}

function pendingDeleteConfirmLabel(pendingDelete: PendingDeleteState, t: TFn): string {
  if (pendingDelete.step === "financial") return t("estimate.delete.confirm.permanent");
  if (pendingDelete.step === "execution" && getNextDeleteStep(pendingDelete.assessment, pendingDelete.step)) {
    return t("estimate.delete.confirm.continue");
  }
  return t("common.delete");
}

function procurementConsequenceLabel(
  consequence: DeleteAssessment["financial"]["procurement"][number],
  t: TFn,
): string {
  const statuses: string[] = [];
  if (consequence.orderedState === "partial") statuses.push(t("estimate.delete.procurement.partial"));
  if (consequence.orderedState === "full") statuses.push(t("estimate.delete.procurement.full"));
  if (consequence.inStock) statuses.push(t("estimate.delete.procurement.inStock"));
  return statuses.join(", ");
}

function hrConsequenceLabel(
  consequence: DeleteAssessment["financial"]["hr"][number],
  t: TFn,
): string {
  return consequence.paymentState === "full" ? t("estimate.delete.hr.full") : t("estimate.delete.hr.partial");
}

function ProjectEstimateSkeleton() {
  return (
    <div className="space-y-sp-2 p-sp-2">
      <div className="rounded-card border border-border bg-card p-sp-2 space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-7 w-56 max-w-full" />
            <div className="flex gap-2">
              <Skeleton className="h-8 w-28" />
              <Skeleton className="h-8 w-24" />
            </div>
          </div>
          <div className="flex gap-2">
            <Skeleton className="h-9 w-28" />
            <Skeleton className="h-9 w-32" />
          </div>
        </div>
        <div className="grid gap-3 lg:grid-cols-2">
          <Skeleton className="h-40 rounded-card" />
          <Skeleton className="h-40 rounded-card" />
        </div>
        <Skeleton className="h-12 rounded-card" />
        <Skeleton className="h-56 rounded-card" />
      </div>
    </div>
  );
}

type WorkTableColumnDef = {
  key: string;
  title: ReactNode;
  widthPx: number;
  align?: "left" | "right";
  sticky?: boolean;
  hideOnMobile?: boolean;
};

function WorkTableFrame({
  className,
  columns,
  minWidthPx = 980,
  children,
}: {
  className?: string;
  columns: WorkTableColumnDef[];
  minWidthPx?: number;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const tableRef = useRef<HTMLTableElement | null>(null);
  const mirrorScrollRef = useRef<HTMLDivElement | null>(null);
  const [scrollState, setScrollState] = useState({
    scrollLeft: 0,
    maxLeft: 0,
    hasOverflow: false,
    canScrollLeft: false,
    canScrollRight: false,
  });

  const updateScrollState = useCallback(() => {
    const tableNode = tableRef.current;
    const container = tableNode?.parentElement as HTMLDivElement | null;
    if (!tableNode || !container) return;
    const { scrollLeft, scrollWidth, clientWidth } = container;
    const maxLeft = Math.max(0, scrollWidth - clientWidth);
    const edgeSlack = 3;
    const hasOverflow = scrollWidth > clientWidth + edgeSlack;
    const canScrollLeft = scrollLeft > edgeSlack;
    const canScrollRight = scrollLeft < maxLeft - edgeSlack;
    const normalizedScrollLeft = Math.min(Math.max(scrollLeft, 0), maxLeft);
    setScrollState((current) => {
      if (
        current.scrollLeft === normalizedScrollLeft
        && current.maxLeft === maxLeft
        && current.hasOverflow === hasOverflow
        && current.canScrollLeft === canScrollLeft
        && current.canScrollRight === canScrollRight
      ) {
        return current;
      }
      return { scrollLeft: normalizedScrollLeft, maxLeft, hasOverflow, canScrollLeft, canScrollRight };
    });
  }, []);

  useEffect(() => {
    const tableNode = tableRef.current;
    const container = tableNode?.parentElement as HTMLDivElement | null;
    if (!tableNode || !container) return undefined;

    const mirror = mirrorScrollRef.current;
    const syncScroll = () => {
      updateScrollState();
      if (mirror && mirror.scrollLeft !== container.scrollLeft) mirror.scrollLeft = container.scrollLeft;
    };

    syncScroll();
    container.addEventListener("scroll", syncScroll, { passive: true });
    const resizeObserver = typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(syncScroll)
      : null;
    resizeObserver?.observe(container);
    resizeObserver?.observe(tableNode);

    return () => {
      container.removeEventListener("scroll", syncScroll);
      resizeObserver?.disconnect();
    };
  }, [updateScrollState]);

  const handleScrollSliderChange = useCallback((event: ChangeEvent<HTMLInputElement> | FormEvent<HTMLInputElement>) => {
    const container = tableRef.current?.parentElement as HTMLDivElement | null;
    if (!container) return;
    const nextScrollLeft = Number(event.currentTarget.value);
    container.scrollLeft = nextScrollLeft;
    if (mirrorScrollRef.current) mirrorScrollRef.current.scrollLeft = nextScrollLeft;
    setScrollState((current) => ({
      ...current,
      scrollLeft: Math.min(Math.max(nextScrollLeft, 0), current.maxLeft),
      canScrollLeft: nextScrollLeft > 3,
      canScrollRight: nextScrollLeft < current.maxLeft - 3,
    }));
  }, []);

  const showEdgeHints = scrollState.hasOverflow;
  const showRightCue = showEdgeHints && scrollState.canScrollRight;
  const showLeftCue = showEdgeHints && scrollState.canScrollLeft;

  const isMobile = useIsMobile();
  const mobileVisibleWidth = useMemo(
    () => columns.filter((col) => !col.hideOnMobile).reduce((sum, col) => sum + col.widthPx, 0),
    [columns],
  );
  const columnWidth = useMemo(
    () => columns.reduce((sum, col) => sum + col.widthPx, 0),
    [columns],
  );
  const effectiveMinWidth = isMobile ? mobileVisibleWidth : Math.max(minWidthPx, columnWidth);
  const sliderMax = Math.max(scrollState.maxLeft, 1);
  const sliderValue = Math.min(scrollState.scrollLeft, sliderMax);

  return (
    <div className="relative space-y-1.5 pl-0">
      {/* top offsets by --demo-banner-h (0px outside the demo) so the pinned
          column header clears the demo strip, mirroring the TopBar offset. */}
      <div className="sticky top-[calc(3.5rem+var(--demo-banner-h,0px))] z-30 flex items-stretch rounded-md bg-card/95 shadow-sm ring-1 ring-border/60 backdrop-blur">
        <div ref={mirrorScrollRef} className="min-w-0 flex-1 overflow-hidden">
          <div className="flex items-stretch" style={{ minWidth: effectiveMinWidth }}>
            {columns.map((col) => (
              <div
                key={col.key}
                className={cn(
                  "flex items-center pl-1 pr-2 py-1.5 text-xs font-semibold text-muted-foreground shrink-0",
                  col.align === "right" ? "justify-end text-right tabular-nums" : "text-left",
                  col.sticky && "sticky left-0 z-10 border-r border-border bg-card",
                  col.hideOnMobile && "hidden md:flex",
                )}
                style={{ width: col.widthPx }}
              >
                <span className="truncate">{col.title}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="relative min-w-0">
        <Table
          ref={tableRef}
          className={cn(className, "[&_td]:pl-1")}
          style={{ minWidth: effectiveMinWidth }}
          wrapperClassName={cn(
            "relative w-full",
            "overflow-y-auto overflow-x-auto",
            "[scrollbar-width:none]",
            "[&::-webkit-scrollbar]:hidden",
          )}
        >
          <colgroup>
            {columns.map((col) => (
              <col
                key={col.key}
                className={cn(col.hideOnMobile && "hidden md:[display:table-column]")}
                style={{ width: col.widthPx }}
              />
            ))}
          </colgroup>
          {children}
        </Table>

        {showLeftCue ? (
          <div
            className="pointer-events-none absolute inset-y-0 left-0 z-10 hidden w-9 bg-gradient-to-r from-card/95 via-card/55 to-transparent md:block"
            aria-hidden
          />
        ) : null}
        {showRightCue ? (
          <div
            className="pointer-events-none absolute inset-y-0 right-0 z-10 hidden w-14 bg-gradient-to-l from-card via-card/90 to-transparent shadow-[inset_-12px_0_14px_-8px_hsl(var(--foreground)/0.08)] md:block"
            aria-hidden
          />
        ) : null}
      </div>

      <input
        type="range"
        min={0}
        max={sliderMax}
        step={1}
        value={sliderValue}
        onInput={handleScrollSliderChange}
        onChange={handleScrollSliderChange}
        aria-label={t("estimate.table.scrollRightAria")}
        className={cn(
          "block h-5 w-full cursor-pointer appearance-none rounded-full bg-transparent",
          "disabled:cursor-default disabled:opacity-60",
          "[&::-webkit-slider-runnable-track]:h-2 [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-muted/55",
          "[&::-webkit-slider-thumb]:-mt-1.5 [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:w-16 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border [&::-webkit-slider-thumb]:border-border/70 [&::-webkit-slider-thumb]:bg-foreground/75 [&::-webkit-slider-thumb]:shadow-sm",
          "[&::-moz-range-track]:h-2 [&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-muted/55",
          "[&::-moz-range-thumb]:h-5 [&::-moz-range-thumb]:w-16 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border [&::-moz-range-thumb]:border-border/70 [&::-moz-range-thumb]:bg-foreground/75",
        )}
        disabled={!scrollState.hasOverflow}
      />
    </div>
  );
}

function formatRelativeTime(iso: string | null, t: TFn): string | null {
  if (!iso) return null;
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 5_000) return t("common.time.justNow");
  if (diff < 60_000) return t("common.time.secondsAgo", { count: Math.round(diff / 1_000) });
  if (diff < 3_600_000) return t("common.time.minutesAgo", { count: Math.round(diff / 60_000) });
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function EstimateSyncStatusIndicator({
  sync,
  fallbackSavedAt,
}: {
  sync: EstimateV2ProjectSyncState;
  /** Persistent "last saved" time (project.updatedAt) shown when there's no live
   *  in-session save status yet — keeps "Сохранено …" visible on load. */
  fallbackSavedAt?: string | null;
}) {
  const { t } = useTranslation();
  const status = sync.draftSaveStatus ?? "idle";
  const savedTime = formatRelativeTime(sync.draftSaveLastSucceededAt ?? fallbackSavedAt ?? null, t);
  const label = status === "saving" ? t("estimate.sync.saving")
    : status === "pending" ? t("estimate.sync.pending")
    : status === "error" ? t("estimate.sync.error")
    : status === "blocked_permission" ? t("estimate.sync.blockedPermission")
    : status === "conflict" ? t("estimate.sync.conflict")
    : savedTime ? t("estimate.sync.saved", { time: savedTime })
    : null;

  if (!label) return null;

  const colorClass = status === "error" || status === "conflict"
    ? "text-destructive"
    : status === "blocked_permission"
      ? "text-warning"
    : status === "saving" || status === "pending"
      ? "text-muted-foreground/70"
      : "text-muted-foreground";

  return (
    <span className={`text-[11px] font-medium ${colorClass}`}>
      {label}
    </span>
  );
}

const ESTIMATE_STATUS_RAIL_ICON: Record<EstimateExecutionStatus, LucideIcon> = {
  planning: ClipboardList,
  in_work: HardHat,
  finished: House,
  paused: Pause,
};

// The rail's flex-basis (set on its header wrapper) is kept above the
// `estimate-rail` container-query breakpoint in index.css so the rail wraps to
// its own full-width row *before* it would ever cramp inline — keeping the label
// transition monotonic (full inline → full filled row → icons) with no flicker.
function EstimateStatusRail({
  status,
  canEdit,
  isTransitioningToInWork,
  onChange,
}: {
  status: EstimateExecutionStatus;
  canEdit: boolean;
  isTransitioningToInWork: boolean;
  onChange: (status: EstimateExecutionStatus) => void;
}) {
  const { t } = useTranslation();
  const activeMainIndex = ESTIMATE_STATUS_RAIL_MAIN.indexOf(status);

  const renderStep = (step: EstimateExecutionStatus, options?: { passed?: boolean }) => {
    const passed = Boolean(options?.passed);
    const active = step === status;
    const isPause = step === "paused";
    const canSelect = canEdit && !isTransitioningToInWork && step !== "planning" && !active;
    const showLoader = isTransitioningToInWork && step === "in_work";
    // The active step always shows its label; the secondary pause control is
    // icon-only until active. Every other primary label is rendered but collapses
    // to an icon via the `estimate-rail` container query when the rail is narrow
    // (see index.css) — a pure-CSS responsive collapse that reacts to the rail's
    // own width, including AI-sidebar changes, with no layout thrash.
    const renderLabel = active || !isPause;
    const labelCollapsible = renderLabel && !active;
    // Passed steps read in their completed form ("В работе"), upcoming ones as the
    // call to action ("В работу").
    const label = t(estimateStatusRailLabelKey(step, passed ? step : status));
    const tone = active
      ? status === "finished"
        ? "success"
        : status === "paused"
          ? "warning"
          : "info"
      : "info";
    const StepIcon = showLoader
      ? Loader2
      : step === "planning" && passed
        ? Check
        : ESTIMATE_STATUS_RAIL_ICON[step];

    const pillClassName = cn(
      "group inline-flex shrink-0 items-center rounded-full transition-colors",
      active ? "gap-2 py-1 pl-1 pr-3" : "gap-1.5 p-1",
      active && (tone === "success" ? "bg-success/10" : tone === "warning" ? "bg-warning/10" : "bg-info/10"),
      canSelect && "cursor-pointer hover:bg-muted/60",
    );
    const nodeClassName = cn(
      "grid h-7 w-7 shrink-0 place-items-center rounded-full transition-colors",
      active
        ? cn(
            "shadow-sm",
            tone === "success"
              ? "bg-success text-success-foreground"
              : tone === "warning"
                ? "bg-warning text-warning-foreground"
                : "bg-info text-info-foreground",
          )
        : passed
          ? "bg-info/15 text-info"
          : "border border-border bg-card text-muted-foreground group-hover:border-foreground/40 group-hover:text-foreground",
    );
    const labelClassName = cn(
      "whitespace-nowrap text-[13px] leading-none transition-colors",
      active ? "font-semibold text-foreground" : "font-medium text-muted-foreground group-hover:text-foreground",
      labelCollapsible && "estimate-rail-label pr-1",
    );

    const inner = (
      <>
        <span className={nodeClassName}>
          <StepIcon className={cn("h-3.5 w-3.5", showLoader && "animate-spin")} />
        </span>
        {renderLabel ? <span className={labelClassName}>{label}</span> : null}
      </>
    );

    return canSelect ? (
      <button type="button" onClick={() => onChange(step)} className={pillClassName} aria-label={label} title={label}>
        {inner}
      </button>
    ) : (
      <span className={pillClassName} aria-current={active ? "step" : undefined} aria-label={label} title={label}>
        {inner}
      </span>
    );
  };

  return (
    <div className="w-full min-w-0 py-1 [container-name:estimate-rail] [container-type:inline-size]">
      <div className="flex min-w-0 flex-nowrap items-center gap-1.5">
        {ESTIMATE_STATUS_RAIL_MAIN.map((step, index) => (
          <Fragment key={step}>
            {renderStep(step, { passed: activeMainIndex > index })}
            {index < ESTIMATE_STATUS_RAIL_MAIN.length - 1 ? (
              <span
                aria-hidden
                className={cn(
                  "h-0.5 min-w-[12px] flex-1 rounded-full transition-colors",
                  activeMainIndex > index ? "bg-info/50" : "bg-border",
                )}
              />
            ) : null}
          </Fragment>
        ))}
        <span aria-hidden className="mx-0.5 h-6 w-px shrink-0 bg-border" />
        {renderStep(ESTIMATE_STATUS_RAIL_PAUSED)}
      </div>
    </div>
  );
}

export default function ProjectEstimate() {
  const { t } = useTranslation();
  const { id: projectId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const pid = projectId!;
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const workspaceMode = useWorkspaceMode();
  const perm = usePermission(pid);
  const hrAccess = getProjectDomainAccess(perm.seam, "hr");
  const hrReadsEnabled = projectDomainAllowsView(hrAccess);
  const { user: currentUser, isLoading: isCurrentUserLoading } = useWorkspaceCurrentUserState();
  const { project, isLoading: isProjectLoading } = useWorkspaceProjectState(pid);
  const { members, isLoading: isMembersLoading } = useWorkspaceProjectMembersState(pid);
  const projectInvites = useWorkspaceProjectInvites(pid);
  const tasks = useTasks(pid);
  const procurementItems = useProcurementV2(pid);
  const orders = useOrders(pid);
  const hrItems = useHRItems(pid, { enabled: hrReadsEnabled });
  const hrPayments = useHRPayments(pid, { enabled: hrReadsEnabled });
  const locations = useLocations(pid);

  const {
    project: estimateProject,
    stages,
    works,
    lines,
    dependencies,
    versions,
    scheduleBaseline,
    operationalUpperBlock,
    sync: estimateSync,
    isLoading: isEstimateLoading,
  } = useEstimateV2Project(pid);

  const [constructorOpen, setConstructorOpen] = useState(false);
  const constructorVersionQuery = useCurrentEstimateVersionId(pid, constructorOpen && workspaceMode.kind === "supabase");
  // Canonical-library typeahead only works against the Supabase backend; gate it
  // off in demo/local mode so editing names never fires search_canonical_library.
  const canonicalSearchEnabled = workspaceMode.kind === "supabase";
  const constructorProfileId = workspaceMode.kind === "supabase" ? workspaceMode.profileId : (currentUser.id || "");
  const [constructorTarget, setConstructorTarget] = useState<{ stageId?: string; workId?: string } | null>(null);
  const [constructorTab, setConstructorTab] = useState<"estimates" | "catalog" | "my-catalogs">("estimates");
  const openConstructor = (
    target: { stageId?: string; workId?: string } | null,
    tab: "estimates" | "catalog",
  ) => {
    trackEvent("estimate_constructor_opened", {
      tab,
      targeted: target !== null,
    });
    setConstructorTarget(target);
    setConstructorTab(tab);
    setConstructorOpen(true);
  };

  const currentMembership = members.find((member) => member.user_id === currentUser.id) ?? null;
  const canSubmitByMembership = currentMembership?.role === "owner" || currentMembership?.role === "co_owner";
  const projectMode = estimateProject.projectMode;
  const estimateAccess = getProjectDomainAccess(perm.seam, "estimate");
  const canViewSensitiveDetail = seamCanViewSensitiveDetail(perm.seam);
  const canViewOperationalFinanceSummary = seamCanViewOperationalFinanceSummary(perm.seam);
  const estimateFinanceMode = seamEstimateFinanceVisibilityMode(perm.seam);
  const canExportEstimateCsv = seamAllowsEstimateExportCsv(perm.seam);
  const canManageEstimate = projectDomainAllowsManage(estimateAccess);
  // Editing needs finance detail, not just the role. A co_owner below detail
  // could reach every edit control, and every edit cleared the persisted snapshot
  // that was the sole truthful pricing source for them (rovno#282). In managed
  // supabase mode their writes were then refused by `queueProjectDraftSync` as
  // `blocked_permission`, so nothing was persisted either. In demo/local that
  // check is never reached and the edits did survive in the workspace cache;
  // withdrawing them there is deliberate, not a side effect.
  const canEditEstimate = canManageEstimate && estimateFinanceMode === "detail";
  // Publishing is strictly stronger than editing, so it takes the same gate. The
  // share snapshot is built from the RAW lines and ShareEstimate recomputes from
  // them with no snapshot preference, so a below-detail member would publish a
  // client-facing estimate of zeroes — and since this page now shows them the
  // correct money, they would have no signal at all (rovno#282, audit round 2).
  const canSubmitToClient = canPublishClientShare({
    canManageEstimate,
    isSubmitterRole: canSubmitByMembership,
    financeMode: estimateFinanceMode,
  });
  const isContractorMode = projectMode === "contractor";
  // Which pricing SOURCE to read is a different question from who may edit, and
  // it is keyed on the ROLE-level `canManageEstimate` on purpose: a manager
  // holding live costs must recompute even though the line above just made them
  // read-only. Prefer the persisted snapshot when there is nothing truthful to
  // recompute from: the store zeroed the costs, or it hydrated through the
  // operational RPC and returned no resource lines at all, in which case no line
  // survives to carry `costRedacted` and the upper block is the only pricing.
  const hasRedactedLineCosts = lines.some((line) => line.costRedacted);
  const useReadOnlySummaryPricing = estimateFinanceMode === "summary"
    && (!canManageEstimate || hasRedactedLineCosts || (operationalUpperBlock != null && lines.length === 0))
    && !isCurrentUserLoading
    && !isProjectLoading
    && !isMembersLoading
    && !isEstimateLoading;
  const showEstimateInternalPricing = estimateFinanceMode === "detail";
  const showEstimateMarkup = estimateFinanceMode === "detail" && isContractorMode;

  const [activeTab, setActiveTab] = useState("estimate");
  const [approvalModalOpen, setApprovalModalOpen] = useState(false);
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [resourceModalLineId, setResourceModalLineId] = useState<string | null>(null);
  const [missingDatesWorkIds, setMissingDatesWorkIds] = useState<string[]>([]);
  const [isTransitioningToInWork, setIsTransitioningToInWork] = useState(false);
  const [incompleteTaskBlocks, setIncompleteTaskBlocks] = useState<Array<{ taskId: string | null; title: string }>>([]);
  const [bulkFinishedTasks, setBulkFinishedTasks] = useState<Task[] | null>(null);
  const [collapsedStageIds, setCollapsedStageIds] = useState<Set<string>>(new Set());
  const estimateHasSavedContent = stages.length > 0 || works.length > 0 || lines.length > 0 || versions.length > 0;
  const { data: tierQuota } = useTierQuota();
  const [estimateEditorStarted, setEstimateEditorStarted] = useState(estimateHasSavedContent);
  const previousProjectIdRef = useRef(pid);
  const [pendingStageTitleEditId, setPendingStageTitleEditId] = useState<string | null>(null);
  const [pendingWorkTitleEditId, setPendingWorkTitleEditId] = useState<string | null>(null);
  const [pendingLineTitleEditId, setPendingLineTitleEditId] = useState<string | null>(null);
  const [customUnitDraftByLineId, setCustomUnitDraftByLineId] = useState<Record<string, string>>({});
  const [customUnitInputLineIds, setCustomUnitInputLineIds] = useState<Set<string>>(new Set());
  const [pendingDelete, setPendingDelete] = useState<PendingDeleteState | null>(null);
  const suppressResourceCreateAutoFocusRef = useRef(false);
  const pendingDeleteNextStepRef = useRef<DeleteDialogStep | null>(null);

  useEffect(() => {
    if (!estimateHasSavedContent) return;
    setEstimateEditorStarted(true);
  }, [estimateHasSavedContent]);

  useEffect(() => {
    if (previousProjectIdRef.current === pid) return;
    previousProjectIdRef.current = pid;
    setEstimateEditorStarted(estimateHasSavedContent);
  }, [estimateHasSavedContent, pid]);

  // ─── Analytics: empty-estimate marker.
  // Fires once per project_id when the user views an estimate that has no
  // stages / works / lines / versions yet. Used as the funnel denominator
  // for activation: estimate_created_empty → estimate_first_resource_added.
  const firedEstimateCreatedEmptyForPidRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!pid) return;
    if (estimateHasSavedContent) return;
    if (firedEstimateCreatedEmptyForPidRef.current.has(pid)) return;
    firedEstimateCreatedEmptyForPidRef.current.add(pid);
    trackEvent("estimate_created_empty", { project_id: pid });
  }, [pid, estimateHasSavedContent]);

  // ─── Analytics: activation marker.
  // Fires once per project_id the moment the estimate contains at least
  // one resource line with a non-zero unit price. This is the canonical
  // activation event — see project_analytics_migration memory.
  const firedEstimateFirstResourceForPidRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!pid) return;
    if (firedEstimateFirstResourceForPidRef.current.has(pid)) return;
    const hasPricedLine = lines.some((line) => (line.costUnitCents ?? 0) > 0);
    if (!hasPricedLine) return;
    firedEstimateFirstResourceForPidRef.current.add(pid);
    trackEvent("estimate_first_resource_added", { project_id: pid });
  }, [pid, lines]);

  useEffect(() => {
    if (!pendingStageTitleEditId) return;
    let firstFrame = 0;
    let secondFrame = 0;
    firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        setPendingStageTitleEditId(null);
      });
    });
    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
    };
  }, [pendingStageTitleEditId]);

  useEffect(() => {
    if (!pendingWorkTitleEditId) return;
    let firstFrame = 0;
    let secondFrame = 0;
    firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        setPendingWorkTitleEditId(null);
      });
    });
    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
    };
  }, [pendingWorkTitleEditId]);

  useEffect(() => {
    if (!pendingLineTitleEditId) return;
    let firstFrame = 0;
    let secondFrame = 0;
    firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        setPendingLineTitleEditId(null);
      });
    });
    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
    };
  }, [pendingLineTitleEditId]);

  useLayoutEffect(() => {
    if (!pid) return undefined;

    if (workspaceMode.kind === "supabase" && project?.owner_id && currentUser.id) {
      registerEstimateV2ProjectAccessContext(pid, {
        mode: "supabase",
        profileId: workspaceMode.profileId,
        projectOwnerProfileId: project.owner_id,
        membershipRole: currentMembership?.role ?? null,
        financeVisibility: currentMembership?.finance_visibility ?? null,
      });
      return () => {
        clearEstimateV2ProjectAccessContext(pid);
      };
    }

    if (workspaceMode.kind === "demo" || workspaceMode.kind === "local") {
      registerEstimateV2ProjectAccessContext(pid, {
        mode: workspaceMode.kind,
        profileId: currentUser.id || undefined,
        projectOwnerProfileId: project?.owner_id,
        membershipRole: currentMembership?.role ?? null,
        financeVisibility: currentMembership?.finance_visibility ?? null,
      });
      return () => {
        clearEstimateV2ProjectAccessContext(pid);
      };
    }

    clearEstimateV2ProjectAccessContext(pid);
    return undefined;
  }, [
    currentMembership?.finance_visibility,
    currentMembership?.role,
    currentUser.id,
    pid,
    project?.owner_id,
    workspaceMode.kind,
    workspaceMode.kind === "supabase" ? workspaceMode.profileId : null,
  ]);

  const sortedStages = useMemo(
    () => [...stages].sort((a, b) => a.order - b.order),
    [stages],
  );

  const worksByStage = useMemo(() => {
    const map = new Map<string, EstimateV2Work[]>();
    works.forEach((work) => {
      const list = map.get(work.stageId) ?? [];
      list.push(work);
      map.set(work.stageId, list);
    });
    map.forEach((list) => list.sort((a, b) => a.order - b.order));
    return map;
  }, [works]);

  const linesByWork = useMemo(() => {
    const map = new Map<string, EstimateV2ResourceLine[]>();
    lines.forEach((line) => {
      const list = map.get(line.workId) ?? [];
      list.push(line);
      map.set(line.workId, list);
    });
    return map;
  }, [lines]);

  const checklistFallbackRowsByWork = useMemo(() => {
    const map = new Map<string, ChecklistFallbackEstimateRow[]>();

    tasks.forEach((task) => {
      const taskAssignee = resolveTaskAssignee(task);

      task.checklist.forEach((item, index) => {
        const workId = item.estimateV2WorkId ?? task.estimateV2WorkId ?? null;
        if (!workId) return;

        const type = resolveChecklistFallbackRowType(task, index);
        if (!type) return;

        const list = map.get(workId) ?? [];
        list.push({
          id: item.estimateV2LineId ?? `checklist-${task.id}-${item.id}`,
          workId,
          title: item.text || t("estimate.checklist.fallbackItemTitle"),
          type,
          typeLabel: resolveChecklistFallbackRowLabel(task, index),
          qtyMilli: Number.isFinite(item.estimateV2QtyMilli)
            ? Math.max(1, Math.round(item.estimateV2QtyMilli as number))
            : null,
          unit: item.estimateV2Unit?.trim() || null,
          assigneeId: taskAssignee.assigneeId,
          assigneeName: taskAssignee.assigneeName,
          assigneeEmail: taskAssignee.assigneeEmail,
        });
        map.set(workId, list);
      });
    });

    return map;
  }, [tasks]);

  const hierarchyNumbers = useMemo(
    () => buildHierarchyNumbers(sortedStages, worksByStage),
    [sortedStages, worksByStage],
  );

  const participantOptions = useMemo(() => (
    members
      .map((member) => {
        const participant = getUserById(member.user_id);
        if (!participant) return null;
        return {
          id: participant.id,
          name: participant.name,
          email: participant.email,
        };
      })
      .filter((entry): entry is { id: string; name: string; email: string } => Boolean(entry))
  ), [members]);
  const memberEmailSet = useMemo(
    () => new Set(participantOptions.map((participant) => participant.email.toLowerCase()).filter(Boolean)),
    [participantOptions],
  );
  const pendingInviteEmailSet = useMemo(
    () => new Set(projectInvites.filter((invite) => invite.status === "pending").map((invite) => invite.email.toLowerCase())),
    [projectInvites],
  );
  const pendingInviteOptions = useMemo(() => (
    projectInvites
      .filter((invite) => invite.status === "pending")
      .map((invite) => ({
        id: invite.id,
        email: invite.email,
      }))
  ), [projectInvites]);

  const handleAssigneeInvite = useCallback(async (identity: { name: string; email: string }) => {
    if (!canEditEstimate) return;
    if (workspaceMode.kind === "pending-supabase") {
      toast({
        title: t("estimate.toast.inviteUnavailable.title"),
        description: t("estimate.toast.inviteUnavailable.description"),
        variant: "destructive",
      });
      return;
    }
    if (!currentUser.id) {
      toast({
        title: t("estimate.toast.inviteCreateFailed.title"),
        description: t("estimate.toast.inviteCreateFailed.description"),
        variant: "destructive",
      });
      return;
    }

    const normalizedEmail = identity.email.trim().toLowerCase();
    if (memberEmailSet.has(normalizedEmail)) {
      toast({
        title: t("estimate.toast.alreadyParticipant.title"),
        description: t("estimate.toast.alreadyParticipant.description", { email: normalizedEmail }),
      });
      return;
    }
    if (pendingInviteEmailSet.has(normalizedEmail)) {
      toast({
        title: t("estimate.toast.invitePending.title"),
        description: t("estimate.toast.invitePending.description", { email: normalizedEmail }),
      });
      return;
    }

    try {
      const createdInvite = await createWorkspaceProjectInvite(workspaceMode, {
        projectId: pid,
        email: normalizedEmail,
        role: "contractor",
        aiAccess: "consult_only",
        viewerRegime: projectMode === "build_myself" ? "build_myself" : null,
        creditLimit: 50,
        invitedBy: currentUser.id,
        financeVisibility: getDefaultFinanceVisibility("contractor"),
      });

      if (workspaceMode.kind === "supabase") {
        try {
          const delivery = await sendWorkspaceProjectInviteEmail(workspaceMode, createdInvite.id);
          if (delivery.kind === "sent") {
            toast({
              title: t("estimate.toast.inviteSent.title"),
              description: t("estimate.toast.inviteSent.description", {
                email: delivery.payload.recipientEmail || normalizedEmail,
                name: identity.name,
              }),
            });
          } else {
            toast({
              title: t("estimate.toast.inviteCreated.title"),
              description: t("estimate.toast.inviteCreated.description", { name: identity.name, email: normalizedEmail }),
            });
          }
        } catch (sendErr) {
          const message = describeInviteSendError(sendErr, t, t("estimate.toast.inviteSendFailedFallback"));
          toast({
            title: t("estimate.toast.inviteCreatedEmailFailed.title"),
            description: message,
            variant: "destructive",
          });
        }
      } else {
        toast({
          title: t("estimate.toast.inviteCreated.title"),
          description: t("estimate.toast.inviteCreated.description", { name: identity.name, email: normalizedEmail }),
        });
      }
    } catch (err) {
      const message = describeInviteCreateError(err, t, t("estimate.toast.inviteCreateFailedFallback"));
      toast({
        title: t("estimate.toast.inviteFailed.title"),
        description: message,
        variant: "destructive",
      });
    }
  }, [canEditEstimate, currentUser.id, memberEmailSet, pendingInviteEmailSet, pid, projectMode, t, toast, workspaceMode]);

  const ownerPlan = useMemo<UserPlan>(() => {
    if (!project?.owner_id) return currentUser.plan;
    const owner = getUserById(project.owner_id);
    return owner?.plan ?? currentUser.plan;
  }, [currentUser.plan, project?.owner_id]);
  const participantLimit = PLAN_PARTICIPANT_CAP[ownerPlan];
  const availableParticipantSlots = Math.max(participantLimit - members.length, 0);

  const workById = useMemo(() => new Map(works.map((work) => [work.id, work])), [works]);
  const deleteGuardSource = useMemo(() => ({
    projectId: pid,
    stages,
    works,
    lines,
    tasks,
    procurementItems,
    orders,
    hrItems,
    hrPayments,
    locations,
  }), [pid, stages, works, lines, tasks, procurementItems, orders, hrItems, hrPayments, locations]);

  const latestApproved = useMemo(() => {
    if (!SHOW_ESTIMATE_VERSION_UI) return null;
    return versions
      .filter((version) => version.submitted && version.status === "approved")
      .sort((a, b) => b.number - a.number)[0] ?? null;
  }, [versions]);

  const latestProposed = useMemo(() => {
    if (!SHOW_ESTIMATE_VERSION_UI) return null;
    return versions
      .filter((version) => version.submitted && version.status === "proposed" && !version.archived)
      .sort((a, b) => b.number - a.number)[0] ?? null;
  }, [versions]);

  const pendingProposed = Boolean(
    latestProposed
    && (!latestApproved || latestProposed.number > latestApproved.number),
  );

  const currentVersionSnapshot = useMemo(() => ({
    project: { ...estimateProject },
    stages: stages.map((stage) => ({ ...stage })),
    works: works.map((work) => ({ ...work })),
    lines: lines.map((line) => ({ ...line })),
    dependencies: dependencies.map((dependency) => ({ ...dependency })),
  }), [dependencies, estimateProject, lines, stages, works]);

  const hasPendingChangesSinceSubmission = useMemo(() => {
    if (!pendingProposed || !latestProposed) return true;
    const nextVersionLike: EstimateV2Version = {
      ...latestProposed,
      snapshot: currentVersionSnapshot,
    };
    return computeVersionDiff(latestProposed, nextVersionLike).changes.length > 0;
  }, [currentVersionSnapshot, latestProposed, pendingProposed]);

  const diff = useMemo(
    () => (latestProposed ? computeVersionDiff(latestApproved, latestProposed) : {
      stageChanges: [],
      workChanges: [],
      lineChanges: [],
      changedStageIds: [],
      changedWorkIds: [],
      changedLineIds: [],
      changes: [],
    }),
    [latestApproved, latestProposed],
  );

  const changedLineIds = useMemo(() => new Set(diff.changedLineIds), [diff.changedLineIds]);

  const stageById = useMemo(() => new Map(stages.map((stage) => [stage.id, stage])), [stages]);
  const lineById = useMemo(() => new Map(lines.map((line) => [line.id, line])), [lines]);

  const lineTotalsComputeOptions = useMemo((): ComputeLineTotalsOptions | undefined => {
    // Owner/Co-owner (detail finance mode): never read persisted RPC snapshot —
    // always recompute from live fields so edits to cost/qty/markup/discount-override
    // flow into Client Unit/Total immediately.
    if (estimateFinanceMode === "detail") return undefined;
    return useReadOnlySummaryPricing ? { preferPersistedClientSnapshot: true } : undefined;
  }, [estimateFinanceMode, useReadOnlySummaryPricing]);

  const lineClientDisplayMode = useMemo<EstimateLineClientDisplayMode>(() => {
    if (estimateFinanceMode === "none") return "none";
    if (estimateFinanceMode === "detail") return "detail";
    return useReadOnlySummaryPricing ? "summary" : "detail";
  }, [estimateFinanceMode, useReadOnlySummaryPricing]);

  const lineTotalsById = useMemo(() => {
    const map = new Map<string, ReturnType<typeof computeLineTotals>>();
    lines.forEach((line) => {
      const stage = stageById.get(line.stageId);
      if (!stage) return;
      map.set(line.id, computeLineTotals(line, stage, estimateProject, projectMode, lineTotalsComputeOptions));
    });
    return map;
  }, [estimateProject, lines, projectMode, stageById, lineTotalsComputeOptions]);

  const hasSummaryClientPricingOnAnyLine = useMemo(() => (
    lines.some((line) => (
      typeof line.summaryClientUnitCents === "number" && Number.isFinite(line.summaryClientUnitCents)
      && typeof line.summaryClientTotalCents === "number" && Number.isFinite(line.summaryClientTotalCents)
    ))
  ), [lines]);

  const totals = useMemo(
    () => computeProjectTotals(estimateProject, stages, works, lines, projectMode, lineTotalsComputeOptions),
    [estimateProject, stages, works, lines, projectMode, lineTotalsComputeOptions],
  );

  const rpcSummarySubtotalCents =
    useReadOnlySummaryPricing && operationalUpperBlock?.clientTotalCents != null
      ? operationalUpperBlock.clientTotalCents
      : null;
  const rpcSummaryVatBps =
    operationalUpperBlock?.vatBps != null && Number.isFinite(operationalUpperBlock.vatBps)
      ? operationalUpperBlock.vatBps
      : estimateProject.taxBps;
  const rpcSummaryTaxCents = rpcSummarySubtotalCents != null
    ? roundHalfUpDiv(rpcSummarySubtotalCents * rpcSummaryVatBps, 10_000)
    : null;
  const rpcSummaryTotalIncVatCents = rpcSummarySubtotalCents != null && rpcSummaryTaxCents != null
    ? rpcSummarySubtotalCents + rpcSummaryTaxCents
    : null;

  const uiTaxAmountCents = rpcSummaryTaxCents ?? totals.taxAmountCents;
  const uiTotalIncVatCents = rpcSummaryTotalIncVatCents ?? totals.totalCents;
  const uiTaxableBaseCents = rpcSummarySubtotalCents ?? totals.taxableBaseCents;

  const stageTotalsById = useMemo(
    () => new Map(
      computeStageTotals(estimateProject, stages, lines, projectMode, lineTotalsComputeOptions).map((item) => [item.stageId, item]),
    ),
    [estimateProject, stages, lines, projectMode, lineTotalsComputeOptions],
  );

  const exportPayload = useMemo<ExportPayload | null>(() => {
    if (!estimateProject || sortedStages.length === 0) {
      return {
        projectId: pid ?? "",
        projectTitle: estimateProject?.title ?? "",
        currency: estimateProject?.currency ?? "RUB",
        projectMode,
        hasSensitiveDetail: canViewSensitiveDetail,
        hasSummaryClientPricing: hasSummaryClientPricingOnAnyLine,
        hasDiscountedClientTotal: false,
        stages: [],
        totals: {
          subtotalBeforeDiscountCents: totals.subtotalBeforeDiscountCents,
          discountTotalCents: totals.discountTotalCents,
          taxableBaseCents: uiTaxableBaseCents,
          vatBps: operationalUpperBlock?.vatBps ?? estimateProject?.taxBps ?? 0,
          taxAmountCents: uiTaxAmountCents,
          totalIncVatCents: uiTotalIncVatCents,
        },
        versionShareId: latestApproved?.shareId ?? latestProposed?.shareId ?? null,
        generatedAt: new Date().toISOString(),
      };
    }

    const summaryMode = canViewOperationalFinanceSummary && !canViewSensitiveDetail;
    let hasDiscounted = false;

    const stagesPayload: ExportStageGroup[] = sortedStages.map((stage, stageIdx) => {
      const stageWorks = worksByStage.get(stage.id) ?? [];
      const works: ExportWorkGroup[] = stageWorks.map((work, workIdx) => {
        const workLines = linesByWork.get(work.id) ?? [];
        const exportLines: ExportLineRow[] = workLines
          .map<ExportLineRow | null>((line) => {
            const lineTotals = lineTotalsById.get(line.id);
            if (!lineTotals) return null;
            const clientAmounts = displayLineClientAmounts(line, lineTotals, {
              financeMode: summaryMode ? "summary" : "detail",
            }) ?? {
              clientUnitCents: lineTotals.clientUnitCents,
              clientTotalCents: lineTotals.clientTotalCents,
            };
            const discountedClientTotalCents = typeof line.summaryDiscountedClientTotalCents === "number"
              ? line.summaryDiscountedClientTotalCents
              : null;
            if (discountedClientTotalCents != null) hasDiscounted = true;
            return {
              id: line.id,
              title: line.title,
              type: line.type,
              typeLabel: t(semanticLabelKeyForType(line.type)),
              qtyMilli: line.qtyMilli,
              unit: line.unit,
              costUnitCents: line.costUnitCents,
              costTotalCents: lineTotals.costTotalCents,
              markupBps: effectiveMarkupForDisplay(line, estimateProject.markupBps),
              discountBps: effectiveDiscountForDisplay(line, estimateProject.discountBps),
              clientUnitCents: clientAmounts.clientUnitCents,
              clientTotalCents: clientAmounts.clientTotalCents,
              discountedClientTotalCents,
            };
          })
          .filter((row): row is ExportLineRow => row !== null);
        return {
          id: work.id,
          title: work.title,
          number: `${stageIdx + 1}.${workIdx + 1}`,
          lines: exportLines,
        };
      });
      return {
        id: stage.id,
        title: stage.title,
        number: stageIdx + 1,
        works,
      };
    });

    return {
      projectId: pid ?? "",
      projectTitle: estimateProject.title,
      currency: estimateProject.currency,
      projectMode,
      hasSensitiveDetail: canViewSensitiveDetail,
      hasSummaryClientPricing: hasSummaryClientPricingOnAnyLine,
      hasDiscountedClientTotal: hasDiscounted,
      stages: stagesPayload,
      totals: {
        subtotalBeforeDiscountCents: totals.subtotalBeforeDiscountCents,
        discountTotalCents: totals.discountTotalCents,
        taxableBaseCents: uiTaxableBaseCents,
        vatBps: operationalUpperBlock?.vatBps ?? estimateProject.taxBps,
        taxAmountCents: uiTaxAmountCents,
        totalIncVatCents: uiTotalIncVatCents,
      },
      versionShareId: latestApproved?.shareId ?? latestProposed?.shareId ?? null,
      generatedAt: new Date().toISOString(),
    };
  }, [
    canViewOperationalFinanceSummary,
    canViewSensitiveDetail,
    estimateProject,
    hasSummaryClientPricingOnAnyLine,
    latestApproved,
    latestProposed,
    lineTotalsById,
    linesByWork,
    operationalUpperBlock?.vatBps,
    pid,
    projectMode,
    sortedStages,
    t,
    totals.discountTotalCents,
    totals.subtotalBeforeDiscountCents,
    uiTaxAmountCents,
    uiTaxableBaseCents,
    uiTotalIncVatCents,
    worksByStage,
  ]);

  const plannedRollups = useMemo(
    () => computePlannedFromEstimateV2({
      project: estimateProject,
      stages,
      lines,
    }),
    [estimateProject, stages, lines],
  );

  const factRollups = useMemo(
    () => computeFactFromDataSources({
      procurementItems,
      orders,
      hrItems,
      hrPayments,
    }),
    [procurementItems, orders, hrItems, hrPayments],
  );

  const incompleteLinkedTaskCount = useMemo(() => {
    const taskById = new Map(tasks.map((task) => [task.id, task]));
    return works.reduce((count, work) => {
      if (!work.taskId) return count;
      const task = taskById.get(work.taskId);
      if (!task) return count + 1;
      return task.status === "done" ? count : count + 1;
    }, 0);
  }, [tasks, works]);

  const taskCompletion = useMemo(() => {
    const taskById = new Map(tasks.map((task) => [task.id, task]));
    let total = 0;
    let done = 0;
    works.forEach((work) => {
      if (!work.taskId) return;
      total += 1;
      const task = taskById.get(work.taskId);
      if (task && task.status === "done") done += 1;
    });
    return { done, total, pct: total > 0 ? (done / total) * 100 : null };
  }, [tasks, works]);

  const combinedPlanFact = useMemo(
    () => combinePlanFact(
      plannedRollups,
      factRollups,
      scheduleBaseline,
      { unfinishedTaskCount: incompleteLinkedTaskCount },
    ),
    [plannedRollups, factRollups, scheduleBaseline, incompleteLinkedTaskCount],
  );
  const isInWork = estimateProject.estimateStatus === "in_work";

  const hasActualFinancialData = useMemo(
    () => hasActualFinancialDataFor({ hrPaymentCount: hrPayments.length, orders }),
    [hrPayments.length, orders],
  );

  const todayDay = toDayIndex(new Date());
  const currentRange = useMemo(() => worksRangeDays(works), [works]);
  const baselineRange = useMemo(() => {
    if (!scheduleBaseline?.projectBaselineStart || !scheduleBaseline.projectBaselineEnd) return null;
    const startDay = toDayIndex(scheduleBaseline.projectBaselineStart);
    const endDay = toDayIndex(scheduleBaseline.projectBaselineEnd);
    if (startDay == null || endDay == null) return null;
    return { startDay, endDay };
  }, [scheduleBaseline]);

  const planningRangeLabel = useMemo(() => {
    if (!currentRange) return "—";
    return `${formatDayIndex(currentRange.startDay)} → ${formatDayIndex(currentRange.endDay)}`;
  }, [currentRange]);

  const planningDurationDays = useMemo(
    () => durationDays(currentRange?.startDay ?? null, currentRange?.endDay ?? null),
    [currentRange],
  );

  const revenueExVatCents = totals.taxableBaseCents;
  const costExVatCents = totals.costTotalCents;
  const profitExVatCents = revenueExVatCents - costExVatCents;
  const profitabilityPct = revenueExVatCents > 0
    ? (profitExVatCents / revenueExVatCents) * 100
    : null;

  const timingMetrics = useMemo(() => {
    if (estimateProject.estimateStatus === "planning") {
      const plannedDuration = durationDays(currentRange?.startDay ?? null, currentRange?.endDay ?? null);
      const daysToEnd = currentRange && todayDay != null
        ? Math.max(0, currentRange.endDay - todayDay)
        : null;
      return {
        durationPlannedDays: plannedDuration,
        durationEstimatedDays: null,
        daysToEnd,
        behindScheduleDays: 0,
      };
    }

    const plannedDuration = durationDays(baselineRange?.startDay ?? null, baselineRange?.endDay ?? null);
    const estimatedDuration = durationDays(currentRange?.startDay ?? null, currentRange?.endDay ?? null);
    const targetEnd = currentRange?.endDay ?? baselineRange?.endDay ?? null;
    const daysToEnd = targetEnd != null && todayDay != null
      ? Math.max(0, targetEnd - todayDay)
      : null;
    const behindScheduleDays = baselineRange && todayDay != null && incompleteLinkedTaskCount > 0 && todayDay > baselineRange.endDay
      ? todayDay - baselineRange.endDay
      : 0;

    return {
      durationPlannedDays: plannedDuration,
      durationEstimatedDays: estimatedDuration,
      daysToEnd,
      behindScheduleDays,
    };
  }, [baselineRange, currentRange, estimateProject.estimateStatus, incompleteLinkedTaskCount, todayDay]);

  const financeView = useMemo<EstimateFinanceView>(() => {
    const utilizationPct = totals.costTotalCents > 0
      ? (combinedPlanFact.fact.spentCents / totals.costTotalCents) * 100
      : null;
    const eac = computeEac({
      costTotalCents: totals.costTotalCents,
      spentCents: combinedPlanFact.fact.spentCents,
      completionPct: taskCompletion.pct,
    });
    const finishedAccuracy = hasActualFinancialData
      ? computeFinishedAccuracy({
        costTotalCents: totals.costTotalCents,
        spentCents: combinedPlanFact.fact.spentCents,
        revenueExVatCents: totals.taxableBaseCents,
        plannedMarginPct: profitabilityPct,
        durationPlannedDays: timingMetrics.durationPlannedDays,
        durationEstimatedDays: timingMetrics.durationEstimatedDays,
      })
      : null;
    return {
      revenueExVatCents: totals.taxableBaseCents,
      costTotalCents: totals.costTotalCents,
      profitExVatCents,
      profitabilityPct,
      hasActualFinancialData,
      spentCents: combinedPlanFact.fact.spentCents,
      utilizationPct,
      overspendCents: combinedPlanFact.fact.spentCents - totals.costTotalCents,
      completion: taskCompletion,
      toBePaidPlannedCents: combinedPlanFact.fact.toBePaidPlannedCents,
      daysToEnd: timingMetrics.daysToEnd,
      behindScheduleDays: timingMetrics.behindScheduleDays,
      planningRangeLabel,
      planningDurationDays,
      markupTotalCents: totals.markupTotalCents,
      subtotalBeforeDiscountCents: totals.subtotalBeforeDiscountCents,
      discountTotalCents: totals.discountTotalCents,
      taxAmountCents: totals.taxAmountCents,
      totalIncVatCents: totals.totalCents,
      plannedCostByTypeCents: totals.breakdownByType,
      spentByTypeCents: combinedPlanFact.fact.spentByTypeCents,
      unattributedSpendCents: combinedPlanFact.fact.unattributedSpendCents,
      eac,
      finishedAccuracy,
      operationalUpperBlock,
      rpcSummaryTotalIncVatCents,
      uiTotalIncVatCents,
      taxBps: estimateProject.taxBps,
      spendExcludesHr: !hrReadsEnabled,
    };
  }, [
    totals,
    profitExVatCents,
    profitabilityPct,
    hasActualFinancialData,
    combinedPlanFact,
    taskCompletion,
    timingMetrics,
    planningRangeLabel,
    planningDurationDays,
    operationalUpperBlock,
    rpcSummaryTotalIncVatCents,
    uiTotalIncVatCents,
    estimateProject.taxBps,
    hrReadsEnabled,
  ]);

  const ctaState = resolveProjectEstimateCtaState({
    projectMode,
    isOwner: canSubmitToClient,
    hasProposedVersion: Boolean(latestProposed),
  });
  const showEstimateWorkspace = estimateEditorStarted || estimateHasSavedContent;
  const reviewExpandedByDefault = false;
  const approvedVersionWithStamp = latestApproved?.approvalStamp ? latestApproved : null;
  const latestVersionNumber = useMemo(
    () => versions.reduce((max, version) => Math.max(max, version.number), 1),
    [versions],
  );
  const latestVersionApproved = Boolean(
    latestApproved
    && (!latestProposed || latestApproved.number >= latestProposed.number),
  );
  const handleEstimateStatusChange = async (
    nextStatus: EstimateExecutionStatus,
    options?: { skipSetup?: boolean; projectTasks?: Task[] },
  ) => {
    if (!canEditEstimate) return;
    if (nextStatus === estimateProject.estimateStatus && !options?.skipSetup) return;

    if (
      workspaceMode.kind === "supabase"
      && nextStatus === "in_work"
    ) {
      setIsTransitioningToInWork(true);
      try {
        const result = await transitionEstimateV2ProjectToInWork(pid, {
          ...options,
          ownerProfileId: workspaceMode.profileId,
        });
        if (!result.ok) {
          if (result.reason === "missing_work_dates") {
            setMissingDatesWorkIds(result.missingWorkIds ?? []);
            return;
          }

          if (result.reason === "transition_failed" || result.reason === "transition_blocked") {
            toast({
              title: result.blocking ? t("estimate.toast.transitionBlocked") : t("estimate.toast.statusUpdateFailed"),
              description: result.errorMessage ?? t("estimate.toast.transitionRetryFallback"),
              variant: "destructive",
            });
            return;
          }

          toast({ title: t("estimate.toast.ownerOnly"), variant: "destructive" });
          return;
        }

        setMissingDatesWorkIds([]);
        setIncompleteTaskBlocks([]);

        await Promise.all([
          queryClient.invalidateQueries({
            queryKey: planningQueryKeys.projectStages(workspaceMode.profileId, pid),
          }),
          queryClient.invalidateQueries({
            queryKey: planningQueryKeys.projectTasks(workspaceMode.profileId, pid),
          }),
          queryClient.invalidateQueries({
            queryKey: procurementProjectItemsQueryRoot(workspaceMode.profileId, pid),
          }),
          queryClient.invalidateQueries({
            // Root key: covers every financeAccess variant, not only "full".
            queryKey: hrQueryKeys.projectItemsRoot(workspaceMode.profileId, pid),
          }),
          queryClient.invalidateQueries({
            queryKey: hrQueryKeys.projectPayments(workspaceMode.profileId, pid),
          }),
          queryClient.invalidateQueries({
            queryKey: activityQueryKeys.projectEvents(workspaceMode.profileId, pid),
          }),
        ]);

        if (result.autoScheduled) {
          toast({ title: t("estimate.toast.statusUpdated"), description: t("estimate.toast.autoScheduledDesc") });
          return;
        }

        toast({ title: t("estimate.toast.statusUpdated") });
        return;
      } finally {
        setIsTransitioningToInWork(false);
      }
    }

    const result = setProjectEstimateStatus(
      pid,
      nextStatus,
      workspaceMode.kind === "supabase"
        ? {
          ...options,
          ownerProfileId: workspaceMode.profileId,
          projectOwnerProfileId: project?.owner_id,
        }
        : options,
    );
    if (!result.ok) {
      if (result.reason === "missing_work_dates") {
        setMissingDatesWorkIds(result.missingWorkIds ?? []);
        return;
      }
      if (result.reason === "incomplete_tasks") {
        setIncompleteTaskBlocks(result.incompleteTasks ?? []);
        return;
      }
      toast({ title: t("estimate.toast.ownerOnly"), variant: "destructive" });
      return;
    }

    setMissingDatesWorkIds([]);
    setIncompleteTaskBlocks([]);

    if (result.autoScheduled) {
      toast({ title: t("estimate.toast.statusUpdated"), description: t("estimate.toast.autoScheduledDesc") });
      return;
    }
    toast({ title: t("estimate.toast.statusUpdated") });
  };

  const handleSkipSetup = async () => {
    await handleEstimateStatusChange("in_work", { skipSetup: true });
  };

  const handleGoToWorkLog = () => {
    setIncompleteTaskBlocks([]);
    navigate(`/project/${pid}/tasks`);
  };

  const handleMarkAllTasksDone = useCallback(async () => {
    if (!canEditEstimate) return;

    const incompleteTasks = tasks.filter((task) => task.status !== "done");
    if (incompleteTasks.length === 0) {
      setIncompleteTaskBlocks([]);
      setBulkFinishedTasks(tasks);
      return;
    }

    try {
      const source = await getPlanningSource(
        workspaceMode.kind === "pending-supabase" ? undefined : workspaceMode,
      );
      const updatedTasks = await Promise.all(
        incompleteTasks.map((task) => source.updateProjectTask(task.id, { status: "done" })),
      );
      const updatedTaskById = new Map(updatedTasks.map((task) => [task.id, task]));
      const nextTasks = tasks.map((task) => updatedTaskById.get(task.id) ?? task);

      if (workspaceMode.kind === "supabase") {
        await queryClient.invalidateQueries({
          queryKey: planningQueryKeys.projectTasks(workspaceMode.profileId, pid),
        });
      }

      setIncompleteTaskBlocks([]);
      setBulkFinishedTasks(nextTasks);
      toast({ title: t("estimate.toast.allTasksDone") });
    } catch (error) {
      toast({
        title: t("estimate.toast.markAllTasksFailed.title"),
        description: error instanceof Error ? error.message : t("estimate.toast.markAllTasksFailed.description"),
        variant: "destructive",
      });
    }
  }, [canEditEstimate, pid, queryClient, t, tasks, toast, workspaceMode]);

  const handleConfirmFinishAfterBulkDone = useCallback(async () => {
    if (!bulkFinishedTasks) return;
    await handleEstimateStatusChange("finished", { projectTasks: bulkFinishedTasks });
    setBulkFinishedTasks(null);
  }, [bulkFinishedTasks, handleEstimateStatusChange]);

  const handleTabChange = (nextTab: string) => {
    if (!showEstimateWorkspace && nextTab !== "estimate") return;
    if (nextTab === "work_log") {
      navigate(`/project/${pid}/tasks`);
      return;
    }
    setActiveTab(nextTab);
  };

  const buildShareLink = useCallback((shareId: string) => {
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    return `${origin}/share/estimate/${shareId}`;
  }, []);

  const copyShareLink = useCallback(async (link: string) => {
    if (!navigator.clipboard?.writeText) {
      toast({ title: t("estimate.toast.copyFailed.title"), description: t("estimate.toast.copyFailed.description"), variant: "destructive" });
      return false;
    }
    try {
      await navigator.clipboard.writeText(link);
      toast({ title: t("estimate.toast.shareCopied") });
      return true;
    } catch {
      toast({ title: t("estimate.toast.copyFailed.title"), description: t("estimate.toast.copyFailed.description"), variant: "destructive" });
      return false;
    }
  }, [t, toast]);

  const ensureShareLinkForExport = useCallback(async (): Promise<{ url: string } | { error: string }> => {
    const submitOptionsFor = (): {
      shareApprovalPolicy: "disabled" | "registered";
      shareApprovalDisabledReason?: "no_participant_slot";
    } => {
      const previewOnly = availableParticipantSlots === 0;
      return previewOnly
        ? {
          shareApprovalPolicy: "disabled" as const,
          shareApprovalDisabledReason: "no_participant_slot" as const,
        }
        : {
          shareApprovalPolicy: "registered" as const,
        };
    };

    const publishToBackend = async (
      shareToken: string,
      versionNumber: number,
      snapshotPayload: typeof currentVersionSnapshot,
    ): Promise<{ ok: true } | { ok: false; error: string }> => {
      const options = submitOptionsFor();
      try {
        await publishEstimateShareSnapshot({
          projectId: pid,
          shareToken,
          versionNumber,
          snapshot: snapshotPayload,
          shareApprovalPolicy: options.shareApprovalPolicy,
          shareApprovalDisabledReason: options.shareApprovalDisabledReason ?? null,
        });
        return { ok: true };
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : t("estimate.export.share.submitFailed"),
        };
      }
    };

    // Approved versions are immutable. If the estimate has not changed since
    // approval, reuse the approved shareId. If there are new edits, fall
    // through to the "create a fresh proposed" branch below — clients should
    // not be sent stale data behind the same link.
    if (latestApproved?.shareId) {
      const approvedMatchesCurrent = computeVersionDiff(
        latestApproved,
        { ...latestApproved, snapshot: currentVersionSnapshot },
      ).changes.length === 0;
      if (approvedMatchesCurrent) {
        // Make sure the persisted backend row exists for this share token
        // (it is idempotent — re-publishing the same approved snapshot is a
        // no-op). If the network call fails we still hand out the link so
        // same-session readers continue to work.
        await publishToBackend(latestApproved.shareId, latestApproved.number, latestApproved.snapshot);
        return { url: buildShareLink(latestApproved.shareId) };
      }
    }

    // Proposed and submitted: if there are unsent edits, refresh the snapshot
    // under the same shareId so the client sees the latest revision when they
    // re-open the link. Mirrors the prior submit-to-client resubmission flow.
    if (latestProposed?.submitted) {
      if (!hasPendingChangesSinceSubmission) {
        await publishToBackend(latestProposed.shareId, latestProposed.number, latestProposed.snapshot);
        return { url: buildShareLink(latestProposed.shareId) };
      }
      if (!canSubmitToClient) {
        return { error: t("estimate.export.share.cannotSubmit") };
      }
      try {
        const ok = refreshVersionSnapshot(pid, latestProposed.id, currentUser.id, submitOptionsFor());
        if (!ok) {
          return { error: t("estimate.export.share.submitFailed") };
        }
        const publish = await publishToBackend(
          latestProposed.shareId,
          latestProposed.number,
          currentVersionSnapshot,
        );
        if (!publish.ok) {
          return { error: publish.error };
        }
        return { url: buildShareLink(latestProposed.shareId) };
      } catch (error) {
        return {
          error: error instanceof Error ? error.message : t("estimate.export.share.submitFailed"),
        };
      }
    }

    // No submitted version yet — create a fresh proposed one.
    if (!canSubmitToClient) {
      return { error: t("estimate.export.share.cannotSubmit") };
    }
    try {
      const snapshot = createVersionSnapshot(pid, currentUser.id);
      const ok = submitVersion(pid, snapshot.versionId, submitOptionsFor());
      if (!ok) {
        return { error: t("estimate.export.share.submitFailed") };
      }
      // The fresh version's number is one more than the previous highest.
      const newVersionNumber = latestVersionNumber + 1;
      const publish = await publishToBackend(snapshot.shareId, newVersionNumber, snapshot.snapshot);
      if (!publish.ok) {
        return { error: publish.error };
      }
      return { url: buildShareLink(snapshot.shareId) };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : t("estimate.export.share.submitFailed"),
      };
    }
  }, [
    availableParticipantSlots,
    buildShareLink,
    canSubmitToClient,
    currentUser.id,
    currentVersionSnapshot,
    hasPendingChangesSinceSubmission,
    latestApproved,
    latestProposed,
    latestVersionNumber,
    pid,
    t,
  ]);

  const handleProjectApprove = (stamp: ApprovalStamp) => {
    if (!latestProposed) return;
    const ok = approveVersion(pid, latestProposed.id, stamp, { actorId: currentUser.id });
    if (!ok) {
      toast({ title: t("estimate.toast.approveFailed"), variant: "destructive" });
      return;
    }
    setApprovalModalOpen(false);
    toast({ title: t("estimate.toast.approved") });
  };

  const handleAskQuestions = () => {
    if (!latestProposed) return;
    addEvent({
      id: `evt-estimate-question-${Date.now()}`,
      project_id: pid,
      actor_id: currentUser.id,
      type: "comment_added",
      object_type: "estimate_version",
      object_id: latestProposed.id,
      timestamp: new Date().toISOString(),
      payload: { text: t("estimate.event.clientQuestion") },
    });
    toast({ title: t("estimate.toast.questionSent") });
  };

  const handleExportCsv = () => {
    if (!canExportEstimateCsv) return;

    const rows: string[][] = [];
    rows.push([t("estimate.csv.title")]);
    rows.push([t("estimate.csv.project"), estimateProject.title]);
    rows.push([t("estimate.csv.mode"), projectMode]);
    rows.push([]);

    const summaryFinancialExport = !canViewSensitiveDetail
      && canViewOperationalFinanceSummary
      && hasSummaryClientPricingOnAnyLine;
    const requireSummaryRpcForExport = canViewOperationalFinanceSummary && !canViewSensitiveDetail;
    const exportDiscountedColumn = summaryFinancialExport && lines.some(
      (line) => typeof line.summaryDiscountedClientTotalCents === "number",
    );

    const csvH = {
      stage: t("estimate.csv.header.stage"),
      work: t("estimate.csv.header.work"),
      line: t("estimate.csv.header.line"),
      qty: t("estimate.csv.header.qty"),
      unit: t("estimate.csv.header.unit"),
      type: t("estimate.csv.header.type"),
      costUnit: t("estimate.csv.header.costUnit"),
      costTotal: t("estimate.csv.header.costTotal"),
      markupPct: t("estimate.csv.header.markupPct"),
      discountPct: t("estimate.csv.header.discountPct"),
      clientUnit: t("estimate.csv.header.clientUnit"),
      clientTotal: t("estimate.csv.header.clientTotal"),
      discountedClientTotal: t("estimate.csv.header.discountedClientTotal"),
    };
    if (!canViewSensitiveDetail && !summaryFinancialExport) {
      rows.push([csvH.stage, csvH.work, csvH.line, csvH.qty, csvH.unit]);
    } else if (!canViewSensitiveDetail && summaryFinancialExport) {
      rows.push(
        exportDiscountedColumn
          ? [csvH.stage, csvH.work, csvH.line, csvH.qty, csvH.unit, csvH.clientUnit, csvH.clientTotal, csvH.discountedClientTotal]
          : [csvH.stage, csvH.work, csvH.line, csvH.qty, csvH.unit, csvH.clientUnit, csvH.clientTotal],
      );
    } else if (projectMode === "contractor") {
      rows.push([csvH.stage, csvH.work, csvH.line, csvH.type, csvH.qty, csvH.unit, csvH.costUnit, csvH.costTotal, csvH.markupPct, csvH.discountPct, csvH.clientUnit, csvH.clientTotal]);
    } else if (projectMode === "build_myself") {
      rows.push([csvH.stage, csvH.work, csvH.line, csvH.type, csvH.qty, csvH.unit, csvH.costUnit, csvH.costTotal, csvH.discountPct, csvH.clientUnit, csvH.clientTotal]);
    }

    sortedStages.forEach((stage) => {
      const stageWorks = worksByStage.get(stage.id) ?? [];
      stageWorks.forEach((work) => {
        const workLines = linesByWork.get(work.id) ?? [];
        workLines.forEach((line) => {
          const lineTotals = lineTotalsById.get(line.id);
          if (!lineTotals) return;

          if (!canViewSensitiveDetail) {
            if (summaryFinancialExport) {
              const clientMoney = displayLineClientAmounts(line, lineTotals, {
                financeMode: requireSummaryRpcForExport ? "summary" : "detail",
              });
              const discounted = typeof line.summaryDiscountedClientTotalCents === "number"
                ? money(line.summaryDiscountedClientTotalCents, estimateProject.currency)
                : "—";
              rows.push(
                exportDiscountedColumn
                  ? [
                    stage.title,
                    work.title,
                    line.title,
                    qtyFromMilli(line.qtyMilli),
                    line.unit,
                    clientMoney ? money(clientMoney.clientUnitCents, estimateProject.currency) : "—",
                    clientMoney ? money(clientMoney.clientTotalCents, estimateProject.currency) : "—",
                    discounted,
                  ]
                  : [
                    stage.title,
                    work.title,
                    line.title,
                    qtyFromMilli(line.qtyMilli),
                    line.unit,
                    clientMoney ? money(clientMoney.clientUnitCents, estimateProject.currency) : "—",
                    clientMoney ? money(clientMoney.clientTotalCents, estimateProject.currency) : "—",
                  ],
              );
              return;
            }
            rows.push([
              stage.title,
              work.title,
              line.title,
              qtyFromMilli(line.qtyMilli),
              line.unit,
            ]);
            return;
          }

          const clientForCsv = displayLineClientAmounts(line, lineTotals, { financeMode: "detail" })
            ?? { clientUnitCents: lineTotals.clientUnitCents, clientTotalCents: lineTotals.clientTotalCents };
          const clientUnitStr = money(clientForCsv.clientUnitCents, estimateProject.currency);
          const clientTotalStr = money(clientForCsv.clientTotalCents, estimateProject.currency);

          if (projectMode === "contractor") {
            rows.push([
              stage.title,
              work.title,
              line.title,
              t(semanticLabelKeyForType(line.type)),
              qtyFromMilli(line.qtyMilli),
              line.unit,
              money(line.costUnitCents, estimateProject.currency),
              money(lineTotals.costTotalCents, estimateProject.currency),
              // Through the helper, like the on-screen cell: the raw line.markupBps
              // skipped both the project-inheritance rule (a line at 0 shows 0%
              // while it is actually charged the project markup) and the clamp.
              fromBpsToPercent(effectiveMarkupForDisplay(line, estimateProject.markupBps)),
              fromBpsToPercent(effectiveDiscountForDisplay(line, estimateProject.discountBps)),
              clientUnitStr,
              clientTotalStr,
            ]);
            return;
          }

          rows.push([
            stage.title,
            work.title,
            line.title,
            t(semanticLabelKeyForType(line.type)),
            qtyFromMilli(line.qtyMilli),
            line.unit,
            money(line.costUnitCents, estimateProject.currency),
            money(lineTotals.costTotalCents, estimateProject.currency),
            fromBpsToPercent(effectiveDiscountForDisplay(line, estimateProject.discountBps)),
            clientUnitStr,
            clientTotalStr,
          ]);
        });
      });
    });

    rows.push([]);
    if (canViewSensitiveDetail) {
      rows.push([t("estimate.csv.subtotalExVat"), money(totals.subtotalBeforeDiscountCents, estimateProject.currency)]);
      rows.push([t("estimate.csv.discount"), money(totals.discountTotalCents, estimateProject.currency)]);
      rows.push([t("estimate.csv.taxableBaseExVat"), money(totals.taxableBaseCents, estimateProject.currency)]);
    }
    rows.push([
      t("estimate.csv.tax"),
      `${((operationalUpperBlock?.vatBps ?? estimateProject.taxBps) / 100).toFixed(2)}%`,
    ]);
    rows.push([t("estimate.csv.taxAmount"), money(uiTaxAmountCents, estimateProject.currency)]);
    rows.push([t("estimate.csv.totalIncVat"), money(uiTotalIncVatCents, estimateProject.currency)]);

    // Stage/work/line titles and units are unfiltered free text, so every cell
    // goes through the shared guard rather than a local quoting rule (#195).
    const csv = buildCsvDocument(rows);
    // UTF-8 BOM, which the portfolio export already emits. Without it Excel reads
    // a double-clicked .csv as the system ANSI codepage and every Cyrillic
    // stage/work/line title garbles, which on a Russian-UI product is most of the
    // file. Only the more exposed of the two exporters was missing it.
    const blob = new Blob([CSV_BOM + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `estimate-v2-${pid}-${canViewSensitiveDetail ? projectMode : "operational"}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    toast({ title: t("estimate.toast.exportDone") });
  };

  const toggleStageCollapsed = (stageId: string) => {
    setCollapsedStageIds((current) => {
      const next = new Set(current);
      if (next.has(stageId)) {
        next.delete(stageId);
        return next;
      }
      next.add(stageId);
      return next;
    });
  };

  const handleStartEstimate = () => {
    // Proactive tier gate: a Free user is capped at 1 estimate total. Block
    // creating another and surface the paywall (the backend trigger also blocks).
    if (
      tierQuota &&
      tierQuota.estimates_limit >= 0 &&
      tierQuota.estimates_used >= tierQuota.estimates_limit
    ) {
      showTierLimitPaywallByType("estimates_total", t);
      return;
    }
    setEstimateEditorStarted(true);
    setActiveTab("estimate");
  };

  const handleCreateStage = () => {
    const created = createStage(pid, { title: t("estimate.stage.newTitle") });
    if (!created) return;
    trackEvent("estimate_stage_created", { project_id: pid });
    setPendingStageTitleEditId(created.id);
  };

  const handleCreateWork = (stageId: string) => {
    const created = createWork(pid, { stageId, title: t("estimate.work.newTitle") });
    if (!created) return;
    trackEvent("estimate_work_created", { project_id: pid, stage_id: stageId });
    setPendingWorkTitleEditId(created.id);
  };

  const handleCreateResourceLine = (
    stageId: string,
    workId: string,
    option: { value: ResourceLineType },
  ) => {
    const localizedPrefix = t(`estimate.resource.defaultPrefix.${option.value}`);
    const canonicalPrefix = getDefaultResourceLinePrefix(option.value);
    const detectPrefixes =
      localizedPrefix === canonicalPrefix ? [localizedPrefix] : [localizedPrefix, canonicalPrefix];
    const defaultTitle = buildDefaultResourceLineName(linesByWork.get(workId) ?? [], option.value, {
      prefix: localizedPrefix,
      detectPrefixes,
    });
    suppressResourceCreateAutoFocusRef.current = true;
    const defaultUnit = getUnitOptionsForType(option.value)[0] ?? "pcs";
    const created = createLine(pid, {
      stageId,
      workId,
      title: defaultTitle,
      type: option.value,
      unit: defaultUnit,
      qtyMilli: 1_000,
      costUnitCents: 0,
    });
    if (!created) {
      suppressResourceCreateAutoFocusRef.current = false;
      return;
    }
    trackEvent("estimate_line_created", { project_id: pid, stage_id: stageId, work_id: workId, resource_type: option.value });
    window.requestAnimationFrame(() => {
      setPendingLineTitleEditId(created.id);
    });
  };

  const openCustomUnitInput = (lineId: string, currentUnit: string) => {
    setCustomUnitInputLineIds((current) => {
      const next = new Set(current);
      next.add(lineId);
      return next;
    });
    setCustomUnitDraftByLineId((current) => ({
      ...current,
      [lineId]: current[lineId] ?? (currentUnit.trim() || "other"),
    }));
  };

  const closeCustomUnitInput = (lineId: string) => {
    setCustomUnitInputLineIds((current) => {
      if (!current.has(lineId)) return current;
      const next = new Set(current);
      next.delete(lineId);
      return next;
    });
  };

  const commitCustomUnit = (line: EstimateV2ResourceLine) => {
    const nextUnit = (customUnitDraftByLineId[line.id] ?? "").trim();
    if (!nextUnit) {
      closeCustomUnitInput(line.id);
      return;
    }
    if (nextUnit !== line.unit) {
      updateLine(pid, line.id, { unit: nextUnit });
    }
    closeCustomUnitInput(line.id);
  };

  const handlePendingDeleteOpenChange = (open: boolean) => {
    if (open) return;
    const nextStep = pendingDeleteNextStepRef.current;
    pendingDeleteNextStepRef.current = null;
    if (nextStep) {
      setPendingDelete((current) => {
        if (!current) return current;
        return {
          ...current,
          step: nextStep,
        };
      });
      return;
    }
    setPendingDelete(null);
  };

  const openResourceDelete = (lineId: string) => {
    const line = lineById.get(lineId);
    if (!line) return;
    const assessment = assessResourceDelete(line, deleteGuardSource);
    setPendingDelete({
      assessment,
      step: assessment.initialStep,
    });
  };

  const openResourceModal = (lineId: string) => setResourceModalLineId(lineId);
  const resourceModalLine = resourceModalLineId ? lineById.get(resourceModalLineId) ?? null : null;

  // Fill a resource line from a canonical-library suggestion (links the line to
  // the article so the row indicator + resource modal light up). Resource-level
  // apply is client-side and silent (no revert toast), per spec.
  const applyResourceSuggestion = (lineId: string, suggestion: CanonicalSuggestion) => {
    if (suggestion.isPersonal) {
      // Personal catalog item: suggestion.id is the user_catalog_item id, NOT
      // a canonical article — the line links to the canonical library only
      // through the item's manual match. The user's own price copies over.
      const partial: Partial<EstimateV2ResourceLine> = {
        title: suggestion.name,
        systemResourceArticleId: suggestion.matchedArticleId ?? null,
      };
      if (suggestion.unit) partial.unit = suggestion.unit;
      if (RESOURCE_LINE_TYPES.has(suggestion.badgeType as ResourceLineType)) {
        partial.type = suggestion.badgeType as ResourceLineType;
      }
      if (suggestion.priceCents != null) {
        // Estimate lines never go negative (createLine clamps the same way);
        // a negative catalog price is a keepable warning there, not here.
        partial.costUnitCents = Math.max(0, suggestion.priceCents);
      }
      updateLine(pid, lineId, partial);
      trackEvent("catalog_item_used_in_estimate", {
        project_id: pid,
        via: "autocomplete",
        matched: Boolean(suggestion.matchedArticleId),
      });
      return;
    }
    const partial: Partial<EstimateV2ResourceLine> = {
      title: suggestion.name,
      systemResourceArticleId: suggestion.id,
    };
    if (suggestion.unit) partial.unit = suggestion.unit;
    if (RESOURCE_LINE_TYPES.has(suggestion.badgeType as ResourceLineType)) {
      partial.type = suggestion.badgeType as ResourceLineType;
    }
    updateLine(pid, lineId, partial);
  };

  // Add a catalog leaf as a resource line on the constructor's target work (client-side;
  // the system_resource_article_id FK persists via the normal save path). Backs the
  // Конструктор Каталоги tab. Re-adding a library resource already on the work increments
  // its quantity instead of creating a duplicate line (matched by system article id).
  const handleAddCatalogResource = (resource: CatalogResource, quantity: number) => {
    const stageId = constructorTarget?.stageId;
    const workId = constructorTarget?.workId;
    if (!stageId || !workId) return;
    const type = RESOURCE_LINE_TYPES.has(resource.defaultResourceType as ResourceLineType)
      ? (resource.defaultResourceType as ResourceLineType)
      : "material";
    const addMilli = Math.max(1, Math.round(quantity * 1_000));

    // Merge a repeat catalog add into an existing line ONLY when that line is a
    // zero-cost catalog line for the same article. A non-zero cost may be a
    // personal item's price (or a price the user set), and folding a cost-0
    // catalog add into it would charge the added quantity at that price — the
    // same cross-price contamination we avoid on the personal path. Fail safe:
    // add a fresh zero-cost line instead.
    const existing = (linesByWork.get(workId) ?? []).find(
      (line) => line.systemResourceArticleId === resource.id && line.costUnitCents === 0,
    );
    if (existing) {
      updateLine(pid, existing.id, { qtyMilli: existing.qtyMilli + addMilli });
    } else {
      const created = createLine(pid, {
        stageId,
        workId,
        title: resource.name,
        type,
        unit: resource.unitDisplay ?? getUnitOptionsForType(type)[0] ?? "pcs",
        qtyMilli: addMilli,
        costUnitCents: 0,
        systemResourceArticleId: resource.id,
      });
      if (!created) return;
      // A merge is an increment, not a creation — only count real line creations.
      trackEvent("estimate_line_created", {
        project_id: pid,
        stage_id: stageId,
        work_id: workId,
        resource_type: type,
      });
    }
    toast({ title: t("estimate.constructor.catalogAdded", { name: resource.name }) });
  };

  // Add a personal catalog item on the target work — unlike canonical leaves
  // it carries the user's own price; the canonical link comes only from the
  // item's manual "Артикул Rovno" match. Backs the Мои каталоги tab.
  const handleAddPersonalCatalogItem = (item: UserCatalogItem, quantity: number) => {
    const stageId = constructorTarget?.stageId;
    const workId = constructorTarget?.workId;
    if (!stageId || !workId) return;
    const addMilli = Math.max(1, Math.round(quantity * 1_000));

    // Personal items always add a fresh line — never merge into an existing one.
    // A personal item carries its OWN price, so merging into a line with a
    // different unit cost (e.g. a zero-priced canonical leaf, or another
    // supplier's item that shares the same matched article) would silently drop
    // the user's price and cost the added quantity wrong. The quantity picker
    // already lets the user add the amount they want in one go.
    const created = createLine(pid, {
      stageId,
      workId,
      title: item.name,
      type: item.resourceType,
      unit: item.unit || getUnitOptionsForType(item.resourceType)[0] || "pcs",
      qtyMilli: addMilli,
      costUnitCents: item.priceCents,
      systemResourceArticleId: item.matchedArticleId,
    });
    if (!created) return;
    trackEvent("estimate_line_created", {
      project_id: pid,
      stage_id: stageId,
      work_id: workId,
      resource_type: item.resourceType,
    });
    trackEvent("catalog_item_used_in_estimate", {
      project_id: pid,
      via: "constructor",
      matched: Boolean(item.matchedArticleId),
    });
    toast({ title: t("estimate.constructor.catalogAdded", { name: item.name }) });
  };

  const openWorkDelete = (workId: string) => {
    const work = workById.get(workId);
    if (!work) return;
    const assessment = assessWorkDelete(work, deleteGuardSource);
    setPendingDelete({
      assessment,
      step: assessment.initialStep,
    });
  };

  const openStageDelete = (stageId: string) => {
    const stage = stageById.get(stageId);
    if (!stage) return;
    const assessment = assessStageDelete(stage, deleteGuardSource);
    setPendingDelete({
      assessment,
      step: assessment.initialStep,
    });
  };

  const confirmPendingDelete = () => {
    if (!pendingDelete) return;
    const nextStep = getNextDeleteStep(pendingDelete.assessment, pendingDelete.step);
    if (nextStep) {
      pendingDeleteNextStepRef.current = nextStep;
      return;
    }

    if (pendingDelete.assessment.kind === "resource") {
      deleteLine(pid, pendingDelete.assessment.entityId);
      return;
    }
    if (pendingDelete.assessment.kind === "work") {
      deleteWork(pid, pendingDelete.assessment.entityId);
      return;
    }
    deleteStage(pid, pendingDelete.assessment.entityId);
  };

  const isEstimatePageLoading = workspaceMode.kind === "pending-supabase"
    || isProjectLoading
    || isCurrentUserLoading
    || isMembersLoading
    || isEstimateLoading;

  if (isEstimatePageLoading) {
    return <ProjectEstimateSkeleton />;
  }

  if (!project) {
    return <EmptyState icon={AlertTriangle} title={t("estimate.error.notFound.title")} description={t("estimate.error.notFound.description")} />;
  }

  return (
    <div className="space-y-sp-2 p-0 md:p-sp-2">
      <TutorialModal
        tutorialKey="estimate_flow"
        steps={[
          {
            titleKey: "tutorial.estimateFlow.step1.title",
            descriptionKey: "tutorial.estimateFlow.step1.description",
            visual: (
              <div className="w-full space-y-1.5 text-left">
                <div className="flex items-center justify-between rounded-md border border-border bg-card px-3 py-2 text-caption">
                  <span className="font-medium text-foreground">{t("tutorial.estimateFlow.step1.row1Label")}</span>
                  <span className="tabular-nums text-muted-foreground">10 × 1 500 ₽</span>
                </div>
                <div className="flex items-center justify-between rounded-md border border-border bg-card px-3 py-2 text-caption">
                  <span className="font-medium text-foreground">{t("tutorial.estimateFlow.step1.row2Label")}</span>
                  <span className="tabular-nums text-muted-foreground">6 × 4 200 ₽</span>
                </div>
                <div className="flex items-center justify-between rounded-md border border-accent/40 bg-accent/10 px-3 py-2 text-caption">
                  <span className="font-medium text-foreground">{t("tutorial.estimateFlow.step1.totalLabel")}</span>
                  <span className="tabular-nums font-semibold text-foreground">40 200 ₽</span>
                </div>
              </div>
            ),
            icon: <BookOpen className="h-8 w-8 text-accent" />,
          },
          {
            titleKey: "tutorial.estimateFlow.step2.title",
            descriptionKey: "tutorial.estimateFlow.step2.description",
            visual: (
              <div className="flex items-center justify-center gap-2">
                <span className="rounded-md border border-sky-500/40 bg-sky-500/10 px-3 py-1.5 text-caption font-semibold text-sky-600 dark:text-sky-300">{t("estimate.status.planning")}</span>
                <ArrowRight className="h-4 w-4 text-muted-foreground" />
                <span className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-caption font-semibold text-emerald-600 dark:text-emerald-300">{t("estimate.status.inWork")}</span>
              </div>
            ),
            icon: <ArrowRight className="h-8 w-8 text-accent" />,
          },
          {
            titleKey: "tutorial.estimateFlow.step3.title",
            descriptionKey: "tutorial.estimateFlow.step3.description",
            visual: (
              <div className="w-full space-y-1.5">
                <div className="flex items-center justify-between rounded-md border border-border bg-card px-3 py-2 text-caption">
                  <span className="font-medium text-muted-foreground">{t("tutorial.estimateFlow.step3.internalLabel")}</span>
                  <span className="tabular-nums text-muted-foreground">32 000 ₽</span>
                </div>
                <div className="flex items-center justify-between rounded-md border border-accent/40 bg-accent/10 px-3 py-2 text-caption">
                  <span className="font-semibold text-foreground">{t("tutorial.estimateFlow.step3.clientLabel")}</span>
                  <span className="tabular-nums font-semibold text-foreground">40 200 ₽</span>
                </div>
              </div>
            ),
            icon: <Layers className="h-8 w-8 text-accent" />,
          },
        ]}
      />
      <div className="space-y-3 md:rounded-card md:border md:border-border md:bg-card md:p-sp-2">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <div className="min-w-0 max-w-full space-y-1.5">
            <h2 className="truncate text-xl font-semibold text-foreground">{project.title}</h2>
            {showEstimateWorkspace && (
              <div className="flex min-h-5 flex-wrap items-center gap-2">
                <EstimateSyncStatusIndicator sync={estimateSync} fallbackSavedAt={estimateProject.updatedAt} />
                {SHOW_ESTIMATE_VERSION_UI ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span>
                        <Badge
                          variant="secondary"
                          className={latestVersionApproved ? "border border-success/20 bg-success/10 text-success" : "border border-warning/20 bg-warning/10 text-warning-foreground"}
                        >
                          {t("estimate.header.versionBadge", { version: latestVersionNumber })}
                        </Badge>
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>
                      {t("estimate.header.versionTooltip")}
                    </TooltipContent>
                  </Tooltip>
                ) : null}
              </div>
            )}
          </div>

          {showEstimateWorkspace && (
            <div className="min-w-0 flex-1 basis-[540px] space-y-1">
              <EstimateStatusRail
                status={estimateProject.estimateStatus}
                canEdit={canEditEstimate}
                isTransitioningToInWork={isTransitioningToInWork}
                onChange={handleEstimateStatusChange}
              />
              {!canEditEstimate && (
                <div className="text-caption text-muted-foreground">
                  {canManageEstimate
                    ? t("estimate.header.needsFinanceDetail")
                    : t("estimate.header.ownerOnly")}
                </div>
              )}
            </div>
          )}
        </div>

        {showEstimateWorkspace && (
          <EstimateFinanceHeader
            status={estimateProject.estimateStatus}
            financeMode={estimateFinanceMode}
            useReadOnlySummaryPricing={useReadOnlySummaryPricing}
            currency={estimateProject.currency}
            isContractorMode={isContractorMode}
            view={financeView}
            resourceKeyLabel={(key) => labelForRpcResourceTypeKey(key, t)}
          />
        )}

        {showEstimateWorkspace && <VersionBanner
          hasPending={pendingProposed && Boolean(latestProposed)}
          isOpenByDefault={reviewExpandedByDefault}
          title={t("estimate.versionBanner.title")}
          secondaryActions={undefined}
        >
          <p className="mb-2 text-caption font-medium text-foreground">{t("estimate.versionBanner.changedItems")}</p>
          <VersionDiffList
            changes={diff.changes}
            projectMode={projectMode}
            currency={estimateProject.currency}
            showSensitiveDetail={canViewSensitiveDetail}
          />
        </VersionBanner>}

        <Tabs value={activeTab} onValueChange={handleTabChange}>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <TabsList className="h-auto w-full justify-start gap-1 bg-transparent p-0 flex-nowrap overflow-x-auto whitespace-nowrap sm:w-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <TabsTrigger value="estimate">{t("estimate.tabs.estimate")}</TabsTrigger>
              <TabsTrigger value="work_schedule" disabled={!showEstimateWorkspace}>{t("estimate.tabs.workSchedule")}</TabsTrigger>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span>
                    <TabsTrigger value="work_log" disabled={!showEstimateWorkspace}>
                      {t("estimate.tabs.workLog")}
                    </TabsTrigger>
                  </span>
                </TooltipTrigger>
                {!showEstimateWorkspace && (
                  <TooltipContent>
                    {t("estimate.tabs.workLogDisabledTooltip")}
                  </TooltipContent>
                )}
              </Tooltip>
            </TabsList>

            {showEstimateWorkspace && (
              <div className="flex min-w-0 flex-col items-end gap-1">
                <div className="flex flex-wrap items-center justify-end gap-1">
                  {canExportEstimateCsv && (
                    <button
                      type="button"
                      className={ESTIMATE_TAB_ACTION_CLASSNAME}
                      onClick={() => setExportModalOpen(true)}
                    >
                      <Download /> {t("estimate.header.export")}
                    </button>
                  )}

                  {canEditEstimate && (
                    <button
                      type="button"
                      className={ESTIMATE_TAB_ACTION_CLASSNAME}
                      onClick={() => openConstructor(null, "estimates")}
                    >
                      <Wrench /> {t("estimate.header.constructor")}
                    </button>
                  )}

                  {ctaState.showApprove && (
                    <button
                      type="button"
                      className={cn(ESTIMATE_TAB_ACTION_CLASSNAME, "text-accent hover:bg-accent/10 hover:text-accent")}
                      onClick={() => setApprovalModalOpen(true)}
                      disabled={ctaState.approveDisabled}
                      title={ctaState.approveDisabledReason ?? undefined}
                    >
                      {t("estimate.header.approve")}
                    </button>
                  )}
                </div>

                {ctaState.showApprove && ctaState.approveDisabledReason && (
                  <div className="text-right text-caption text-muted-foreground">{ctaState.approveDisabledReason}</div>
                )}
              </div>
            )}
          </div>

          <TabsContent value="estimate" className="mt-3 space-y-3">
            {!showEstimateWorkspace ? (
              <EmptyState
                icon={AlertTriangle}
                title={t("estimate.empty.title")}
                description={t("estimate.empty.description")}
                actionLabel={canEditEstimate ? t("estimate.empty.createAction") : undefined}
                onAction={canEditEstimate ? handleStartEstimate : undefined}
              />
            ) : (
              <>
            {approvedVersionWithStamp && approvedVersionWithStamp.approvalStamp && (
              <ApprovalStampCard
                stamp={approvedVersionWithStamp.approvalStamp}
                versionNumber={approvedVersionWithStamp.number}
              />
            )}

            {sortedStages.length === 0 ? (
              <div className="rounded-md border border-dashed border-border/70 bg-background/40 p-4">
                <p className="text-sm font-medium text-foreground">{t("estimate.empty.noStagesTitle")}</p>
                <p className="mt-1 text-caption text-muted-foreground">
                  {t("estimate.empty.noStagesDescription")}
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {sortedStages.map((stage) => {
                  const stageWorks = worksByStage.get(stage.id) ?? [];
                  const stageNumber = hierarchyNumbers.stageNumberById.get(stage.id) ?? stage.order;
                  const isCollapsed = collapsedStageIds.has(stage.id);
                  const stageTotals = stageTotalsById.get(stage.id);

                  return (
                    <div key={stage.id} className="group/stage p-0 md:rounded-card md:border md:border-border md:p-2">
                      <div className="flex flex-col gap-1 md:flex-row md:flex-wrap md:items-start md:justify-between md:gap-2">
                        <div className="flex min-w-0 flex-1 items-center gap-1">
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 shrink-0"
                            onClick={() => toggleStageCollapsed(stage.id)}
                          >
                            {isCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                          </Button>
                          <span className="w-6 shrink-0 text-sm font-semibold text-muted-foreground tabular-nums md:w-7">
                            {stageNumber}
                          </span>
                          <LibraryNameInput
                            value={stage.title}
                            kind="stage"
                            searchEnabled={canonicalSearchEnabled}
                            readOnly={!canEditEstimate}
                            startInEditMode={pendingStageTitleEditId === stage.id}
                            onCommit={(nextValue) => updateStage(pid, stage.id, { title: nextValue || stage.title })}
                            className="min-w-0 md:min-w-[220px] flex-1"
                            displayClassName="text-body-sm font-semibold"
                            inputClassName="text-body-sm font-semibold"
                          />
                          {canEditEstimate && (
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7 shrink-0"
                              aria-label={t("estimate.stage.deleteAria", { title: stage.title })}
                              title={t("estimate.stage.deleteTitle")}
                              onClick={() => openStageDelete(stage.id)}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          )}
                        </div>

                        {estimateFinanceMode !== "none" && (
                          <div className="flex items-center gap-1">
                            <span className="text-caption text-muted-foreground">{t("estimate.stage.totalLabel")}</span>
                            <span className="text-sm font-semibold tabular-nums text-foreground">
                              {money(stageTotals?.totalCents ?? 0, estimateProject.currency)}
                            </span>
                          </div>
                        )}
                      </div>

                      {!isCollapsed && (
                        <div className="mt-2 space-y-2 pl-0 md:pl-6">
                          {stageWorks.map((work) => {
                            const workLines = linesByWork.get(work.id) ?? [];
                            const fallbackChecklistRows = !canViewSensitiveDetail && workLines.length === 0
                              ? (checklistFallbackRowsByWork.get(work.id) ?? [])
                              : [];
                            const hasChecklistFallbackRows = fallbackChecklistRows.length > 0;
                            const workNumber = hierarchyNumbers.workNumberById.get(work.id) ?? `${stageNumber}.1`;
                            const showAssignmentColumn = workLines.some((line) => isAssignableResourceType(line.type))
                              || fallbackChecklistRows.some((row) => (
                                isAssignableResourceType(row.type)
                                && Boolean(row.assigneeId || row.assigneeName || row.assigneeEmail)
                              ));
                            const showClientPricingColumns = estimateFinanceMode !== "none" && !hasChecklistFallbackRows;
                            const showDiscountedClientColumn = estimateFinanceMode === "summary"
                              && workLines.some((line) => typeof line.summaryDiscountedClientTotalCents === "number");
                            const tableColumnCount = 3
                              + (showAssignmentColumn ? 1 : 0)
                              + (showEstimateInternalPricing ? 2 : 0)
                              + (showEstimateMarkup ? 1 : 0)
                              + (showEstimateInternalPricing ? 1 : 0)
                              + (showClientPricingColumns ? 2 : 0)
                              + (showDiscountedClientColumn ? 1 : 0)
                              + (canEditEstimate ? 1 : 0);

                            const workTableColumns: WorkTableColumnDef[] = [
                              { key: "resource", title: t("estimate.table.col.resource"), widthPx: 252, sticky: true },
                              ...(showAssignmentColumn
                                ? [{
                                    key: "assigned",
                                    title: (
                                      <span className="inline-flex items-center gap-1" title={t("estimate.table.assignedTitle")}>
                                        <User className="h-3.5 w-3.5" />
                                        <span>{t("estimate.table.col.assigned")}</span>
                                      </span>
                                    ),
                                    widthPx: 116,
                                  } as WorkTableColumnDef]
                                : []),
                              { key: "qty", title: t("estimate.table.col.qty"), widthPx: 72 },
                              { key: "unit", title: t("estimate.table.col.unit"), widthPx: 132 },
                              ...(showEstimateInternalPricing
                                ? [
                                    { key: "costUnit", title: t("estimate.table.col.costUnit"), widthPx: 120, align: "right" } as WorkTableColumnDef,
                                    { key: "costTotal", title: t("estimate.table.col.costTotal"), widthPx: 126, align: "right" } as WorkTableColumnDef,
                                    { key: "vatPct", title: t("estimate.table.col.vatPct"), widthPx: 78, align: "right" } as WorkTableColumnDef,
                                  ]
                                : []),
                              ...(showEstimateMarkup
                                ? [{ key: "markupPct", title: t("estimate.table.col.markupPct"), widthPx: 92, align: "right" } as WorkTableColumnDef]
                                : []),
                              ...(showEstimateInternalPricing
                                ? [{ key: "discountPct", title: t("estimate.table.col.discountPct"), widthPx: 88, align: "right" } as WorkTableColumnDef]
                                : []),
                              ...(showClientPricingColumns
                                ? [
                                    { key: "clientUnit", title: t("estimate.table.col.clientUnit"), widthPx: 120, align: "right" } as WorkTableColumnDef,
                                    { key: "clientTotal", title: t("estimate.table.col.clientTotal"), widthPx: 126, align: "right" } as WorkTableColumnDef,
                                  ]
                                : []),
                              ...(showDiscountedClientColumn
                                ? [{ key: "discountedClient", title: t("estimate.table.col.discountedClient"), widthPx: 140, align: "right" } as WorkTableColumnDef]
                                : []),
                              ...(canEditEstimate
                                ? [{ key: "actions", title: "", widthPx: 36 } as WorkTableColumnDef]
                                : []),
                            ];

                            return (
                              <div key={work.id} className="group/work space-y-2 p-0 md:rounded-md md:border md:border-border/80 md:p-2">
                                <div className="flex flex-wrap items-start justify-between gap-2 pl-0 md:pl-2">
                                  <div className="flex min-w-0 flex-1 items-center gap-2">
                                    <span className="w-12 shrink-0 text-xs font-medium text-muted-foreground tabular-nums">{workNumber}</span>
                                    <LibraryNameInput
                                      value={work.title}
                                      kind="work"
                                      searchEnabled={canonicalSearchEnabled}
                                      readOnly={!canEditEstimate}
                                      startInEditMode={pendingWorkTitleEditId === work.id}
                                      onCommit={(nextValue) => updateWork(pid, work.id, { title: nextValue || work.title })}
                                      className="min-w-0 md:min-w-[220px] flex-1"
                                      displayClassName="text-sm font-medium"
                                      inputClassName="text-sm font-medium"
                                    />
                                  </div>
                                  {canEditEstimate && (
                                    <Button
                                      size="icon"
                                      variant="ghost"
                                      className="h-7 w-7"
                                      aria-label={t("estimate.work.deleteAria", { title: work.title })}
                                      title={t("estimate.work.deleteTitle")}
                                      onClick={() => openWorkDelete(work.id)}
                                    >
                                      <Trash2 className="h-4 w-4 text-destructive" />
                                    </Button>
                                  )}
                                </div>

                                <WorkTableFrame className="table-fixed md:min-w-[980px]" columns={workTableColumns}>
                                    <TableBody>
                                      {workLines.map((line) => {
                                        const computed = lineTotalsById.get(line.id);
                                        if (!computed) return null;
                                        const clientMoney = displayLineClientAmounts(
                                          line,
                                          computed,
                                          { financeMode: lineClientDisplayMode },
                                        );
                                        const typeLabel = t(semanticLabelKeyForType(line.type));
                                        const resolvedUnitSelectValue = resolveUnitSelectValue(line.type, line.unit);
                                        const isCustomUnit = resolvedUnitSelectValue === CUSTOM_UNIT_SENTINEL;
                                        const unitSelectValue = customUnitInputLineIds.has(line.id)
                                          ? CUSTOM_UNIT_SENTINEL
                                          : resolvedUnitSelectValue;
                                        const customDraft = customUnitDraftByLineId[line.id] ?? (isCustomUnit ? line.unit : "");
                                        const shouldShowCustomInput = isCustomUnit || customUnitInputLineIds.has(line.id);
                                        return (
                                          <TableRow key={line.id} className={cn("border-b border-border/40 last:border-b-0 md:border-b-0", changedLineIds.has(line.id) ? "bg-warning/10" : "")}>
                                            <TableCell className="sticky left-0 z-20 w-[252px] border-r border-border bg-card py-1.5 pr-1 align-top shadow-[6px_0_10px_-10px_hsl(var(--foreground)/0.35)] focus-within:z-40">
                                              <div className="flex min-w-0 items-start gap-2">
                                                {canEditEstimate ? (
                                                  <DropdownMenu>
                                                    <DropdownMenuTrigger asChild>
                                                      <button
                                                        type="button"
                                                        title={typeLabel}
                                                        className="rounded-full focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/40"
                                                      >
                                                        <ResourceTypeBadge type={line.type} iconOnly />
                                                      </button>
                                                    </DropdownMenuTrigger>
                                                    <DropdownMenuContent align="start">
                                                      {RESOURCE_TYPE_OPTIONS.map((option) => (
                                                        <DropdownMenuItem
                                                          key={option.value}
                                                          onSelect={() => updateLine(pid, line.id, { type: option.value })}
                                                        >
                                                          <ResourceTypeBadge type={option.value} className="border-transparent" />
                                                        </DropdownMenuItem>
                                                      ))}
                                                    </DropdownMenuContent>
                                                  </DropdownMenu>
                                                ) : (
                                                  <span title={typeLabel}>
                                                    <ResourceTypeBadge type={line.type} iconOnly />
                                                  </span>
                                                )}
                                                <div
                                                  className={cn(
                                                    "flex min-w-0 flex-1 items-start gap-1",
                                                    line.systemResourceArticleId && "group/libname",
                                                  )}
                                                >
                                                  <LibraryNameInput
                                                    value={line.title}
                                                    kind="resource"
                                                    searchEnabled={canonicalSearchEnabled}
                                                    personalEnabled={canonicalSearchEnabled}
                                                    readOnly={!canEditEstimate}
                                                    startInEditMode={pendingLineTitleEditId === line.id}
                                                    onCommit={(nextValue) => updateLine(pid, line.id, { title: nextValue || line.title, systemResourceArticleId: null })}
                                                    onApplySuggestion={(suggestion) => applyResourceSuggestion(line.id, suggestion)}
                                                    className="min-w-0 flex-1"
                                                    displayClassName={cn(
                                                      "whitespace-normal break-words leading-5 line-clamp-2 font-medium",
                                                      line.systemResourceArticleId &&
                                                        "group-hover/libname:underline group-hover/libname:underline-offset-4",
                                                    )}
                                                  />
                                                  {line.systemResourceArticleId ? (
                                                    <button
                                                      type="button"
                                                      title={t("estimate.library.openTooltip")}
                                                      aria-label={t("estimate.library.openTooltip")}
                                                      onClick={(event) => {
                                                        event.stopPropagation();
                                                        openResourceModal(line.id);
                                                      }}
                                                      className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-[3px] text-muted-foreground opacity-60 transition-opacity hover:opacity-100 group-hover/libname:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                                    >
                                                      <ExternalLink className="h-3.5 w-3.5" />
                                                    </button>
                                                  ) : null}
                                                </div>
                                              </div>
                                            </TableCell>

                                            {showAssignmentColumn && (
                                              <TableCell className="w-[116px] py-1.5 pr-1 align-top">
                                                {isAssignableResourceType(line.type) ? (
                                                  <AssigneeCell
                                                    assigneeId={line.assigneeId}
                                                    assigneeName={line.assigneeName}
                                                    assigneeEmail={line.assigneeEmail}
                                                    participants={participantOptions}
                                                    pendingInvites={pendingInviteOptions}
                                                    editable={canEditEstimate}
                                                    clientView={false}
                                                    onInvite={handleAssigneeInvite}
                                                    onCommit={(nextValue) => updateLine(pid, line.id, nextValue)}
                                                  />
                                                ) : (
                                                  <div className="h-7" />
                                                )}
                                              </TableCell>
                                            )}

                                            <TableCell className="w-[72px] py-1.5 pr-1 align-top">
                                              <InlineEditableNumber
                                                value={line.qtyMilli}
                                                readOnly={!canEditEstimate}
                                                align="left"
                                                onCommit={(nextValue) => updateLine(pid, line.id, { qtyMilli: nextValue })}
                                                formatDisplay={(value) => qtyFromMilli(value)}
                                                formatInput={(value) => qtyFromMilli(value)}
                                                parseInput={(raw) => toQtyMilli(raw)}
                                              />
                                            </TableCell>

                                            <TableCell className="w-[132px] py-1.5 pr-1 text-left align-top">
                                              {canEditEstimate ? (
                                                shouldShowCustomInput ? (
                                                  <div className="inline-flex w-full max-w-full items-center justify-start gap-1 text-left">
                                                    <Input
                                                      className="h-7 min-w-0 flex-1 px-1 py-0 text-left text-sm"
                                                      value={customDraft}
                                                      placeholder=""
                                                      aria-label={t("estimate.table.unitAria")}
                                                      onChange={(event) => {
                                                        const nextValue = event.target.value;
                                                        setCustomUnitDraftByLineId((current) => ({
                                                          ...current,
                                                          [line.id]: nextValue,
                                                        }));
                                                      }}
                                                      onBlur={() => commitCustomUnit(line)}
                                                      onKeyDown={(event) => {
                                                        if (event.key !== "Enter") return;
                                                        event.preventDefault();
                                                        commitCustomUnit(line);
                                                      }}
                                                    />
                                                    <DropdownMenu>
                                                      <DropdownMenuTrigger asChild>
                                                        <Button
                                                          type="button"
                                                          variant="ghost"
                                                          size="icon"
                                                          className="h-7 w-5 shrink-0 border border-transparent bg-transparent text-foreground shadow-none hover:bg-muted/60 focus-visible:ring-1 focus-visible:ring-ring/40"
                                                          aria-label={t("estimate.unit.presetAria")}
                                                        >
                                                          <ChevronDown className="h-3.5 w-3.5 opacity-50" />
                                                        </Button>
                                                      </DropdownMenuTrigger>
                                                      <DropdownMenuContent align="end" className="max-h-60 overflow-y-auto">
                                                        {getUnitOptionsForType(line.type).map((unit) => (
                                                          <DropdownMenuItem
                                                            key={`${line.id}-preset-${unit}`}
                                                            onSelect={() => {
                                                              closeCustomUnitInput(line.id);
                                                              updateLine(pid, line.id, { unit });
                                                            }}
                                                          >
                                                            {getUnitLabel(unit, t)}
                                                          </DropdownMenuItem>
                                                        ))}
                                                      </DropdownMenuContent>
                                                    </DropdownMenu>
                                                  </div>
                                                ) : (
                                                  <Select
                                                    value={unitSelectValue}
                                                    onValueChange={(nextValue) => {
                                                      if (nextValue === CUSTOM_UNIT_SENTINEL) {
                                                        openCustomUnitInput(line.id, isCustomUnit ? line.unit : "");
                                                        return;
                                                      }
                                                      closeCustomUnitInput(line.id);
                                                      updateLine(pid, line.id, { unit: nextValue });
                                                    }}
                                                  >
                                                    <SelectTrigger className="h-7 w-full min-w-0 justify-start gap-1 border-transparent bg-transparent px-0 py-0 text-left text-sm shadow-none focus:ring-1 focus:ring-ring/40 [&>span]:min-w-0 [&>span]:flex-1 [&>span]:truncate [&>span]:text-left [&>svg]:h-3.5 [&>svg]:w-3.5 [&>svg]:shrink-0">
                                                      <SelectValue />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                      {buildUnitSelectOptions(line.type, t).map((option) => (
                                                        <SelectItem key={`${line.id}-${option.value}`} value={option.value}>
                                                          {option.label}
                                                        </SelectItem>
                                                      ))}
                                                    </SelectContent>
                                                  </Select>
                                                )
                                              ) : (
                                                <div className="min-h-7 px-1 py-0.5 text-left text-sm text-foreground">
                                                  {line.unit ? getUnitLabel(line.unit, t) : "—"}
                                                </div>
                                              )}
                                            </TableCell>

                                            {showEstimateInternalPricing && (
                                              <TableCell className="w-[120px] py-1.5 pr-2 align-top">
                                                <InlineEditableNumber
                                                  value={line.costUnitCents}
                                                  readOnly={!canEditEstimate}
                                                  onCommit={(nextValue) => updateLine(pid, line.id, { costUnitCents: nextValue })}
                                                  formatDisplay={(value) => money(value, estimateProject.currency)}
                                                  formatInput={(value) => (value / 100).toString()}
                                                  parseInput={(raw) => toCentsFromMajor(raw)}
                                                />
                                              </TableCell>
                                            )}

                                            {showEstimateInternalPricing && (
                                              <TableCell className="w-[126px] py-1.5 pr-2 text-right text-sm tabular-nums align-top">
                                                {money(computed.costTotalCents, estimateProject.currency)}
                                              </TableCell>
                                            )}

                                            {showEstimateInternalPricing && (
                                              <TableCell className="w-[78px] py-1.5 pr-2 align-top">
                                                {canEditEstimate ? (
                                                  <InlineEditableNumber
                                                    value={effectiveTaxForDisplay(line, estimateProject.taxBps)}
                                                    onCommit={(nextValue) => updateLine(pid, line.id, { taxBpsOverride: nextValue > 0 ? nextValue : null })}
                                                    formatDisplay={(value) => `${fromBpsToPercent(value)}%`}
                                                    formatInput={(value) => fromBpsToPercent(value)}
                                                    parseInput={(raw) => toBpsFromPercent(raw)}
                                                  />
                                                ) : (
                                                  <div className="min-h-7 whitespace-nowrap px-1 py-0.5 text-right text-sm tabular-nums text-foreground">
                                                    {`${fromBpsToPercent(effectiveTaxForDisplay(line, estimateProject.taxBps))}%`}
                                                  </div>
                                                )}
                                              </TableCell>
                                            )}

                                            {showEstimateMarkup && (
                                              <TableCell className="w-[88px] py-1.5 pr-2 align-top">
                                                <InlineEditableNumber
                                                  value={effectiveMarkupForDisplay(line, estimateProject.markupBps)}
                                                  readOnly={!canEditEstimate}
                                                  onCommit={(nextValue) => updateLine(pid, line.id, { markupBps: nextValue })}
                                                  formatDisplay={(value) => `${fromBpsToPercent(value)}%`}
                                                  formatInput={(value) => fromBpsToPercent(value)}
                                                  parseInput={(raw) => toBpsFromPercent(raw)}
                                                />
                                              </TableCell>
                                            )}

                                            {showEstimateInternalPricing && (
                                              <TableCell className="w-[92px] py-1.5 pr-2 align-top">
                                                {canEditEstimate ? (
                                                  <InlineEditableNumber
                                                    value={effectiveDiscountForDisplay(line, estimateProject.discountBps)}
                                                    onCommit={(nextValue) => updateLine(pid, line.id, { discountBpsOverride: nextValue > 0 ? nextValue : null })}
                                                    formatDisplay={(value) => `${fromBpsToPercent(value)}%`}
                                                    formatInput={(value) => fromBpsToPercent(value)}
                                                    parseInput={(raw) => toBpsFromPercent(raw)}
                                                  />
                                                ) : (
                                                  <div className="min-h-7 whitespace-nowrap px-1 py-0.5 text-right text-sm tabular-nums text-foreground">
                                                    {`${fromBpsToPercent(effectiveDiscountForDisplay(line, estimateProject.discountBps))}%`}
                                                  </div>
                                                )}
                                              </TableCell>
                                            )}

                                            {showClientPricingColumns && (
                                              <TableCell className="w-[120px] py-1.5 pr-2 text-right text-sm tabular-nums align-top">
                                                {clientMoney ? money(clientMoney.clientUnitCents, estimateProject.currency) : "—"}
                                              </TableCell>
                                            )}
                                            {showClientPricingColumns && (
                                              <TableCell className="w-[126px] py-1.5 pr-2 text-right text-sm tabular-nums align-top">
                                                {clientMoney ? money(clientMoney.clientTotalCents, estimateProject.currency) : "—"}
                                              </TableCell>
                                            )}
                                            {showDiscountedClientColumn && (
                                              <TableCell className="w-[140px] py-1.5 pr-2 text-right text-sm tabular-nums align-top">
                                                {typeof line.summaryDiscountedClientTotalCents === "number"
                                                  ? money(line.summaryDiscountedClientTotalCents, estimateProject.currency)
                                                  : "—"}
                                              </TableCell>
                                            )}

                                            {canEditEstimate && (
                                              <TableCell className="w-9 py-1.5 pr-0 align-top">
                                                <Button
                                                  size="icon"
                                                  variant="ghost"
                                                  className="h-7 w-7"
                                                  aria-label={t("estimate.resource.deleteAria", { title: line.title })}
                                                  title={t("estimate.resource.deleteTitle")}
                                                  onClick={() => openResourceDelete(line.id)}
                                                >
                                                  <Trash2 className="h-4 w-4 text-destructive" />
                                                </Button>
                                              </TableCell>
                                            )}
                                          </TableRow>
                                        );
                                      })}

                                      {fallbackChecklistRows.map((row) => {
                                        const typeLabel = row.typeLabel ?? t(semanticLabelKeyForType(row.type));
                                        return (
                                          <TableRow key={row.id} className="border-b border-border/40 last:border-b-0 md:border-b-0">
                                            <TableCell className="sticky left-0 z-20 w-[252px] border-r border-border bg-card py-1.5 pr-1 align-top shadow-[6px_0_10px_-10px_hsl(var(--foreground)/0.35)]">
                                              <div className="flex min-w-0 items-start gap-2">
                                                <span title={typeLabel}>
                                                  <ResourceTypeBadge
                                                    type={row.type}
                                                    iconOnly
                                                    labelOverride={row.typeLabel ?? undefined}
                                                  />
                                                </span>
                                                <div className="min-w-0 flex-1 whitespace-normal break-words leading-5 font-medium">
                                                  {row.title}
                                                </div>
                                              </div>
                                            </TableCell>

                                            {showAssignmentColumn && (
                                              <TableCell className="w-[116px] py-1.5 pr-1 align-top">
                                                {isAssignableResourceType(row.type) && (row.assigneeName || row.assigneeEmail) ? (
                                                  <div className="flex min-h-7 items-center px-1 py-0.5 text-sm text-foreground">
                                                    {row.assigneeName || row.assigneeEmail}
                                                  </div>
                                                ) : (
                                                  <div className="min-h-7" />
                                                )}
                                              </TableCell>
                                            )}

                                            <TableCell className="w-[72px] py-1.5 pr-1 align-top">
                                              <div className="min-h-7 px-1 py-0.5 text-sm text-foreground tabular-nums">
                                                {row.qtyMilli != null ? qtyFromMilli(row.qtyMilli) : "—"}
                                              </div>
                                            </TableCell>

                                            <TableCell className="w-[132px] py-1.5 pr-1 text-left align-top">
                                              <div className="min-h-7 px-1 py-0.5 text-left text-sm text-foreground">
                                                {row.unit || "—"}
                                              </div>
                                            </TableCell>
                                          </TableRow>
                                        );
                                      })}

                                      {canEditEstimate && (
                                        <TableRow className="border-b-0 hover:bg-transparent">
                                          <TableCell className="sticky left-0 z-20 w-[252px] border-r border-border bg-card py-1 pr-1 shadow-[6px_0_10px_-10px_hsl(var(--foreground)/0.35)]">
                                            <div className="flex h-8 items-center rounded-md border border-dashed border-border/70 bg-background/40 px-2">
                                              <DropdownMenu>
                                                <DropdownMenuTrigger asChild>
                                                  <Button
                                                    type="button"
                                                    size="sm"
                                                    variant="secondary"
                                                    className="h-6 gap-1 px-2 text-xs"
                                                  >
                                                    <Plus className="h-3.5 w-3.5" />
                                                    {t("estimate.resource.addButton")}
                                                  </Button>
                                                </DropdownMenuTrigger>
                                                <DropdownMenuContent
                                                  align="start"
                                                  onCloseAutoFocus={(event) => {
                                                    if (!suppressResourceCreateAutoFocusRef.current) return;
                                                    event.preventDefault();
                                                    suppressResourceCreateAutoFocusRef.current = false;
                                                  }}
                                                >
                                                  {RESOURCE_CREATE_OPTIONS.map((option) => {
                                                    const optionLabel = t(option.labelKey);
                                                    return (
                                                      <DropdownMenuItem
                                                        key={`${work.id}-${option.labelKey}`}
                                                        onSelect={() => handleCreateResourceLine(stage.id, work.id, option)}
                                                      >
                                                        <ResourceTypeBadge
                                                          type={option.value}
                                                          labelOverride={optionLabel}
                                                          className="border-transparent"
                                                        />
                                                      </DropdownMenuItem>
                                                    );
                                                  })}
                                                  {canonicalSearchEnabled && (
                                                    <>
                                                      <DropdownMenuSeparator />
                                                      <DropdownMenuItem
                                                        onSelect={() =>
                                                          openConstructor({ stageId: stage.id, workId: work.id }, "catalog")
                                                        }
                                                      >
                                                        <Layers className="mr-2 h-4 w-4 text-muted-foreground" />
                                                        {t("estimate.constructor.fromLibrary")}
                                                      </DropdownMenuItem>
                                                    </>
                                                  )}
                                                </DropdownMenuContent>
                                              </DropdownMenu>
                                            </div>
                                          </TableCell>
                                          <TableCell colSpan={tableColumnCount - 1} className="py-1" />
                                        </TableRow>
                                      )}
                                    </TableBody>
                                </WorkTableFrame>
                              </div>
                            );
                          })}

                          {canEditEstimate && (
                            <div className="rounded-md border border-dashed border-border/70 bg-background/40 px-2 py-1">
                              <div className="flex h-7 items-center gap-1">
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="secondary"
                                  className="h-6 gap-1 px-2 text-xs"
                                  onClick={() => handleCreateWork(stage.id)}
                                >
                                  <Plus className="h-3.5 w-3.5" />
                                  {t("estimate.work.addButton")}
                                </Button>
                                {canonicalSearchEnabled && (
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="ghost"
                                  className="h-6 gap-1 px-2 text-xs text-muted-foreground"
                                  onClick={() => openConstructor({ stageId: stage.id }, "estimates")}
                                >
                                  <Layers className="h-3.5 w-3.5" />
                                  {t("estimate.constructor.fromLibrary")}
                                </Button>
                                )}
                              </div>
                            </div>
                          )}

                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {canEditEstimate && (
              <div className="rounded-md border border-dashed border-border/70 bg-background/40 p-2">
                <div className="flex items-center gap-1">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  className="h-7 gap-1 px-2 text-xs"
                  onClick={handleCreateStage}
                >
                  <Plus className="h-3.5 w-3.5" />
                  {t("estimate.stage.addButton")}
                </Button>
                {canonicalSearchEnabled && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 gap-1 px-2 text-xs text-muted-foreground"
                  onClick={() => openConstructor(null, "estimates")}
                >
                  <Layers className="h-3.5 w-3.5" />
                  {t("estimate.constructor.fromLibrary")}
                </Button>
                )}
                </div>
              </div>
            )}
            <div className="rounded-lg border border-border p-3">
              <div className="grid items-center gap-x-4 gap-y-2 md:grid-cols-[minmax(0,1fr)_max-content_max-content]">
                <div className="flex min-w-0 items-center gap-2 text-sm font-semibold text-foreground">
                  <span className="truncate">{t("estimate.footer.totalAcrossStages")}</span>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button type="button" className="shrink-0 text-muted-foreground hover:text-foreground">
                        <Info className="h-3.5 w-3.5" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>{t("estimate.footer.helperTooltip")}</TooltipContent>
                  </Tooltip>
                </div>

                {showEstimateInternalPricing && (
                  <div className="flex items-center justify-between gap-2 whitespace-nowrap text-sm md:min-w-[170px] md:justify-end">
                    <span className="text-muted-foreground">{t("estimate.footer.totalCost")}</span>
                    <span className="font-semibold tabular-nums text-foreground">
                      {money(totals.costTotalCents, estimateProject.currency)}
                    </span>
                  </div>
                )}

                {estimateFinanceMode !== "none" && (
                  <div className="flex items-center justify-between gap-2 whitespace-nowrap text-sm md:min-w-[190px] md:justify-end">
                    <span className="text-muted-foreground">{t("estimate.footer.totalForClient")}</span>
                    <span className="font-semibold tabular-nums text-foreground">
                      {money(uiTotalIncVatCents, estimateProject.currency)}
                    </span>
                  </div>
                )}
              </div>

              {estimateFinanceMode !== "none" && (
              <div className="mt-3 border-t border-border pt-3">
                <div className="mb-2 text-caption font-semibold text-muted-foreground">
                  {t("estimate.footer.financialSettings")}
                </div>
                <div className="flex flex-col gap-2">
                  {showEstimateMarkup && (
                    <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted/20 px-3 py-2 text-sm">
                      <span className="text-muted-foreground">{t("estimate.footer.markup")}</span>
                      <div className="flex items-center gap-3">
                        {canEditEstimate ? (
                          <InlineEditableNumber
                            value={estimateProject.markupBps}
                            onCommit={(nextValue) => updateEstimateV2Project(pid, { markupBps: nextValue })}
                            formatDisplay={(value) => (value > 0 ? `${fromBpsToPercent(value)}%` : "—")}
                            formatInput={(value) => fromBpsToPercent(value)}
                            parseInput={(raw) => toBpsFromPercent(raw)}
                            className="w-16"
                            displayClassName="font-semibold text-right"
                            inputClassName="font-semibold text-right"
                          />
                        ) : (
                          <span className="font-semibold tabular-nums text-foreground">
                            {estimateProject.markupBps > 0 ? `${fromBpsToPercent(estimateProject.markupBps)}%` : "—"}
                          </span>
                        )}
                        <span className="min-w-[110px] text-right tabular-nums text-foreground">
                          {money(totals.markupTotalCents, estimateProject.currency)}
                        </span>
                      </div>
                    </div>
                  )}

                  {canViewSensitiveDetail && (
                    <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted/20 px-3 py-2 text-sm">
                      <span className="text-muted-foreground">{t("estimate.footer.discount")}</span>
                      <div className="flex items-center gap-3">
                        {canEditEstimate ? (
                          <InlineEditableNumber
                            value={estimateProject.discountBps}
                            onCommit={(nextValue) => updateEstimateV2Project(pid, { discountBps: nextValue })}
                            formatDisplay={(value) => (value > 0 ? `${fromBpsToPercent(value)}%` : "—")}
                            formatInput={(value) => fromBpsToPercent(value)}
                            parseInput={(raw) => toBpsFromPercent(raw)}
                            className="w-16"
                            displayClassName="font-semibold text-right"
                            inputClassName="font-semibold text-right"
                          />
                        ) : (
                          <span className="font-semibold tabular-nums text-foreground">
                            {estimateProject.discountBps > 0 ? `${fromBpsToPercent(estimateProject.discountBps)}%` : "—"}
                          </span>
                        )}
                        <span className="min-w-[110px] text-right tabular-nums text-foreground">
                          {money(totals.discountTotalCents, estimateProject.currency)}
                        </span>
                      </div>
                    </div>
                  )}

                  <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted/20 px-3 py-2 text-sm">
                    <span className="text-muted-foreground">{t("estimate.footer.vat")}</span>
                    <div className="flex items-center gap-3">
                      {canEditEstimate ? (
                        <InlineEditableNumber
                          value={estimateProject.taxBps}
                          onCommit={(nextValue) => updateEstimateV2Project(pid, { taxBps: nextValue })}
                          formatDisplay={(value) => `${fromBpsToPercent(value)}%`}
                          formatInput={(value) => fromBpsToPercent(value)}
                          parseInput={(raw) => toBpsFromPercent(raw)}
                          className="w-16"
                          displayClassName="font-semibold text-right"
                          inputClassName="font-semibold text-right"
                        />
                      ) : (
                        <span className="font-semibold tabular-nums text-foreground">
                          {fromBpsToPercent(operationalUpperBlock?.vatBps ?? estimateProject.taxBps)}%
                        </span>
                      )}
                      <span className="min-w-[110px] text-right tabular-nums text-foreground">
                        {money(uiTaxAmountCents, estimateProject.currency)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
              )}
            </div>
              </>
            )}
          </TabsContent>

          <TabsContent value="work_schedule" className="mt-3 space-y-3">
            <EstimateGantt
              projectId={pid}
              stages={stages}
              works={works}
              dependencies={dependencies}
              isOwner={canEditEstimate}
            />
          </TabsContent>

        </Tabs>

        <ConfirmModal
          open={Boolean(pendingDelete)}
          onOpenChange={handlePendingDeleteOpenChange}
          title={pendingDelete ? deleteDialogTitle(pendingDelete.assessment, pendingDelete.step, t) : t("common.delete")}
          description={pendingDelete ? pendingDeleteDescription(pendingDelete, t) : ""}
          confirmLabel={pendingDelete ? pendingDeleteConfirmLabel(pendingDelete, t) : t("common.delete")}
          cancelLabel={t("common.cancel")}
          onConfirm={confirmPendingDelete}
          onCancel={() => {
            pendingDeleteNextStepRef.current = null;
            setPendingDelete(null);
          }}
        >
          {pendingDelete?.step === "execution" && pendingDelete.assessment.kind === "stage" && pendingDelete.assessment.startedEntries.length > 0 && (
            <div className="max-h-48 overflow-auto rounded-md border border-border p-2">
              <p className="mb-2 text-caption text-muted-foreground">{t("estimate.delete.startedHeading")}</p>
              <ul className="space-y-1">
                {pendingDelete.assessment.startedEntries.map((entry) => (
                  <li key={`${entry.kind}-${entry.id}`} className="text-caption text-foreground">
                    {entry.kind === "work"
                      ? t("estimate.delete.startedEntry.work", { title: entry.title, status: entry.statusLabel })
                      : t("estimate.delete.startedEntry.task", { title: entry.title, status: entry.statusLabel })}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {pendingDelete?.step === "financial" && pendingDelete.assessment.financial.hasConsequences && (
            <div className="max-h-56 overflow-auto rounded-md border border-border p-2 space-y-3">
              {pendingDelete.assessment.financial.procurement.length > 0 && (
                <div>
                  <p className="mb-2 text-caption text-muted-foreground">{t("estimate.delete.procurementHeading")}</p>
                  <ul className="space-y-1">
                    {pendingDelete.assessment.financial.procurement.map((item) => (
                      <li key={item.procurementItemId} className="text-caption text-foreground">
                        {item.title} ({procurementConsequenceLabel(item, t)})
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {pendingDelete.assessment.financial.hr.length > 0 && (
                <div>
                  <p className="mb-2 text-caption text-muted-foreground">{t("estimate.delete.hrHeading")}</p>
                  <ul className="space-y-1">
                    {pendingDelete.assessment.financial.hr.map((item) => (
                      <li key={item.hrItemId} className="text-caption text-foreground">
                        {item.title} ({hrConsequenceLabel(item, t)})
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </ConfirmModal>

        <ConfirmModal
          open={missingDatesWorkIds.length > 0}
          onOpenChange={(open) => {
            if (!open) setMissingDatesWorkIds([]);
          }}
          title={t("estimate.missingDates.title")}
          description={t("estimate.missingDates.description")}
          confirmLabel={t("estimate.missingDates.skipSetup")}
          cancelLabel={t("common.cancel")}
          onConfirm={handleSkipSetup}
          onCancel={() => setMissingDatesWorkIds([])}
        >
          <div className="max-h-48 overflow-auto rounded-md border border-border p-2">
            <ul className="space-y-1">
              {missingDatesWorkIds.map((workId) => {
                const work = workById.get(workId);
                return (
                  <li key={workId} className="text-caption text-foreground">
                    {work?.title ?? workId}
                  </li>
                );
              })}
            </ul>
          </div>
        </ConfirmModal>

        <ConfirmModal
          open={incompleteTaskBlocks.length > 0}
          onOpenChange={(open) => {
            if (!open) setIncompleteTaskBlocks([]);
          }}
          title={t("estimate.finish.blockedTitle")}
          description={t("estimate.finish.blockedDescription")}
          confirmLabel={t("estimate.finish.markAllDone")}
          cancelLabel={t("common.close")}
          tertiaryLabel={t("estimate.finish.goToWorkLog")}
          onTertiary={handleGoToWorkLog}
          onConfirm={() => {
            void handleMarkAllTasksDone();
          }}
          onCancel={() => setIncompleteTaskBlocks([])}
        >
          <div className="max-h-48 overflow-auto rounded-md border border-border p-2">
            <ul className="space-y-1">
              {incompleteTaskBlocks.map((task, index) => (
                <li key={`${task.taskId ?? "missing"}-${index}`} className="text-caption text-foreground">
                  {task.title}
                </li>
              ))}
            </ul>
          </div>
        </ConfirmModal>

        <ConfirmModal
          open={Boolean(bulkFinishedTasks)}
          onOpenChange={(open) => {
            if (!open) setBulkFinishedTasks(null);
          }}
          title={t("estimate.finish.allDoneTitle")}
          description={t("estimate.finish.allDoneDescription")}
          confirmLabel={t("estimate.finish.markFinished")}
          cancelLabel={t("estimate.finish.notNow")}
          onConfirm={() => {
            void handleConfirmFinishAfterBulkDone();
          }}
          onCancel={() => setBulkFinishedTasks(null)}
        />

        <ApprovalStampFormModal
          open={approvalModalOpen}
          onOpenChange={setApprovalModalOpen}
          title={t("estimate.approve.title")}
          defaults={{
            name: currentUser.name.split(" ")[0] ?? "",
            surname: currentUser.name.split(" ").slice(1).join(" "),
            email: currentUser.email,
          }}
          onSubmit={handleProjectApprove}
        />

        <EstimateExportModal
          open={exportModalOpen}
          onOpenChange={setExportModalOpen}
          payload={exportPayload}
          canShowInternal={canViewSensitiveDetail}
          onDownloadCsv={handleExportCsv}
          onEnsureShareLink={ensureShareLinkForExport}
        />

        <ResourceModal
          open={resourceModalLine != null && Boolean(resourceModalLine.systemResourceArticleId)}
          onOpenChange={(open) => {
            if (!open) setResourceModalLineId(null);
          }}
          articleId={resourceModalLine?.systemResourceArticleId ?? null}
          projectId={pid}
          line={resourceModalLine}
          lines={lines}
          versions={versions}
          canViewSensitiveDetail={canViewSensitiveDetail}
        />

        <EstimateConstructor
          open={constructorOpen}
          onOpenChange={setConstructorOpen}
          projectId={pid}
          estimateVersionId={constructorVersionQuery.data ?? null}
          canApply={workspaceMode.kind === "supabase" && !constructorVersionQuery.isError}
          profileId={constructorProfileId}
          target={constructorTarget}
          initialTab={constructorTab}
          onAddCatalogResource={handleAddCatalogResource}
          onAddPersonalItem={handleAddPersonalCatalogItem}
        />
      </div>
    </div>
  );
}
