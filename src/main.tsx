import { createRoot } from "react-dom/client";
import "@/i18n";
import App from "./App.tsx";
import "./index.css";
import { initMetrika } from "@/lib/analytics";
import { initErrorTracking } from "@/lib/observability/sentry";
import { installPreloadErrorRecovery } from "@/lib/observability/preload-recovery";
import { RootErrorBoundary } from "@/components/system/RootErrorBoundary";

// Non-blocking: registers early error handlers synchronously, then loads the
// Sentry SDK chunk in parallel with the app render. No-op without a DSN.
initErrorTracking();
// Before the router mounts any lazy route: a chunk that fails to preload gets
// one reload instead of dropping the page into RootErrorBoundary.
installPreloadErrorRecovery();
initMetrika();

createRoot(document.getElementById("root")!).render(
  <RootErrorBoundary>
    <App />
  </RootErrorBoundary>,
);
