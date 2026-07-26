import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cancelDraftOrder, voidOrder } from "@/data/order-store";
import { useOrderState } from "@/hooks/use-order-data";
import { useProcurementV2 } from "@/hooks/use-mock-data";
import { useLocations } from "@/hooks/use-inventory-data";
import { useReceiveCrossProjectTransfer } from "@/hooks/use-cross-project-transfer";
import { useToast } from "@/hooks/use-toast";
import { useWorkspaceMode, useWorkspaceProjectsState } from "@/hooks/use-workspace-source";
import { isOpenOrderStatus } from "@/lib/procurement-fulfillment";
import { fmtCost } from "@/lib/procurement-utils";
import { StatusBadge } from "@/components/StatusBadge";
import { Skeleton } from "@/components/ui/skeleton";
import { ReceiveOrderModal } from "@/components/procurement/ReceiveOrderModal";

interface OrderDetailModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  orderId: string;
  showSensitiveDetail?: boolean;
  onOpenRequest?: (requestId: string) => void;
}

type Translator = (key: string, options?: Record<string, unknown>) => string;

function orderStatusLabel(status: "draft" | "placed" | "partially_received" | "received" | "voided", t: Translator) {
  if (status === "draft") return t("procurement.orderStatus.draft");
  if (status === "placed") return t("procurement.orderStatus.ordered");
  if (status === "partially_received") return t("procurement.orderStatus.partiallyReceived");
  if (status === "voided") return t("procurement.orderStatus.voided");
  return t("procurement.orderStatus.inStock");
}

export function OrderDetailModal({
  open,
  onOpenChange,
  projectId,
  orderId,
  showSensitiveDetail = true,
  onOpenRequest,
}: OrderDetailModalProps) {
  const { t } = useTranslation();
  const { order, isLoading: isOrderLoading } = useOrderState(orderId);
  const items = useProcurementV2(projectId);
  const locations = useLocations(projectId);
  const workspaceMode = useWorkspaceMode();
  const isSupabaseMode = workspaceMode.kind === "supabase";
  const [receiveOpen, setReceiveOpen] = useState(false);
  const { toast } = useToast();
  const { projects: workspaceProjects } = useWorkspaceProjectsState();
  const { receive: receiveCrossProjectTransfer, receivingId } = useReceiveCrossProjectTransfer();

  const itemById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const locationById = useMemo(() => new Map(locations.map((location) => [location.id, location])), [locations]);

  // For a received cross-project transfer, the delivery date shown must be the FACTUAL receipt
  // date (from the receive movements), not the expected ETA which would be misleading afterwards.
  const deliveryDisplay = useMemo(() => {
    if (!order) return null;
    if (order.transferDirection && order.status === "received") {
      const receivedAt = (order.receiveEvents ?? []).reduce<string | null>((latest, event) => {
        if (!event.createdAt) return latest;
        if (!latest) return event.createdAt;
        return new Date(event.createdAt).getTime() > new Date(latest).getTime() ? event.createdAt : latest;
      }, null);
      return receivedAt ?? order.updatedAt;
    }
    return order.deliveryDeadline ?? null;
  }, [order]);

  const total = useMemo(() => {
    if (!order) return 0;
    return order.lines.reduce((sum, line) => {
      const fallback = itemById.get(line.procurementItemId);
      const unitPrice = line.actualUnitPrice
        ?? line.plannedUnitPrice
        ?? fallback?.actualUnitPrice
        ?? fallback?.plannedUnitPrice
        ?? 0;
      return sum + unitPrice * line.qty;
    }, 0);
  }, [order, itemById]);

  const plannedTotal = useMemo(() => {
    if (!order) return 0;
    return order.lines.reduce((sum, line) => {
      const fallback = itemById.get(line.procurementItemId);
      const plannedUnit = line.plannedUnitPrice
        ?? fallback?.plannedUnitPrice
        ?? 0;
      return sum + plannedUnit * line.qty;
    }, 0);
  }, [order, itemById]);

  const factualTotal = useMemo(() => {
    if (!order) return 0;
    return order.lines.reduce((sum, line) => {
      const fallback = itemById.get(line.procurementItemId);
      const factualUnit = line.actualUnitPrice
        ?? fallback?.actualUnitPrice
        ?? line.plannedUnitPrice
        ?? fallback?.plannedUnitPrice
        ?? 0;
      return sum + factualUnit * line.qty;
    }, 0);
  }, [order, itemById]);

  const onCancelDraft = () => {
    if (!order) return;
    const result = cancelDraftOrder(order.id);
    if (!result.ok) {
      toast({ title: t("procurement.orderDetail.unableCancelDraft"), description: result.error, variant: "destructive" });
      return;
    }
    toast({ title: t("procurement.orderDetail.draftCancelled") });
  };

  const onVoidOrder = () => {
    if (!order) return;
    const result = voidOrder(order.id);
    if (!result.ok) {
      toast({ title: t("procurement.orderDetail.unableVoid"), description: result.error, variant: "destructive" });
      return;
    }
    toast({ title: t("procurement.orderDetail.orderVoided") });
  };

  const counterpartyProjectTitle = useMemo(
    () =>
      order?.counterpartyProjectId
        ? workspaceProjects.find((p) => p.id === order.counterpartyProjectId)?.title ?? ""
        : "",
    [order?.counterpartyProjectId, workspaceProjects],
  );

  // The destination ('in') side of a pending cross-project transfer is the one the receiver acts on.
  const canReceiveCrossProjectTransfer = Boolean(
    isSupabaseMode
      && order?.kind === "stock"
      && order?.status === "placed"
      && order?.transferDirection === "in"
      && order?.transferGroupId,
  );
  const isReceivingTransfer = order != null && receivingId === order.id;

  const onReceiveCrossProjectTransfer = async () => {
    if (!order) return;
    const ok = await receiveCrossProjectTransfer(order);
    if (ok) onOpenChange(false);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="w-[95vw] max-w-4xl max-h-[90vh] p-0 gap-0 overflow-hidden flex flex-col">
          <DialogHeader className="px-5 py-4 border-b border-border">
            <DialogTitle className="flex items-center gap-2">
              {t("procurement.orderDetail.title")}
              {order && <StatusBadge status={orderStatusLabel(order.status, t)} variant="procurement" />}
            </DialogTitle>
            <DialogDescription className="sr-only">
              {t("procurement.orderDetail.description")}
            </DialogDescription>
          </DialogHeader>

          {!order ? (
            isOrderLoading ? (
              <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4" aria-hidden>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {[0, 1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-20 w-full rounded-lg" />
                  ))}
                </div>
                <Skeleton className="h-40 w-full rounded-lg" />
              </div>
            ) : (
              <div className="flex-1 px-5 py-4 text-sm text-muted-foreground">{t("procurement.orderDetail.notFound")}</div>
            )
          ) : (
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                <div className="rounded-lg border border-border p-3 space-y-1">
                  <p className="text-xs text-muted-foreground">{t("procurement.orderDetail.source")}</p>
                  <p className="text-foreground capitalize">{t(`procurement.orderDetail.kind.${order.kind}`)}</p>
                  {order.supplierName && (
                    <>
                      <p className="text-xs text-muted-foreground pt-1">{t("procurement.orderDetail.supplier")}</p>
                      <p className="text-foreground">{order.supplierName}</p>
                    </>
                  )}
                  {order.transferDirection && counterpartyProjectTitle && (
                    <>
                      <p className="text-xs text-muted-foreground pt-1">
                        {order.transferDirection === "in"
                          ? t("procurement.orderDetail.incomingTransfer")
                          : t("procurement.orderDetail.outgoingTransfer")}
                      </p>
                      <p className="text-foreground">
                        {order.transferDirection === "in"
                          ? t("procurement.orderDetail.fromProjectName", { project: counterpartyProjectTitle })
                          : t("procurement.orderDetail.toProjectName", { project: counterpartyProjectTitle })}
                      </p>
                    </>
                  )}
                </div>
                <div className="rounded-lg border border-border p-3 space-y-1">
                  <p className="text-xs text-muted-foreground">{t("procurement.orderDetail.deliverTo")}</p>
                  <p className="text-foreground">{locationById.get(order.deliverToLocationId ?? "")?.name ?? "—"}</p>
                  {order.kind === "stock" && order.fromLocationId && (
                    <>
                      <p className="text-xs text-muted-foreground pt-1">{t("procurement.orderDetail.fromLocation")}</p>
                      <p className="text-foreground">{locationById.get(order.fromLocationId)?.name ?? "—"}</p>
                    </>
                  )}
                </div>
                <div className="rounded-lg border border-border p-3 space-y-1">
                  <p className="text-xs text-muted-foreground">{t("procurement.orderDetail.dueDate")}</p>
                  <p className="text-foreground">{order.dueDate ? new Date(order.dueDate).toLocaleDateString() : "—"}</p>
                  <p className="text-xs text-muted-foreground pt-1">{t("procurement.orderDetail.deliveryDeadline")}</p>
                  <p className="text-foreground">{deliveryDisplay ? new Date(deliveryDisplay).toLocaleDateString() : "—"}</p>
                </div>
                <div className="rounded-lg border border-border p-3 space-y-1">
                  <p className="text-xs text-muted-foreground">{t("procurement.orderDetail.invoice")}</p>
                  <p className="text-foreground">{order.invoiceAttachment?.name ?? "—"}</p>
                  {showSensitiveDetail && (
                    <>
                      <p className="text-xs text-muted-foreground pt-1">{t("procurement.orderDetail.plannedTotal")}</p>
                      <p className="text-foreground">{fmtCost(plannedTotal)}</p>
                      <p className="text-xs text-muted-foreground pt-1">{t("procurement.orderDetail.factualTotal")}</p>
                      <p className="text-foreground">{fmtCost(factualTotal)}</p>
                      <p className="text-xs text-muted-foreground pt-1">{t("procurement.orderDetail.openValue")}</p>
                      <p className="text-foreground">{fmtCost(total)}</p>
                    </>
                  )}
                </div>
              </div>

              {order.note && (
                <div className="rounded-lg border border-border p-3">
                  <p className="text-xs text-muted-foreground">{t("procurement.orderDetail.note")}</p>
                  <p className="text-sm text-foreground mt-1 whitespace-pre-wrap">{order.note}</p>
                </div>
              )}

              <div className="rounded-lg border border-border overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/30 border-b border-border">
                    <tr>
                      <th className="text-left px-3 py-2">{t("procurement.orderDetail.colItem")}</th>
                      <th className="text-right px-3 py-2">{t("procurement.orderDetail.colQty")}</th>
                      <th className="text-left px-3 py-2">{t("procurement.orderDetail.colUnit")}</th>
                      {showSensitiveDetail && <th className="text-right px-3 py-2">{t("procurement.orderDetail.colPlannedUnit")}</th>}
                      {showSensitiveDetail && <th className="text-right px-3 py-2">{t("procurement.orderDetail.colFactualUnit")}</th>}
                      {showSensitiveDetail && <th className="text-right px-3 py-2">{t("procurement.orderDetail.colPlannedTotal")}</th>}
                      {showSensitiveDetail && <th className="text-right px-3 py-2">{t("procurement.orderDetail.colFactualTotal")}</th>}
                      <th className="text-right px-3 py-2">{t("procurement.orderDetail.colReceived")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {order.lines.map((line) => {
                      const item = itemById.get(line.procurementItemId);
                      const plannedUnit = line.plannedUnitPrice
                        ?? item?.plannedUnitPrice
                        ?? 0;
                      const factualUnit = line.actualUnitPrice
                        ?? item?.actualUnitPrice
                        ?? line.plannedUnitPrice
                        ?? item?.plannedUnitPrice
                        ?? 0;

                      return (
                        <tr key={line.id} className="border-b border-border/70 last:border-0">
                          <td className="px-3 py-2">
                            <button
                              type="button"
                              className="text-left hover:underline"
                              onClick={() => onOpenRequest?.(line.procurementItemId)}
                            >
                              <p className="font-medium text-foreground">{item?.name ?? t("procurement.orderDetail.unknownItem")}</p>
                              {item?.spec && <p className="text-xs text-muted-foreground">{item.spec}</p>}
                            </button>
                          </td>
                          <td className="px-3 py-2 text-right">{line.qty}</td>
                          <td className="px-3 py-2">{line.unit}</td>
                          {showSensitiveDetail && <td className="px-3 py-2 text-right">{fmtCost(plannedUnit)}</td>}
                          {showSensitiveDetail && <td className="px-3 py-2 text-right">{fmtCost(factualUnit)}</td>}
                          {showSensitiveDetail && <td className="px-3 py-2 text-right">{fmtCost(plannedUnit * line.qty)}</td>}
                          {showSensitiveDetail && <td className="px-3 py-2 text-right">{fmtCost(factualUnit * line.qty)}</td>}
                          <td className="px-3 py-2 text-right">{line.receivedQty}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <DialogFooter className="px-5 py-4 border-t border-border">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{t("common.close")}</Button>
            {order?.status === "draft" && !isSupabaseMode && (
              <Button type="button" variant="destructive" onClick={onCancelDraft}>{t("procurement.orderDetail.cancelDraft")}</Button>
            )}
            {order?.status === "draft" && isSupabaseMode && order.kind === "supplier" && (
              <Button type="button" variant="destructive" disabled>{t("procurement.orderDetail.cancelDraft")}</Button>
            )}
            {/* TODO: allow editing deliverTo on placed orders before first receive */}
            {order?.status === "placed" && !isSupabaseMode && (
              <Button type="button" variant="destructive" onClick={onVoidOrder}>{t("procurement.orderDetail.voidOrder")}</Button>
            )}
            {order != null && isOpenOrderStatus(order.status) && isSupabaseMode && order.kind === "supplier" && (
              <Button type="button" variant="destructive" disabled>{t("procurement.orderDetail.voidOrder")}</Button>
            )}
            {order?.kind === "stock" && order?.status === "received" && !isSupabaseMode && (
              <Button type="button" variant="destructive" onClick={onVoidOrder}>{t("procurement.orderDetail.voidAllocation")}</Button>
            )}
            {order?.kind === "supplier" && isOpenOrderStatus(order.status) && (
              <Button type="button" onClick={() => setReceiveOpen(true)}>{t("procurement.action.receive")}</Button>
            )}
            {canReceiveCrossProjectTransfer && (
              <Button
                type="button"
                onClick={() => void onReceiveCrossProjectTransfer()}
                disabled={isReceivingTransfer}
              >
                {isReceivingTransfer
                  ? t("procurement.orderDetail.receivingTransfer")
                  : t("procurement.action.receive")}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {order && (
        <ReceiveOrderModal
          open={receiveOpen}
          onOpenChange={setReceiveOpen}
          projectId={projectId}
          orderId={order.id}
        />
      )}
    </>
  );
}
