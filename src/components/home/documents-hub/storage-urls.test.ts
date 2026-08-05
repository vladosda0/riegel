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

  it("caps overlong names while keeping the extension", () => {
    const long = `${"й".repeat(300)}.xlsx`;
    const result = sanitizeDownloadFilename(long);
    expect(result.length).toBeLessThanOrEqual(200);
    expect(result.endsWith(".xlsx")).toBe(true);
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
  });

  afterEach(() => {
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

  it("never opens a window or navigates - the failure modes stay in this function", async () => {
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    signOk();
    fetchMock.mockResolvedValue({ ok: true, blob: () => Promise.resolve(new Blob(["x"])) });

    await downloadStorageUrl("b", "p/x.pdf", "n.pdf");

    expect(openSpy).not.toHaveBeenCalled();
    openSpy.mockRestore();
  });
});
