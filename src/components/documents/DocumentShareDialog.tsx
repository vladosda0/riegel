import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Copy, Link2Off } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmModal } from "@/components/ConfirmModal";
import { toast } from "@/hooks/use-toast";
import { useDocumentShareMutations } from "@/hooks/use-document-shares";
import { buildDocumentShareLink, type DocumentShare } from "@/data/document-share-source";
import type { DocMediaVisibilityClass } from "@/types/entities";

export interface ShareableDocument {
  id: string;
  title: string;
  visibilityClass?: DocMediaVisibilityClass | null;
}

interface DocumentShareDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  document: ShareableDocument | null;
  /** The active share when the list already knows it; saves the create round trip. */
  existingShare?: DocumentShare | null;
  /** Owner / co_owner with internal-doc visibility: may flip an internal document to shared. */
  canChangeVisibility: boolean;
  /**
   * Flip the document to 'shared_project'. Resolves once the change is
   * persisted; rejects with the backend's reason. The parent owns the toast
   * and the list invalidation, the dialog only sequences it before create.
   */
  onMakeShared?: (documentId: string) => Promise<void>;
}

type Phase =
  | { kind: "internal" }
  | { kind: "creating" }
  | { kind: "ready"; share: DocumentShare }
  | { kind: "error"; message: string };

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return fallback;
}

/**
 * Public download link for a project document.
 *
 * Opened on a 'shared_project' document it mints (or reuses) the active
 * token and shows the link with copy / revoke. Opened on an 'internal'
 * document it explains why there is no link, and, for a member who may
 * reclassify, offers to make the document shared first: the same confirm as
 * the preview dialog's visibility switch, then the create.
 */
export function DocumentShareDialog({
  open,
  onOpenChange,
  projectId,
  document,
  existingShare,
  canChangeVisibility,
  onMakeShared,
}: DocumentShareDialogProps) {
  const { t } = useTranslation();
  const { create, revoke } = useDocumentShareMutations(projectId);
  const [phase, setPhase] = useState<Phase>({ kind: "creating" });
  const [revokeConfirmOpen, setRevokeConfirmOpen] = useState(false);
  const [makeSharedConfirmOpen, setMakeSharedConfirmOpen] = useState(false);
  const [makingShared, setMakingShared] = useState(false);

  const documentId = document?.id ?? null;
  const isInternal = document?.visibilityClass === "internal";
  // `create` is a stable mutation object per hook instance; its identity is
  // deliberately NOT a dependency, or every render would re-mint.
  const createShare = create.mutateAsync;

  useEffect(() => {
    if (!open || !documentId) return;
    if (isInternal) {
      setPhase({ kind: "internal" });
      return;
    }
    if (existingShare && existingShare.documentId === documentId) {
      setPhase({ kind: "ready", share: existingShare });
      return;
    }
    let cancelled = false;
    setPhase({ kind: "creating" });
    createShare(documentId)
      .then((share) => {
        if (!cancelled) setPhase({ kind: "ready", share });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setPhase({ kind: "error", message: errorMessage(error, t("documents.share.createFailed")) });
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, documentId, isInternal, existingShare?.shareToken]);

  const link = phase.kind === "ready" ? buildDocumentShareLink(phase.share.shareToken) : null;

  async function handleCopy() {
    if (!link) return;
    try {
      if (!navigator.clipboard?.writeText) throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(link);
      toast({ title: t("documents.share.copied"), description: t("documents.share.warning") });
    } catch {
      // The link is still on screen in the input; the toast carries it too so
      // it can be selected from there on browsers that refuse the clipboard.
      toast({ title: t("documents.share.copyFailed"), description: link, variant: "destructive" });
    }
  }

  async function handleRevoke() {
    if (!documentId) return;
    setRevokeConfirmOpen(false);
    try {
      await revoke.mutateAsync(documentId);
      toast({ title: t("documents.share.revoked") });
      onOpenChange(false);
    } catch (error) {
      toast({
        title: t("documents.share.createFailed"),
        description: errorMessage(error, ""),
        variant: "destructive",
      });
    }
  }

  async function handleMakeShared() {
    if (!documentId || !onMakeShared) return;
    setMakeSharedConfirmOpen(false);
    setMakingShared(true);
    try {
      await onMakeShared(documentId);
      // The parent will re-render us with visibilityClass = shared_project and
      // the effect above mints the token; drive it now so a slow refetch does
      // not leave the dialog on the warning.
      setPhase({ kind: "creating" });
      const share = await createShare(documentId);
      setPhase({ kind: "ready", share });
    } catch (error) {
      setPhase({ kind: "error", message: errorMessage(error, t("documents.share.createFailed")) });
    } finally {
      setMakingShared(false);
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="bg-card border border-border rounded-modal max-w-lg shadow-xl">
          <DialogHeader>
            <DialogTitle>{t("documents.share.title")}</DialogTitle>
            <DialogDescription>
              {t("documents.share.description", { title: document?.title ?? "" })}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            {phase.kind === "internal" && (
              <div
                className="rounded-md border border-warning/40 bg-warning/10 p-3 text-caption text-foreground"
                data-testid="document-share-internal-warning"
              >
                {t("documents.share.internalWarning")}
              </div>
            )}

            {phase.kind === "creating" && (
              <div className="space-y-2" aria-busy="true">
                <Skeleton className="h-9 w-full" />
                <p className="text-caption text-muted-foreground">{t("documents.share.creating")}</p>
              </div>
            )}

            {phase.kind === "error" && (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-caption text-destructive">
                {phase.message}
              </div>
            )}

            {phase.kind === "ready" && link && (
              <>
                <div className="space-y-1">
                  <label className="text-body-sm font-medium text-foreground" htmlFor="document-share-link">
                    {t("documents.share.linkLabel")}
                  </label>
                  <div className="flex gap-2">
                    <Input
                      id="document-share-link"
                      value={link}
                      readOnly
                      onFocus={(event) => event.currentTarget.select()}
                      className="font-mono text-caption"
                    />
                    <Button variant="outline" onClick={() => { void handleCopy(); }}>
                      <Copy className="h-4 w-4 mr-1.5" />
                      {t("documents.share.copyLink")}
                    </Button>
                  </div>
                </div>
                <p className="rounded-md border border-warning/40 bg-warning/10 p-3 text-caption text-foreground">
                  {t("documents.share.warning")}
                </p>
              </>
            )}
          </div>

          <DialogFooter className="flex-wrap gap-2 sm:justify-between sm:space-x-0">
            <div className="flex flex-wrap gap-2">
              {phase.kind === "ready" && (
                <Button
                  variant="outline"
                  className="text-destructive hover:text-destructive"
                  onClick={() => setRevokeConfirmOpen(true)}
                  disabled={revoke.isPending}
                >
                  <Link2Off className="h-4 w-4 mr-1.5" />
                  {t("documents.share.revoke")}
                </Button>
              )}
              {phase.kind === "internal" && canChangeVisibility && onMakeShared && (
                <Button
                  className="bg-accent text-accent-foreground hover:bg-accent/90"
                  onClick={() => setMakeSharedConfirmOpen(true)}
                  disabled={makingShared}
                >
                  {t("documents.share.makeSharedAndShare")}
                </Button>
              )}
            </div>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              {t("common.close")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmModal
        open={revokeConfirmOpen}
        onOpenChange={setRevokeConfirmOpen}
        title={t("documents.share.revokeConfirmTitle")}
        description={t("documents.share.revokeConfirmDescription")}
        confirmLabel={t("documents.share.revoke")}
        onConfirm={() => { void handleRevoke(); }}
        onCancel={() => setRevokeConfirmOpen(false)}
      />

      <ConfirmModal
        open={makeSharedConfirmOpen}
        onOpenChange={setMakeSharedConfirmOpen}
        title={t("documents.visibility.change.toSharedTitle")}
        description={t("documents.visibility.change.toSharedDescription")}
        confirmLabel={t("documents.visibility.change.confirm")}
        onConfirm={() => { void handleMakeShared(); }}
        onCancel={() => setMakeSharedConfirmOpen(false)}
      />
    </>
  );
}
