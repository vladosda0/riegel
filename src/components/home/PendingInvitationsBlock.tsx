import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { MailPlus } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useProjects, useWorkspaceMode } from "@/hooks/use-mock-data";
import { useRuntimeAuth } from "@/hooks/use-runtime-auth";
import { getStoredAuthProfile } from "@/lib/auth-state";
import * as store from "@/data/store";
import { getWorkspaceSource, type WorkspaceProjectInvite } from "@/data/workspace-source";
import { acceptProjectInvite } from "@/lib/accept-project-invite";

interface PendingInviteItem {
  invite: WorkspaceProjectInvite;
  projectTitle: string;
}

export function PendingInvitationsBlock() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { toast } = useToast();
  const mode = useWorkspaceMode();
  const projects = useProjects();
  const runtimeAuth = useRuntimeAuth();
  const [acceptingInviteId, setAcceptingInviteId] = useState<string | null>(null);

  const supabaseEmail = runtimeAuth.user?.email?.toLowerCase() ?? "";
  const fallbackEmail = useMemo(
    () => (mode.kind === "supabase" ? "" : (getStoredAuthProfile()?.email?.toLowerCase() ?? "")),
    [mode.kind],
  );

  const pendingInvitesQuery = useQuery({
    queryKey: ["home", "pending-invites", mode.kind === "supabase" ? mode.profileId : mode.kind, supabaseEmail],
    queryFn: async (): Promise<PendingInviteItem[]> => {
      const source = await getWorkspaceSource(mode.kind === "supabase" ? mode : undefined);
      const allProjects = await source.getProjects();
      const inviteRows = await Promise.all(
        allProjects.map(async (project) => {
          const invites = await source.getProjectInvites(project.id);
          return invites
            .filter((invite) => invite.status === "pending")
            .filter((invite) => invite.email.toLowerCase() === supabaseEmail)
            .map((invite) => ({ invite, projectTitle: project.title }));
        }),
      );
      return inviteRows.flat();
    },
    enabled: mode.kind === "supabase" && supabaseEmail.length > 0,
    staleTime: 30_000,
  });

  const fallbackPendingInvites = useMemo<PendingInviteItem[]>(() => {
    if (mode.kind === "supabase") {
      return [];
    }

    if (!fallbackEmail) {
      return [];
    }

    return projects.flatMap((project) =>
      store
        .getProjectInvites(project.id)
        .filter((invite) => invite.status === "pending")
        .filter((invite) => invite.email.toLowerCase() === fallbackEmail)
        .map((invite) => ({ invite, projectTitle: project.title })),
    );
  }, [mode.kind, projects, fallbackEmail]);

  const pendingInvites = mode.kind === "supabase"
    ? (pendingInvitesQuery.data ?? [])
    : fallbackPendingInvites;

  async function handleAccept(invite: WorkspaceProjectInvite) {
    setAcceptingInviteId(invite.id);
    try {
      const result = await acceptProjectInvite(invite.invite_token);
      if (!result.ok) {
        toast({
          title: t("invitations.acceptFailed"),
          // Resolve the CODE, not the message. `error.message` is developer
          // English written in accept-project-invite.ts, so rendering it put a
          // raw English sentence in a Russian toast for every failure this block
          // can reach. InviteAccept.tsx:153 already resolves the code this way;
          // this was the one acceptance surface that did not, and the new
          // `invite_expired` code would have added a third English string to it.
          description: t(`invite.error.${result.error.code}`, {
            defaultValue: result.error.message,
          }),
          variant: "destructive",
        });
        return;
      }

      toast({ title: t("invitations.acceptedToast") });
      navigate(`/project/${result.invite.project_id}/dashboard`);
    } finally {
      setAcceptingInviteId(null);
      void pendingInvitesQuery.refetch();
    }
  }

  return (
    <Card>
      <CardContent className="p-4 sm:p-6">
        <h3 className="mb-3 flex items-center gap-2 text-body font-semibold text-foreground sm:mb-4">
          <MailPlus className="h-4 w-4 text-accent" /> {t("invitations.pendingTitle")}
        </h3>
        {pendingInvites.length === 0 ? (
          <p className="text-caption text-muted-foreground py-2">
            {t("invitations.none")}
          </p>
        ) : (
          <div className="space-y-2">
            {pendingInvites.map(({ invite, projectTitle }) => (
              <div
                key={invite.id}
                className="flex flex-col gap-2 rounded-lg border border-border/70 p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="text-body-sm font-medium text-foreground truncate">{projectTitle}</p>
                  <p className="text-caption text-muted-foreground truncate">
                    {invite.email} · {invite.role}
                  </p>
                </div>
                <Button
                  size="sm"
                  onClick={() => void handleAccept(invite)}
                  disabled={acceptingInviteId === invite.id}
                >
                  {acceptingInviteId === invite.id ? t("invitations.accepting") : t("invitations.accept")}
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
