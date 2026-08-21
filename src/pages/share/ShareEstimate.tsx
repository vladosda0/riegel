import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/EmptyState";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { useEstimateV2Share } from "@/hooks/use-estimate-v2-data";
import { useRuntimeAuth } from "@/hooks/use-runtime-auth";
import {
  approveVersion,
  findVersionByShareId,
  getLatestProposedVersion,
} from "@/data/estimate-v2-store";
import { approveSharedEstimateVersion } from "@/data/estimate-share-source";
import { computeLineTotals, computeProjectTotals } from "@/lib/estimate-v2/pricing";
import { ApprovalStampCard } from "@/components/estimate-v2/ApprovalStampCard";
import { ApprovalStampFormModal } from "@/components/estimate-v2/ApprovalStampFormModal";
import type { ApprovalStamp } from "@/types/estimate-v2";
import { SHOW_ESTIMATE_VERSION_UI } from "@/lib/estimate-v2/show-estimate-version-ui";
import { useTranslation } from "react-i18next";

function money(cents: number, currency: string): string {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

function qtyFromMilli(qtyMilli: number): string {
  return (qtyMilli / 1000).toString();
}

export default function ShareEstimate() {
  const { shareId = "" } = useParams<{ shareId: string }>();
  const { toast } = useToast();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { shared, status: shareStatus } = useEstimateV2Share(shareId);
  const { status: authStatus } = useRuntimeAuth();

  const [approvalModalOpen, setApprovalModalOpen] = useState(false);

  const snapshot = shared?.version.snapshot;
  const projectId = shared?.projectId ?? "";
  const version = shared?.version ?? null;

  const sortedStages = useMemo(
    () => [...(snapshot?.stages ?? [])].sort((a, b) => a.order - b.order),
    [snapshot?.stages],
  );

  const worksByStage = useMemo(() => {
    const works = snapshot?.works ?? [];
    const map = new Map<string, typeof works>();
    works.forEach((work) => {
      const list = map.get(work.stageId) ?? [];
      list.push(work);
      map.set(work.stageId, list);
    });
    map.forEach((list) => list.sort((a, b) => a.order - b.order));
    return map;
  }, [snapshot?.works]);

  const linesByWork = useMemo(() => {
    const lines = snapshot?.lines ?? [];
    const map = new Map<string, typeof lines>();
    lines.forEach((line) => {
      const list = map.get(line.workId) ?? [];
      list.push(line);
      map.set(line.workId, list);
    });
    return map;
  }, [snapshot?.lines]);

  const stageById = useMemo(
    () => new Map((snapshot?.stages ?? []).map((stage) => [stage.id, stage])),
    [snapshot?.stages],
  );

  const lineTotalsById = useMemo(() => {
    const lines = snapshot?.lines ?? [];
    const project = snapshot?.project;
    const map = new Map<string, ReturnType<typeof computeLineTotals>>();
    if (!project) return map;

    lines.forEach((line) => {
      const stage = stageById.get(line.stageId);
      if (!stage) return;
      map.set(line.id, computeLineTotals(line, stage, project, project.projectMode));
    });
    return map;
  }, [snapshot?.lines, snapshot?.project, stageById]);

  const totals = useMemo(() => {
    if (!snapshot) {
      return {
        subtotalCents: 0,
        taxableBaseCents: 0,
        subtotalBeforeDiscountCents: 0,
        taxAmountCents: 0,
        totalCents: 0,
        costTotalCents: 0,
        markupTotalCents: 0,
        discountTotalCents: 0,
        breakdownByType: {
          material: 0,
          tool: 0,
          labor: 0,
          subcontractor: 0,
          other: 0,
        },
      };
    }

    return computeProjectTotals(
      snapshot.project,
      snapshot.stages,
      snapshot.works,
      snapshot.lines,
      snapshot.project.projectMode,
    );
  }, [snapshot]);

  const latestProposed = SHOW_ESTIMATE_VERSION_UI && projectId ? getLatestProposedVersion(projectId) : null;
  const newerProposed = SHOW_ESTIMATE_VERSION_UI && latestProposed && version && latestProposed.number > version.number ? latestProposed : null;
  const approvalEligible = version?.status === "proposed"
    && version.submitted
    && !version.archived
    && !version.approvalStamp;
  // The `registered` share policy is decided by the real Supabase session, not
  // by `isAuthenticated()`: that reads the role-simulation key in localStorage,
  // which a first-time visitor has never set, and getAuthRole() then defaults
  // to "owner" (src/lib/auth-state.ts).
  const approvalBlockedByPolicy = version?.shareApprovalPolicy === "disabled";
  const canApprove = Boolean(approvalEligible && authStatus === "authenticated" && !approvalBlockedByPolicy);
  const requiresRegistrationToApprove = Boolean(approvalEligible && authStatus === "guest" && !approvalBlockedByPolicy);

  if (shareStatus === "loading") {
    return (
      <div className="flex min-h-[40vh] items-center justify-center p-sp-3 text-sm text-muted-foreground">
        {t("app.loading")}
      </div>
    );
  }

  if (!shared || !snapshot || !version) {
    return (
      <div className="p-sp-3">
        <EmptyState icon={AlertTriangle} title={t("share.estimate.notFoundTitle")} description={t("share.estimate.notFoundBody")} />
      </div>
    );
  }

  const handleApprove = async (stamp: ApprovalStamp) => {
    if (!canApprove) {
      toast({ title: t("share.estimate.toast.noLonger"), variant: "destructive" });
      return;
    }

    let approvedRemotely = false;
    try {
      await approveSharedEstimateVersion(shareId, stamp);
      approvedRemotely = true;
    } catch (error) {
      // Persisted approval failed (e.g. share token vanished). Fall back to
      // the local store path so same-session flows still behave; surface a
      // toast so the user can retry.
      const message = error instanceof Error ? error.message : String(error);
      toast({ title: t("share.estimate.toast.unableToApprove"), description: message, variant: "destructive" });
    }

    // The `version.id` we see here is the synthetic `share-${token}` ID
    // when the data came from Supabase (rowToVersion shape). Look the
    // matching local-store version up by shareId so approveVersion finds
    // the real row in the same-session creator's store.
    const localShared = findVersionByShareId(shareId);
    const localOk = localShared
      ? approveVersion(localShared.projectId, localShared.version.id, stamp, { actorId: "client" })
      : false;

    if (!localOk && !approvedRemotely) {
      toast({ title: t("share.estimate.toast.unableToApprove"), variant: "destructive" });
      return;
    }

    void queryClient.invalidateQueries({ queryKey: ["estimate-share", shareId] });
    setApprovalModalOpen(false);
    toast({ title: t("share.estimate.toast.approved") });
  };

  const handleRegisterToApprove = () => {
    navigate(`/auth/signup?next=${encodeURIComponent(`/share/estimate/${shareId}`)}`);
  };

  return (
    <div className="mx-auto max-w-6xl p-sp-3 space-y-sp-2">
      <div className="rounded-card border border-border bg-card p-sp-2 space-y-2">
        <h1 className="text-lg font-semibold text-foreground">{t("share.estimate.title")}</h1>
        {SHOW_ESTIMATE_VERSION_UI ? (
          <p className="text-caption text-muted-foreground">
            {t("share.estimate.version", { number: version.number })}
          </p>
        ) : null}

        {newerProposed && (
          <div className="rounded-md border border-warning/40 bg-warning/10 p-2 flex flex-wrap items-center justify-between gap-2">
            <span className="text-caption text-foreground">{t("share.estimate.newVersion")}</span>
            <Button size="sm" variant="outline" onClick={() => navigate(`/share/estimate/${newerProposed.shareId}`)}>
              {t("share.estimate.openLatest")}
            </Button>
          </div>
        )}
        {requiresRegistrationToApprove && (
          <div className="rounded-md border border-info/50 bg-info/10 p-2 text-caption text-foreground">
            {t("share.estimate.registerToApproveHint")}
          </div>
        )}
        {approvalBlockedByPolicy && (
          <div className="rounded-md border border-warning/40 bg-warning/10 p-2 text-caption text-foreground">
            {t("share.estimate.disabledHint")}
          </div>
        )}
      </div>

      <div className="rounded-card border border-border bg-card p-sp-2 flex flex-wrap gap-2">
        {version.approvalStamp && (
          <ApprovalStampCard
            stamp={version.approvalStamp}
            versionNumber={version.number}
            className="w-full"
          />
        )}
        <span className="inline-flex items-center rounded-md border border-border px-2 py-1 text-caption">
          {t("share.estimate.tax", { percent: (snapshot.project.taxBps / 100).toFixed(2), amount: money(totals.taxAmountCents, snapshot.project.currency) })}
        </span>
        <span className="inline-flex items-center rounded-md border border-border px-2 py-1 text-caption font-medium">
          {t("share.estimate.total", { amount: money(totals.totalCents, snapshot.project.currency) })}
        </span>
      </div>

      {sortedStages.map((stage) => {
        const stageWorks = worksByStage.get(stage.id) ?? [];
        return (
          <div key={stage.id} className="rounded-card border border-border bg-card p-sp-2 space-y-2">
            <h2 className="text-body-sm font-semibold text-foreground">{stage.title}</h2>
            {stageWorks.map((work) => {
              const workLines = linesByWork.get(work.id) ?? [];
              return (
                <div key={work.id} className="rounded-md border border-border/80 p-2 space-y-2">
                  <h3 className="text-caption font-medium text-foreground">{work.title}</h3>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("share.estimate.columns.line")}</TableHead>
                        <TableHead className="text-right">{t("share.estimate.columns.qty")}</TableHead>
                        <TableHead>{t("share.estimate.columns.unit")}</TableHead>
                        <TableHead className="text-right">{t("share.estimate.columns.clientUnit")}</TableHead>
                        <TableHead className="text-right">{t("share.estimate.columns.clientTotal")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {workLines.map((line) => {
                        const computed = lineTotalsById.get(line.id);
                        if (!computed) return null;
                        return (
                          <TableRow key={line.id}>
                            <TableCell>{line.title}</TableCell>
                            <TableCell className="text-right">{qtyFromMilli(line.qtyMilli)}</TableCell>
                            <TableCell>{line.unit}</TableCell>
                            <TableCell className="text-right">{money(computed.clientUnitCents, snapshot.project.currency)}</TableCell>
                            <TableCell className="text-right">{money(computed.clientTotalCents, snapshot.project.currency)}</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              );
            })}
          </div>
        );
      })}

      <div className="rounded-card border border-border bg-card p-sp-2 space-y-2">
        <h2 className="text-body-sm font-semibold text-foreground">{t("share.estimate.approvalHeading")}</h2>
        <div className="flex flex-wrap gap-2">
          {canApprove && <Button onClick={() => setApprovalModalOpen(true)}>{t("share.estimate.approveButton")}</Button>}
          {requiresRegistrationToApprove && (
            <Button onClick={handleRegisterToApprove}>{t("share.estimate.registerButton")}</Button>
          )}
          {/* Disabled until a question has somewhere to go: the real channel is
              the project-events-notifications epic (#22). */}
          <Button variant="outline" disabled>{t("share.estimate.askQuestionsSoon")}</Button>
        </div>
      </div>

      <ApprovalStampFormModal
        open={approvalModalOpen}
        onOpenChange={setApprovalModalOpen}
        title={t("share.estimate.approveModalTitle")}
        onSubmit={handleApprove}
      />
    </div>
  );
}
