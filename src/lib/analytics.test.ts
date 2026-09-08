import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ANALYTICS_ROUTES } from "./analytics";

const COUNTER_ID = "99999";
const TAG_SRC = `https://mc.yandex.ru/metrika/tag.js?id=${COUNTER_ID}`;
const AUTH_FRAGMENT = "#access_token=FAKEQAACCESS&refresh_token=FAKEQAREFRESH&token_type=bearer&type=recovery";

type YmMock = ReturnType<typeof vi.fn>;

function setUrl(pathWithQueryAndHash: string): void {
  window.history.replaceState({}, "", pathWithQueryAndHash);
}

function removeInjectedTags(): void {
  for (const script of Array.from(document.querySelectorAll(`script[src="${TAG_SRC}"]`))) {
    script.remove();
  }
}

function initCalls(ym: YmMock): unknown[][] {
  return ym.mock.calls.filter((call) => call[1] === "init");
}

async function loadAnalytics() {
  vi.resetModules();
  vi.stubEnv("VITE_METRIKA_COUNTER_ID", COUNTER_ID);
  return import("./analytics");
}

async function loadInitMetrika() {
  vi.resetModules();
  vi.stubEnv("VITE_METRIKA_COUNTER_ID", COUNTER_ID);
  const analytics = await import("./analytics");
  return analytics.initMetrika;
}

describe("initMetrika and the Supabase auth fragment", () => {
  let ym: YmMock;

  beforeEach(() => {
    ym = vi.fn();
    (window as unknown as { ym?: unknown }).ym = ym;
    removeInjectedTags();
    setUrl("/auth/reset-password?lang=ru");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    removeInjectedTags();
    delete (window as unknown as { ym?: unknown }).ym;
  });

  it("initialises immediately with a fragment-free url when there is no fragment", async () => {
    const initMetrika = await loadInitMetrika();

    initMetrika();

    expect(initCalls(ym)).toHaveLength(1);
    const options = initCalls(ym)[0][2] as { url: string };
    expect(options.url).toBe(`${window.location.origin}/auth/reset-password?lang=ru`);
    expect(options.url).not.toContain("#");
  });

  it("does not load the tag at all while access_token / refresh_token are in the address bar", async () => {
    // Fake timers here too: the watcher this starts would otherwise poll for a
    // real 10 s after the test ends.
    vi.useFakeTimers();
    setUrl(`/auth/reset-password?lang=ru${AUTH_FRAGMENT}`);
    const initMetrika = await loadInitMetrika();

    initMetrika();
    vi.advanceTimersByTime(1_000);

    expect(ym).not.toHaveBeenCalled();
    expect(document.querySelector(`script[src="${TAG_SRC}"]`)).toBeNull();
  });

  it("initialises with a fragment-free url once auth-js has cleared the fragment", async () => {
    vi.useFakeTimers();
    setUrl(`/auth/reset-password?lang=ru${AUTH_FRAGMENT}`);
    const initMetrika = await loadInitMetrika();

    initMetrika();
    expect(ym).not.toHaveBeenCalled();

    setUrl("/auth/reset-password?lang=ru");
    vi.advanceTimersByTime(200);

    expect(initCalls(ym)).toHaveLength(1);
    const options = initCalls(ym)[0][2] as { url: string };
    expect(options.url).toBe(`${window.location.origin}/auth/reset-password?lang=ru`);
  });

  it("gives up rather than initialising if the fragment is never cleared", async () => {
    vi.useFakeTimers();
    setUrl(`/auth/reset-password?lang=ru${AUTH_FRAGMENT}`);
    const initMetrika = await loadInitMetrika();

    initMetrika();
    vi.advanceTimersByTime(30_000);
    expect(ym).not.toHaveBeenCalled();

    // The watcher is gone, so a later cleanup no longer revives the tag.
    setUrl("/auth/reset-password?lang=ru");
    vi.advanceTimersByTime(30_000);
    expect(ym).not.toHaveBeenCalled();
  });

  it("treats an ordinary anchor fragment as safe", async () => {
    setUrl("/offer#tariffs");
    const initMetrika = await loadInitMetrika();

    initMetrika();

    expect(initCalls(ym)).toHaveLength(1);
    expect((initCalls(ym)[0][2] as { url: string }).url).toBe(`${window.location.origin}/offer`);
  });

  it("treats a GoTrue error fragment as safe: it carries no tokens", async () => {
    setUrl("/auth/reset-password#error=access_denied&error_code=otp_expired");
    const initMetrika = await loadInitMetrika();

    initMetrika();

    expect(initCalls(ym)).toHaveLength(1);
    expect((initCalls(ym)[0][2] as { url: string }).url).not.toContain("error");
  });

  it("does not load the tag while a share token sits in the path", async () => {
    vi.useFakeTimers();
    setUrl("/share/estimate/QA-SHARE-TOKEN");
    const initMetrika = await loadInitMetrika();

    initMetrika();
    vi.advanceTimersByTime(1_000);

    expect(initCalls(ym)).toHaveLength(0);
    expect(document.querySelector(`script[src="${TAG_SRC}"]`)).toBeNull();
  });

  it("does not load the tag when the share path differs only in case", async () => {
    vi.useFakeTimers();
    setUrl("/SHARE/ESTIMATE/QA-SHARE-TOKEN");
    const initMetrika = await loadInitMetrika();

    initMetrika();
    vi.advanceTimersByTime(1_000);

    expect(initCalls(ym)).toHaveLength(0);
    expect(document.querySelector(`script[src="${TAG_SRC}"]`)).toBeNull();
  });

  it("does not load the tag while an invite token sits in the path", async () => {
    vi.useFakeTimers();
    setUrl("/invite/accept/QA-INVITE-TOKEN");
    const initMetrika = await loadInitMetrika();

    initMetrika();
    vi.advanceTimersByTime(1_000);

    expect(initCalls(ym)).toHaveLength(0);
    expect(document.querySelector(`script[src="${TAG_SRC}"]`)).toBeNull();
  });

  it("does not load the tag while a one-time credential sits in the query string", async () => {
    vi.useFakeTimers();
    setUrl("/auth/confirm?token_hash=FAKEQATOKENHASH&type=signup");
    const initMetrika = await loadInitMetrika();

    initMetrika();
    vi.advanceTimersByTime(1_000);

    expect(ym.mock.calls.filter((call) => call[1] === "init")).toHaveLength(0);
    expect(document.querySelector(`script[src="${TAG_SRC}"]`)).toBeNull();
  });

  it("keeps allowlisted attribution params and drops everything else", async () => {
    setUrl("/auth/email-sent?utm_source=vk&utm_campaign=aug&lang=ru&email=user%40example.com&code=PROMO2026");
    const initMetrika = await loadInitMetrika();

    initMetrika();

    const url = (initCalls(ym)[0][2] as { url: string }).url;
    expect(url).toContain("utm_source=vk");
    expect(url).toContain("utm_campaign=aug");
    expect(url).toContain("lang=ru");
    expect(url).not.toContain("email=");
    expect(url).not.toContain("example.com");
    expect(url).not.toContain("code=");
    expect(url).not.toContain("PROMO2026");
  });

  it("emits no question mark when nothing survives the allowlist", async () => {
    setUrl("/promo/redeem?code=PROMO2026");
    const initMetrika = await loadInitMetrika();

    initMetrika();

    expect((initCalls(ym)[0][2] as { url: string }).url).toBe(`${window.location.origin}/promo/redeem`);
  });

  it("buffers events tracked while waiting, and replays them after init", async () => {
    vi.useFakeTimers();
    setUrl(`/auth/reset-password?lang=ru${AUTH_FRAGMENT}`);
    vi.resetModules();
    vi.stubEnv("VITE_METRIKA_COUNTER_ID", COUNTER_ID);
    delete (window as unknown as { ym?: unknown }).ym;
    const analytics = await import("./analytics");

    analytics.initMetrika();
    analytics.trackEvent("email_verified");

    setUrl("/auth/reset-password?lang=ru");
    vi.advanceTimersByTime(200);

    // The real queue is an array on window.ym; tag.js replays it in order, so
    // init has to be ahead of the goal or the goal lands on no counter.
    const queue = ((window as unknown as { ym?: { a?: unknown[][] } }).ym?.a ?? []) as unknown[][];
    const actions = queue.map((args) => args[1]);
    expect(actions).toContain("init");
    expect(actions).toContain("reachGoal");
    expect(actions.indexOf("init")).toBeLessThan(actions.indexOf("reachGoal"));
  });

  it("starts later when a navigation leaves the credential behind, after the wait gave up", async () => {
    vi.useFakeTimers();
    setUrl(`/auth/reset-password${AUTH_FRAGMENT}`);
    vi.resetModules();
    vi.stubEnv("VITE_METRIKA_COUNTER_ID", COUNTER_ID);
    const analytics = await import("./analytics");

    analytics.initMetrika();
    vi.advanceTimersByTime(30_000);
    expect(ym.mock.calls.filter((call) => call[1] === "init")).toHaveLength(0);

    setUrl("/home");
    analytics.ensureMetrikaStarted();

    const calls = ym.mock.calls.filter((call) => call[1] === "init");
    expect(calls).toHaveLength(1);
    expect((calls[0][2] as { url: string }).url).toBe(`${window.location.origin}/home`);
  });

  it("ensureMetrikaStarted does not start while the credential is still there", async () => {
    vi.useFakeTimers();
    setUrl(`/auth/confirm?token_hash=FAKEQATOKENHASH&type=signup`);
    vi.resetModules();
    vi.stubEnv("VITE_METRIKA_COUNTER_ID", COUNTER_ID);
    const analytics = await import("./analytics");

    analytics.initMetrika();
    vi.advanceTimersByTime(30_000);
    analytics.ensureMetrikaStarted();

    expect(ym.mock.calls.filter((call) => call[1] === "init")).toHaveLength(0);
    expect(document.querySelector(`script[src="${TAG_SRC}"]`)).toBeNull();
  });
});

describe("analyticsPageUrl path sanitising", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    window.history.replaceState({}, "", "/");
  });

  it("replaces a share token in the path with the route template", async () => {
    setUrl("/share/estimate/QA-SHARE-TOKEN");
    const { analyticsPageUrl } = await loadAnalytics();

    const url = analyticsPageUrl();

    expect(url).toBe(`${window.location.origin}/share/estimate/:shareId`);
    expect(url).not.toContain("QA-SHARE-TOKEN");
  });

  it("replaces a share token in the path when the path differs only in case", async () => {
    setUrl("/SHARE/ESTIMATE/QA-SHARE-TOKEN");
    const { analyticsPageUrl } = await loadAnalytics();

    const url = analyticsPageUrl();

    expect(url).toBe(`${window.location.origin}/share/estimate/:shareId`);
    expect(url).not.toContain("QA-SHARE-TOKEN");
  });

  it("replaces a document share token in the path with the route template", async () => {
    setUrl("/share/document/QA-DOCUMENT-TOKEN");
    const { analyticsPageUrl } = await loadAnalytics();

    const url = analyticsPageUrl();

    expect(url).toBe(`${window.location.origin}/share/document/:token`);
    expect(url).not.toContain("QA-DOCUMENT-TOKEN");
  });

  it("replaces an invite token in the path with the route template", async () => {
    setUrl("/invite/accept/QA-INVITE-TOKEN?lang=ru");
    const { analyticsPageUrl } = await loadAnalytics();

    const url = analyticsPageUrl();

    expect(url).toBe(`${window.location.origin}/invite/accept/:inviteToken?lang=ru`);
    expect(url).not.toContain("QA-INVITE-TOKEN");
  });

  it("passes a safe dynamic route through verbatim, so per-project reports survive", async () => {
    setUrl("/project/11111111-2222-3333-4444-555555555555/tasks");
    const { analyticsPageUrl } = await loadAnalytics();

    expect(analyticsPageUrl()).toBe(
      `${window.location.origin}/project/11111111-2222-3333-4444-555555555555/tasks`,
    );
  });

  it("prefers the static route over a dynamic one that also matches", async () => {
    setUrl("/blog/admin");
    const { analyticsPageUrl } = await loadAnalytics();

    expect(analyticsPageUrl()).toBe(`${window.location.origin}/blog/admin`);
  });

  it("reports a path matching no known route as the unknown placeholder", async () => {
    setUrl("/some/route/added/later");
    const { analyticsPageUrl } = await loadAnalytics();

    expect(analyticsPageUrl()).toBe(`${window.location.origin}/unknown`);
  });
});

describe("ANALYTICS_ROUTES stays in step with App.tsx", () => {
  // The whitelist fails closed, so drift costs reporting rather than a leak.
  // This test makes the drift visible at the moment a route is added instead.
  //
  // It checks that every route App.tsx declares is *represented*, not that the
  // prefix is right: a relative child only has to be the tail of some pattern.
  // That catches "added a route and forgot this list", which is the failure
  // this list can actually have. It does not check that a child sits under the
  // right parent.
  it("covers every path declared in App.tsx", () => {
    const app = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf-8");
    const declared = [...app.matchAll(/path="([^"]+)"/g)]
      .map((match) => match[1])
      .filter((path) => path !== "*");

    expect(declared.length).toBeGreaterThan(20);

    const patterns = ANALYTICS_ROUTES.map((route) => route.pattern);
    const missing = declared.filter((path) =>
      path.startsWith("/")
        ? !patterns.includes(path)
        : !patterns.some((pattern) => pattern.endsWith(`/${path}`)),
    );

    expect(missing).toEqual([]);
  });

  it("lists no pattern App.tsx no longer declares", () => {
    // The reverse direction of the check above. Without it a deleted route
    // lingers here forever: nothing can match a dead pattern, so the cost is
    // the comment above claiming a parity that does not hold, which the next
    // session trusts instead of re-deriving. /project/:id/activity outlived
    // its route exactly this way.
    const app = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf-8");
    const declared = [...app.matchAll(/path="([^"]+)"/g)]
      .map((match) => match[1])
      .filter((path) => path !== "*");
    const relative = declared.filter((path) => !path.startsWith("/"));

    const stale = ANALYTICS_ROUTES.map((route) => route.pattern).filter(
      (pattern) =>
        !declared.includes(pattern) &&
        // The parent prefix must itself be a declared absolute route, or a
        // stale `/org/:id/documents` would ride in on the `documents` child of
        // `/project/:id`.
        !relative.some(
          (child) =>
            pattern.endsWith(`/${child}`) &&
            declared.includes(pattern.slice(0, -(child.length + 1))),
        ),
    );

    expect(stale).toEqual([]);
  });

  it("marks the three token-bearing routes, and only those, as secret", () => {
    const secret = ANALYTICS_ROUTES.filter((route) => route.secret).map((route) => route.pattern);

    expect(secret).toEqual([
      "/share/estimate/:shareId",
      "/share/document/:token",
      "/invite/accept/:inviteToken",
    ]);
  });
});
