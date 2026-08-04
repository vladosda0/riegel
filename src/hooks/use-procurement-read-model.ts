import { useCallback, useEffect, useMemo, useState } from "react";
import { useWorkspaceProjectsSensitiveDetailMap } from "@/hooks/use-home-sensitive-detail-map";
import { useProject } from "@/hooks/use-mock-data";
import { useProjectProcurementItemsState } from "@/hooks/use-procurement-source";
import { useOrders } from "@/hooks/use-order-data";
import { useLocations } from "@/hooks/use-inventory-data";
import { subscribe } from "@/data/store";
import { subscribeProcurement } from "@/data/procurement-store";
import { subscribeOrders } from "@/data/order-store";
import { subscribeInventory } from "@/data/inventory-store";
import {
  applySensitiveDetailToProcurementReadSnapshot,
  buildProcurementReadProjectSummary,
  getProcurementReadSnapshot,
  type ProcurementReadProjectSummary,
  type ProcurementReadSnapshot,
} from "@/lib/procurement-read-model";

const EMPTY_HOME_PROCUREMENT_SNAPSHOT: ProcurementReadSnapshot = {
  projects: [],
  totals: {
    totalCount: 0,
    requestedCount: 0,
    orderedCount: 0,
    inStockCount: 0,
    requestedTotal: 0,
    orderedTotal: 0,
    inStockTotal: 0,
    inStockPlannedTotal: 0,
    inStockActualTotal: 0,
  },
};

export function useProcurementReadSnapshot(): ProcurementReadSnapshot {
  const getter = useCallback(() => getProcurementReadSnapshot(), []);
  const [value, setValue] = useState(getter);

  useEffect(() => {
    const update = () => setValue(getter());
    const unsubs = [
      subscribe(update),
      subscribeProcurement(update),
      subscribeOrders(update),
      subscribeInventory(update),
    ];
    return () => unsubs.forEach((unsub) => unsub());
  }, [getter]);

  return value;
}

/** Home Procurement tab: same read model as `getProcurementReadSnapshot` with per-project sensitive-detail redaction. */
export function useHomeProcurementReadSnapshot(): {
  snapshot: ProcurementReadSnapshot;
  sensitiveDetailLoading: boolean;
} {
  const { canViewSensitiveDetailByProjectId, isLoading: sensitiveDetailLoading } =
    useWorkspaceProjectsSensitiveDetailMap();

  const getter = useCallback(() => getProcurementReadSnapshot(), []);
  const [raw, setRaw] = useState(getter);

  useEffect(() => {
    const update = () => setRaw(getter());
    const unsubs = [
      subscribe(update),
      subscribeProcurement(update),
      subscribeOrders(update),
      subscribeInventory(update),
    ];
    return () => unsubs.forEach((unsub) => unsub());
  }, [getter]);

  const snapshot = useMemo(() => {
    if (sensitiveDetailLoading) {
      return EMPTY_HOME_PROCUREMENT_SNAPSHOT;
    }
    return applySensitiveDetailToProcurementReadSnapshot(raw, (projectId) =>
      canViewSensitiveDetailByProjectId.get(projectId) ?? false,
    );
  }, [raw, sensitiveDetailLoading, canViewSensitiveDetailByProjectId]);

  return { snapshot, sensitiveDetailLoading };
}

/**
 * ONE project's procurement summary, built from that project's own sources.
 *
 * It used to derive from `useProcurementReadSnapshot`, i.e. fetch every project and filter down
 * to one. That snapshot reads the in-memory browser stores, which nothing hydrates in Supabase
 * mode, so this hook returned null for every authenticated user and the AI sidebar carried no
 * procurement context at all, with no error to notice (#215).
 *
 * The four hooks below each resolve demo / local / Supabase internally, so this needs no mode
 * branch of its own and demo mode keeps reading the same browser stores it always did.
 *
 * Known gap, tracked as #275: those hooks expose an `isLoading` that this one drops, so it
 * returns null while the queries are in flight and `buildAIProjectContext` renders that as
 * zeros. Strictly narrower than the defect it replaces (null unconditionally in Supabase mode),
 * but a prompt sent before the queries settle still tells the assistant the project has no
 * procurement, with no signal anything is missing.
 *
 * Scope note: the cross-project Home «Снабжение» tab still goes through the snapshot and is
 * still empty in Supabase mode. That half needs either a per-project fan-out or a portfolio RPC
 * and is tracked separately; this hook is the single-project consumer.
 */
export function useProcurementReadProjectSummary(projectId: string): ProcurementReadProjectSummary | null {
  const { project } = useProject(projectId);
  const { items } = useProjectProcurementItemsState(projectId);
  const orders = useOrders(projectId);
  const locations = useLocations(projectId);

  return useMemo(() => {
    if (!project) return null;
    return buildProcurementReadProjectSummary(
      { id: project.id, title: project.title },
      items,
      orders,
      locations,
    );
  }, [project, items, orders, locations]);
}
