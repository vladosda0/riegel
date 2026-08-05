import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { toast } from "@/hooks/use-toast";
import { Building2, ChevronLeft, FileText, FolderInput } from "lucide-react";
import { useActiveOrg, useOrgDocuments } from "@/hooks/use-orgs";
import type { OrgDoc } from "@/data/org-source";
import { SectionChrome } from "@/components/home/documents-hub/SectionChrome";
import { TileGrid, FolderTile, FileTile, CreateFolderTile } from "@/components/home/documents-hub/tiles";
import { EmptyState } from "@/components/home/documents-hub/EmptyState";
import { FilePreviewDialog, type PreviewableDocument } from "@/components/home/documents-hub/FilePreviewDialog";
import { downloadStorageUrl, openStorageUrlInNewTab } from "@/components/home/documents-hub/storage-urls";
import { MoveToFolderDialog } from "@/components/home/documents-hub/MoveToFolderDialog";
import { useSectionFilters } from "@/hooks/use-section-filters";
import {
  useOrgDocumentFolders,
  useCreateOrgDocumentFolder,
  useRenameOrgDocumentFolder,
  useDeleteOrgDocumentFolder,
  useMoveOrgDocumentToFolder,
  type OrgDocumentFolder,
} from "@/hooks/use-org-document-folders";

const DND_TYPE = "application/x-rovno-org-document-id";

function toPreviewDoc(doc: OrgDoc): PreviewableDocument {
  return {
    id: doc.id,
    title: doc.title,
    type: doc.type,
    origin: doc.origin,
    description: doc.description ?? null,
    tags: doc.tags,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    scope: "org",
    bucket: doc.bucket,
    objectPath: doc.objectPath,
    mimeType: doc.mimeType,
  };
}

export function OrgAllDocsView() {
  const { t } = useTranslation();
  const activeOrg = useActiveOrg();
  const canManage = activeOrg?.role === "owner" || activeOrg?.role === "admin";
  const { data: docs } = useOrgDocuments(activeOrg?.id);
  const { data: folders } = useOrgDocumentFolders(activeOrg?.id);

  const createFolder = useCreateOrgDocumentFolder();
  const renameFolder = useRenameOrgDocumentFolder();
  const deleteFolder = useDeleteOrgDocumentFolder();
  const moveDoc = useMoveOrgDocumentToFolder();

  const [drilledFolderId, setDrilledFolderId] = useState<string | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [renameTarget, setRenameTarget] = useState<OrgDocumentFolder | null>(null);
  const [renameInput, setRenameInput] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<OrgDocumentFolder | null>(null);
  const [moveTarget, setMoveTarget] = useState<OrgDoc | null>(null);
  const [previewDoc, setPreviewDoc] = useState<OrgDoc | null>(null);
  const [draggingOverFolderId, setDraggingOverFolderId] = useState<string | null>(null);

  const folderList = useMemo(() => folders ?? [], [folders]);
  const docList = useMemo(() => docs ?? [], [docs]);

  const drilledFolder = useMemo(
    () => (drilledFolderId ? folderList.find((f) => f.id === drilledFolderId) ?? null : null),
    [drilledFolderId, folderList],
  );

  // When drilled into a folder, show only that folder's docs. Otherwise show
  // all docs not in a folder (loose docs at root).
  const scopedDocs = useMemo(() => {
    if (drilledFolderId) {
      return docList.filter((d) => d.folderId === drilledFolderId);
    }
    return docList.filter((d) => d.folderId === null);
  }, [docList, drilledFolderId]);

  const filters = useSectionFilters<OrgDoc>({
    items: scopedDocs,
    sectionSlug: drilledFolderId ? `org-all-folder-${drilledFolderId}` : "org-all",
    searchKeys: [
      (item) => item.title,
      (item) => item.description ?? "",
      (item) => item.tags?.join(" "),
    ],
    getCreatedAt: (item) => item.createdAt,
  });

  function handleDragStart(event: React.DragEvent, docId: string) {
    event.dataTransfer.setData(DND_TYPE, docId);
    event.dataTransfer.effectAllowed = "move";
  }

  function handleDropOnFolder(folderId: string | null, docId: string) {
    if (!activeOrg) return;
    moveDoc.mutate(
      { documentId: docId, folderId, orgId: activeOrg.id },
      {
        onSuccess: () => toast({ title: t("home.documentsHub.folders.moveSuccess") }),
        onError: (err) => toast({
          title: t("home.documentsHub.folders.moveError"),
          description: err instanceof Error ? err.message : undefined,
          variant: "destructive",
        }),
      },
    );
  }

  function submitCreate() {
    if (!activeOrg) return;
    const name = newFolderName.trim();
    if (!name) return;
    createFolder.mutate(
      { orgId: activeOrg.id, name },
      {
        onSuccess: () => {
          toast({ title: t("home.documentsHub.folders.createSuccess") });
          setNewFolderName("");
          setCreateDialogOpen(false);
        },
        onError: (err) => toast({
          title: t("home.documentsHub.folders.createError"),
          description: err instanceof Error ? err.message : undefined,
          variant: "destructive",
        }),
      },
    );
  }

  function submitRename() {
    if (!renameTarget || !activeOrg) return;
    const name = renameInput.trim();
    if (!name) return;
    renameFolder.mutate(
      { folderId: renameTarget.id, newName: name, orgId: activeOrg.id },
      {
        onSuccess: () => {
          toast({ title: t("home.documentsHub.folders.renameSuccess") });
          setRenameTarget(null);
        },
        onError: (err) => toast({
          title: t("home.documentsHub.folders.renameError"),
          description: err instanceof Error ? err.message : undefined,
          variant: "destructive",
        }),
      },
    );
  }

  function submitDelete() {
    if (!deleteTarget || !activeOrg) return;
    deleteFolder.mutate(
      { folderId: deleteTarget.id, orgId: activeOrg.id },
      {
        onSuccess: () => {
          toast({ title: t("home.documentsHub.folders.deleteSuccess") });
          if (drilledFolderId === deleteTarget.id) setDrilledFolderId(null);
          setDeleteTarget(null);
        },
        onError: (err) => toast({
          title: t("home.documentsHub.folders.deleteError"),
          description: err instanceof Error ? err.message : undefined,
          variant: "destructive",
        }),
      },
    );
  }

  function handleDownload(doc: OrgDoc) {
    if (!doc.bucket || !doc.objectPath) {
      toast({ title: t("home.documentsHub.preview.unavailable"), variant: "destructive" });
      return;
    }
    void downloadStorageUrl(doc.bucket, doc.objectPath, doc.title).then((ok) => {
      // rovno #284 round 3: the helper reports every failure (signing, HTTP,
      // network) through its return value - discarding it made a dead object a
      // silent no-op in this view while ProjectDocuments showed a toast.
      if (!ok) toast({ title: t("documents.preview.downloadFailed"), variant: "destructive" });
    });
  }

  function handleViewInNewTab(doc: OrgDoc) {
    if (!doc.bucket || !doc.objectPath) {
      toast({ title: t("home.documentsHub.preview.unavailable"), variant: "destructive" });
      return;
    }
    void openStorageUrlInNewTab(doc.bucket, doc.objectPath);
  }

  if (!activeOrg) {
    return (
      <EmptyState
        icon={Building2}
        title={t("home.documentsHub.empty.noOrg.title")}
        body={t("home.documentsHub.empty.noOrg.description")}
      />
    );
  }

  const filesLabel = t("home.documentsHub.folders.filesCount");
  const orgFolderCounts = new Map<string, number>();
  for (const d of docList) {
    if (d.folderId) orgFolderCounts.set(d.folderId, (orgFolderCounts.get(d.folderId) ?? 0) + 1);
  }

  const showFoldersStrip = drilledFolderId === null && (folderList.length > 0 || canManage);

  return (
    <>
      <SectionChrome
        title={drilledFolder ? drilledFolder.name : t("home.documentsHub.leaves.orgAll.title")}
        subtitle={drilledFolder ? undefined : t("home.documentsHub.leaves.orgAll.subtitle")}
        search={filters.search}
        onSearchChange={filters.setSearch}
        preset={filters.preset}
        onPresetChange={filters.setPreset}
        dateRange={filters.dateRange}
        onDateRangeChange={filters.setDateRange}
        pageSize={filters.pageSize}
        onPageSizeChange={filters.setPageSize}
        page={filters.page}
        onPageChange={filters.setPage}
        totalAfterFilter={filters.totalAfterFilter}
        isFilterActive={filters.isFilterActive}
        onReset={filters.reset}
        systemHidden={filters.systemHidden}
        headerExtra={
          drilledFolder ? (
            <Button variant="ghost" size="sm" onClick={() => setDrilledFolderId(null)}>
              <ChevronLeft className="h-3.5 w-3.5 mr-1" />
              {t("home.documentsHub.folders.backToAll")}
            </Button>
          ) : null
        }
      >
        {/* Show all folder tiles first, then loose-doc files, then a "create folder" tile. */}
        {(showFoldersStrip || filters.paged.length > 0) && (
          <TileGrid>
            {showFoldersStrip &&
              folderList.map((folder) => (
                <FolderTile
                  key={folder.id}
                  title={folder.name}
                  count={orgFolderCounts.get(folder.id) ?? 0}
                  description={null}
                  draggingOver={draggingOverFolderId === folder.id}
                  onDragOver={
                    canManage
                      ? (e) => {
                          e.preventDefault();
                          e.dataTransfer.dropEffect = "move";
                          setDraggingOverFolderId(folder.id);
                        }
                      : undefined
                  }
                  onDragLeave={canManage ? () => setDraggingOverFolderId(null) : undefined}
                  onDrop={
                    canManage
                      ? (e) => {
                          e.preventDefault();
                          setDraggingOverFolderId(null);
                          const docId = e.dataTransfer.getData(DND_TYPE);
                          if (docId) handleDropOnFolder(folder.id, docId);
                        }
                      : undefined
                  }
                  onClick={() => setDrilledFolderId(folder.id)}
                  menu={
                    canManage
                      ? {
                          renameLabel: t("home.documentsHub.folders.rename"),
                          deleteLabel: t("home.documentsHub.folders.delete"),
                          onRename: () => {
                            setRenameTarget(folder);
                            setRenameInput(folder.name);
                          },
                          onDelete: () => setDeleteTarget(folder),
                        }
                      : null
                  }
                  filesLabel={filesLabel}
                />
              ))}

            {filters.paged.map((doc) => (
              <FileTile
                key={doc.id}
                title={doc.title}
                description={doc.description ?? null}
                icon={FileText}
                dateAdded={doc.createdAt.slice(0, 10)}
                onClick={() => setPreviewDoc(doc)}
                onView={doc.bucket ? () => handleViewInNewTab(doc) : undefined}
                onDownload={doc.bucket ? () => handleDownload(doc) : undefined}
                viewLabel={t("home.documentsHub.preview.openInNewTab")}
                downloadLabel={t("home.documentsHub.preview.download")}
                draggable={canManage}
                onDragStart={(e) => handleDragStart(e, doc.id)}
                trailingMenu={
                  canManage ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={(e) => {
                        e.stopPropagation();
                        setMoveTarget(doc);
                      }}
                      aria-label={t("home.documentsHub.folders.moveToFolder")}
                      title={t("home.documentsHub.folders.moveToFolder")}
                    >
                      <FolderInput className="h-3.5 w-3.5" />
                    </Button>
                  ) : null
                }
              />
            ))}

            {showFoldersStrip && canManage && (
              <CreateFolderTile
                label={t("home.documentsHub.folders.createTile")}
                onClick={() => setCreateDialogOpen(true)}
              />
            )}
          </TileGrid>
        )}

        {!showFoldersStrip && filters.paged.length === 0 && (
          <EmptyState
            icon={FileText}
            title={
              drilledFolder
                ? t("home.documentsHub.leaves.orgAll.folderEmptyTitle")
                : t("home.documentsHub.leaves.orgAll.emptyTitle")
            }
            body={
              drilledFolder
                ? t("home.documentsHub.leaves.orgAll.folderEmptyBody")
                : t("home.documentsHub.leaves.orgAll.emptyBody")
            }
          />
        )}
      </SectionChrome>

      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("home.documentsHub.folders.createTitle")}</DialogTitle>
            <DialogDescription>{t("home.documentsHub.folders.createDescription")}</DialogDescription>
          </DialogHeader>
          <Input
            placeholder={t("home.documentsHub.folders.nameLabel")}
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button onClick={submitCreate} disabled={!newFolderName.trim() || createFolder.isPending}>
              {t("home.documentsHub.folders.create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={renameTarget !== null} onOpenChange={(open) => { if (!open) setRenameTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("home.documentsHub.folders.renameTitle")}</DialogTitle>
            <DialogDescription className="sr-only">
              {t("home.documentsHub.folders.renameTitle")}
            </DialogDescription>
          </DialogHeader>
          <Input
            placeholder={t("home.documentsHub.folders.nameLabel")}
            value={renameInput}
            onChange={(e) => setRenameInput(e.target.value)}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameTarget(null)}>{t("common.cancel")}</Button>
            <Button onClick={submitRename} disabled={!renameInput.trim() || renameFolder.isPending}>
              {t("home.documentsHub.folders.rename")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteTarget !== null} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("home.documentsHub.folders.deleteTitle")}</DialogTitle>
            <DialogDescription>
              {t("home.documentsHub.folders.deleteConfirm", { name: deleteTarget?.name ?? "" })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>{t("common.cancel")}</Button>
            <Button variant="destructive" onClick={submitDelete} disabled={deleteFolder.isPending}>
              {t("home.documentsHub.folders.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {moveTarget && activeOrg && (
        <MoveToFolderDialog
          open={moveTarget !== null}
          onOpenChange={(open) => { if (!open) setMoveTarget(null); }}
          folders={folderList}
          currentFolderId={moveTarget.folderId}
          onMove={(folderId) => {
            handleDropOnFolder(folderId, moveTarget.id);
            setMoveTarget(null);
          }}
        />
      )}

      <FilePreviewDialog
        open={previewDoc !== null}
        onOpenChange={(open) => { if (!open) setPreviewDoc(null); }}
        doc={previewDoc ? toPreviewDoc(previewDoc) : null}
      />
    </>
  );
}
