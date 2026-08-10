import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Building2, Image as ImageIcon } from "lucide-react";
import { useActiveOrg, useOrgDocuments } from "@/hooks/use-orgs";
import type { OrgDoc } from "@/data/org-source";
import { SectionChrome } from "@/components/home/documents-hub/SectionChrome";
import { TileGrid, FileTile } from "@/components/home/documents-hub/tiles";
import { EmptyState } from "@/components/home/documents-hub/EmptyState";
import { FilePreviewDialog, type PreviewableDocument } from "@/components/home/documents-hub/FilePreviewDialog";
import { downloadStorageUrl, openStorageUrlInNewTab } from "@/components/home/documents-hub/storage-urls";
import { toast } from "@/hooks/use-toast";
import { useSectionFilters } from "@/hooks/use-section-filters";
import { isMediaMime } from "@/components/home/documents-hub/leaves/MyMediaView";

function toPreview(doc: OrgDoc): PreviewableDocument {
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

export function OrgMediaView() {
  const { t } = useTranslation();
  const activeOrg = useActiveOrg();
  const { data } = useOrgDocuments(activeOrg?.id);
  const [previewDoc, setPreviewDoc] = useState<OrgDoc | null>(null);

  const items = useMemo(() => (data ?? []).filter((d) => isMediaMime(d.mimeType)), [data]);
  const filters = useSectionFilters<OrgDoc>({
    items,
    sectionSlug: "org-media",
    searchKeys: [(item) => item.title, (item) => item.description ?? ""],
    getCreatedAt: (item) => item.createdAt,
  });

  function handleDownload(doc: OrgDoc) {
    if (!doc.bucket || !doc.objectPath) return;
    void downloadStorageUrl(doc.bucket, doc.objectPath, doc.title).then((ok) => {
      // rovno #284 round 3: the helper reports every failure (signing, HTTP,
      // network) through its return value - discarding it made a dead object a
      // silent no-op in this view while ProjectDocuments showed a toast.
      if (!ok) toast({ title: t("documents.preview.downloadFailed"), variant: "destructive" });
    });
  }
  function handleViewInNewTab(doc: OrgDoc) {
    if (!doc.bucket || !doc.objectPath) return;
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

  return (
    <>
      <SectionChrome
        title={t("home.documentsHub.leaves.orgMedia.title")}
        subtitle={t("home.documentsHub.leaves.orgMedia.subtitle")}
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
            icon={ImageIcon}
            title={t("home.documentsHub.leaves.orgMedia.emptyTitle")}
            body={t("home.documentsHub.leaves.orgMedia.emptyBody")}
          />
        ) : (
          <TileGrid>
            {filters.paged.map((doc) => (
              <FileTile
                key={doc.id}
                title={doc.title}
                description={doc.description ?? null}
                icon={ImageIcon}
                dateAdded={doc.createdAt.slice(0, 10)}
                onClick={() => setPreviewDoc(doc)}
                onView={doc.bucket ? () => handleViewInNewTab(doc) : undefined}
                onDownload={doc.bucket ? () => handleDownload(doc) : undefined}
                viewLabel={t("home.documentsHub.preview.openInNewTab")}
                downloadLabel={t("home.documentsHub.preview.download")}
              />
            ))}
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
