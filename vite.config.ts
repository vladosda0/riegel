import { defineConfig } from "vitest/config";
import reactSwc from "@vitejs/plugin-react-swc";
import path from "path";
import { execSync } from "node:child_process";
import { componentTagger } from "lovable-tagger";

/**
 * Release identifier baked into the bundle for Sentry release tagging
 * (`__APP_RELEASE__`, see src/lib/observability/sentry.ts). Prefers an
 * explicit VITE_COMMIT_SHA env var (for build environments without .git),
 * falls back to `git rev-parse`, then to "unknown" — never fails the build.
 */
function resolveAppRelease(): string {
  const fromEnv = process.env.VITE_COMMIT_SHA?.trim();
  if (fromEnv) return fromEnv;
  try {
    return (
      execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] })
        .toString()
        .trim() || "unknown"
    );
  } catch {
    return "unknown";
  }
}

// Vitest + @vitejs/plugin-react-swc can stall at high CPU while transforming
// very large TSX (AISidebar). In test mode, skip both SWC and Babel React plugins
// and rely on Vite's esbuild JSX transform (fast path for big files).
// Keep a single vite.config.ts so Vitest always loads this file.

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  esbuild: mode === "test" ? { jsx: "automatic" } : undefined,
  define: {
    __APP_RELEASE__: JSON.stringify(resolveAppRelease()),
    // Sentry tree-shaking flags: we ship errors-only (no tracing/replay),
    // these strip the unused SDK code paths from the lazy chunk.
    __SENTRY_DEBUG__: false,
    __SENTRY_TRACING__: false,
  },
  server: {
    host: "::",
    port: process.env.PORT ? Number(process.env.PORT) : 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [
    mode !== "test" && reactSwc(),
    mode === "development" && componentTagger(),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // Drop Sentry Session Replay (rrweb) and Sentry's own feedback widget
      // from the bundle — both are non-goals for observability v1 (replay:
      // 152-ФЗ; feedback: we ship our own), and @sentry/browser re-exports
      // them, pulling ~120KB gz into the lazy Sentry chunk. The stub keeps the
      // consumed names so the bindings resolve. See the stub file.
      "@sentry/replay": path.resolve(__dirname, "./src/lib/observability/sentry-replay-stub.ts"),
      "@sentry/replay-canvas": path.resolve(
        __dirname,
        "./src/lib/observability/sentry-replay-stub.ts",
      ),
      "@sentry/feedback": path.resolve(
        __dirname,
        "./src/lib/observability/sentry-replay-stub.ts",
      ),
    },
  },
  build: {
    // CI (forgejo-dind) runs the whole job inside a 1.5 GiB cgroup; the
    // gzip-size pass holds every chunk + gzip buffers at peak RSS and was the
    // exact point of repeated OOM kills (exit 137). The sizes are cosmetic.
    reportCompressedSize: false,
  },
  // NOTE: deliberately NO manualChunks for @sentry. Forcing all
  // node_modules/@sentry into one named chunk promoted it to a STATIC/eager
  // dependency of the entry (a shared binding leaked into the forced chunk),
  // which emitted a `modulepreload` for it and defeated the whole
  // lazy + DSN-gated design — the SDK downloaded on every page even with no
  // DSN. Left to Rollup's default splitting, @sentry/react is reachable ONLY
  // through the dynamic `import("@sentry/react")` in sentry.ts, so it stays a
  // lazy chunk (0 eager cost). It then shares that lazy chunk with other
  // dynamically-imported vendor code, so its size is not separately
  // measurable, which is an acceptable trade for correct laziness.
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    /** Default 5s is tight when many files run in parallel (transform + jsdom). */
    testTimeout: 10_000,
  },
}));
