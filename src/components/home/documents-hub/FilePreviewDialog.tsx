import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Download, ExternalLink } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { downloadStorageUrl } from "./storage-urls";
import { sanitizeOfficeHtml } from "./sanitize-office-html";
import type { DocPreviewKind, DocPreviewResponse } from "./docPreview.worker";

export interface PreviewableDocument {
  id: string;
  title: string;
  type?: string;
  origin?: string;
  description?: string | null;
  tags?: string[];
  createdAt?: string | null;
  updatedAt?: string | null;
  scope?: "personal" | "org";
  bucket?: string;
  objectPath?: string;
  mimeType?: string;
}

interface FilePreviewDialogProps {
  doc: PreviewableDocument | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// Cap inline text rendering so a huge text/csv file can't freeze the dialog.
// Applied to a Range-limited fetch (we only download the first chunk) and to the
// rendered string length (UTF-16 code units, not bytes).
const MAX_TEXT_PREVIEW_CHARS = 200_000;
const TEXT_RANGE_BYTES = 400_000; // fetch only the first chunk (~2x chars for Cyrillic)

// Office files are parsed in a Web Worker; cap the input byte size so we don't
// hand a huge buffer to the worker. Over the cap we fall back to download.
const MAX_OFFICE_PREVIEW_BYTES = 8_000_000;

export function FilePreviewDialog({ doc, open, onOpenChange }: FilePreviewDialogProps) {
  const { t } = useTranslation();
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [urlLoading, setUrlLoading] = useState(false);

  useEffect(() => {
    if (!open || !doc || !doc.bucket || !doc.objectPath) {
      setSignedUrl(null);
      return;
    }
    let cancelled = false;
    setUrlLoading(true);
    setSignedUrl(null);
    supabase.storage
      .from(doc.bucket)
      .createSignedUrl(doc.objectPath, 3600)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error || !data?.signedUrl) {
          setSignedUrl(null);
        } else {
          setSignedUrl(data.signedUrl);
        }
        setUrlLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setSignedUrl(null);
        setUrlLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, doc]);

  const isImage = doc?.mimeType?.startsWith("image/");
  const isPdf = doc?.mimeType === "application/pdf";
  const isVideo = doc?.mimeType?.startsWith("video/");
  const isText = doc?.mimeType?.startsWith("text/") || doc?.mimeType === "application/json";
  const isDocx = doc?.mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  const isXlsx = doc?.mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    || doc?.mimeType === "application/vnd.ms-excel";
  const isOffice = isDocx || isXlsx;

  // Fetch text/csv content client-side and render as plain text (no HTML
  // interpretation, so no script-injection surface).
  const [textContent, setTextContent] = useState<string | null>(null);
  const [textLoading, setTextLoading] = useState(false);

  useEffect(() => {
    if (!open || !signedUrl || !isText) {
      setTextContent(null);
      return;
    }
    let cancelled = false;
    setTextLoading(true);
    setTextContent(null);
    // Range request so we only download the first chunk, not a multi-GB "text"
    // file. Supabase storage honors Range; servers that ignore it still get
    // capped by the slice below.
    fetch(signedUrl, { headers: { Range: `bytes=0-${TEXT_RANGE_BYTES - 1}` } })
      .then((res) => res.arrayBuffer())
      .then((buf) => {
        if (cancelled) return;
        // Decode with stream:true so a multibyte char split at the Range byte
        // boundary is dropped cleanly instead of surfacing as a trailing "�".
        const body = new TextDecoder("utf-8").decode(buf, { stream: true });
        setTextContent(
          body.length > MAX_TEXT_PREVIEW_CHARS
            ? `${body.slice(0, MAX_TEXT_PREVIEW_CHARS)}\n…`
            : body,
        );
        setTextLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setTextContent(null);
        setTextLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, signedUrl, isText]);

  // Office preview (docx via mammoth, xlsx via SheetJS) rendered fully
  // client-side: the file is fetched from the signed URL and parsed in the
  // browser, so no document data goes to any third party. mammoth/SheetJS emit
  // HTML from untrusted file content, so it is run through DOMPurify before being
  // injected. pptx and legacy .doc have no client-side renderer here and fall
  // through to open-in-new-tab / download.
  const [officeHtml, setOfficeHtml] = useState<string | null>(null);
  const [officeLoading, setOfficeLoading] = useState(false);
  // True when the worker clamped the output (too many sheets/rows/cols or chars).
  const [officeTruncated, setOfficeTruncated] = useState(false);

  useEffect(() => {
    if (!open || !signedUrl || !isOffice) {
      setOfficeHtml(null);
      setOfficeTruncated(false);
      return;
    }
    let cancelled = false;
    let worker: Worker | null = null;
    setOfficeLoading(true);
    setOfficeHtml(null);
    setOfficeTruncated(false);
    const kind: DocPreviewKind = isDocx ? "docx" : "xlsx";

    fetch(signedUrl)
      .then((res) => {
        // Skip the download entirely when the server advertises an oversize file.
        const advertised = Number(res.headers.get("content-length") ?? 0);
        if (advertised > MAX_OFFICE_PREVIEW_BYTES) {
          res.body?.cancel();
          return null;
        }
        return res.arrayBuffer();
      })
      .then((buf) => {
        if (cancelled) return;
        // Oversize fallback: no Content-Length (e.g. chunked) but the body still
        // came over the cap, or the pre-check above already bailed with null.
        if (!buf || buf.byteLength > MAX_OFFICE_PREVIEW_BYTES) {
          setOfficeHtml(null);
          setOfficeLoading(false);
          return;
        }
        // Parse in a worker (off main thread, prototype-pollution contained).
        worker = new Worker(new URL("./docPreview.worker.ts", import.meta.url), { type: "module" });
        worker.onmessage = (event: MessageEvent<DocPreviewResponse>) => {
          if (cancelled) return;
          // Sanitize the worker's raw HTML here (DOMPurify needs a DOM). Empty
          // output (parse failure / all stripped) renders the no-preview message.
          const clean = event.data.ok ? sanitizeOfficeHtml(event.data.html) : "";
          setOfficeHtml(clean.length > 0 ? clean : null);
          setOfficeTruncated(event.data.ok && event.data.truncated && clean.length > 0);
          setOfficeLoading(false);
          worker?.terminate();
          worker = null;
        };
        worker.onerror = () => {
          if (cancelled) return;
          setOfficeHtml(null);
          setOfficeLoading(false);
          worker?.terminate();
          worker = null;
        };
        // Transfer the buffer to the worker (detaches it from this thread).
        worker.postMessage({ kind, buffer: buf }, [buf]);
      })
      .catch(() => {
        if (cancelled) return;
        setOfficeHtml(null);
        setOfficeLoading(false);
      });
    return () => {
      cancelled = true;
      worker?.terminate();
    };
  }, [open, signedUrl, isOffice, isDocx]);

  const previewable = isImage || isPdf || isVideo || isText || isOffice;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-hidden flex flex-col p-0 gap-0">
        <DialogHeader className="border-b border-border px-5 py-4">
          <DialogTitle className="truncate">{doc?.title ?? t("home.documentsHub.preview.title")}</DialogTitle>
          {doc?.description && (
            <DialogDescription className="line-clamp-2">{doc.description}</DialogDescription>
          )}
          {!doc?.description && (
            <DialogDescription className="sr-only">
              {t("home.documentsHub.preview.descriptionFallback")}
            </DialogDescription>
          )}
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {(urlLoading || (isText && textLoading) || (isOffice && officeLoading)) && (
            <Skeleton className="h-48 w-full" />
          )}
          {!urlLoading && signedUrl && isImage && (
            <img src={signedUrl} alt="" className="mx-auto max-h-[60vh] rounded-md object-contain" />
          )}
          {!urlLoading && signedUrl && isPdf && (
            <iframe
              src={signedUrl}
              title={doc?.title ?? "preview"}
              className="h-[60vh] w-full rounded-md border border-border"
            />
          )}
          {!urlLoading && signedUrl && isVideo && (
            <video
              src={signedUrl}
              controls
              className="mx-auto max-h-[60vh] w-full rounded-md"
            />
          )}
          {!urlLoading && signedUrl && isText && !textLoading && textContent !== null && (
            <pre className="max-h-[60vh] overflow-auto rounded-md border border-border bg-muted/30 p-3 text-caption text-foreground whitespace-pre-wrap break-words">
              {textContent}
            </pre>
          )}
          {!urlLoading && signedUrl && isOffice && !officeLoading && officeHtml !== null && (
            // officeHtml is DOMPurify-sanitized above before injection.
            <div
              className="max-h-[60vh] overflow-auto rounded-md border border-border bg-background p-4 text-body-sm [&_table]:border-collapse [&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-border [&_th]:px-2 [&_th]:py-1 [&_h4]:mt-3 [&_h4]:font-semibold [&_p]:my-2 [&_a]:text-accent [&_a]:underline"
              dangerouslySetInnerHTML={{ __html: officeHtml }}
            />
          )}
          {!urlLoading && signedUrl && isOffice && !officeLoading && officeHtml !== null && officeTruncated && (
            <p className="mt-2 text-caption text-muted-foreground">
              {t("home.documentsHub.preview.truncated")}
            </p>
          )}
          {!urlLoading && signedUrl && isOffice && !officeLoading && officeHtml === null && (
            <p className="text-body-sm text-muted-foreground">
              {t("home.documentsHub.preview.noInlinePreview")}
            </p>
          )}
          {!urlLoading && signedUrl && !previewable && (
            <p className="text-body-sm text-muted-foreground">
              {t("home.documentsHub.preview.noInlinePreview")}
            </p>
          )}
          {!urlLoading && !signedUrl && doc?.bucket && (
            <p className="text-body-sm text-muted-foreground">
              {t("home.documentsHub.preview.unavailable")}
            </p>
          )}
          {!doc?.bucket && doc?.description && (
            <div className="rounded-panel border border-border bg-muted/30 p-4">
              <p className="whitespace-pre-wrap text-body-sm text-foreground">{doc.description}</p>
            </div>
          )}

          {doc?.createdAt && (
            <p className="text-caption text-muted-foreground">
              {t("home.documentsHub.preview.fieldCreated")}: {doc.createdAt.slice(0, 10)}
            </p>
          )}
        </div>

        <DialogFooter className="border-t border-border px-5 py-4 gap-2 sm:gap-2">
          {signedUrl && (
            <>
              <Button asChild variant="outline">
                <a href={signedUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="h-4 w-4 mr-1.5" />
                  {t("home.documentsHub.preview.openInNewTab")}
                </a>
              </Button>
              {doc?.bucket && doc?.objectPath && (
                <Button
                  onClick={() => {
                    // rovno #284: an `<a href={signedUrl} download>` is the S2 defect
                    // this branch repairs - the download attribute is ignored on a
                    // cross-origin href, so this anchor NAVIGATED the SPA instead of
                    // saving. Route through the same fetch-to-blob helper as the tiles.
                    void downloadStorageUrl(doc.bucket!, doc.objectPath!, doc.title).then((ok) => {
                      if (!ok) toast({ title: t("documents.preview.downloadFailed"), variant: "destructive" });
                    });
                  }}
                >
                  <Download className="h-4 w-4 mr-1.5" />
                  {t("home.documentsHub.preview.download")}
                </Button>
              )}
            </>
          )}
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("common.close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
