import { defineConfig } from "vitest/config";
import reactSwc from "@vitejs/plugin-react-swc";
import path from "path";
import { execSync } from "node:child_process";
import { componentTagger } from "lovable-tagger";

/**
 * Env vars carrying a commit SHA, in precedence order. VITE_COMMIT_SHA is ours
 * (set it explicitly in a build environment without .git); the rest are what
 * common build platforms inject on their own, so a host that ships no .git can
 * still produce a tagged release without anyone configuring anything.
 */
const COMMIT_SHA_ENV_VARS = [
  "VITE_COMMIT_SHA",
  "GITHUB_SHA",
  "CI_COMMIT_SHA",
  "SOURCE_COMMIT",
  "GIT_COMMIT",
] as const;

/**
 * Release identifier baked into the bundle for Sentry release tagging
 * (`__APP_RELEASE__`, see src/lib/observability/sentry.ts). Prefers an explicit
 * SHA from the environment, falls back to `git rev-parse`, then to "unknown" —
 * never fails the build.
 */
function resolveAppRelease(): string {
  for (const name of COMMIT_SHA_ENV_VARS) {
    const fromEnv = process.env[name]?.trim();
    if (fromEnv) return shortenSha(fromEnv);
  }
  try {
    // `-c safe.directory=*`: build containers normally run as a different user
    // than the one owning the checkout, and plain `git rev-parse` then aborts
    // with "detected dubious ownership in repository" — which used to be
    // swallowed silently and is the most likely reason prod events were tagged
    // release=unknown.
    const sha = execSync("git -c safe.directory='*' rev-parse --short HEAD", {
      stdio: ["ignore", "pipe", "pipe"],
    })
      .toString()
      .trim();
    if (sha) return sha;
    warnUnknownRelease("`git rev-parse` returned an empty string");
  } catch (error) {
    warnUnknownRelease(error instanceof Error ? error.message : String(error));
  }
  return "unknown";
}

/**
 * Normalizes a full 40-char SHA to the 7-char form `git rev-parse --short`
 * emits, so releases do not fragment in Sentry depending on which build
 * environment produced them (the same commit must be one release, not two).
 * Anything that is not a full SHA — a tag, a branch name, a short SHA — is
 * passed through untouched.
 */
function shortenSha(value: string): string {
  return /^[0-9a-f]{40}$/i.test(value) ? value.slice(0, 7) : value;
}

/**
 * Loud on purpose. A silent "unknown" cost us release grouping and any hope of
 * readable stack traces on prod without anyone noticing; the next build that
 * hits this prints the reason straight into the build log. Never throws — a
 * missing SHA must not fail the build.
 */
function warnUnknownRelease(reason: string): void {
  console.warn(
    `[build] release SHA unresolved — errors will be reported as release=unknown. ` +
      `Set VITE_COMMIT_SHA in the build environment. Reason: ${reason}`,
  );
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
