import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { FileInput } from "@/components/ui/file-input";
import { DOCUMENT_UPLOAD_ACCEPT } from "@/lib/document-file-types";
import { toast } from "@/hooks/use-toast";
import { useScopedDocumentUpload } from "@/components/upload/use-scoped-document-upload";
import type { UploadResult, UploadScope } from "@/components/upload/types";

export interface DocumentFormProps {
  scope: UploadScope;
  projectId?: string;
  onBack: () => void;
  onClose: () => void;
  onComplete?: (result: UploadResult) => void;
}

export function DocumentForm({ scope, projectId, onBack, onClose, onComplete }: DocumentFormProps) {
  const { t } = useTranslation();
  const upload = useScopedDocumentUpload(projectId);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!file) {
      toast({ title: t("upload.modal.errors.fileRequired"), variant: "destructive" });
      return;
    }
    const effectiveTitle = title.trim() || file.name;
    setSubmitting(true);
    try {
      const result = await upload({
        scope,
        file,
        title: effectiveTitle,
        type: "knowledge_base",
        description: description.trim() || undefined,
      });
      toast({ title: t("upload.modal.successMessages.document") });
      onComplete?.({ type: "document", scope, documentId: result.documentId ?? undefined });
      onClose();
    } catch (error) {
      toast({
        title: t("upload.modal.errors.saveFailed"),
        description: error instanceof Error ? error.message : undefined,
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col min-h-0 flex-1">
      <div className="flex-1 overflow-y-auto px-4 sm:px-5 py-4 space-y-4">
        <div className="space-y-1">
          <Label className="text-body-sm font-medium">
            {t("upload.modal.step3.document.name")}{" "}
            <span className="text-caption text-muted-foreground font-normal">
              ({t("common.optional")})
            </span>
          </Label>
          <Input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder={t("upload.modal.step3.document.namePlaceholder")}
            disabled={submitting}
          />
        </div>

        <div className="space-y-1">
          <Label className="text-body-sm font-medium">{t("upload.modal.step3.document.file")}</Label>
          <FileInput
            accept={DOCUMENT_UPLOAD_ACCEPT}
            disabled={submitting}
            onChange={(event) => {
              const selected = event.target.files?.[0] ?? null;
              setFile(selected);
              if (selected && !title.trim()) setTitle(selected.name);
            }}
          />
        </div>

        <div className="space-y-1">
          <Label className="text-body-sm font-medium">
            {t("upload.modal.step3.document.description")}{" "}
            <span className="text-caption text-muted-foreground font-normal">
              ({t("common.optional")})
            </span>
          </Label>
          <Textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder={t("upload.modal.step3.document.descriptionPlaceholder")}
            rows={3}
            disabled={submitting}
          />
        </div>
      </div>

      <div className="border-t border-border px-4 sm:px-5 py-3 sm:py-4 flex justify-between shrink-0">
        <Button type="button" variant="outline" onClick={onBack} disabled={submitting}>
          {t("upload.modal.back")}
        </Button>
        <Button
          type="submit"
          className="bg-accent text-accent-foreground hover:bg-accent/90"
          disabled={submitting || !file}
        >
          {submitting ? t("upload.modal.saving") : t("upload.modal.save")}
        </Button>
      </div>
    </form>
  );
}
