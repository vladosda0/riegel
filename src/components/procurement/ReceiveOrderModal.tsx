import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { getOrdersSource } from "@/data/orders-source";
import { isOpenOrderStatus } from "@/lib/procurement-fulfillment";
import { useProcurementV2 } from "@/hooks/use-mock-data";
import { inventoryQueryKeys, useLocations } from "@/hooks/use-inventory-data";
import {
  orderPlacedSupplierOrdersQueryRoot,
  orderProjectOrdersQueryRoot,
  orderQueryKeys,
  useOrder,
} from "@/hooks/use-order-data";
import { procurementProjectItemsQueryRoot } from "@/hooks/use-procurement-source";
import { useToast } from "@/hooks/use-toast";
import { useWorkspaceMode } from "@/hooks/use-workspace-source";
import { LocationPicker } from "@/components/procurement/LocationPicker";

interface ReceiveOrderModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  orderId: string;
  onCompleted?: () => void;
}

export function ReceiveOrderModal({
  open,
  onOpenChange,
  projectId,
  orderId,
  onCompleted,
}: ReceiveOrderModalProps) {
  const { t } = useTranslation();
  const order = useOrder(orderId);
  const items = useProcurementV2(projectId);
  const locations = useLocations(projectId);
  const workspaceMode = useWorkspaceMode();
  const supabaseMode = workspaceMode.kind === "supabase" ? workspaceMode : null;
  const queryClient = useQueryClient();
  const itemById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const defaultLocationId = useMemo(
    () => locations.find((location) => location.isDefault)?.id ?? locations[0]?.id ?? "",
    [locations],
  );
  const { toast } = useToast();
  const [receiveInFlight, setReceiveInFlight] = useState(false);
  const receiveInFlightRef = useRef(false);

  const [locationId, setLocationId] = useState("");
  const [lineQty, setLineQty] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!open || !order) return;
    const nextLineQty: Record<string, number> = {};
    order.lines.forEach((line) => {
      nextLineQty[line.id] = Math.max(0, line.qty - line.receivedQty);
    });
    setLineQty(nextLineQty);
    setLocationId(order.deliverToLocationId ?? defaultLocationId);
  }, [open, order?.id, order, defaultLocationId]);

  useEffect(() => {
    if (!open || !order || locationId) return;
    const fallbackLocationId = order.deliverToLocationId ?? defaultLocationId;
    if (!fallbackLocationId) return;
    setLocationId(fallbackLocationId);
  }, [open, order, locationId, defaultLocationId]);

  const submit = async () => {
    if (!order) return;
    if (receiveInFlightRef.current) return;
    // A part-delivered order still has quantity outstanding, so it stays receivable.
    if (!isOpenOrderStatus(order.status)) {
      toast({ title: t("procurement.receiveOrder.notReceivable"), variant: "destructive" });
      return;
    }
    const lines = order.lines
      .map((line) => ({ lineId: line.id, qty: Number(lineQty[line.id] ?? 0) }))
      .filter((line) => line.qty > 0);

    if (lines.length === 0) {
      toast({ title: t("procurement.toast.noQtyEntered"), variant: "destructive" });
      return;
    }

    if (!locationId) {
      toast({ title: t("procurement.receiveOrder.locationRequired"), description: t("procurement.receiveOrder.locationRequiredDesc"), variant: "destructive" });
      return;
    }

    receiveInFlightRef.current = true;
    setReceiveInFlight(true);
    try {
      const source = await getOrdersSource(supabaseMode ?? undefined);
      await source.receiveSupplierOrder(order.id, { locationId, lines });
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
            queryKey: orderQueryKeys.orderById(supabaseMode.profileId, order.id),
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

      toast({ title: t("procurement.receiveOrder.orderReceived") });
      onCompleted?.();
      onOpenChange(false);
    } catch (error) {
      toast({
        title: t("procurement.toast.receiveFailed"),
        description: error instanceof Error ? error.message : t("procurement.toast.receiveFallback"),
        variant: "destructive",
      });
    } finally {
      receiveInFlightRef.current = false;
      setReceiveInFlight(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[92vw] max-w-2xl max-h-[88vh] overflow-hidden p-0 gap-0 flex flex-col">
        <DialogHeader className="px-5 py-4 border-b border-border">
          <DialogTitle>{t("procurement.receiveOrder.title")}</DialogTitle>
        </DialogHeader>

        {!order ? (
          <div className="px-5 py-4 text-sm text-muted-foreground">{t("procurement.receiveOrder.notFound")}</div>
        ) : (
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
            <div>
              <label className="text-xs text-muted-foreground">{t("procurement.receiveOrder.receiveToLocation")}</label>
              <LocationPicker projectId={projectId} value={locationId} onChange={setLocationId} />
            </div>

            <div className="rounded-lg border border-border overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/30 border-b border-border">
                  <tr>
                    <th className="text-left px-3 py-2">{t("procurement.col.item")}</th>
                    <th className="text-right px-3 py-2">{t("procurement.col.orderedQty")}</th>
                    <th className="text-right px-3 py-2">{t("procurement.col.alreadyReceived")}</th>
                    <th className="text-right px-3 py-2">{t("procurement.col.receiveNow")}</th>
                  </tr>
                </thead>
                <tbody>
                  {order.lines.map((line) => {
                    const item = itemById.get(line.procurementItemId);
                    const remaining = Math.max(0, line.qty - line.receivedQty);

                    return (
                      <tr key={line.id} className="border-b border-border/70 last:border-0">
                        <td className="px-3 py-2">
                          <p className="font-medium text-foreground">{item?.name ?? t("procurement.orderDetail.unknownItem")}</p>
                          {item?.spec && <p className="text-xs text-muted-foreground">{item.spec}</p>}
                        </td>
                        <td className="px-3 py-2 text-right">{line.qty} {line.unit}</td>
                        <td className="px-3 py-2 text-right">{line.receivedQty} {line.unit}</td>
                        <td className="px-3 py-2">
                          <div className="flex flex-col items-end gap-0.5">
                            <Input
                              type="number"
                              min="0"
                              max={remaining}
                              value={lineQty[line.id] ?? 0}
                              onChange={(event) => {
                                const nextValue = Math.min(remaining, Math.max(0, Number(event.target.value)));
                                setLineQty((prev) => ({ ...prev, [line.id]: nextValue }));
                              }}
                              className="h-8 text-right"
                            />
                            <span className="text-[11px] text-muted-foreground">
                              {t("procurement.receiveOrder.maxRemaining", { remaining, unit: line.unit })}
                            </span>
                          </div>
                        </td>
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
          <Button
            type="button"
            onClick={submit}
            disabled={!order || !isOpenOrderStatus(order.status) || receiveInFlight}
          >
            {receiveInFlight ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
            {receiveInFlight ? t("procurement.receiveModal.receiving") : t("procurement.action.receive")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
