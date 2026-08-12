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
});
