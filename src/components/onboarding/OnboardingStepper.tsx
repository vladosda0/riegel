import { useState, type MouseEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Zap, Bot, Wrench, Eye, Plus, Trash2, Building2 } from "lucide-react";
import { MVP_SHOW_AI_AUTOMATION_MODE_UI } from "@/lib/mvp-ai-automation-ui";
import { getPlanningSource } from "@/data/planning-source";
import { getWorkspaceSource, resolveWorkspaceMode, resolveRuntimeWorkspaceMode, type ProfileUnits } from "@/data/workspace-source";
import { useWorkspaceMode } from "@/hooks/use-mock-data";
import { workspaceQueryKeys } from "@/hooks/use-workspace-source";
import { planningQueryKeys } from "@/hooks/use-planning-source";
import { useCreateOrganization, useSetActiveOrg } from "@/hooks/use-orgs";
import { suggestOrgSlug } from "@/data/org-source";
import { toast } from "@/hooks/use-toast";
import { trackEvent } from "@/lib/analytics";
import { type AppLanguage, getActiveLanguage, setAppLanguage } from "@/i18n";

const MAX_ONBOARDING_STAGES = 5;

const automationLevels = [
  { id: "full", icon: Zap, titleKey: "onboarding.automation.full.title", descKey: "onboarding.automation.full.desc", badgeKey: "onboarding.automation.full.badge" },
  { id: "assisted", icon: Bot, titleKey: "onboarding.automation.assisted.title", descKey: "onboarding.automation.assisted.desc", badgeKey: null },
  { id: "manual", icon: Wrench, titleKey: "onboarding.automation.manual.title", descKey: "onboarding.automation.manual.desc", badgeKey: null },
  { id: "observer", icon: Eye, titleKey: "onboarding.automation.observer.title", descKey: "onboarding.automation.observer.desc", badgeKey: null },
] as const;

interface OnboardingStepperProps {
  onComplete: () => void;
  onProjectCreated?: (projectId: string) => void;
}

export function OnboardingStepper({ onComplete, onProjectCreated }: OnboardingStepperProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const workspaceMode = useWorkspaceMode();
  const showAutomationStep = MVP_SHOW_AI_AUTOMATION_MODE_UI;
  const [step, setStep] = useState(showAutomationStep ? 0 : 1);
  const [selectedLevel, setSelectedLevel] = useState("manual");
  const [language, setLanguage] = useState<AppLanguage>(() => getActiveLanguage());
  const [units, setUnits] = useState("metric");

  // Apply + persist the interface language immediately when chosen. Previously the
  // selection was discarded — it never reached i18n or localStorage.
  const handleLanguageChange = (next: string) => {
    const lang: AppLanguage = next === "en" ? "en" : "ru";
    setLanguage(lang);
    setAppLanguage(lang);
  };

  const [projectTitle, setProjectTitle] = useState("");
  const [projectType, setProjectType] = useState("residential");
  const [creatingProject, setCreatingProject] = useState(false);
  const [createdProjectId, setCreatedProjectId] = useState<string | null>(null);

  const [stageTitles, setStageTitles] = useState<string[]>([
    t("onboarding.estimate.defaultStageLabel", { n: 1 }),
  ]);
  const [savingStages, setSavingStages] = useState(false);

  const showOrgStep = workspaceMode.kind === "supabase" || workspaceMode.kind === "pending-supabase";
  const [orgSectionExpanded, setOrgSectionExpanded] = useState(false);
  const [orgName, setOrgName] = useState("");
  const createOrgMutation = useCreateOrganization();
  const setActiveOrgMutation = useSetActiveOrg();

  const progressIndices = (() => {
    const base = showAutomationStep ? [0, 1, 2, 3] : [1, 2, 3];
    return showOrgStep ? [...base, 4] : base;
  })();

  async function handleCreateProject(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    if (creatingProject) return;

    const title = projectTitle.trim() || t("projectsTab.untitledProject");
    setCreatingProject(true);

    try {
      const resolvedMode = workspaceMode.kind === "pending-supabase"
        ? await resolveWorkspaceMode()
        : workspaceMode;
      const workspaceSource = await getWorkspaceSource(resolvedMode);
      const createdProject = await workspaceSource.createProject({
        title,
        type: projectType,
        projectMode: "contractor",
      });

      if (resolvedMode.kind === "supabase") {
        await queryClient.invalidateQueries({
          queryKey: workspaceQueryKeys.projects(resolvedMode.profileId),
        });
        await queryClient.invalidateQueries({
          queryKey: workspaceQueryKeys.project(resolvedMode.profileId, createdProject.id),
        });
        await queryClient.invalidateQueries({
          queryKey: workspaceQueryKeys.projectMembers(resolvedMode.profileId, createdProject.id),
        });
      }

      trackEvent("project_created", {
        source: "onboarding",
        workspace: resolvedMode.kind,
        project_type: projectType,
      });
      setCreatedProjectId(createdProject.id);
      onProjectCreated?.(createdProject.id);
      setStep(3);
    } catch (error) {
      toast({
        title: t("projectsTab.projectCreationFailed"),
        description: error instanceof Error ? error.message : t("projectsTab.projectCreationFailedGeneric"),
        variant: "destructive",
      });
    } finally {
      setCreatingProject(false);
    }
  }

  function handleSkipProject() {
    setStep(3);
  }

  async function persistProjectStages(resolvedTitles: string[]) {
    if (!createdProjectId) return;
    const resolvedMode =
      workspaceMode.kind === "pending-supabase" ? await resolveWorkspaceMode() : workspaceMode;
    const planningSource = await getPlanningSource(resolvedMode);

    for (let i = 0; i < resolvedTitles.length; i++) {
      await planningSource.createProjectStage({
        projectId: createdProjectId,
        title: resolvedTitles[i],
        description: "",
        order: i + 1,
        status: "open",
      });
    }

    if (resolvedMode.kind === "supabase") {
      await queryClient.invalidateQueries({
        queryKey: planningQueryKeys.projectStages(resolvedMode.profileId, createdProjectId),
      });
    }
  }

  async function persistUnits() {
    // Guest/unauthenticated have no profile_settings row to write; skip silently.
    // Runtime resolver: it can resolve to guest, plain resolveWorkspaceMode cannot.
    if (workspaceMode.kind === "guest") return;
    const resolvedMode =
      workspaceMode.kind === "pending-supabase" ? await resolveRuntimeWorkspaceMode() : workspaceMode;
    if (resolvedMode.kind === "guest") return;
    const workspaceSource = await getWorkspaceSource(resolvedMode);
    await workspaceSource.updateProfilePreferences({ units: units as ProfileUnits });
    if (resolvedMode.kind === "supabase") {
      await queryClient.invalidateQueries({
        queryKey: workspaceQueryKeys.profilePreferences(resolvedMode.profileId),
      });
    }
  }

  async function handleContinueFromPreferences() {
    // Persist the units choice before advancing, but never block onboarding on it.
    try {
      await persistUnits();
    } catch {
      toast({
        title: t("preferences.saveFailedToast"),
        description: t("preferences.saveFailedDescription"),
        variant: "destructive",
      });
    }
    setStep(2);
  }

  function finishOrAdvanceToOrgStep() {
    if (showOrgStep) {
      setStep(4);
    } else {
      onComplete();
    }
  }

  async function handleSaveStages() {
    if (!createdProjectId || savingStages) return;
    setSavingStages(true);
    try {
      const resolvedTitles = stageTitles.map((raw, i) => {
        const trimmed = raw.trim();
        return trimmed || t("onboarding.estimate.defaultStageLabel", { n: i + 1 });
      });
      await persistProjectStages(resolvedTitles);
      finishOrAdvanceToOrgStep();
    } catch (error) {
      toast({
        title: t("projectsTab.projectCreationFailed"),
        description: error instanceof Error ? error.message : t("projectsTab.projectCreationFailedGeneric"),
        variant: "destructive",
      });
    } finally {
      setSavingStages(false);
    }
  }

  async function handleSkipStages() {
    if (!createdProjectId || savingStages) return;
    setSavingStages(true);
    try {
      await persistProjectStages([t("projectsTab.stage1")]);
      finishOrAdvanceToOrgStep();
    } catch (error) {
      toast({
        title: t("projectsTab.projectCreationFailed"),
        description: error instanceof Error ? error.message : t("projectsTab.projectCreationFailedGeneric"),
        variant: "destructive",
      });
    } finally {
      setSavingStages(false);
    }
  }

  async function handleCreateOrg() {
    if (createOrgMutation.isPending) return;
    const trimmedName = orgName.trim();
    if (!trimmedName) return;
    try {
      const created = await createOrgMutation.mutateAsync({
        name: trimmedName,
        slug: suggestOrgSlug(trimmedName),
      });
      try {
        await setActiveOrgMutation.mutateAsync(created.id);
      } catch {
        // Active context is a soft-failure: the org exists either way.
      }
      toast({ title: t("onboarding.org.createSuccess") });
      onComplete();
    } catch (error) {
      toast({
        title: t("onboarding.org.createError"),
        description: error instanceof Error ? error.message : undefined,
        variant: "destructive",
      });
    }
  }

  function addStageRow() {
    setStageTitles((rows) => {
      if (rows.length >= MAX_ONBOARDING_STAGES) return rows;
      const nextIndex = rows.length + 1;
      return [...rows, t("onboarding.estimate.defaultStageLabel", { n: nextIndex })];
    });
  }

  function removeStageRow(index: number) {
    setStageTitles((rows) => (rows.length <= 1 ? rows : rows.filter((_, i) => i !== index)));
  }

  return (
    <div className="w-full max-w-2xl mx-auto space-y-sp-4">
      {/* Progress */}
      <div className="flex items-center gap-2 justify-center">
        {progressIndices.map((i) => (
          <div
            key={i}
            className={`h-1.5 rounded-full transition-all ${
              step >= i ? "w-12 bg-accent" : "w-8 bg-muted"
            }`}
          />
        ))}
      </div>

      {showAutomationStep && step === 0 && (
        <div className="glass-elevated rounded-panel p-sp-4 space-y-sp-3">
          <div className="text-center">
            <h2 className="text-h3 text-foreground">{t("onboarding.automation.title")}</h2>
            <p className="text-body-sm text-muted-foreground mt-1">
              {t("onboarding.automation.subtitle")}
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-sp-2">
            {automationLevels.map((level) => {
              const isSelected = selectedLevel === level.id;
              return (
                <button
                  key={level.id}
                  onClick={() => setSelectedLevel(level.id)}
                  className={`glass rounded-card p-sp-3 text-left transition-all relative ${
                    isSelected ? "ring-2 ring-accent" : "hover:bg-accent/5"
                  }`}
                >
                  {level.badgeKey && (
                    <span className="absolute -top-2 right-3 inline-flex items-center rounded-pill px-2 py-0.5 text-caption font-medium bg-accent text-accent-foreground">
                      {t(level.badgeKey)}
                    </span>
                  )}
                  <level.icon className={`h-5 w-5 mb-sp-1 ${isSelected ? "text-accent" : "text-muted-foreground"}`} />
                  <h3 className="text-body-sm font-semibold text-foreground">{t(level.titleKey)}</h3>
                  <p className="text-caption text-muted-foreground mt-0.5">{t(level.descKey)}</p>
                </button>
              );
            })}
          </div>
          <Button
            onClick={() => setStep(1)}
            className="w-full bg-accent text-accent-foreground hover:bg-accent/90"
          >
            {t("onboarding.continue")}
          </Button>
        </div>
      )}

      {step === 1 && (
        <div className="glass-elevated rounded-panel p-sp-4 space-y-sp-3">
          <div className="text-center">
            <h2 className="text-h3 text-foreground">{t("onboarding.preferences.title")}</h2>
            <p className="text-body-sm text-muted-foreground mt-1">{t("onboarding.preferences.subtitle")}</p>
          </div>
          <div className="space-y-sp-2">
            <div className="space-y-1.5">
              <label className="text-body-sm font-medium text-foreground">{t("onboarding.preferences.languageLabel")}</label>
              <Select value={language} onValueChange={handleLanguageChange}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ru">Русский</SelectItem>
                  <SelectItem value="en">English</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-body-sm font-medium text-foreground">{t("onboarding.preferences.unitsLabel")}</label>
              <Select value={units} onValueChange={setUnits}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="metric">{t("onboarding.preferences.metric")}</SelectItem>
                  <SelectItem value="imperial">{t("onboarding.preferences.imperial")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex gap-sp-2">
            {showAutomationStep ? (
              <Button variant="outline" onClick={() => setStep(0)} className="flex-1">
                {t("onboarding.back")}
              </Button>
            ) : null}
            <Button
              onClick={() => void handleContinueFromPreferences()}
              className={showAutomationStep ? "flex-1 bg-accent text-accent-foreground hover:bg-accent/90" : "w-full bg-accent text-accent-foreground hover:bg-accent/90"}
            >
              {t("onboarding.continue")}
            </Button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="glass-elevated rounded-panel p-sp-4 space-y-sp-3">
          <div className="text-center">
            <h2 className="text-h3 text-foreground">{t("onboarding.project.title")}</h2>
            <p className="text-body-sm text-muted-foreground mt-1">{t("onboarding.project.subtitle")}</p>
          </div>
          <div className="space-y-sp-2">
            <div className="space-y-1.5">
              <Input
                value={projectTitle}
                onChange={(e) => setProjectTitle(e.target.value)}
                placeholder={t("onboarding.project.namePlaceholder")}
                autoFocus
                disabled={creatingProject}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-body-sm font-medium text-foreground">{t("onboarding.project.typeLabel")}</label>
              <select
                value={projectType}
                onChange={(e) => setProjectType(e.target.value)}
                disabled={creatingProject}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="residential">{t("projectsTab.type.residential")}</option>
                <option value="commercial">{t("projectsTab.type.commercial")}</option>
                <option value="industrial">{t("projectsTab.type.industrial")}</option>
              </select>
            </div>
          </div>
          <Button
            onClick={handleCreateProject}
            disabled={creatingProject}
            className="w-full bg-accent text-accent-foreground hover:bg-accent/90"
          >
            {creatingProject ? t("onboarding.project.creating") : t("onboarding.project.createAndContinue")}
          </Button>
          <button
            type="button"
            onClick={handleSkipProject}
            disabled={creatingProject}
            className="w-full text-center text-body-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            {t("onboarding.project.skip")}
          </button>
        </div>
      )}

      {step === 3 && !createdProjectId && (
        <div className="glass-elevated rounded-panel p-sp-4 space-y-sp-3 text-center">
          <h2 className="text-h3 text-foreground">{t("onboarding.done.title")}</h2>
          <p className="text-body-sm text-muted-foreground">{t("onboarding.done.subtitle")}</p>
          <Button
            onClick={finishOrAdvanceToOrgStep}
            className="w-full bg-accent text-accent-foreground hover:bg-accent/90"
          >
            {t("onboarding.done.goToApp")}
          </Button>
        </div>
      )}

      {step === 3 && createdProjectId && (
        <div className="glass-elevated rounded-panel p-sp-4 space-y-sp-3">
          <div className="text-center space-y-sp-1">
            <h2 className="text-h3 text-foreground">{t("onboarding.estimate.title")}</h2>
            <p className="text-body-sm text-muted-foreground">{t("onboarding.estimate.subtitle")}</p>
            <p className="text-caption text-muted-foreground">{t("onboarding.estimate.hint")}</p>
          </div>
          <div className="space-y-1.5">
            {stageTitles.map((title, index) => (
              <div key={index} className="flex gap-2 items-center">
                <Input
                  className="flex-1 min-w-0"
                  value={title}
                  onChange={(e) => {
                    const value = e.target.value;
                    setStageTitles((rows) => rows.map((row, i) => (i === index ? value : row)));
                  }}
                  disabled={savingStages}
                  autoFocus={index === 0}
                />
                {stageTitles.length > 1 ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="shrink-0"
                    onClick={() => removeStageRow(index)}
                    disabled={savingStages}
                    aria-label={t("onboarding.estimate.removeStage")}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                ) : null}
                {index === stageTitles.length - 1 && stageTitles.length < MAX_ONBOARDING_STAGES ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="shrink-0"
                    onClick={addStageRow}
                    disabled={savingStages}
                    aria-label={t("onboarding.estimate.addStage")}
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                ) : null}
              </div>
            ))}
          </div>
          <Button
            onClick={handleSaveStages}
            disabled={savingStages}
            className="w-full bg-accent text-accent-foreground hover:bg-accent/90"
          >
            {savingStages ? t("onboarding.estimate.creating") : t("onboarding.continue")}
          </Button>
          <button
            type="button"
            onClick={handleSkipStages}
            disabled={savingStages}
            className="w-full text-center text-body-sm text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
          >
            {t("onboarding.estimate.skip")}
          </button>
        </div>
      )}

      {step === 4 && showOrgStep && (
        <div className="glass-elevated rounded-panel p-sp-4 space-y-sp-3">
          <div className="text-center space-y-sp-1">
            <Building2 className="mx-auto h-7 w-7 text-accent" />
            <h2 className="text-h3 text-foreground">{t("onboarding.org.title")}</h2>
            <p className="text-body-sm text-muted-foreground">{t("onboarding.org.subtitle")}</p>
          </div>

          {!orgSectionExpanded ? (
            <div className="flex flex-col gap-sp-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setOrgSectionExpanded(true)}
                className="w-full"
              >
                {t("onboarding.org.expand")}
              </Button>
              <Button
                type="button"
                onClick={onComplete}
                className="w-full bg-accent text-accent-foreground hover:bg-accent/90"
              >
                {t("onboarding.org.skip")}
              </Button>
            </div>
          ) : (
            <div className="space-y-sp-2">
              <div className="space-y-1.5">
                <label className="text-body-sm font-medium text-foreground">
                  {t("onboarding.org.nameLabel")}
                </label>
                <Input
                  value={orgName}
                  onChange={(e) => setOrgName(e.target.value)}
                  placeholder={t("onboarding.org.namePlaceholder")}
                  autoFocus
                  disabled={createOrgMutation.isPending}
                />
              </div>
              <div className="flex gap-sp-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setOrgSectionExpanded(false)}
                  disabled={createOrgMutation.isPending}
                  className="flex-1"
                >
                  {t("onboarding.org.collapse")}
                </Button>
                <Button
                  type="button"
                  onClick={handleCreateOrg}
                  disabled={
                    createOrgMutation.isPending
                    || orgName.trim().length === 0
                  }
                  className="flex-1 bg-accent text-accent-foreground hover:bg-accent/90"
                >
                  {createOrgMutation.isPending ? t("onboarding.org.creating") : t("onboarding.org.create")}
                </Button>
              </div>
              <button
                type="button"
                onClick={onComplete}
                disabled={createOrgMutation.isPending}
                className="w-full text-center text-body-sm text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
              >
                {t("onboarding.org.skip")}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
