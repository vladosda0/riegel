import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";

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
import { FileInput } from "@/components/ui/file-input";
import { DOCUMENT_UPLOAD_ACCEPT } from "@/lib/document-file-types";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { useProjects } from "@/hooks/use-mock-data";
import { useActiveOrg, orgQueryKeys } from "@/hooks/use-orgs";
import { useDocumentUploadMutations } from "@/hooks/use-documents-media-source";
import {
  prepareWorkspaceDocumentUpload,
  finalizeWorkspaceDocumentUpload,
  prepareOrgDocumentUpload,
  finalizeOrgDocumentUpload,
  uploadFileToBucket,
} from "@/data/org-source";
import type { DocMediaVisibilityClass } from "@/types/entities";

type Destination = "personal" | "org" | "project";

interface UploadDocumentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultProjectId?: string;
}

/**
 * @deprecated Use {@link MultiStepUploadModal} from `@/components/upload/MultiStepUploadModal`
 * instead. This single-step variant is retained for one release cycle as a
 * rollback fallback and is no longer wired into the /home tabs. It will be
 * removed in a future release.
 */
export function UploadDocumentDialog({
  open,
  onOpenChange,
  defaultProjectId,
}: UploadDocumentDialogProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const projects = useProjects();
  const activeOrg = useActiveOrg();

  const [destination, setDestination] = useState<Destination>("personal");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [visibility, setVisibility] = useState<DocMediaVisibilityClass>("shared_project");
  const [projectId, setProjectId] = useState<string | undefined>(defaultProjectId);
  const [submitting, setSubmitting] = useState(false);
  const projectUpload = useDocumentUploadMutations(projectId ?? "");

  useEffect(() => {
    if (!open) {
      setDestination("personal");
      setTitle("");
      setDescription("");
      setFile(null);
      setVisibility("shared_project");
      setProjectId(defaultProjectId);
      setSubmitting(false);
    }
  }, [open, defaultProjectId]);

  useEffect(() => {
    if (destination === "project" && !projectId && projects.length > 0) {
      setProjectId(defaultProjectId ?? projects[0].id);
    }
  }, [destination, projectId, projects, defaultProjectId]);

  const projectOptions = useMemo(
    () => projects.map((p) => ({ id: p.id, title: p.title })),
    [projects],
  );

  const orgAvailable = Boolean(activeOrg?.id);
  const projectAvailable = projectOptions.length > 0;

  function close() {
    if (submitting) return;
    onOpenChange(false);
  }

  async function handleSubmit() {
    if (!file) {
      toast({ title: t("home.upload.errors.fileRequired"), variant: "destructive" });
      return;
    }
    const effectiveTitle = title.trim() || file.name;

    setSubmitting(true);
    try {
      if (destination === "personal") {
        const intent = await prepareWorkspaceDocumentUpload({
          type: "knowledge_base",
          title: effectiveTitle,
          clientFilename: file.name,
          mimeType: file.type || "application/octet-stream",
          sizeBytes: file.size,
          description: description.trim() || undefined,
        });
        await uploadFileToBucket(intent.bucket, intent.objectPath, file);
        await finalizeWorkspaceDocumentUpload(
          intent.uploadIntentId,
          "knowledge_base",
          effectiveTitle,
          description.trim() || undefined,
        );
        await queryClient.invalidateQueries({ queryKey: ["workspace_documents"] });
        toast({ title: t("home.upload.toast.savedPersonal") });
      } else if (destination === "org") {
        if (!activeOrg?.id) throw new Error("No active organization");
        const intent = await prepareOrgDocumentUpload(activeOrg.id, {
          type: "knowledge_base",
          title: effectiveTitle,
          clientFilename: file.name,
          mimeType: file.type || "application/octet-stream",
          sizeBytes: file.size,
          description: description.trim() || undefined,
        });
        await uploadFileToBucket(intent.bucket, intent.objectPath, file);
        await finalizeOrgDocumentUpload(
          intent.uploadIntentId,
          "knowledge_base",
          effectiveTitle,
          description.trim() || undefined,
        );
        await queryClient.invalidateQueries({ queryKey: orgQueryKeys.documents(activeOrg.id) });
        toast({ title: t("home.upload.toast.savedOrg") });
      } else {
        if (!projectId) throw new Error("No project selected");
        const intent = await projectUpload.prepareUpload({
          type: "knowledge_base",
          title: effectiveTitle,
          clientFilename: file.name,
          mimeType: file.type || "application/octet-stream",
          sizeBytes: file.size,
          description: description.trim() || undefined,
          visibilityClass: visibility,
        });
        await projectUpload.uploadBytes(intent.bucket, intent.objectPath, file);
        await projectUpload.finalizeUpload(intent.uploadIntentId);
        await queryClient.invalidateQueries({ queryKey: ["documents-media"] });
        toast({ title: t("home.upload.toast.uploadedProject") });
      }

      onOpenChange(false);
    } catch (error) {
      toast({
        title: t("home.upload.toast.error"),
        description: error instanceof Error ? error.message : undefined,
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  }

  const submitDisabled =
    submitting
    || !file
    || (destination === "project" && !projectId)
    || (destination === "org" && !orgAvailable);

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(true) : close())}>
      <DialogContent className="bg-card border border-border rounded-modal max-w-lg shadow-xl p-0 gap-0 max-h-[85vh] flex flex-col [&>button.absolute]:hidden">
        <DialogHeader className="border-b border-border px-4 sm:px-5 py-3 sm:py-4 shrink-0">
          <DialogTitle>{t("home.upload.title")}</DialogTitle>
          <DialogDescription>{t("home.upload.description")}</DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-4 sm:px-5 py-3 sm:py-4 space-y-4 min-h-0">
          <div className="space-y-2">
            <Label className="text-body-sm font-medium">{t("home.upload.destinationLabel")}</Label>
            <RadioGroup
              value={destination}
              onValueChange={(v) => setDestination(v as Destination)}
              className="flex flex-col gap-2"
              disabled={submitting}
            >
              <div className="flex items-start space-x-2">
                <RadioGroupItem value="personal" id="dest-personal" />
                <div className="grid gap-0.5">
                  <Label htmlFor="dest-personal" className="font-normal cursor-pointer">
                    {t("home.upload.destination.personal")}
                  </Label>
                  <p className="text-caption text-muted-foreground">
                    {t("home.upload.destination.personalHint")}
                  </p>
                </div>
              </div>
              <div className="flex items-start space-x-2">
                <RadioGroupItem
                  value="org"
                  id="dest-org"
                  disabled={!orgAvailable}
                />
                <div className="grid gap-0.5">
                  <Label
                    htmlFor="dest-org"
                    className={`font-normal ${orgAvailable ? "cursor-pointer" : "text-muted-foreground"}`}
                  >
                    {t("home.upload.destination.org")}
                  </Label>
                  <p className="text-caption text-muted-foreground">
                    {orgAvailable
                      ? t("home.upload.destination.orgHint", { name: activeOrg?.name ?? "" })
                      : t("home.upload.destination.orgUnavailable")}
                  </p>
                </div>
              </div>
              <div className="flex items-start space-x-2">
                <RadioGroupItem
                  value="project"
                  id="dest-project"
                  disabled={!projectAvailable}
                />
                <div className="grid gap-0.5">
                  <Label
                    htmlFor="dest-project"
                    className={`font-normal ${projectAvailable ? "cursor-pointer" : "text-muted-foreground"}`}
                  >
                    {t("home.upload.destination.project")}
                  </Label>
                  <p className="text-caption text-muted-foreground">
                    {projectAvailable
                      ? t("home.upload.destination.projectHint")
                      : t("home.upload.destination.projectUnavailable")}
                  </p>
                </div>
              </div>
            </RadioGroup>
          </div>

          {destination === "project" && (
            <div className="space-y-1">
              <Label className="text-body-sm font-medium">{t("home.upload.projectLabel")}</Label>
              <Select value={projectId} onValueChange={setProjectId} disabled={submitting}>
                <SelectTrigger>
                  <SelectValue placeholder={t("home.upload.projectPlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  {projectOptions.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.title}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-1">
            <Label className="text-body-sm font-medium">{t("home.upload.titleLabel")}</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("home.upload.titlePlaceholder")}
              disabled={submitting}
            />
          </div>

          <div className="space-y-1">
            <Label className="text-body-sm font-medium">{t("home.upload.fileLabel")}</Label>
            <FileInput
              accept={DOCUMENT_UPLOAD_ACCEPT}
              disabled={submitting}
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                setFile(f);
                if (f && !title.trim()) setTitle(f.name);
              }}
            />
          </div>

          <div className="space-y-1">
            <Label className="text-body-sm font-medium">
              {t("home.upload.descriptionLabel")}{" "}
              <span className="text-caption text-muted-foreground font-normal">
                ({t("common.optional")})
              </span>
            </Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("home.upload.descriptionPlaceholder")}
              rows={3}
              disabled={submitting}
            />
          </div>

          {destination === "project" && (
            <div className="space-y-2">
              <Label className="text-body-sm font-medium">{t("documents.upload.visibilityLabel")}</Label>
              <RadioGroup
                value={visibility}
                onValueChange={(v) => setVisibility(v as DocMediaVisibilityClass)}
                className="flex flex-col gap-2"
                disabled={submitting}
              >
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="shared_project" id="home-vis-shared" />
                  <Label htmlFor="home-vis-shared" className="font-normal cursor-pointer">
                    {t("documents.upload.sharedLabel")}
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="internal" id="home-vis-internal" />
                  <Label htmlFor="home-vis-internal" className="font-normal cursor-pointer">
                    {t("documents.upload.internalLabel")}
                  </Label>
                </div>
              </RadioGroup>
            </div>
          )}
        </div>

        <DialogFooter className="border-t border-border px-4 sm:px-5 py-3 sm:py-4 shrink-0">
          <Button variant="outline" onClick={close} disabled={submitting}>
            {t("common.cancel")}
          </Button>
          <Button
            className="bg-accent text-accent-foreground hover:bg-accent/90"
            onClick={handleSubmit}
            disabled={submitDisabled}
          >
            {submitting
              ? t("home.upload.submitting")
              : t("home.upload.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
