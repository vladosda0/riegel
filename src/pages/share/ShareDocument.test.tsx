import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import ShareDocument from "@/pages/share/ShareDocument";

const { mockInvoke, mockToast } = vi.hoisted(() => ({ mockInvoke: vi.fn(), mockToast: vi.fn() }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: mockInvoke },
    rpc: vi.fn(),
  },
}));

vi.mock("@/hooks/use-toast", () => ({
  toast: mockToast,
  useToast: () => ({ toast: mockToast, dismiss: vi.fn(), toasts: [] }),
}));

const TOKEN = "0123456789abcdef0123456789abcdef0123456789abcdef";

function renderPage(token = TOKEN) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/share/document/${token}`]}>
        <Routes>
          <Route path="/share/document/:token" element={<ShareDocument />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function readyFile(overrides: Record<string, unknown> = {}) {
  return {
    title: "Договор №5",
    filename: "dogovor-5.pdf",
    mimeType: "application/pdf",
    sizeBytes: 1_572_864,
    signedUrl: "https://signed.example/dogovor.pdf?token=abc",
    expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
    ...overrides,
  };
}

describe("ShareDocument", () => {
  let clickSpy: ReturnType<typeof vi.spyOn>;
  let clickedDownloadNames: string[];
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockInvoke.mockReset();
    mockToast.mockReset();
    clickedDownloadNames = [];
    clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function (this: HTMLAnchorElement) {
        clickedDownloadNames.push(this.download);
      });
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("URL", Object.assign(Object.create(URL), {
      createObjectURL: vi.fn(() => "blob:mock-object-url"),
      revokeObjectURL: vi.fn(),
    }));
  });

  afterEach(() => {
    clickSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  it("asks the edge function for the token and renders the file with a download action", async () => {
    mockInvoke.mockResolvedValue({ data: readyFile(), error: null });
    fetchMock.mockResolvedValue({ ok: true, blob: () => Promise.resolve(new Blob(["x"])) });

    renderPage();

    expect(await screen.findByRole("heading", { name: "Договор №5" })).toBeInTheDocument();
    expect(mockInvoke).toHaveBeenCalledWith("get-shared-document", { body: { token: TOKEN } });
    expect(screen.getByText("dogovor-5.pdf")).toBeInTheDocument();
    expect(screen.getByTitle("Договор №5")).toHaveAttribute("src", "https://signed.example/dogovor.pdf?token=abc");

    fireEvent.click(screen.getByRole("button", { name: "Download" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("https://signed.example/dogovor.pdf?token=abc"));
    await waitFor(() => expect(clickedDownloadNames).toEqual(["dogovor-5.pdf"]));
    expect(mockToast).not.toHaveBeenCalled();
    // The page never learns where the file lives, only how to fetch it.
    expect(document.body.textContent).not.toContain("project-documents");
  });

  it("shows not found for a dead token (the function's 404)", async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: Object.assign(new Error("not found"), { context: new Response(null, { status: 404 }) }),
    });

    renderPage();

    expect(await screen.findByText("Document not found")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Download" })).not.toBeInTheDocument();
  });

  it("distinguishes a transport failure from a dead link and offers a retry", async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: Object.assign(new Error("boom"), { context: new Response(null, { status: 500 }) }),
    });

    renderPage();

    // retry: 1 in the page's query: the error state lands after one back-off.
    expect(await screen.findByText("Could not load the document", {}, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(mockInvoke).toHaveBeenCalledTimes(2);
  });

  it("re-asks for a fresh signed URL when the one it holds has expired", async () => {
    const expired = readyFile({ expiresAt: new Date(Date.now() - 1000).toISOString(), signedUrl: "https://signed.example/old" });
    const fresh = readyFile({ signedUrl: "https://signed.example/new" });
    mockInvoke.mockResolvedValueOnce({ data: expired, error: null }).mockResolvedValueOnce({ data: fresh, error: null });
    fetchMock.mockResolvedValue({ ok: true, blob: () => Promise.resolve(new Blob(["x"])) });

    renderPage();
    await screen.findByRole("heading", { name: "Договор №5" });

    fireEvent.click(screen.getByRole("button", { name: "Download" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("https://signed.example/new"));
    expect(fetchMock).not.toHaveBeenCalledWith("https://signed.example/old");
    expect(mockInvoke).toHaveBeenCalledTimes(2);
  });

  it("surfaces a failed download instead of silently doing nothing", async () => {
    mockInvoke.mockResolvedValue({ data: readyFile(), error: null });
    fetchMock.mockResolvedValue({ ok: false, status: 404, blob: () => Promise.resolve(new Blob(["{}"])) });

    renderPage();
    await screen.findByRole("heading", { name: "Договор №5" });
    fireEvent.click(screen.getByRole("button", { name: "Download" }));

    await waitFor(() => expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ variant: "destructive" })));
    expect(clickSpy).not.toHaveBeenCalled();
  });
});
