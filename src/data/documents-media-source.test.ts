import { describe, expect, it, vi } from "vitest";
import {
  archiveSupabaseProjectDocument,
  createSupabaseProjectDocument,
  createSupabaseProjectDocumentVersion,
  deleteSupabaseProjectDocument,
  finalizeSupabaseDocumentUpload,
  finalizeSupabaseMediaUpload,
  mapProjectMediaRowToMedia,
  prepareSupabaseDocumentUpload,
  prepareSupabaseMediaUpload,
  shapeDocumentsWithVersions,
  storageObjectRowToMeta,
} from "@/data/documents-media-source";

function documentRow(
  overrides: Partial<Parameters<typeof shapeDocumentsWithVersions>[0]["documentRows"][number]> = {},
) {
  return {
    id: "doc-1",
    project_id: "project-1",
    type: "specification",
    title: "Electrical Specification",
    origin: "uploaded" as const,
    description: "Main scope document",
    created_by: "profile-1",
    created_at: "2026-03-01T00:00:00.000Z",
    updated_at: "2026-03-01T00:00:00.000Z",
    visibility_class: "shared_project" as const,
    linked_external_kind: null,
    linked_workspace_document_id: null,
    linked_org_document_id: null,
    ...overrides,
  };
}

function documentVersionRow(
  overrides: Partial<Parameters<typeof shapeDocumentsWithVersions>[0]["versionRows"][number]> = {},
) {
  return {
    id: "version-1",
    document_id: "doc-1",
    storage_object_id: null,
    version_number: 1,
    is_current: true,
    created_by: "profile-1",
    created_at: "2026-03-01T00:00:00.000Z",
    ...overrides,
  };
}

function projectMediaRow(
  overrides: Partial<Parameters<typeof mapProjectMediaRowToMedia>[0]> = {},
) {
  return {
    id: "media-1",
    project_id: "project-1",
    storage_object_id: "storage-1",
    task_id: "task-1",
    uploaded_by: "profile-2",
    media_type: "photo",
    is_final: false,
    caption: "Before shot",
    created_at: "2026-03-01T00:00:00.000Z",
    visibility_class: "shared_project" as const,
    ...overrides,
  };
}

function storageObjectRow(
  overrides: Partial<{ id: string; bucket: string; object_path: string; filename: string; mime_type: string | null; size_bytes: number | null; checksum: string | null; uploaded_by: string | null; created_at: string }> = {},
) {
  return {
    id: "so-1",
    bucket: "project-documents",
    object_path: "projects/p1/documents/intent-1/file.pdf",
    filename: "file.pdf",
    mime_type: "application/pdf" as string | null,
    size_bytes: 2048 as number | null,
    checksum: null as string | null,
    uploaded_by: "profile-1" as string | null,
    created_at: "2026-03-01T00:00:00.000Z",
    ...overrides,
  };
}

function createSupabaseStub(input: {
  documentsTable?: Record<string, unknown>;
  versionsTable?: Record<string, unknown>;
  rpcResults?: Record<string, { data: unknown; error: unknown }>;
}) {
  return {
    from: vi.fn((table: string) => {
      if (table === "documents") {
        return input.documentsTable;
      }

      if (table === "document_versions") {
        return input.versionsTable;
      }

      throw new Error(`Unexpected table: ${table}`);
    }),
    rpc: vi.fn((name: string) => {
      const result = input.rpcResults?.[name];
      if (result) {
        return Promise.resolve(result);
      }
      return Promise.resolve({ data: null, error: { message: `Unexpected RPC: ${name}` } });
    }),
  } as unknown as Parameters<typeof createSupabaseProjectDocument>[0];
}

describe("documents-media-source helpers", () => {
  it("groups document versions into nested frontend documents and omits versionless rows", () => {
    const documents = shapeDocumentsWithVersions({
      documentRows: [
        documentRow({
          id: "doc-with-versions",
          title: "Has Versions",
          origin: "manual",
          description: null,
        }),
        documentRow({
          id: "doc-without-versions",
          title: "Missing Versions",
        }),
      ],
      versionRows: [
        documentVersionRow({
          id: "version-2",
          document_id: "doc-with-versions",
          version_number: 2,
        }),
        documentVersionRow({
          id: "version-1",
          document_id: "doc-with-versions",
          version_number: 1,
        }),
      ],
    });

    expect(documents).toEqual([
      {
        id: "doc-with-versions",
        project_id: "project-1",
        type: "specification",
        title: "Has Versions",
        versions: [
          {
            id: "version-1",
            document_id: "doc-with-versions",
            number: 1,
            status: "draft",
            content: "",
          },
          {
            id: "version-2",
            document_id: "doc-with-versions",
            number: 2,
            status: "draft",
            content: "",
          },
        ],
        origin: "manual",
        description: undefined,
        created_at: "2026-03-01T00:00:00.000Z",
        file_meta: undefined,
        ai_flags: undefined,
        visibility_class: "shared_project",
      },
    ]);
  });

  it("maps project media rows to the frontend Media contract with safe defaults", () => {
    const media = mapProjectMediaRowToMedia(projectMediaRow({
      task_id: null,
      is_final: true,
      uploaded_by: null,
      caption: null,
    }));

    expect(media).toEqual({
      id: "media-1",
      project_id: "project-1",
      task_id: undefined,
      uploader_id: "",
      caption: "",
      description: undefined,
      is_final: true,
      created_at: "2026-03-01T00:00:00.000Z",
      file_meta: undefined,
      visibility_class: "shared_project",
    });
  });

  it("marks documents with no current version as archived", () => {
    const documents = shapeDocumentsWithVersions({
      documentRows: [
        documentRow({
          id: "doc-archived",
          title: "Archived Document",
        }),
      ],
      versionRows: [
        documentVersionRow({
          id: "version-1",
          document_id: "doc-archived",
          version_number: 1,
          is_current: false,
        }),
        documentVersionRow({
          id: "version-2",
          document_id: "doc-archived",
          version_number: 2,
          is_current: false,
        }),
      ],
    });

    expect(documents).toEqual([
      expect.objectContaining({
        id: "doc-archived",
        versions: [
          expect.objectContaining({ id: "version-1", status: "draft" }),
          expect.objectContaining({ id: "version-2", status: "archived" }),
        ],
      }),
    ]);
  });

  it("persists document create plus initial current version in Supabase mode", async () => {
    const documentsTable = {
      insert: vi.fn().mockResolvedValue({ error: null }),
    };
    const versionsTable = {
      insert: vi.fn().mockResolvedValue({ error: null }),
    };
    const supabase = createSupabaseStub({ documentsTable, versionsTable });

    const result = await createSupabaseProjectDocument(supabase, "profile-1", {
      projectId: "project-1",
      type: "specification",
      title: "Electrical Specification",
      origin: "uploaded",
    });

    expect(documentsTable.insert).toHaveBeenCalledWith(expect.objectContaining({
      id: result.documentId,
      project_id: "project-1",
      type: "specification",
      title: "Electrical Specification",
      origin: "uploaded",
      created_by: "profile-1",
    }));
    expect(versionsTable.insert).toHaveBeenCalledWith(expect.objectContaining({
      id: result.versionId,
      document_id: result.documentId,
      version_number: 1,
      is_current: true,
      created_by: "profile-1",
    }));
  });

  it("creates a new current version and clears the previous current version in Supabase mode", async () => {
    const order = vi.fn().mockResolvedValue({
      data: [
        documentVersionRow({
          id: "version-1",
          document_id: "doc-1",
          version_number: 1,
          is_current: true,
        }),
      ],
      error: null,
    });
    const selectEq = vi.fn(() => ({ order }));
    const currentEq = vi.fn().mockResolvedValue({ error: null });
    const documentEq = vi.fn(() => ({ eq: currentEq }));
    const versionsTable = {
      select: vi.fn(() => ({ eq: selectEq })),
      update: vi.fn(() => ({ eq: documentEq })),
      insert: vi.fn().mockResolvedValue({ error: null }),
    };
    const supabase = createSupabaseStub({ versionsTable });

    const result = await createSupabaseProjectDocumentVersion(supabase, "profile-1", {
      projectId: "project-1",
      documentId: "doc-1",
    });

    expect(selectEq).toHaveBeenCalledWith("document_id", "doc-1");
    expect(order).toHaveBeenCalledWith("version_number", { ascending: true });
    expect(versionsTable.update).toHaveBeenCalledWith({ is_current: false });
    expect(documentEq).toHaveBeenCalledWith("document_id", "doc-1");
    expect(currentEq).toHaveBeenCalledWith("is_current", true);
    expect(versionsTable.insert).toHaveBeenCalledWith(expect.objectContaining({
      id: result.versionId,
      document_id: "doc-1",
      version_number: 2,
      is_current: true,
      created_by: "profile-1",
    }));
  });

  it("archives a document by inserting a non-current marker version in Supabase mode", async () => {
    const order = vi.fn().mockResolvedValue({
      data: [
        documentVersionRow({
          id: "version-1",
          document_id: "doc-1",
          version_number: 1,
          is_current: false,
        }),
        documentVersionRow({
          id: "version-2",
          document_id: "doc-1",
          version_number: 2,
          is_current: true,
        }),
      ],
      error: null,
    });
    const selectEq = vi.fn(() => ({ order }));
    const currentEq = vi.fn().mockResolvedValue({ error: null });
    const documentEq = vi.fn(() => ({ eq: currentEq }));
    const versionsTable = {
      select: vi.fn(() => ({ eq: selectEq })),
      update: vi.fn(() => ({ eq: documentEq })),
      insert: vi.fn().mockResolvedValue({ error: null }),
    };
    const supabase = createSupabaseStub({ versionsTable });

    const result = await archiveSupabaseProjectDocument(supabase, "profile-1", {
      projectId: "project-1",
      documentId: "doc-1",
    });

    expect(versionsTable.update).toHaveBeenCalledWith({ is_current: false });
    expect(versionsTable.insert).toHaveBeenCalledWith(expect.objectContaining({
      id: result.versionId,
      document_id: "doc-1",
      version_number: 3,
      is_current: false,
      created_by: "profile-1",
    }));
  });

  it("carries the outgoing current version's storage link onto the archive marker", async () => {
    const order = vi.fn().mockResolvedValue({
      data: [
        documentVersionRow({
          id: "version-1",
          document_id: "doc-1",
          version_number: 1,
          is_current: false,
          storage_object_id: "so-old",
        }),
        documentVersionRow({
          id: "version-2",
          document_id: "doc-1",
          version_number: 2,
          is_current: true,
          storage_object_id: "so-current",
        }),
      ],
      error: null,
    });
    const selectEq = vi.fn(() => ({ order }));
    const currentEq = vi.fn().mockResolvedValue({ error: null });
    const documentEq = vi.fn(() => ({ eq: currentEq }));
    const versionsTable = {
      select: vi.fn(() => ({ eq: selectEq })),
      update: vi.fn(() => ({ eq: documentEq })),
      insert: vi.fn().mockResolvedValue({ error: null }),
    };
    const supabase = createSupabaseStub({ versionsTable });

    await archiveSupabaseProjectDocument(supabase, "profile-1", {
      projectId: "project-1",
      documentId: "doc-1",
    });

    expect(versionsTable.insert).toHaveBeenCalledWith(expect.objectContaining({
      storage_object_id: "so-current",
    }));
  });

  it("leaves the archive marker's storage link null when no version had one", async () => {
    const order = vi.fn().mockResolvedValue({
      data: [
        documentVersionRow({
          id: "version-1",
          document_id: "doc-1",
          version_number: 1,
          is_current: true,
          storage_object_id: null,
        }),
      ],
      error: null,
    });
    const selectEq = vi.fn(() => ({ order }));
    const currentEq = vi.fn().mockResolvedValue({ error: null });
    const documentEq = vi.fn(() => ({ eq: currentEq }));
    const versionsTable = {
      select: vi.fn(() => ({ eq: selectEq })),
      update: vi.fn(() => ({ eq: documentEq })),
      insert: vi.fn().mockResolvedValue({ error: null }),
    };
    const supabase = createSupabaseStub({ versionsTable });

    await archiveSupabaseProjectDocument(supabase, "profile-1", {
      projectId: "project-1",
      documentId: "doc-1",
    });

    expect(versionsTable.insert).toHaveBeenCalledWith(expect.objectContaining({
      storage_object_id: null,
    }));
  });

  it("deletes the document row in Supabase mode", async () => {
    const eq = vi.fn().mockResolvedValue({ error: null });
    const documentsTable = {
      delete: vi.fn(() => ({ eq })),
    };
    const supabase = createSupabaseStub({ documentsTable });

    await deleteSupabaseProjectDocument(supabase, {
      projectId: "project-1",
      documentId: "doc-1",
    });

    expect(documentsTable.delete).toHaveBeenCalledTimes(1);
    expect(eq).toHaveBeenCalledWith("id", "doc-1");
  });

  it("calls prepare_document_upload RPC and returns structured intent", async () => {
    const rpcRow = {
      upload_intent_id: "intent-doc-1",
      bucket: "project-documents",
      object_path: "projects/p1/documents/intent-doc-1/file.pdf",
      filename: "file.pdf",
      mime_type: "application/pdf",
      size_bytes: 1024,
    };
    const supabase = createSupabaseStub({
      rpcResults: {
        prepare_document_upload: { data: [rpcRow], error: null },
      },
    });

    const result = await prepareSupabaseDocumentUpload(supabase, {
      projectId: "p1",
      type: "specification",
      title: "My Document",
      clientFilename: "file.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1024,
    });

    expect(result).toEqual({
      uploadIntentId: "intent-doc-1",
      bucket: "project-documents",
      objectPath: "projects/p1/documents/intent-doc-1/file.pdf",
      filename: "file.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1024,
    });
    expect(supabase.rpc).toHaveBeenCalledWith("prepare_document_upload", expect.objectContaining({
      p_project_id: "p1",
      p_type: "specification",
      p_title: "My Document",
      p_client_filename: "file.pdf",
    }));
  });

  it("calls finalize_document_upload RPC and returns linkage result", async () => {
    const rpcRow = {
      document_id: "doc-1",
      document_version_id: "version-1",
      storage_object_id: "so-1",
      project_id: "p1",
      bucket: "project-documents",
      object_path: "projects/p1/documents/intent-doc-1/file.pdf",
      filename: "file.pdf",
    };
    const supabase = createSupabaseStub({
      rpcResults: {
        finalize_document_upload: { data: [rpcRow], error: null },
      },
    });

    const result = await finalizeSupabaseDocumentUpload(supabase, "intent-doc-1");

    expect(result).toEqual({
      documentId: "doc-1",
      documentVersionId: "version-1",
      storageObjectId: "so-1",
      projectId: "p1",
      bucket: "project-documents",
      objectPath: "projects/p1/documents/intent-doc-1/file.pdf",
      filename: "file.pdf",
    });
    expect(supabase.rpc).toHaveBeenCalledWith("finalize_document_upload", {
      p_upload_intent_id: "intent-doc-1",
    });
  });

  it("calls prepare_project_media_upload RPC and returns structured intent", async () => {
    const rpcRow = {
      upload_intent_id: "intent-media-1",
      bucket: "project-media",
      object_path: "projects/p1/media/intent-media-1/photo.jpg",
      filename: "photo.jpg",
      mime_type: "image/jpeg",
      size_bytes: 2048,
    };
    const supabase = createSupabaseStub({
      rpcResults: {
        prepare_project_media_upload: { data: [rpcRow], error: null },
      },
    });

    const result = await prepareSupabaseMediaUpload(supabase, {
      projectId: "p1",
      mediaType: "photo",
      clientFilename: "photo.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 2048,
      taskId: "task-42",
      isFinal: true,
    });

    expect(result).toEqual({
      uploadIntentId: "intent-media-1",
      bucket: "project-media",
      objectPath: "projects/p1/media/intent-media-1/photo.jpg",
      filename: "photo.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 2048,
    });
    expect(supabase.rpc).toHaveBeenCalledWith("prepare_project_media_upload", expect.objectContaining({
      p_project_id: "p1",
      p_media_type: "photo",
      p_task_id: "task-42",
      p_is_final: true,
    }));
  });

  it("calls finalize_project_media_upload RPC and returns linkage result", async () => {
    const rpcRow = {
      project_media_id: "media-1",
      storage_object_id: "so-1",
      project_id: "p1",
      bucket: "project-media",
      object_path: "projects/p1/media/intent-media-1/photo.jpg",
      filename: "photo.jpg",
    };
    const supabase = createSupabaseStub({
      rpcResults: {
        finalize_project_media_upload: { data: [rpcRow], error: null },
      },
    });

    const result = await finalizeSupabaseMediaUpload(supabase, "intent-media-1", {
      taskId: "task-42",
      isFinal: true,
    });

    expect(result).toEqual({
      projectMediaId: "media-1",
      storageObjectId: "so-1",
      projectId: "p1",
      bucket: "project-media",
      objectPath: "projects/p1/media/intent-media-1/photo.jpg",
      filename: "photo.jpg",
    });
    expect(supabase.rpc).toHaveBeenCalledWith("finalize_project_media_upload", {
      p_upload_intent_id: "intent-media-1",
      p_task_id: "task-42",
      p_is_final: true,
    });
  });

  it("throws when prepare_document_upload returns an error", async () => {
    const supabase = createSupabaseStub({
      rpcResults: {
        prepare_document_upload: { data: null, error: { message: "permission denied" } },
      },
    });

    await expect(prepareSupabaseDocumentUpload(supabase, {
      projectId: "p1",
      type: "specification",
      title: "Doc",
      clientFilename: "file.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1024,
    })).rejects.toEqual({ message: "permission denied" });
  });

  it("throws when finalize_document_upload returns empty rows", async () => {
    const supabase = createSupabaseStub({
      rpcResults: {
        finalize_document_upload: { data: [], error: null },
      },
    });

    await expect(finalizeSupabaseDocumentUpload(supabase, "intent-1"))
      .rejects.toThrow("finalize_document_upload returned no rows.");
  });

  it("surfaces storage metadata on document current version and file_meta when storage objects are provided", () => {
    const soRow = storageObjectRow({
      id: "so-current",
      bucket: "project-documents",
      object_path: "projects/p1/documents/intent-1/spec.pdf",
      filename: "spec.pdf",
      mime_type: "application/pdf",
      size_bytes: 4096,
    });
    const storageObjectsById = new Map([[soRow.id, soRow]]);

    const documents = shapeDocumentsWithVersions({
      documentRows: [
        documentRow({ id: "doc-1", title: "With Storage" }),
      ],
      versionRows: [
        documentVersionRow({
          id: "v1",
          document_id: "doc-1",
          version_number: 1,
          is_current: true,
          storage_object_id: "so-current",
        }),
      ],
      storageObjectsById,
    });

    expect(documents).toHaveLength(1);
    const doc = documents[0];

    expect(doc.file_meta).toEqual({
      filename: "spec.pdf",
      mime: "application/pdf",
      size: 4096,
    });

    const version = doc.versions[0];
    expect(version.storage).toEqual({
      id: "so-current",
      bucket: "project-documents",
      objectPath: "projects/p1/documents/intent-1/spec.pdf",
      filename: "spec.pdf",
      mimeType: "application/pdf",
      sizeBytes: 4096,
    });
  });

  it("keeps file_meta on an archived document, whose newest version is the archive marker", () => {
    const soRow = storageObjectRow({
      id: "so-current",
      filename: "contract.pdf",
      mime_type: "application/pdf",
      size_bytes: 4096,
    });
    const storageObjectsById = new Map([[soRow.id, soRow]]);

    const documents = shapeDocumentsWithVersions({
      documentRows: [
        documentRow({ id: "doc-1", title: "Archived" }),
      ],
      versionRows: [
        documentVersionRow({
          id: "v1",
          document_id: "doc-1",
          version_number: 1,
          is_current: false,
          storage_object_id: "so-current",
        }),
        documentVersionRow({
          id: "v2-archive-marker",
          document_id: "doc-1",
          version_number: 2,
          is_current: false,
          storage_object_id: "so-current",
        }),
      ],
      storageObjectsById,
    });

    expect(documents).toHaveLength(1);
    const doc = documents[0];

    expect(doc.versions[doc.versions.length - 1].status).toBe("archived");
    expect(doc.file_meta).toEqual({
      filename: "contract.pdf",
      mime: "application/pdf",
      size: 4096,
    });
    expect(doc.versions[doc.versions.length - 1].storage?.objectPath).toBe(soRow.object_path);
  });

  it("leaves storage undefined on document versions with null storage_object_id even when map is provided", () => {
    const storageObjectsById = new Map<string, ReturnType<typeof storageObjectRow>>();

    const documents = shapeDocumentsWithVersions({
      documentRows: [
        documentRow({ id: "doc-1", title: "No Storage" }),
      ],
      versionRows: [
        documentVersionRow({
          id: "v1",
          document_id: "doc-1",
          version_number: 1,
          is_current: true,
          storage_object_id: null,
        }),
      ],
      storageObjectsById,
    });

    expect(documents).toHaveLength(1);
    expect(documents[0].file_meta).toBeUndefined();
    expect(documents[0].versions[0].storage).toBeUndefined();
  });

  it("surfaces storage and file_meta on media rows when a storage object is provided", () => {
    const soRow = storageObjectRow({
      id: "so-media-1",
      bucket: "project-media",
      object_path: "projects/p1/media/intent-m1/photo.jpg",
      filename: "photo.jpg",
      mime_type: "image/jpeg",
      size_bytes: 8192,
    });

    const media = mapProjectMediaRowToMedia(
      projectMediaRow({ storage_object_id: "so-media-1" }),
      soRow,
    );

    expect(media.storage).toEqual({
      id: "so-media-1",
      bucket: "project-media",
      objectPath: "projects/p1/media/intent-m1/photo.jpg",
      filename: "photo.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 8192,
    });

    expect(media.file_meta).toEqual({
      filename: "photo.jpg",
      mime: "image/jpeg",
      size: 8192,
    });
  });

  it("leaves storage and file_meta undefined on media rows when no storage object is provided", () => {
    const media = mapProjectMediaRowToMedia(projectMediaRow());

    expect(media.storage).toBeUndefined();
    expect(media.file_meta).toBeUndefined();
  });

  it("converts a storage object row to StorageObjectMeta", () => {
    const row = storageObjectRow({
      id: "so-test",
      bucket: "my-bucket",
      object_path: "some/path/file.txt",
      filename: "file.txt",
      mime_type: null,
      size_bytes: null,
    });

    expect(storageObjectRowToMeta(row)).toEqual({
      id: "so-test",
      bucket: "my-bucket",
      objectPath: "some/path/file.txt",
      filename: "file.txt",
      mimeType: null,
      sizeBytes: null,
    });
  });
});
