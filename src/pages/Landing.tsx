// Marketing landing page.
// Implements the Rovno design-system landing (Claude Design handoff
// `ui_kits/website`): alternating cream / blue / olive / orange full-bleed
// sections, Rostov display + Involve body. Sections live in
// `src/components/landing/*`; the design-token CSS is scoped under `.rv-landing`
// so it can't leak into the rest of the app.
//
// React wiring on top of the static design:
//  - getStartedPath is auth-aware (/home when signed in, else /auth/signup).
//  - "Посмотреть демо" enters a demo session and opens the demo project.
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { seedProjects } from "@/data/seed";
import { enterDemoSession } from "@/lib/auth-state";
import { useRuntimeAuth } from "@/hooks/use-runtime-auth";
import { trackEvent } from "@/lib/analytics";
import { KeyFeatures } from "@/components/landing/LandingKeyFeatures";
import { BlogTeaser } from "@/components/landing/LandingBlogTeaser";
import { LandingSeo } from "@/components/landing/LandingSeo";
import { LandingLanguagePrompt } from "@/components/landing/LandingLanguagePrompt";
import {
  Nav,
  Hero,
  Problem,
  Process,
  UseCases,
  Pricing,
  FAQ,
  FinalCTA,
  Interlude,
  Footer,
} from "@/components/landing/LandingSections";
import "@/components/landing/landing.css";

export default function Landing() {
  const navigate = useNavigate();
  const { status: runtimeAuthStatus } = useRuntimeAuth();

  // Signup-funnel step 1 (observability v1). Pageview hits exist too, but a
  // goal makes the Metrika composite funnel configurable.
  useEffect(() => {
    trackEvent("landing_view");
  }, []);
  const isSupabaseAuthed = runtimeAuthStatus === "authenticated";
  const startPath = isSupabaseAuthed ? "/home" : "/auth/signup";

  const demoProjectId = seedProjects[0]?.id;
  const handleDemo = () => {
    if (!demoProjectId) return;
    enterDemoSession(demoProjectId);
    navigate(`/project/${demoProjectId}/dashboard`);
  };

  // NOTE: the previous landing had a working newsletter email-subscribe form that
  // POSTed to https://formsubmit.co/ajax/vlad@rovno.ai (real, not a mock — it
  // emailed submissions and cleared on success; covered by the removed
  // Landing.subscribe.test.tsx). The new design has no signup section, so it was
  // dropped. TODO(vlad): reintroduce a newsletter capture in this design when we
  // want lead collection back.



  return (
    <div className="rv-landing">
      <LandingSeo />
      <Nav startPath={startPath} authStatus={runtimeAuthStatus} />
      <Hero startPath={startPath} onDemo={handleDemo} />
      <KeyFeatures />
      <Problem />
      <Process />
      <UseCases />
      <Pricing startPath={startPath} />
      <FAQ />
      <FinalCTA startPath={startPath} onDemo={handleDemo} />
      <BlogTeaser />
      <Interlude tone="sage" />
      <Footer onDemo={handleDemo} />
      <LandingLanguagePrompt />
    </div>
  );
}
