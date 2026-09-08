import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import ProjectDocuments from "@/pages/project/ProjectDocuments";
import type { Document, MemberRole } from "@/types/entities";

const { mockCreateSignedUrl } = vi.hoisted(() => ({ mockCreateSignedUrl: vi.fn() }));

const { mockToast } = vi.hoisted(() => ({ mockToast: vi.fn() }));

vi.mock("@/hooks/use-toast", () => ({
  toast: mockToast,
  useToast: () => ({ toast: mockToast, dismiss: vi.fn(), toasts: [] }),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    storage: { from: () => ({ createSignedUrl: mockCreateSignedUrl }) },
  },
}));

const {
  mockUseCurrentUser,
  mockUseProject,
  mockUseWorkspaceMode,
  mockUseProjectDocumentsState,
  mockUseProjectDocumentMutations,
  mockUseDocumentUploadMutations,
  mockUsePermission,
} = vi.hoisted(() => ({
  mockUseCurrentUser: vi.fn(),
  mockUseProject: vi.fn(),
  mockUseWorkspaceMode: vi.fn(),
  mockUseProjectDocumentsState: vi.fn(),
  mockUseProjectDocumentMutations: vi.fn(),
  mockUseDocumentUploadMutations: vi.fn(),
  mockUsePermission: vi.fn(),
}));

vi.mock("@/hooks/use-mock-data", () => ({
  useCurrentUser: () => mockUseCurrentUser(),
  useProject: () => mockUseProject(),
  useWorkspaceMode: () => mockUseWorkspaceMode(),
}));

vi.mock("@/hooks/use-documents-media-source", () => ({
  useProjectDocumentsState: (projectId: string) => mockUseProjectDocumentsState(projectId),
  useProjectDocumentMutations: (projectId: string) => mockUseProjectDocumentMutations(projectId),
  useDocumentUploadMutations: (projectId: string) => mockUseDocumentUploadMutations(projectId),
  documentsMediaQueryKeys: {
    projectDocuments: (profileId: string, projectId: string) =>
      ["documents-media", "project-documents", profileId, projectId] as const,
    projectMedia: (profileId: string, projectId: string) =>
      ["documents-media", "project-media", profileId, projectId] as const,
  },
}));

vi.mock("@/hooks/use-orgs", () => ({
  useActiveOrg: () => null,
  useUserOrganizations: () => ({ data: [], isPending: false }),
  useOrgDocuments: () => ({ data: [], isPending: false }),
  useOrgMemberProfileIds: () => ({ data: [], isPending: false }),
  useImportDocumentsToProject: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSetActiveOrg: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCreateOrganization: () => ({ mutateAsync: vi.fn(), isPending: false }),
  orgQueryKeys: {
    list: (id: string) => ["orgs", "list", id] as const,
    documents: (id: string | null) => ["orgs", "documents", id] as const,
    members: (id: string | null) => ["orgs", "members", id] as const,
  },
}));

vi.mock("@/hooks/use-workspace-documents-source", () => ({
  useWorkspaceDocuments: () => ({ data: [], isPending: false }),
}));

const { mockUseDocumentShares, mockShareCreate, mockShareRevoke } = vi.hoisted(() => ({
  mockUseDocumentShares: vi.fn(),
  mockShareCreate: vi.fn(),
  mockShareRevoke: vi.fn(),
}));

vi.mock("@/hooks/use-document-shares", () => ({
  useDocumentShares: (projectId: string, options?: { enabled?: boolean }) => mockUseDocumentShares(projectId, options),
  useDocumentShareMutations: () => ({
    create: { mutateAsync: mockShareCreate, isPending: false },
    revoke: { mutateAsync: mockShareRevoke, isPending: false },
  }),
}));

vi.mock("@tanstack/react-query", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-query")>("@tanstack/react-query");
  return {
    ...actual,
    useQueryClient: () => ({
      invalidateQueries: vi.fn().mockResolvedValue(undefined),
      cancelQueries: vi.fn().mockResolvedValue(undefined),
      setQueryData: vi.fn(),
      getQueryData: vi.fn(),
    }),
  };
});

vi.mock("@/lib/permissions", async () => {
  const actual = await vi.importActual<typeof import("@/lib/permissions")>("@/lib/permissions");
  return {
    ...actual,
    usePermission: (projectId: string) => mockUsePermission(projectId),
  };
});

function createDocument(partial: Partial<Document> = {}): Document {
  return {
    id: "doc-1",
    project_id: "project-1",
    type: "specification",
    title: "Document One",
    visibility_class: "shared_project",
    created_at: "2026-03-16T10:00:00.000Z",
    versions: [{
      id: "version-1",
      document_id: "doc-1",
      number: 1,
      status: "draft",
      content: "Document body",
    }],
    ...partial,
  };
}

function renderProjectDocuments() {
  return render(
    <MemoryRouter initialEntries={["/project/project-1/documents"]}>
      <Routes>
        <Route path="/project/:id/documents" element={<ProjectDocuments />} />
      </Routes>
    </MemoryRouter>,
  );
}

function buildPermission(role: MemberRole) {
  return {
    seam: {
      projectId: "project-1",
      profileId: "user-1",
      membership: {
        project_id: "project-1",
        user_id: "user-1",
        role,
        viewer_regime: null,
        ai_access: "consult_only",
        finance_visibility: "summary",
        credit_limit: 0,
        used_credits: 0,
      },
      project: undefined,
    },
    role,
    can: () => true,
    isLoading: false,
  };
}

describe("ProjectDocuments", () => {
  beforeEach(() => {
    mockUseCurrentUser.mockReset();
    mockUseProject.mockReset();
    mockUseWorkspaceMode.mockReset();
    mockUseProjectDocumentsState.mockReset();
    mockUseProjectDocumentMutations.mockReset();
    mockUseDocumentUploadMutations.mockReset();
    mockUsePermission.mockReset();
    mockUseCurrentUser.mockReturnValue({ id: "user-1" });
    mockUseProject.mockReturnValue({ project: { title: "Apartment Renovation" } });
    mockUsePermission.mockReturnValue(buildPermission("owner"));
    mockUseProjectDocumentMutations.mockReturnValue({
      createDocument: vi.fn(),
      archiveDocument: vi.fn(),
      deleteDocument: vi.fn(),
      updateDocumentVisibility: vi.fn().mockResolvedValue(undefined),
    });
    mockUseDocumentShares.mockReset();
    mockUseDocumentShares.mockReturnValue({ sharesByDocumentId: new Map(), isLoading: false });
    mockShareCreate.mockReset();
    mockShareRevoke.mockReset();
    mockShareCreate.mockResolvedValue({
      documentId: "doc-1",
      shareToken: "0123456789abcdef0123456789abcdef0123456789abcdef",
      createdAt: "2026-09-08T00:00:00Z",
    });
    mockUseDocumentUploadMutations.mockReturnValue({
      prepareUpload: vi.fn(),
      uploadBytes: vi.fn(),
      finalizeUpload: vi.fn(),
    });
  });

  it("opens the upload dialog from the empty state", () => {
    mockUseWorkspaceMode.mockReturnValue({ kind: "local" });
    mockUseProjectDocumentsState.mockReturnValue({ documents: [], isLoading: false });

    renderProjectDocuments();

    const emptyState = screen.getByText("No documents").closest(".rounded-card");
    expect(emptyState).toBeTruthy();
    if (!(emptyState instanceof HTMLElement)) return;

    fireEvent.click(within(emptyState).getByRole("button", { name: "Upload a document" }));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Upload document")).toBeInTheDocument();
    expect(screen.queryByText("0 active · 0 archived")).not.toBeInTheDocument();
  });

  it("shows a skeleton while Supabase documents are loading without flashing the empty state", () => {
    mockUseWorkspaceMode.mockReturnValue({ kind: "supabase", profileId: "user-1" });
    mockUseProjectDocumentsState.mockReturnValue({ documents: [], isLoading: true });

    renderProjectDocuments();

    expect(screen.getByTestId("documents-skeleton")).toBeInTheDocument();
    expect(screen.queryByText("No documents")).not.toBeInTheDocument();
    expect(screen.getByText("Loading documents...")).toBeInTheDocument();
  });

  it("hides document type, status, and versioning controls in the list UI", () => {
    mockUseWorkspaceMode.mockReturnValue({ kind: "local" });
    mockUseProjectDocumentsState.mockReturnValue({
      documents: [createDocument({ title: "Local Document" })],
      isLoading: false,
    });

    renderProjectDocuments();

    expect(screen.getByText("Local Document")).toBeInTheDocument();
    expect(screen.queryByText("Draft")).not.toBeInTheDocument();
    expect(screen.queryByText("Status")).not.toBeInTheDocument();
    expect(screen.queryByText("Type")).not.toBeInTheDocument();
    expect(screen.queryByText("specification")).not.toBeInTheDocument();
    expect(screen.queryByTitle("New version")).not.toBeInTheDocument();
  });

  it("switches to grid mode while keeping preview and archive grouping intact", () => {
    mockUseWorkspaceMode.mockReturnValue({ kind: "local" });
    mockUseProjectDocumentsState.mockReturnValue({
      documents: [
        createDocument({ id: "doc-active", title: "Active Document" }),
        createDocument({
          id: "doc-archived",
          title: "Archived Document",
          versions: [{
            id: "version-archived",
            document_id: "doc-archived",
            number: 2,
            status: "archived",
            content: "Archived content",
          }],
        }),
      ],
      isLoading: false,
    });

    renderProjectDocuments();

    const listViewButton = screen.getByRole("radio", { name: "List view" });
    const gridViewButton = screen.getByRole("radio", { name: "Grid view" });

    expect(listViewButton).toHaveAttribute("data-state", "on");

    fireEvent.click(gridViewButton);

    expect(gridViewButton).toHaveAttribute("data-state", "on");
    expect(screen.getByText("Archived")).toBeInTheDocument();
    expect(screen.getByText("Archived Document")).toBeInTheDocument();
    expect(screen.getAllByTitle("Archive")).toHaveLength(1);
    expect(screen.getAllByTitle("Delete")).toHaveLength(1);

    fireEvent.click(screen.getByText("Active Document"));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Document preview")).toBeInTheDocument();
  });

  it("shows print plus disabled download and share actions for a Supabase document without a file", () => {
    mockUseWorkspaceMode.mockReturnValue({ kind: "supabase", profileId: "user-1" });
    mockUseProjectDocumentsState.mockReturnValue({
      documents: [createDocument({
        title: "Supabase Document",
        versions: [{
          id: "version-1",
          document_id: "doc-1",
          number: 1,
          status: "draft",
          content: "",
        }],
      })],
      isLoading: false,
    });

    renderProjectDocuments();

    fireEvent.click(screen.getByRole("button", { name: /Supabase Document/ }));

    expect(screen.getByRole("button", { name: "Print" })).toBeInTheDocument();
    // No storage object yet (upload not finalized): nothing to sign, nothing to
    // link. Share is live for an owner in general, but not for this document.
    expect(screen.getByRole("button", { name: "Download" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Share" })).toBeDisabled();
    expect(screen.getByText("The file is not ready for download yet.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Comment/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Confirm acknowledgement/i })).not.toBeInTheDocument();
  });

  // rovno #284 slice S2. The download button used to be window.open(signedUrl),
  // which is not a download: no Content-Disposition, no filename, and the popup
  // blocker can eat it. A PDF opened a tab instead of saving. The current
  // design fetches the object and saves it through a blob object URL - see
  // storage-urls.ts for why (and storage-urls.test.ts for the helper's own
  // unit tests; the tests here cover the PAGE's wiring of it).
  //
  // History that shapes these tests: TWO earlier versions of this block were
  // vacuous and both were caught by mutation, not by reading. The rules that
  // follow from that: every await anchors on the LAST observable effect of the
  // chain (the anchor click), never the first; and any mock that gates
  // concurrency must hold ALL pending promises, not a single reassigned one.
  describe("downloading a stored document (#284 S2)", () => {
    const storedVersion = {
      id: "version-1",
      document_id: "doc-1",
      number: 1,
      status: "draft" as const,
      content: "",
      storage: {
        bucket: "project-documents",
        objectPath: "project-1/contract.docx",
        filename: "contract.docx",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        id: "storage-1",
        sizeBytes: 20480,
      },
    };

    let clickSpy: ReturnType<typeof vi.spyOn>;
    let clickedDownloadNames: string[];
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      // Reset removes leaked mockImplementations from previous tests (a prior
      // round left a never-resolving implementation behind, making the suite
      // order-dependent).
      mockCreateSignedUrl.mockReset();
      clickedDownloadNames = [];
      clickSpy = vi
        .spyOn(HTMLAnchorElement.prototype, "click")
        .mockImplementation(function (this: HTMLAnchorElement) {
          clickedDownloadNames.push(this.download);
        });
      fetchMock = vi.fn().mockResolvedValue({ ok: true, blob: () => Promise.resolve(new Blob(["x"])) });
      vi.stubGlobal("fetch", fetchMock);
      // jsdom has no createObjectURL/revokeObjectURL.
      vi.stubGlobal("URL", Object.assign(Object.create(URL), {
        createObjectURL: vi.fn(() => "blob:mock-object-url"),
        revokeObjectURL: vi.fn(),
      }));
    });

    afterEach(() => {
      clickSpy.mockRestore();
      vi.unstubAllGlobals();
    });

    function renderWithStoredDocument() {
      mockUseWorkspaceMode.mockReturnValue({ kind: "supabase", profileId: "user-1" });
      mockUseProjectDocumentsState.mockReturnValue({
        documents: [createDocument({ title: "Stored Document", versions: [storedVersion] })],
        isLoading: false,
      });
      renderProjectDocuments();
      fireEvent.click(screen.getByRole("button", { name: /Stored Document/ }));
    }

    async function clickDownloadAndSettle() {
      await screen.findByRole("button", { name: "Download" });
      await vi.waitFor(() => {
        expect(screen.getByRole("button", { name: "Download" })).not.toBeDisabled();
      });
      fireEvent.click(screen.getByRole("button", { name: "Download" }));
      // Anchor on the LAST effect of the async chain, then flush microtasks so
      // everything queued after it has run before any assertion below.
      await vi.waitFor(() => { expect(clickSpy).toHaveBeenCalled(); });
      await act(async () => { await Promise.resolve(); });
    }

    it("saves the blob under the stored filename and never opens a tab", async () => {
      mockCreateSignedUrl.mockResolvedValue({ data: { signedUrl: "https://signed.example/contract.docx" }, error: null });
      const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);

      renderWithStoredDocument();
      await clickDownloadAndSettle();

      // The page passes the stored filename through; the helper sanitizes it.
      expect(clickedDownloadNames).toEqual(["contract.docx"]);
      // Two signings happen (preview + download), both WITHOUT a download
      // option: the filename must never ride the URL (round-2 finding: the
      // ?download= parameter was both corruptible and an injection surface).
      for (const call of mockCreateSignedUrl.mock.calls) {
        expect(call[2]).toBeUndefined();
      }
      // The object is fetched and saved locally; nothing opens a window.
      expect(fetchMock).toHaveBeenCalledWith("https://signed.example/contract.docx");
      expect(openSpy).not.toHaveBeenCalled();

      openSpy.mockRestore();
    });

    it("keeps a filename with URL delimiters intact - nothing strips # or & any more", async () => {
      mockCreateSignedUrl.mockResolvedValue({ data: { signedUrl: "https://signed.example/x" }, error: null });
      mockUseWorkspaceMode.mockReturnValue({ kind: "supabase", profileId: "user-1" });
      mockUseProjectDocumentsState.mockReturnValue({
        documents: [createDocument({
          title: "Hash Document",
          versions: [{ ...storedVersion, storage: { ...storedVersion.storage, filename: "Акт #3 & копия.pdf" } }],
        })],
        isLoading: false,
      });
      renderProjectDocuments();
      fireEvent.click(screen.getByRole("button", { name: /Hash Document/ }));
      await clickDownloadAndSettle();

      expect(clickedDownloadNames).toEqual(["Акт #3 & копия.pdf"]);
    });

    it("shows the failure toast instead of doing nothing when the object fetch fails", async () => {
      mockCreateSignedUrl.mockResolvedValue({ data: { signedUrl: "https://signed.example/x" }, error: null });
      // Preview effect must still succeed (it only signs); the object GET 404s.
      fetchMock.mockResolvedValue({ ok: false, status: 404, blob: () => Promise.resolve(new Blob(["{}"])) });

      renderWithStoredDocument();
      await screen.findByRole("button", { name: "Download" });
      await vi.waitFor(() => {
        expect(screen.getByRole("button", { name: "Download" })).not.toBeDisabled();
      });
      fireEvent.click(screen.getByRole("button", { name: "Download" }));

      await vi.waitFor(() => { expect(mockToast).toHaveBeenCalled(); });
      expect(clickSpy).not.toHaveBeenCalled();
      // The toast says «Попробуй ещё раз», so the button must actually allow a
      // retry: pin the finally-reset of the in-flight flag. A round-3 mutant
      // deleting that reset survived every test until this assertion existed.
      await vi.waitFor(() => {
        expect(screen.getByRole("button", { name: "Download" })).not.toBeDisabled();
      });
    });

    it("does not start a second download while the first is in flight", async () => {
      mockCreateSignedUrl.mockResolvedValue({ data: { signedUrl: "https://signed.example/x" }, error: null });
      // Hold every object fetch open and collect EVERY resolver. A previous
      // version of this test reassigned a single resolver per call, so only
      // the last promise could ever resolve and the assertion could not fail
      // regardless of the guard - proven by mutation in review round 2.
      const releasers: Array<() => void> = [];
      fetchMock.mockImplementation(() => new Promise((resolve) => {
        releasers.push(() => resolve({ ok: true, blob: () => Promise.resolve(new Blob(["x"])) }));
      }));

      renderWithStoredDocument();
      const button = await screen.findByRole("button", { name: "Download" });
      await vi.waitFor(() => { expect(button).not.toBeDisabled(); });

      fireEvent.click(button);
      fireEvent.click(button);
      fireEvent.click(button);
      // The object fetch sits behind an awaited signing, so wait for it to
      // REGISTER before releasing - releasing an empty list is the race this
      // test itself shipped with on its first attempt. Then drain until no new
      // fetches appear, so an unguarded mutant (3 signings -> 3 fetches) gets
      // every one of its fetches released and all its clicks surface below.
      await vi.waitFor(() => { expect(fetchMock).toHaveBeenCalled(); });
      await act(async () => {
        while (releasers.length > 0) {
          releasers.splice(0).forEach((release) => release());
          await Promise.resolve();
          await Promise.resolve();
        }
      });

      // Three clicks, at most one fetch and one saved file. Without the
      // in-flight guard every click gets its own fetch and its own click:
      // releasing ALL of them would surface 3 anchor clicks here.
      await vi.waitFor(() => { expect(clickSpy).toHaveBeenCalledTimes(1); });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      // And the flag must clear once the flight lands - see the failure test.
      await vi.waitFor(() => { expect(button).not.toBeDisabled(); });
    });

    // Regression guard, and nothing more: it asserts the disabled gate still
    // keys on previewUrl, i.e. that the fix did not loosen it. It passes on the
    // pre-fix code too, by design - it is not evidence that the fix works.
    it("keeps the download enabled once the preview URL resolves", async () => {
      mockCreateSignedUrl.mockResolvedValue({ data: { signedUrl: "https://signed.example/contract.docx" }, error: null });
      renderWithStoredDocument();
      await vi.waitFor(() => {
        expect(screen.getByRole("button", { name: "Download" })).not.toBeDisabled();
      });
    });

    // rovno #284 / #243. Documents archived BEFORE the #243 fix carry a marker
    // version with no storage link. The page must resolve the newest version
    // that actually has storage - but ONLY for archived documents, mirroring
    // the mapper: an ACTIVE document whose current version lacks storage shows
    // no file, because presenting a superseded version's file under the current
    // title would be wrong.
    describe("legacy archived documents (#243 heal)", () => {
      const versionWithFile = {
        ...storedVersion,
        id: "version-file",
        number: 1,
        status: "archived" as const,
      };
      const markerWithoutStorage = {
        id: "version-marker",
        document_id: "doc-1",
        number: 2,
        status: "archived" as const,
        content: "",
      };

      it("falls back to the newest version with storage, so Download works", async () => {
        mockCreateSignedUrl.mockResolvedValue({ data: { signedUrl: "https://signed.example/archived" }, error: null });
        mockUseWorkspaceMode.mockReturnValue({ kind: "supabase", profileId: "user-1" });
        mockUseProjectDocumentsState.mockReturnValue({
          documents: [createDocument({ title: "Legacy Archived", versions: [versionWithFile, markerWithoutStorage] })],
          isLoading: false,
        });
        renderProjectDocuments();
        fireEvent.click(screen.getByRole("button", { name: /Legacy Archived/ }));

        // The preview effect signs the HEALED object path, and Download enables.
        await vi.waitFor(() => {
          expect(mockCreateSignedUrl).toHaveBeenCalledWith("project-1/contract.docx", 3600);
        });
        await vi.waitFor(() => {
          expect(screen.getByRole("button", { name: "Download" })).not.toBeDisabled();
        });
      });

      it("does NOT heal an active document - no superseded file under a current title", async () => {
        mockCreateSignedUrl.mockResolvedValue({ data: { signedUrl: "https://signed.example/x" }, error: null });
        mockUseWorkspaceMode.mockReturnValue({ kind: "supabase", profileId: "user-1" });
        const olderWithFile = { ...storedVersion, id: "version-old", number: 1, status: "archived" as const };
        const currentWithoutStorage = {
          id: "version-current",
          document_id: "doc-1",
          number: 2,
          status: "draft" as const,
          content: "",
        };
        mockUseProjectDocumentsState.mockReturnValue({
          documents: [createDocument({ title: "Active No File", versions: [olderWithFile, currentWithoutStorage] })],
          isLoading: false,
        });
        renderProjectDocuments();
        fireEvent.click(screen.getByRole("button", { name: /Active No File/ }));

        await screen.findByRole("button", { name: "Download" });
        // No signing for the superseded file, and Download stays disabled.
        expect(mockCreateSignedUrl).not.toHaveBeenCalled();
        expect(screen.getByRole("button", { name: "Download" })).toBeDisabled();
      });
    });
  });

  it("hides upload actions for viewers", () => {
    mockUseWorkspaceMode.mockReturnValue({ kind: "local" });
    mockUsePermission.mockReturnValue(buildPermission("viewer"));
    mockUseProjectDocumentsState.mockReturnValue({ documents: [], isLoading: false });

    renderProjectDocuments();

    expect(screen.queryByRole("button", { name: "Upload a document" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Upload" })).not.toBeInTheDocument();
  });

  it("shows upload but not generate for contractors", () => {
    mockUseWorkspaceMode.mockReturnValue({ kind: "local" });
    mockUsePermission.mockReturnValue(buildPermission("contractor"));
    mockUseProjectDocumentsState.mockReturnValue({
      documents: [createDocument({ title: "Contractor Document" })],
      isLoading: false,
    });

    renderProjectDocuments();

    expect(screen.getByRole("button", { name: "Upload" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Generate" })).not.toBeInTheDocument();
    expect(screen.queryByTitle("Archive")).not.toBeInTheDocument();
    expect(screen.queryByTitle("Delete")).not.toBeInTheDocument();
  });
});

describe("ProjectDocuments public links, downloads and visibility", () => {
  function storedDocument(partial: Partial<Document> = {}): Document {
    return createDocument({
      versions: [{
        id: "version-1",
        document_id: "doc-1",
        number: 1,
        status: "draft",
        content: "",
        storage: {
          id: "so-1",
          bucket: "project-documents",
          objectPath: "p/project-1/contract.pdf",
          filename: "contract.pdf",
          mimeType: "application/pdf",
          sizeBytes: 1024,
        },
      }],
      ...partial,
    });
  }

  let clickSpy: ReturnType<typeof vi.spyOn>;
  let clickedDownloadNames: string[];
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockUseCurrentUser.mockReset();
    mockUseProject.mockReset();
    mockUseWorkspaceMode.mockReset();
    mockUseProjectDocumentsState.mockReset();
    mockUseProjectDocumentMutations.mockReset();
    mockUseDocumentUploadMutations.mockReset();
    mockUsePermission.mockReset();
    mockCreateSignedUrl.mockReset();
    mockToast.mockReset();
    mockUseCurrentUser.mockReturnValue({ id: "user-1" });
    mockUseProject.mockReturnValue({ project: { title: "Apartment Renovation" } });
    mockUsePermission.mockReturnValue(buildPermission("owner"));
    mockUseWorkspaceMode.mockReturnValue({ kind: "supabase", profileId: "user-1" });
    mockUseProjectDocumentMutations.mockReturnValue({
      createDocument: vi.fn(),
      archiveDocument: vi.fn(),
      deleteDocument: vi.fn(),
      updateDocumentVisibility: vi.fn().mockResolvedValue(undefined),
    });
    mockUseDocumentUploadMutations.mockReturnValue({
      prepareUpload: vi.fn(),
      uploadBytes: vi.fn(),
      finalizeUpload: vi.fn(),
    });
    mockUseDocumentShares.mockReset();
    mockUseDocumentShares.mockReturnValue({ sharesByDocumentId: new Map(), isLoading: false });
    mockShareCreate.mockReset();
    mockShareCreate.mockResolvedValue({
      documentId: "doc-1",
      shareToken: "0123456789abcdef0123456789abcdef0123456789abcdef",
      createdAt: "2026-09-08T00:00:00Z",
    });
    mockCreateSignedUrl.mockResolvedValue({ data: { signedUrl: "https://signed.example/contract.pdf" }, error: null });

    clickedDownloadNames = [];
    clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function (this: HTMLAnchorElement) {
        clickedDownloadNames.push(this.download);
      });
    fetchMock = vi.fn().mockResolvedValue({ ok: true, blob: () => Promise.resolve(new Blob(["x"])) });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("URL", Object.assign(Object.create(URL), {
      createObjectURL: vi.fn(() => "blob:mock-object-url"),
      revokeObjectURL: vi.fn(),
    }));
    // Radix Select needs these jsdom polyfills (same pattern as OnboardingStepper.test.tsx).
    class MockPointerEvent extends MouseEvent {
      pointerType: string;
      isPrimary: boolean;
      constructor(type: string, params: MouseEventInit & { pointerType?: string; isPrimary?: boolean } = {}) {
        super(type, params);
        this.pointerType = params.pointerType ?? "mouse";
        this.isPrimary = params.isPrimary ?? true;
      }
    }
    Object.defineProperty(window, "PointerEvent", { configurable: true, writable: true, value: MockPointerEvent });
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, writable: true, value: () => {} });
    Object.defineProperty(HTMLElement.prototype, "hasPointerCapture", { configurable: true, writable: true, value: () => false });
    Object.defineProperty(HTMLElement.prototype, "setPointerCapture", { configurable: true, writable: true, value: () => {} });
    Object.defineProperty(HTMLElement.prototype, "releasePointerCapture", { configurable: true, writable: true, value: () => {} });
  });

  afterEach(() => {
    clickSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  it("gives an owner Download and Share on a shared document row, and asks for the project's shares", () => {
    mockUseProjectDocumentsState.mockReturnValue({ documents: [storedDocument()], isLoading: false });

    renderProjectDocuments();

    expect(screen.getByTitle("Download")).toBeInTheDocument();
    expect(screen.getByTitle("Share")).toBeInTheDocument();
    expect(mockUseDocumentShares).toHaveBeenCalledWith("project-1", { enabled: true });
  });

  it("marks a row whose public link is already active", () => {
    mockUseProjectDocumentsState.mockReturnValue({ documents: [storedDocument()], isLoading: false });
    mockUseDocumentShares.mockReturnValue({
      sharesByDocumentId: new Map([["doc-1", { documentId: "doc-1", shareToken: "t", createdAt: "2026-09-08T00:00:00Z" }]]),
      isLoading: false,
    });

    renderProjectDocuments();

    expect(screen.getByTitle("Public link is active")).toBeInTheDocument();
    expect(screen.queryByTitle("Share")).not.toBeInTheDocument();
  });

  it("gives a client Download but never Share, and skips the shares query", () => {
    mockUsePermission.mockReturnValue(buildPermission("viewer"));
    mockUseProjectDocumentsState.mockReturnValue({ documents: [storedDocument()], isLoading: false });

    renderProjectDocuments();

    expect(screen.getByTitle("Download")).toBeInTheDocument();
    expect(screen.queryByTitle("Share")).not.toBeInTheDocument();
    expect(mockUseDocumentShares).toHaveBeenCalledWith("project-1", { enabled: false });
  });

  it("offers no Download on a row without a file", () => {
    mockUseProjectDocumentsState.mockReturnValue({ documents: [createDocument({ versions: [{
      id: "version-1", document_id: "doc-1", number: 1, status: "draft", content: "",
    }] })], isLoading: false });

    renderProjectDocuments();

    expect(screen.queryByTitle("Download")).not.toBeInTheDocument();
    expect(screen.queryByTitle("Share")).not.toBeInTheDocument();
  });

  it("downloads from the row: one signing, one fetch, saved under the stored filename", async () => {
    mockUseProjectDocumentsState.mockReturnValue({ documents: [storedDocument()], isLoading: false });

    renderProjectDocuments();
    fireEvent.click(screen.getByTitle("Download"));

    await waitFor(() => expect(clickedDownloadNames).toEqual(["contract.pdf"]));
    expect(mockCreateSignedUrl).toHaveBeenCalledTimes(1);
    expect(mockCreateSignedUrl).toHaveBeenCalledWith("p/project-1/contract.pdf", 3600);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mockToast).not.toHaveBeenCalled();
  });

  it("opens the share dialog from the row and mints the link", async () => {
    mockUseProjectDocumentsState.mockReturnValue({ documents: [storedDocument()], isLoading: false });

    renderProjectDocuments();
    fireEvent.click(screen.getByTitle("Share"));

    expect(await screen.findByText("Share document")).toBeInTheDocument();
    await waitFor(() => expect(mockShareCreate).toHaveBeenCalledWith("doc-1"));
  });

  it("in the preview, an internal document shows the warning and Share stays live for the owner", async () => {
    mockUseProjectDocumentsState.mockReturnValue({
      documents: [storedDocument({ title: "Internal memo", visibility_class: "internal" })],
      isLoading: false,
    });

    renderProjectDocuments();
    fireEvent.click(screen.getByText("Internal memo"));

    expect(await screen.findByText("Document preview")).toBeInTheDocument();
    expect(screen.getByTestId("document-internal-share-warning")).toHaveTextContent("Internal documents cannot be shared.");
    const share = screen.getByRole("button", { name: "Share" });
    expect(share).toBeEnabled();

    fireEvent.click(share);
    expect(await screen.findByTestId("document-share-internal-warning")).toBeInTheDocument();
    expect(mockShareCreate).not.toHaveBeenCalled();
  });

  it("in the preview, the owner gets a visibility switch and a client does not", async () => {
    mockUseProjectDocumentsState.mockReturnValue({ documents: [storedDocument()], isLoading: false });

    const { unmount } = renderProjectDocuments();
    fireEvent.click(screen.getByText("Document One"));
    expect(await screen.findByText("Document preview")).toBeInTheDocument();
    expect(screen.getByTestId("document-visibility-select")).toBeInTheDocument();
    unmount();

    mockUsePermission.mockReturnValue(buildPermission("viewer"));
    renderProjectDocuments();
    fireEvent.click(screen.getByText("Document One"));
    expect(await screen.findByText("Document preview")).toBeInTheDocument();
    expect(screen.queryByTestId("document-visibility-select")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Share" })).not.toBeInTheDocument();
  });

  it("switching to Internal asks for confirmation, warns about the live link, then persists", async () => {
    const updateDocumentVisibility = vi.fn().mockResolvedValue(undefined);
    mockUseProjectDocumentMutations.mockReturnValue({
      createDocument: vi.fn(),
      archiveDocument: vi.fn(),
      deleteDocument: vi.fn(),
      updateDocumentVisibility,
    });
    mockUseDocumentShares.mockReturnValue({
      sharesByDocumentId: new Map([["doc-1", { documentId: "doc-1", shareToken: "t", createdAt: "2026-09-08T00:00:00Z" }]]),
      isLoading: false,
    });
    mockUseProjectDocumentsState.mockReturnValue({ documents: [storedDocument()], isLoading: false });

    renderProjectDocuments();
    fireEvent.click(screen.getByText("Document One"));
    await screen.findByText("Document preview");

    fireEvent.pointerDown(screen.getByTestId("document-visibility-select"));
    fireEvent.click(await screen.findByRole("option", { name: "Internal" }));

    expect(await screen.findByText("Make the document internal?")).toBeInTheDocument();
    expect(screen.getByText(/The public link to this document will be revoked/)).toBeInTheDocument();
    expect(updateDocumentVisibility).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Change" }));
    });

    await waitFor(() => expect(updateDocumentVisibility).toHaveBeenCalledWith({ documentId: "doc-1", visibilityClass: "internal" }));
    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ title: "Document visibility updated" }));
  });

  it("cancelling the confirmation changes nothing", async () => {
    const updateDocumentVisibility = vi.fn().mockResolvedValue(undefined);
    mockUseProjectDocumentMutations.mockReturnValue({
      createDocument: vi.fn(),
      archiveDocument: vi.fn(),
      deleteDocument: vi.fn(),
      updateDocumentVisibility,
    });
    mockUseProjectDocumentsState.mockReturnValue({ documents: [storedDocument()], isLoading: false });

    renderProjectDocuments();
    fireEvent.click(screen.getByText("Document One"));
    await screen.findByText("Document preview");

    fireEvent.pointerDown(screen.getByTestId("document-visibility-select"));
    fireEvent.click(await screen.findByRole("option", { name: "Internal" }));
    await screen.findByText("Make the document internal?");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    });

    expect(updateDocumentVisibility).not.toHaveBeenCalled();
  });
});
