import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { AuthCard } from "@/components/auth/AuthCard";
import { supabase } from "@/integrations/supabase/client";
import { clearAiSidebarSessionPreference } from "@/lib/ai-sidebar-session";
import { clearDemoSession, setAuthRole } from "@/lib/auth-state";
import { trackEvent } from "@/lib/analytics";

export default function AuthCallback() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;

    const finalize = async () => {
      try {
        // getSession() consumes the confirmation link and (briefly)
        // establishes the verified session — that is the "email verified"
        // moment; the session is then dropped so the user logs in explicitly.
        //
        // Known caveat (accepted): this fires on ANY session present at
        // /auth/callback, not strictly a genuine confirmation. In practice the
        // route is only linked from confirmation emails and always signs out
        // after, so the only over-count path is an already-authenticated user
        // manually navigating here — rare, and email_verified is a directional
        // funnel signal. A precise gate is unreliable because supabase-js may
        // consume the URL token before this effect runs.
        const { data } = await supabase.auth.getSession();
        if (data.session?.user) {
          trackEvent("email_verified", { user_id: data.session.user.id });
        }
      } catch {
        // ignore — we redirect regardless
      }

      if (cancelled) return;

      try {
        await supabase.auth.signOut();
      } catch {
        // ignore — redirect regardless
      }

      if (cancelled) return;

      clearDemoSession();
      clearAiSidebarSessionPreference();
      setAuthRole("guest");
      navigate("/auth/login?confirmed=1", { replace: true });
    };

    void finalize();

    return () => {
      cancelled = true;
    };
  }, [navigate]);

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
