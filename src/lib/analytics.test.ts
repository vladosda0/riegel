import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
    setUrl("/pricing#tariffs");
    const initMetrika = await loadInitMetrika();

    initMetrika();

    expect(initCalls(ym)).toHaveLength(1);
    expect((initCalls(ym)[0][2] as { url: string }).url).toBe(`${window.location.origin}/pricing`);
  });

  it("treats a GoTrue error fragment as safe: it carries no tokens", async () => {
    setUrl("/auth/reset-password#error=access_denied&error_code=otp_expired");
    const initMetrika = await loadInitMetrika();

    initMetrika();

    expect(initCalls(ym)).toHaveLength(1);
    expect((initCalls(ym)[0][2] as { url: string }).url).not.toContain("error");
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
