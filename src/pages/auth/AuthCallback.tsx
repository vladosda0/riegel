import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { AuthCard } from "@/components/auth/AuthCard";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { clearAiSidebarSessionPreference } from "@/lib/ai-sidebar-session";
import { clearDemoSession, hasCompletedOnboarding, setAuthRole } from "@/lib/auth-state";
import { setAnalyticsUserId, trackEvent, trackEventOncePerUser } from "@/lib/analytics";

export default function AuthCallback() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;

    const finalize = async () => {
      // supabase-js has already parsed the confirmation link's tokens out of
      // the URL fragment by the time this effect runs, so the session is
      // simply read back here. Clicking the link IS the sign-in: we keep the
      // session instead of dropping it, because forcing a just-confirmed user
      // to retype their password on a phone is where they abandon.
      let session: Awaited<ReturnType<typeof supabase.auth.getSession>>["data"]["session"] = null;
      try {
        const { data } = await supabase.auth.getSession();
        session = data.session;
      } catch {
        // Treated as "no session" below.
      }

      if (cancelled) return;

      // No session means the link was already used, expired, or somebody
      // opened /auth/callback directly. Never drop such a visitor into the
      // app — send them to the login form with an explanation.
      if (!session?.user) {
        toast({
          title: t("auth.confirm.errorTitle"),
          description: t("auth.confirm.invalidLink"),
          variant: "destructive",
        });
        navigate("/auth/login", { replace: true });
        return;
      }

      const user = session.user;

      // Known caveat (accepted, unchanged): this fires on ANY session present
      // at /auth/callback, not strictly a genuine confirmation. The route is
      // only linked from confirmation emails, so the over-count path is an
      // already-authenticated user navigating here by hand — rare, and
      // email_verified is a directional funnel signal.
      trackEvent("email_verified", { user_id: user.id });

      clearDemoSession();
      clearAiSidebarSessionPreference();
      setAuthRole("owner");

      // Set the analytics user id first so the once-per-user guard below keys
      // on the real id (mirrors Login.tsx).
      setAnalyticsUserId(user.id);

      // Confirming the link is now this user's first entry into the product,
      // so first_login belongs here rather than on a password form they no
      // longer have to fill in. Once-per-user guarded, same as Login.tsx.
      const completedOnboarding = await hasCompletedOnboarding(user.id);
      if (!completedOnboarding) {
        trackEventOncePerUser("first_login", { user_id: user.id, via: "email_confirm" });
      }

      if (cancelled) return;

      // The "email confirmed" toast used to live on /auth/login?confirmed=1.
      // Now that we skip that stop, surface it inside the app instead.
      toast({
        title: t("auth.callback.confirmedTitle"),
        description: t("auth.callback.confirmedDescription"),
      });
      navigate(completedOnboarding ? "/home" : "/onboarding", { replace: true });
    };

    void finalize();

    return () => {
      cancelled = true;
    };
  }, [navigate, t]);

  return (
    <AuthCard
      title={t("auth.callback.title")}
      subtitle={t("auth.callback.subtitle")}
    >
      <div className="flex items-center justify-center py-sp-3">
        <Loader2 className="h-6 w-6 animate-spin text-accent" />
      </div>
    </AuthCard>
  );
}
