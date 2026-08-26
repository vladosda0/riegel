import { useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import {
  Plus, FileText, Upload, CreditCard, AlertTriangle,
  Clock, CheckCircle2, FolderOpen, ChevronRight,
} from "lucide-react";
import { useProjects, useCurrentUser, useWorkspaceMode } from "@/hooks/use-mock-data";
import { useProjectsRecentEventsMap } from "@/hooks/use-activity-source";
import * as store from "@/data/store";
import { OrgBlock } from "@/components/home/OrgBlock";
import { PendingInvitationsBlock } from "@/components/home/PendingInvitationsBlock";
import { useWorkspaceProjectsSensitiveDetailMap } from "@/hooks/use-home-sensitive-detail-map";
import { getActivityDisplayDetailForHome } from "@/lib/activity-display";
import { getEventCaption, isFallbackActor } from "@/lib/event-catalog";
import { isAIEvent } from "@/components/ai/event-utils";

function getStatusColor(progress: number): string {
  if (progress >= 100) return "bg-success/15 text-success";
  if (progress > 0) return "bg-info/15 text-info";
  return "bg-muted text-muted-foreground";
}
function getStatusKey(progress: number): string {
  if (progress >= 100) return "status.done";
  if (progress > 0) return "status.inProgress";
  return "status.draft";
}

export function OverviewTab() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const projects = useProjects();
  const user = useCurrentUser();
  const workspaceMode = useWorkspaceMode();
  // The demo is a mockup, not an account: /settings (incl. billing) is
  // unreachable there, so don't offer a quick action that would dead-end.
  const isDemo = workspaceMode.kind === "demo";
  const allTasks = store.getAllTasks();

  const upcomingTasks = allTasks
    .filter((t) => t.status === "in_progress" || t.status === "not_started")
    .slice(0, 6);

  const overdueTasks = allTasks.filter((t) => {
    if (!t.deadline || t.status === "done") return false;
    return new Date(t.deadline) < new Date();
  });

  const recentProjects = [...projects]
    .sort((a, b) => b.progress_pct - a.progress_pct)
    .slice(0, 5);
  const recentActivityByProject = useProjectsRecentEventsMap(
    projects.slice(0, 3).map((project) => project.id),
    2,
  );
  const { canViewSensitiveDetailByProjectId } = useWorkspaceProjectsSensitiveDetailMap();
  const activityRedactionByProject = useMemo(() => {
    const record: Record<string, { canViewFinanceDetail: boolean }> = {};
    for (const [pid, canView] of canViewSensitiveDetailByProjectId) {
      record[pid] = { canViewFinanceDetail: canView };
    }
    return record;
  }, [canViewSensitiveDetailByProjectId]);

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Hero + org block live only on the Overview section per the Session 3.2.1b layout. */}
      <div>
        <h1 className="text-h2 text-foreground">{t("home.title")}</h1>
        <p className="text-body-sm text-muted-foreground mt-1">
          {t("home.subtitle")}
        </p>
      </div>

      <OrgBlock />

      {/* Quick actions */}
      <div className="flex items-center gap-2 flex-wrap">
        <Button size="sm" onClick={() => navigate("/home?tab=projects")}>
          <Plus className="h-3.5 w-3.5 mr-1.5" /> {t("overview.createProject")}
        </Button>
        <Button size="sm" variant="outline" onClick={() => navigate("/home?tab=tasks")}>
          <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" /> {t("overview.newTask")}
        </Button>
        <Button size="sm" variant="outline" onClick={() => navigate("/home?tab=documents")}>
          <Upload className="h-3.5 w-3.5 mr-1.5" /> {t("overview.uploadDocument")}
        </Button>
        {!isDemo && (
          <Button size="sm" variant="outline" onClick={() => navigate("/settings?tab=billing")}>
            <CreditCard className="h-3.5 w-3.5 mr-1.5" /> {t("overview.billing")}
          </Button>
        )}
      </div>

      {/* Demo→signup CTA lives in AppLayout (bottom of every demo page), so the
          overview deliberately carries no extra copy of it. */}

      <div className="grid grid-cols-1 gap-4 sm:gap-6 lg:grid-cols-2">
        {/* Left column */}
        <div className="space-y-4 sm:space-y-6">
          <PendingInvitationsBlock />

          {/* My Projects */}
          <Card>
            <CardContent className="p-4 sm:p-6">
              <div className="mb-3 flex items-center justify-between sm:mb-4">
                <h3 className="text-body font-semibold text-foreground flex items-center gap-2">
                  <FolderOpen className="h-4 w-4 text-accent" /> {t("overview.myProjects")}
                </h3>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0 text-accent"
                  onClick={() => navigate("/home?tab=projects")}
                  aria-label="View all projects"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
              <div className="space-y-2">
                {recentProjects.map((p) => (
                  <Link
                    key={p.id}
                    to={`/project/${p.id}/dashboard`}
                    className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-body-sm font-medium text-foreground truncate">{p.title}</p>
                      <Progress value={p.progress_pct} className="h-1 mt-1" />
                    </div>
                    <span className={`text-caption font-medium px-2 py-0.5 rounded-pill shrink-0 ${getStatusColor(p.progress_pct)}`}>
                      {t(getStatusKey(p.progress_pct))}
                    </span>
                  </Link>
                ))}
                {recentProjects.length === 0 && (
                  <p className="text-caption text-muted-foreground py-4 text-center">{t("overview.noProjects")}</p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Upcoming Tasks */}
          <Card>
            <CardContent className="p-4 sm:p-6">
              <div className="mb-3 flex items-center justify-between sm:mb-4">
                <h3 className="text-body font-semibold text-foreground flex items-center gap-2">
                  <Clock className="h-4 w-4 text-info" /> {t("overview.upcomingTasks")}
                </h3>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0 text-accent"
                  onClick={() => navigate("/home?tab=tasks")}
                  aria-label="View all tasks"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
              <div className="space-y-1.5">
                {upcomingTasks.map((task) => {
                  const project = store.getProject(task.project_id);
                  return (
                    <Link
                      key={task.id}
                      to={`/project/${task.project_id}/tasks`}
                      className="flex items-center gap-2 p-2 rounded-lg hover:bg-muted/50 transition-colors"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-body-sm text-foreground truncate">{task.title}</p>
                        <p className="text-caption text-muted-foreground truncate">{project?.title}</p>
                      </div>
                      <Badge variant="secondary" className="text-[10px] shrink-0">
                        {t(task.status === "in_progress" ? "status.active" : "status.pending")}
                      </Badge>
                    </Link>
                  );
                })}
                {upcomingTasks.length === 0 && (
                  <p className="text-caption text-muted-foreground py-4 text-center">{t("overview.noUpcoming")}</p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Overdue */}
          {overdueTasks.length > 0 && (
            <Card className="border-destructive/30">
              <CardContent className="p-4 sm:p-6">
                <h3 className="mb-3 flex items-center gap-2 text-body font-semibold text-destructive sm:mb-4">
                  <AlertTriangle className="h-4 w-4" /> {t("overview.overdueTasks")}
                </h3>
                <div className="space-y-1.5">
                  {overdueTasks.slice(0, 5).map((t) => (
                    <Link
                      key={t.id}
                      to={`/project/${t.project_id}/tasks`}
                      className="flex items-center gap-2 p-2 rounded-lg hover:bg-destructive/5 transition-colors"
                    >
                      <p className="text-body-sm text-foreground truncate flex-1">{t.title}</p>
                      <span className="text-caption text-destructive shrink-0">
                        {t.deadline ? new Date(t.deadline).toLocaleDateString() : ""}
                      </span>
                    </Link>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Right column */}
        <div className="space-y-4 sm:space-y-6">
          {/* Documents needing attention */}
          <Card>
            <CardContent className="p-4 sm:p-6">
              <h3 className="mb-3 flex items-center gap-2 text-body font-semibold text-foreground sm:mb-4">
                <FileText className="h-4 w-4 text-warning" /> {t("overview.documents")}
              </h3>
              <p className="text-caption text-muted-foreground py-4 text-center">
                {t("overview.documentsEmpty")}
              </p>
            </CardContent>
          </Card>

          {/* Inventory alerts */}
          <Card>
            <CardContent className="p-4 sm:p-6">
              <h3 className="mb-3 text-body font-semibold text-foreground sm:mb-4">{t("overview.inventoryAlerts")}</h3>
              <p className="text-caption text-muted-foreground py-4 text-center">
                {t("overview.inventoryEmpty")}
              </p>
            </CardContent>
          </Card>

          {/* Recent activity */}
          <Card>
            <CardContent className="p-4 sm:p-6">
              <h3 className="mb-3 text-body font-semibold text-foreground sm:mb-4">{t("overview.recentActivity")}</h3>
              <div className="space-y-1.5">
                {projects.slice(0, 3).map((p) => {
                  const events = recentActivityByProject[p.id] ?? [];
                  return events.map((evt) => {
                    const line = getActivityDisplayDetailForHome(evt, activityRedactionByProject, {
                      canViewFinanceDetail: false,
                    });
                    // Same rule as the sidebar row, from the same function, so the two
                    // surfaces cannot disagree about one event.
                    const summary = line
                      ?? getEventCaption(
                        t,
                        evt.type,
                        isFallbackActor(isAIEvent(evt), Boolean(store.getUserById(evt.actor_id))),
                      );
                    return (
                      <div key={evt.id} className="flex items-center gap-2 p-1.5 text-caption text-muted-foreground">
                        <span className="h-1.5 w-1.5 rounded-full bg-accent shrink-0" />
                        <span className="truncate">{summary} — {p.title}</span>
                      </div>
                    );
                  });
                })}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
