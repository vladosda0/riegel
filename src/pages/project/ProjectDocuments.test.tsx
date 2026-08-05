import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import ProjectDocuments from "@/pages/project/ProjectDocuments";
import type { Document, MemberRole } from "@/types/entities";

const { mockCreateSignedUrl } = vi.hoisted(() => ({ mockCreateSignedUrl: vi.fn() }));

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

  it("shows print plus disabled download and share actions for Supabase preview", () => {
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
    expect(screen.getByRole("button", { name: "Download" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Share" })).toBeDisabled();
    expect(screen.getByText("Download and sharing are coming soon.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Comment/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Confirm acknowledgement/i })).not.toBeInTheDocument();
  });

  // rovno #284 slice S2. The download button used to be window.open(signedUrl),
  // which is not a download: no Content-Disposition, no filename, and the popup
  // blocker can eat it. A PDF opened a tab instead of saving.
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

    function renderWithStoredDocument() {
      mockUseWorkspaceMode.mockReturnValue({ kind: "supabase", profileId: "user-1" });
      mockUseProjectDocumentsState.mockReturnValue({
        documents: [createDocument({ title: "Stored Document", versions: [storedVersion] })],
        isLoading: false,
      });
      renderProjectDocuments();
      fireEvent.click(screen.getByRole("button", { name: /Stored Document/ }));
    }

    it("asks for a signed URL carrying the real filename, and never opens a tab", async () => {
      mockCreateSignedUrl.mockResolvedValue({ data: { signedUrl: "https://signed.example/contract.docx" }, error: null });
      const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
      const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

      renderWithStoredDocument();
      await screen.findByRole("button", { name: "Download" });
      fireEvent.click(screen.getByRole("button", { name: "Download" }));

      await vi.waitFor(() => {
        expect(mockCreateSignedUrl).toHaveBeenCalledWith(
          "project-1/contract.docx",
          3600,
          { download: "contract.docx" },
        );
      });
      // The load-bearing assertion: a real download, not a new tab.
      expect(openSpy).not.toHaveBeenCalled();
      expect(clickSpy).toHaveBeenCalled();

      openSpy.mockRestore();
      clickSpy.mockRestore();
    });

    // Control: proves the assertion above is not vacuous. If the fix were
    // "call createSignedUrl twice and still window.open", this would fail.
    it("keeps the download enabled once the preview URL resolves", async () => {
      mockCreateSignedUrl.mockResolvedValue({ data: { signedUrl: "https://signed.example/contract.docx" }, error: null });
      renderWithStoredDocument();
      await vi.waitFor(() => {
        expect(screen.getByRole("button", { name: "Download" })).not.toBeDisabled();
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
