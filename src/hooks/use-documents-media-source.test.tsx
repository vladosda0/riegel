import { act, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as documentsMediaSource from "@/data/documents-media-source";
import * as store from "@/data/store";
import {
  documentsMediaQueryKeys,
  useProjectDocumentMutations,
  useProjectDocumentsState,
  useProjectMedia,
} from "@/hooks/use-documents-media-source";
import { authenticateRuntimeAuth } from "@/test/runtime-auth";
import type { Document, Media } from "@/types/entities";

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
}

function document(partial: Partial<Document> = {}): Document {
  return {
    id: "doc-1",
    project_id: "project-1",
    type: "specification",
    title: "Document One",
    versions: [{
      id: "version-1",
      document_id: "doc-1",
      number: 1,
      status: "draft",
      content: "",
    }],
    ...partial,
  };
}

function media(partial: Partial<Media> = {}): Media {
  return {
    id: "media-1",
    project_id: "project-1",
    uploader_id: "profile-1",
    caption: "Photo One",
    is_final: false,
    created_at: "2026-03-01T00:00:00.000Z",
    ...partial,
  };
}

function DocumentsMediaProbe({ projectId }: { projectId: string }) {
  const { documents, isLoading } = useProjectDocumentsState(projectId);
  const mediaItems = useProjectMedia(projectId);

  return (
    <div>
      <span data-testid="document-count">{documents.length}</span>
      <span data-testid="media-count">{mediaItems.length}</span>
      <span data-testid="documents-loading">{isLoading ? "yes" : "no"}</span>
      <span data-testid="document-titles">{documents.map((item) => item.title).join("|")}</span>
      <span data-testid="media-captions">{mediaItems.map((item) => item.caption).join("|")}</span>
    </div>
  );
}

function DocumentsMutationProbe({ projectId }: { projectId: string }) {
  const {
    createDocument,
    createDocumentVersion,
    archiveDocument,
    deleteDocument,
  } = useProjectDocumentMutations(projectId);

  return (
    <div>
      <button
        type="button"
        onClick={() => {
          void createDocument({
            type: "specification",
            title: "Mutation Document",
            origin: "uploaded",
          });
        }}
      >
        Create document
      </button>
      <button
        type="button"
        onClick={() => {
          void createDocumentVersion({
            documentId: "doc-1",
            status: "awaiting_approval",
            content: "v2",
          });
        }}
      >
        Create version
      </button>
      <button
        type="button"
        onClick={() => {
          void archiveDocument({
            documentId: "doc-1",
            content: "archive marker",
          });
        }}
      >
        Archive document
      </button>
      <button
        type="button"
        onClick={() => {
          void deleteDocument("doc-1");
        }}
      >
        Delete document
      </button>
    </div>
  );
}

describe("useProjectDocumentsState/useProjectMedia", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("returns store-backed document and media data in browser modes and reacts to subscriptions", async () => {
    const queryClient = createQueryClient();
    let currentDocuments = [document({ title: "Document One" })];
    let currentMedia = [media({ caption: "Photo One" })];
    const listeners = new Set<() => void>();

    const getDocumentsSpy = vi.spyOn(store, "getDocuments").mockImplementation(() => currentDocuments);
    const getMediaSpy = vi.spyOn(store, "getMedia").mockImplementation(() => currentMedia);
    vi.spyOn(store, "subscribe").mockImplementation((callback) => {
      listeners.add(callback);
      return () => {
        listeners.delete(callback);
      };
    });

    render(
      <QueryClientProvider client={queryClient}>
        <DocumentsMediaProbe projectId="project-1" />
      </QueryClientProvider>,
    );

    expect(screen.getByTestId("document-count")).toHaveTextContent("1");
    expect(screen.getByTestId("media-count")).toHaveTextContent("1");
    expect(screen.getByTestId("documents-loading")).toHaveTextContent("no");
    expect(screen.getByTestId("document-titles")).toHaveTextContent("Document One");
    expect(screen.getByTestId("media-captions")).toHaveTextContent("Photo One");

    act(() => {
      currentDocuments = [document({ title: "Document Two" })];
      currentMedia = [media({ caption: "Photo Two" })];
      listeners.forEach((listener) => listener());
    });

    await waitFor(() => {
      expect(screen.getByTestId("document-titles")).toHaveTextContent("Document Two");
    });
    expect(screen.getByTestId("media-captions")).toHaveTextContent("Photo Two");
    expect(getDocumentsSpy).toHaveBeenCalledWith("project-1");
    expect(getMediaSpy).toHaveBeenCalledWith("project-1");
  });

  it("returns empty arrays while Supabase documents/media are loading, then mapped results", async () => {
    vi.stubEnv("VITE_WORKSPACE_SOURCE", "supabase");

    const queryClient = createQueryClient();
    let resolveDocuments: (value: Document[]) => void;
    let resolveMedia: (value: Media[]) => void;
    const documentsPromise = new Promise<Document[]>((resolve) => {
      resolveDocuments = resolve;
    });
    const mediaPromise = new Promise<Media[]>((resolve) => {
      resolveMedia = resolve;
    });
    const getDocumentsSpy = vi.spyOn(store, "getDocuments");
    const getMediaSpy = vi.spyOn(store, "getMedia");
    const source = {
      mode: "supabase" as const,
      getProjectDocuments: vi.fn(() => documentsPromise),
      getProjectMedia: vi.fn(() => mediaPromise),
      createProjectDocument: vi.fn(),
      createProjectDocumentVersion: vi.fn(),
      archiveProjectDocument: vi.fn(),
      deleteProjectDocument: vi.fn(),
      updateProjectDocumentVisibility: vi.fn().mockResolvedValue(undefined),
      prepareDocumentUpload: vi.fn(),
      finalizeDocumentUpload: vi.fn(),
      prepareMediaUpload: vi.fn(),
      finalizeMediaUpload: vi.fn(),
      uploadBytes: vi.fn(),
      deleteProjectMedia: vi.fn(),
      updateProjectMediaCaption: vi.fn(),
    };

    authenticateRuntimeAuth();
    vi.spyOn(documentsMediaSource, "getDocumentsMediaSource").mockResolvedValue(source);

    render(
      <QueryClientProvider client={queryClient}>
        <DocumentsMediaProbe projectId="project-1" />
      </QueryClientProvider>,
    );

    expect(screen.getByTestId("document-count")).toHaveTextContent("0");
    expect(screen.getByTestId("media-count")).toHaveTextContent("0");
    expect(screen.getByTestId("documents-loading")).toHaveTextContent("yes");
    expect(getDocumentsSpy).not.toHaveBeenCalled();
    expect(getMediaSpy).not.toHaveBeenCalled();

    await act(async () => {
      resolveDocuments!([document({ title: "Supabase Document" })]);
      resolveMedia!([media({ caption: "Supabase Photo" })]);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByTestId("document-count")).toHaveTextContent("1");
    });
    expect(screen.getByTestId("media-count")).toHaveTextContent("1");
    expect(screen.getByTestId("documents-loading")).toHaveTextContent("no");
    expect(screen.getByTestId("document-titles")).toHaveTextContent("Supabase Document");
    expect(screen.getByTestId("media-captions")).toHaveTextContent("Supabase Photo");
    expect(source.getProjectDocuments).toHaveBeenCalledWith("project-1");
    expect(source.getProjectMedia).toHaveBeenCalledWith("project-1");
  });

  it("invalidates the relevant documents query after Supabase mutations", async () => {
    vi.stubEnv("VITE_WORKSPACE_SOURCE", "supabase");

    const queryClient = createQueryClient();
    const invalidateQueriesSpy = vi.spyOn(queryClient, "invalidateQueries");
    const createDocumentSpy = vi.spyOn(documentsMediaSource, "createProjectDocument").mockResolvedValue({
      documentId: "doc-created",
      versionId: "version-created",
      versionNumber: 1,
    });
    const createVersionSpy = vi.spyOn(documentsMediaSource, "createProjectDocumentVersion").mockResolvedValue({
      documentId: "doc-1",
      versionId: "version-2",
      versionNumber: 2,
    });
    const archiveSpy = vi.spyOn(documentsMediaSource, "archiveProjectDocument").mockResolvedValue({
      documentId: "doc-1",
      versionId: "version-3",
      versionNumber: 3,
    });
    const deleteSpy = vi.spyOn(documentsMediaSource, "deleteProjectDocument").mockResolvedValue(undefined);

    authenticateRuntimeAuth("profile-77");

    render(
      <QueryClientProvider client={queryClient}>
        <DocumentsMutationProbe projectId="project-1" />
      </QueryClientProvider>,
    );

    act(() => {
      screen.getByRole("button", { name: "Create document" }).click();
      screen.getByRole("button", { name: "Create version" }).click();
      screen.getByRole("button", { name: "Archive document" }).click();
      screen.getByRole("button", { name: "Delete document" }).click();
    });

    await waitFor(() => {
      expect(createDocumentSpy).toHaveBeenCalledWith(
        { kind: "supabase", profileId: "profile-77" },
        {
          projectId: "project-1",
          type: "specification",
          title: "Mutation Document",
          origin: "uploaded",
        },
      );
    });
    expect(createVersionSpy).toHaveBeenCalledWith(
      { kind: "supabase", profileId: "profile-77" },
      {
        projectId: "project-1",
        documentId: "doc-1",
        status: "awaiting_approval",
        content: "v2",
      },
    );
    expect(archiveSpy).toHaveBeenCalledWith(
      { kind: "supabase", profileId: "profile-77" },
      {
        projectId: "project-1",
        documentId: "doc-1",
        content: "archive marker",
      },
    );
    expect(deleteSpy).toHaveBeenCalledWith(
      { kind: "supabase", profileId: "profile-77" },
      {
        projectId: "project-1",
        documentId: "doc-1",
      },
    );
    expect(invalidateQueriesSpy).toHaveBeenCalledWith({
      queryKey: documentsMediaQueryKeys.projectDocuments("profile-77", "project-1"),
    });
  });

  it("skips React Query invalidation for browser-mode document mutations", async () => {
    const queryClient = createQueryClient();
    const invalidateQueriesSpy = vi.spyOn(queryClient, "invalidateQueries");
    const createDocumentSpy = vi.spyOn(documentsMediaSource, "createProjectDocument").mockResolvedValue({
      documentId: "doc-created",
      versionId: "version-created",
      versionNumber: 1,
    });
    const createVersionSpy = vi.spyOn(documentsMediaSource, "createProjectDocumentVersion").mockResolvedValue({
      documentId: "doc-1",
      versionId: "version-2",
      versionNumber: 2,
    });
    const archiveSpy = vi.spyOn(documentsMediaSource, "archiveProjectDocument").mockResolvedValue({
      documentId: "doc-1",
      versionId: "version-3",
      versionNumber: 3,
    });
    const deleteSpy = vi.spyOn(documentsMediaSource, "deleteProjectDocument").mockResolvedValue(undefined);

    render(
      <QueryClientProvider client={queryClient}>
        <DocumentsMutationProbe projectId="project-1" />
      </QueryClientProvider>,
    );

    act(() => {
      screen.getByRole("button", { name: "Create document" }).click();
      screen.getByRole("button", { name: "Create version" }).click();
      screen.getByRole("button", { name: "Archive document" }).click();
      screen.getByRole("button", { name: "Delete document" }).click();
    });

    await waitFor(() => {
      expect(createDocumentSpy).toHaveBeenCalledWith(
        { kind: "local" },
        {
          projectId: "project-1",
          type: "specification",
          title: "Mutation Document",
          origin: "uploaded",
        },
      );
    });
    expect(createVersionSpy).toHaveBeenCalledWith(
      { kind: "local" },
      {
        projectId: "project-1",
        documentId: "doc-1",
        status: "awaiting_approval",
        content: "v2",
      },
    );
    expect(archiveSpy).toHaveBeenCalledWith(
      { kind: "local" },
      {
        projectId: "project-1",
        documentId: "doc-1",
        content: "archive marker",
      },
    );
    expect(deleteSpy).toHaveBeenCalledWith(
      { kind: "local" },
      {
        projectId: "project-1",
        documentId: "doc-1",
      },
    );
    expect(invalidateQueriesSpy).not.toHaveBeenCalled();
  });
});
