import { useQueryClient } from "@tanstack/react-query";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { CalendarIcon, Loader2, Save, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { getOrdersSource } from "@/data/orders-source";
import { trackEvent } from "@/lib/analytics";
import { DOCUMENT_UPLOAD_ACCEPT } from "@/lib/document-file-types";
import { useProcurementV2 } from "@/hooks/use-mock-data";
import {
  useAllProjectsLocations,
  useHomeInventorySnapshot,
  useInventoryStock,
  useLocations,
} from "@/hooks/use-inventory-data";
import { inventoryQueryKeys } from "@/hooks/use-inventory-data";
import { useWorkspaceProjectsCanUseStockMap } from "@/hooks/use-home-sensitive-detail-map";
import {
  orderPlacedSupplierOrdersQueryRoot,
  orderProjectOrdersQueryRoot,
  orderQueryKeys,
  useOrders,
} from "@/hooks/use-order-data";
import { procurementProjectItemsQueryRoot } from "@/hooks/use-procurement-source";
import { computeRemainingRequestedQty, toInventoryKey } from "@/lib/procurement-fulfillment";
import { fmtCost } from "@/lib/procurement-utils";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import {
  type CrossProjectLocationGroup,
  GroupedLocationPicker,
  LocationPicker,
} from "@/components/procurement/LocationPicker";
import type { OrderKind, ProcurementItemType } from "@/types/entities";
import { useWorkspaceMode, useWorkspaceProjectsState } from "@/hooks/use-workspace-source";
import { useEstimateV2Project } from "@/hooks/use-estimate-v2-data";
import {
  isProcurementResourceLineType,
  projectToProcurementItemType,
  resourceLineTypeToPersisted,
} from "@/lib/estimate-v2/resource-type-contract";

/**
 * Supplier names are free-text and can be a natural person (ИП), so the raw
 * name must not leave the client as an analytics property (152-ФЗ). We send a
 * stable, non-reversible fingerprint instead: the first 8 hex chars of the
 * SHA-256 of the trimmed name. Enough to group orders by supplier in funnels
 * without ever transmitting the name. Returns null for an empty name or when
 * SubtleCrypto is unavailable (e.g. a non-secure context).
 */
async function hashSupplierName(name: string | null | undefined): Promise<string | null> {
  const trimmed = name?.trim();
  if (!trimmed) return null;
  if (typeof crypto === "undefined" || !crypto.subtle) return null;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(trimmed));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 8);
}

interface OrderModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  initialItemIds: string[];
  showSensitiveDetail?: boolean;
  onCompleted?: (orderId: string) => void;
}

interface DraftLineState {
  procurementItemId: string;
  qty: number;
  unit: string;
  plannedUnitPrice: number | null;
  actualUnitPrice: number | null;
}

function isValidActualUnitPrice(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/** Set true to show Save draft in the footer (draft-only flow is not in MVP). */
const SHOW_ORDER_SAVE_DRAFT_BUTTON = false;

export function OrderModal({
  open,
  onOpenChange,
  projectId,
  initialItemIds,
  showSensitiveDetail = true,
  onCompleted,
}: OrderModalProps) {
  const { t } = useTranslation();
  const baseItems = useProcurementV2(projectId);
  const orders = useOrders(projectId);
  const locations = useLocations(projectId);
  const workspaceMode = useWorkspaceMode();
  const supabaseMode = workspaceMode.kind === "supabase" ? workspaceMode : null;
  const isSupabaseMode = workspaceMode.kind === "supabase";
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const estimateState = useEstimateV2Project(projectId);
  // Cross-project transfer destination data (supabase-only; the source stays this project).
  const { projects: workspaceProjects } = useWorkspaceProjectsState();
  const { locationsByProjectId } = useAllProjectsLocations();
  const { canUseStockByProjectId } = useWorkspaceProjectsCanUseStockMap();
  // Stock across all projects, for the per-location availability shown in the source picker.
  const inventorySnapshot = useHomeInventorySnapshot();

  const items = useMemo(() => {
    const nowIso = new Date().toISOString();
    const workById = new Map(estimateState.works.map((work) => [work.id, work]));
    const lineById = new Map(estimateState.lines.map((line) => [line.id, line]));

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
      const derivedType = line.type === "tool" ? "tool" : "material";
      const requiredQty = Math.max(0, line.qtyMilli / 1_000);
      const plannedUnitPrice = Math.max(0, line.costUnitCents / 100);

      return {
        ...item,
        stageId: resolvedStageId,
        type: derivedType,
        name: line.title,
        unit: line.unit,
        requiredByDate,
        requiredQty,
        plannedUnitPrice,
      };
    });

    if (isSupabaseMode) return derivedItems;

    const linkedLineIds = new Set(
      derivedItems
        .map((it) => it.sourceEstimateV2LineId ?? null)
        .filter((lineId): lineId is string => !!lineId),
    );

    const missingDerivedItems: typeof derivedItems = estimateState.lines
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
        };
      });

    return [...derivedItems, ...missingDerivedItems];
  }, [baseItems, estimateState.lines, estimateState.works, estimateState.stages, isSupabaseMode]);

  const [kind, setKind] = useState<OrderKind>("supplier");
  const [supplierName, setSupplierName] = useState("");
  const [deliverToLocationId, setDeliverToLocationId] = useState("");
  const [fromLocationId, setFromLocationId] = useState("");
  const [toLocationId, setToLocationId] = useState("");
  // Transfer SOURCE project (where the stock is pulled FROM); defaults to the current project
  // (a same-project move). The destination is always the current project A — you are fulfilling
  // its procurement — so only the source varies across projects. The source's on-hand stock
  // drives availability and the from_item_id.
  const [fromProjectId, setFromProjectId] = useState(projectId);
  const sourceStock = useInventoryStock(fromProjectId);
  const [deliveryDeadline, setDeliveryDeadline] = useState<Date | undefined>(undefined);
  const [invoiceAttachment, setInvoiceAttachment] = useState<{ name: string; url: string } | null>(null);
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<DraftLineState[]>([]);
  const [orderActionInFlight, setOrderActionInFlight] = useState<null | "draft" | "place">(null);
  const orderActionInFlightRef = useRef<null | "draft" | "place">(null);

  const itemById = useMemo(
    () => new Map(items.map((item) => [item.id, item])),
    [items],
  );
  const defaultLocationId = useMemo(
    () => locations.find((location) => location.isDefault)?.id ?? locations[0]?.id ?? "",
    [locations],
  );
  /**
   * Available qty at the source warehouse, keyed by inventoryKey. The key matches
   * `toInventoryKey(item)` so the availability guard reads the SAME balance that the
   * transfer mutates (the supabase transfer resolves its inventory_item by the same key).
   */
  const availableByInventoryKey = useMemo(() => {
    const map = new Map<string, number>();
    sourceStock
      .filter((row) => row.locationId === fromLocationId)
      .forEach((row) => {
        map.set(row.inventoryKey, (map.get(row.inventoryKey) ?? 0) + row.qty);
      });
    return map;
  }, [sourceStock, fromLocationId]);

  /**
   * Source inventory_item id per inventoryKey at the source location. Passed as `from_item_id`
   * so the RPC resolves the exact source item rather than re-matching by identity.
   */
  const sourceItemIdByInventoryKey = useMemo(() => {
    const map = new Map<string, string>();
    sourceStock
      .filter((row) => row.locationId === fromLocationId && row.inventoryItemId)
      .forEach((row) => {
        if (!map.has(row.inventoryKey)) map.set(row.inventoryKey, row.inventoryItemId as string);
      });
    return map;
  }, [sourceStock, fromLocationId]);

  /** A different SOURCE project means a cross-project transfer (supabase-only). */
  const isCrossProject = isSupabaseMode && fromProjectId !== "" && fromProjectId !== projectId;

  const sourceProjectTitle = useMemo(
    () => workspaceProjects.find((p) => p.id === fromProjectId)?.title ?? "",
    [workspaceProjects, fromProjectId],
  );

  /**
   * Source location groups for the picker: the current project first (a same-project move), then
   * other projects the user can use stock in (owner/co-owner or full financial access). Demo/local
   * offers only the current project (cross-project transfer is supabase-only).
   */
  const sourceGroups = useMemo((): CrossProjectLocationGroup[] => {
    const current: CrossProjectLocationGroup = {
      projectId,
      projectTitle: workspaceProjects.find((p) => p.id === projectId)?.title ?? "",
      isCurrent: true,
      locations: locationsByProjectId.get(projectId) ?? locations,
    };
    if (!isSupabaseMode) return [current];
    const others = workspaceProjects
      .filter((p) => p.id !== projectId && canUseStockByProjectId.get(p.id))
      .map(
        (p): CrossProjectLocationGroup => ({
          projectId: p.id,
          projectTitle: p.title,
          isCurrent: false,
          locations: locationsByProjectId.get(p.id) ?? [],
        }),
      );
    return [current, ...others];
  }, [
    projectId,
    locationsByProjectId,
    locations,
    isSupabaseMode,
    workspaceProjects,
    canUseStockByProjectId,
  ]);

  // Seed the draft only on open and when the requested item SET changes, never on a
  // background procurement refetch (which gives items/itemById fresh identities). Without
  // this guard a sync mid-edit re-runs this effect and clobbers the qty/price the user typed.
  const seededKeyRef = useRef<string | null>(null);
  const seedKey = open ? initialItemIds.join(",") : null;
  useEffect(() => {
    if (!open) {
      seededKeyRef.current = null;
      return;
    }
    if (seededKeyRef.current === seedKey) return;

    const nextItemIds = initialItemIds.length > 0
      ? initialItemIds
      : items.map((item) => item.id);

    const nextLines = nextItemIds
      .map((itemId) => {
        const item = itemById.get(itemId);
        if (!item) return null;
        const remaining = computeRemainingRequestedQty(item, orders);
        if (remaining <= 0) return null;
        return {
          procurementItemId: item.id,
          qty: remaining,
          unit: item.unit,
          plannedUnitPrice: item.plannedUnitPrice,
          actualUnitPrice: item.actualUnitPrice,
        } satisfies DraftLineState;
      })
      .filter((line): line is DraftLineState => !!line);

    setKind("supplier");
    setSupplierName("");
    setDeliverToLocationId(isSupabaseMode ? "" : defaultLocationId);
    setFromLocationId(defaultLocationId);
    setToLocationId(defaultLocationId);
    setFromProjectId(projectId);
    setDeliveryDeadline(undefined);
    setInvoiceAttachment(null);
    setNote("");
    setLines(nextLines);
    seededKeyRef.current = seedKey;
  }, [open, seedKey, initialItemIds, itemById, items, orders, defaultLocationId, isSupabaseMode, projectId]);

  const requestedRemainingByItemId = useMemo(() => (
    new Map(lines.map((line) => [line.procurementItemId, computeRemainingRequestedQty(itemById.get(line.procurementItemId), orders)]))
  ), [lines, itemById, orders]);

  const orderedLines = useMemo(() => lines.filter((line) => line.qty > 0), [lines]);
  const hasOrderedLines = orderedLines.length > 0;
  const allOrderedLinesHaveValidActualPrices = orderedLines.every((line) => isValidActualUnitPrice(line.actualUnitPrice));
  // Actual price is required only for supplier orders; a stock transfer moves on-hand qty.
  const canPlaceOrder = hasOrderedLines
    && (kind === "stock" || allOrderedLinesHaveValidActualPrices);

  /**
   * Per-source-location availability of the ordered materials, keyed `${projectId}:${locationId}`.
   * A single-line order shows "<qty> <unit>"; a multi-line order shows how many of the ordered
   * items the location can supply ("<n>/<m>"). A location with NONE of the ordered materials is
   * disabled in the source picker. (The submit guard still validates exact quantities.)
   */
  const orderedAvailabilitySpecs = useMemo(
    () =>
      orderedLines
        .map((line) => {
          const item = itemById.get(line.procurementItemId);
          if (!item) return null;
          return { key: toInventoryKey(item), unit: line.unit };
        })
        .filter((spec): spec is { key: string; unit: string } => spec != null),
    [orderedLines, itemById],
  );
  const stockQtyByProjectLocationKey = useMemo(() => {
    const map = new Map<string, number>();
    for (const project of inventorySnapshot.projects) {
      for (const row of project.rows) {
        const key = `${project.projectId}:${row.locationId}:${row.inventoryKey}`;
        map.set(key, (map.get(key) ?? 0) + row.qty);
      }
    }
    return map;
  }, [inventorySnapshot.projects]);
  const sourceLocationAvailability = useMemo(() => {
    const map = new Map<string, { label: string; disabled: boolean }>();
    if (inventorySnapshot.isLoading || orderedAvailabilitySpecs.length === 0) return map;
    for (const group of sourceGroups) {
      for (const loc of group.locations) {
        let availableCount = 0;
        let firstQty = 0;
        orderedAvailabilitySpecs.forEach((spec, index) => {
          const qty = stockQtyByProjectLocationKey.get(`${group.projectId}:${loc.id}:${spec.key}`) ?? 0;
          if (qty > 0) availableCount += 1;
          if (index === 0) firstQty = qty;
        });
        const label =
          orderedAvailabilitySpecs.length === 1
            ? `${firstQty.toLocaleString("ru-RU")} ${orderedAvailabilitySpecs[0].unit}`
            : `${availableCount}/${orderedAvailabilitySpecs.length}`;
        map.set(`${group.projectId}:${loc.id}`, { label, disabled: availableCount === 0 });
      }
    }
    return map;
  }, [inventorySnapshot.isLoading, orderedAvailabilitySpecs, sourceGroups, stockQtyByProjectLocationKey]);

  const saveOrder = async (action: "draft" | "place") => {
    if (orderActionInFlightRef.current) return;
    const positiveLines = lines.filter((line) => line.qty > 0);

    if (positiveLines.length === 0) {
      toast({ title: t("procurement.orderModal.toast.noLines"), description: t("procurement.orderModal.toast.noLinesDesc"), variant: "destructive" });
      return;
    }
    if (action === "place" && kind === "supplier" && !allOrderedLinesHaveValidActualPrices) {
      toast({ title: t("procurement.orderModal.toast.actualPriceRequired"), description: t("procurement.orderModal.toast.actualPriceRequiredDesc"), variant: "destructive" });
      return;
    }

    if (kind === "stock" && !fromLocationId) {
      toast({ title: t("procurement.orderModal.toast.fromRequired"), variant: "destructive" });
      return;
    }
    if (kind === "stock" && !toLocationId) {
      toast({ title: t("procurement.orderModal.toast.toRequired"), variant: "destructive" });
      return;
    }
    if (kind === "stock" && fromProjectId === projectId && fromLocationId === toLocationId) {
      toast({ title: t("procurement.orderModal.toast.sameLocation"), variant: "destructive" });
      return;
    }

    orderActionInFlightRef.current = action;
    setOrderActionInFlight(action);
    try {
    if (kind === "stock") {
      for (const line of positiveLines) {
        const item = itemById.get(line.procurementItemId);
        if (!item) continue;
        const available = availableByInventoryKey.get(toInventoryKey(item)) ?? 0;
        if (line.qty > available) {
          toast({
            title: t("procurement.orderModal.toast.notEnoughStock"),
            description: t("procurement.orderModal.toast.notEnoughStockDesc", { name: item.name, available, unit: item.unit }),
            variant: "destructive",
          });
          return;
        }
      }

      try {
        const source = await getOrdersSource(supabaseMode ?? undefined);

        if (isCrossProject && supabaseMode) {
          const result = await source.placeCrossProjectStockTransfer({
            fromProjectId,
            toProjectId: projectId,
            fromLocationId,
            toLocationId,
            deliveryDeadline: deliveryDeadline?.toISOString() ?? null,
            lines: positiveLines.map((line) => {
              const item = itemById.get(line.procurementItemId);
              const inventoryKey = item ? toInventoryKey(item) : "";
              return {
                fromItemId: sourceItemIdByInventoryKey.get(inventoryKey) ?? null,
                procurementItemId: line.procurementItemId,
                title: item?.name ?? t("procurement.orderModal.untitledItem"),
                unit: line.unit,
                sku: null,
                spec: item?.spec ?? null,
                itemType: item?.type ?? null,
                qty: line.qty,
                actualUnitPrice: line.actualUnitPrice,
              };
            }),
          });

          trackEvent("procurement_order_placed", {
            project_id: projectId,
            kind: "stock_cross_project",
            line_count: positiveLines.length,
          });

          // Refresh BOTH projects' orders / procurement / inventory caches so each side reflects
          // the move.
          await Promise.all([
            ...[projectId, fromProjectId].flatMap((pid) => [
              queryClient.invalidateQueries({
                queryKey: orderProjectOrdersQueryRoot(supabaseMode.profileId, pid),
              }),
              queryClient.invalidateQueries({
                queryKey: orderPlacedSupplierOrdersQueryRoot(supabaseMode.profileId, pid),
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
            ]),
            queryClient.invalidateQueries({
              queryKey: orderQueryKeys.placedSupplierOrdersAllProjects(supabaseMode.profileId),
            }),
            queryClient.invalidateQueries({
              queryKey: orderQueryKeys.orderById(supabaseMode.profileId, result.fromOrderId),
            }),
            queryClient.invalidateQueries({
              queryKey: orderQueryKeys.orderById(supabaseMode.profileId, result.toOrderId),
            }),
          ]);

          toast({
            title: t("procurement.orderModal.toast.crossProjectPlaced"),
            description: t("procurement.orderModal.toast.crossProjectPlacedDesc"),
          });
          onCompleted?.(result.toOrderId);
          onOpenChange(false);
          return;
        }

        const created = await source.placeStockTransfer({
          projectId,
          fromLocationId,
          toLocationId,
          deliveryDeadline: deliveryDeadline?.toISOString() ?? null,
          note: note || null,
          lines: positiveLines.map((line) => {
            const item = itemById.get(line.procurementItemId);
            return {
              procurementItemId: line.procurementItemId,
              title: item?.name ?? t("procurement.orderModal.untitledItem"),
              qty: line.qty,
              unit: line.unit,
              spec: item?.spec ?? null,
              plannedUnitPrice: line.plannedUnitPrice,
              actualUnitPrice: line.actualUnitPrice,
            };
          }),
        });

        trackEvent("procurement_order_placed", { project_id: projectId, kind: "stock", line_count: positiveLines.length });

        if (supabaseMode) {
          await Promise.all([
            queryClient.invalidateQueries({
              queryKey: orderProjectOrdersQueryRoot(supabaseMode.profileId, projectId),
            }),
            queryClient.invalidateQueries({
              queryKey: orderPlacedSupplierOrdersQueryRoot(supabaseMode.profileId, projectId),
            }),
            queryClient.invalidateQueries({
              queryKey: orderQueryKeys.placedSupplierOrdersAllProjects(supabaseMode.profileId),
            }),
            queryClient.invalidateQueries({
              queryKey: orderQueryKeys.orderById(supabaseMode.profileId, created.id),
            }),
            queryClient.invalidateQueries({
              queryKey: procurementProjectItemsQueryRoot(supabaseMode.profileId, projectId),
            }),
            queryClient.invalidateQueries({
              queryKey: inventoryQueryKeys.projectLocations(supabaseMode.profileId, projectId),
            }),
            queryClient.invalidateQueries({
              queryKey: inventoryQueryKeys.projectStock(supabaseMode.profileId, projectId),
            }),
          ]);
        }

        toast({ title: t("procurement.orderModal.toast.stockCompleted") });
        onCompleted?.(created.id);
        onOpenChange(false);
      } catch (error) {
        const rawMessage =
          error instanceof Error
            ? error.message
            : typeof (error as { message?: unknown }).message === "string"
              ? (error as { message: string }).message
              : "";
        // A concurrent stock change can make the backend abort the paired transfer
        // with "Inventory balance cannot go negative ...". Surface the friendly
        // not-enough-stock message instead of the raw Postgres error (with UUIDs).
        if (rawMessage.includes("cannot go negative") || rawMessage.includes("Not enough stock")) {
          toast({
            title: t("procurement.orderModal.toast.notEnoughStock"),
            description: t("procurement.orderModal.toast.stockChangedDesc"),
            variant: "destructive",
          });
        } else {
          toast({
            title: t("procurement.orderModal.toast.unablePlace"),
            description: rawMessage || t("procurement.orderModal.toast.unablePlaceFallback"),
            variant: "destructive",
          });
        }
      }
      return;
    }

    try {
      const source = await getOrdersSource(supabaseMode ?? undefined);
      const created = await source.createDraftSupplierOrder({
        projectId,
        supplierName: supplierName || null,
        deliverToLocationId,
        deliveryDeadline: deliveryDeadline?.toISOString() ?? null,
        invoiceAttachment: invoiceAttachment
          ? {
            id: `invoice-${Date.now()}`,
            name: invoiceAttachment.name,
            url: invoiceAttachment.url,
            type: "file",
            isLocal: true,
            createdAt: new Date().toISOString(),
          }
          : null,
        note: note || null,
        lines: positiveLines.map((line) => ({
          procurementItemId: line.procurementItemId,
          title: itemById.get(line.procurementItemId)?.name ?? t("procurement.orderModal.untitledItem"),
          qty: line.qty,
          unit: line.unit,
          plannedUnitPrice: line.plannedUnitPrice,
          actualUnitPrice: line.actualUnitPrice,
        })),
      });

      let finalOrderId = created.id;
      const supplierHash = await hashSupplierName(supplierName);
      if (action === "place") {
        const placed = await source.placeSupplierOrder(created.id);
        finalOrderId = placed.id;
        trackEvent("procurement_order_placed", { project_id: projectId, kind: "supplier", supplier_hash: supplierHash, line_count: positiveLines.length });
      } else {
        trackEvent("procurement_order_draft_created", { project_id: projectId, kind: "supplier", supplier_hash: supplierHash, line_count: positiveLines.length });
      }

      if (supabaseMode) {
        await Promise.all([
          queryClient.invalidateQueries({
            queryKey: orderProjectOrdersQueryRoot(supabaseMode.profileId, projectId),
          }),
          queryClient.invalidateQueries({
            queryKey: orderPlacedSupplierOrdersQueryRoot(supabaseMode.profileId, projectId),
          }),
          queryClient.invalidateQueries({
            queryKey: orderQueryKeys.placedSupplierOrdersAllProjects(supabaseMode.profileId),
          }),
          queryClient.invalidateQueries({
            queryKey: orderQueryKeys.orderById(supabaseMode.profileId, finalOrderId),
          }),
          queryClient.invalidateQueries({
            queryKey: procurementProjectItemsQueryRoot(supabaseMode.profileId, projectId),
          }),
          queryClient.invalidateQueries({
            queryKey: inventoryQueryKeys.projectLocations(supabaseMode.profileId, projectId),
          }),
        ]);
      }

      toast({ title: action === "place" ? t("procurement.orderModal.toast.orderPlaced") : t("procurement.orderModal.toast.draftSaved") });
      onCompleted?.(finalOrderId);
      onOpenChange(false);
    } catch (error) {
      const description = error instanceof Error ? error.message : t("procurement.orderModal.toast.unablePlaceFallback");
      toast({
        title: action === "place" ? t("procurement.orderModal.toast.unablePlace") : t("procurement.orderModal.toast.unableDraft"),
        description,
        variant: "destructive",
      });
    }
    } finally {
      orderActionInFlightRef.current = null;
      setOrderActionInFlight(null);
    }
  };

  const totalAmount = allOrderedLinesHaveValidActualPrices
    ? orderedLines.reduce((sum, line) => sum + ((line.actualUnitPrice ?? 0) * line.qty), 0)
    : 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[96vw] max-w-5xl max-h-[92vh] p-0 gap-0 overflow-hidden flex flex-col">
        <DialogHeader className="px-5 py-3 border-b border-border">
          <DialogTitle>{t("procurement.orderModal.createTitle")}</DialogTitle>
        </DialogHeader>

        {!showSensitiveDetail ? (
          <>
            <div className="flex-1 px-5 py-3">
              <p className="text-sm text-muted-foreground">
                {t("procurement.orderModal.noSensitive")}
              </p>
            </div>
            <DialogFooter className="px-5 py-3 border-t border-border">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{t("common.close")}</Button>
            </DialogFooter>
          </>
        ) : (
        <>
        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-3">
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant={kind === "supplier" ? "default" : "outline"}
              onClick={() => setKind("supplier")}
              className={cn(kind === "supplier" && "bg-accent text-accent-foreground hover:bg-accent/90")}
            >
              {t("procurement.orderModal.kindSupplier")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant={kind === "stock" ? "default" : "outline"}
              onClick={() => setKind("stock")}
              className={cn(kind === "stock" && "bg-accent text-accent-foreground hover:bg-accent/90")}
            >
              {t("procurement.orderModal.kindStock")}
            </Button>
          </div>

          {kind === "supplier" ? (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">{t("procurement.orderModal.supplier")}</label>
                <Input value={supplierName} onChange={(event) => setSupplierName(event.target.value)} className="h-9" placeholder={t("procurement.orderModal.supplierPlaceholder")} />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">{t("procurement.orderModal.deliverTo")}</label>
                <LocationPicker
                  projectId={projectId}
                  value={deliverToLocationId}
                  onChange={setDeliverToLocationId}
                  className="h-9"
                  placeholder={t("procurement.locationPicker.placeholder")}
                />
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">{t("procurement.orderModal.fromLocation")}</label>
                {isSupabaseMode ? (
                  <GroupedLocationPicker
                    groups={sourceGroups}
                    value={fromLocationId ? { projectId: fromProjectId, locationId: fromLocationId } : null}
                    onChange={(selection) => {
                      setFromProjectId(selection.projectId);
                      setFromLocationId(selection.locationId);
                    }}
                    availability={sourceLocationAvailability}
                    className="h-9"
                  />
                ) : (
                  <LocationPicker projectId={projectId} value={fromLocationId} onChange={setFromLocationId} className="h-9" />
                )}
                {isCrossProject && sourceProjectTitle && (
                  <p className="text-xs text-primary">
                    {t("procurement.orderModal.fromProject", { project: sourceProjectTitle })}
                  </p>
                )}
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">{t("procurement.orderModal.toLocation")}</label>
                <LocationPicker projectId={projectId} value={toLocationId} onChange={setToLocationId} className="h-9" />
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">{t("procurement.orderModal.deliveryDate")}</label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-full justify-start h-9 text-left font-normal">
                    <CalendarIcon className="h-4 w-4 mr-2" />
                    {deliveryDeadline ? deliveryDeadline.toLocaleDateString() : t("procurement.orderModal.setDate")}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={deliveryDeadline} onSelect={setDeliveryDeadline} initialFocus />
                </PopoverContent>
              </Popover>
            </div>

            <div className="space-y-1">
              <label className="text-xs text-muted-foreground" htmlFor="order-invoice-input">{t("procurement.orderModal.invoiceAttachment")}</label>
              <div className="flex items-center gap-2">
                <input
                  id="order-invoice-input"
                  type="file"
                  accept={DOCUMENT_UPLOAD_ACCEPT}
                  className="sr-only"
                  aria-label={t("procurement.orderModal.invoiceAria")}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (!file) {
                      setInvoiceAttachment(null);
                      return;
                    }
                    setInvoiceAttachment({
                      name: file.name,
                      url: URL.createObjectURL(file),
                    });
                    event.currentTarget.value = "";
                  }}
                />
                <label
                  htmlFor="order-invoice-input"
                  className="inline-flex h-9 flex-1 cursor-pointer items-center justify-start gap-2 rounded-md border border-input bg-background px-3 text-sm hover:bg-accent hover:text-accent-foreground"
                >
                  <span className="truncate text-foreground">
                    {invoiceAttachment ? invoiceAttachment.name : t("procurement.orderModal.invoiceChoose")}
                  </span>
                </label>
                {invoiceAttachment && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-9 px-2"
                    onClick={() => setInvoiceAttachment(null)}
                    aria-label={t("procurement.orderModal.invoiceClear")}
                  >
                    {t("common.clear")}
                  </Button>
                )}
              </div>
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">{t("procurement.orderModal.note")}</label>
            <Input
              value={note}
              onChange={(event) => setNote(event.target.value)}
              className="h-9"
              placeholder={t("procurement.orderModal.notePlaceholder")}
            />
          </div>

          <div className="rounded-lg border border-border overflow-x-auto">
            <table className="w-full table-fixed text-sm">
              <colgroup>
                <col />
                <col className="w-[132px]" />
                <col className="w-[96px]" />
                <col className="w-[140px]" />
                <col className="w-[192px]" />
                {kind === "stock" && <col className="w-[136px]" />}
              </colgroup>
              <thead className="bg-muted/30 border-b border-border">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">{t("procurement.orderModal.colItem")}</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">{t("procurement.orderModal.colQty")}</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">{t("procurement.orderModal.colUnit")}</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">{t("procurement.orderModal.colPlanned")}</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">{t("procurement.orderModal.colFactual")}</th>
                  {kind === "stock" && <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">{t("procurement.orderModal.colAvailable")}</th>}
                </tr>
              </thead>
              <tbody>
                {lines.map((line) => {
                  const item = itemById.get(line.procurementItemId);
                  if (!item) return null;
                  const available = kind === "stock"
                    ? availableByInventoryKey.get(toInventoryKey(item)) ?? 0
                    : 0;
                  const requestedRemaining = requestedRemainingByItemId.get(line.procurementItemId) ?? 0;
                  const remainingAfterThisOrder = Math.max(requestedRemaining - line.qty, 0);
                  const showUnderOrderWarning = remainingAfterThisOrder > 0;
                  const underOrderMessage = deliveryDeadline
                    ? t("procurement.orderModal.underOrderBy", { count: remainingAfterThisOrder, date: deliveryDeadline.toLocaleDateString() })
                    : t("procurement.orderModal.underOrder", { count: remainingAfterThisOrder });
                  const actualPriceInvalid = kind === "supplier" && line.qty > 0 && !isValidActualUnitPrice(line.actualUnitPrice);
                  const showFeedback = showUnderOrderWarning || actualPriceInvalid;

                  return (
                    <Fragment key={line.procurementItemId}>
                      <tr className={cn("align-middle", !showFeedback && "border-b border-border/70")}>
                        <td className="px-3 py-2 align-middle">
                          <p className="font-medium text-foreground truncate">{item.name}</p>
                          {item.spec && <p className="text-xs text-muted-foreground truncate">{item.spec}</p>}
                        </td>
                        <td className="px-3 py-2 align-middle">
                          <Input
                            type="number"
                            min="0"
                            value={line.qty}
                            onChange={(event) => {
                              const qty = Math.max(0, Number(event.target.value));
                              setLines((prev) => prev.map((entry) => (
                                entry.procurementItemId === line.procurementItemId
                                  ? { ...entry, qty }
                                : entry
                              )));
                            }}
                            className="h-8 text-right"
                          />
                        </td>
                        <td className="px-3 py-2 align-middle">
                          <span className="text-sm text-foreground">{line.unit}</span>
                        </td>
                        <td className="px-3 py-2 text-right align-middle">
                          <span className="text-sm tabular-nums text-foreground whitespace-nowrap">
                            {line.plannedUnitPrice == null ? "—" : fmtCost(line.plannedUnitPrice)}
                          </span>
                        </td>
                        <td className="px-3 py-2 align-middle">
                          <Input
                            type="number"
                            min="0"
                            step="0.01"
                            value={line.actualUnitPrice ?? ""}
                            onChange={(event) => {
                              const value = event.target.value ? Number(event.target.value) : null;
                              setLines((prev) => prev.map((entry) => (
                                entry.procurementItemId === line.procurementItemId
                                  ? { ...entry, actualUnitPrice: value }
                                  : entry
                              )));
                            }}
                            className={cn(
                              "h-8 text-right",
                              actualPriceInvalid && "border-destructive focus-visible:ring-destructive/40",
                            )}
                            aria-invalid={actualPriceInvalid}
                          />
                        </td>
                        {kind === "stock" && (
                          <td className={cn(
                            "px-3 py-2 align-middle text-right text-xs",
                            line.qty > available ? "text-destructive" : "text-muted-foreground",
                          )}
                          >
                            {available} {line.unit}
                          </td>
                        )}
                      </tr>
                      {showFeedback && (
                        <tr className="border-b border-border/70">
                          <td className="px-3 pb-2 pt-0" />
                          <td className="px-3 pb-2 pt-0 text-right text-[11px] leading-4 text-destructive">
                            {showUnderOrderWarning ? underOrderMessage : ""}
                          </td>
                          <td className="px-3 pb-2 pt-0" />
                          <td className="px-3 pb-2 pt-0" />
                          <td className="px-3 pb-2 pt-0 text-right text-[11px] leading-4 text-destructive">
                            {actualPriceInvalid ? t("procurement.orderModal.actualRequired") : ""}
                          </td>
                          {kind === "stock" && <td className="px-3 pb-2 pt-0" />}
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <DialogFooter className="px-5 py-3 border-t border-border">
          <div className="mr-auto text-sm text-muted-foreground">{t("procurement.orderModal.total", { amount: fmtCost(totalAmount) })}</div>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{t("common.close")}</Button>
          {SHOW_ORDER_SAVE_DRAFT_BUTTON ? (
            <Button
              type="button"
              variant="secondary"
              onClick={() => saveOrder("draft")}
              disabled={!hasOrderedLines || !!orderActionInFlight}
            >
              {orderActionInFlight === "draft"
                ? <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                : <Save className="h-4 w-4 mr-1" />}
              {orderActionInFlight === "draft" ? t("procurement.orderModal.saving") : t("procurement.orderModal.saveDraft")}
            </Button>
          ) : null}
          <Button
            type="button"
            onClick={() => saveOrder("place")}
            disabled={!canPlaceOrder || !!orderActionInFlight}
          >
            {orderActionInFlight === "place"
              ? <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              : <Send className="h-4 w-4 mr-1" />}
            {orderActionInFlight === "place" ? t("procurement.orderModal.placing") : t("procurement.orderModal.placeOrder")}
          </Button>
        </DialogFooter>
        </>
        )}
      </DialogContent>
    </Dialog>
  );
}
