// Public download page for a project document: rovno.ai/share/document/:token
//
// Opened without a session by whoever holds the link. Everything it knows
// comes from the get-shared-document Edge Function (see
// data/document-share-source.ts): title, filename, size, MIME type and a
// short-lived signed URL. The token is the only credential; a revoked,
// reclassified or archived document answers "not found" and nothing else.

import { useState } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Download, ExternalLink, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/EmptyState";
import { toast } from "@/hooks/use-toast";
import { useDocumentHead } from "@/lib/blog/seo";
import { fetchSharedDocument, type SharedDocumentFile } from "@/data/document-share-source";
import { downloadFromUrl } from "@/components/home/documents-hub/storage-urls";
import { formatFileSize } from "@/lib/format-file-size";

const SHARED_DOCUMENT_STALE_TIME_MS = 5 * 60_000;

// An unparseable expiry counts as EXPIRED: isSharedDocumentFile only checks
// that expiresAt is a string, so a malformed value must send us back to the
// function rather than keep a URL we cannot reason about.
function isExpired(file: SharedDocumentFile): boolean {
  const expiresAt = Date.parse(file.expiresAt);
  return !Number.isFinite(expiresAt) || expiresAt <= Date.now();
}

export default function ShareDocument() {
  const { token = "" } = useParams<{ token: string }>();
  const { t, i18n } = useTranslation();
  const [downloading, setDownloading] = useState(false);

  const query = useQuery({
    queryKey: ["document-share", token],
    queryFn: () => fetchSharedDocument(token),
    enabled: Boolean(token),
    staleTime: SHARED_DOCUMENT_STALE_TIME_MS,
    retry: 1,
  });

  const file = query.data ?? null;

  // A public page, but not one search engines should list: the link is the
  // credential, and the title is customer data.
  useDocumentHead({
    title: file?.title ? `${file.title} | ${t("share.document.title")}` : t("share.document.title"),
    robots: "noindex, nofollow",
  });

  async function resolveFreshFile(): Promise<SharedDocumentFile | null> {
    if (file && !isExpired(file)) return file;
    // The signed URL lives ten minutes; a page left open longer asks again.
    // refetch() resolves with the PREVIOUS data when the refetch itself fails,
    // so an errored result must not be handed back as fresh: the caller would
    // send the visitor to an expired URL.
    const result = await query.refetch();
    if (result.isError || !result.isSuccess) return null;
    return result.data ?? null;
  }

  async function handleDownload() {
    if (!file || downloading) return;
    setDownloading(true);
    try {
      const fresh = await resolveFreshFile();
      const ok = fresh
        ? await downloadFromUrl(fresh.signedUrl, fresh.filename || fresh.title, fresh.filename)
        : false;
      if (!ok) {
        toast({ title: t("share.document.downloadFailed"), variant: "destructive" });
      }
    } finally {
      setDownloading(false);
    }
  }

  async function handleOpenInNewTab() {
    // Open synchronously inside the click so the popup blocker stays quiet,
    // then point the tab once a fresh URL is known (same shape as
    // openStorageUrlInNewTab).
    const tab = window.open("about:blank", "_blank");
    if (tab) tab.opener = null;
    const fresh = await resolveFreshFile();
    if (!fresh) {
      tab?.close();
      toast({ title: t("share.document.downloadFailed"), variant: "destructive" });
      return;
    }
    if (tab) {
      tab.location.href = fresh.signedUrl;
    } else {
      window.open(fresh.signedUrl, "_blank", "noopener,noreferrer");
    }
  }

  if (!token || (query.isSuccess && !file)) {
    return (
      <div className="p-sp-3">
        <EmptyState
          icon={AlertTriangle}
          title={t("share.document.notFoundTitle")}
          description={t("share.document.notFoundBody")}
        />
      </div>
    );
  }

  if (query.isError) {
    return (
      <div className="p-sp-3">
        <EmptyState
          icon={AlertTriangle}
          title={t("share.document.errorTitle")}
          description={t("share.document.errorBody")}
          actionLabel={t("share.document.retry")}
          onAction={() => { void query.refetch(); }}
        />
      </div>
    );
  }

  if (!file) {
    return (
      <div className="mx-auto max-w-3xl p-sp-3 space-y-sp-2" aria-busy="true">
        <Skeleton className="h-24 w-full rounded-card" />
        <Skeleton className="h-64 w-full rounded-card" />
      </div>
    );
  }

  const isImage = file.mimeType?.startsWith("image/") ?? false;
  const isPdf = file.mimeType === "application/pdf";

  return (
    <div className="mx-auto max-w-3xl p-sp-3 space-y-sp-2">
      <div className="rounded-card border border-border bg-card p-sp-2 space-y-2">
        <div className="flex items-start gap-3">
          <div className="rounded-panel bg-muted/50 p-2 text-muted-foreground">
            <FileText className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-semibold text-foreground break-words">{file.title}</h1>
            <p className="text-caption text-muted-foreground">{t("share.document.subtitle")}</p>
          </div>
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-caption">
          <dt className="text-muted-foreground">{t("share.document.fileLabel")}</dt>
          <dd className="text-foreground break-all">{file.filename}</dd>
          {file.sizeBytes != null && file.sizeBytes > 0 && (
            <>
              <dt className="text-muted-foreground">{t("share.document.sizeLabel")}</dt>
              <dd className="text-foreground">{formatFileSize(file.sizeBytes, i18n.language)}</dd>
            </>
          )}
        </dl>
        <div className="flex flex-wrap gap-2 pt-1">
          <Button onClick={() => { void handleDownload(); }} disabled={downloading}>
            <Download className="h-4 w-4 mr-1.5" />
            {t("share.document.download")}
          </Button>
          <Button variant="outline" onClick={() => { void handleOpenInNewTab(); }}>
            <ExternalLink className="h-4 w-4 mr-1.5" />
            {t("share.document.openInNewTab")}
          </Button>
        </div>
      </div>

      <div className="rounded-card border border-border bg-card p-sp-2">
        {isImage ? (
          <img src={file.signedUrl} alt={file.title} className="mx-auto max-h-[70vh] rounded-md object-contain" />
        ) : isPdf ? (
          <iframe
            src={file.signedUrl}
            title={file.title}
            className="h-[70vh] w-full rounded-md border border-border"
          />
        ) : (
          <p className="text-body-sm text-muted-foreground">{t("share.document.noInlinePreview")}</p>
        )}
      </div>
    </div>
  );
}
