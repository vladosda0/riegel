import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SettingsSection } from "@/components/settings/SettingsSection";
import { toast } from "@/hooks/use-toast";
import {
  useUpdateWorkspaceProfilePreferences,
  useWorkspaceProfilePreferencesState,
} from "@/hooks/use-workspace-source";
import type {
  ProfileAiOutputLanguage,
  ProfileAutomationLevel,
  ProfileCurrency,
  ProfileDateFormat,
  ProfileUnits,
  ProfileWeekStart,
} from "@/data/workspace-source";
import { MVP_SHOW_AI_AUTOMATION_MODE_UI } from "@/lib/mvp-ai-automation-ui";
import { type AppLanguage, getStoredLanguage, setAppLanguage } from "@/i18n";

const INTERFACE_LANGUAGES: Array<{ value: AppLanguage; labelKey: string }> = [
  { value: "ru", labelKey: "preferences.language.ru" },
  { value: "en", labelKey: "preferences.language.en" },
];

const CURRENCIES = [
  { value: "RUB", labelKey: "preferences.currency.rub" },
  { value: "USD", labelKey: "preferences.currency.usd" },
  { value: "EUR", labelKey: "preferences.currency.eur" },
  { value: "GBP", labelKey: "preferences.currency.gbp" },
];

const DATE_FORMATS = [
  { value: "dd.MM.yyyy", label: "DD.MM.YYYY" },
  { value: "MM/dd/yyyy", label: "MM/DD/YYYY" },
  { value: "yyyy-MM-dd", label: "YYYY-MM-DD" },
];

const AI_LANGUAGES: Array<{ value: string; label?: string; labelKey?: string }> = [
  { value: "ru", label: "Русский" },
  { value: "en", label: "English" },
  { value: "auto", labelKey: "preferences.aiLanguage.auto" },
];

const AUTOMATION_LEVELS = [
  { value: "manual", labelKey: "preferences.automation.low", descKey: "preferences.automation.lowDesc" },
  { value: "assisted", labelKey: "preferences.automation.balanced", descKey: "preferences.automation.balancedDesc" },
  { value: "full", labelKey: "preferences.automation.high", descKey: "preferences.automation.highDesc" },
];

export function PreferencesPanel() {
  const { t } = useTranslation();
  const { preferences, isLoading } = useWorkspaceProfilePreferencesState();
  const updatePreferences = useUpdateWorkspaceProfilePreferences();
  const [interfaceLanguage, setInterfaceLanguage] = useState<AppLanguage>(() => getStoredLanguage());
  const [currency, setCurrency] = useState("RUB");
  const [units, setUnits] = useState("metric");
  const [dateFormat, setDateFormat] = useState("dd.MM.yyyy");
  const [weekStart, setWeekStart] = useState("monday");
  const [aiLanguage, setAiLanguage] = useState("auto");
  const [automationLevel, setAutomationLevel] = useState("manual");

  const handleInterfaceLanguageChange = (next: string) => {
    const lang: AppLanguage = next === "en" ? "en" : "ru";
    setInterfaceLanguage(lang);
    setAppLanguage(lang);
    toast({ title: t("preferences.languageChangedToast") });
  };

  useEffect(() => {
    if (!preferences) return;
    setCurrency(preferences.currency);
    setUnits(preferences.units);
    setDateFormat(preferences.dateFormat);
    setWeekStart(preferences.weekStart);
    setAiLanguage(preferences.aiOutputLanguage);
    setAutomationLevel(preferences.automationLevel);
  }, [preferences]);

  const handleSave = async () => {
    try {
      await updatePreferences.mutateAsync({
        currency: currency as ProfileCurrency,
        units: units as ProfileUnits,
        dateFormat: dateFormat as ProfileDateFormat,
        weekStart: weekStart as ProfileWeekStart,
        aiOutputLanguage: aiLanguage as ProfileAiOutputLanguage,
        automationLevel: (MVP_SHOW_AI_AUTOMATION_MODE_UI ? automationLevel : "manual") as ProfileAutomationLevel,
      });
      toast({ title: t("preferences.savedToast") });
    } catch {
      toast({
        title: t("preferences.saveFailedToast"),
        description: t("preferences.saveFailedDescription"),
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-sp-3">
      <SettingsSection title={t("preferences.interface.title")} description={t("preferences.interface.description")}>
        <div className="grid gap-sp-2 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>{t("preferences.interfaceLanguage")}</Label>
            <Select value={interfaceLanguage} onValueChange={handleInterfaceLanguageChange}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {INTERFACE_LANGUAGES.map((l) => (
                  <SelectItem key={l.value} value={l.value}>{t(l.labelKey)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </SettingsSection>

      <SettingsSection title={t("preferences.regional.title")} description={t("preferences.regional.description")}>
        <div className="grid gap-sp-2 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>{t("preferences.currency")}</Label>
            <Select value={currency} onValueChange={setCurrency}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {CURRENCIES.map((c) => <SelectItem key={c.value} value={c.value}>{t(c.labelKey)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>{t("preferences.units")}</Label>
            <Select value={units} onValueChange={setUnits}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="metric">{t("preferences.units.metric")}</SelectItem>
                <SelectItem value="imperial">{t("preferences.units.imperial")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>{t("preferences.dateFormat")}</Label>
            <Select value={dateFormat} onValueChange={setDateFormat}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {DATE_FORMATS.map((f) => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>{t("preferences.weekStart")}</Label>
            <Select value={weekStart} onValueChange={setWeekStart}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="monday">{t("preferences.weekStart.monday")}</SelectItem>
                <SelectItem value="sunday">{t("preferences.weekStart.sunday")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </SettingsSection>

      <SettingsSection title={t("preferences.ai.title")} description={t("preferences.ai.description")}>
        <div className="grid gap-sp-2 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>{t("preferences.aiLanguage")}</Label>
            <Select value={aiLanguage} onValueChange={setAiLanguage}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {AI_LANGUAGES.map((l) => (
                  <SelectItem key={l.value} value={l.value}>
                    {l.labelKey ? t(l.labelKey) : l.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {MVP_SHOW_AI_AUTOMATION_MODE_UI ? (
          <div className="space-y-1.5">
            <Label>{t("preferences.automation")}</Label>
            <Select value={automationLevel} onValueChange={setAutomationLevel}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {AUTOMATION_LEVELS.map((l) => (
                  <SelectItem key={l.value} value={l.value}>
                    <div>
                      <span className="font-medium">{t(l.labelKey)}</span>
                      <span className="text-muted-foreground ml-1.5 text-xs">— {t(l.descKey)}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          ) : null}
        </div>
      </SettingsSection>

      <div className="flex flex-wrap gap-sp-2 pt-sp-1">
        <Button
          className="w-full sm:w-auto"
          disabled={isLoading || updatePreferences.isPending}
          onClick={() => void handleSave()}
        >
          {updatePreferences.isPending ? t("preferences.saving") : t("preferences.save")}
        </Button>
      </div>
    </div>
  );
}
