import { useMemo, useState, type ComponentType } from "react";
import { useTranslation } from "react-i18next";
import { FileText, StickyNote, Image } from "lucide-react";
import { useCurrentUser, useWorkspaceMode } from "@/hooks/use-mock-data";
import { useWorkspaceDocuments, type WorkspaceDoc } from "@/hooks/use-workspace-documents-source";
import { SectionChrome } from "@/components/home/documents-hub/SectionChrome";
import { TileGrid, FileTile } from "@/components/home/documents-hub/tiles";
import { EmptyState } from "@/components/home/documents-hub/EmptyState";
import { FilePreviewDialog, type PreviewableDocument } from "@/components/home/documents-hub/FilePreviewDialog";
import { downloadStorageUrl, openStorageUrlInNewTab } from "@/components/home/documents-hub/storage-urls";
import { toast } from "@/hooks/use-toast";
import { useSectionFilters } from "@/hooks/use-section-filters";

function toPreview(doc: WorkspaceDoc): PreviewableDocument {
  return {
    id: doc.id,
    title: doc.title,
    type: doc.type,
    origin: doc.origin,
    description: doc.description ?? null,
    tags: doc.tags,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    scope: "personal",
    bucket: doc.bucket,
    objectPath: doc.objectPath,
    mimeType: doc.mimeType,
  };
}

interface MyAllDocsViewProps {
  filter?: (doc: WorkspaceDoc) => boolean;
  titleKey: string;
  subtitleKey?: string;
  sectionSlug: string;
  emptyTitleKey: string;
  emptyBodyKey: string;
  emptyIcon?: ComponentType<{ className?: string }>;
}

export function MyAllDocsView({
  filter,
  titleKey,
  subtitleKey,
  sectionSlug,
  emptyTitleKey,
  emptyBodyKey,
  emptyIcon = FileText,
}: MyAllDocsViewProps) {
  const { t } = useTranslation();
  const mode = useWorkspaceMode();
  const currentUser = useCurrentUser();
  const isSupabaseMode = mode.kind === "supabase";
  const profileId = isSupabaseMode ? currentUser.id : undefined;
  const { data } = useWorkspaceDocuments(profileId);
  const [previewDoc, setPreviewDoc] = useState<WorkspaceDoc | null>(null);

  const items = useMemo(() => {
    const source = data ?? [];
    return filter ? source.filter(filter) : source;
  }, [data, filter]);

  const filters = useSectionFilters<WorkspaceDoc>({
    items,
    sectionSlug,
    searchKeys: [
      (item) => item.title,
      (item) => item.description ?? "",
      (item) => item.tags?.join(" "),
    ],
    getCreatedAt: (item) => item.createdAt,
  });

  function handleDownload(doc: WorkspaceDoc) {
    if (!doc.bucket || !doc.objectPath) {
      toast({ title: t("home.documentsHub.preview.unavailable"), variant: "destructive" });
      return;
    }
    void downloadStorageUrl(doc.bucket, doc.objectPath, doc.title);
  }

  function handleViewInNewTab(doc: WorkspaceDoc) {
    if (!doc.bucket || !doc.objectPath) {
      toast({ title: t("home.documentsHub.preview.unavailable"), variant: "destructive" });
      return;
    }
    void openStorageUrlInNewTab(doc.bucket, doc.objectPath);
  }

  return (
    <>
      <SectionChrome
        title={t(titleKey)}
        subtitle={subtitleKey ? t(subtitleKey) : undefined}
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
      >
        {filters.paged.length === 0 ? (
          <EmptyState
            icon={emptyIcon}
            title={t(emptyTitleKey)}
            body={t(emptyBodyKey)}
          />
        ) : (
          <TileGrid>
            {filters.paged.map((doc) => {
              const isAi = doc.origin === "ai_generated";
              const isMedia = doc.mimeType?.startsWith("image/") || doc.mimeType?.startsWith("video/");
              const TileIcon = isMedia ? Image : isAi ? StickyNote : FileText;
              return (
                <FileTile
                  key={doc.id}
                  title={doc.title}
                  description={doc.description ?? null}
                  icon={TileIcon}
                  dateAdded={doc.createdAt.slice(0, 10)}
                  onClick={() => setPreviewDoc(doc)}
                  onView={doc.bucket ? () => handleViewInNewTab(doc) : undefined}
                  onDownload={doc.bucket ? () => handleDownload(doc) : undefined}
                  viewLabel={t("home.documentsHub.preview.openInNewTab")}
                  downloadLabel={t("home.documentsHub.preview.download")}
                />
              );
            })}
          </TileGrid>
        )}
      </SectionChrome>

      <FilePreviewDialog
        open={previewDoc !== null}
        onOpenChange={(open) => { if (!open) setPreviewDoc(null); }}
        doc={previewDoc ? toPreview(previewDoc) : null}
      />
    </>
  );
}
