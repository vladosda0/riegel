import type { SupabaseClient } from "@supabase/supabase-js";
import * as store from "@/data/store";
import type { WorkspaceMode } from "@/data/workspace-source";
import { resolveWorkspaceMode } from "@/data/workspace-source";
import type { DocMediaVisibilityClass, Document, DocumentVersion, Media, StorageObjectMeta } from "@/types/entities";
import type { Database as DocumentsMediaDatabase } from "../../backend-truth/generated/supabase-types";

type DocumentRow = DocumentsMediaDatabase["public"]["Tables"]["documents"]["Row"];
type DocumentInsert = DocumentsMediaDatabase["public"]["Tables"]["documents"]["Insert"];
type DocumentVersionRow = DocumentsMediaDatabase["public"]["Tables"]["document_versions"]["Row"];
type DocumentVersionInsert = DocumentsMediaDatabase["public"]["Tables"]["document_versions"]["Insert"];
type DocumentVersionUpdate = DocumentsMediaDatabase["public"]["Tables"]["document_versions"]["Update"];
type ProjectMediaRow = DocumentsMediaDatabase["public"]["Tables"]["project_media"]["Row"];
type StorageObjectRow = DocumentsMediaDatabase["public"]["Tables"]["storage_objects"]["Row"];
type TypedSupabaseClient = SupabaseClient<DocumentsMediaDatabase>;

export interface CreateProjectDocumentInput {
  projectId: string;
  type: string;
  title: string;
  origin?: Document["origin"];
  description?: string;
  initialVersionContent?: string;
  initialVersionStatus?: DocumentVersion["status"];
  visibilityClass?: DocMediaVisibilityClass;
}

export interface CreateProjectDocumentVersionInput {
  projectId: string;
  documentId: string;
  content?: string;
  status?: DocumentVersion["status"];
}

export interface ArchiveProjectDocumentInput {
  projectId: string;
  documentId: string;
  content?: string;
}

export interface DeleteProjectDocumentInput {
  projectId: string;
  documentId: string;
}

export interface ProjectDocumentMutationResult {
  documentId: string;
  versionId: string;
  versionNumber: number;
}

export interface PrepareDocumentUploadInput {
  projectId: string;
  type: string;
  title: string;
  clientFilename: string;
  mimeType: string;
  sizeBytes: number;
  description?: string;
  /** Defaults to shared_project when omitted (RPC default). */
  visibilityClass?: DocMediaVisibilityClass;
}

export interface PrepareUploadResult {
  uploadIntentId: string;
  bucket: string;
  objectPath: string;
  filename: string;
  mimeType: string | null;
  sizeBytes: number | null;
}

export interface FinalizeDocumentUploadResult {
  documentId: string;
  documentVersionId: string;
  storageObjectId: string;
  projectId: string;
  bucket: string;
  objectPath: string;
  filename: string;
}

export interface PrepareMediaUploadInput {
  projectId: string;
  mediaType: string;
  clientFilename: string;
  mimeType: string;
  sizeBytes: number;
  caption?: string;
  taskId?: string;
  isFinal?: boolean;
  /** Defaults to shared_project when omitted (RPC default). */
  visibilityClass?: DocMediaVisibilityClass;
}

export interface FinalizeMediaUploadResult {
  projectMediaId: string;
  storageObjectId: string;
  projectId: string;
  bucket: string;
  objectPath: string;
  filename: string;
}

export interface DocumentsMediaSource {
  mode: WorkspaceMode["kind"];
  getProjectDocuments: (projectId: string) => Promise<Document[]>;
  getProjectMedia: (projectId: string) => Promise<Media[]>;
  createProjectDocument: (input: CreateProjectDocumentInput) => Promise<ProjectDocumentMutationResult>;
  createProjectDocumentVersion: (input: CreateProjectDocumentVersionInput) => Promise<ProjectDocumentMutationResult>;
  archiveProjectDocument: (input: ArchiveProjectDocumentInput) => Promise<ProjectDocumentMutationResult>;
  deleteProjectDocument: (input: DeleteProjectDocumentInput) => Promise<void>;
  prepareDocumentUpload: (input: PrepareDocumentUploadInput) => Promise<PrepareUploadResult>;
  finalizeDocumentUpload: (uploadIntentId: string) => Promise<FinalizeDocumentUploadResult>;
  prepareMediaUpload: (input: PrepareMediaUploadInput) => Promise<PrepareUploadResult>;
  finalizeMediaUpload: (uploadIntentId: string, options?: { taskId?: string; isFinal?: boolean }) => Promise<FinalizeMediaUploadResult>;
  deleteProjectMedia: (input: DeleteProjectMediaInput) => Promise<void>;
  updateProjectMediaCaption: (input: UpdateProjectMediaCaptionInput) => Promise<void>;
  uploadBytes: (bucket: string, objectPath: string, file: File) => Promise<void>;
}

export interface DeleteProjectMediaInput {
  projectId: string;
  mediaId: string;
}

export interface UpdateProjectMediaCaptionInput {
  projectId: string;
  mediaId: string;
  caption: string | null;
}

function createDocumentMutationId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const random = Math.floor(Math.random() * 16);
    const value = char === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

function getDocumentForMutation(
  projectId: string,
  documentId: string,
): Document {
  const document = store.getDocuments(projectId).find((entry) => entry.id === documentId);
  if (!document) {
    throw new Error("Document not found.");
  }

  return document;
}

function createBrowserDocumentsMediaSource(mode: WorkspaceMode["kind"]): DocumentsMediaSource {
  return {
    mode,
    async getProjectDocuments(projectId: string) {
      return store.getDocuments(projectId);
    },
    async getProjectMedia(projectId: string) {
      return store.getMedia(projectId);
    },
    async createProjectDocument(input) {
      const now = new Date().toISOString();
      const documentId = createDocumentMutationId();
      const versionId = createDocumentMutationId();

      store.addDocument({
        id: documentId,
        project_id: input.projectId,
        type: input.type,
        title: input.title,
        origin: input.origin,
        description: input.description,
        created_at: now,
        visibility_class: input.visibilityClass ?? "shared_project",
        versions: [{
          id: versionId,
          document_id: documentId,
          number: 1,
          status: input.initialVersionStatus ?? "draft",
          content: input.initialVersionContent ?? "",
        }],
      });

      return {
        documentId,
        versionId,
        versionNumber: 1,
      };
    },
    async createProjectDocumentVersion(input) {
      const document = getDocumentForMutation(input.projectId, input.documentId);
      const versionId = createDocumentMutationId();
      const versionNumber = document.versions.length + 1;

      store.addDocumentVersion(input.documentId, {
        id: versionId,
        document_id: input.documentId,
        number: versionNumber,
        status: input.status ?? "draft",
        content: input.content ?? "",
      });

      return {
        documentId: input.documentId,
        versionId,
        versionNumber,
      };
    },
    async archiveProjectDocument(input) {
      const document = getDocumentForMutation(input.projectId, input.documentId);
      const latestVersion = document.versions[document.versions.length - 1];
      const versionId = createDocumentMutationId();
      const versionNumber = document.versions.length + 1;

      store.addDocumentVersion(input.documentId, {
        id: versionId,
        document_id: input.documentId,
        number: versionNumber,
        status: "archived",
        content: input.content ?? latestVersion?.content ?? "",
      });

      return {
        documentId: input.documentId,
        versionId,
        versionNumber,
      };
    },
    async deleteProjectDocument(input) {
      store.deleteDocument(input.documentId);
    },
    async prepareDocumentUpload(input) {
      const intentId = createDocumentMutationId();
      return {
        uploadIntentId: intentId,
        bucket: "browser-local",
        objectPath: `projects/${input.projectId}/documents/${intentId}/${input.clientFilename}`,
        filename: input.clientFilename,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
      };
    },
    async finalizeDocumentUpload(uploadIntentId) {
      return {
        documentId: createDocumentMutationId(),
        documentVersionId: createDocumentMutationId(),
        storageObjectId: createDocumentMutationId(),
        projectId: "",
        bucket: "browser-local",
        objectPath: `browser/${uploadIntentId}`,
        filename: "file",
      };
    },
    async prepareMediaUpload(input) {
      const intentId = createDocumentMutationId();
      return {
        uploadIntentId: intentId,
        bucket: "browser-local",
        objectPath: `projects/${input.projectId}/media/${intentId}/${input.clientFilename}`,
        filename: input.clientFilename,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
      };
    },
    async finalizeMediaUpload(uploadIntentId) {
      return {
        projectMediaId: createDocumentMutationId(),
        storageObjectId: createDocumentMutationId(),
        projectId: "",
        bucket: "browser-local",
        objectPath: `browser/${uploadIntentId}`,
        filename: "file",
      };
    },
    async uploadBytes() {
      // no-op in browser/demo mode
    },
    async deleteProjectMedia(input) {
      store.deleteMedia(input.mediaId);
    },
    async updateProjectMediaCaption(input) {
      store.updateMedia(input.mediaId, { caption: input.caption ?? "" });
    },
  };
}

export function mapDocumentVersionRowToDocumentVersion(
  row: DocumentVersionRow,
  input: {
    hasCurrentVersion: boolean;
    archivedVersionId: string | null;
    storageObject?: StorageObjectRow;
  },
): DocumentVersion {
  const storage = input.storageObject
    ? storageObjectRowToMeta(input.storageObject)
    : undefined;

  return {
    id: row.id,
    document_id: row.document_id,
    number: row.version_number,
    status: input.archivedVersionId === row.id
      ? "archived"
      : input.hasCurrentVersion && row.is_current
        ? "draft"
        : "draft",
    content: "",
    storage,
  };
}

export function mapDocumentRowToDocument(
  row: DocumentRow,
  versions: DocumentVersion[],
  currentVersionStorage?: StorageObjectMeta,
): Document {
  const fileMeta = currentVersionStorage
    ? {
        filename: currentVersionStorage.filename,
        mime: currentVersionStorage.mimeType ?? "application/octet-stream",
        size: currentVersionStorage.sizeBytes ?? 0,
      }
    : undefined;

  return {
    id: row.id,
    project_id: row.project_id,
    type: row.type,
    title: row.title,
    versions,
    origin: row.origin ?? undefined,
    description: row.description ?? undefined,
    created_at: row.created_at,
    visibility_class: row.visibility_class,
    file_meta: fileMeta,
    ai_flags: undefined,
  };
}

export function shapeDocumentsWithVersions(input: {
  documentRows: DocumentRow[];
  versionRows: DocumentVersionRow[];
  storageObjectsById?: Map<string, StorageObjectRow>;
}): Document[] {
  const storageObjects = input.storageObjectsById ?? new Map<string, StorageObjectRow>();
  const versionRowsByDocumentId = new Map<string, DocumentVersionRow[]>();

  for (const row of input.versionRows) {
    const versions = versionRowsByDocumentId.get(row.document_id) ?? [];
    versions.push(row);
    versionRowsByDocumentId.set(row.document_id, versions);
  }

  for (const versionRows of versionRowsByDocumentId.values()) {
    versionRows.sort((left, right) => left.version_number - right.version_number);
  }

  return input.documentRows.flatMap((row) => {
    const versionRows = versionRowsByDocumentId.get(row.id) ?? [];
    if (versionRows.length === 0) {
      return [];
    }

    const hasCurrentVersion = versionRows.some((entry) => entry.is_current);
    const archivedVersionId = hasCurrentVersion
      ? null
      : versionRows[versionRows.length - 1]?.id ?? null;
    // An archived document has no current version; the file it still points at
    // is the one its archive marker carries, so file_meta keeps resolving. Markers
    // written before the #243 fix carry a null storage link, so fall back to the
    // newest version that actually has one - the newest file the document actually
    // materialized (the current version at archive time, unless its upload never
    // finalized). It heals documents archived before the fix shipped.
    const fileVersionRow = versionRows.find((entry) => entry.is_current)
      ?? [...versionRows].reverse().find((entry) => entry.storage_object_id != null)
      ?? versionRows[versionRows.length - 1];
    const currentVersionStorageRow = fileVersionRow?.storage_object_id
      ? storageObjects.get(fileVersionRow.storage_object_id)
      : undefined;

    const versions = versionRows.map((versionRow) => {
      const versionStorageRow = versionRow.storage_object_id
        ? storageObjects.get(versionRow.storage_object_id)
        : undefined;

      return mapDocumentVersionRowToDocumentVersion(
        versionRow,
        {
          hasCurrentVersion,
          archivedVersionId,
          storageObject: versionStorageRow,
        },
      );
    });

    const currentVersionStorage = currentVersionStorageRow
      ? storageObjectRowToMeta(currentVersionStorageRow)
      : undefined;

    return [mapDocumentRowToDocument(row, versions, currentVersionStorage)];
  });
}

export function mapProjectMediaRowToMedia(
  row: ProjectMediaRow,
  storageObject?: StorageObjectRow,
): Media {
  const storage = storageObject
    ? storageObjectRowToMeta(storageObject)
    : undefined;
  const fileMeta = storageObject
    ? {
        filename: storageObject.filename,
        mime: storageObject.mime_type ?? "application/octet-stream",
        size: storageObject.size_bytes ?? 0,
      }
    : undefined;

  return {
    id: row.id,
    project_id: row.project_id,
    task_id: row.task_id ?? undefined,
    uploader_id: row.uploaded_by ?? "",
    caption: row.caption ?? "",
    description: undefined,
    is_final: row.is_final,
    created_at: row.created_at,
    visibility_class: row.visibility_class,
    file_meta: fileMeta,
    storage,
  };
}

interface PrepareUploadRpcRow {
  upload_intent_id: string;
  bucket: string;
  object_path: string;
  filename: string;
  mime_type: string | null;
  size_bytes: number | null;
}

interface FinalizeDocumentUploadRpcRow {
  document_id: string;
  document_version_id: string;
  storage_object_id: string;
  project_id: string;
  bucket: string;
  object_path: string;
  filename: string;
}

interface FinalizeMediaUploadRpcRow {
  project_media_id: string;
  storage_object_id: string;
  project_id: string;
  bucket: string;
  object_path: string;
  filename: string;
}

async function loadSupabaseClient(): Promise<TypedSupabaseClient> {
  const { supabase } = await import("@/integrations/supabase/client");
  return supabase as unknown as TypedSupabaseClient;
}

export function storageObjectRowToMeta(row: StorageObjectRow): StorageObjectMeta {
  return {
    id: row.id,
    bucket: row.bucket,
    objectPath: row.object_path,
    filename: row.filename,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
  };
}

async function fetchStorageObjectsByIds(
  supabase: TypedSupabaseClient,
  ids: string[],
): Promise<Map<string, StorageObjectRow>> {
  const map = new Map<string, StorageObjectRow>();
  if (ids.length === 0) {
    return map;
  }

  const { data, error } = await supabase
    .from("storage_objects")
    .select("*")
    .in("id", ids);

  if (error) {
    throw error;
  }

  for (const row of data ?? []) {
    map.set(row.id, row);
  }

  return map;
}

async function getDocumentVersionRows(
  supabase: TypedSupabaseClient,
  documentId: string,
): Promise<DocumentVersionRow[]> {
  const { data, error } = await supabase
    .from("document_versions")
    .select("*")
    .eq("document_id", documentId)
    .order("version_number", { ascending: true });

  if (error) {
    throw error;
  }

  return data ?? [];
}

async function clearCurrentDocumentVersions(
  supabase: TypedSupabaseClient,
  documentId: string,
): Promise<void> {
  const update: DocumentVersionUpdate = {
    is_current: false,
  };

  const { error } = await supabase
    .from("document_versions")
    .update(update)
    .eq("document_id", documentId)
    .eq("is_current", true);

  if (error) {
    throw error;
  }
}

export async function createSupabaseProjectDocument(
  supabase: TypedSupabaseClient,
  profileId: string,
  input: CreateProjectDocumentInput,
): Promise<ProjectDocumentMutationResult> {
  const documentId = createDocumentMutationId();
  const versionId = createDocumentMutationId();
  const documentInsert: DocumentInsert = {
    id: documentId,
    project_id: input.projectId,
    type: input.type,
    title: input.title,
    origin: input.origin ?? "manual",
    description: input.description ?? null,
    created_by: profileId,
    visibility_class: input.visibilityClass ?? "shared_project",
  };

  const { error: documentError } = await supabase
    .from("documents")
    .insert(documentInsert);

  if (documentError) {
    throw documentError;
  }

  const versionInsert: DocumentVersionInsert = {
    id: versionId,
    document_id: documentId,
    version_number: 1,
    is_current: true,
    created_by: profileId,
  };

  const { error: versionError } = await supabase
    .from("document_versions")
    .insert(versionInsert);

  if (versionError) {
    throw versionError;
  }

  return {
    documentId,
    versionId,
    versionNumber: 1,
  };
}

export async function createSupabaseProjectDocumentVersion(
  supabase: TypedSupabaseClient,
  profileId: string,
  input: CreateProjectDocumentVersionInput,
): Promise<ProjectDocumentMutationResult> {
  const versionRows = await getDocumentVersionRows(supabase, input.documentId);
  if (versionRows.length === 0) {
    throw new Error("Document version history not found.");
  }

  const versionNumber = versionRows[versionRows.length - 1].version_number + 1;
  const versionId = createDocumentMutationId();

  await clearCurrentDocumentVersions(supabase, input.documentId);

  const versionInsert: DocumentVersionInsert = {
    id: versionId,
    document_id: input.documentId,
    version_number: versionNumber,
    is_current: true,
    created_by: profileId,
  };

  const { error } = await supabase
    .from("document_versions")
    .insert(versionInsert);

  if (error) {
    throw error;
  }

  return {
    documentId: input.documentId,
    versionId,
    versionNumber,
  };
}

export async function archiveSupabaseProjectDocument(
  supabase: TypedSupabaseClient,
  profileId: string,
  input: ArchiveProjectDocumentInput,
): Promise<ProjectDocumentMutationResult> {
  const versionRows = await getDocumentVersionRows(supabase, input.documentId);
  if (versionRows.length === 0) {
    throw new Error("Document version history not found.");
  }

  const versionNumber = versionRows[versionRows.length - 1].version_number + 1;
  const versionId = createDocumentMutationId();

  // The marker becomes the newest version, so it has to carry the file forward:
  // without the link, preview, download and the filename all go dead for a
  // document the user only meant to tidy away. (The demo path carries the
  // previous version's content forward the same way.) Prefer the newest version
  // that actually has a storage link (the newest file the document actually
  // materialized), so re-archiving a document whose previous marker predates the
  // #243 fix copies the real file, not the marker's null.
  const outgoingVersion = versionRows.find((entry) => entry.is_current)
    ?? [...versionRows].reverse().find((entry) => entry.storage_object_id != null)
    ?? versionRows[versionRows.length - 1];

  await clearCurrentDocumentVersions(supabase, input.documentId);

  const versionInsert: DocumentVersionInsert = {
    id: versionId,
    document_id: input.documentId,
    storage_object_id: outgoingVersion.storage_object_id,
    version_number: versionNumber,
    is_current: false,
    created_by: profileId,
  };

  const { error } = await supabase
    .from("document_versions")
    .insert(versionInsert);

  if (error) {
    throw error;
  }

  return {
    documentId: input.documentId,
    versionId,
    versionNumber,
  };
}

export async function deleteSupabaseProjectDocument(
  supabase: TypedSupabaseClient,
  input: DeleteProjectDocumentInput,
): Promise<void> {
  const { error } = await supabase
    .from("documents")
    .delete()
    .eq("id", input.documentId);

  if (error) {
    throw error;
  }
}

export async function prepareSupabaseDocumentUpload(
  supabase: TypedSupabaseClient,
  input: PrepareDocumentUploadInput,
): Promise<PrepareUploadResult> {
  const { data, error } = await supabase.rpc("prepare_document_upload", {
    p_project_id: input.projectId,
    p_type: input.type,
    p_title: input.title,
    p_client_filename: input.clientFilename,
    p_mime_type: input.mimeType,
    p_size_bytes: input.sizeBytes,
    p_description: input.description ?? null,
    p_visibility_class: input.visibilityClass ?? "shared_project",
  });

  if (error) {
    throw error;
  }

  const rows = data as unknown as PrepareUploadRpcRow[];
  if (!rows || rows.length === 0) {
    throw new Error("prepare_document_upload returned no rows.");
  }

  const row = rows[0];
  return {
    uploadIntentId: row.upload_intent_id,
    bucket: row.bucket,
    objectPath: row.object_path,
    filename: row.filename,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
  };
}

export async function finalizeSupabaseDocumentUpload(
  supabase: TypedSupabaseClient,
  uploadIntentId: string,
): Promise<FinalizeDocumentUploadResult> {
  const { data, error } = await supabase.rpc("finalize_document_upload", {
    p_upload_intent_id: uploadIntentId,
  });

  if (error) {
    throw error;
  }

  const rows = data as unknown as FinalizeDocumentUploadRpcRow[];
  if (!rows || rows.length === 0) {
    throw new Error("finalize_document_upload returned no rows.");
  }

  const row = rows[0];
  return {
    documentId: row.document_id,
    documentVersionId: row.document_version_id,
    storageObjectId: row.storage_object_id,
    projectId: row.project_id,
    bucket: row.bucket,
    objectPath: row.object_path,
    filename: row.filename,
  };
}

export async function prepareSupabaseMediaUpload(
  supabase: TypedSupabaseClient,
  input: PrepareMediaUploadInput,
): Promise<PrepareUploadResult> {
  let { data, error } = await supabase.rpc("prepare_project_media_upload", {
    p_project_id: input.projectId,
    p_media_type: input.mediaType,
    p_client_filename: input.clientFilename,
    p_mime_type: input.mimeType,
    p_size_bytes: input.sizeBytes,
    p_caption: input.caption ?? null,
    p_task_id: input.taskId ?? null,
    p_is_final: input.isFinal ?? false,
    p_visibility_class: input.visibilityClass ?? "shared_project",
  });

  const shouldRetryWithLegacyPrepareSignature = Boolean(
    error
      && (error as { code?: string }).code === "PGRST202"
      && error.message.includes("prepare_project_media_upload")
      && error.message.includes("p_task_id"),
  );
  if (shouldRetryWithLegacyPrepareSignature) {
    const retry = await supabase.rpc("prepare_project_media_upload", {
      p_project_id: input.projectId,
      p_media_type: input.mediaType,
      p_client_filename: input.clientFilename,
      p_mime_type: input.mimeType,
      p_size_bytes: input.sizeBytes,
      p_caption: input.caption ?? null,
    } as DocumentsMediaDatabase["public"]["Functions"]["prepare_project_media_upload"]["Args"]);
    data = retry.data;
    error = retry.error;
  }

  if (error) {
    throw error;
  }

  const rows = data as unknown as PrepareUploadRpcRow[];
  if (!rows || rows.length === 0) {
    throw new Error("prepare_project_media_upload returned no rows.");
  }

  const row = rows[0];
  return {
    uploadIntentId: row.upload_intent_id,
    bucket: row.bucket,
    objectPath: row.object_path,
    filename: row.filename,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
  };
}

export async function deleteSupabaseProjectMedia(
  supabase: TypedSupabaseClient,
  input: DeleteProjectMediaInput,
): Promise<void> {
  const { error } = await supabase
    .from("project_media")
    .delete()
    .eq("id", input.mediaId);

  if (error) {
    throw error;
  }
}

export async function updateSupabaseProjectMediaCaption(
  supabase: TypedSupabaseClient,
  input: UpdateProjectMediaCaptionInput,
): Promise<void> {
  const { error } = await supabase
    .from("project_media")
    .update({ caption: input.caption })
    .eq("id", input.mediaId);

  if (error) {
    throw error;
  }
}

export async function finalizeSupabaseMediaUpload(
  supabase: TypedSupabaseClient,
  uploadIntentId: string,
  options?: { taskId?: string; isFinal?: boolean },
): Promise<FinalizeMediaUploadResult> {
  let { data, error } = await supabase.rpc("finalize_project_media_upload", {
    p_upload_intent_id: uploadIntentId,
    p_task_id: options?.taskId ?? null,
    p_is_final: options?.isFinal ?? false,
  });

  const shouldRetryWithLegacyFinalizeSignature = Boolean(
    error
      && (error as { code?: string }).code === "PGRST202"
      && error.message.includes("finalize_project_media_upload")
      && error.message.includes("p_task_id"),
  );
  if (shouldRetryWithLegacyFinalizeSignature) {
    const retry = await supabase.rpc("finalize_project_media_upload", {
      p_upload_intent_id: uploadIntentId,
    } as DocumentsMediaDatabase["public"]["Functions"]["finalize_project_media_upload"]["Args"]);
    data = retry.data;
    error = retry.error;
  }

  if (error) {
    throw error;
  }

  const rows = data as unknown as FinalizeMediaUploadRpcRow[];
  if (!rows || rows.length === 0) {
    throw new Error("finalize_project_media_upload returned no rows.");
  }

  const row = rows[0];
  return {
    projectMediaId: row.project_media_id,
    storageObjectId: row.storage_object_id,
    projectId: row.project_id,
    bucket: row.bucket,
    objectPath: row.object_path,
    filename: row.filename,
  };
}

export function createSupabaseDocumentsMediaSource(
  supabase: TypedSupabaseClient,
  profileId: string,
): DocumentsMediaSource {
  return {
    mode: "supabase",
    async getProjectDocuments(projectId: string) {
      const { data: documentRows, error: documentsError } = await supabase
        .from("documents")
        .select("*")
        .eq("project_id", projectId)
        .order("created_at", { ascending: true });

      if (documentsError) {
        throw documentsError;
      }

      const rows = documentRows ?? [];
      if (rows.length === 0) {
        return [];
      }

      const documentIds = rows.map((row) => row.id);
      const { data: versionRows, error: versionsError } = await supabase
        .from("document_versions")
        .select("*")
        .in("document_id", documentIds)
        .order("version_number", { ascending: true });

      if (versionsError) {
        throw versionsError;
      }

      const allVersionRows = versionRows ?? [];
      const storageObjectIds = allVersionRows
        .map((row) => row.storage_object_id)
        .filter((id): id is string => id != null);
      const storageObjectsById = await fetchStorageObjectsByIds(supabase, storageObjectIds);

      return shapeDocumentsWithVersions({
        documentRows: rows,
        versionRows: allVersionRows,
        storageObjectsById,
      });
    },

    async getProjectMedia(projectId: string) {
      const { data, error } = await supabase
        .from("project_media")
        .select("*")
        .eq("project_id", projectId)
        .order("created_at", { ascending: true });

      if (error) {
        throw error;
      }

      const mediaRows = data ?? [];
      const storageObjectIds = mediaRows
        .map((row) => row.storage_object_id)
        .filter((id): id is string => id != null && id !== "");
      const storageObjectsById = await fetchStorageObjectsByIds(supabase, storageObjectIds);

      // Diagnostic: when a media row references a storage_object_id but the
      // storage_objects SELECT returned no matching row, the gallery silently
      // renders a placeholder. Surface that case so RLS or replica-lag bugs
      // are visible in the console.
      const missing = storageObjectIds.filter((id) => !storageObjectsById.has(id));
      if (missing.length > 0) {
        // eslint-disable-next-line no-console
        console.warn("[project-media] storage_objects rows missing for media", {
          projectId,
          missingStorageObjectIds: missing,
          expected: storageObjectIds.length,
          received: storageObjectsById.size,
        });
      }

      return mediaRows.map((row) =>
        mapProjectMediaRowToMedia(row, storageObjectsById.get(row.storage_object_id)),
      );
    },
    async createProjectDocument(input) {
      return createSupabaseProjectDocument(supabase, profileId, input);
    },
    async createProjectDocumentVersion(input) {
      return createSupabaseProjectDocumentVersion(supabase, profileId, input);
    },
    async archiveProjectDocument(input) {
      return archiveSupabaseProjectDocument(supabase, profileId, input);
    },
    async deleteProjectDocument(input) {
      return deleteSupabaseProjectDocument(supabase, input);
    },
    async prepareDocumentUpload(input) {
      return prepareSupabaseDocumentUpload(supabase, input);
    },
    async finalizeDocumentUpload(uploadIntentId) {
      return finalizeSupabaseDocumentUpload(supabase, uploadIntentId);
    },
    async prepareMediaUpload(input) {
      return prepareSupabaseMediaUpload(supabase, input);
    },
    async finalizeMediaUpload(uploadIntentId, options) {
      return finalizeSupabaseMediaUpload(supabase, uploadIntentId, options);
    },
    async uploadBytes(bucket, objectPath, file) {
      const { error } = await (supabase as unknown as SupabaseClient).storage
        .from(bucket)
        .upload(objectPath, file, {
          contentType: file.type,
          upsert: false,
        });

      if (error) {
        throw error;
      }
    },
    async deleteProjectMedia(input) {
      return deleteSupabaseProjectMedia(supabase, input);
    },
    async updateProjectMediaCaption(input) {
      return updateSupabaseProjectMediaCaption(supabase, input);
    },
  };
}

export async function getDocumentsMediaSource(
  mode?: WorkspaceMode,
): Promise<DocumentsMediaSource> {
  const resolvedMode = mode ?? await resolveWorkspaceMode();
  if (resolvedMode.kind !== "supabase") {
    return createBrowserDocumentsMediaSource(resolvedMode.kind);
  }

  const supabase = await loadSupabaseClient();
  return createSupabaseDocumentsMediaSource(supabase, resolvedMode.profileId);
}

export async function createProjectDocument(
  mode: WorkspaceMode,
  input: CreateProjectDocumentInput,
): Promise<ProjectDocumentMutationResult> {
  const source = await getDocumentsMediaSource(mode);
  return source.createProjectDocument(input);
}

export async function createProjectDocumentVersion(
  mode: WorkspaceMode,
  input: CreateProjectDocumentVersionInput,
): Promise<ProjectDocumentMutationResult> {
  const source = await getDocumentsMediaSource(mode);
  return source.createProjectDocumentVersion(input);
}

export async function archiveProjectDocument(
  mode: WorkspaceMode,
  input: ArchiveProjectDocumentInput,
): Promise<ProjectDocumentMutationResult> {
  const source = await getDocumentsMediaSource(mode);
  return source.archiveProjectDocument(input);
}

export async function deleteProjectDocument(
  mode: WorkspaceMode,
  input: DeleteProjectDocumentInput,
): Promise<void> {
  const source = await getDocumentsMediaSource(mode);
  return source.deleteProjectDocument(input);
}

export async function prepareDocumentUpload(
  mode: WorkspaceMode,
  input: PrepareDocumentUploadInput,
): Promise<PrepareUploadResult> {
  const source = await getDocumentsMediaSource(mode);
  return source.prepareDocumentUpload(input);
}

export async function finalizeDocumentUpload(
  mode: WorkspaceMode,
  uploadIntentId: string,
): Promise<FinalizeDocumentUploadResult> {
  const source = await getDocumentsMediaSource(mode);
  return source.finalizeDocumentUpload(uploadIntentId);
}

export async function prepareMediaUpload(
  mode: WorkspaceMode,
  input: PrepareMediaUploadInput,
): Promise<PrepareUploadResult> {
  const source = await getDocumentsMediaSource(mode);
  return source.prepareMediaUpload(input);
}

export async function finalizeMediaUpload(
  mode: WorkspaceMode,
  uploadIntentId: string,
  options?: { taskId?: string; isFinal?: boolean },
): Promise<FinalizeMediaUploadResult> {
  const source = await getDocumentsMediaSource(mode);
  return source.finalizeMediaUpload(uploadIntentId, options);
}

export async function uploadBytes(
  mode: WorkspaceMode,
  bucket: string,
  objectPath: string,
  file: File,
): Promise<void> {
  const source = await getDocumentsMediaSource(mode);
  return source.uploadBytes(bucket, objectPath, file);
}

export async function deleteProjectMedia(
  mode: WorkspaceMode,
  input: DeleteProjectMediaInput,
): Promise<void> {
  const source = await getDocumentsMediaSource(mode);
  return source.deleteProjectMedia(input);
}

export async function updateProjectMediaCaption(
  mode: WorkspaceMode,
  input: UpdateProjectMediaCaptionInput,
): Promise<void> {
  const source = await getDocumentsMediaSource(mode);
  return source.updateProjectMediaCaption(input);
}
