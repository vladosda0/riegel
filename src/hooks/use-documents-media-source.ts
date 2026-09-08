import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import * as store from "@/data/store";
import {
  archiveProjectDocument as archiveProjectDocumentSource,
  createProjectDocument as createProjectDocumentSource,
  createProjectDocumentVersion as createProjectDocumentVersionSource,
  deleteProjectDocument as deleteProjectDocumentSource,
  prepareDocumentUpload as prepareDocumentUploadSource,
  finalizeDocumentUpload as finalizeDocumentUploadSource,
  prepareMediaUpload as prepareMediaUploadSource,
  finalizeMediaUpload as finalizeMediaUploadSource,
  deleteProjectMedia as deleteProjectMediaSource,
  updateProjectMediaCaption as updateProjectMediaCaptionSource,
  updateProjectDocumentVisibility as updateProjectDocumentVisibilitySource,
  uploadBytes as uploadBytesSource,
  getDocumentsMediaSource,
  type ArchiveProjectDocumentInput,
  type UpdateProjectDocumentVisibilityInput,
  type CreateProjectDocumentInput,
  type CreateProjectDocumentVersionInput,
  type PrepareDocumentUploadInput,
  type PrepareMediaUploadInput,
  type PrepareUploadResult,
  type FinalizeDocumentUploadResult,
  type FinalizeMediaUploadResult,
} from "@/data/documents-media-source";
import { useWorkspaceMode } from "@/hooks/use-workspace-source";
import type { Document, Media } from "@/types/entities";

const DOCUMENTS_MEDIA_QUERY_STALE_TIME_MS = 60_000;
const EMPTY_PROJECT_DOCUMENTS: Document[] = [];
const EMPTY_PROJECT_MEDIA: Media[] = [];

export const documentsMediaQueryKeys = {
  projectDocuments: (profileId: string, projectId: string) =>
    ["documents-media", "project-documents", profileId, projectId] as const,
  projectMedia: (profileId: string, projectId: string) =>
    ["documents-media", "project-media", profileId, projectId] as const,
};

export interface ProjectDocumentsState {
  documents: Document[];
  isLoading: boolean;
}

function useStoreValue<T>(getter: () => T, enabled: boolean, fallback: T): T {
  const [value, setValue] = useState<T>(() => enabled ? getter() : fallback);

  useEffect(() => {
    if (!enabled) {
      setValue(fallback);
      return;
    }

    setValue(getter());
    const update = () => setValue(getter());
    return store.subscribe(update);
  }, [enabled, fallback, getter]);

  return enabled ? value : fallback;
}

export function useProjectDocumentsState(projectId: string): ProjectDocumentsState {
  const mode = useWorkspaceMode();
  const supabaseMode = mode.kind === "supabase" ? mode : null;
  const getDocuments = useCallback(() => store.getDocuments(projectId), [projectId]);
  const browserDocuments = useStoreValue(
    getDocuments,
    mode.kind === "demo" || mode.kind === "local",
    EMPTY_PROJECT_DOCUMENTS,
  );
  const documentsQuery = useQuery({
    queryKey: supabaseMode
      ? documentsMediaQueryKeys.projectDocuments(supabaseMode.profileId, projectId)
      : documentsMediaQueryKeys.projectDocuments("browser", projectId),
    queryFn: async () => {
      const source = await getDocumentsMediaSource(supabaseMode ?? undefined);
      return source.getProjectDocuments(projectId);
    },
    enabled: Boolean(supabaseMode && projectId),
    staleTime: DOCUMENTS_MEDIA_QUERY_STALE_TIME_MS,
  });

  if (mode.kind === "demo" || mode.kind === "local") {
    return {
      documents: browserDocuments,
      isLoading: false,
    };
  }

  if (mode.kind === "pending-supabase") {
    return {
      documents: EMPTY_PROJECT_DOCUMENTS,
      isLoading: true,
    };
  }

  return {
    documents: documentsQuery.data ?? EMPTY_PROJECT_DOCUMENTS,
    isLoading: documentsQuery.isPending,
  };
}

export function useProjectDocuments(projectId: string): Document[] {
  return useProjectDocumentsState(projectId).documents;
}

export function useProjectMedia(projectId: string): Media[] {
  const mode = useWorkspaceMode();
  const supabaseMode = mode.kind === "supabase" ? mode : null;
  const getMedia = useCallback(() => store.getMedia(projectId), [projectId]);
  const browserMedia = useStoreValue(
    getMedia,
    mode.kind === "demo" || mode.kind === "local",
    EMPTY_PROJECT_MEDIA,
  );
  const mediaQuery = useQuery({
    queryKey: supabaseMode
      ? documentsMediaQueryKeys.projectMedia(supabaseMode.profileId, projectId)
      : documentsMediaQueryKeys.projectMedia("browser", projectId),
    queryFn: async () => {
      const source = await getDocumentsMediaSource(supabaseMode ?? undefined);
      return source.getProjectMedia(projectId);
    },
    enabled: Boolean(supabaseMode && projectId),
    staleTime: DOCUMENTS_MEDIA_QUERY_STALE_TIME_MS,
  });

  if (mode.kind === "demo" || mode.kind === "local") {
    return browserMedia;
  }

  return mediaQuery.data ?? EMPTY_PROJECT_MEDIA;
}

function assertDocumentsMutationWorkspaceMode(
  mode: ReturnType<typeof useWorkspaceMode>,
) {
  if (mode.kind === "pending-supabase") {
    throw new Error("Supabase session is still loading.");
  }

  if (mode.kind === "guest") {
    throw new Error("An authenticated Supabase session is required.");
  }

  return mode;
}

export function useProjectDocumentMutations(projectId: string) {
  const mode = useWorkspaceMode();
  const queryClient = useQueryClient();

  const invalidateProjectDocuments = useCallback(async (resolvedMode: Extract<typeof mode, { kind: "supabase" }>) => {
    await queryClient.invalidateQueries({
      queryKey: documentsMediaQueryKeys.projectDocuments(resolvedMode.profileId, projectId),
    });
  }, [projectId, queryClient]);

  const createDocument = useCallback(async (
    input: Omit<CreateProjectDocumentInput, "projectId">,
  ) => {
    const resolvedMode = assertDocumentsMutationWorkspaceMode(mode);
    const created = await createProjectDocumentSource(resolvedMode, {
      ...input,
      projectId,
    });

    if (resolvedMode.kind === "supabase") {
      await invalidateProjectDocuments(resolvedMode);
    }

    return created;
  }, [invalidateProjectDocuments, mode, projectId]);

  const createDocumentVersion = useCallback(async (
    input: Omit<CreateProjectDocumentVersionInput, "projectId">,
  ) => {
    const resolvedMode = assertDocumentsMutationWorkspaceMode(mode);
    const created = await createProjectDocumentVersionSource(resolvedMode, {
      ...input,
      projectId,
    });

    if (resolvedMode.kind === "supabase") {
      await invalidateProjectDocuments(resolvedMode);
    }

    return created;
  }, [invalidateProjectDocuments, mode, projectId]);

  const archiveDocument = useCallback(async (
    input: Omit<ArchiveProjectDocumentInput, "projectId">,
  ) => {
    const resolvedMode = assertDocumentsMutationWorkspaceMode(mode);
    const created = await archiveProjectDocumentSource(resolvedMode, {
      ...input,
      projectId,
    });

    if (resolvedMode.kind === "supabase") {
      await invalidateProjectDocuments(resolvedMode);
    }

    return created;
  }, [invalidateProjectDocuments, mode, projectId]);

  const deleteDocument = useCallback(async (documentId: string) => {
    const resolvedMode = assertDocumentsMutationWorkspaceMode(mode);
    await deleteProjectDocumentSource(resolvedMode, {
      projectId,
      documentId,
    });

    if (resolvedMode.kind === "supabase") {
      await invalidateProjectDocuments(resolvedMode);
    }
  }, [invalidateProjectDocuments, mode, projectId]);

  const updateDocumentVisibility = useCallback(async (
    input: Omit<UpdateProjectDocumentVisibilityInput, "projectId">,
  ) => {
    const resolvedMode = assertDocumentsMutationWorkspaceMode(mode);
    await updateProjectDocumentVisibilitySource(resolvedMode, {
      ...input,
      projectId,
    });

    if (resolvedMode.kind === "supabase") {
      await invalidateProjectDocuments(resolvedMode);
    }
  }, [invalidateProjectDocuments, mode, projectId]);

  return {
    createDocument,
    createDocumentVersion,
    archiveDocument,
    deleteDocument,
    updateDocumentVisibility,
  };
}

export function useDocumentUploadMutations(projectId: string) {
  const mode = useWorkspaceMode();
  const queryClient = useQueryClient();

  const invalidateProjectDocuments = useCallback(async (resolvedMode: Extract<typeof mode, { kind: "supabase" }>) => {
    await queryClient.invalidateQueries({
      queryKey: documentsMediaQueryKeys.projectDocuments(resolvedMode.profileId, projectId),
    });
  }, [projectId, queryClient]);

  const prepareUpload = useCallback(async (
    input: Omit<PrepareDocumentUploadInput, "projectId">,
  ): Promise<PrepareUploadResult> => {
    const resolvedMode = assertDocumentsMutationWorkspaceMode(mode);
    return prepareDocumentUploadSource(resolvedMode, {
      ...input,
      projectId,
    });
  }, [mode, projectId]);

  const uploadBytes = useCallback(async (
    bucket: string,
    objectPath: string,
    file: File,
  ): Promise<void> => {
    const resolvedMode = assertDocumentsMutationWorkspaceMode(mode);
    return uploadBytesSource(resolvedMode, bucket, objectPath, file);
  }, [mode]);

  const finalizeUpload = useCallback(async (
    uploadIntentId: string,
  ): Promise<FinalizeDocumentUploadResult> => {
    const resolvedMode = assertDocumentsMutationWorkspaceMode(mode);
    const result = await finalizeDocumentUploadSource(resolvedMode, uploadIntentId);

    if (resolvedMode.kind === "supabase") {
      await invalidateProjectDocuments(resolvedMode);
    }

    return result;
  }, [invalidateProjectDocuments, mode]);

  return {
    prepareUpload,
    uploadBytes,
    finalizeUpload,
  };
}

export function useMediaUploadMutations(projectId: string) {
  const mode = useWorkspaceMode();
  const queryClient = useQueryClient();

  const invalidateProjectMedia = useCallback(async (resolvedMode: Extract<typeof mode, { kind: "supabase" }>) => {
    await queryClient.invalidateQueries({
      queryKey: documentsMediaQueryKeys.projectMedia(resolvedMode.profileId, projectId),
    });
  }, [projectId, queryClient]);

  const prepareUpload = useCallback(async (
    input: Omit<PrepareMediaUploadInput, "projectId">,
  ): Promise<PrepareUploadResult> => {
    const resolvedMode = assertDocumentsMutationWorkspaceMode(mode);
    return prepareMediaUploadSource(resolvedMode, {
      ...input,
      projectId,
    });
  }, [mode, projectId]);

  const uploadBytes = useCallback(async (
    bucket: string,
    objectPath: string,
    file: File,
  ): Promise<void> => {
    const resolvedMode = assertDocumentsMutationWorkspaceMode(mode);
    return uploadBytesSource(resolvedMode, bucket, objectPath, file);
  }, [mode]);

  const finalizeUpload = useCallback(async (
    uploadIntentId: string,
    options?: { taskId?: string; isFinal?: boolean },
  ): Promise<FinalizeMediaUploadResult> => {
    const resolvedMode = assertDocumentsMutationWorkspaceMode(mode);
    const result = await finalizeMediaUploadSource(resolvedMode, uploadIntentId, options);

    if (resolvedMode.kind === "supabase") {
      await invalidateProjectMedia(resolvedMode);
    }

    return result;
  }, [invalidateProjectMedia, mode]);

  return {
    prepareUpload,
    uploadBytes,
    finalizeUpload,
  };
}

export function useProjectMediaMutations(projectId: string) {
  const mode = useWorkspaceMode();
  const queryClient = useQueryClient();

  const invalidateProjectMedia = useCallback(async (resolvedMode: Extract<typeof mode, { kind: "supabase" }>) => {
    await queryClient.invalidateQueries({
      queryKey: documentsMediaQueryKeys.projectMedia(resolvedMode.profileId, projectId),
    });
  }, [projectId, queryClient]);

  const deleteMedia = useCallback(async (mediaId: string): Promise<void> => {
    const resolvedMode = assertDocumentsMutationWorkspaceMode(mode);
    await deleteProjectMediaSource(resolvedMode, { projectId, mediaId });

    if (resolvedMode.kind === "supabase") {
      await invalidateProjectMedia(resolvedMode);
    }
    // Browser modes mutate the in-memory store; useProjectMedia reads via
    // useStoreValue so the change re-renders automatically.
  }, [invalidateProjectMedia, mode, projectId]);

  const updateMediaCaption = useCallback(
    async (mediaId: string, caption: string): Promise<void> => {
      const resolvedMode = assertDocumentsMutationWorkspaceMode(mode);
      const normalized = caption.trim().length === 0 ? null : caption.trim();
      await updateProjectMediaCaptionSource(resolvedMode, {
        projectId,
        mediaId,
        caption: normalized,
      });
      if (resolvedMode.kind === "supabase") {
        await invalidateProjectMedia(resolvedMode);
      }
    },
    [invalidateProjectMedia, mode, projectId],
  );

  return { deleteMedia, updateMediaCaption };
}
