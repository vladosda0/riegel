import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockCreateSignedUrl } = vi.hoisted(() => ({ mockCreateSignedUrl: vi.fn() }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    storage: { from: () => ({ createSignedUrl: mockCreateSignedUrl }) },
  },
}));

import {
  downloadStorageUrl,
  ensureFilenameExtension,
  openStorageUrlInNewTab,
  sanitizeDownloadFilename,
} from "./storage-urls";

describe("sanitizeDownloadFilename", () => {
  // rovno #284 round 3: the blob approach means the name never touches a URL
  // or a header, so URL delimiters are LEGAL and must survive. Round 2 found
  // the previous sanitizer stripping % (and #, &) from everyday Russian names.
  it("preserves URL delimiters and % - they are legal in a filesystem name", () => {
    expect(sanitizeDownloadFilename("Акт #3 & копия.pdf")).toBe("Акт #3 & копия.pdf");
    expect(sanitizeDownloadFilename("Смета 20% скидка.pdf")).toBe("Смета 20% скидка.pdf");
    expect(sanitizeDownloadFilename("расчёт+итог=5.xlsx")).toBe("расчёт+итог=5.xlsx");
  });

  it("strips filesystem-unsafe and control characters", () => {
    expect(sanitizeDownloadFilename('re"port<x>.pdf')).toBe("re port x .pdf");
    expect(sanitizeDownloadFilename("path/to\\file.pdf")).toBe("path to file.pdf");
    expect(sanitizeDownloadFilename("line\r\nbreak.pdf")).toBe("line break.pdf");
    expect(sanitizeDownloadFilename("tab	name.pdf")).toBe("tab name.pdf");
  });

  it("keeps ordinary punctuation such as hyphens untouched", () => {
    // Round 1 of this branch shipped a literal `[ -]` range by accident, which
    // ate every hyphen. Pin the correct behaviour.
    expect(sanitizeDownloadFilename("акт-сверки-2026.pdf")).toBe("акт-сверки-2026.pdf");
  });

  it("falls back when the name collapses to nothing", () => {
    expect(sanitizeDownloadFilename("///\\\\")).toBe("document");
    expect(sanitizeDownloadFilename("   ")).toBe("document");
  });

  it("prefixes the fallback when only the extension survives, so no hidden dot-file", () => {
    expect(sanitizeDownloadFilename("<<<.pdf")).toBe("document.pdf");
    expect(sanitizeDownloadFilename(".pdf")).toBe("document.pdf");
  });

  it("caps overlong names by ENCODED BYTES, not characters, keeping the extension", () => {
    // APFS/ext4 limit filenames at 255 bytes and Cyrillic is 2 bytes per
    // letter, so a char-based cap of 200 (an earlier revision) still violated
    // the invariant for exactly this app's typical names.
    const long = `${"й".repeat(300)}.xlsx`;
    const result = sanitizeDownloadFilename(long);
    expect(new TextEncoder().encode(result).length).toBeLessThanOrEqual(200);
    expect(result.endsWith(".xlsx")).toBe(true);
    // And a name comfortably under the byte budget is untouched.
    const fits = `${"й".repeat(90)}.xlsx`;
    expect(sanitizeDownloadFilename(fits)).toBe(fits);
    // The discriminating case: 155 CHARS (a char-based cap would wave it
    // through) but 305 BYTES. This is the exact shape a char-cap mutant
    // survived on until this assertion existed.
    const charOkBytesOver = `${"й".repeat(150)}.xlsx`;
    expect(charOkBytesOver.length).toBeLessThanOrEqual(200);
    expect(new TextEncoder().encode(sanitizeDownloadFilename(charOkBytesOver)).length).toBeLessThanOrEqual(200);
  });

  it("caps by bytes without splitting a surrogate pair (emoji stay whole)", () => {
    // A single-byte prefix offsets the budget so a naive slice(-1) cap would cut
    // through a surrogate pair here (verified: it leaves a lone surrogate at 200
    // bytes). The code-point loop must not.
    const name = `a${"\u{1F600}".repeat(60)}.pdf`;
    const result = sanitizeDownloadFilename(name);
    expect(new TextEncoder().encode(result).length).toBeLessThanOrEqual(200);
    // No lone surrogate survived the cut.
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(result)).toBe(false);
    expect(result.endsWith(".pdf")).toBe(true);
  });
});

describe("ensureFilenameExtension", () => {
  it("leaves a name that already has an extension alone", () => {
    expect(ensureFilenameExtension("contract.docx", "p/x.pdf")).toBe("contract.docx");
  });

  it("recovers the extension from the object path for extensionless titles", () => {
    // The documents-hub views pass the user-entered TITLE, which has none.
    expect(ensureFilenameExtension("Договор №5", "project-1/abc123.pdf")).toBe("Договор №5.pdf");
  });

  it("returns the name unchanged when neither side has an extension", () => {
    expect(ensureFilenameExtension("Договор №5", "project-1/abc123")).toBe("Договор №5");
  });

  it("recovers only the last segment of a multi-part extension", () => {
    expect(ensureFilenameExtension("бэкап", "p/x.tar.gz")).toBe("бэкап.gz");
  });
});

describe("downloadStorageUrl", () => {
  let clickSpy: ReturnType<typeof vi.spyOn>;
  let clickedDownloadNames: string[];
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockCreateSignedUrl.mockReset();
    clickedDownloadNames = [];
    clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function (this: HTMLAnchorElement) {
        clickedDownloadNames.push(this.download);
      });
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    // jsdom has no createObjectURL; the code under test requires both halves.
    vi.stubGlobal("URL", Object.assign(Object.create(URL), {
      createObjectURL: vi.fn(() => "blob:mock-object-url"),
      revokeObjectURL: vi.fn(),
    }));
    // The revoke is scheduled 10s out, so under real timers it outlives the
    // test that scheduled it and fires into a torn-down environment (#63).
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    clickSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  function signOk() {
    mockCreateSignedUrl.mockResolvedValue({ data: { signedUrl: "https://signed.example/x" }, error: null });
  }

  it("fetches the signed object and saves it under the sanitized, extension-bearing name", async () => {
    signOk();
    fetchMock.mockResolvedValue({ ok: true, blob: () => Promise.resolve(new Blob(["x"])) });

    const ok = await downloadStorageUrl("project-documents", "p/abc.pdf", "Договор №5");

    expect(ok).toBe(true);
    expect(mockCreateSignedUrl).toHaveBeenCalledWith("p/abc.pdf", 3600);
    expect(fetchMock).toHaveBeenCalledWith("https://signed.example/x");
    expect(clickedDownloadNames).toEqual(["Договор №5.pdf"]);
  });

  it("returns false when signing fails, without fetching or clicking", async () => {
    mockCreateSignedUrl.mockResolvedValue({ data: null, error: { message: "denied" } });
    expect(await downloadStorageUrl("b", "p/x.pdf", "n")).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(clickSpy).not.toHaveBeenCalled();
  });

  it("returns false on a non-OK HTTP response - a deleted object cannot silently no-op", async () => {
    signOk();
    // A real 404 carries a JSON error body, so blob() resolves - without the
    // response.ok check the user would save that error body as the document.
    // (A mutant removing the check survived while this mock lacked blob().)
    fetchMock.mockResolvedValue({ ok: false, status: 404, blob: () => Promise.resolve(new Blob(["{}"])) });
    expect(await downloadStorageUrl("b", "p/x.pdf", "n")).toBe(false);
    expect(clickSpy).not.toHaveBeenCalled();
  });

  it("returns false when the fetch itself rejects", async () => {
    signOk();
    fetchMock.mockRejectedValue(new TypeError("network down"));
    expect(await downloadStorageUrl("b", "p/x.pdf", "n")).toBe(false);
    expect(clickSpy).not.toHaveBeenCalled();
  });

  it("revokes the object URL only after Safari has had time to start the save", async () => {
    // A mutant making the revoke immediate survived until this pin existed;
    // an eagerly revoked URL breaks Safari saves and nothing else notices.
    signOk();
    fetchMock.mockResolvedValue({ ok: true, blob: () => Promise.resolve(new Blob(["x"])) });
    await downloadStorageUrl("b", "p/x.pdf", "n.pdf");
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(10_000);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:mock-object-url");
  });

  it("leaves no revoke timer that throws once the test's URL stub is torn down", async () => {
    // Fake timers keep the leak out of this suite; the setup.ts polyfill is what
    // keeps it harmless anywhere else, and this pins that second half (#63).
    signOk();
    fetchMock.mockResolvedValue({ ok: true, blob: () => Promise.resolve(new Blob(["x"])) });
    await downloadStorageUrl("b", "p/x.pdf", "n.pdf");

    vi.unstubAllGlobals();
    expect(() => vi.advanceTimersByTime(10_000)).not.toThrow();
  });

  it("never opens a window or navigates - the failure modes stay in this function", async () => {
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    signOk();
    fetchMock.mockResolvedValue({ ok: true, blob: () => Promise.resolve(new Blob(["x"])) });

    await downloadStorageUrl("b", "p/x.pdf", "n.pdf");

    expect(openSpy).not.toHaveBeenCalled();
    openSpy.mockRestore();
  });
});

describe("openStorageUrlInNewTab", () => {
  beforeEach(() => { mockCreateSignedUrl.mockReset(); });

  it("opens the tab synchronously WITHOUT noopener, so the handle stays usable", async () => {
    // The bug this pins: `window.open(url, "_blank", "noopener,...")` returns
    // NULL, so a handle-keeping implementation that passes noopener can never
    // point its tab and falls back to a SECOND window.open after the await -
    // the exact transient-activation exposure this function exists to avoid. A
    // realistic mock therefore returns null whenever noopener is requested.
    let openedBeforeSigning = false;
    const fakeTab = { location: { href: "" }, close: vi.fn(), opener: {} as unknown };
    const openSpy = vi.spyOn(window, "open").mockImplementation((_url, _target, features) =>
      (typeof features === "string" && features.includes("noopener")) ? null : (fakeTab as unknown as Window),
    );
    mockCreateSignedUrl.mockImplementation(() => {
      openedBeforeSigning = openSpy.mock.calls.length > 0;
      return Promise.resolve({ data: { signedUrl: "https://signed.example/v" }, error: null });
    });

    expect(await openStorageUrlInNewTab("b", "p/x.pdf")).toBe(true);
    expect(openedBeforeSigning).toBe(true);
    // Exactly one window opened (a noopener-passing impl would open two), and it
    // is the handle we kept, pointed at the URL, with opener blanked for safety.
    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(fakeTab.location.href).toBe("https://signed.example/v");
    expect(fakeTab.opener).toBeNull();
    expect(fakeTab.close).not.toHaveBeenCalled();
    openSpy.mockRestore();
  });

  it("closes the placeholder tab and returns false when signing fails", async () => {
    const fakeTab = { location: { href: "" }, close: vi.fn(), opener: {} as unknown };
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => fakeTab as unknown as Window);
    mockCreateSignedUrl.mockResolvedValue({ data: null, error: { message: "denied" } });

    expect(await openStorageUrlInNewTab("b", "p/x.pdf")).toBe(false);
    expect(fakeTab.close).toHaveBeenCalled();
    expect(fakeTab.location.href).toBe("");
    openSpy.mockRestore();
  });
});
