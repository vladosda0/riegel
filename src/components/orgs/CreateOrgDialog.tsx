import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Building2, Mail, FileText } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { useCreateOrganization, useSetActiveOrg } from "@/hooks/use-orgs";
import { addOrgMembersByEmail, suggestOrgSlug } from "@/data/org-source";
import { toast } from "@/hooks/use-toast";

export interface CreateOrgDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (orgId: string) => void;
  /** Set the new org as the active context after creation. Default: true. */
  activateOnCreate?: boolean;
}

function parseEmails(raw: string): string[] {
  return raw
    .split(/[\s,;]+/)
    .map((value) => value.trim())
    .filter((value) => value.length > 0 && value.includes("@"));
}

export function CreateOrgDialog({
  open,
  onOpenChange,
  onCreated,
  activateOnCreate = true,
}: CreateOrgDialogProps) {
  const { t } = useTranslation();
  const createMutation = useCreateOrganization();
  const setActiveMutation = useSetActiveOrg();
  const [name, setName] = useState("");
  const [emailsText, setEmailsText] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) {
      setName("");
      setEmailsText("");
      setSubmitting(false);
    }
  }, [open]);

  const trimmedName = name.trim();
  const emails = parseEmails(emailsText);
  const canSubmit = trimmedName.length > 0 && !submitting && !createMutation.isPending;
  const isPending = submitting || createMutation.isPending;

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const created = await createMutation.mutateAsync({
        name: trimmedName,
        slug: suggestOrgSlug(trimmedName),
      });

      if (activateOnCreate) {
        try {
          await setActiveMutation.mutateAsync(created.id);
        } catch {
          // soft-fail: org exists; active context is best-effort.
        }
      }

      let inviteToast: { added: number; notFound: number; notFoundList: string } | null = null;
      if (emails.length > 0) {
        try {
          const result = await addOrgMembersByEmail(created.id, emails);
          inviteToast = {
            added: result.added.length,
            notFound: result.notFound.length,
            notFoundList: result.notFound.join(", "),
          };
        } catch (error) {
          toast({
            title: t("createOrgDialog.inviteFailed"),
            description: error instanceof Error ? error.message : undefined,
            variant: "destructive",
          });
        }
      }

      toast({
        title: t("onboarding.org.createSuccess"),
        description: inviteToast
          ? t(
              inviteToast.notFound > 0
                ? "createOrgDialog.inviteSummaryPartial"
                : "createOrgDialog.inviteSummary",
              inviteToast,
            )
          : undefined,
      });
      onCreated?.(created.id);
      onOpenChange(false);
    } catch (error) {
      toast({
        title: t("onboarding.org.createError"),
        description: error instanceof Error ? error.message : undefined,
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card border border-border rounded-modal max-w-lg shadow-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Building2 className="h-4 w-4 text-accent" />
            {t("onboarding.org.title")}
          </DialogTitle>
          <DialogDescription>{t("onboarding.org.subtitle")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <label className="text-body-sm font-medium text-foreground">
              {t("onboarding.org.nameLabel")}
            </label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("onboarding.org.namePlaceholder")}
              autoFocus
              disabled={isPending}
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-body-sm font-medium text-foreground flex items-center gap-1.5">
              <Mail className="h-3.5 w-3.5 text-muted-foreground" />
              {t("createOrgDialog.invite.label")}
            </label>
            <Textarea
              value={emailsText}
              onChange={(e) => setEmailsText(e.target.value)}
              placeholder={t("createOrgDialog.invite.placeholder")}
              disabled={isPending}
              rows={2}
              className="resize-none"
            />
            <p className="text-caption text-muted-foreground">
              {t("createOrgDialog.invite.hint")}
            </p>
          </div>

          <div className="space-y-1.5">
            <label className="text-body-sm font-medium text-foreground flex items-center gap-1.5">
              <FileText className="h-3.5 w-3.5 text-muted-foreground" />
              {t("createOrgDialog.docs.label")}
            </label>
            <div className="rounded-panel border border-dashed border-border bg-muted/30 px-3 py-3">
              <p className="text-caption text-muted-foreground">
                {t("createOrgDialog.docs.hint")}
              </p>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="w-full bg-accent text-accent-foreground hover:bg-accent/90"
          >
            {isPending ? t("onboarding.org.creating") : t("onboarding.org.create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
