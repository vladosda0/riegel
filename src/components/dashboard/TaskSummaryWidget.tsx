import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { getUserById } from "@/data/store";
import { StatusBadge } from "@/components/StatusBadge";
import { cn } from "@/lib/utils";
import { ListTodo, ChevronRight, CheckCircle2, Circle, Clock, AlertTriangle } from "lucide-react";
import type { Task } from "@/types/entities";

const taskStatusIcon: Record<string, typeof Circle> = {
  not_started: Circle,
  in_progress: Clock,
  done: CheckCircle2,
  blocked: AlertTriangle,
};

const taskStatusColor: Record<string, string> = {
  not_started: "text-muted-foreground",
  in_progress: "text-info",
  done: "text-success",
  blocked: "text-destructive",
};

function taskStatusLabel(status: Task["status"]): string {
  if (status === "not_started") return "Not started";
  if (status === "in_progress") return "In progress";
  if (status === "done") return "Done";
  return "Blocked";
}

interface Props {
  tasks: Task[];
  projectId: string;
  className?: string;
}

export function TaskSummaryWidget({ tasks, projectId, className }: Props) {
  const { t } = useTranslation();
  const sortedTasks = [...tasks].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );

  return (
    <div className={cn("glass rounded-card p-sp-2", className)}>
      <div className="flex items-center justify-between mb-sp-2">
        <h3 className="text-body font-semibold text-foreground flex items-center gap-2">
          <ListTodo className="h-4 w-4 text-accent" /> {t("taskSummary.title")}
        </h3>
        <Link
          to={`/project/${projectId}/tasks`}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-accent hover:bg-accent/10 transition-colors"
          aria-label={t("taskSummary.viewAllAria")}
        >
          <ChevronRight className="h-4 w-4" />
        </Link>
      </div>
      {sortedTasks.length === 0 ? (
        <p className="text-caption text-muted-foreground text-center py-sp-2">{t("taskSummary.empty")}</p>
      ) : (
        <div className="space-y-1.5">
          {sortedTasks.slice(0, 8).map((task) => {
            const Icon = taskStatusIcon[task.status] ?? Circle;
            const color = taskStatusColor[task.status] ?? "text-muted-foreground";
            const assignee = getUserById(task.assignee_id);
            return (
              <div key={task.id} className="flex items-center gap-2 rounded-panel bg-muted/40 p-1.5 px-sp-2">
                <Icon className={`h-3.5 w-3.5 shrink-0 ${color}`} />
                <StatusBadge status={taskStatusLabel(task.status)} variant="task" className="text-[10px] px-1.5 py-0" />
                <span className="text-caption text-foreground flex-1 truncate">{task.title}</span>
                <span className="text-[10px] text-muted-foreground truncate max-w-[120px]">
                  {assignee?.name ?? t("taskSummary.unassigned")}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
