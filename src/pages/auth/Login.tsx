import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthCard } from "@/components/auth/AuthCard";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { clearDemoSession, hasCompletedOnboarding, setAuthRole } from "@/lib/auth-state";
import { clearAiSidebarSessionPreference } from "@/lib/ai-sidebar-session";
import { setAnalyticsUserId, trackEventOncePerUser } from "@/lib/analytics";

export default function Login() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const nextUrl = searchParams.get("next");
  const confirmed = searchParams.get("confirmed") === "1";

  useEffect(() => {
    if (confirmed) {
      toast({
        title: t("auth.login.emailConfirmedTitle"),
        description: t("auth.login.emailConfirmedDescription"),
      });
    }
  }, [confirmed, t]);

  const resolveDestination = (completedOnboarding: boolean): string => {
    if (nextUrl && nextUrl.startsWith("/")) return nextUrl;
    return completedOnboarding ? "/home" : "/onboarding";
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      toast({ title: t("auth.login.validationTitle"), description: t("auth.login.validationDescription"), variant: "destructive" });
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (error) {
        throw error;
      }

      if (!data.session?.user) {
        throw new Error(t("auth.login.noSession"));
      }

      clearDemoSession();
      clearAiSidebarSessionPreference();
      setAuthRole("owner");

      // Set the analytics user id now so the once-per-user guard below keys on
      // the real user id (AppLayout also sets it post-navigation; idempotent).
      setAnalyticsUserId(data.session.user.id);

      // "First login" = the user's first sign-in while still in the signup
      // funnel (onboarding not completed). Once-per-user guarded so repeated
      // pre-onboarding logins can't re-fire this funnel step and inflate
      // activation/retention metrics.
      const completedOnboarding = await hasCompletedOnboarding(data.session.user.id);
      if (!completedOnboarding) {
        trackEventOncePerUser("first_login", { user_id: data.session.user.id, via: "login" });
      }

      toast({ title: t("auth.login.successTitle"), description: t("auth.login.successDescription") });
      navigate(resolveDestination(completedOnboarding));
    } catch (error) {
      toast({
        title: t("auth.login.failureTitle"),
        description: error instanceof Error ? error.message : t("auth.login.genericFailure"),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthCard
      title={t("auth.login.title")}
      subtitle={t("auth.login.subtitle")}
      footer={
        <div className="flex items-center justify-between text-body-sm">
          <Link to="/auth/forgot" className="text-accent hover:underline">{t("auth.login.forgotPassword")}</Link>
          <Link to="/auth/signup" className="text-accent hover:underline">{t("auth.login.createAccount")}</Link>
        </div>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-sp-2">
        <div className="space-y-1.5">
          <Label htmlFor="email">{t("common.email")}</Label>
          <Input id="email" type="email" placeholder={t("common.emailPlaceholder")} value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="password">{t("common.password")}</Label>
          <Input id="password" type="password" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <Button type="submit" disabled={loading} className="w-full bg-accent text-accent-foreground hover:bg-accent/90">
          {loading ? t("auth.login.submitting") : t("auth.login.submit")}
        </Button>
      </form>
    </AuthCard>
  );
}
