import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { trackEvent } from "@/lib/analytics";
import {
  Archive,
  Building2,
  Download,
  Eye,
  Lock,
  MessageSquare,
  Plus,
  Printer,
  Share2,
  Trash2,
  Upload,
  CheckCircle2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FileInput } from "@/components/ui/file-input";
import { DOCUMENT_UPLOAD_ACCEPT } from "@/lib/document-file-types";
import { downloadStorageUrl } from "@/components/home/documents-hub/FilePreviewDialog";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ConfirmModal } from "@/components/ConfirmModal";
import { DocumentGridCard } from "@/components/documents/DocumentGridCard";
import { DocumentListItem } from "@/components/documents/DocumentListItem";
import { VisibilityClassBadge } from "@/components/documents/VisibilityClassBadge";
import { DocumentsViewModeToggle, type DocumentViewMode } from "@/components/documents/DocumentsViewModeToggle";
import { PreviewCard } from "@/components/ai/PreviewCard";
import { ActionBar } from "@/components/ai/ActionBar";
import { ProjectWorkflowEmptyState } from "@/components/ProjectWorkflowEmptyState";
import { TutorialModal } from "@/components/onboarding/TutorialModal";
import { ImportDocumentsDialog, type ImportSourceKind } from "@/components/documents/ImportDocumentsDialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { useActiveOrg, useImportDocumentsToProject, useOrgDocuments } from "@/hooks/use-orgs";
import { useWorkspaceDocuments } from "@/hooks/use-workspace-documents-source";
import { documentsMediaQueryKeys } from "@/hooks/use-documents-media-source";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser, useProject, useWorkspaceMode } from "@/hooks/use-mock-data";
import {
  useProjectDocumentMutations,
  useProjectDocumentsState,
  useDocumentUploadMutations,
} from "@/hooks/use-documents-media-source";
import {
  getProjectDomainAccess,
  projectDomainAllowsContribute,
  usePermission,
} from "@/lib/permissions";
import { resolveActionState } from "@/lib/permission-contract-actions";
import {
  addDocument,
  addDocumentVersion,
  addEvent,
  deleteDocument as deleteDocumentLocal,
} from "@/data/store";
import type { DocMediaVisibilityClass, Document as DocType } from "@/types/entities";
import {
  canViewInternalDocuments,
  effectiveInternalDocsVisibilityForSeam,
} from "@/lib/internal-docs-visibility";
import type { ProposalChange } from "@/types/ai";

const DOCUMENT_DEFAULT_TYPE = "specification";

interface ImportVisibilitySelectorProps {
  value: DocMediaVisibilityClass;
  onChange: (value: DocMediaVisibilityClass) => void;
  canSelectInternal: boolean;
  disabled?: boolean;
  t: (key: string) => string;
}

function ImportVisibilitySelector({
  value,
  onChange,
  canSelectInternal,
  disabled,
  t,
}: ImportVisibilitySelectorProps) {
  return (
    <div className="space-y-2 pt-2 border-t border-border">
      <Label className="text-body-sm font-medium text-foreground">
        {t("documents.upload.visibilityLabel")}
      </Label>
      <RadioGroup
        value={value}
        onValueChange={(v) => onChange(v as DocMediaVisibilityClass)}
        className="flex flex-col gap-2"
        disabled={disabled}
      >
        <div className="flex items-center space-x-2">
          <RadioGroupItem value="shared_project" id="import-vis-shared" />
          <Label htmlFor="import-vis-shared" className="font-normal cursor-pointer">
            {t("documents.upload.sharedLabel")}
          </Label>
        </div>
        <div className="flex items-start space-x-2">
          <RadioGroupItem
            value="internal"
            id="import-vis-internal"
            disabled={!canSelectInternal}
          />
          <div className="grid gap-0.5">
            <Label
              htmlFor="import-vis-internal"
              className={`font-normal ${canSelectInternal ? "cursor-pointer" : "text-muted-foreground"}`}
            >
              {t("documents.upload.internalLabel")}
            </Label>
            {!canSelectInternal && (
              <p className="text-caption text-muted-foreground pl-0">
                {t("documents.upload.internalDisabledHint")}
              </p>
            )}
          </div>
        </div>
      </RadioGroup>
    </div>
  );
}

function ProjectDocumentsSkeleton() {
  return (
    <div className="glass rounded-card p-sp-2" data-testid="documents-skeleton">
      <div className="space-y-3">
        <Skeleton className="h-11 rounded-panel" />
        <Skeleton className="h-11 rounded-panel" />
        <Skeleton className="h-11 rounded-panel" />
      </div>
    </div>
  );
}

function buildDocumentDownloadName(title: string) {
  const normalized = title.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `${normalized || "document"}.txt`;
}

function formatDocumentDate(timestamp?: string) {
  if (!timestamp) return null;
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return null;
  return format(date, "MMM d, yyyy");
}

export default function ProjectDocuments() {
  const { t } = useTranslation();
  const { id: projectId } = useParams<{ id: string }>();
  const pid = projectId!;
  const { documents, isLoading } = useProjectDocumentsState(pid);
  const { project } = useProject(pid);
  const workspaceMode = useWorkspaceMode();
  const perm = usePermission(pid);
  const user = useCurrentUser();
  const {
    archiveDocument,
    deleteDocument: deleteDocumentMutation,
  } = useProjectDocumentMutations(pid);
  const {
    prepareUpload,
    uploadBytes,
    finalizeUpload,
  } = useDocumentUploadMutations(pid);
  const isSupabaseMode = workspaceMode.kind === "supabase";
  const commentsAccess = getProjectDomainAccess(perm.seam, "comments");
  const canUploadDocuments = resolveActionState(perm.role, "documents_media", "upload") === "enabled";
  const canDeleteDocuments = resolveActionState(perm.role, "documents_media", "delete") === "enabled";
  const canManageDocuments = resolveActionState(perm.role, "documents_media", "rename_or_archive") === "enabled";
  const canCommentOnDocuments = !isSupabaseMode && projectDomainAllowsContribute(commentsAccess);

  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadTitle, setUploadTitle] = useState("");
  const [uploadVisibilityClass, setUploadVisibilityClass] = useState<DocMediaVisibilityClass>("shared_project");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [pendingFinalizeIntentId, setPendingFinalizeIntentId] = useState<string | null>(null);
  const [importDialog, setImportDialog] = useState<ImportSourceKind | null>(null);
  const activeOrg = useActiveOrg();
  const [uploadTab, setUploadTab] = useState<"computer" | "personal" | "org">("computer");
  const [personalSelected, setPersonalSelected] = useState<Set<string>>(new Set());
  const [orgSelected, setOrgSelected] = useState<Set<string>>(new Set());
  const [importVisibilityClass, setImportVisibilityClass] = useState<DocMediaVisibilityClass>("shared_project");
  const personalDocsQuery = useWorkspaceDocuments(isSupabaseMode ? user.id : undefined);
  const orgDocsQuery = useOrgDocuments(activeOrg?.id);
  const importToProjectMutation = useImportDocumentsToProject(pid);
  const projectDocsQueryClient = useQueryClient();
  const [generateOpen, setGenerateOpen] = useState(false);
  const [generateTitle, setGenerateTitle] = useState("");
  const [generateContent, setGenerateContent] = useState("");
  const [showGenPreview, setShowGenPreview] = useState(false);
  const [viewDoc, setViewDoc] = useState<DocType | null>(null);
  const [archiveDocId, setArchiveDocId] = useState<string | null>(null);
  const [deleteDocId, setDeleteDocId] = useState<string | null>(null);
  const [commentOpen, setCommentOpen] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [viewMode, setViewMode] = useState<DocumentViewMode>("list");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const effectiveInternalDocs = useMemo(
    () => effectiveInternalDocsVisibilityForSeam(perm.seam.membership),
    [perm.seam.membership],
  );
  const canSelectInternalUpload = canViewInternalDocuments(effectiveInternalDocs);
  const showDocumentVisibilityBadges = canSelectInternalUpload;

  useEffect(() => {
    if (!canSelectInternalUpload && uploadVisibilityClass === "internal") {
      setUploadVisibilityClass("shared_project");
    }
  }, [canSelectInternalUpload, uploadVisibilityClass]);

  const activeDocuments = documents.filter((document) => {
    const latestVersion = document.versions[document.versions.length - 1];
    return latestVersion?.status !== "archived";
  });
  const archivedDocuments = documents.filter((document) => {
    const latestVersion = document.versions[document.versions.length - 1];
    return latestVersion?.status === "archived";
  });

  function closeUploadDialog() {
    setUploadOpen(false);
    setUploadTitle("");
    setUploadVisibilityClass("shared_project");
    setUploadFile(null);
    setUploading(false);
    setPendingFinalizeIntentId(null);
    setUploadTab("computer");
    setPersonalSelected(new Set());
    setOrgSelected(new Set());
    setImportVisibilityClass("shared_project");
  }

  function togglePersonalSelected(id: string) {
    setPersonalSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleOrgSelected(id: string) {
    setOrgSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleAttachPersonal() {
    if (personalSelected.size === 0 || importToProjectMutation.isPending) return;
    try {
      const result = await importToProjectMutation.mutateAsync({
        kind: "workspace",
        documentIds: Array.from(personalSelected),
        visibilityClass: importVisibilityClass,
      });
      if (isSupabaseMode) {
        await projectDocsQueryClient.invalidateQueries({
          queryKey: documentsMediaQueryKeys.projectDocuments(user.id, pid),
        });
      }
      toast({ title: t("documents.import.success", { count: result.count }) });
      closeUploadDialog();
    } catch (error) {
      toast({
        title: t("documents.import.error"),
        description: error instanceof Error ? error.message : undefined,
        variant: "destructive",
      });
    }
  }

  async function handleAttachOrg() {
    if (orgSelected.size === 0 || importToProjectMutation.isPending) return;
    try {
      const result = await importToProjectMutation.mutateAsync({
        kind: "org",
        documentIds: Array.from(orgSelected),
        visibilityClass: importVisibilityClass,
      });
      if (isSupabaseMode) {
        await projectDocsQueryClient.invalidateQueries({
          queryKey: documentsMediaQueryKeys.projectDocuments(user.id, pid),
        });
      }
      toast({ title: t("documents.import.success", { count: result.count }) });
      closeUploadDialog();
    } catch (error) {
      toast({
        title: t("documents.import.error"),
        description: error instanceof Error ? error.message : undefined,
        variant: "destructive",
      });
    }
  }

  async function handleUpload() {
    const title = uploadTitle.trim() || uploadFile?.name || t("documents.upload.untitled");

    if (!isSupabaseMode) {
      const docId = `doc-${Date.now()}`;
      const versionId = `dv-${Date.now()}`;
      addDocument({
        id: docId,
        project_id: pid,
        type: DOCUMENT_DEFAULT_TYPE,
        title,
        origin: "uploaded",
        visibility_class: uploadVisibilityClass,
        versions: [{
          id: versionId,
          document_id: docId,
          number: 1,
          status: "draft",
          content: "Uploaded document content placeholder.",
        }],
      });
      addEvent({
        id: `evt-${Date.now()}`,
        project_id: pid,
        actor_id: user.id,
        type: "document_created",
        object_type: "document",
        object_id: docId,
        timestamp: new Date().toISOString(),
        payload: { title },
      });
      trackEvent("document_uploaded", { project_id: pid, origin: "uploaded" });
      closeUploadDialog();
      // Defer the toast until after the dialog close animation so it doesn't flash over the modal.
      window.setTimeout(() => {
        toast({ title: t("documents.upload.uploadedTitle"), description: title });
      }, 250);
      return;
    }

    if (!uploadFile) {
      toast({ title: t("documents.upload.selectFile"), variant: "destructive" });
      return;
    }

    setUploading(true);
    try {
      const intent = await prepareUpload({
        type: DOCUMENT_DEFAULT_TYPE,
        title,
        clientFilename: uploadFile.name,
        mimeType: uploadFile.type || "application/octet-stream",
        sizeBytes: uploadFile.size,
        visibilityClass: uploadVisibilityClass,
      });

      await uploadBytes(intent.bucket, intent.objectPath, uploadFile);

      setPendingFinalizeIntentId(intent.uploadIntentId);
      await finalizeUpload(intent.uploadIntentId);

      trackEvent("document_uploaded", { project_id: pid, origin: "uploaded" });
      closeUploadDialog();
      window.setTimeout(() => {
        toast({ title: t("documents.upload.uploadedTitle"), description: title });
      }, 250);
    } catch (error) {
      setUploading(false);
      toast({
        title: t("documents.upload.failedTitle"),
        description: error instanceof Error ? error.message : t("documents.upload.failedFallback"),
        variant: "destructive",
      });
    }
  }

  async function handleRetryFinalize() {
    if (!pendingFinalizeIntentId) return;

    setUploading(true);
    try {
      await finalizeUpload(pendingFinalizeIntentId);

      trackEvent("document_uploaded", { project_id: pid, origin: "uploaded" });
      closeUploadDialog();
      window.setTimeout(() => {
        toast({ title: t("documents.upload.uploadedTitle"), description: t("documents.upload.finalizedDescription") });
      }, 250);
    } catch (error) {
      setUploading(false);
      toast({
        title: t("documents.upload.finalizeFailedTitle"),
        description: error instanceof Error ? error.message : t("documents.upload.finalizeFailedFallback"),
        variant: "destructive",
      });
    }
  }

  function handleGeneratePreview() {
    setGenerateContent(t("documents.generate.bodyTemplate", {
      title: generateTitle,
      projectTitle: project?.title ?? t("documents.generate.projectFallback"),
    }));
    setShowGenPreview(true);
  }

  function handleGenerateConfirm() {
    if (isSupabaseMode) {
      toast({
        title: t("documents.generate.unavailableTitle"),
        description: t("documents.generate.unavailableDescription"),
        variant: "destructive",
      });
      return;
    }

    const docId = `doc-gen-${Date.now()}`;
    const versionId = `dv-gen-${Date.now()}`;
    addDocument({
      id: docId,
      project_id: pid,
      type: DOCUMENT_DEFAULT_TYPE,
      title: generateTitle || t("documents.generate.defaultTitle"),
      origin: "ai_generated",
      visibility_class: "shared_project",
      versions: [{
        id: versionId,
        document_id: docId,
        number: 1,
        status: "draft",
        content: generateContent,
      }],
    });

    trackEvent("ai_answer_saved_to_documents", {
      project_id: pid,
      surface: "documents",
      document_id: docId,
      content_length: generateContent.length,
    });

    addEvent({
      id: `evt-${Date.now()}`,
      project_id: pid,
      actor_id: user.id,
      type: "document_created",
      object_type: "document",
      object_id: docId,
      timestamp: new Date().toISOString(),
      payload: { title: generateTitle, generated: true },
    });
    setGenerateOpen(false);
    setShowGenPreview(false);
    setGenerateTitle("");
    setGenerateContent("");
    toast({ title: t("documents.generate.successTitle"), description: generateTitle });
  }

  async function handleArchive() {
    if (!archiveDocId) return;
    const document = documents.find((entry) => entry.id === archiveDocId);
    if (!document) return;
    const latestVersion = document.versions[document.versions.length - 1];

    if (!isSupabaseMode) {
      addDocumentVersion(archiveDocId, {
        ...latestVersion,
        id: `dv-arch-${Date.now()}`,
        number: document.versions.length + 1,
        status: "archived",
      });
      addEvent({
        id: `evt-${Date.now()}`,
        project_id: pid,
        actor_id: user.id,
        type: "document_archived",
        object_type: "document",
        object_id: archiveDocId,
        timestamp: new Date().toISOString(),
        payload: { title: document.title },
      });
      setArchiveDocId(null);
      toast({ title: t("documents.archiveConfirm.successTitle") });
      return;
    }

    try {
      await archiveDocument({
        documentId: archiveDocId,
        content: latestVersion?.content ?? "",
      });
      setArchiveDocId(null);
      toast({ title: t("documents.archiveConfirm.successTitle") });
    } catch (error) {
      toast({
        title: t("documents.archiveConfirm.failedTitle"),
        description: error instanceof Error ? error.message : t("documents.archiveConfirm.failedFallback"),
        variant: "destructive",
      });
    }
  }

  async function handleDelete() {
    if (!deleteDocId) return;
    const document = documents.find((entry) => entry.id === deleteDocId);

    if (!isSupabaseMode) {
      deleteDocumentLocal(deleteDocId);
      addEvent({
        id: `evt-${Date.now()}`,
        project_id: pid,
        actor_id: user.id,
        type: "document_deleted",
        object_type: "document",
        object_id: deleteDocId,
        timestamp: new Date().toISOString(),
        payload: { title: document?.title },
      });
      setDeleteDocId(null);
      setViewDoc(null);
      toast({ title: t("documents.deleteConfirm.successTitle") });
      return;
    }

    try {
      await deleteDocumentMutation(deleteDocId);
      setDeleteDocId(null);
      setViewDoc(null);
      toast({ title: t("documents.deleteConfirm.successTitle") });
    } catch (error) {
      toast({
        title: t("documents.deleteConfirm.failedTitle"),
        description: error instanceof Error ? error.message : t("documents.deleteConfirm.failedFallback"),
        variant: "destructive",
      });
    }
  }

  function handleAcknowledge(document: DocType) {
    addEvent({
      id: `evt-${Date.now()}`,
      project_id: pid,
      actor_id: user.id,
      type: "document_acknowledged",
      object_type: "document",
      object_id: document.id,
      timestamp: new Date().toISOString(),
      payload: { title: document.title },
    });
    setViewDoc(null);
    toast({ title: t("documents.preview.acknowledged"), description: document.title });
  }

  function handleComment() {
    if (!viewDoc || !commentText.trim()) return;
    addEvent({
      id: `evt-${Date.now()}`,
      project_id: pid,
      actor_id: user.id,
      type: "comment_added",
      object_type: "document",
      object_id: viewDoc.id,
      timestamp: new Date().toISOString(),
      payload: { text: commentText },
    });
    setCommentOpen(false);
    setCommentText("");
    toast({ title: t("documents.commentDialog.added") });
  }

  function handlePrintDocument() {
    window.print();
  }

  function handleDownloadDocument(projectDocument: DocType, content: string) {
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = window.document.createElement("a");
    link.href = url;
    link.download = buildDocumentDownloadName(projectDocument.title);
    window.document.body.appendChild(link);
    link.click();
    window.document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  /**
   * Download the document currently open in the preview dialog.
   *
   * rovno #284 slice S2. This used to be `window.open(previewUrl)`, which is not
   * a download at all: the preview signed URL carries no `Content-Disposition`,
   * so the browser decided what to do with it. A PDF opened in a new tab instead
   * of saving, the saved name was whatever the URL implied rather than the real
   * filename, and the whole thing was one popup-blocker away from doing nothing.
   *
   * `downloadStorageUrl` mints a SEPARATE signed URL with `{ download: filename }`
   * (Supabase then sends `Content-Disposition: attachment`) and clicks an
   * `<a download>`. The query parameter is the load-bearing half: the `download`
   * attribute alone is ignored on a cross-origin href, which is exactly what a
   * storage URL is.
   */
  async function handleDownloadViewedDocument() {
    if (!viewDoc || !latestViewedVersion) return;

    // Local/demo mode has no storage object; the body is inline text.
    if (!isSupabaseMode) {
      handleDownloadDocument(viewDoc, latestViewedVersion.content);
      return;
    }

    const storage = latestViewedVersion.storage;
    if (!storage?.bucket || !storage?.objectPath) return;

    // Prefer the stored filename: it carries the real extension. Falling back to
    // `buildDocumentDownloadName` would be wrong here - it appends `.txt`, which
    // is right for the inline-text path above and would mislabel a .docx.
    const filename = storage.filename?.trim() || viewDoc.title;
    const ok = await downloadStorageUrl(storage.bucket, storage.objectPath, filename);
    if (!ok) {
      toast({ title: t("documents.preview.downloadFailed"), variant: "destructive" });
    }
  }

  const generatePreviewChanges: ProposalChange[] = [
    { entity_type: "document", action: "create", label: generateTitle || t("documents.generate.previewChangeFallback"), after: t("documents.generate.previewChangeAfter") },
  ];

  const latestViewedVersion = viewDoc?.versions[viewDoc.versions.length - 1];
  const viewedDocumentIsArchived = latestViewedVersion?.status === "archived";
  const viewedStorage = latestViewedVersion?.storage;
  const viewedMimeType = viewedStorage?.mimeType ?? viewDoc?.file_meta?.mime ?? null;
  const canDownloadViewedDocument = Boolean(
    viewDoc
    && (
      (!isSupabaseMode && latestViewedVersion?.content.trim())
      || (isSupabaseMode && previewUrl)
    ),
  );

  useEffect(() => {
    if (!isSupabaseMode || !viewDoc || !viewedStorage?.bucket || !viewedStorage?.objectPath) {
      setPreviewUrl(null);
      setPreviewLoading(false);
      return;
    }

    let cancelled = false;
    setPreviewLoading(true);
    setPreviewUrl(null);

    supabase.storage
      .from(viewedStorage.bucket)
      .createSignedUrl(viewedStorage.objectPath, 3600)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error || !data?.signedUrl) {
          setPreviewUrl(null);
        } else {
          setPreviewUrl(data.signedUrl);
        }
        setPreviewLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setPreviewUrl(null);
        setPreviewLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isSupabaseMode, viewDoc, viewedStorage?.bucket, viewedStorage?.objectPath]);

  const showOnlyEmptyState = !isLoading && documents.length === 0;

  function renderDocumentMeta(document: DocType, archived = false) {
    const detailItems = [
      archived ? t("documents.meta.archived") : t("documents.meta.openPreview"),
      document.file_meta?.filename,
      formatDocumentDate(document.created_at),
    ].filter(Boolean) as string[];

    return detailItems.map((detail) => (
      <span key={`${document.id}-${detail}`} className="text-caption text-muted-foreground">
        {detail}
      </span>
    ));
  }

  function renderActiveDocumentActions(document: DocType) {
    return (
      <div className="flex gap-1">
        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setViewDoc(document)} title={t("documents.action.preview")}>
          <Eye className="h-3.5 w-3.5" />
        </Button>
        {canManageDocuments && (
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setArchiveDocId(document.id)} title={t("documents.action.archive")}>
            <Archive className="h-3.5 w-3.5" />
          </Button>
        )}
        {canDeleteDocuments && (
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setDeleteDocId(document.id)} title={t("documents.action.delete")}>
            <Trash2 className="h-3.5 w-3.5 text-destructive" />
          </Button>
        )}
      </div>
    );
  }

  function renderDocumentsSection(sectionDocuments: DocType[], archived = false) {
    if (sectionDocuments.length === 0) return null;

    if (viewMode === "grid") {
      return (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {sectionDocuments.map((document) => (
            <DocumentGridCard
              key={document.id}
              title={document.title}
              titleAdornment={showDocumentVisibilityBadges ? (
                <span className="inline-block mr-2 align-middle">
                  <VisibilityClassBadge visibilityClass={document.visibility_class} />
                </span>
              ) : undefined}
              onOpen={() => setViewDoc(document)}
              muted={archived}
              actions={archived ? (
                <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setViewDoc(document)} title={t("documents.action.preview")}>
                  <Eye className="h-3.5 w-3.5" />
                </Button>
              ) : renderActiveDocumentActions(document)}
              meta={renderDocumentMeta(document, archived)}
            />
          ))}
        </div>
      );
    }

    return (
      <div className={`glass rounded-card overflow-hidden ${archived ? "opacity-70" : ""}`}>
        <div className="divide-y divide-border">
          {sectionDocuments.map((document) => (
            <DocumentListItem
              key={document.id}
              title={document.title}
              titleAdornment={showDocumentVisibilityBadges ? (
                <span className="inline-block mr-2 align-middle">
                  <VisibilityClassBadge visibilityClass={document.visibility_class} />
                </span>
              ) : undefined}
              muted={archived}
              details={renderDocumentMeta(document, archived)}
              onOpen={() => setViewDoc(document)}
              trailing={archived ? (
                <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setViewDoc(document)} title={t("documents.action.preview")}>
                  <Eye className="h-3.5 w-3.5" />
                </Button>
              ) : renderActiveDocumentActions(document)}
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-sp-2">
      <TutorialModal
        tutorialKey="documents"
        steps={[
          {
            titleKey: "tutorial.documents.step1.title",
            descriptionKey: "tutorial.documents.step1.description",
            visual: (
              <div className="flex items-center justify-center gap-2">
                <div className="flex flex-col items-center gap-1 rounded-md border border-border bg-card px-3 py-2">
                  <Upload className="h-4 w-4 text-accent" />
                  <span className="text-caption text-foreground">{t("tutorial.documents.step1.upload")}</span>
                </div>
                <div className="flex flex-col items-center gap-1 rounded-md border border-border bg-card px-3 py-2">
                  <Printer className="h-4 w-4 text-accent" />
                  <span className="text-caption text-foreground">{t("tutorial.documents.step1.print")}</span>
                </div>
                <div className="flex flex-col items-center gap-1 rounded-md border border-border bg-card px-3 py-2">
                  <Download className="h-4 w-4 text-accent" />
                  <span className="text-caption text-foreground">{t("tutorial.documents.step1.download")}</span>
                </div>
              </div>
            ),
            icon: <Upload className="h-8 w-8 text-accent" />,
          },
          {
            titleKey: "tutorial.documents.step2.title",
            descriptionKey: "tutorial.documents.step2.description",
            visual: (
              <div className="w-full space-y-1.5">
                <div className="flex items-center gap-2 rounded-md border border-border bg-card px-2.5 py-1.5">
                  <Lock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <span className="text-caption text-foreground truncate">{t("tutorial.documents.step2.internalExample")}</span>
                  <span className="ml-auto rounded-pill bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">{t("tutorial.documents.step2.internalBadge")}</span>
                </div>
                <div className="flex items-center gap-2 rounded-md border border-accent/30 bg-accent/5 px-2.5 py-1.5">
                  <Share2 className="h-3.5 w-3.5 text-accent shrink-0" />
                  <span className="text-caption text-foreground truncate">{t("tutorial.documents.step2.sharedExample")}</span>
                  <span className="ml-auto rounded-pill bg-accent/20 px-2 py-0.5 text-[10px] font-medium text-accent">{t("tutorial.documents.step2.sharedBadge")}</span>
                </div>
              </div>
            ),
            icon: <Share2 className="h-8 w-8 text-accent" />,
          },
        ]}
      />
      {!showOnlyEmptyState && (
        <div className="glass-elevated rounded-card p-sp-2 flex items-center justify-between flex-wrap gap-2">
          <div>
            <h2 className="text-h3 text-foreground">{t("documents.title")}</h2>
            <p className="text-caption text-muted-foreground">
              {isLoading ? t("documents.loading") : t("documents.counts", { active: activeDocuments.length, archived: archivedDocuments.length })}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {documents.length > 0 && (
              <DocumentsViewModeToggle value={viewMode} onValueChange={setViewMode} />
            )}
            {canUploadDocuments && (
              <div className="flex gap-1.5 flex-wrap">
                <Button size="sm" variant="outline" onClick={() => setUploadOpen(true)}>
                  <Upload className="h-4 w-4 mr-1.5" /> {t("documents.action.upload")}
                </Button>
                {!isSupabaseMode && canManageDocuments && (
                  <Button size="sm" className="bg-accent text-accent-foreground hover:bg-accent/90" onClick={() => setGenerateOpen(true)}>
                    <Plus className="h-4 w-4 mr-1.5" /> {t("documents.action.generate")}
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {isLoading ? (
        <ProjectDocumentsSkeleton />
      ) : documents.length === 0 ? (
        <ProjectWorkflowEmptyState
          variant="documents"
          title={t("documents.empty.title")}
          description={isSupabaseMode
            ? t("documents.empty.descriptionSupabase")
            : t("documents.empty.descriptionLocal")}
          actionLabel={canUploadDocuments ? t("documents.empty.action") : undefined}
          onAction={canUploadDocuments ? () => setUploadOpen(true) : undefined}
        />
      ) : (
        <>
          {activeDocuments.length > 0 && (
            renderDocumentsSection(activeDocuments)
          )}

          {archivedDocuments.length > 0 && (
            <div className="space-y-1">
              <h3 className="text-body-sm font-semibold text-muted-foreground px-1">{t("documents.archivedHeading")}</h3>
              {renderDocumentsSection(archivedDocuments, true)}
            </div>
          )}
        </>
      )}

      <Dialog
        open={uploadOpen}
        onOpenChange={(open) => {
          if (open) {
            setUploadOpen(true);
            return;
          }
          closeUploadDialog();
        }}
      >
        <DialogContent className="bg-card border border-border rounded-modal max-w-lg shadow-xl p-0 gap-0 max-h-[85vh] flex flex-col [&>button.absolute]:hidden">
          <DialogHeader className="border-b border-border px-4 sm:px-5 py-3 sm:py-4 shrink-0">
            <DialogTitle>{t("documents.upload.title")}</DialogTitle>
            <DialogDescription>{t("documents.upload.description")}</DialogDescription>
          </DialogHeader>
          <Tabs value={uploadTab} onValueChange={(v) => setUploadTab(v as "computer" | "personal" | "org")} className="flex-1 flex flex-col min-h-0">
            <div className="px-4 sm:px-5 pt-3 sm:pt-4 shrink-0">
              <Select
                value={uploadTab}
                onValueChange={(v) => setUploadTab(v as "computer" | "personal" | "org")}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="computer">{t("documents.upload.tabs.computer")}</SelectItem>
                  <SelectItem value="personal" disabled={!isSupabaseMode}>
                    {t("documents.upload.tabs.personal")}
                  </SelectItem>
                  <SelectItem value="org" disabled={!isSupabaseMode || !activeOrg}>
                    {t("documents.upload.tabs.org")}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <TabsContent value="computer" className="m-0 flex-1 overflow-y-auto min-h-0">
              <div className="px-4 sm:px-5 py-3 sm:py-4 space-y-4">
                <div className="rounded-panel bg-warning/10 p-3 text-caption text-warning">
                  {t("documents.upload.piiWarning")}
                </div>
                {pendingFinalizeIntentId && (
                  <div className="rounded-panel bg-destructive/10 p-3 text-caption text-destructive">
                    {t("documents.upload.finalizeRetryNotice")}
                  </div>
                )}
                <div className="space-y-1">
                  <label className="text-body-sm font-medium text-foreground">{t("documents.upload.titleLabel")}</label>
                  <Input
                    value={uploadTitle}
                    onChange={(event) => setUploadTitle(event.target.value)}
                    placeholder={t("documents.upload.titlePlaceholder")}
                    autoFocus
                    disabled={uploading}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-body-sm font-medium text-foreground">{t("documents.upload.fileLabel")}</label>
                  <FileInput
                    accept={DOCUMENT_UPLOAD_ACCEPT}
                    disabled={uploading}
                    onChange={(event) => {
                      const file = event.target.files?.[0] ?? null;
                      setUploadFile(file);
                      if (file && !uploadTitle.trim()) {
                        setUploadTitle(file.name);
                      }
                    }}
                  />
                  <p className="text-caption text-muted-foreground">
                    {isSupabaseMode
                      ? t("documents.upload.fileHintSupabase")
                      : t("documents.upload.fileHintLocal")}
                  </p>
                </div>
                <div className="space-y-2">
                  <Label className="text-body-sm font-medium text-foreground">{t("documents.upload.visibilityLabel")}</Label>
                  <RadioGroup
                    value={uploadVisibilityClass}
                    onValueChange={(v) => setUploadVisibilityClass(v as DocMediaVisibilityClass)}
                    className="flex flex-col gap-2"
                    disabled={uploading}
                  >
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="shared_project" id="doc-vis-shared" />
                      <Label htmlFor="doc-vis-shared" className="font-normal cursor-pointer">
                        {t("documents.upload.sharedLabel")}
                      </Label>
                    </div>
                    <div className="flex items-start space-x-2">
                      <RadioGroupItem
                        value="internal"
                        id="doc-vis-internal"
                        disabled={!canSelectInternalUpload}
                      />
                      <div className="grid gap-0.5">
                        <Label
                          htmlFor="doc-vis-internal"
                          className={`font-normal ${canSelectInternalUpload ? "cursor-pointer" : "text-muted-foreground"}`}
                        >
                          {t("documents.upload.internalLabel")}
                        </Label>
                        {!canSelectInternalUpload && (
                          <p className="text-caption text-muted-foreground pl-0">
                            {t("documents.upload.internalDisabledHint")}
                          </p>
                        )}
                      </div>
                    </div>
                  </RadioGroup>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="personal" className="m-0 flex-1 overflow-y-auto min-h-0">
              <div className="px-4 sm:px-5 py-3 sm:py-4 space-y-3">
                {personalDocsQuery.isPending ? (
                  <div className="space-y-2">
                    <Skeleton className="h-10 w-full" />
                    <Skeleton className="h-10 w-full" />
                    <Skeleton className="h-10 w-full" />
                  </div>
                ) : (personalDocsQuery.data ?? []).length === 0 ? (
                  <p className="py-6 text-center text-body-sm text-muted-foreground">
                    {t("documents.upload.tabs.personalEmpty")}
                  </p>
                ) : (
                  <ul className="divide-y divide-border">
                    {(personalDocsQuery.data ?? []).map((doc) => {
                      const isSelected = personalSelected.has(doc.id);
                      return (
                        <li key={doc.id}>
                          <label className="flex items-start gap-3 py-2 cursor-pointer">
                            <Checkbox
                              checked={isSelected}
                              onCheckedChange={() => togglePersonalSelected(doc.id)}
                              className="mt-1"
                            />
                            <div className="flex-1 min-w-0">
                              <p className="text-body-sm font-medium text-foreground truncate">{doc.title}</p>
                              {doc.description && (
                                <p className="text-caption text-muted-foreground line-clamp-2">{doc.description}</p>
                              )}
                              <p className="text-[10px] text-muted-foreground mt-0.5">{doc.updatedAt.slice(0, 10)}</p>
                            </div>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                )}
                <ImportVisibilitySelector
                  value={importVisibilityClass}
                  onChange={setImportVisibilityClass}
                  canSelectInternal={canSelectInternalUpload}
                  disabled={importToProjectMutation.isPending}
                  t={t}
                />
              </div>
            </TabsContent>

            <TabsContent value="org" className="m-0 flex-1 overflow-y-auto min-h-0">
              <div className="px-4 sm:px-5 py-3 sm:py-4 space-y-3">
                {!activeOrg ? (
                  <p className="py-6 text-center text-body-sm text-muted-foreground">
                    {t("documents.upload.tabs.orgUnavailable")}
                  </p>
                ) : orgDocsQuery.isPending ? (
                  <div className="space-y-2">
                    <Skeleton className="h-10 w-full" />
                    <Skeleton className="h-10 w-full" />
                    <Skeleton className="h-10 w-full" />
                  </div>
                ) : (orgDocsQuery.data ?? []).length === 0 ? (
                  <p className="py-6 text-center text-body-sm text-muted-foreground">
                    {t("documents.upload.tabs.orgEmpty")}
                  </p>
                ) : (
                  <ul className="divide-y divide-border">
                    {(orgDocsQuery.data ?? []).map((doc) => {
                      const isSelected = orgSelected.has(doc.id);
                      return (
                        <li key={doc.id}>
                          <label className="flex items-start gap-3 py-2 cursor-pointer">
                            <Checkbox
                              checked={isSelected}
                              onCheckedChange={() => toggleOrgSelected(doc.id)}
                              className="mt-1"
                            />
                            <div className="flex-1 min-w-0">
                              <p className="text-body-sm font-medium text-foreground truncate">{doc.title}</p>
                              {doc.description && (
                                <p className="text-caption text-muted-foreground line-clamp-2">{doc.description}</p>
                              )}
                              <p className="text-[10px] text-muted-foreground mt-0.5">{doc.updatedAt.slice(0, 10)}</p>
                            </div>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                )}
                <ImportVisibilitySelector
                  value={importVisibilityClass}
                  onChange={setImportVisibilityClass}
                  canSelectInternal={canSelectInternalUpload}
                  disabled={importToProjectMutation.isPending}
                  t={t}
                />
              </div>
            </TabsContent>
          </Tabs>

          <DialogFooter className="border-t border-border px-4 sm:px-5 py-3 sm:py-4 shrink-0">
            <Button variant="outline" onClick={closeUploadDialog} disabled={uploading || importToProjectMutation.isPending}>{t("common.cancel")}</Button>
            {uploadTab === "computer" ? (
              pendingFinalizeIntentId ? (
                <Button
                  className="bg-accent text-accent-foreground hover:bg-accent/90"
                  onClick={handleRetryFinalize}
                  disabled={uploading}
                >
                  {uploading ? t("documents.upload.finalizing") : t("documents.upload.retryFinalize")}
                </Button>
              ) : (
                <Button
                  className="bg-accent text-accent-foreground hover:bg-accent/90"
                  onClick={handleUpload}
                  disabled={uploading || (isSupabaseMode ? !uploadFile : (!uploadTitle.trim() && !uploadFile))}
                >
                  {uploading ? t("documents.upload.uploading") : t("documents.upload.submit")}
                </Button>
              )
            ) : uploadTab === "personal" ? (
              <Button
                className="bg-accent text-accent-foreground hover:bg-accent/90"
                onClick={handleAttachPersonal}
                disabled={personalSelected.size === 0 || importToProjectMutation.isPending}
              >
                {importToProjectMutation.isPending
                  ? t("documents.import.submitting")
                  : t("documents.upload.tabs.personalSubmit")}
              </Button>
            ) : (
              <Button
                className="bg-accent text-accent-foreground hover:bg-accent/90"
                onClick={handleAttachOrg}
                disabled={orgSelected.size === 0 || importToProjectMutation.isPending || !activeOrg}
              >
                {importToProjectMutation.isPending
                  ? t("documents.import.submitting")
                  : t("documents.upload.tabs.orgSubmit")}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={generateOpen} onOpenChange={(open) => { setGenerateOpen(open); if (!open) setShowGenPreview(false); }}>
        <AlertDialogContent className="glass-modal rounded-modal max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("documents.generate.title")}</AlertDialogTitle>
            <AlertDialogDescription>{t("documents.generate.description")}</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <label className="text-body-sm font-medium text-foreground">{t("documents.generate.titleLabel")}</label>
              <Input value={generateTitle} onChange={(event) => setGenerateTitle(event.target.value)} placeholder={t("documents.generate.titlePlaceholder")} autoFocus />
            </div>
            {!showGenPreview ? (
              <Button onClick={handleGeneratePreview} disabled={!generateTitle.trim()} className="w-full bg-accent text-accent-foreground hover:bg-accent/90">
                {t("documents.generate.previewAction")}
              </Button>
            ) : (
              <div className="space-y-2">
                <div className="glass rounded-card p-3">
                  <p className="text-caption text-muted-foreground mb-1">{t("documents.generate.previewHeading")}</p>
                  <p className="text-body-sm text-foreground whitespace-pre-wrap">{generateContent}</p>
                </div>
                <PreviewCard summary={t("documents.generate.previewSummary")} changes={generatePreviewChanges} />
                <ActionBar
                  onConfirm={handleGenerateConfirm}
                  onCancel={() => setShowGenPreview(false)}
                />
              </div>
            )}
          </div>
          {!showGenPreview && (
            <AlertDialogFooter>
              <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            </AlertDialogFooter>
          )}
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={!!viewDoc} onOpenChange={(open) => { if (!open) setViewDoc(null); }}>
        <DialogContent className="bg-card border border-border rounded-modal max-w-lg shadow-xl p-0 gap-0 [&>button.absolute]:hidden">
          {viewDoc && latestViewedVersion && (
            <>
              <DialogHeader className="border-b border-border px-5 py-4">
                <div className="flex flex-wrap items-center gap-2">
                  <DialogTitle className="flex-1 min-w-0">{viewDoc.title}</DialogTitle>
                  {showDocumentVisibilityBadges ? (
                    <VisibilityClassBadge visibilityClass={viewDoc.visibility_class} />
                  ) : null}
                </div>
                <DialogDescription>
                  {viewedDocumentIsArchived ? t("documents.preview.archivedLabel") : t("documents.preview.previewLabel")}
                </DialogDescription>
              </DialogHeader>
              <div className="px-5 py-4 space-y-4">
                <div className="rounded-panel border border-border bg-muted/30 p-4 max-h-72 overflow-y-auto">
                  {isSupabaseMode ? (
                    previewLoading ? (
                      <Skeleton className="h-40 w-full" />
                    ) : previewUrl ? (
                      viewedMimeType?.startsWith("image/") ? (
                        <img src={previewUrl} alt={viewDoc.title} className="max-w-full max-h-72 object-contain mx-auto" />
                      ) : viewedMimeType === "application/pdf" ? (
                        <iframe src={previewUrl} title={viewDoc.title} className="w-full h-72 border-0" />
                      ) : (
                        <div className="flex flex-col items-start gap-2 text-body-sm text-muted-foreground">
                          <span className="text-foreground">{viewedStorage?.filename ?? viewDoc.title}</span>
                          <span className="text-caption">{t("documents.preview.inlineUnsupported")}</span>
                        </div>
                      )
                    ) : (
                      <p className="text-body-sm text-muted-foreground whitespace-pre-wrap">
                        {t("documents.preview.supabaseNote")}
                      </p>
                    )
                  ) : latestViewedVersion.content ? (
                    <p className="text-body-sm text-foreground whitespace-pre-wrap">{latestViewedVersion.content}</p>
                  ) : (
                    <p className="text-body-sm text-muted-foreground whitespace-pre-wrap">{t("documents.preview.noContent")}</p>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={handlePrintDocument}>
                    <Printer className="h-3.5 w-3.5 mr-1.5" /> {t("documents.preview.action.print")}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => { void handleDownloadViewedDocument(); }}
                    disabled={!canDownloadViewedDocument}
                  >
                    <Download className="h-3.5 w-3.5 mr-1.5" /> {t("documents.preview.action.download")}
                  </Button>
                  <Button size="sm" variant="outline" disabled>
                    <Share2 className="h-3.5 w-3.5 mr-1.5" /> {t("documents.preview.action.share")}
                  </Button>
                </div>
                <p className="text-caption text-muted-foreground">
                  {isSupabaseMode
                    ? previewUrl
                      ? t("documents.preview.footnote.shareOnly")
                      : t("documents.preview.footnote.supabase")
                    : canDownloadViewedDocument
                      ? t("documents.preview.footnote.shareOnly")
                      : t("documents.preview.footnote.bothComingSoon")}
                </p>
              </div>
              <DialogFooter className="border-t border-border px-5 py-4 flex-wrap gap-2 sm:justify-between sm:space-x-0">
                <div className="flex flex-wrap gap-2">
                  {canCommentOnDocuments && !viewedDocumentIsArchived && (
                    <>
                      <Button size="sm" onClick={() => handleAcknowledge(viewDoc)} className="bg-accent text-accent-foreground hover:bg-accent/90">
                        <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> {t("documents.preview.acknowledge")}
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setCommentOpen(true)}>
                        <MessageSquare className="h-3.5 w-3.5 mr-1" /> {t("documents.preview.comment")}
                      </Button>
                    </>
                  )}
                  {canDeleteDocuments && viewedDocumentIsArchived && (
                    <Button size="sm" variant="outline" onClick={() => setDeleteDocId(viewDoc.id)} className="text-destructive hover:text-destructive">
                      <Trash2 className="h-3.5 w-3.5 mr-1" /> {t("documents.preview.delete")}
                    </Button>
                  )}
                </div>
                <Button size="sm" variant="outline" onClick={() => setViewDoc(null)}>{t("common.close")}</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={commentOpen} onOpenChange={setCommentOpen}>
        <AlertDialogContent className="glass-modal rounded-modal">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("documents.commentDialog.title")}</AlertDialogTitle>
          </AlertDialogHeader>
          <Textarea value={commentText} onChange={(event) => setCommentText(event.target.value)} placeholder={t("documents.commentDialog.placeholder")} className="min-h-[60px]" />
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleComment} className="bg-accent text-accent-foreground hover:bg-accent/90" disabled={!commentText.trim()}>
              {t("documents.commentDialog.submit")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ConfirmModal
        open={!!archiveDocId}
        onOpenChange={(open) => !open && setArchiveDocId(null)}
        title={t("documents.archiveConfirm.title")}
        description={t("documents.archiveConfirm.description")}
        confirmLabel={t("documents.archiveConfirm.confirm")}
        onConfirm={handleArchive}
        onCancel={() => setArchiveDocId(null)}
      />

      <ConfirmModal
        open={!!deleteDocId}
        onOpenChange={(open) => !open && setDeleteDocId(null)}
        title={t("documents.deleteConfirm.title")}
        description={t("documents.deleteConfirm.description")}
        confirmLabel={t("documents.deleteConfirm.confirm")}
        onConfirm={handleDelete}
        onCancel={() => setDeleteDocId(null)}
      />

      {importDialog && (
        <ImportDocumentsDialog
          open={importDialog !== null}
          onOpenChange={(open) => { if (!open) setImportDialog(null); }}
          projectId={pid}
          source={importDialog}
          orgId={activeOrg?.id ?? null}
          orgName={activeOrg?.name ?? null}
        />
      )}
    </div>
  );
}
