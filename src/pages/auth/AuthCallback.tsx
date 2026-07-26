import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { AuthCard } from "@/components/auth/AuthCard";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { clearAiSidebarSessionPreference } from "@/lib/ai-sidebar-session";
import { clearDemoSession, hasCompletedOnboarding, setAuthRole } from "@/lib/auth-state";
import { setAnalyticsUserId, trackEventOncePerUser } from "@/lib/analytics";

export default function AuthCallback() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;

    const rejectLink = async () => {
      // Actually sign out, do not just stamp the simulated role. The real
      // gate is the Supabase session (useWorkspaceModeState reads it, not
      // getAuthRole), so writing "guest" beside a live session protects
      // nothing and additionally breaks the routine case: re-tapping an
      // already-used confirmation email would leave a legitimately
      // signed-in user with guest-gated UI and nothing to restore it, the
      // exact anti-pattern use-exit-demo.ts warns about.
      //
      // Signing out here is not a regression: BEFORE this feature the route
      // signed out on every visit, success included. Now only the failure
      // path does, which is strictly narrower and keeps the shared-device
      // case safe (person B's dead link cannot leave person A signed in).
      // Mirrors the canonical sign-out contract in TopBar.
      try {
        await supabase.auth.signOut();
      } catch {
        // Best effort: still clear local state and bounce to the form.
      }
      clearDemoSession();
      clearAiSidebarSessionPreference();
      setAuthRole("guest");
      toast({
        title: t("auth.confirm.errorTitle"),
        description: t("auth.confirm.invalidLink"),
        variant: "destructive",
      });
      navigate("/auth/login", { replace: true });
    };

    const finalize = async () => {
      // A dead link (expired / already used) does NOT clear a session this
      // browser already had: auth-js explicitly keeps the stored session when
      // a URL login fails, and leaves `error` / `error_code` in the URL
      // because it only strips the hash on the success path. Reading the
      // session alone therefore cannot tell "this link worked" from "this
      // link failed and someone was already signed in here" — on a shared
      // device that would greet person B with "Email confirmed" and drop them
      // inside person A's account. So the error params are authoritative and
      // are checked BEFORE the session.
      const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
      const search = new URLSearchParams(window.location.search);
      const linkFailed =
        params.has("error") ||
        params.has("error_code") ||
        search.has("error") ||
        search.has("error_code");

      if (linkFailed) {
        if (cancelled) return;
        await rejectLink();
        return;
      }

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

      // No session and no error params: the route was opened directly, or the
      // tokens were unusable. Either way there is nothing to confirm.
      if (!session?.user) {
        await rejectLink();
        return;
      }

      const user = session.user;

      clearDemoSession();
      clearAiSidebarSessionPreference();
      setAuthRole("owner");

      // Set the analytics user id first so the once-per-user guards below key
      // on the real id rather than "anonymous" (mirrors Login.tsx).
      setAnalyticsUserId(user.id);

      // Once per user, NOT a bare trackEvent. Now that the session survives,
      // reopening the same confirmation email from the inbox — routine on a
      // phone — re-enters this route with a live session and would re-report
      // the verification, inflating the exact funnel step this exists to
      // measure.
      trackEventOncePerUser("email_verified", { user_id: user.id });

      // Confirming the link is now this user's first entry into the product,
      // so first_login belongs here rather than on a password form they no
      // longer have to fill in. Once-per-user guarded, same as Login.tsx.
      const completedOnboarding = await hasCompletedOnboarding(user.id);
      if (cancelled) return;

      if (!completedOnboarding) {
        trackEventOncePerUser("first_login", { user_id: user.id, via: "email_confirm" });
      }

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
