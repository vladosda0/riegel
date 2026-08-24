import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { AlertTriangle, CheckCircle2, Loader2, LogIn, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useRuntimeAuth } from "@/hooks/use-runtime-auth";
import { acceptProjectInvite, type AcceptProjectInviteFailure } from "@/lib/accept-project-invite";

type AcceptState =
  | { status: "idle" }
  | { status: "accepting" }
  | { status: "accepted"; projectId: string }
  | { status: "failed"; error: AcceptProjectInviteFailure["error"] };

export default function InviteAccept() {
  const { t } = useTranslation();
  const { inviteToken = "" } = useParams<{ inviteToken: string }>();
  const runtimeAuth = useRuntimeAuth();
  const navigate = useNavigate();
  const [acceptState, setAcceptState] = useState<AcceptState>({ status: "idle" });
  const [attempt, setAttempt] = useState(0);

  const nextUrl = useMemo(
    () => `/invite/accept/${encodeURIComponent(inviteToken)}`,
    [inviteToken],
  );

  useEffect(() => {
    if (!inviteToken || runtimeAuth.status !== "authenticated") {
      return;
    }

    let cancelled = false;
    setAcceptState({ status: "accepting" });

    void acceptProjectInvite(inviteToken).then((result) => {
      if (cancelled) return;

      if (!result.ok) {
        setAcceptState({ status: "failed", error: result.error });
        return;
      }

      setAcceptState({
        status: "accepted",
        projectId: result.invite.project_id,
      });
    });

    return () => {
      cancelled = true;
    };
  }, [attempt, inviteToken, runtimeAuth.status]);

  useEffect(() => {
    if (acceptState.status !== "accepted") {
      return;
    }

    const timer = window.setTimeout(() => {
      navigate(`/project/${acceptState.projectId}/dashboard`, { replace: true });
    }, 900);

    return () => window.clearTimeout(timer);
  }, [acceptState, navigate]);

  if (!inviteToken) {
    return (
      <div className="mx-auto max-w-xl p-4 sm:p-6">
        <Card>
          <CardHeader>
            <CardTitle>{t("invite.invalidTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {t("invite.invalidBody")}
          </CardContent>
        </Card>
      </div>
    );
  }

  if (runtimeAuth.status === "loading") {
    return (
      <div className="mx-auto max-w-xl p-4 sm:p-6">
        <Card>
          <CardContent className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t("invite.checkingSession")}
          </CardContent>
        </Card>
      </div>
    );
  }

  if (runtimeAuth.status !== "authenticated") {
    return (
      <div className="mx-auto max-w-xl p-4 sm:p-6">
        <Card>
          <CardHeader>
            <CardTitle>{t("invite.signInToAccept")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {t("invite.signInToAcceptBody")}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button asChild>
                <Link to={`/auth/login?next=${encodeURIComponent(nextUrl)}`}>
                  <LogIn className="mr-2 h-4 w-4" />
                  {t("invite.signInButton")}
                </Link>
              </Button>
              <Button asChild variant="outline">
                <Link to={`/auth/signup?next=${encodeURIComponent(nextUrl)}`}>
                  <UserPlus className="mr-2 h-4 w-4" />
                  {t("invite.createAccountButton")}
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl p-4 sm:p-6">
      <Card>
        <CardHeader>
          <CardTitle>{t("invite.title")}</CardTitle>
        </CardHeader>
        <CardContent>
          {acceptState.status === "idle" || acceptState.status === "accepting" ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("invite.accepting")}
            </div>
          ) : null}

          {acceptState.status === "accepted" ? (
            <div className="flex items-start gap-2 text-sm text-foreground">
              <CheckCircle2 className="mt-0.5 h-4 w-4 text-green-600" />
              <div>
                {t("invite.acceptedRedirecting")}
              </div>
            </div>
          ) : null}

          {acceptState.status === "failed" ? (
            <div className="space-y-3">
              <div className="flex items-start gap-2 text-sm text-destructive">
                <AlertTriangle className="mt-0.5 h-4 w-4" />
                <div>{t(`invite.error.${acceptState.error.code}`, { defaultValue: acceptState.error.message })}</div>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" asChild>
                  <Link to="/home">{t("invite.goHome")}</Link>
                </Button>
                <Button variant="ghost" onClick={() => setAttempt((value) => value + 1)}>
                  {t("invite.tryAgain")}
                </Button>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
