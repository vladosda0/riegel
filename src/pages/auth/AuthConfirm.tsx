import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AuthCard } from "@/components/auth/AuthCard";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { clearDemoSession, hasCompletedOnboarding, setAuthRole } from "@/lib/auth-state";
import { clearAiSidebarSessionPreference } from "@/lib/ai-sidebar-session";

type VerifyOtpType = "signup" | "recovery" | "invite" | "email_change" | "magiclink";

const VALID_OTP_TYPES = new Set<VerifyOtpType>(["signup", "recovery", "invite", "email_change", "magiclink"]);

export default function AuthConfirm() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [state, setState] = useState<"validating" | "verifying" | "error">("validating");
  const [errorKey, setErrorKey] = useState<string | null>(null);

  useEffect(() => {
    const verify = async () => {
      const tokenHash = searchParams.get("token_hash");
      const typeParam = searchParams.get("type");

      // Validate params
      if (!tokenHash || !typeParam) {
        setErrorKey("auth.confirm.invalidLink");
        setState("error");
        return;
      }

      // Validate type
      if (!VALID_OTP_TYPES.has(typeParam as VerifyOtpType)) {
        setErrorKey("auth.confirm.invalidLink");
        setState("error");
        return;
      }

      setState("verifying");

      try {
        const { data, error } = await supabase.auth.verifyOtp({
          token_hash: tokenHash,
          type: typeParam as VerifyOtpType,
        });

        if (error) {
          throw error;
        }

        // Session established by Supabase
        const userId = data.user?.id;

        clearDemoSession();
        clearAiSidebarSessionPreference();
        setAuthRole("owner");

        // Check onboarding status
        const destination = await hasCompletedOnboarding(userId) ? "/home" : "/onboarding";
        navigate(destination, { replace: true });
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        let key = "auth.confirm.error";

        // Friendly message mapping for common Supabase errors
        if (message.toLowerCase().includes("expired")) {
          key = "auth.confirm.expiredLink";
        } else if (message.toLowerCase().includes("used")) {
          key = "auth.confirm.usedLink";
        }

        setErrorKey(key);
        setState("error");
      }
    };

    verify();
  }, [searchParams, navigate]);

  if (state === "validating" || state === "verifying") {
    return (
      <AuthCard title={t("auth.confirm.title")} subtitle={t("auth.confirm.subtitle")}>
        <div className="flex flex-col items-center justify-center py-sp-3 gap-sp-2">
          <Loader2 className="h-6 w-6 animate-spin text-accent" />
          <p className="text-body-sm text-muted-foreground">{t("auth.confirm.verifying")}</p>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard title={t("auth.confirm.errorTitle")} subtitle={t("auth.confirm.subtitle")}>
      <div className="text-center py-sp-2 space-y-sp-2">
        <p className="text-body-sm text-muted-foreground">
          {t(errorKey || "auth.confirm.invalidLink")}
        </p>
        <Button
          onClick={() => navigate("/auth/login", { replace: true })}
          className="w-full bg-accent text-accent-foreground hover:bg-accent/90"
        >
          {t("auth.confirm.backToLogin")}
        </Button>
      </div>
    </AuthCard>
  );
}
