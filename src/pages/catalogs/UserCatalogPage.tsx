import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Loader2, PackageOpen, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ConfirmModal } from "@/components/ConfirmModal";
import { toast } from "@/hooks/use-toast";
import { useWorkspaceMode } from "@/hooks/use-workspace-source";
import {
  useAddUserCatalogItem,
  useDeleteUserCatalog,
  useDeleteUserCatalogItem,
  useMatchedArticleNames,
  useRenameUserCatalog,
  useUpdateUserCatalogItem,
  useUserCatalog,
  useUserCatalogItems,
} from "@/hooks/use-user-catalogs";
import {
  CatalogItemsEditor,
  type EditorRowData,
  type EditorRowPatch,
} from "@/components/catalog/CatalogItemsEditor";
import {
  applyDuplicateMarks,
  countBySeverity,
  editDraftRow,
  formatCentsAsPriceInput,
  parsePriceInputToCents,
  removeDraftRow,
  validateDraftRow,
} from "@/lib/user-catalog/validation";
import type { DraftRow } from "@/types/user-catalog";
import { trackEvent } from "@/lib/analytics";

const CATALOGS_TAB_URL = "/home?tab=documents&docTab=catalogs";
const NEW_ROW_PREFIX = "new-";
const FLUSH_DELAY_MS = 600;

/**
 * Saved-catalog page (US-9): view and edit the rows of one personal catalog,
 * rename it, delete it. Edits reuse the DraftRow validation machinery from
 * the upload review; valid changes flush to the DB debounced, rows with
 * blocking issues stay local (and highlighted) until fixed.
 */
export default function UserCatalogPage() {
  const { catalogId } = useParams<{ catalogId: string }>();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const workspaceMode = useWorkspaceMode();
  const isSupabaseMode = workspaceMode.kind === "supabase";

  const catalogQuery = useUserCatalog(catalogId, isSupabaseMode);
  const itemsQuery = useUserCatalogItems(catalogId, isSupabaseMode);

  const renameMutation = useRenameUserCatalog();
  const deleteCatalogMutation = useDeleteUserCatalog();
  const updateItemMutation = useUpdateUserCatalogItem();
  const addItemMutation = useAddUserCatalogItem();
  const deleteItemMutation = useDeleteUserCatalogItem();

  // Catalog funnel: saved-catalog editor opened (observability v1).
  useEffect(() => {
    trackEvent("catalog_editor_opened", { editor: "saved_catalog" });
  }, []);

  const [rows, setRows] = useState<DraftRow[] | null>(null);
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [deleteCatalogOpen, setDeleteCatalogOpen] = useState(false);
  const [rowPendingDelete, setRowPendingDelete] = useState<DraftRow | null>(null);

  const dirtyIds = useRef(new Set<string>());
  const flushTimer = useRef<number | null>(null);
  const maxPosition = useRef(0);
  // A row created in the editor keeps its local "new-…" id for its whole
  // lifetime (stable React key — no remount/focus loss); the insert's server
  // id lives in this map and every mutation resolves through it. Edits made
  // while the insert is in flight stay dirty under the SAME id and flush as
  // an update once the id is known.
  const serverIds = useRef(new Map<string, string>());
  const inFlightAdds = useRef(new Set<string>());
  // New rows deleted while their insert is in flight: the delete fires when
  // the insert settles (otherwise the item would resurrect server-side).
  const pendingDeletes = useRef(new Set<string>());
  const editedRowIds = useRef(new Set<string>());
  const rowsRef = useRef<DraftRow[] | null>(null);

  // Fresh state per catalog (latent cross-catalog navigation safety).
  useEffect(() => {
    setRows(null);
    setNameDraft(null);
    setRowPendingDelete(null);
    setDeleteCatalogOpen(false);
    dirtyIds.current.clear();
    serverIds.current.clear();
    inFlightAdds.current.clear();
    pendingDeletes.current.clear();
    editedRowIds.current.clear();
    maxPosition.current = 0;
  }, [catalogId]);

  const matchedIds = useMemo(
    () => (rows ?? []).map((row) => row.matchedArticleId).filter((id): id is string => Boolean(id)),
    [rows],
  );
  const articleNamesQuery = useMatchedArticleNames(matchedIds, isSupabaseMode);

  // Seed local rows once per catalog load; afterwards local state is the
  // source of truth (the flush keeps the server in sync). Saved data gets the
  // same validation pass as drafts so pre-existing warnings (duplicates,
  // empty units) are visible before the first edit.
  useEffect(() => {
    if (!itemsQuery.data || rows !== null) return;
    maxPosition.current = itemsQuery.data.reduce((max, item) => Math.max(max, item.position), 0);
    const seeded: DraftRow[] = itemsQuery.data.map((item, index) => {
      const base = {
        localId: item.id,
        name: item.name,
        unit: item.unit,
        priceInput: formatCentsAsPriceInput(item.priceCents),
        resourceType: item.resourceType,
        typeAutoFilled: false,
        supplierSku: item.supplierSku ?? "",
        matchedArticleId: item.matchedArticleId,
        matchedArticleName: null,
        sourceRowNumber: index + 1,
      };
      const { issues, severity } = validateDraftRow(
        {
          name: base.name,
          unit: base.unit,
          priceInput: base.priceInput,
          supplierSku: base.supplierSku,
        },
        new Set<string>(),
      );
      return { ...base, issues, severity };
    });
    setRows(applyDuplicateMarks(seeded));
  }, [itemsQuery.data, rows]);

  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);

  const resolveServerId = (localId: string): string | null => {
    if (!localId.startsWith(NEW_ROW_PREFIX)) return localId;
    return serverIds.current.get(localId) ?? null;
  };

  const flushDirtyRows = useCallback(() => {
    const currentRows = rowsRef.current;
    if (!currentRows || !catalogId) return;
    for (const row of currentRows) {
      if (!dirtyIds.current.has(row.localId)) continue;
      if (row.severity === "blocking") continue; // stays local until fixed
      const priceCents = parsePriceInputToCents(row.priceInput) ?? 0;
      const payload = {
        name: row.name.trim(),
        unit: row.unit.trim(),
        priceCents,
        resourceType: row.resourceType,
        supplierSku: row.supplierSku.trim() || null,
        matchedArticleId: row.matchedArticleId,
      };
      const localId = row.localId;
      const targetId = resolveServerId(localId);

      if (localId.startsWith(NEW_ROW_PREFIX) && targetId === null) {
        // Not persisted yet. While the insert is in flight the row simply
        // stays dirty; the settle handler re-arms the flush.
        if (inFlightAdds.current.has(localId)) continue;
        dirtyIds.current.delete(localId);
        inFlightAdds.current.add(localId);
        maxPosition.current += 1;
        addItemMutation.mutate(
          { catalogId, item: payload, position: maxPosition.current },
          {
            onSuccess: (created) => {
              inFlightAdds.current.delete(localId);
              serverIds.current.set(localId, created.id);
              if (pendingDeletes.current.has(localId)) {
                pendingDeletes.current.delete(localId);
                deleteItemMutation.mutate(created.id, {
                  onError: () =>
                    toast({ title: t("catalogPage.deleteRowFailed"), variant: "destructive" }),
                });
                return;
              }
              if (dirtyIds.current.has(localId)) scheduleFlush();
            },
            onError: () => {
              inFlightAdds.current.delete(localId);
              if (pendingDeletes.current.has(localId)) {
                // The user deleted the row while its insert was failing —
                // nothing exists server-side and nothing should retry.
                pendingDeletes.current.delete(localId);
                return;
              }
              if (!rowsRef.current?.some((r) => r.localId === localId)) return;
              dirtyIds.current.add(localId);
              toast({ title: t("catalogPage.saveRowFailed"), variant: "destructive" });
              scheduleFlush();
            },
          },
        );
        continue;
      }

      if (targetId === null) continue;
      dirtyIds.current.delete(localId);
      updateItemMutation.mutate(
        { itemId: targetId, patch: payload },
        {
          onError: () => {
            // Deleted meanwhile → no row to re-flush.
            if (!rowsRef.current?.some((r) => r.localId === localId)) return;
            dirtyIds.current.add(localId);
            toast({ title: t("catalogPage.saveRowFailed"), variant: "destructive" });
            scheduleFlush();
          },
        },
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalogId, addItemMutation, updateItemMutation, deleteItemMutation, t]);

  const scheduleFlush = useCallback(() => {
    if (flushTimer.current !== null) window.clearTimeout(flushTimer.current);
    flushTimer.current = window.setTimeout(flushDirtyRows, FLUSH_DELAY_MS);
  }, [flushDirtyRows]);

  useEffect(() => {
    if (!rows || dirtyIds.current.size === 0) return;
    scheduleFlush();
    return () => {
      if (flushTimer.current !== null) window.clearTimeout(flushTimer.current);
    };
  }, [rows, scheduleFlush]);

  const flushRef = useRef(flushDirtyRows);
  useEffect(() => {
    flushRef.current = flushDirtyRows;
  }, [flushDirtyRows]);

  // An edit made inside the debounce window right before navigating away must
  // not be lost: the cleanup above only cancels the timer, and there is no
  // other flush path. Declared after it so React clears the timer first, and
  // routed through the ref because the route reuses this component across
  // :catalogId — a mount-time closure would flush against the wrong catalog.
  useEffect(() => {
    return () => {
      flushRef.current();
    };
  }, []);

  const editorRows: EditorRowData[] = useMemo(() => {
    if (!rows) return [];
    const names = articleNamesQuery.data;
    return rows.map((row) => ({
      id: row.localId,
      name: row.name,
      unit: row.unit,
      priceInput: row.priceInput,
      resourceType: row.resourceType,
      typeAutoFilled: row.typeAutoFilled,
      supplierSku: row.supplierSku,
      matchedArticleId: row.matchedArticleId,
      matchedArticleName:
        row.matchedArticleName ??
        (row.matchedArticleId ? names?.get(row.matchedArticleId) ?? null : null),
      sourceRowNumber: row.sourceRowNumber,
      issues: row.issues,
      severity: row.severity,
    }));
  }, [rows, articleNamesQuery.data]);

  if (!isSupabaseMode) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-16 text-center space-y-3">
        <PackageOpen className="mx-auto h-10 w-10 text-muted-foreground" aria-hidden="true" />
        <p className="text-body-sm text-muted-foreground">{t("catalogPage.signInRequired")}</p>
        <Button asChild variant="outline">
          <Link to={CATALOGS_TAB_URL}>{t("catalogReview.backToCatalogs")}</Link>
        </Button>
      </div>
    );
  }

  // Query errors (incl. a non-uuid :catalogId → PostgREST cast error) render
  // as not-found instead of an infinite spinner.
  if (catalogQuery.isError || itemsQuery.isError) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-16 text-center space-y-3">
        <PackageOpen className="mx-auto h-10 w-10 text-muted-foreground" aria-hidden="true" />
        <p className="text-body-sm text-muted-foreground">{t("catalogPage.notFound")}</p>
        <Button asChild variant="outline">
          <Link to={CATALOGS_TAB_URL}>{t("catalogReview.backToCatalogs")}</Link>
        </Button>
      </div>
    );
  }

  if (catalogQuery.isLoading || itemsQuery.isLoading || rows === null) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        {t("app.loading")}
      </div>
    );
  }

  const catalog = catalogQuery.data;
  if (!catalog) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-16 text-center space-y-3">
        <PackageOpen className="mx-auto h-10 w-10 text-muted-foreground" aria-hidden="true" />
        <p className="text-body-sm text-muted-foreground">{t("catalogPage.notFound")}</p>
        <Button asChild variant="outline">
          <Link to={CATALOGS_TAB_URL}>{t("catalogReview.backToCatalogs")}</Link>
        </Button>
      </div>
    );
  }

  const counts = countBySeverity(rows);

  const handleRowChange = (id: string, patch: EditorRowPatch) => {
    dirtyIds.current.add(id);
    // One measurement event per row per visit, not per keystroke.
    if (!editedRowIds.current.has(id)) {
      editedRowIds.current.add(id);
      trackEvent("catalog_row_edited", { catalog_id: catalog.id, saved: true });
    }
    setRows((current) => (current ? editDraftRow(current, id, patch) : current));
  };

  const handleRowDelete = (id: string) => {
    const row = rows.find((r) => r.localId === id);
    if (!row) return;
    if (id.startsWith(NEW_ROW_PREFIX) && !serverIds.current.get(id)) {
      dirtyIds.current.delete(id);
      if (inFlightAdds.current.has(id)) {
        // Insert in flight: remove locally now, delete server-side on settle.
        pendingDeletes.current.add(id);
      }
      setRows((current) => (current ? removeDraftRow(current, id) : current));
      return;
    }
    setRowPendingDelete(row);
  };

  const confirmRowDelete = () => {
    const row = rowPendingDelete;
    if (!row) return;
    setRowPendingDelete(null);
    const targetId = resolveServerId(row.localId);
    dirtyIds.current.delete(row.localId);
    setRows((current) => (current ? removeDraftRow(current, row.localId) : current));
    if (!targetId) return;
    deleteItemMutation.mutate(targetId, {
      onError: () => {
        toast({ title: t("catalogPage.deleteRowFailed"), variant: "destructive" });
        setRows((current) => (current ? [...current, row] : current));
      },
    });
  };

  const handleAddRow = () => {
    setRows((current) => {
      if (!current) return current;
      const localId = `${NEW_ROW_PREFIX}${crypto.randomUUID()}`;
      const empty: DraftRow = {
        localId,
        name: "",
        unit: "",
        priceInput: "",
        resourceType: "material",
        typeAutoFilled: false,
        supplierSku: "",
        matchedArticleId: null,
        matchedArticleName: null,
        sourceRowNumber: null,
        issues: [{ code: "NAME_EMPTY", field: "name", severity: "blocking" }],
        severity: "blocking",
      };
      return [...current, empty];
    });
  };

  const commitRename = () => {
    const next = (nameDraft ?? catalog.name).trim();
    setNameDraft(null);
    if (!next || next === catalog.name) return;
    renameMutation.mutate(
      { catalogId: catalog.id, name: next },
      {
        onError: () => toast({ title: t("catalogPage.renameFailed"), variant: "destructive" }),
      },
    );
  };

  const handleDeleteCatalog = () => {
    deleteCatalogMutation.mutate(catalog.id, {
      onSuccess: () => {
        toast({ title: t("catalogPage.deletedToast", { name: catalog.name }) });
        navigate(CATALOGS_TAB_URL, { replace: true });
      },
      onError: () =>
        toast({ title: t("catalogPage.deleteFailed"), variant: "destructive" }),
    });
  };

  return (
    <div className="mx-auto w-full max-w-6xl space-y-4 px-4 py-5 sm:px-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <Link
            to={CATALOGS_TAB_URL}
            className="inline-flex items-center gap-1 text-caption text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            {t("catalogReview.backToCatalogs")}
          </Link>
          <Input
            value={nameDraft ?? catalog.name}
            onChange={(event) => setNameDraft(event.target.value)}
            maxLength={200}
            onBlur={commitRename}
            onKeyDown={(event) => {
              if (event.key === "Enter") (event.target as HTMLInputElement).blur();
            }}
            className="h-9 max-w-md border-transparent bg-transparent px-1 text-lg font-semibold shadow-none focus-visible:border-input focus-visible:bg-background"
            aria-label={t("catalogPage.renameAria")}
          />
          <p className="text-caption text-muted-foreground">
            {catalog.sourceFilename
              ? t("catalogPage.sourceFile", { file: catalog.sourceFilename })
              : null}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="tabular-nums">
            {t("catalogReview.stats.rows", { count: rows.length })}
          </Badge>
          {counts.blocking > 0 && (
            <Badge className="bg-destructive/15 text-destructive tabular-nums hover:bg-destructive/15">
              {t("catalogReview.stats.blocking", { count: counts.blocking })}
            </Badge>
          )}
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 text-destructive hover:text-destructive"
            onClick={() => setDeleteCatalogOpen(true)}
          >
            <Trash2 className="h-4 w-4" />
            {t("catalogPage.deleteCatalog")}
          </Button>
        </div>
      </div>

      {counts.blocking > 0 && (
        <p className="text-caption text-destructive">{t("catalogPage.blockingHint")}</p>
      )}

      <CatalogItemsEditor
        rows={editorRows}
        onRowChange={handleRowChange}
        onRowDelete={handleRowDelete}
        onAddRow={handleAddRow}
        matchSearchEnabled={isSupabaseMode}
      />

      <ConfirmModal
        open={deleteCatalogOpen}
        onOpenChange={setDeleteCatalogOpen}
        title={t("catalogPage.deleteCatalogTitle", { name: catalog.name })}
        description={t("catalogPage.deleteCatalogBody")}
        confirmLabel={t("common.delete")}
        onConfirm={handleDeleteCatalog}
      />

      <ConfirmModal
        open={rowPendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setRowPendingDelete(null);
        }}
        title={t("catalogPage.deleteRowTitle", { name: rowPendingDelete?.name ?? "" })}
        description={t("catalogPage.deleteRowBody")}
        confirmLabel={t("common.delete")}
        onConfirm={confirmRowDelete}
      />
    </div>
  );
}
