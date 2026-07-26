import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import { trackEvent } from "@/lib/analytics";
import {
  AlertTriangle,
  CalendarIcon,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Link2,
  Loader2,
  Search,
  ShoppingCart,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Calendar } from "@/components/ui/calendar";
import { EmptyState } from "@/components/EmptyState";
import { ProjectWorkflowEmptyState } from "@/components/ProjectWorkflowEmptyState";
import { StatusBadge } from "@/components/StatusBadge";
import { useProject } from "@/hooks/use-mock-data";
import { useOrders } from "@/hooks/use-order-data";
import { useAllProjectsLocations, useInventoryStock, useLocations } from "@/hooks/use-inventory-data";
import {
  actionStateToControlProps,
  getProjectDomainAccess,
  getProjectRole,
  projectDomainAllowsManage,
  seamCanViewOperationalFinanceSummary,
  seamCanViewSensitiveDetail,
  seamResolveActionState,
  usePermission,
} from "@/lib/permissions";
import {
  archiveProcurementItem,
  updateProcurementItem,
} from "@/data/procurement-store";
import {
  clearEstimateV2ProjectAccessContext,
  registerEstimateV2ProjectAccessContext,
} from "@/data/estimate-v2-store";
import { getOrdersSource } from "@/data/orders-source";
import { diffProcurementItemPatch, getProcurementSource } from "@/data/procurement-source";
import { consumeStockFromInventory, updateOrder } from "@/data/order-store";
import { addEvent, addTask, getCurrentUser, getTask, getUserById } from "@/data/store";
import {
  collectItemLocationEventHistory,
  computeProcurementHeaderKpis,
  computeLastReceivedAt,
  computeInStockByLocation,
  computeProjectLastReceivedAt,
  computePurchasePriceVariance,
  computeRemainingRequestedQty,
  computeTabChipTotals,
  isAppliedOrderStatus,
  isEstimateLinkedProcurementItem,
  isOpenOrderStatus,
  toInventoryKey,
} from "@/lib/procurement-fulfillment";
import { fmtCost } from "@/lib/procurement-utils";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { OrderModal } from "@/components/procurement/OrderModal";
import { OrderDetailModal } from "@/components/procurement/OrderDetailModal";
import {
  ProcurementFinanceHeader,
  type ProcurementFinanceView,
} from "@/components/procurement/ProcurementFinanceHeader";
import { ItemTypePicker } from "@/components/procurement/ItemTypePicker";
import { LocationPicker } from "@/components/procurement/LocationPicker";
import { ResourceTypeBadge } from "@/components/estimate-v2/ResourceTypeBadge";
import { isProcurementResourceLineType, resourceLineTypeToPersisted, projectToProcurementItemType } from "@/lib/estimate-v2/resource-type-contract";
import { useEstimateV2Project, useEstimateV2ProjectionCapability } from "@/hooks/use-estimate-v2-data";
import { useReceiveCrossProjectTransfer } from "@/hooks/use-cross-project-transfer";
import { inventoryQueryKeys } from "@/hooks/use-inventory-data";
import {
  orderPlacedSupplierOrdersQueryRoot,
  orderProjectOrdersQueryRoot,
  orderQueryKeys,
} from "@/hooks/use-order-data";
import { procurementProjectItemsQueryRoot, procurementQueryKeys, useProjectProcurementItemsState } from "@/hooks/use-procurement-source";
import { useWorkspaceCurrentUserState, useWorkspaceMode, useWorkspaceProjectsState } from "@/hooks/use-workspace-source";
import { computeProjectTotals } from "@/lib/estimate-v2/pricing";
import type {
  Event,
  OrderWithLines,
  ProcurementAttachment,
  ProcurementItemV2,
  ProcurementItemType,
  Task,
} from "@/types/entities";

type ProcurementTab = "requested" | "ordered" | "in_stock";

type ProcurementListState = {
  search: string;
  activeTab: ProcurementTab;
  collapsedStageIds: string[];
  scrollY: number;
};

const EMPTY_SYNC_STATE = {
  estimateRevision: null,
  domains: {
    tasks: { status: "idle", projectedRevision: null, lastAttemptedAt: null, lastSucceededAt: null, lastError: null },
    procurement: { status: "idle", projectedRevision: null, lastAttemptedAt: null, lastSucceededAt: null, lastError: null },
    hr: { status: "idle", projectedRevision: null, lastAttemptedAt: null, lastSucceededAt: null, lastError: null },
  },
} as const;

const TABS: ProcurementTab[] = ["requested", "ordered", "in_stock"];

type Translator = (key: string, options?: Record<string, unknown>) => string;

const TAB_META: Record<ProcurementTab, { labelKey: string; className: string }> = {
  requested: { labelKey: "procurement.tabs.requested", className: "bg-warning/15 text-warning border-warning/30" },
  ordered: { labelKey: "procurement.tabs.ordered", className: "bg-info/15 text-info border-info/25" },
  in_stock: { labelKey: "procurement.tabs.inStock", className: "bg-success/15 text-success border-success/25" },
};

function decodeInventoryKeyParts(inventoryKey: string, t: Translator): {
  title: string;
  spec: string | null;
  unit: string;
} {
  const [rawTitle = "", rawSpec = "", rawUnit = ""] = inventoryKey.split("|");
  return {
    title: rawTitle || t("procurement.inventoryItem.fallback"),
    spec: rawSpec || null,
    unit: rawUnit || t("procurement.unit.fallback"),
  };
}

function listStateKey(projectId: string): string {
  return `procurement-v3:list-state:${projectId}`;
}

function readListState(projectId: string): ProcurementListState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(listStateKey(projectId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ProcurementListState>;
    const activeTab = TABS.includes(parsed.activeTab as ProcurementTab)
      ? (parsed.activeTab as ProcurementTab)
      : "requested";

    return {
      search: typeof parsed.search === "string" ? parsed.search : "",
      activeTab,
      collapsedStageIds: Array.isArray(parsed.collapsedStageIds)
        ? parsed.collapsedStageIds.filter((value): value is string => typeof value === "string")
        : [],
      scrollY: typeof parsed.scrollY === "number" ? parsed.scrollY : 0,
    };
  } catch {
    return null;
  }
}

function writeListState(projectId: string, state: ProcurementListState) {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(listStateKey(projectId), JSON.stringify(state));
}

// Parse a stored required-by date. A bare YYYY-MM-DD (what the picker writes) must be read as a
// LOCAL date so write and read agree in every timezone; a full ISO timestamp (estimate-synced
// dates) keeps its instant semantics.
function parseProcurementDate(value: string): Date {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-").map(Number);
    return new Date(year, month - 1, day);
  }
  return new Date(value);
}

function formatDate(value: string | null | undefined, dash: string): string {
  if (!value) return dash;
  const parsed = parseProcurementDate(value);
  if (Number.isNaN(parsed.getTime())) return dash;
  return parsed.toLocaleDateString();
}

// Format a picked calendar date as a local YYYY-MM-DD string. Using toISOString() here would
// convert local midnight to UTC and roll the date back a day for UTC-positive users (the primary
// market is UTC+3), so the persisted required-by date would land one day early.
function toLocalDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isOverdue(value?: string | null): boolean {
  if (!value) return false;
  const parsed = parseProcurementDate(value);
  if (Number.isNaN(parsed.getTime())) return false;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return parsed.getTime() < now.getTime();
}

function attachmentDisplayName(att: ProcurementAttachment): string {
  if (att.name?.trim()) return att.name;
  try {
    const parsed = new URL(att.url);
    return `${parsed.host}${parsed.pathname}`;
  } catch {
    return att.url;
  }
}

function newAttachmentId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function orderStatusLabel(status: "draft" | "placed" | "partially_received" | "received" | "voided", t: Translator): string {
  if (status === "draft") return t("procurement.orderStatus.draft");
  if (status === "placed") return t("procurement.orderStatus.ordered");
  if (status === "partially_received") return t("procurement.orderStatus.partiallyReceived");
  if (status === "voided") return t("procurement.orderStatus.voided");
  return t("procurement.orderStatus.inStock");
}

type OrderedReceivableTarget = {
  selectionKey: string;
  orderId: string;
  lineId: string;
  procurementItemId: string;
  itemType: ProcurementItemType;
  itemName: string;
  itemSpec: string | null;
  orderedQty: number;
  alreadyReceivedQty: number;
  remainingQty: number;
  unit: string;
  unitPrice: number;
  locationId: string | null;
};

type InStockTableRow = {
  key: string;
  procurementItemId: string;
  item: ProcurementItemV2;
  locationId: string;
  locationName: string;
  qty: number;
  orderIds: string[];
  lastReceivedAt: string | null;
  receiverName: string | null;
};

export default function ProjectProcurement() {
  const { t } = useTranslation();
  const dash = "—";
  const { id: projectId, itemId, orderId } = useParams<{ id: string; itemId?: string; orderId?: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const pid = projectId!;
  const workspaceMode = useWorkspaceMode();
  const { user: currentUser } = useWorkspaceCurrentUserState();
  const supabaseMode = workspaceMode.kind === "supabase" ? workspaceMode : null;
  const isSupabaseMode = workspaceMode.kind === "supabase";

  const savedListState = useMemo(() => readListState(pid), [pid]);

  const { items: baseItems, isLoading: isProcurementItemsLoading } = useProjectProcurementItemsState(pid);
  const orders = useOrders(pid);
  const hasPlacedSupplierOrderLines = useMemo(
    () => orders.some((o) => o.kind === "supplier" && isOpenOrderStatus(o.status) && o.lines.length > 0),
    [orders],
  );
  const locations = useLocations(pid);
  const stockRows = useInventoryStock(pid);
  const { project, members, stages } = useProject(pid);
  const currentMembership = members.find((member) => member.user_id === currentUser.id) ?? null;
  const estimateState = useEstimateV2Project(pid);
  const estimateSync = estimateState.sync ?? EMPTY_SYNC_STATE;
  const perm = usePermission(pid);
  const projectRole = getProjectRole(perm.seam);
  const procurementAccess = getProjectDomainAccess(perm.seam, "procurement");
  const canViewSensitiveDetail = seamCanViewSensitiveDetail(perm.seam);
  const canViewOperationalFinanceSummary = seamCanViewOperationalFinanceSummary(perm.seam);
  const canManageProcurement = projectDomainAllowsManage(procurementAccess);
  const showSupplier = projectRole !== "viewer";

  const orderActionState = seamResolveActionState(perm.seam, "procurement", "order");
  const receiveActionState = seamResolveActionState(perm.seam, "procurement", "receive");
  const useFromStockActionState = seamResolveActionState(perm.seam, "procurement", "use_from_stock");

  const orderControl = actionStateToControlProps(orderActionState, { disabledReason: t("procurement.disabled.orderRole") });
  const receiveControl = actionStateToControlProps(receiveActionState, { disabledReason: t("procurement.disabled.receiveRole") });
  const useFromStockControl = actionStateToControlProps(useFromStockActionState, { disabledReason: t("procurement.disabled.useFromStockRole") });

  const showProcurementActions = orderControl.visible || receiveControl.visible || useFromStockControl.visible;
  const canEdit = canManageProcurement;
  // Persisting item edits writes to procurement_items, whose SELECT RLS requires sensitive-detail
  // finance visibility. A write-capable but finance-restricted member loads items via the redacted
  // operational-summary RPC and cannot read the row back, so a direct write would either false-fail
  // (the post-write read returns no row) or persist values they cannot verify. In supabase mode,
  // gate the detail Save/Archive on the same sensitive-detail access the read path requires.
  const canPersistProcurementDetail = canEdit && (!isSupabaseMode || canViewSensitiveDetail);
  const canLaunchOrderFlows = canManageProcurement
    && (canViewSensitiveDetail || canViewOperationalFinanceSummary);
  const canUseFromStock = canManageProcurement;
  const useFromStockEffectiveDisabled = useFromStockControl.disabled;
  const useFromStockEffectiveReason = useFromStockControl.disabled
    ? useFromStockControl.disabledReason
    : undefined;
  const visibleTabs = TABS;
  const procurementSyncState = estimateSync.domains.procurement;
  // Sync-state gating is only meaningful for the session that runs projections;
  // readers consume the DB truth via react-query (see ProjectTasks for details).
  const projectionCapability = useEstimateV2ProjectionCapability(pid);
  const isProjectorSession = isSupabaseMode && projectionCapability === "projector";
  const isProcurementSyncing = isProjectorSession && procurementSyncState.status === "syncing";
  const hasProcurementSyncError = isProjectorSession && procurementSyncState.status === "error";
  const isProcurementProjectionBehind = isProjectorSession
    && canManageProcurement
    && estimateState.project.estimateStatus !== "planning"
    && procurementSyncState.status !== "skipped"
    && procurementSyncState.projectedRevision !== estimateSync.estimateRevision
    && !isProcurementSyncing
    && !hasProcurementSyncError;
  const shouldBlockProcurementLaunchActions = isProcurementProjectionBehind || hasProcurementSyncError;

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

  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.debug("[ProcurementDebug]", {
      projectRole,
      isSupabaseMode,
      estimateStatus: estimateState.project.estimateStatus,
      syncDomainStatus: procurementSyncState.status,
      syncLastError: procurementSyncState.lastError,
      projectedRevision: procurementSyncState.projectedRevision,
      estimateRevision: estimateSync.estimateRevision,
      isProcurementSyncing,
      hasProcurementSyncError,
      isProcurementProjectionBehind,
      shouldBlockProcurementLaunchActions,
      canManageProcurement,
      canLaunchOrderFlows,
      canViewSensitiveDetail,
      canUseFromStock,
      orderDisabled: orderControl.disabled,
      receiveDisabled: receiveControl.disabled,
      useFromStockDisabled: useFromStockControl.disabled,
    });
  }

  const items = useMemo(() => {
    const workById = new Map(estimateState.works.map((work) => [work.id, work]));
    const lineById = new Map(estimateState.lines.map((line) => [line.id, line]));
    const nowIso = new Date().toISOString();

    const stageStartByStageId = new Map<string, string>();
    estimateState.works.forEach((work) => {
      if (!work.plannedStart) return;
      if (!work.stageId) return;

      const ts = new Date(work.plannedStart).getTime();
      if (!Number.isFinite(ts)) return;

      const existing = stageStartByStageId.get(work.stageId);
      if (!existing) {
        stageStartByStageId.set(work.stageId, work.plannedStart);
        return;
      }

      const existingTs = new Date(existing).getTime();
      if (Number.isFinite(existingTs) && ts < existingTs) {
        stageStartByStageId.set(work.stageId, work.plannedStart);
      }
    });

    const fallbackStageId = estimateState.stages[0]?.id ?? null;
    const derivedItems = baseItems.map((item) => {
      const lineId = item.sourceEstimateV2LineId ?? null;
      if (!lineId) return item;
      const line = lineById.get(lineId);
      if (!line) return item;

      const work = workById.get(line.workId) ?? null;
      const resolvedStageId = line.stageId || work?.stageId || fallbackStageId;
      if (!resolvedStageId) return item;

      const requiredByDate = work?.plannedStart ?? stageStartByStageId.get(resolvedStageId) ?? null;
      const proj = projectToProcurementItemType(resourceLineTypeToPersisted(line.type));
      const derivedType: ProcurementItemType = proj.kind === "ok" ? proj.type : "other";
      const requiredQty = Math.max(0, line.qtyMilli / 1_000);
      const plannedUnitPrice = Math.max(0, line.costUnitCents / 100);

      return {
        ...item,
        stageId: resolvedStageId,
        type: derivedType,
        name: line.title,
        requiredByDate,
        requiredQty,
        plannedUnitPrice,
      };
    });

    const linkedLineIds = new Set(
      derivedItems
        .map((item) => item.sourceEstimateV2LineId ?? null)
        .filter((lineId): lineId is string => !!lineId),
    );

    const missingDerivedItems = estimateState.lines
      .filter((line) => isProcurementResourceLineType(line.type))
      .filter((line) => !linkedLineIds.has(line.id))
      .map((line) => {
        const work = workById.get(line.workId) ?? null;
        const resolvedStageId = line.stageId || work?.stageId || fallbackStageId;
        const requiredByDate = work?.plannedStart ?? (resolvedStageId ? stageStartByStageId.get(resolvedStageId) ?? null : null);
        const proj = projectToProcurementItemType(resourceLineTypeToPersisted(line.type));
        const derivedType: ProcurementItemType = proj.kind === "ok" ? proj.type : "other";
        const requiredQty = Math.max(0, line.qtyMilli / 1_000);
        const plannedUnitPrice = Math.max(0, line.costUnitCents / 100);

        return {
          id: `estimate-line-${line.id}`,
          projectId: line.projectId,
          stageId: resolvedStageId ?? null,
          categoryId: null,
          type: derivedType,
          name: line.title,
          spec: null,
          unit: line.unit,
          requiredByDate,
          requiredQty,
          orderedQty: 0,
          receivedQty: 0,
          plannedUnitPrice,
          actualUnitPrice: null,
          supplier: null,
          supplierPreferred: null,
          locationPreferredId: null,
          lockedFromEstimate: true,
          sourceEstimateItemId: null,
          sourceEstimateV2LineId: line.id,
          orphaned: false,
          orphanedAt: null,
          orphanedReason: null,
          linkUrl: null,
          notes: null,
          attachments: [],
          createdFrom: "estimate",
          linkedTaskIds: [],
          archived: false,
          createdAt: nowIso,
          updatedAt: nowIso,
        } satisfies ProcurementItemV2;
      });

    return isSupabaseMode ? derivedItems : [...derivedItems, ...missingDerivedItems];
  }, [baseItems, estimateState.lines, estimateState.works, estimateState.stages, isSupabaseMode]);

  const [search, setSearch] = useState(savedListState?.search ?? "");
  const [activeTab, setActiveTab] = useState<ProcurementTab>(() => {
    const savedTab = savedListState?.activeTab;
    if (savedTab && visibleTabs.includes(savedTab)) return savedTab;
    return "requested";
  });
  const [collapsedStages, setCollapsedStages] = useState<Set<string>>(new Set(savedListState?.collapsedStageIds ?? []));
  const [collapsedOrderIds, setCollapsedOrderIds] = useState<Set<string>>(new Set());
  const [expandedReceivedOrderIds, setExpandedReceivedOrderIds] = useState<Set<string>>(new Set());
  const [selectedRequestedIds, setSelectedRequestedIds] = useState<Set<string>>(new Set());
  const [selectedOrderedLineKeys, setSelectedOrderedLineKeys] = useState<Set<string>>(new Set());
  const [selectedInStockRowKeys, setSelectedInStockRowKeys] = useState<Set<string>>(new Set());
  const [receiveModalOpen, setReceiveModalOpen] = useState(false);
  const [receiveModalTargets, setReceiveModalTargets] = useState<OrderedReceivableTarget[]>([]);
  const [receiveModalQtyByKey, setReceiveModalQtyByKey] = useState<Record<string, number>>({});
  const [receiveModalLocationByKey, setReceiveModalLocationByKey] = useState<Record<string, string>>({});
  const [receiveItemsConfirmInFlight, setReceiveItemsConfirmInFlight] = useState(false);
  const receiveItemsConfirmInFlightRef = useRef(false);
  const detailMutationInFlightRef = useRef(false);
  const [useFromStockOpen, setUseFromStockOpen] = useState(false);
  const [useFromStockTargets, setUseFromStockTargets] = useState<InStockTableRow[]>([]);
  const [useFromStockQtyByKey, setUseFromStockQtyByKey] = useState<Record<string, string>>({});
  const [useFromStockParticipantId, setUseFromStockParticipantId] = useState("none");
  const [useFromStockManualName, setUseFromStockManualName] = useState("");
  const [useFromStockNote, setUseFromStockNote] = useState("");
  const [inStockDetailTarget, setInStockDetailTarget] = useState<InStockTableRow | null>(null);
  const [inStockDetailOpen, setInStockDetailOpen] = useState(false);

  const [createOrderOpen, setCreateOrderOpen] = useState(false);
  const [createOrderItemIds, setCreateOrderItemIds] = useState<string[]>([]);

  const detailItem = itemId ? (items.find((item) => item.id === itemId) ?? null) : null;
  const [editForm, setEditForm] = useState<Partial<ProcurementItemV2>>({});
  const [attachmentUrl, setAttachmentUrl] = useState("");

  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftRef = useRef<Partial<ProcurementItemV2>>({});
  const lastPersistedSignatureRef = useRef<string>("");
  const initializedDetailIdRef = useRef<string | null>(null);
  const revokedObjectUrlsRef = useRef<Set<string>>(new Set());
  const pendingRevokesRef = useRef<Set<string>>(new Set());
  const filePickerRef = useRef<HTMLInputElement | null>(null);

  const normalizedBudget = useMemo(() => {
    const totals = computeProjectTotals(
      estimateState.project,
      estimateState.stages,
      estimateState.works,
      estimateState.lines,
      estimateState.project.projectMode,
    );
    const procurementCostCents = totals.breakdownByType.material + totals.breakdownByType.tool;
    return procurementCostCents / 100;
  }, [estimateState.project, estimateState.stages, estimateState.works, estimateState.lines]);

  const persistListState = useCallback((overrides?: Partial<ProcurementListState>) => {
    writeListState(pid, {
      search,
      activeTab,
      collapsedStageIds: Array.from(collapsedStages),
      scrollY: window.scrollY,
      ...overrides,
    });
  }, [pid, search, activeTab, collapsedStages]);

  useEffect(() => {
    persistListState();
  }, [persistListState]);

  useEffect(() => {
    const onScroll = () => persistListState({ scrollY: window.scrollY });
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [persistListState]);

  useEffect(() => {
    if (visibleTabs.includes(activeTab)) return;
    setActiveTab("requested");
  }, [activeTab, visibleTabs]);

  useEffect(() => {
    if (canManageProcurement) return;
    if (!itemId && !orderId) return;
    navigate(`/project/${pid}/procurement`, { replace: true });
  }, [canManageProcurement, itemId, navigate, orderId, pid]);

  useEffect(() => {
    if (!savedListState) return;
    requestAnimationFrame(() => {
      window.scrollTo({ top: savedListState.scrollY, left: 0, behavior: "auto" });
    });
    const timer = window.setTimeout(() => {
      window.scrollTo({ top: savedListState.scrollY, left: 0, behavior: "auto" });
    }, 120);
    return () => window.clearTimeout(timer);
  }, [savedListState]);

  const remainingByItemId = useMemo(() => {
    const map = new Map<string, number>();
    items.forEach((item) => {
      map.set(item.id, computeRemainingRequestedQty(item, orders));
    });
    return map;
  }, [items, orders]);

  const headerKpis = useMemo(
    () => computeProcurementHeaderKpis(pid, items, orders),
    [pid, items, orders],
  );

  const chipTotals = useMemo(
    () => computeTabChipTotals(pid, items, orders, stockRows),
    [pid, items, orders, stockRows],
  );

  // Single major→cents conversion boundary: the fulfillment lib works in rubles,
  // the finance header (shared formatters) in cents.
  const procurementFinanceView = useMemo<ProcurementFinanceView>(() => {
    const toCents = (value: number) => Math.round(value * 100);
    const toCentsOrNull = (value: number | null) => (value === null ? null : toCents(value));
    const used = headerKpis.used;
    const nameById = new Map(items.map((item) => [item.id, item.name]));
    const ppv = computePurchasePriceVariance(pid, items, orders);
    const inStockGroups = computeInStockByLocation(pid, items, orders, locations);
    // One in-stock source for the card AND the by-location breakdown (and the tab
    // table): event-replay valuation at per-item prices. The snapshot-based chip
    // total stays a count-only signal on the tab button.
    const inStockValue = inStockGroups.reduce((sum, group) => sum + group.totalValue, 0);

    return {
      budgetCents: toCents(normalizedBudget),
      receivedCents: toCentsOrNull(headerKpis.received),
      inTransitCents: toCentsOrNull(headerKpis.committed),
      usedCents: toCentsOrNull(used),
      remainingBudgetCents: used === null ? null : toCents(normalizedBudget - used),
      toOrderCents: toCents(chipTotals.requested.total),
      inStockValueCents: toCents(inStockValue),
      hasLinkedItems: headerKpis.hasLinkedItems,
      missingPlannedPriceCount: headerKpis.missingPlannedPriceCount,
      missingOrderPriceCount: headerKpis.missingOrderPriceCount,
      ppv: {
        deltaCents: toCents(ppv.deltaTotal),
        pct: ppv.pct,
        lines: ppv.lines.slice(0, 5).map((line) => ({
          procurementItemId: line.procurementItemId,
          name: nameById.get(line.procurementItemId) ?? line.procurementItemId,
          deltaCents: toCents(line.deltaTotal),
        })),
      },
      inStockByLocation: inStockGroups.map((group) => ({
        locationId: group.locationId,
        locationName: group.locationName,
        totalValueCents: toCents(group.totalValue),
        itemCount: group.items.length,
      })),
      lastReceivedAt: computeProjectLastReceivedAt(pid, orders),
    };
  }, [chipTotals, headerKpis, items, locations, normalizedBudget, orders, pid]);

  const itemById = useMemo(
    () => new Map(items.map((item) => [item.id, item])),
    [items],
  );

  const orderedTableColumnCount = useMemo(() => {
    let n = 5;
    if (showProcurementActions) n += 1;
    if (canViewSensitiveDetail) n += 2;
    if (showProcurementActions) n += 1;
    return n;
  }, [showProcurementActions, canViewSensitiveDetail]);

  const defaultLocationId = useMemo(
    () => locations.find((location) => location.isDefault)?.id ?? locations[0]?.id ?? null,
    [locations],
  );

  const locationById = useMemo(
    () => new Map(locations.map((location) => [location.id, location])),
    [locations],
  );

  const participantNameById = useMemo(() => {
    const map = new Map<string, string>();
    members.forEach((member) => {
      const user = getUserById(member.user_id);
      if (!user) return;
      map.set(user.id, user.name);
    });
    return map;
  }, [members]);
  const participantOptions = useMemo(() => (
    members
      .map((member) => {
        const user = getUserById(member.user_id);
        if (!user) return null;
        return { id: user.id, name: user.name };
      })
      .filter((entry): entry is { id: string; name: string } => !!entry)
  ), [members]);

  const ownerAssigneeId = useMemo(
    () => project?.owner_id ?? members.find((member) => member.role === "owner")?.user_id ?? getCurrentUser().id,
    [project?.owner_id, members],
  );

  const isItemSearchMatch = useCallback((item: ProcurementItemV2) => {
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    return item.name.toLowerCase().includes(q) || (item.spec?.toLowerCase().includes(q) ?? false);
  }, [search]);

  const requestedItems = useMemo(() => {
    const estimateLinkedItems = items.filter(isEstimateLinkedProcurementItem);
    const remainingPositiveItems = estimateLinkedItems.filter((item) => (remainingByItemId.get(item.id) ?? 0) > 0);
    return remainingPositiveItems.filter(isItemSearchMatch);
  }, [items, remainingByItemId, isItemSearchMatch]);

  const requestedStageMap = useMemo(() => {
    const map = new Map<string, ProcurementItemV2[]>();
    const unstaged: ProcurementItemV2[] = [];

    requestedItems.forEach((item) => {
      if (!item.stageId) {
        unstaged.push(item);
        return;
      }
      const list = map.get(item.stageId) ?? [];
      list.push(item);
      map.set(item.stageId, list);
    });

    return { map, unstaged };
  }, [requestedItems]);

  useEffect(() => {
    if (activeTab !== "requested" && selectedRequestedIds.size > 0) {
      setSelectedRequestedIds(new Set());
    }
  }, [activeTab, selectedRequestedIds.size]);

  useEffect(() => {
    if (activeTab !== "ordered" && selectedOrderedLineKeys.size > 0) {
      setSelectedOrderedLineKeys(new Set());
    }
  }, [activeTab, selectedOrderedLineKeys.size]);

  useEffect(() => {
    if (activeTab !== "in_stock" && selectedInStockRowKeys.size > 0) {
      setSelectedInStockRowKeys(new Set());
    }
  }, [activeTab, selectedInStockRowKeys.size]);

  useEffect(() => {
    setSelectedRequestedIds((prev) => {
      if (prev.size === 0) return prev;
      const visibleIds = new Set(requestedItems.map((item) => item.id));
      const next = new Set(Array.from(prev).filter((id) => visibleIds.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [requestedItems]);

  const activeAndReceivedSupplierOrders = useMemo(() => (
    orders
      .filter((order) => (
        order.kind === "supplier"
        && isAppliedOrderStatus(order.status)
      ))
      .filter((order) => {
        if (!search.trim()) return true;
        const q = search.trim().toLowerCase();
        const supplierMatch = (order.supplierName ?? "").toLowerCase().includes(q);
        const lineMatch = order.lines.some((line) => {
          const item = itemById.get(line.procurementItemId);
          return (
            (item?.name?.toLowerCase()?.includes(q) ?? false)
            || (item?.spec?.toLowerCase()?.includes(q) ?? false)
          );
        });
        return supplierMatch || lineMatch;
      })
  ), [orders, search, itemById]);

  const { projects: workspaceProjects } = useWorkspaceProjectsState();
  const { receive: receiveCrossProjectTransfer, receivingId: receivingTransferId } =
    useReceiveCrossProjectTransfer();
  const { locationsByProjectId: allLocationsByProjectId } = useAllProjectsLocations();
  const projectTitleById = useMemo(
    () => new Map(workspaceProjects.map((p) => [p.id, p.title])),
    [workspaceProjects],
  );
  // The counterparty location lives in the OTHER project, so resolve its name across all projects.
  const transferLocationName = useCallback(
    (projId: string | null | undefined, locId: string | null | undefined): string | undefined => {
      if (!projId || !locId) return undefined;
      return allLocationsByProjectId.get(projId)?.find((loc) => loc.id === locId)?.name;
    },
    [allLocationsByProjectId],
  );
  // Cross-project transfers are pending orders (placed → received). They sit among the supplier
  // orders in the Ordered tab (distinguished by a small badge) so the destination can mark an
  // incoming transfer received. Both sides ('in'/'out') surface here.
  const crossProjectTransferOrders = useMemo(
    () =>
      orders.filter((order) => {
        if (order.kind !== "stock" || order.transferDirection == null) return false;
        if (!search.trim()) return true;
        const q = search.trim().toLowerCase();
        const counterparty = order.counterpartyProjectId
          ? (projectTitleById.get(order.counterpartyProjectId) ?? "").toLowerCase()
          : "";
        const lineMatch = order.lines.some((line) => {
          const item = itemById.get(line.procurementItemId);
          return (
            (item?.name?.toLowerCase()?.includes(q) ?? false)
            || (line.title?.toLowerCase()?.includes(q) ?? false)
          );
        });
        return counterparty.includes(q) || lineMatch;
      }),
    [orders, search, projectTitleById, itemById],
  );

  // Supplier orders + cross-project transfers, interleaved newest-first for the Ordered tab list.
  const orderedTabOrders = useMemo(
    () =>
      [...activeAndReceivedSupplierOrders, ...crossProjectTransferOrders].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      ),
    [activeAndReceivedSupplierOrders, crossProjectTransferOrders],
  );

  const supplierOrderNumberById = useMemo(() => {
    const sortedSupplierOrders = orders
      .filter((order) => order.kind === "supplier")
      .slice()
      .sort((a, b) => {
        const dateDelta = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        if (dateDelta !== 0) return dateDelta;
        return a.id.localeCompare(b.id);
      });
    const map = new Map<string, number>();
    sortedSupplierOrders.forEach((order, index) => {
      map.set(order.id, index + 1);
    });
    return map;
  }, [orders]);

  const orderedReceivableTargets = useMemo(() => {
    const targets: OrderedReceivableTarget[] = [];

    activeAndReceivedSupplierOrders.forEach((order) => {
      const orderLocationId = order.deliverToLocationId ?? defaultLocationId;

      order.lines.forEach((line) => {
        const item = itemById.get(line.procurementItemId);
        if (!item) return;
        const remainingQty = Math.max(0, line.qty - line.receivedQty);
        if (remainingQty <= 0) return;

        const unitPrice = line.actualUnitPrice
          ?? item.actualUnitPrice
          ?? line.plannedUnitPrice
          ?? item.plannedUnitPrice
          ?? 0;

        targets.push({
          selectionKey: `${order.id}:${line.id}`,
          orderId: order.id,
          lineId: line.id,
          procurementItemId: item.id,
          itemType: item.type,
          itemName: item.name,
          itemSpec: item.spec,
          orderedQty: line.qty,
          alreadyReceivedQty: line.receivedQty,
          remainingQty,
          unit: line.unit,
          unitPrice,
          locationId: orderLocationId,
        });
      });
    });

    return targets;
  }, [activeAndReceivedSupplierOrders, itemById, defaultLocationId]);

  const orderedReceivableTargetByKey = useMemo(() => (
    new Map(orderedReceivableTargets.map((target) => [target.selectionKey, target]))
  ), [orderedReceivableTargets]);

  useEffect(() => {
    setSelectedOrderedLineKeys((prev) => {
      if (prev.size === 0) return prev;
      const visibleKeys = new Set(orderedReceivableTargets.map((target) => target.selectionKey));
      const next = new Set(Array.from(prev).filter((selectionKey) => visibleKeys.has(selectionKey)));
      return next.size === prev.size ? prev : next;
    });
  }, [orderedReceivableTargets]);

  const inStockRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = computeInStockByLocation(pid, items, orders, locations)
      .flatMap((group) => (
        group.items.map((entry) => {
          const item = itemById.get(entry.procurementItemId);
          if (!item) return null;
          const receiptHistory = collectItemLocationEventHistory(entry.procurementItemId, group.locationId, orders);
          const latestReceipt = receiptHistory.receiptEvents[0] ?? null;
          const receiverName = latestReceipt?.event.receiverName
            ?? (latestReceipt?.event.receiverParticipantId
              ? participantNameById.get(latestReceipt.event.receiverParticipantId) ?? null
              : null);
          return {
            key: `${group.locationId}-${entry.procurementItemId}`,
            procurementItemId: entry.procurementItemId,
            item,
            locationId: group.locationId,
            locationName: group.locationName,
            qty: entry.qty,
            orderIds: entry.orderIds,
            lastReceivedAt: computeLastReceivedAt(entry.procurementItemId, group.locationId, orders),
            receiverName,
          } satisfies InStockTableRow;
        }).filter((row): row is InStockTableRow => !!row)
      ))
      .sort((a, b) => {
        const nameDelta = a.item.name.localeCompare(b.item.name);
        if (nameDelta !== 0) return nameDelta;
        return a.locationName.localeCompare(b.locationName);
      });

    if (!q) return rows;
    return rows.filter((row) => (
      row.item.name.toLowerCase().includes(q)
      || (row.item.spec?.toLowerCase().includes(q) ?? false)
      || row.locationName.toLowerCase().includes(q)
    ));
  }, [pid, items, orders, locations, search, itemById, participantNameById]);

  const summaryFallbackInStockRows = useMemo(() => {
    if (canManageProcurement) {
      return [] as InStockTableRow[];
    }

    const q = search.trim().toLowerCase();
    const locationById = new Map(locations.map((location) => [location.id, location]));
    const itemByInventoryKey = new Map(
      items.map((item) => [toInventoryKey(item), item] as const),
    );

    const rows = stockRows
      .filter((row) => row.qty > 0)
      .map((row) => {
        const decoded = decodeInventoryKeyParts(row.inventoryKey, t);
        const location = locationById.get(row.locationId);
        const name = row.title ?? decoded.title;
        const spec = row.spec ?? decoded.spec;
        const unit = row.unit ?? decoded.unit;
        const syntheticId = row.inventoryItemId ?? row.inventoryKey;

        const matchedItem = itemByInventoryKey.get(row.inventoryKey);
        if (matchedItem) {
          return {
            key: `${row.locationId}-${matchedItem.id}`,
            procurementItemId: matchedItem.id,
            item: matchedItem,
            locationId: row.locationId,
            locationName: location?.name ?? t("procurement.location.unknown"),
            qty: row.qty,
            orderIds: [],
            lastReceivedAt: null,
            receiverName: null,
          } satisfies InStockTableRow;
        }

        return {
          key: `${row.locationId}-${syntheticId}`,
          procurementItemId: syntheticId,
          item: {
            id: syntheticId,
            projectId: pid,
            stageId: null,
            categoryId: null,
            type: "material",
            name,
            spec,
            unit,
            requiredByDate: null,
            requiredQty: row.qty,
            orderedQty: 0,
            receivedQty: row.qty,
            plannedUnitPrice: null,
            actualUnitPrice: null,
            supplier: null,
            supplierPreferred: null,
            locationPreferredId: row.locationId,
            lockedFromEstimate: false,
            sourceEstimateItemId: null,
            sourceEstimateV2LineId: null,
            orphaned: false,
            orphanedAt: null,
            orphanedReason: null,
            linkUrl: null,
            notes: null,
            attachments: [],
            createdFrom: "manual",
            linkedTaskIds: [],
            archived: false,
            createdAt: estimateState.project.updatedAt,
            updatedAt: estimateState.project.updatedAt,
          } satisfies ProcurementItemV2,
          locationId: row.locationId,
          locationName: location?.name ?? t("procurement.location.unknown"),
          qty: row.qty,
          orderIds: [],
          lastReceivedAt: null,
          receiverName: null,
        } satisfies InStockTableRow;
      })
      .sort((left, right) => {
        const nameDelta = left.item.name.localeCompare(right.item.name);
        if (nameDelta !== 0) return nameDelta;
        return left.locationName.localeCompare(right.locationName);
      });

    if (!q) return rows;
    return rows.filter((row) => (
      row.item.name.toLowerCase().includes(q)
      || (row.item.spec?.toLowerCase().includes(q) ?? false)
      || row.locationName.toLowerCase().includes(q)
    ));
  }, [canManageProcurement, estimateState.project.updatedAt, items, locations, pid, search, stockRows, t]);

  const visibleInStockRows = inStockRows.length > 0 ? inStockRows : summaryFallbackInStockRows;

  const inStockRowByKey = useMemo(
    () => new Map(visibleInStockRows.map((row) => [row.key, row])),
    [visibleInStockRows],
  );

  useEffect(() => {
    setSelectedInStockRowKeys((prev) => {
      if (prev.size === 0) return prev;
      const visibleKeys = new Set(visibleInStockRows.map((row) => row.key));
      const next = new Set(Array.from(prev).filter((key) => visibleKeys.has(key)));
      return next.size === prev.size ? prev : next;
    });
  }, [visibleInStockRows]);

  useEffect(() => {
    if (canManageProcurement) return;
    if (activeTab !== "ordered") return;
    if (orderedTabOrders.length > 0) return;
    if (visibleInStockRows.length === 0) return;
    setActiveTab("in_stock");
  }, [activeTab, canManageProcurement, orderedTabOrders.length, visibleInStockRows.length]);

  const effectiveActiveTab: ProcurementTab = !canManageProcurement
    && activeTab === "ordered"
    && orderedTabOrders.length === 0
    && visibleInStockRows.length > 0
    ? "in_stock"
    : activeTab;

  const inStockDetailHistory = useMemo(() => {
    if (!inStockDetailTarget) {
      return { receiptEvents: [], usageEvents: [] };
    }
    return collectItemLocationEventHistory(
      inStockDetailTarget.procurementItemId,
      inStockDetailTarget.locationId,
      orders,
    );
  }, [inStockDetailTarget, orders]);

  const relatedOrdersByItemId = useMemo(() => {
    const map = new Map<string, OrderWithLines[]>();
    items.forEach((item) => map.set(item.id, []));
    orders.forEach((order) => {
      order.lines.forEach((line) => {
        const list = map.get(line.procurementItemId) ?? [];
        list.push(order);
        map.set(line.procurementItemId, list);
      });
    });
    return map;
  }, [items, orders]);

  const toggleStage = (stageId: string) => {
    setCollapsedStages((prev) => {
      const next = new Set(prev);
      if (next.has(stageId)) next.delete(stageId);
      else next.add(stageId);
      return next;
    });
  };

  const toggleOrder = (id: string) => {
    setCollapsedOrderIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleReceivedOrderDetails = (id: string) => {
    setExpandedReceivedOrderIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const openDetail = (item: ProcurementItemV2) => {
    if (!canManageProcurement) return;
    persistListState({ scrollY: window.scrollY });
    navigate(`/project/${pid}/procurement/${item.id}`);
  };

  const openInStockDetail = (row: InStockTableRow) => {
    setInStockDetailTarget(row);
    setInStockDetailOpen(true);
  };

  const openOrderDetail = (id: string) => {
    if (!canManageProcurement) return;
    persistListState({ scrollY: window.scrollY });
    navigate(`/project/${pid}/procurement/order/${id}`);
  };

  const closeOrderDetail = () => {
    persistListState({ scrollY: window.scrollY });
    navigate(`/project/${pid}/procurement`);
  };

  const clearAutosaveTimer = useCallback(() => {
    if (!autosaveTimerRef.current) return;
    clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = null;
  }, []);

  const revokeObjectUrlOnce = useCallback((url: string) => {
    if (revokedObjectUrlsRef.current.has(url)) return;
    try {
      URL.revokeObjectURL(url);
    } catch {
      // no-op
    }
    revokedObjectUrlsRef.current.add(url);
    pendingRevokesRef.current.delete(url);
  }, []);

  const flushPendingRevokes = useCallback(() => {
    pendingRevokesRef.current.forEach((url) => revokeObjectUrlOnce(url));
  }, [revokeObjectUrlOnce]);

  const computeDraftSignature = useCallback((draft: Partial<ProcurementItemV2>): string => {
    const sortedAttachments = [...(draft.attachments ?? [])]
      .map((attachment) => ({
        id: attachment.id,
        url: attachment.url,
        type: attachment.type,
        name: attachment.name ?? "",
        isLocal: !!attachment.isLocal,
        createdAt: attachment.createdAt,
      }))
      .sort((a, b) => a.id.localeCompare(b.id));

    return JSON.stringify({
      type: draft.type ?? "material",
      name: draft.name ?? "",
      spec: draft.spec ?? null,
      unit: draft.unit ?? "",
      requiredByDate: draft.requiredByDate ?? null,
      requiredQty: draft.requiredQty ?? null,
      plannedUnitPrice: draft.plannedUnitPrice ?? null,
      actualUnitPrice: draft.actualUnitPrice ?? null,
      supplierPreferred: draft.supplierPreferred ?? null,
      locationPreferredId: draft.locationPreferredId ?? null,
      notes: draft.notes ?? null,
      attachments: sortedAttachments,
      lockedFromEstimate: !!draft.lockedFromEstimate,
    });
  }, []);

  const persistDraftNowIfChanged = useCallback((draft?: Partial<ProcurementItemV2>) => {
    if (!detailItem) return;
    // Supabase users persist via the explicit Save button (one awaited UPDATE); the
    // in-memory autosave (onBlur/close/unmount/debounce) must never touch the store for them.
    if (supabaseMode) return;
    const nextDraft = draft ?? draftRef.current;
    const nextSignature = computeDraftSignature(nextDraft);
    if (nextSignature === lastPersistedSignatureRef.current) return;

    const payload: Partial<ProcurementItemV2> = { ...nextDraft };
    delete payload.id;
    delete payload.createdAt;
    delete payload.updatedAt;

    updateProcurementItem(detailItem.id, payload);
    lastPersistedSignatureRef.current = nextSignature;
  }, [detailItem, supabaseMode, computeDraftSignature]);

  const scheduleDraftPersist = useCallback((draft: Partial<ProcurementItemV2>) => {
    clearAutosaveTimer();
    autosaveTimerRef.current = setTimeout(() => {
      persistDraftNowIfChanged(draft);
    }, 500);
  }, [clearAutosaveTimer, persistDraftNowIfChanged]);

  const patchEditForm = useCallback((
    updater: (prev: Partial<ProcurementItemV2>) => Partial<ProcurementItemV2>,
    mode: "debounce" | "immediate" = "debounce",
  ) => {
    setEditForm((prev) => {
      const next = updater(prev);
      draftRef.current = next;
      if (mode === "immediate") {
        clearAutosaveTimer();
        persistDraftNowIfChanged(next);
      } else {
        scheduleDraftPersist(next);
      }
      return next;
    });
  }, [clearAutosaveTimer, persistDraftNowIfChanged, scheduleDraftPersist]);

  const closeDetail = useCallback(() => {
    clearAutosaveTimer();
    persistDraftNowIfChanged(draftRef.current);
    flushPendingRevokes();
    persistListState({ scrollY: window.scrollY });
    navigate(`/project/${pid}/procurement`);
  }, [
    clearAutosaveTimer,
    flushPendingRevokes,
    navigate,
    persistDraftNowIfChanged,
    persistListState,
    pid,
  ]);

  useEffect(() => {
    if (!detailItem) {
      initializedDetailIdRef.current = null;
      return;
    }
    if (initializedDetailIdRef.current === detailItem.id) return;

    initializedDetailIdRef.current = detailItem.id;
    setEditForm({ ...detailItem });
    draftRef.current = { ...detailItem };
    lastPersistedSignatureRef.current = computeDraftSignature(detailItem);
    setAttachmentUrl("");
    clearAutosaveTimer();
  }, [detailItem, computeDraftSignature, clearAutosaveTimer]);

  useEffect(() => () => {
    clearAutosaveTimer();
    persistDraftNowIfChanged(draftRef.current);
    flushPendingRevokes();
  }, [clearAutosaveTimer, persistDraftNowIfChanged, flushPendingRevokes]);

  const openCreateOrder = (itemIds: string[]) => {
    if (!canLaunchOrderFlows) return;
    if (itemIds.length === 0) return;
    if (shouldBlockProcurementLaunchActions) {
      toast({
        title: hasProcurementSyncError ? t("procurement.sync.toast.needsAttention") : t("procurement.sync.toast.stillSyncing"),
        description: hasProcurementSyncError
          ? (procurementSyncState.lastError ?? t("procurement.sync.toast.resolveOrders"))
          : t("procurement.sync.toast.waitOrders"),
        variant: "destructive",
      });
      return;
    }
    setCreateOrderItemIds(itemIds);
    setCreateOrderOpen(true);
  };

  const toggleSelected = (itemId: string, checked: boolean) => {
    setSelectedRequestedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(itemId);
      else next.delete(itemId);
      return next;
    });
  };

  const toggleSelectedOrderedLine = (selectionKey: string, checked: boolean) => {
    setSelectedOrderedLineKeys((prev) => {
      const next = new Set(prev);
      if (checked) next.add(selectionKey);
      else next.delete(selectionKey);
      return next;
    });
  };

  const toggleSelectedInStockRow = (rowKey: string, checked: boolean) => {
    setSelectedInStockRowKeys((prev) => {
      const next = new Set(prev);
      if (checked) next.add(rowKey);
      else next.delete(rowKey);
      return next;
    });
  };

  const openReceiveItemsModal = useCallback((targets: OrderedReceivableTarget[]) => {
    if (targets.length === 0) return;
    if (shouldBlockProcurementLaunchActions) {
      toast({
        title: hasProcurementSyncError ? t("procurement.sync.toast.needsAttention") : t("procurement.sync.toast.stillSyncing"),
        description: hasProcurementSyncError
          ? (procurementSyncState.lastError ?? t("procurement.sync.toast.resolveReceive"))
          : t("procurement.sync.toast.waitReceive"),
        variant: "destructive",
      });
      return;
    }
    const nextQtyByKey: Record<string, number> = {};
    const nextLocationByKey: Record<string, string> = {};
    targets.forEach((target) => {
      nextQtyByKey[target.selectionKey] = target.remainingQty;
      const locationId = target.locationId ?? defaultLocationId ?? "";
      nextLocationByKey[target.selectionKey] = locationId;
    });
    setReceiveModalTargets(targets);
    setReceiveModalQtyByKey(nextQtyByKey);
    setReceiveModalLocationByKey(nextLocationByKey);
    setReceiveModalOpen(true);
  }, [defaultLocationId, shouldBlockProcurementLaunchActions, hasProcurementSyncError, procurementSyncState.lastError, toast, t]);

  const openReceiveModalForSelection = () => {
    const targets = Array.from(selectedOrderedLineKeys)
      .map((selectionKey) => orderedReceivableTargetByKey.get(selectionKey))
      .filter((target): target is OrderedReceivableTarget => !!target);
    openReceiveItemsModal(targets);
  };

  const submitReceiveItems = async () => {
    if (receiveItemsConfirmInFlightRef.current) return;
    receiveItemsConfirmInFlightRef.current = true;
    setReceiveItemsConfirmInFlight(true);
    try {
      const payloadByOrderAndLocation = new Map<string, { orderId: string; locationId: string; lines: Array<{ lineId: string; qty: number }> }>();
      let hasMissingLocation = false;

      receiveModalTargets.forEach((target) => {
        const rawQty = Number(receiveModalQtyByKey[target.selectionKey] ?? 0);
        const clampedQty = Math.min(target.remainingQty, Math.max(0, Number.isFinite(rawQty) ? rawQty : 0));
        if (clampedQty <= 0) return;
        const locationId = receiveModalLocationByKey[target.selectionKey] ?? target.locationId ?? defaultLocationId ?? "";
        if (!locationId) {
          hasMissingLocation = true;
          return;
        }

        const payloadKey = `${target.orderId}:${locationId}`;
        const existing = payloadByOrderAndLocation.get(payloadKey);
        if (!existing) {
          payloadByOrderAndLocation.set(payloadKey, {
            orderId: target.orderId,
            locationId,
            lines: [{ lineId: target.lineId, qty: clampedQty }],
          });
          return;
        }

        existing.lines.push({ lineId: target.lineId, qty: clampedQty });
      });

      if (hasMissingLocation) {
        toast({ title: t("procurement.toast.locationRequired"), description: t("procurement.toast.locationRequiredDesc"), variant: "destructive" });
        return;
      }

      if (payloadByOrderAndLocation.size === 0) {
        toast({ title: t("procurement.toast.noQtyEntered"), description: t("procurement.toast.noQtyEnteredDesc"), variant: "destructive" });
        return;
      }

      try {
        const source = await getOrdersSource(supabaseMode ?? undefined);
        let totalQty = 0;
        for (const payload of payloadByOrderAndLocation.values()) {
          await source.receiveSupplierOrder(payload.orderId, {
            locationId: payload.locationId,
            lines: payload.lines,
          });
          totalQty += payload.lines.reduce((sum, line) => sum + line.qty, 0);
        }

        trackEvent("procurement_item_updated", {
          project_id: pid,
          surface: "procurement",
          total_qty: totalQty,
        });

        if (supabaseMode) {
          const orderDetailInvalidations = Array.from(payloadByOrderAndLocation.values()).map((payload) => (
            queryClient.invalidateQueries({
              queryKey: orderQueryKeys.orderById(supabaseMode.profileId, payload.orderId),
            })
          ));
          await Promise.all([
            queryClient.invalidateQueries({
              queryKey: orderProjectOrdersQueryRoot(supabaseMode.profileId, pid),
            }),
            queryClient.invalidateQueries({
              queryKey: orderPlacedSupplierOrdersQueryRoot(supabaseMode.profileId, pid),
            }),
            queryClient.invalidateQueries({
              queryKey: orderQueryKeys.placedSupplierOrdersAllProjects(supabaseMode.profileId),
            }),
            queryClient.invalidateQueries({
              queryKey: procurementProjectItemsQueryRoot(supabaseMode.profileId, pid),
            }),
            queryClient.invalidateQueries({
              queryKey: inventoryQueryKeys.projectLocations(supabaseMode.profileId, pid),
            }),
            queryClient.invalidateQueries({
              queryKey: inventoryQueryKeys.projectStock(supabaseMode.profileId, pid),
            }),
            ...orderDetailInvalidations,
          ]);
        }

        toast({ title: payloadByOrderAndLocation.size > 1 ? t("procurement.toast.itemsReceived") : t("procurement.toast.itemReceived") });
        setReceiveModalOpen(false);
        setReceiveModalTargets([]);
        setReceiveModalQtyByKey({});
        setReceiveModalLocationByKey({});
        setSelectedOrderedLineKeys(new Set());
      } catch (error) {
        toast({
          title: t("procurement.toast.receiveFailed"),
          description: error instanceof Error ? error.message : t("procurement.toast.receiveFallback"),
          variant: "destructive",
        });
      }
    } finally {
      receiveItemsConfirmInFlightRef.current = false;
      setReceiveItemsConfirmInFlight(false);
    }
  };

  const openUseFromStockModal = (targets: InStockTableRow[]) => {
    if (isSupabaseMode) {
      toast({
        title: t("procurement.toast.useFromStockDisabled"),
        description: t("procurement.toast.useFromStockDisabledDesc"),
        variant: "destructive",
      });
      return;
    }
    if (targets.length === 0) return;
    const qtyByKey = targets.reduce<Record<string, string>>((acc, target) => {
      acc[target.key] = "";
      return acc;
    }, {});
    setUseFromStockTargets(targets);
    setUseFromStockQtyByKey(qtyByKey);
    setUseFromStockParticipantId("none");
    setUseFromStockManualName("");
    setUseFromStockNote("");
    setUseFromStockOpen(true);
  };

  const openUseModalForSelection = () => {
    const targets = Array.from(selectedInStockRowKeys)
      .map((key) => inStockRowByKey.get(key))
      .filter((target): target is InStockTableRow => !!target);
    openUseFromStockModal(targets);
  };

  const submitUseFromStock = () => {
    if (isSupabaseMode) {
      toast({
        title: t("procurement.toast.useFromStockDisabled"),
        description: t("procurement.toast.useFromStockDisabledDesc"),
        variant: "destructive",
      });
      return;
    }
    if (useFromStockTargets.length === 0) return;

    const manualName = useFromStockManualName.trim() || null;
    const participantId = manualName ? null : (useFromStockParticipantId === "none" ? null : useFromStockParticipantId);
    const note = useFromStockNote.trim() || null;
    const rowsToConsume: Array<{ target: InStockTableRow; qty: number }> = [];

    for (const target of useFromStockTargets) {
      const raw = (useFromStockQtyByKey[target.key] ?? "").trim();
      if (!raw) continue;
      const qty = Number(raw);
      if (!Number.isFinite(qty) || qty <= 0) {
        toast({
          title: t("procurement.toast.qtyRequired"),
          description: t("procurement.toast.qtyRequiredDesc", { name: target.item.name }),
          variant: "destructive",
        });
        return;
      }
      if (qty > target.qty) {
        toast({
          title: t("procurement.toast.insufficientStock"),
          description: t("procurement.toast.insufficientStockDesc", { name: target.item.name }),
          variant: "destructive",
        });
        return;
      }
      rowsToConsume.push({ target, qty });
    }

    if (rowsToConsume.length === 0) {
      toast({ title: t("procurement.toast.noQtyEntered"), description: t("procurement.toast.noQtyEnteredDesc"), variant: "destructive" });
      return;
    }

    const usedByLabel = manualName || (participantId ? participantNameById.get(participantId) : "") || dash;
    const currentUser = getCurrentUser();
    for (const entry of rowsToConsume) {
      const { target, qty } = entry;
      const result = consumeStockFromInventory({
        projectId: pid,
        procurementItemId: target.procurementItemId,
        locationId: target.locationId,
        qty,
        usedByParticipantId: participantId,
        usedByName: manualName,
        note,
      });
      if (!result.ok) {
        toast({ title: t("procurement.toast.useFailed"), description: result.error, variant: "destructive" });
        return;
      }

      const summary = t("procurement.stockUsed.summary", { qty, unit: target.item.unit, name: target.item.name, location: target.locationName });
      addEvent({
        id: `evt-stock-used-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        project_id: pid,
        actor_id: currentUser.id,
        type: "procurement_updated",
        object_type: "procurement_item",
        object_id: target.procurementItemId,
        timestamp: new Date().toISOString(),
        payload: {
          source: "ai",
          sidebarKind: "stock_used",
          sidebarTier: 1,
          title: t("procurement.stockUsed.title"),
          summary,
          details: {
            usedBy: usedByLabel,
            note,
            remainingQty: result.remainingQty,
          },
        },
      } satisfies Event);
    }

    trackEvent("procurement_item_used_from_stock", {
      project_id: pid,
      surface: "procurement",
      items_used: rowsToConsume.map(({ target, qty }) => ({
        procurement_item_id: target.procurementItemId,
        qty,
        location_id: target.locationId,
        participant_id: participantId,
      })),
    });

    toast({
      title: rowsToConsume.length > 1 ? t("procurement.toast.stockUpdated") : t("procurement.toast.stockItemUpdated"),
      description: rowsToConsume.length > 1
        ? t("procurement.toast.stockUsedForCount", { count: rowsToConsume.length })
        : t("procurement.toast.stockUsedSingle", { qty: rowsToConsume[0]?.qty ?? 0, unit: rowsToConsume[0]?.target.item.unit ?? "" }),
    });
    setUseFromStockOpen(false);
    setUseFromStockTargets([]);
    setUseFromStockQtyByKey({});
    setUseFromStockParticipantId("none");
    setUseFromStockManualName("");
    setUseFromStockNote("");
    setSelectedInStockRowKeys(new Set());
  };

  const handleRequestMore = (row: InStockTableRow) => {
    // Manual task authoring has no Supabase write path yet (tasks are projected from the estimate),
    // so this action is disabled + marked "coming soon" in supabase mode. Guard here too in case the
    // handler is reached, to avoid the misleading "task created" toast over a write that never persists.
    if (isSupabaseMode) return;
    const now = new Date().toISOString();
    const task: Task = {
      id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      project_id: pid,
      stage_id: project?.current_stage_id || stages[0]?.id || "",
      title: t("procurement.requestMore.title", { name: row.item.name }),
      description: [
        t("procurement.requestMore.lineItem", { name: row.item.name }),
        t("procurement.requestMore.lineSpec", { spec: row.item.spec ?? dash }),
        t("procurement.requestMore.lineType", { type: row.item.type }),
        t("procurement.requestMore.lineLocation", { location: row.locationName }),
        t("procurement.requestMore.lineQty", { qty: row.qty, unit: row.item.unit }),
        t("procurement.requestMore.lineSuggested"),
        t("procurement.requestMore.lineReference", { reference: `/project/${pid}/procurement/${row.procurementItemId}` }),
      ].join("\n"),
      status: "not_started",
      assignee_id: ownerAssigneeId,
      checklist: [],
      comments: [],
      attachments: [],
      photos: [],
      linked_estimate_item_ids: [],
      created_at: now,
    };
    addTask(task);
    toast({ title: t("procurement.toast.taskCreated"), description: task.title });
  };

  const addUrlAttachment = () => {
    const url = attachmentUrl.trim();
    if (!url) return;

    const nextAttachment: ProcurementAttachment = {
      id: newAttachmentId("att-link"),
      url,
      type: "link",
      name: url,
      isLocal: false,
      createdAt: new Date().toISOString(),
    };

    patchEditForm((prev) => ({
      ...prev,
      attachments: [...(prev.attachments ?? []), nextAttachment],
    }), "immediate");
    setAttachmentUrl("");
  };

  const addLocalAttachments = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const now = new Date().toISOString();

    const nextAttachments: ProcurementAttachment[] = Array.from(files).map((file) => ({
      id: newAttachmentId("att-local"),
      url: URL.createObjectURL(file),
      type: file.type || "file",
      name: file.name,
      isLocal: true,
      createdAt: now,
    }));

    patchEditForm((prev) => ({
      ...prev,
      attachments: [...(prev.attachments ?? []), ...nextAttachments],
    }), "immediate");
  };

  const removeAttachment = (attachmentId: string) => {
    patchEditForm((prev) => {
      const current = prev.attachments ?? [];
      const target = current.find((attachment) => attachment.id === attachmentId);
      if (target?.isLocal && target.url.startsWith("blob:")) {
        pendingRevokesRef.current.add(target.url);
        revokeObjectUrlOnce(target.url);
      }

      return {
        ...prev,
        attachments: current.filter((attachment) => attachment.id !== attachmentId),
      };
    }, "immediate");
  };

  const selectionCount = effectiveActiveTab === "requested"
    ? selectedRequestedIds.size
    : effectiveActiveTab === "ordered"
      ? selectedOrderedLineKeys.size
      : selectedInStockRowKeys.size;
  const showStickySelectionBar = showProcurementActions && selectionCount > 0;

  const selectionPrimaryLabel = effectiveActiveTab === "requested"
    ? t("procurement.selection.createOrder", { count: selectionCount })
    : effectiveActiveTab === "ordered"
      ? t("procurement.selection.itemsReceived", { count: selectionCount })
      : t("procurement.selection.use", { count: selectionCount });

  const runSelectionPrimaryAction = () => {
    if (shouldBlockProcurementLaunchActions) {
      toast({
        title: hasProcurementSyncError ? t("procurement.sync.toast.needsAttention") : t("procurement.sync.toast.stillSyncing"),
        description: hasProcurementSyncError
          ? (procurementSyncState.lastError ?? t("procurement.sync.toast.resolveLaunch"))
          : t("procurement.sync.toast.waitLaunch"),
        variant: "destructive",
      });
      return;
    }
    if (effectiveActiveTab === "requested") {
      openCreateOrder(Array.from(selectedRequestedIds));
      return;
    }
    if (effectiveActiveTab === "ordered") {
      openReceiveModalForSelection();
      return;
    }
    if (isSupabaseMode) {
      toast({
        title: t("procurement.toast.useFromStockDisabled"),
        description: t("procurement.toast.useFromStockDisabledLaunch"),
        variant: "destructive",
      });
      return;
    }
    openUseModalForSelection();
  };

  const clearSelectionForActiveTab = () => {
    if (effectiveActiveTab === "requested") {
      setSelectedRequestedIds(new Set());
      return;
    }
    if (effectiveActiveTab === "ordered") {
      setSelectedOrderedLineKeys(new Set());
      return;
    }
    setSelectedInStockRowKeys(new Set());
  };

  if (estimateState.project.estimateStatus === "planning") {
    // While the estimate hydrates, the status defaults to "planning" — showing
    // the "start planning" gate for an actually-launched project is a lie.
    if (isSupabaseMode && estimateState.isLoading) {
      return (
        <div className="space-y-3 p-sp-2" data-testid="procurement-loading-skeleton">
          <Skeleton className="h-16 rounded-card" />
          <Skeleton className="h-40 rounded-card" />
        </div>
      );
    }
    return (
      <ProjectWorkflowEmptyState
        variant="procurement"
        title={t("procurement.empty.planning.title")}
        description={t("procurement.empty.planning.description")}
        actionLabel={t("procurement.empty.planning.action")}
        onAction={() => navigate(`/project/${pid}/estimate`)}
      />
    );
  }

  if (
    items.length === 0
    && visibleInStockRows.length === 0
    && !hasPlacedSupplierOrderLines
    && !isProcurementItemsLoading
    && !isProcurementSyncing
  ) {
    return (
      <EmptyState
        icon={ShoppingCart}
        title={t("procurement.empty.noItems.title")}
        description={t("procurement.empty.noItems.description")}
      />
    );
  }

  const renderRequestedTableHeader = () => (
    <thead className="bg-muted/30 border-b border-border">
      <tr>
        {showProcurementActions && <th className="w-10 text-left px-2 py-2 text-xs font-medium text-muted-foreground" />}
        <th className="text-left px-2 py-2 text-xs font-medium text-muted-foreground">{t("procurement.col.nameSpec")}</th>
        <th className="text-left px-2 py-2 text-xs font-medium text-muted-foreground">{t("procurement.col.whenNeeded")}</th>
        <th className="text-right px-2 py-2 text-xs font-medium text-muted-foreground">{t("procurement.col.amount")}</th>
        <th className="text-left px-2 py-2 text-xs font-medium text-muted-foreground">{t("procurement.col.unit")}</th>
        {canViewSensitiveDetail && <th className="text-right px-2 py-2 text-xs font-medium text-muted-foreground">{t("procurement.col.planned")}</th>}
        {showProcurementActions && <th className="text-right px-2 py-2 text-xs font-medium text-muted-foreground">{t("procurement.col.action")}</th>}
      </tr>
    </thead>
  );

  const renderOrderedTableHeader = () => (
    <thead className="bg-muted/30 border-b border-border">
      <tr>
        {showProcurementActions && <th className="w-10 text-left px-2 py-2 text-xs font-medium text-muted-foreground" />}
        <th className="text-left px-2 py-2 text-xs font-medium text-muted-foreground">{t("procurement.col.nameSpec")}</th>
        <th className="text-left px-2 py-2 text-xs font-medium text-muted-foreground">{t("procurement.col.whenNeeded")}</th>
        <th className="text-left px-2 py-2 text-xs font-medium text-muted-foreground">{t("procurement.col.deliveryScheduled")}</th>
        <th className="text-right px-2 py-2 text-xs font-medium text-muted-foreground">{t("procurement.col.amount")}</th>
        <th className="text-left px-2 py-2 text-xs font-medium text-muted-foreground">{t("procurement.col.unit")}</th>
        {canViewSensitiveDetail && <th className="text-right px-2 py-2 text-xs font-medium text-muted-foreground">{t("procurement.col.unitPrice")}</th>}
        {canViewSensitiveDetail && <th className="text-right px-2 py-2 text-xs font-medium text-muted-foreground">{t("procurement.col.total")}</th>}
        {showProcurementActions && <th className="text-right px-2 py-2 text-xs font-medium text-muted-foreground">{t("procurement.col.action")}</th>}
      </tr>
    </thead>
  );

  const renderInStockTableHeader = () => (
    <thead className="bg-muted/30 border-b border-border">
      <tr>
        {showProcurementActions && <th className="w-10 text-left px-2 py-2 text-xs font-medium text-muted-foreground" />}
        <th className="text-left px-2 py-2 text-xs font-medium text-muted-foreground">{t("procurement.col.nameSpec")}</th>
        <th className="text-left px-2 py-2 text-xs font-medium text-muted-foreground">{t("procurement.col.location")}</th>
        <th className="text-right px-2 py-2 text-xs font-medium text-muted-foreground">{t("procurement.col.qtyAvailable")}</th>
        {!canManageProcurement && <th className="text-left px-2 py-2 text-xs font-medium text-muted-foreground">{t("procurement.col.receiver")}</th>}
        <th className="text-left px-2 py-2 text-xs font-medium text-muted-foreground">{t("procurement.col.dateLastReceived")}</th>
        {showProcurementActions && <th className="text-right px-2 py-2 text-xs font-medium text-muted-foreground">{t("procurement.col.actions")}</th>}
      </tr>
    </thead>
  );

  return (
    <div className={cn("space-y-sp-2", showStickySelectionBar && "pb-24")}>
      {hasProcurementSyncError && (
        <div className="rounded-card border border-destructive/30 bg-destructive/10 text-destructive px-3 py-2 text-sm flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="min-w-0">
            <p className="font-medium">{t("procurement.sync.errorTitle")}</p>
            <p className="text-xs opacity-80">
              {procurementSyncState.lastError ?? t("procurement.sync.errorFallback")}
            </p>
          </div>
        </div>
      )}

      <div className="glass-elevated rounded-card p-sp-3 space-y-sp-3">
        <div className="flex items-center gap-2">
          <h2 className="text-h3 text-foreground">{t("procurement.title")}</h2>
          <span
            className={cn(
              "text-xs text-muted-foreground transition-opacity",
              isProcurementProjectionBehind && !isProcurementSyncing && !hasProcurementSyncError ? "opacity-100" : "opacity-0",
            )}
            aria-hidden={!isProcurementProjectionBehind || isProcurementSyncing || hasProcurementSyncError}
          >
            {t("procurement.sync.refreshing")}
          </span>
        </div>

        {canManageProcurement && (
          <ProcurementFinanceHeader
            view={procurementFinanceView}
            currency={estimateState.project.currency}
          />
        )}
      </div>

      <div className="glass rounded-card p-2">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-wrap gap-2 md:shrink-0">
            {visibleTabs.map((tab) => {
              const stat = tab === "requested"
                ? chipTotals.requested
                : tab === "ordered"
                  ? chipTotals.ordered
                  : chipTotals.inStock;

              return (
                <button
                  type="button"
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={cn(
                    "rounded-lg border px-3 py-2 text-sm font-medium transition-colors",
                    effectiveActiveTab === tab
                      ? TAB_META[tab].className
                      : "border-border bg-background hover:bg-muted/30",
                  )}
                >
                  {t("procurement.tab.label", { label: t(TAB_META[tab].labelKey), count: stat.count })}
                </button>
              );
            })}
          </div>

          <div className="relative w-full min-w-0 md:max-w-md md:flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t("procurement.search.placeholder")}
              className="pl-8 h-9 text-sm"
            />
          </div>
        </div>
      </div>

      {showStickySelectionBar && (
        <div className="fixed inset-x-0 bottom-3 z-40 px-sp-2 pointer-events-none">
          <div className="mx-auto max-w-[1200px] pointer-events-auto glass-elevated rounded-card border border-border px-3 py-2 flex items-center justify-between gap-3">
            <p className="text-sm text-foreground">{t("procurement.selection.count", { count: selectionCount })}</p>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                className="h-8"
                onClick={runSelectionPrimaryAction}
                disabled={
                  (effectiveActiveTab === "requested" ? orderControl.disabled
                    : effectiveActiveTab === "ordered" ? receiveControl.disabled
                      : useFromStockEffectiveDisabled || isSupabaseMode)
                  || shouldBlockProcurementLaunchActions
                }
                title={
                  effectiveActiveTab === "in_stock"
                    ? (isSupabaseMode ? t("common.comingSoon") : useFromStockEffectiveReason)
                    : undefined
                }
              >
                {selectionPrimaryLabel}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-8"
                onClick={clearSelectionForActiveTab}
              >
                {t("procurement.selection.clear")}
              </Button>
            </div>
          </div>
        </div>
      )}

      {effectiveActiveTab === "requested" && (
        <div className="glass rounded-card p-2 space-y-2">
          {requestedItems.length === 0 ? (
            items.length === 0 && (isProcurementItemsLoading || isProcurementSyncing) ? (
              <div className="space-y-2" aria-hidden>
                {[0, 1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-14 w-full" />
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-8">{t("procurement.empty.noRequested")}</p>
            )
          ) : (
            <>
              {Array.from(requestedStageMap.map.entries())
                .sort(([a], [b]) => {
                  const ai = stages.findIndex((stage) => stage.id === a);
                  const bi = stages.findIndex((stage) => stage.id === b);
                  return ai - bi;
                })
                .map(([stageId, stageItems]) => {
                  const collapsed = collapsedStages.has(stageId);
                  const stage = stages.find((entry) => entry.id === stageId);
                  const stageTotal = stageItems.reduce((sum, item) => sum + (item.plannedUnitPrice ?? 0) * (remainingByItemId.get(item.id) ?? 0), 0);

                  return (
                    <div key={stageId} className="rounded-lg border border-border overflow-hidden">
                      <button
                        type="button"
                        className="w-full flex items-center gap-2 px-3 py-2 bg-muted/40 hover:bg-muted/60 transition-colors"
                        onClick={() => toggleStage(stageId)}
                      >
                        {collapsed ? <ChevronRight className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                        <span className="text-sm font-semibold text-foreground">{stage?.title ?? t("procurement.stage.unknown")}</span>
                        <span className="ml-auto text-xs text-muted-foreground">
                          {canViewSensitiveDetail
                            ? t("procurement.stage.countAndTotal", { count: stageItems.length, total: fmtCost(stageTotal) })
                            : t("procurement.stage.itemsCount", { count: stageItems.length })}
                        </span>
                      </button>

                      {!collapsed && (
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            {renderRequestedTableHeader()}
                            <tbody>
                              {stageItems.map((item) => {
                                const remaining = remainingByItemId.get(item.id) ?? 0;
                                const selected = selectedRequestedIds.has(item.id);

                                return (
                                  <tr key={item.id} className="border-b border-border/70 last:border-0 hover:bg-muted/20">
                                    {showProcurementActions && (
                                      <td className="px-2 py-2">
                                        <Checkbox
                                          checked={selected}
                                          onCheckedChange={(checked) => toggleSelected(item.id, !!checked)}
                                          disabled={orderControl.disabled}
                                        />
                                      </td>
                                    )}
                                    <td className="px-2 py-2 min-w-[220px]">
                                      {canManageProcurement ? (
                                        <button type="button" onClick={() => openCreateOrder([item.id])} className="text-left hover:underline">
                                          <div className="flex min-w-0 items-center gap-2">
                                            <ResourceTypeBadge type={item.type} className="shrink-0 border-transparent" />
                                            <p className="font-medium text-foreground truncate">{item.name}</p>
                                          </div>
                                          {item.orphaned && (
                                            <span className="inline-flex rounded-full bg-destructive/15 px-2 py-0.5 text-[10px] text-destructive">
                                              {t("procurement.item.orphaned")}
                                            </span>
                                          )}
                                          {item.spec && <p className="text-xs text-muted-foreground truncate">{item.spec}</p>}
                                        </button>
                                      ) : (
                                        <div className="text-left">
                                          <div className="flex min-w-0 items-center gap-2">
                                            <ResourceTypeBadge type={item.type} className="shrink-0 border-transparent" />
                                            <p className="font-medium text-foreground truncate">{item.name}</p>
                                          </div>
                                          {item.orphaned && (
                                            <span className="inline-flex rounded-full bg-destructive/15 px-2 py-0.5 text-[10px] text-destructive">
                                              {t("procurement.item.orphaned")}
                                            </span>
                                          )}
                                          {item.spec && <p className="text-xs text-muted-foreground truncate">{item.spec}</p>}
                                        </div>
                                      )}
                                    </td>
                                    <td className={cn("px-2 py-2 text-xs", isOverdue(item.requiredByDate) && "text-destructive")}>
                                      {formatDate(item.requiredByDate, dash)}
                                    </td>
                                    <td className="px-2 py-2 text-right tabular-nums text-foreground">{remaining}</td>
                                    <td className="px-2 py-2 text-foreground">{item.unit}</td>
                                    {canViewSensitiveDetail && (
                                      <td className="px-2 py-2 text-right tabular-nums text-foreground">{fmtCost(item.plannedUnitPrice ?? 0)}</td>
                                    )}
                                    {showProcurementActions && (
                                      <td className="px-2 py-2">
                                        <div className="flex justify-end">
                                          <Button
                                            type="button"
                                            size="sm"
                                            className="h-7"
                                            onClick={() => openCreateOrder([item.id])}
                                            disabled={orderControl.disabled || shouldBlockProcurementLaunchActions}
                                            title={orderControl.disabledReason}
                                          >
                                            {t("procurement.action.order")}
                                          </Button>
                                        </div>
                                      </td>
                                    )}
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  );
                })}

              {requestedStageMap.unstaged.length > 0 && (
                <div className="rounded-lg border border-border overflow-hidden">
                  <button
                    type="button"
                    className="w-full flex items-center gap-2 px-3 py-2 bg-muted/40 hover:bg-muted/60 transition-colors"
                    onClick={() => toggleStage("__unstaged__")}
                  >
                    {collapsedStages.has("__unstaged__") ? <ChevronRight className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                    <span className="text-sm font-semibold text-foreground">Unstaged</span>
                    <span className="ml-auto text-xs text-muted-foreground">{requestedStageMap.unstaged.length}</span>
                  </button>

                  {!collapsedStages.has("__unstaged__") && (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        {renderRequestedTableHeader()}
                        <tbody>
                          {requestedStageMap.unstaged.map((item) => {
                            const remaining = remainingByItemId.get(item.id) ?? 0;
                            const selected = selectedRequestedIds.has(item.id);

                            return (
                              <tr key={item.id} className="border-b border-border/70 last:border-0 hover:bg-muted/20">
                                {showProcurementActions && (
                                  <td className="px-2 py-2">
                                    <Checkbox
                                      checked={selected}
                                      onCheckedChange={(checked) => toggleSelected(item.id, !!checked)}
                                      disabled={orderControl.disabled}
                                    />
                                  </td>
                                )}
                                <td className="px-2 py-2 min-w-[220px]">
                                  {canManageProcurement ? (
                                    <button type="button" onClick={() => openCreateOrder([item.id])} className="text-left hover:underline">
                                      <div className="flex min-w-0 items-center gap-2">
                                        <ResourceTypeBadge type={item.type} className="shrink-0 border-transparent" />
                                        <p className="font-medium text-foreground truncate">{item.name}</p>
                                      </div>
                                      {item.orphaned && (
                                        <span className="inline-flex rounded-full bg-destructive/15 px-2 py-0.5 text-[10px] text-destructive">
                                          {t("procurement.item.orphaned")}
                                        </span>
                                      )}
                                      {item.spec && <p className="text-xs text-muted-foreground truncate">{item.spec}</p>}
                                    </button>
                                  ) : (
                                    <div className="text-left">
                                      <div className="flex min-w-0 items-center gap-2">
                                        <ResourceTypeBadge type={item.type} className="shrink-0 border-transparent" />
                                        <p className="font-medium text-foreground truncate">{item.name}</p>
                                      </div>
                                      {item.orphaned && (
                                        <span className="inline-flex rounded-full bg-destructive/15 px-2 py-0.5 text-[10px] text-destructive">
                                          {t("procurement.item.orphaned")}
                                        </span>
                                      )}
                                      {item.spec && <p className="text-xs text-muted-foreground truncate">{item.spec}</p>}
                                    </div>
                                  )}
                                </td>
                                <td className={cn("px-2 py-2 text-xs", isOverdue(item.requiredByDate) && "text-destructive")}>{formatDate(item.requiredByDate, dash)}</td>
                                <td className="px-2 py-2 text-right tabular-nums text-foreground">{remaining}</td>
                                <td className="px-2 py-2 text-foreground">{item.unit}</td>
                                {canViewSensitiveDetail && (
                                  <td className="px-2 py-2 text-right tabular-nums text-foreground">{fmtCost(item.plannedUnitPrice ?? 0)}</td>
                                )}
                                {showProcurementActions && (
                                  <td className="px-2 py-2">
                                    <div className="flex justify-end">
                                      <Button
                                        type="button"
                                        size="sm"
                                        className="h-7"
                                        onClick={() => openCreateOrder([item.id])}
                                        disabled={orderControl.disabled || shouldBlockProcurementLaunchActions}
                                        title={orderControl.disabledReason}
                                      >
                                        {t("procurement.action.order")}
                                      </Button>
                                    </div>
                                  </td>
                                )}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {effectiveActiveTab === "ordered" && (
        <div className="glass rounded-card p-2 space-y-2">
          {orderedTabOrders.length === 0 ? (
            items.length === 0 && (isProcurementItemsLoading || isProcurementSyncing) ? (
              <div className="space-y-2" aria-hidden>
                {[0, 1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-14 w-full" />
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-8">{t("procurement.empty.noPlaced")}</p>
            )
          ) : (
            orderedTabOrders.map((order) => {
              // Cross-project transfer: rendered like a supplier order card (title + location
              // subtitle + expandable line details), distinguished only by the "Заказ со склада"
              // title. Order-level "mark received" (destination chosen at placement).
              if (order.kind === "stock" && order.transferDirection) {
                const isIncoming = order.transferDirection === "in";
                const transferCollapsed = collapsedOrderIds.has(order.id);
                // The counterparty location is where an incoming transfer ships FROM; fall back to
                // the counterparty project name if that project's locations aren't loaded.
                const locationSubtitle =
                  transferLocationName(order.counterpartyProjectId, order.counterpartyLocationId)
                  ?? (order.counterpartyProjectId ? projectTitleById.get(order.counterpartyProjectId) : undefined)
                  ?? dash;
                const transferTotal = order.lines.reduce((sum, line) => {
                  const item = itemById.get(line.procurementItemId);
                  const unitPrice = line.actualUnitPrice ?? line.plannedUnitPrice
                    ?? item?.actualUnitPrice ?? item?.plannedUnitPrice ?? 0;
                  return sum + unitPrice * line.qty;
                }, 0);
                const isReceived = order.status === "received";
                // Once received, the delivery date must show the FACTUAL receipt date (from the
                // receive movements, immutable), not the expected ETA — a future/past expected
                // date is misleading after delivery.
                const transferReceivedAt = (order.receiveEvents ?? []).reduce<string | null>((latest, event) => {
                  if (!event.createdAt) return latest;
                  if (!latest) return event.createdAt;
                  return new Date(event.createdAt).getTime() > new Date(latest).getTime()
                    ? event.createdAt
                    : latest;
                }, null) ?? order.updatedAt;
                const deliveryLabel = isReceived
                  ? formatDate(transferReceivedAt, dash)
                  : formatDate(order.deliveryDeadline, dash);
                const canReceive = isIncoming && order.status === "placed" && canManageProcurement;
                // Distinct title conveys direction (the source project's card is an outgoing
                // shipment, not an incoming order) without re-introducing a separate badge.
                const transferTitle = isIncoming
                  ? t("procurement.order.stockOrder")
                  : t("procurement.order.stockShipment");
                return (
                  <div key={order.id} className="rounded-lg border border-border overflow-hidden">
                    <div className="w-full flex items-center gap-2 px-3 py-2 bg-muted/40">
                      <button
                        type="button"
                        className="inline-flex h-6 w-6 items-center justify-center rounded hover:bg-muted/70"
                        onClick={() => toggleOrder(order.id)}
                        aria-label={transferCollapsed ? t("procurement.order.expandAria") : t("procurement.order.collapseAria")}
                      >
                        {transferCollapsed
                          ? <ChevronRight className="h-4 w-4 text-muted-foreground" />
                          : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                      </button>
                      {canManageProcurement ? (
                        <button
                          type="button"
                          className="text-sm font-semibold text-foreground hover:underline"
                          onClick={() => openOrderDetail(order.id)}
                        >
                          {transferTitle}
                        </button>
                      ) : (
                        <span className="text-sm font-semibold text-foreground">{transferTitle}</span>
                      )}
                      <span className="text-xs text-muted-foreground truncate">{locationSubtitle}</span>
                      {canViewSensitiveDetail && transferTotal > 0 && (
                        <span className="ml-auto text-xs text-muted-foreground">{fmtCost(transferTotal)}</span>
                      )}
                    </div>

                    {isReceived && (
                      <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-t border-border/60 text-success">
                        <CheckCircle2 className="h-4 w-4" />
                        <span className="text-sm">{t("procurement.transfers.received")}</span>
                        <span className="text-xs text-muted-foreground">{formatDate(transferReceivedAt, dash)}</span>
                      </div>
                    )}

                    {!transferCollapsed && (
                      <div className="overflow-x-auto border-t border-border">
                        {/* Fixed layout + identical columns on every transfer card (the action
                            column is always present, empty when there's nothing to receive) so the
                            columns line up across cards regardless of status or content width. */}
                        <table className="w-full table-fixed text-sm">
                          <thead className="bg-muted/30 border-b border-border">
                            <tr>
                              <th className="text-left px-3 py-2">{t("procurement.col.item")}</th>
                              <th className="w-28 text-right px-3 py-2">{t("procurement.col.orderedQty")}</th>
                              <th className="w-20 text-left px-3 py-2">{t("procurement.col.unit")}</th>
                              <th className="w-40 text-left px-3 py-2">{t("procurement.orderModal.deliveryDate")}</th>
                              <th className="w-32 text-right px-3 py-2">{canReceive ? t("procurement.col.action") : ""}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {order.lines.map((line) => {
                              const item = itemById.get(line.procurementItemId);
                              const itemName = item?.name ?? line.title ?? t("procurement.order.orderedItemFallback");
                              const itemSpec = item?.spec ?? null;
                              // The source ('out') line has no procurement item to type it; inventory
                              // transfers are goods, so fall back to material rather than "other".
                              const itemType = item?.type ?? line.itemType ?? "material";
                              return (
                                <tr key={line.id} className="border-b border-border/70 last:border-0">
                                  <td className="px-3 py-2">
                                    <div className="flex min-w-0 items-start gap-2">
                                      <ResourceTypeBadge type={itemType} className="shrink-0 border-transparent" />
                                      <div className="min-w-0">
                                        <p className="font-medium text-foreground truncate">{itemName}</p>
                                        {itemSpec && <p className="text-xs text-muted-foreground truncate">{itemSpec}</p>}
                                      </div>
                                    </div>
                                  </td>
                                  <td className="px-3 py-2 text-right tabular-nums">{line.qty}</td>
                                  <td className="px-3 py-2">{line.unit}</td>
                                  <td className="px-3 py-2 truncate">{deliveryLabel}</td>
                                  <td className="px-3 py-2">
                                    {canReceive && (
                                      <div className="flex justify-end">
                                        <Button
                                          type="button"
                                          size="sm"
                                          className="h-7"
                                          onClick={() => void receiveCrossProjectTransfer(order)}
                                          disabled={receivingTransferId === order.id}
                                        >
                                          {receivingTransferId === order.id
                                            ? t("procurement.orderDetail.receivingTransfer")
                                            : t("procurement.action.receive")}
                                        </Button>
                                      </div>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                );
              }
              const collapsed = collapsedOrderIds.has(order.id);
              const orderNumber = supplierOrderNumberById.get(order.id) ?? 0;
              const total = order.lines.reduce((sum, line) => {
                const item = itemById.get(line.procurementItemId);
                const unitPrice = line.actualUnitPrice ?? line.plannedUnitPrice ?? item?.actualUnitPrice ?? item?.plannedUnitPrice ?? 0;
                const openQty = Math.max(line.qty - line.receivedQty, 0);
                return sum + unitPrice * openQty;
              }, 0);
              const isFullyReceived =
                order.lines.length > 0 &&
                order.lines.every((line) => Math.max(0, line.qty - line.receivedQty) === 0);
              const receivedTotal = order.lines.reduce((sum, line) => {
                const item = itemById.get(line.procurementItemId);
                const unitPrice = line.actualUnitPrice ?? line.plannedUnitPrice ?? item?.actualUnitPrice ?? item?.plannedUnitPrice ?? 0;
                return sum + unitPrice * line.receivedQty;
              }, 0);
              const receivedExpanded = expandedReceivedOrderIds.has(order.id);
              const lastReceiveAt = (order.receiveEvents ?? []).reduce<string | null>((latest, event) => {
                if (!event.createdAt) return latest;
                if (!latest) return event.createdAt;
                return new Date(event.createdAt).getTime() > new Date(latest).getTime()
                  ? event.createdAt
                  : latest;
              }, null);
              const lineLatestReceiveAt = (lineId: string): string | null => (
                (order.receiveEvents ?? []).reduce<string | null>((latest, event) => {
                  if (event.orderLineId !== lineId || !event.createdAt) return latest;
                  if (!latest) return event.createdAt;
                  return new Date(event.createdAt).getTime() > new Date(latest).getTime()
                    ? event.createdAt
                    : latest;
                }, null)
              );

              return (
                <div key={order.id} className="rounded-lg border border-border overflow-hidden">
                  <div className="w-full flex items-center gap-2 px-3 py-2 bg-muted/40">
                    <button
                      type="button"
                      className="inline-flex h-6 w-6 items-center justify-center rounded hover:bg-muted/70"
                      onClick={() => (isFullyReceived ? toggleReceivedOrderDetails(order.id) : toggleOrder(order.id))}
                      aria-label={
                        isFullyReceived
                          ? (receivedExpanded ? t("procurement.order.hideDetails") : t("procurement.order.showDetails"))
                          : (collapsed ? t("procurement.order.expandAria") : t("procurement.order.collapseAria"))
                      }
                    >
                      {isFullyReceived
                        ? (receivedExpanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />)
                        : (collapsed ? <ChevronRight className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />)}
                    </button>
                    {canManageProcurement ? (
                      <button
                        type="button"
                        className="text-sm font-semibold text-foreground hover:underline"
                        onClick={() => openOrderDetail(order.id)}
                      >
                        {t("procurement.order.supplierN", { number: orderNumber })}
                      </button>
                    ) : (
                      <span className="text-sm font-semibold text-foreground">
                        {t("procurement.order.supplierN", { number: orderNumber })}
                      </span>
                    )}
                    {showSupplier && order.supplierName && (
                      <span className="text-xs text-muted-foreground truncate">{order.supplierName}</span>
                    )}
                    {canViewSensitiveDetail && (
                      <span className="ml-auto text-xs text-muted-foreground">
                        {fmtCost(isFullyReceived ? receivedTotal : total)}
                      </span>
                    )}
                  </div>

                  {isFullyReceived ? (
                    <>
                      <div className="flex flex-wrap items-center gap-2 px-3 py-2 text-success">
                        <CheckCircle2 className="h-4 w-4" />
                        <span className="text-sm">{t("procurement.order.fullyReceived")}</span>
                        {lastReceiveAt && (
                          <span className="text-xs text-muted-foreground">{formatDate(lastReceiveAt, dash)}</span>
                        )}
                      </div>
                      {receivedExpanded && (
                        <div className="overflow-x-auto border-t border-border">
                          <table className="w-full text-sm">
                            <thead className="bg-muted/30 border-b border-border">
                              <tr>
                                <th className="text-left px-3 py-2">{t("procurement.col.item")}</th>
                                <th className="text-right px-3 py-2">{t("procurement.col.orderedQty")}</th>
                                <th className="text-right px-3 py-2">{t("procurement.order.received")}</th>
                                <th className="text-left px-3 py-2">{t("procurement.col.unit")}</th>
                                <th className="text-left px-3 py-2">{t("procurement.col.receivedAt")}</th>
                              </tr>
                            </thead>
                            <tbody>
                              {order.lines.map((line) => {
                                const item = itemById.get(line.procurementItemId);
                                const lineReceivedAt = lineLatestReceiveAt(line.id);
                                const itemName = item?.name ?? line.title ?? t("procurement.order.orderedItemFallback");
                                const itemSpec = item?.spec ?? null;
                                const itemType = item?.type ?? line.itemType ?? "other";
                                return (
                                  <tr key={line.id} className="border-b border-border/70 last:border-0">
                                    <td className="px-3 py-2 min-w-[220px]">
                                      <div className="flex min-w-0 items-start gap-2">
                                        <ResourceTypeBadge type={itemType} className="shrink-0 border-transparent" />
                                        <div className="min-w-0">
                                          <p className="font-medium text-foreground truncate">{itemName}</p>
                                          {itemSpec && <p className="text-xs text-muted-foreground truncate">{itemSpec}</p>}
                                        </div>
                                      </div>
                                    </td>
                                    <td className="px-3 py-2 text-right tabular-nums text-foreground">{line.qty}</td>
                                    <td className="px-3 py-2 text-right tabular-nums text-foreground">{line.receivedQty}</td>
                                    <td className="px-3 py-2 text-foreground">{line.unit}</td>
                                    <td className="px-3 py-2 text-xs text-muted-foreground">{formatDate(lineReceivedAt, dash)}</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </>
                  ) : !collapsed && (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          {renderOrderedTableHeader()}
                          <tbody>
                            {order.lines.length === 0 ? (
                              <tr>
                                <td
                                  colSpan={orderedTableColumnCount}
                                  className="px-3 py-6 text-sm text-muted-foreground"
                                >
                                  {t("procurement.empty.noLinesInOrder")}
                                </td>
                              </tr>
                            ) : (
                            order.lines.map((line) => {
                            const item = itemById.get(line.procurementItemId);
                            if (!item && canViewSensitiveDetail) return null;
                            const openQty = Math.max(line.qty - line.receivedQty, 0);
                            const unitPrice = item
                              ? (line.actualUnitPrice ?? line.plannedUnitPrice ?? item.actualUnitPrice ?? item.plannedUnitPrice ?? 0)
                              : 0;
                            const selectionKey = `${order.id}:${line.id}`;
                            const receivableTarget = orderedReceivableTargetByKey.get(selectionKey);
                            const selected = !!receivableTarget && selectedOrderedLineKeys.has(selectionKey);
                            const parsedDelivery = order.deliveryDeadline ? new Date(order.deliveryDeadline) : null;
                            const selectedDeliveryDate = parsedDelivery && !Number.isNaN(parsedDelivery.getTime()) ? parsedDelivery : undefined;

                            if (!item) {
                              return (
                                <tr key={line.id} className="border-b border-border/70 last:border-0 hover:bg-muted/20">
                                  {showProcurementActions && (
                                    <td className="px-2 py-2">
                                      <Checkbox checked={false} disabled />
                                    </td>
                                  )}
                                  <td className="px-2 py-2 min-w-[220px]">
                                    <div className="flex min-w-0 items-start gap-2">
                                      <ResourceTypeBadge type={line.itemType || "other"} className="shrink-0 border-transparent" />
                                      <div className="min-w-0">
                                        <p className="font-medium text-foreground truncate">{line.title || t("procurement.order.orderedItemFallback")}</p>
                                      </div>
                                    </div>
                                  </td>
                                  <td className="px-2 py-2 text-xs text-muted-foreground">{formatDate(null, dash)}</td>
                                  <td className="px-2 py-2">
                                    <span className="text-xs text-muted-foreground">
                                      {order.deliveryDeadline ? formatDate(order.deliveryDeadline, dash) : t("procurement.order.emptyDash")}
                                    </span>
                                  </td>
                                  <td className="px-2 py-2 text-right">
                                    <div className="flex items-center justify-end gap-1">
                                      <p className="tabular-nums text-foreground">{openQty}</p>
                                      {line.receivedQty > 0 && openQty > 0 && (
                                        <Tooltip>
                                          <TooltipTrigger asChild>
                                            <button type="button" className="text-warning" aria-label={t("procurement.order.partialAria")}>
                                              <AlertTriangle className="h-3.5 w-3.5" />
                                            </button>
                                          </TooltipTrigger>
                                          <TooltipContent className="max-w-xs text-caption">
                                            <p>{t("procurement.order.partialTooltip", { received: line.receivedQty, total: line.qty })}</p>
                                            <button
                                              type="button"
                                              className="mt-1 text-accent hover:underline"
                                              onClick={(event) => {
                                                event.stopPropagation();
                                                setActiveTab("in_stock");
                                              }}
                                            >
                                              {t("procurement.order.learnMore")}
                                            </button>
                                          </TooltipContent>
                                        </Tooltip>
                                      )}
                                    </div>
                                  </td>
                                  <td className="px-2 py-2">{line.unit}</td>
                                  {showProcurementActions && (
                                    <td className="px-2 py-2">
                                      <div className="flex justify-end">
                                        <Button type="button" size="sm" className="h-7" disabled>
                                          {t("procurement.action.receive")}
                                        </Button>
                                      </div>
                                    </td>
                                  )}
                                </tr>
                              );
                            }

                            return (
                              <tr key={line.id} className="border-b border-border/70 last:border-0 hover:bg-muted/20">
                                {showProcurementActions && (
                                  <td className="px-2 py-2">
                                    <Checkbox
                                      checked={selected}
                                      onCheckedChange={(checked) => {
                                        if (!receivableTarget) return;
                                        toggleSelectedOrderedLine(receivableTarget.selectionKey, !!checked);
                                      }}
                                      disabled={receiveControl.disabled || !receivableTarget}
                                    />
                                  </td>
                                )}
                                <td className="px-2 py-2 min-w-[220px]">
                                  {canManageProcurement ? (
                                    <button type="button" className="text-left hover:underline" onClick={() => openOrderDetail(order.id)}>
                                      <div className="flex min-w-0 items-start gap-2">
                                        <ResourceTypeBadge type={item.type} className="shrink-0 border-transparent" />
                                        <div className="min-w-0">
                                          <p className="font-medium text-foreground truncate">{item.name}</p>
                                          {item.spec && <p className="text-xs text-muted-foreground truncate">{item.spec}</p>}
                                        </div>
                                      </div>
                                      {item.orphaned && (
                                        <span className="inline-flex rounded-full bg-destructive/15 px-2 py-0.5 text-[10px] text-destructive">
                                          {t("procurement.item.orphaned")}
                                        </span>
                                      )}
                                    </button>
                                  ) : (
                                    <div className="text-left">
                                      <div className="flex min-w-0 items-start gap-2">
                                        <ResourceTypeBadge type={item.type} className="shrink-0 border-transparent" />
                                        <div className="min-w-0">
                                          <p className="font-medium text-foreground truncate">{item.name}</p>
                                          {item.spec && <p className="text-xs text-muted-foreground truncate">{item.spec}</p>}
                                        </div>
                                      </div>
                                      {item.orphaned && (
                                        <span className="inline-flex rounded-full bg-destructive/15 px-2 py-0.5 text-[10px] text-destructive">
                                          {t("procurement.item.orphaned")}
                                        </span>
                                      )}
                                    </div>
                                  )}
                                </td>
                                <td className={cn("px-2 py-2 text-xs", isOverdue(item.requiredByDate) && "text-destructive")}>
                                  {formatDate(item.requiredByDate, dash)}
                                </td>
                                <td className="px-2 py-2">
                                  {isSupabaseMode || !canManageProcurement ? (
                                    <span className="text-xs text-muted-foreground">
                                      {order.deliveryDeadline ? formatDate(order.deliveryDeadline, dash) : t("procurement.order.emptyDash")}
                                    </span>
                                  ) : (
                                    <Popover>
                                      <PopoverTrigger asChild>
                                        <button type="button" className="text-xs text-accent hover:underline">
                                          {order.deliveryDeadline ? formatDate(order.deliveryDeadline, dash) : t("procurement.order.emptyDash")}
                                        </button>
                                      </PopoverTrigger>
                                      <PopoverContent className="w-auto p-0" align="start">
                                        <Calendar
                                          mode="single"
                                          selected={selectedDeliveryDate}
                                          onSelect={(nextDate) => {
                                            if (!nextDate) return;
                                            updateOrder(order.id, { deliveryDeadline: nextDate.toISOString() });
                                          }}
                                          initialFocus
                                        />
                                      </PopoverContent>
                                    </Popover>
                                  )}
                                </td>
                                <td className="px-2 py-2 text-right">
                                  <div className="flex items-center justify-end gap-1">
                                    <p className="tabular-nums text-foreground">{openQty}</p>
                                    {line.receivedQty > 0 && openQty > 0 && (
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <button type="button" className="text-warning" aria-label={t("procurement.order.partialAria")}>
                                            <AlertTriangle className="h-3.5 w-3.5" />
                                          </button>
                                        </TooltipTrigger>
                                        <TooltipContent className="max-w-xs text-caption">
                                          <p>{t("procurement.order.partialTooltip", { received: line.receivedQty, total: line.qty })}</p>
                                          <button
                                            type="button"
                                            className="mt-1 text-accent hover:underline"
                                            onClick={(event) => {
                                              event.stopPropagation();
                                              setActiveTab("in_stock");
                                            }}
                                          >
                                            {t("procurement.order.learnMore")}
                                          </button>
                                        </TooltipContent>
                                      </Tooltip>
                                    )}
                                  </div>
                                </td>
                                <td className="px-2 py-2">{line.unit}</td>
                                {canViewSensitiveDetail && (
                                  <td className="px-2 py-2 text-right">{fmtCost(unitPrice)}</td>
                                )}
                                {canViewSensitiveDetail && (
                                  <td className="px-2 py-2 text-right">{fmtCost(unitPrice * openQty)}</td>
                                )}
                                {showProcurementActions && (
                                  <td className="px-2 py-2">
                                    <div className="flex justify-end">
                                      <Button
                                        type="button"
                                        size="sm"
                                        className="h-7"
                                        onClick={() => receivableTarget && openReceiveItemsModal([receivableTarget])}
                                        disabled={receiveControl.disabled || shouldBlockProcurementLaunchActions || !receivableTarget}
                                        title={receiveControl.disabledReason}
                                      >
                                        {t("procurement.action.receive")}
                                      </Button>
                                    </div>
                                  </td>
                                )}
                              </tr>
                            );
                            })
                            )}
                          </tbody>
                        </table>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {effectiveActiveTab === "in_stock" && (
        <div className="glass rounded-card p-2 space-y-2">
          {visibleInStockRows.length === 0 ? (
            items.length === 0 && (isProcurementItemsLoading || isProcurementSyncing) ? (
              <div className="space-y-2" aria-hidden>
                {[0, 1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-14 w-full" />
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-8">{t("procurement.empty.noInStock")}</p>
            )
          ) : (
            <div className="rounded-lg border border-border overflow-x-auto">
              <table className="w-full text-sm">
                {renderInStockTableHeader()}
                <tbody>
                  {visibleInStockRows.map((row) => (
                    <tr key={row.key} className="border-b border-border/70 last:border-0 hover:bg-muted/20">
                      {showProcurementActions && (
                        <td className="px-2 py-2">
                          <Checkbox
                            checked={selectedInStockRowKeys.has(row.key)}
                            onCheckedChange={(checked) => toggleSelectedInStockRow(row.key, !!checked)}
                            disabled={useFromStockEffectiveDisabled}
                            title={useFromStockEffectiveReason}
                          />
                        </td>
                      )}
                      <td className="px-2 py-2 min-w-[240px]">
                        <button
                          type="button"
                          className="text-left hover:underline w-full min-w-0"
                          onClick={() => openInStockDetail(row)}
                        >
                          <div className="flex min-w-0 items-center gap-2">
                            <ResourceTypeBadge type={row.item.type} className="shrink-0 border-transparent" />
                            <p className="font-medium text-foreground truncate min-w-0">{row.item.name}</p>
                          </div>
                          {row.item.spec && (
                            <p className="text-xs text-muted-foreground truncate">{row.item.spec}</p>
                          )}
                        </button>
                      </td>
                      <td className="px-2 py-2 text-muted-foreground">{row.locationName}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{row.qty} {row.item.unit}</td>
                      {!canManageProcurement && (
                        <td className="px-2 py-2 text-xs text-muted-foreground">{row.receiverName ?? dash}</td>
                      )}
                      <td className="px-2 py-2 text-xs text-muted-foreground">{formatDate(row.lastReceivedAt, dash)}</td>
                      {showProcurementActions && (
                        <td className="px-2 py-2">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              type="button"
                              size="sm"
                              className="h-7"
                              onClick={() => openUseFromStockModal([row])}
                              disabled={useFromStockEffectiveDisabled || isSupabaseMode}
                              title={isSupabaseMode ? t("common.comingSoon") : useFromStockEffectiveReason}
                            >
                              {t("procurement.action.use")}
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="h-7"
                              onClick={() => handleRequestMore(row)}
                              disabled={!canManageProcurement || isSupabaseMode}
                              title={isSupabaseMode ? t("common.comingSoon") : undefined}
                            >
                              {t("procurement.action.requestMore")}
                            </Button>
                            {isSupabaseMode && (
                              <Badge variant="secondary" className="h-5 px-1.5 text-[10px] font-normal">
                                {t("common.comingSoon")}
                              </Badge>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <Dialog
        open={useFromStockOpen}
        onOpenChange={(nextOpen) => {
          setUseFromStockOpen(nextOpen);
          if (!nextOpen) {
            setUseFromStockTargets([]);
            setUseFromStockQtyByKey({});
            setUseFromStockParticipantId("none");
            setUseFromStockManualName("");
            setUseFromStockNote("");
          }
        }}
      >
        <DialogContent className="w-[95vw] max-w-3xl max-h-[90vh] p-0 gap-0 overflow-hidden">
          <DialogHeader className="px-5 py-4 border-b border-border">
            <DialogTitle>{t("procurement.useModal.title")}</DialogTitle>
            <DialogDescription className="sr-only">
              {t("procurement.useModal.description")}
            </DialogDescription>
          </DialogHeader>

          {useFromStockTargets.length === 0 ? (
            <div className="px-5 py-4 text-sm text-muted-foreground">{t("procurement.useModal.noStockSelected")}</div>
          ) : (
            <div className="px-5 py-4 space-y-4">
              <div className="rounded-lg border border-border overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/30 border-b border-border">
                    <tr>
                      <th className="text-left px-3 py-2">{t("procurement.col.item")}</th>
                      <th className="text-left px-3 py-2">{t("procurement.col.location")}</th>
                      <th className="text-right px-3 py-2">{t("procurement.col.available")}</th>
                      <th className="text-right px-3 py-2">{t("procurement.col.qtyToUseNow")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {useFromStockTargets.map((target) => (
                      <tr key={target.key} className="border-b border-border last:border-0">
                        <td className="px-3 py-2 min-w-[220px]">
                          <div className="flex items-start gap-2">
                            <ResourceTypeBadge type={target.item.type} className="shrink-0 border-transparent" />
                            <div className="min-w-0">
                              <p className="font-medium text-foreground truncate">{target.item.name}</p>
                              {target.item.spec && <p className="text-xs text-muted-foreground truncate">{target.item.spec}</p>}
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">{target.locationName}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{target.qty} {target.item.unit}</td>
                        <td className="px-3 py-2 text-right">
                          <Input
                            type="number"
                            min="0"
                            max={target.qty}
                            value={useFromStockQtyByKey[target.key] ?? ""}
                            onChange={(event) => {
                              const nextValue = event.target.value;
                              setUseFromStockQtyByKey((prev) => ({
                                ...prev,
                                [target.key]: nextValue,
                              }));
                            }}
                            placeholder={String(target.qty)}
                            className="h-9 w-32 ml-auto"
                            aria-label={t("procurement.useModal.qtyAria", { name: target.item.name })}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="use-from-stock-participant" className="text-xs text-muted-foreground">{t("procurement.useModal.usedByParticipant")}</label>
                  <Select value={useFromStockParticipantId} onValueChange={setUseFromStockParticipantId}>
                    <SelectTrigger id="use-from-stock-participant" className="h-9 mt-1">
                      <SelectValue placeholder={t("procurement.useModal.notSpecified")} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">{t("procurement.useModal.notSpecified")}</SelectItem>
                      {participantOptions.map((participant) => (
                        <SelectItem key={participant.id} value={participant.id}>{participant.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label htmlFor="use-from-stock-manual-name" className="text-xs text-muted-foreground">{t("procurement.useModal.manualName")}</label>
                  <Input
                    id="use-from-stock-manual-name"
                    value={useFromStockManualName}
                    onChange={(event) => setUseFromStockManualName(event.target.value)}
                    className="h-9 mt-1"
                    placeholder={t("procurement.useModal.optional")}
                  />
                </div>
              </div>

              <div>
                <label htmlFor="use-from-stock-note" className="text-xs text-muted-foreground">{t("procurement.useModal.note")}</label>
                <Textarea
                  id="use-from-stock-note"
                  value={useFromStockNote}
                  onChange={(event) => setUseFromStockNote(event.target.value)}
                  className="mt-1 min-h-[72px]"
                  placeholder={t("procurement.useModal.notePlaceholder")}
                />
              </div>
            </div>
          )}

          <DialogFooter className="px-5 py-4 border-t border-border">
            <Button type="button" variant="outline" onClick={() => setUseFromStockOpen(false)}>Cancel</Button>
            <Button type="button" onClick={submitUseFromStock} disabled={!canUseFromStock || useFromStockTargets.length === 0}>Use</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={inStockDetailOpen}
        onOpenChange={(nextOpen) => {
          setInStockDetailOpen(nextOpen);
          if (!nextOpen) setInStockDetailTarget(null);
        }}
      >
        <DialogContent className="w-[95vw] max-w-4xl max-h-[90vh] p-0 gap-0 flex flex-col overflow-hidden">
          <DialogHeader className="px-5 py-4 border-b border-border flex-shrink-0">
            <DialogTitle>{t("procurement.stockDetail.title")}</DialogTitle>
            <DialogDescription className="sr-only">
              {t("procurement.stockDetail.description")}
            </DialogDescription>
          </DialogHeader>

          {!inStockDetailTarget ? (
            <div className="px-5 py-4 text-sm text-muted-foreground">{t("procurement.useModal.noStockSelected")}</div>
          ) : (
            <div className="px-5 py-4 space-y-4 overflow-y-auto flex-1 min-h-0">
              <div className="rounded-lg border border-border p-3">
                <div className="flex flex-wrap items-start gap-2">
                  <ResourceTypeBadge type={inStockDetailTarget.item.type} className="border-transparent" />
                  <div className="min-w-0">
                    <p className="font-medium text-foreground">{inStockDetailTarget.item.name}</p>
                    {inStockDetailTarget.item.spec && (
                      <p className="text-xs text-muted-foreground">{inStockDetailTarget.item.spec}</p>
                    )}
                  </div>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">{t("procurement.stockDetail.qtyAvailable", { qty: inStockDetailTarget.qty, unit: inStockDetailTarget.item.unit })}</p>
              </div>

              <div className="rounded-lg border border-border overflow-hidden">
                <div className="px-3 py-2 border-b border-border bg-muted/30 text-sm font-medium text-foreground">{t("procurement.stockDetail.receiptHistory")}</div>
                {inStockDetailHistory.receiptEvents.length === 0 ? (
                  <p className="px-3 py-3 text-xs text-muted-foreground">{t("procurement.stockDetail.noReceipts")}</p>
                ) : (
                  <div className="divide-y divide-border">
                    {inStockDetailHistory.receiptEvents.map((entry) => {
                      const receiverLabel = entry.event.receiverName
                        || (entry.event.receiverParticipantId ? participantNameById.get(entry.event.receiverParticipantId) : "")
                        || dash;
                      const sourceLocationLabel = entry.event.sourceLocationId
                        ? (locationById.get(entry.event.sourceLocationId)?.name ?? entry.event.sourceLocationId)
                        : dash;
                      const docs = entry.event.documents?.length
                        ? entry.event.documents
                        : (entry.order.invoiceAttachment ? [entry.order.invoiceAttachment] : []);

                      return (
                        <div key={entry.event.id} className="px-3 py-2 space-y-1">
                          <p className="text-xs text-muted-foreground">{new Date(entry.event.createdAt).toLocaleString()}</p>
                          <p className="text-sm text-foreground">
                            +{entry.event.deltaQty} {entry.line?.unit ?? inStockDetailTarget.item.unit}
                          </p>
                          <p className="text-xs text-muted-foreground">{t("procurement.stockDetail.receiver", { name: receiverLabel })}</p>
                          <p className="text-xs text-muted-foreground">{t("procurement.stockDetail.sourceLocation", { name: sourceLocationLabel })}</p>
                          {docs.length > 0 && (
                            <div className="flex flex-wrap items-center gap-2 pt-1">
                              {docs.map((doc) => (
                                <a
                                  key={doc.id}
                                  href={doc.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-xs text-accent hover:underline"
                                >
                                  {attachmentDisplayName(doc)}
                                </a>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="rounded-lg border border-border overflow-hidden">
                <div className="px-3 py-2 border-b border-border bg-muted/30 text-sm font-medium text-foreground">{t("procurement.stockDetail.usageHistory")}</div>
                {inStockDetailHistory.usageEvents.length === 0 ? (
                  <p className="px-3 py-3 text-xs text-muted-foreground">{t("procurement.stockDetail.noUsage")}</p>
                ) : (
                  <div className="divide-y divide-border">
                    {inStockDetailHistory.usageEvents.map((entry) => {
                      const usedByLabel = entry.event.usedByName
                        || (entry.event.usedByParticipantId ? participantNameById.get(entry.event.usedByParticipantId) : "")
                        || dash;
                      return (
                        <div key={entry.event.id} className="px-3 py-2 space-y-1">
                          <p className="text-xs text-muted-foreground">{new Date(entry.event.createdAt).toLocaleString()}</p>
                          <p className="text-sm text-foreground">
                            {entry.event.deltaQty} {entry.line?.unit ?? inStockDetailTarget.item.unit}
                          </p>
                          <p className="text-xs text-muted-foreground">{t("procurement.stockDetail.usedBy", { name: usedByLabel })}</p>
                          {entry.event.note && <p className="text-xs text-muted-foreground">{t("procurement.stockDetail.noteLine", { note: entry.event.note })}</p>}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          <DialogFooter className="px-5 py-4 border-t border-border flex-shrink-0">
            <Button type="button" variant="outline" onClick={() => setInStockDetailOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={receiveModalOpen}
        onOpenChange={(nextOpen) => {
          setReceiveModalOpen(nextOpen);
          if (!nextOpen) {
            setReceiveModalTargets([]);
            setReceiveModalQtyByKey({});
            setReceiveModalLocationByKey({});
          }
        }}
      >
        <DialogContent className="w-[95vw] max-w-4xl max-h-[90vh] p-0 gap-0 overflow-hidden flex flex-col">
          <DialogHeader className="px-5 py-4 border-b border-border">
            <DialogTitle>{t("procurement.receiveModal.title")}</DialogTitle>
            <DialogDescription className="sr-only">
              {t("procurement.receiveModal.description")}
            </DialogDescription>
          </DialogHeader>

          {receiveModalTargets.length === 0 ? (
            <div className="px-5 py-4 text-sm text-muted-foreground">{t("procurement.receiveModal.noItems")}</div>
          ) : (
            <div className="px-5 py-4 flex-1 overflow-y-auto space-y-3">
              {receiveModalTargets.length === 1 && (
                <div className="rounded-lg border border-border p-3">
                  <p className="font-medium text-foreground">{receiveModalTargets[0].itemName}</p>
                  {receiveModalTargets[0].itemSpec && (
                    <p className="text-xs text-muted-foreground mt-1">{receiveModalTargets[0].itemSpec}</p>
                  )}
                </div>
              )}

              <div className="rounded-lg border border-border overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/30 border-b border-border">
                    <tr>
                      <th className="text-left px-3 py-2">{t("procurement.col.item")}</th>
                      <th className="text-right px-3 py-2">{t("procurement.col.orderedQty")}</th>
                      <th className="text-right px-3 py-2">{t("procurement.col.alreadyReceived")}</th>
                      <th className="text-right px-3 py-2">{t("procurement.col.remaining")}</th>
                      <th className="text-left px-3 py-2">{t("procurement.col.location")}</th>
                      <th className="text-right px-3 py-2">{t("procurement.col.receiveNow")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {receiveModalTargets.map((target) => (
                      <tr key={target.selectionKey} className="border-b border-border/70 last:border-0">
                        <td className="px-3 py-2">
                          <div className="flex min-w-0 items-start gap-2">
                            <ResourceTypeBadge type={target.itemType} className="shrink-0 border-transparent" />
                            <div className="min-w-0">
                              <p className="font-medium text-foreground">{target.itemName}</p>
                              {target.itemSpec && <p className="text-xs text-muted-foreground">{target.itemSpec}</p>}
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{target.orderedQty} {target.unit}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{target.alreadyReceivedQty} {target.unit}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{target.remainingQty} {target.unit}</td>
                        <td className="px-3 py-2">
                          <LocationPicker
                            projectId={pid}
                            value={receiveModalLocationByKey[target.selectionKey] ?? ""}
                            onChange={(nextLocationId) => {
                              setReceiveModalLocationByKey((prev) => ({
                                ...prev,
                                [target.selectionKey]: nextLocationId,
                              }));
                            }}
                            className="h-8"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <Input
                            type="number"
                            min="0"
                            max={target.remainingQty}
                            value={receiveModalQtyByKey[target.selectionKey] ?? target.remainingQty}
                            onChange={(event) => {
                              const rawQty = Number(event.target.value);
                              const clampedQty = Math.min(target.remainingQty, Math.max(0, Number.isFinite(rawQty) ? rawQty : 0));
                              setReceiveModalQtyByKey((prev) => ({ ...prev, [target.selectionKey]: clampedQty }));
                            }}
                            className="h-8 text-right"
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <DialogFooter className="px-5 py-4 border-t border-border">
            <Button type="button" variant="outline" onClick={() => setReceiveModalOpen(false)}>Close</Button>
            <Button
              type="button"
              onClick={submitReceiveItems}
              disabled={!canEdit || receiveModalTargets.length === 0 || receiveItemsConfirmInFlight}
            >
              {receiveItemsConfirmInFlight ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
              {receiveItemsConfirmInFlight ? t("procurement.receiveModal.receiving") : t("procurement.receiveModal.confirmReceived")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {canManageProcurement && (
        <OrderModal
          open={createOrderOpen}
          onOpenChange={setCreateOrderOpen}
          projectId={pid}
          initialItemIds={createOrderItemIds}
          showSensitiveDetail={canViewSensitiveDetail}
        />
      )}

      {canManageProcurement && (
        <OrderDetailModal
          open={!!orderId}
          onOpenChange={(nextOpen) => !nextOpen && closeOrderDetail()}
          projectId={pid}
          orderId={orderId ?? ""}
          showSensitiveDetail={canViewSensitiveDetail}
          onOpenRequest={(requestId) => {
            navigate(`/project/${pid}/procurement/${requestId}`);
          }}
        />
      )}

      <Dialog open={canManageProcurement && !!itemId && !orderId} onOpenChange={(nextOpen) => !nextOpen && closeDetail()}>
        <DialogContent className="h-[95vh] w-[100vw] max-w-none rounded-none p-0 gap-0 overflow-hidden flex flex-col sm:h-auto sm:w-[75vw] sm:max-w-6xl sm:max-h-[90vh] sm:rounded-xl">
          <DialogHeader className="border-b border-border px-4 py-3 pr-12 sm:px-6 sm:py-4">
            <DialogTitle>{t("procurement.detail.title")}</DialogTitle>
            <DialogDescription className="sr-only">
              {t("procurement.detail.description")}
            </DialogDescription>
          </DialogHeader>

          {!detailItem ? (
            <div className="p-4">
              <p className="text-sm text-muted-foreground">{t("procurement.detail.notFound")}</p>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6 sm:py-5">
              <div className="mx-auto w-full max-w-4xl space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  {detailItem.lockedFromEstimate && (
                    <span className="inline-flex rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                      {t("procurement.item.lockedFromEstimate")}
                    </span>
                  )}
                  {detailItem.orphaned && (
                    <span className="inline-flex rounded-full bg-destructive/15 px-2 py-0.5 text-[11px] text-destructive">
                      {t("procurement.item.orphaned")}
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-muted-foreground">{t("procurement.detail.type")}</label>
                    <div className="mt-1">
                      <ItemTypePicker
                        value={(editForm.type ?? "other") as ProcurementItemType}
                        // No procurement_items type column exists; in supabase mode the type is derived
                        // from the estimate on read, so editing it here would Save-toast then silently revert.
                        disabled={!canEdit || activeTab === "ordered" || !!detailItem.lockedFromEstimate || isSupabaseMode}
                        onChange={(nextType) => patchEditForm((prev) => ({ ...prev, type: nextType }), "immediate")}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">{t("procurement.detail.whenNeeded")}</label>
                    <div className="mt-1">
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button
                            variant="outline"
                            disabled={!canEdit || activeTab === "ordered" || !!detailItem.lockedFromEstimate}
                            className={cn("h-9 w-full justify-start text-left", isOverdue(editForm.requiredByDate) && "text-destructive")}
                          >
                            <CalendarIcon className="h-4 w-4 mr-2" />
                            {formatDate(editForm.requiredByDate, dash)}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                          <Calendar
                            mode="single"
                            selected={editForm.requiredByDate ? parseProcurementDate(editForm.requiredByDate) : undefined}
                            onSelect={(nextDate) => patchEditForm((prev) => ({ ...prev, requiredByDate: nextDate ? toLocalDateString(nextDate) : null }), "immediate")}
                            initialFocus
                          />
                        </PopoverContent>
                      </Popover>
                      {detailItem.lockedFromEstimate && (
                        <p className="mt-1 text-[11px] text-muted-foreground">{t("procurement.detail.syncedFromWork")}</p>
                      )}
                    </div>
                  </div>
                </div>

                <div>
                  <label className="text-xs text-muted-foreground">{t("procurement.detail.name")}</label>
                  <Input
                  value={editForm.name ?? ""}
                  onChange={(event) => patchEditForm((prev) => ({ ...prev, name: event.target.value }))}
                  onBlur={() => persistDraftNowIfChanged(draftRef.current)}
                  className="h-9"
                  disabled={!canEdit || activeTab === "ordered" || !!detailItem.lockedFromEstimate}
                />
                </div>

                <div>
                  <label className="text-xs text-muted-foreground">{t("procurement.detail.spec")}</label>
                  <Input
                    value={editForm.spec ?? ""}
                    onChange={(event) => patchEditForm((prev) => ({ ...prev, spec: event.target.value || null }))}
                    onBlur={() => persistDraftNowIfChanged(draftRef.current)}
                    className="h-9"
                    disabled={!canEdit}
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-muted-foreground">{t("procurement.detail.requestedAmount")}</label>
                    <Input
                      type="number"
                      min="0"
                      value={editForm.requiredQty ?? 0}
                      onChange={(event) => {
                        const requiredQty = Math.max(0, Number(event.target.value));
                        patchEditForm((prev) => ({ ...prev, requiredQty }));
                      }}
                      onBlur={() => persistDraftNowIfChanged(draftRef.current)}
                      className="h-9"
                      disabled={!canEdit || activeTab === "ordered" || !!detailItem.lockedFromEstimate}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">{t("procurement.detail.unit")}</label>
                    <p className="mt-1 h-9 flex items-center text-sm text-foreground">{editForm.unit ?? dash}</p>
                  </div>
                </div>

                {canViewSensitiveDetail && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-muted-foreground">{t("procurement.detail.plannedUnitPrice")}</label>
                      <p className="mt-1 h-9 flex items-center justify-end tabular-nums text-sm text-foreground">
                        {fmtCost(editForm.plannedUnitPrice ?? 0)}
                      </p>
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground">{t("procurement.detail.actualUnitPrice")}</label>
                      <Input
                        type="number"
                        min="0"
                        value={editForm.actualUnitPrice ?? ""}
                        onChange={(event) => {
                          const actualUnitPrice = event.target.value ? Number(event.target.value) : null;
                          patchEditForm((prev) => ({ ...prev, actualUnitPrice }));
                        }}
                        onBlur={() => persistDraftNowIfChanged(draftRef.current)}
                        className="h-9"
                        placeholder={t("procurement.detail.actualUnitPricePlaceholder")}
                        disabled={!canEdit || activeTab === "ordered"}
                      />
                    </div>
                  </div>
                )}

                <div>
                  <label className="text-xs text-muted-foreground">{t("procurement.detail.supplierPreferred")}</label>
                  <Input
                    value={editForm.supplierPreferred ?? ""}
                    onChange={(event) => patchEditForm((prev) => ({ ...prev, supplierPreferred: event.target.value || null }))}
                    onBlur={() => persistDraftNowIfChanged(draftRef.current)}
                    className="h-9"
                    disabled={!canEdit}
                  />
                </div>

                <div>
                  <label className="text-xs text-muted-foreground">{t("procurement.detail.notes")}</label>
                  <Textarea
                    value={editForm.notes ?? ""}
                    onChange={(event) => patchEditForm((prev) => ({ ...prev, notes: event.target.value || null }))}
                    onBlur={() => persistDraftNowIfChanged(draftRef.current)}
                    rows={2}
                    className="text-sm"
                    disabled={!canEdit}
                  />
                </div>

                <div className="rounded-lg border border-border p-3 space-y-2">
                  <p className="text-sm font-medium text-foreground">{t("procurement.detail.attachments")}</p>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <Input
                      value={attachmentUrl}
                      onChange={(event) => setAttachmentUrl(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key !== "Enter") return;
                        event.preventDefault();
                        addUrlAttachment();
                      }}
                      placeholder={t("procurement.detail.attachmentPlaceholder")}
                      className="h-9 sm:flex-1"
                      disabled={!canEdit}
                    />
                    <Input
                      ref={filePickerRef}
                      type="file"
                      multiple
                      className="hidden"
                      onChange={(event) => {
                        addLocalAttachments(event.target.files);
                        event.currentTarget.value = "";
                      }}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      className="h-9 w-full sm:w-auto"
                      onClick={() => filePickerRef.current?.click()}
                      disabled={!canEdit}
                    >
                      {t("procurement.action.addFile")}
                    </Button>
                  </div>

                  {(editForm.attachments ?? []).length > 0 ? (
                    <div className="space-y-2">
                      {(editForm.attachments ?? []).map((attachment) => (
                        <div key={attachment.id} className="rounded-md bg-muted/40 p-2 text-xs">
                          <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-foreground">{attachmentDisplayName(attachment)}</p>
                              {attachment.isLocal && (
                                <span className="inline-flex mt-1 rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                                  {t("procurement.detail.attachmentLocal")}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-3 shrink-0">
                              <a href={attachment.url} target="_blank" rel="noreferrer" className="text-accent hover:underline">
                                {t("common.open")}
                              </a>
                              <button
                                type="button"
                                className="text-muted-foreground hover:text-destructive"
                                onClick={() => removeAttachment(attachment.id)}
                                disabled={!canEdit}
                              >
                                {t("common.remove")}
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">{t("procurement.detail.noAttachments")}</p>
                  )}
                </div>

                <div className="rounded-lg border border-border p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium text-foreground">{t("procurement.detail.fulfillment")}</p>
                    {canLaunchOrderFlows && (
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => openCreateOrder([detailItem.id])}
                        disabled={!canEdit || shouldBlockProcurementLaunchActions}
                      >
                        {t("procurement.action.createOrder")}
                      </Button>
                    )}
                  </div>
                  {(relatedOrdersByItemId.get(detailItem.id) ?? []).length > 0 ? (
                    <div className="space-y-2">
                      {(relatedOrdersByItemId.get(detailItem.id) ?? []).map((order) => {
                        const line = order.lines.find((entry) => entry.procurementItemId === detailItem.id);
                        if (!line) return null;
                        const qtyInfo = order.kind === "supplier"
                          ? `${line.receivedQty}/${line.qty} ${line.unit}`
                          : `${line.qty} ${line.unit}`;
                        return (
                          <div
                            key={`${order.id}-${line.id}`}
                            className="w-full rounded-md border border-border p-2 text-left"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="min-w-0">
                                <p className="text-xs font-medium text-foreground truncate">
                                  {order.kind === "supplier" ? (order.supplierName || t("procurement.order.supplierFallback")) : t("procurement.order.stockAllocation")}
                                </p>
                                <p className="text-[11px] text-muted-foreground truncate">
                                  {order.kind === "supplier"
                                    ? t("procurement.location.to", { location: locations.find((location) => location.id === order.deliverToLocationId)?.name ?? dash })
                                    : t("procurement.location.fromTo", { from: locations.find((location) => location.id === order.fromLocationId)?.name ?? dash, to: locations.find((location) => location.id === (order.toLocationId ?? order.deliverToLocationId))?.name ?? dash })}
                                </p>
                              </div>
                              <div className="text-right shrink-0">
                                <StatusBadge status={orderStatusLabel(order.status, t)} variant="procurement" className="text-[10px]" />
                                <p className="text-[11px] text-muted-foreground mt-1">{qtyInfo}</p>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">{t("procurement.detail.noRelatedOrders")}</p>
                  )}
                </div>

                {detailItem.linkedTaskIds.length > 0 && (
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">{t("procurement.detail.linkedTasks")}</label>
                    <div className="space-y-1">
                      {detailItem.linkedTaskIds.map((taskId) => {
                        const task = getTask(taskId);
                        return (
                          <button
                            key={taskId}
                            type="button"
                            onClick={() => {
                              persistListState({ scrollY: window.scrollY });
                              navigate(`/project/${pid}/tasks`, { state: { openTaskId: taskId } });
                            }}
                            className="flex items-center gap-1.5 text-xs text-accent hover:underline"
                          >
                            <Link2 className="h-3 w-3" />
                            {task?.title ?? t("procurement.detail.taskUnavailable")}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          <DialogFooter className="border-t border-border px-4 py-3 sm:px-6">
            <Button type="button" variant="outline" onClick={closeDetail}>{t("common.close")}</Button>
            {detailItem && canPersistProcurementDetail && (
              <Button
                type="button"
                onClick={async () => {
                  clearAutosaveTimer();
                  if (!supabaseMode) {
                    persistDraftNowIfChanged(draftRef.current);
                    toast({ title: t("procurement.toast.saved") });
                    return;
                  }
                  if (detailMutationInFlightRef.current) return;
                  // Persist only the fields the user actually changed, not the whole draft, so a
                  // finance-restricted member (whose detail fields load as null) cannot null out
                  // values they cannot see, and an unedited derived price is not promoted to manual.
                  const patch = diffProcurementItemPatch(detailItem, draftRef.current);
                  if (Object.keys(patch).length === 0) {
                    toast({ title: t("procurement.toast.saved") });
                    return;
                  }
                  detailMutationInFlightRef.current = true;
                  try {
                    const source = await getProcurementSource(supabaseMode);
                    await source.updateProjectProcurementItem(detailItem.id, patch);
                    await queryClient.invalidateQueries({
                      queryKey: procurementProjectItemsQueryRoot(supabaseMode.profileId, pid),
                    });
                    toast({ title: t("procurement.toast.saved") });
                  } catch (error) {
                    console.error("Failed to persist procurement item edit", error);
                    toast({
                      title: t("procurement.toast.saveFailed"),
                      description: t("procurement.toast.receiveFallback"),
                      variant: "destructive",
                    });
                  } finally {
                    detailMutationInFlightRef.current = false;
                  }
                }}
              >
                {t("procurement.action.save")}
              </Button>
            )}
            {detailItem && canPersistProcurementDetail && !detailItem.lockedFromEstimate && (
              <Button
                type="button"
                variant="ghost"
                className="text-destructive hover:text-destructive"
                onClick={async () => {
                  if (!supabaseMode) {
                    archiveProcurementItem(detailItem.id);
                    toast({ title: t("procurement.toast.itemArchived") });
                    closeDetail();
                    return;
                  }
                  if (detailMutationInFlightRef.current) return;
                  detailMutationInFlightRef.current = true;
                  try {
                    const source = await getProcurementSource(supabaseMode);
                    await source.cancelProcurementItem(detailItem.id);
                    await queryClient.invalidateQueries({
                      queryKey: procurementProjectItemsQueryRoot(supabaseMode.profileId, pid),
                    });
                    toast({ title: t("procurement.toast.itemArchived") });
                    closeDetail();
                  } catch (error) {
                    console.error("Failed to archive procurement item", error);
                    toast({
                      title: t("procurement.toast.archiveFailed"),
                      description: t("procurement.toast.receiveFallback"),
                      variant: "destructive",
                    });
                  } finally {
                    detailMutationInFlightRef.current = false;
                  }
                }}
              >
                {t("procurement.action.archive")}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
