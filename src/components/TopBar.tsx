import { Link, useLocation, useMatch, useNavigate } from "react-router-dom";
import { ChevronDown, Globe, LogOut, Menu, Newspaper, PanelLeft, Settings, User, UserCog } from "lucide-react";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ProjectTabs } from "@/components/ProjectTabs";
import { HomeTabs } from "@/components/HomeTabs";
import { MobileNavSheet } from "@/components/MobileNavSheet";
import { clearWorkspaceUserCache } from "@/data/workspace-profile-cache";
import { AuthSimulator } from "@/components/settings/AuthSimulator";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { useCurrentUser, useProjects, useWorkspaceMode } from "@/hooks/use-mock-data";
import { supabase } from "@/integrations/supabase/client";
import { useRuntimeAuth } from "@/hooks/use-runtime-auth";
import { selectAiUsage, useTierQuota } from "@/hooks/useTierQuota";
import { clearDemoSession, clearStoredAuthProfile, setAuthRole } from "@/lib/auth-state";
import { clearAiSidebarSessionPreference } from "@/lib/ai-sidebar-session";
import { useExitDemo } from "@/hooks/use-exit-demo";
import { DemoModeBanner } from "@/components/system/DemoModeBanner";

/** Logo lives on brand blue; ghost default uses hover:bg-accent and hides it — use muted from the same palette. */
const LOGO_MENU_TRIGGER_CLASS =
  "h-8 gap-2 px-2 shrink-0 hover:bg-muted hover:text-foreground data-[state=open]:bg-muted data-[state=open]:text-foreground";

interface TopBarProps {
  aiSidebarCollapsed: boolean;
  onToggleAiSidebar: () => void;
  onSetAiSidebarOpen?: (open: boolean) => void;
  hideAi?: boolean;
}

const PROJECT_TAB_TITLE_KEYS = new Set([
  "dashboard",
  "estimate",
  "tasks",
  "procurement",
  "hr",
  "gallery",
  "documents",
  "participants",
]);

function derivePageTitle(t: (key: string) => string, pathname: string): string {
  if (pathname === "/home" || pathname.startsWith("/home/")) return t("nav.home");
  if (pathname.startsWith("/settings")) return t("nav.settings");
  const m = pathname.match(/^\/project\/[^/]+\/([^/?#]+)/);
  if (m && PROJECT_TAB_TITLE_KEYS.has(m[1])) return t(`projectTabs.${m[1]}`);
  return "";
}

export function TopBar({ aiSidebarCollapsed, onToggleAiSidebar, onSetAiSidebarOpen, hideAi = false }: TopBarProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const projectMatch = useMatch("/project/:id/*");
  const projectId = projectMatch?.params.id;
  const isInProject = Boolean(projectId);
  const isHomePage = location.pathname === "/home";
  const runtimeAuth = useRuntimeAuth();
  const queryClient = useQueryClient();

  const user = useCurrentUser();
  const projects = useProjects();
  const workspaceMode = useWorkspaceMode();
  // The role simulator is a dev-playground tool (local mode). The demo is a
  // sandboxed mockup that must not look like an account, so it gets none of it.
  const showRoleSwitcher = workspaceMode.kind === "local";
  const currentProject = projects.find((project) => project.id === projectId);
  const projectName = currentProject?.title ?? t("nav.projectFallback");
  const { data: quota } = useTierQuota();
  const isDemo = workspaceMode.kind === "demo";
  const [roleDialogOpen, setRoleDialogOpen] = useState(false);
  const displayName = user.name || user.email || (runtimeAuth.status === "authenticated" ? t("nav.displayName.workspace") : t("nav.displayName.guest"));
  const initials = displayName.split(" ").map((word) => word[0]).join("").slice(0, 2).toUpperCase();

  const handleCreditsCardClick = () => {
    navigate("/settings?tab=billing");
  };

  // The AI-chat quota card. A real (supabase) user shows their live chat slot;
  // guests get a sign-in nudge. (Demo mode renders its own chrome without this
  // card at all — the demo is a mockup, not an account with a balance.)
  // While authenticated but the quota hasn't loaded, render nothing.
  const renderCreditsCard = () => {
    const chat = quota ? selectAiUsage(quota, "chat") : null;

    // Mirror UsageMeter: a negative limit means an unlimited slot; limit === 0
    // (unknown/zero plan) renders no card. Otherwise show the finite remaining.
    if (runtimeAuth.status === "authenticated" && chat && chat.limit !== 0) {
      const unlimited = chat.limit < 0;
      const remaining = unlimited ? 0 : Math.max(chat.limit - chat.used, 0);
      const remainingPct = unlimited ? 100 : Math.round((remaining / chat.limit) * 100);
      const low = !unlimited && remainingPct < 20;
      return (
        <>
          <div className="px-2 py-1.5">
            <div
              className="rounded-md border border-border bg-muted/30 p-2.5 cursor-pointer hover:bg-muted/40 transition-colors"
              role="button"
              tabIndex={0}
              onClick={handleCreditsCardClick}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  handleCreditsCardClick();
                }
              }}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-caption font-semibold text-foreground">{t("nav.credits")}</span>
                <span className="inline-flex items-center gap-1 text-body-sm font-semibold text-foreground">
                  {unlimited ? "∞" : remaining}
                  <ChevronDown className="h-3.5 w-3.5 -rotate-90 text-muted-foreground" />
                </span>
              </div>

              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className={cn("h-full transition-all", low ? "bg-warning" : "bg-accent")}
                  style={{ width: `${remainingPct}%` }}
                />
              </div>

              <p className="mt-1.5 text-[11px] text-muted-foreground">
                {unlimited
                  ? t("quota.meter.unlimited")
                  : t("quota.meter.remaining", { remaining, limit: chat.limit })}
              </p>
            </div>
          </div>
          <DropdownMenuSeparator />
        </>
      );
    }

    // Authenticated (quota still loading/absent or zero allowance) or auth still
    // resolving (pending-supabase): hide the card rather than nudging a
    // logged-in user to sign in. Only a genuine guest sees the nudge below.
    if (runtimeAuth.status !== "guest") {
      return null;
    }

    // Guest / local / logged-out: nudge to sign in instead of showing a balance.
    return (
      <>
        <div className="px-2 py-1.5">
          <div
            className="rounded-md border border-border bg-muted/30 p-2.5 cursor-pointer hover:bg-muted/40 transition-colors"
            role="button"
            tabIndex={0}
            onClick={() => navigate("/auth/login")}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                navigate("/auth/login");
              }
            }}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-caption font-semibold text-foreground">{t("nav.credits")}</span>
              <ChevronDown className="h-3.5 w-3.5 -rotate-90 text-muted-foreground" />
            </div>
            <p className="mt-1.5 text-[11px] text-muted-foreground">{t("nav.credits.signInToSee")}</p>
          </div>
        </div>
        <DropdownMenuSeparator />
      </>
    );
  };

  // Links out of the app to the public marketing surface: the blog and the
  // landing. Gives every in-app screen a reachable path back to the site
  // (previously the landing was only reachable by hand-typing "/").
  const renderSiteLinks = () => (
    <>
      <DropdownMenuItem asChild>
        <Link to="/blog/"><Newspaper className="mr-2 h-4 w-4" />{t("nav.blog")}</Link>
      </DropdownMenuItem>
      <DropdownMenuItem asChild>
        <Link to="/"><Globe className="mr-2 h-4 w-4" />{t("nav.toSite")}</Link>
      </DropdownMenuItem>
    </>
  );

  const renderRoleSwitcher = () => (
    <DropdownMenuItem
      onSelect={(event) => {
        event.preventDefault();
        setRoleDialogOpen(true);
      }}
    >
      <UserCog className="mr-2 h-4 w-4" />
      {t("demo.changeRole")}
    </DropdownMenuItem>
  );

  const renderRoleDialog = () => (
    <Dialog open={roleDialogOpen} onOpenChange={setRoleDialogOpen}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("demo.changeRole")}</DialogTitle>
        </DialogHeader>
        <AuthSimulator />
      </DialogContent>
    </Dialog>
  );

  const handleLogout = async () => {
    try {
      const { error } = await supabase.auth.signOut();
      if (error) {
        throw error;
      }

      clearDemoSession();
      clearAiSidebarSessionPreference();
      clearStoredAuthProfile();
      // Drop all cached queries so the next account signing in on this same tab
      // cannot read the previous user's private data (e.g. personal catalogs)
      // from React Query's cache before it refetches. Keys are not user-scoped.
      queryClient.clear();
      clearWorkspaceUserCache();
      setAuthRole("guest");
      toast({ title: t("nav.loggedOutToast") });
      navigate("/");
    } catch (error) {
      toast({
        title: t("nav.logoutFailed"),
        description: error instanceof Error ? error.message : t("nav.logoutGeneric"),
        variant: "destructive",
      });
    }
  };

  const exitDemo = useExitDemo();

  // Demo chrome: the demo is a sandboxed mockup, not an account. The logo menu
  // shrinks to plain navigation (home / site / blog); the demo label, exit and
  // signup CTA live in the DemoModeBanner strip above the bar, so the bar's
  // own layout (project tabs!) stays untouched.
  const renderDemoMenuContent = () => (
    <DropdownMenuContent align="start" className="w-56 glass-elevated rounded-card">
      <DropdownMenuItem asChild>
        <Link to="/home"><User className="mr-2 h-4 w-4" />{t("nav.home")}</Link>
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      {renderSiteLinks()}
    </DropdownMenuContent>
  );

  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const aiPanelActive = isInProject && !hideAi && !aiSidebarCollapsed;
  const pageTitle = aiPanelActive
    ? t("projectTabs.ai")
    : derivePageTitle(t, location.pathname);

  const mobileBar = (
    <div className="md:hidden flex flex-1 items-center">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={() => setMobileNavOpen(true)}
        className="h-9 w-9 shrink-0 rounded-full"
        aria-label={t("nav.menu")}
      >
        <Menu className="h-5 w-5" />
      </Button>
      <span className="flex-1 truncate text-center text-body-sm font-medium text-foreground">
        {pageTitle}
      </span>
      <div className="h-9 w-9 shrink-0" aria-hidden />
    </div>
  );

  const renderMobileSheet = () => (
    <MobileNavSheet
      open={mobileNavOpen}
      onOpenChange={setMobileNavOpen}
      projectId={projectId}
      hideAi={hideAi}
      aiSidebarOpen={!aiSidebarCollapsed}
      onSetAiSidebarOpen={onSetAiSidebarOpen}
      onOpenRoleDialog={() => setRoleDialogOpen(true)}
      onLogout={handleLogout}
      onExitDemo={exitDemo}
    />
  );

  if (isInProject && projectId) {
    return (
      <>
      {isDemo && <DemoModeBanner />}
      {/* top offsets by --demo-banner-h (0px outside the demo) so the bar sits
          below the demo strip without reserving space for real users. */}
      <header
        className="fixed left-0 right-0 z-40 flex h-12 items-center px-3 glass"
        style={{ top: "var(--demo-banner-h, 0px)" }}
      >
        <div className="hidden md:flex min-w-0 flex-1 items-center gap-1.5">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className={LOGO_MENU_TRIGGER_CLASS}>
                <img
                  src="/logo.svg"
                  alt={t("nav.appName")}
                  className="h-6 w-auto"
                />
                <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            {isDemo ? renderDemoMenuContent() : (
              <DropdownMenuContent align="start" className="w-72 glass-elevated rounded-card">
                <DropdownMenuItem asChild>
                  <Link to="/home" className="flex items-center gap-2">
                    <Avatar className="h-7 w-7">
                      <AvatarFallback className="text-caption bg-accent text-accent-foreground">
                        {initials}
                      </AvatarFallback>
                    </Avatar>
                    <span className="truncate text-body-sm font-medium text-foreground">{displayName}</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />

                {renderCreditsCard()}

                <DropdownMenuItem asChild>
                  <Link to="/settings">
                    <Settings className="mr-2 h-4 w-4" />
                    {t("nav.settings")}
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {renderSiteLinks()}
                <DropdownMenuSeparator />
                {showRoleSwitcher && renderRoleSwitcher()}
                <DropdownMenuItem onClick={handleLogout}>
                  <LogOut className="mr-2 h-4 w-4" />
                  {t("nav.logout")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            )}
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                className={cn(
                  "h-8 max-w-[240px] justify-start gap-1.5 px-2 min-w-0",
                  projects.length <= 1 && "opacity-60 pointer-events-none",
                )}
                disabled={projects.length <= 1}
              >
                <span className="truncate text-body-sm font-medium text-foreground">{projectName}</span>
                <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-64 glass-elevated rounded-card">
              {projects.map((project) => (
                <DropdownMenuItem asChild key={project.id}>
                  <Link
                    to={`/project/${project.id}/dashboard`}
                    className={cn(project.id === projectId && "bg-accent/10 text-accent")}
                  >
                    {project.title}
                  </Link>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {!aiSidebarCollapsed && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0"
              onClick={onToggleAiSidebar}
            >
              <PanelLeft className="h-4 w-4" />
              <span className="sr-only">{t("nav.toggleAiSidebar")}</span>
            </Button>
          )}

          <div className="mx-1 h-5 w-px shrink-0 bg-border" />

          <div className="min-w-0 flex-1">
            <ProjectTabs
              projectId={projectId}
              className="border-0 px-0 py-0"
            />
          </div>
        </div>
        {mobileBar}
      </header>
      {showRoleSwitcher && renderRoleDialog()}
      {renderMobileSheet()}
      </>
    );
  }

  return (
    <>
    {isDemo && <DemoModeBanner />}
    <header
      className="fixed left-0 right-0 z-40 flex h-12 items-center gap-2 px-3 glass"
      style={{ top: "var(--demo-banner-h, 0px)" }}
    >
      {/* min-w-0: with the demo controls pinned at the right edge the wrapper
          must be allowed to shrink below its content, or it overflows the
          fixed header and clips the CTA (the project header already has it). */}
      <div className="hidden md:flex min-w-0 flex-1 items-center gap-2">
      {isHomePage ? (
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className={LOGO_MENU_TRIGGER_CLASS}>
                <img
                  src="/logo.svg"
                  alt={t("nav.appName")}
                  className="h-6 w-auto"
                />
                <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            {isDemo ? renderDemoMenuContent() : (
              <DropdownMenuContent align="start" className="w-72 glass-elevated rounded-card">
                <DropdownMenuItem asChild>
                  <Link to="/home" className="flex items-center gap-2">
                    <Avatar className="h-7 w-7">
                      <AvatarFallback className="text-caption bg-accent text-accent-foreground">
                        {initials}
                      </AvatarFallback>
                    </Avatar>
                    <span className="truncate text-body-sm font-medium text-foreground">{displayName}</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />

                {renderCreditsCard()}

                <DropdownMenuItem asChild>
                  <Link to="/settings">
                    <Settings className="mr-2 h-4 w-4" />
                    {t("nav.settings")}
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {renderSiteLinks()}
                <DropdownMenuSeparator />
                {showRoleSwitcher && renderRoleSwitcher()}
                <DropdownMenuItem onClick={handleLogout}>
                  <LogOut className="mr-2 h-4 w-4" />
                  {t("nav.logout")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            )}
          </DropdownMenu>

          {!aiSidebarCollapsed && (
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onToggleAiSidebar}>
              <PanelLeft className="h-4 w-4" />
              <span className="sr-only">{t("nav.toggleSidebar")}</span>
            </Button>
          )}

          <div className="mx-1 h-5 w-px shrink-0 bg-border" />

          {/* HomeTabs grow to fill all remaining width so the 8 nav items stretch
              across the bar instead of clustering on the left. */}
          <HomeTabs className="min-w-0 flex-1 border-0 px-0 py-0" />
        </div>
      ) : (
        <>
          {!aiSidebarCollapsed && (
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onToggleAiSidebar}>
              <PanelLeft className="h-4 w-4" />
              <span className="sr-only">{t("nav.toggleSidebar")}</span>
            </Button>
          )}

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className={LOGO_MENU_TRIGGER_CLASS}>
                <img
                  src="/logo.svg"
                  alt={t("nav.appName")}
                  className="h-6 w-auto"
                />
                <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            {isDemo ? renderDemoMenuContent() : (
              <DropdownMenuContent align="start" className="w-48 glass-elevated rounded-card">
                <DropdownMenuItem asChild>
                  <Link to="/home"><User className="mr-2 h-4 w-4" />{t("nav.home")}</Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/settings"><Settings className="mr-2 h-4 w-4" />{t("nav.settings")}</Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {renderSiteLinks()}
                {showRoleSwitcher && renderRoleSwitcher()}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleLogout}>
                  <LogOut className="mr-2 h-4 w-4" />{t("nav.logout")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            )}
          </DropdownMenu>
        </>
      )}

      {/* Spacer pushes the right side empty only for non-home top bars; the home
          branch lets HomeTabs absorb the remaining width itself. */}
      {!isHomePage && <div className="flex-1" />}
      </div>
      {mobileBar}
    </header>
    {showRoleSwitcher && renderRoleDialog()}
    {renderMobileSheet()}
    </>
  );
}
