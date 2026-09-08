import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import {
  createDocumentShare,
  listDocumentShares,
  revokeDocumentShare,
  type DocumentShare,
} from "@/data/document-share-source";
import { useWorkspaceMode } from "@/hooks/use-workspace-source";

const DOCUMENT_SHARES_STALE_TIME_MS = 60_000;
const EMPTY_SHARES: DocumentShare[] = [];

export const documentShareQueryKeys = {
  project: (profileId: string, projectId: string) =>
    ["document-shares", profileId, projectId] as const,
};

export interface DocumentSharesState {
  /** Active share per document id. Empty until loaded, and for roles that cannot share. */
  sharesByDocumentId: Map<string, DocumentShare>;
  isLoading: boolean;
}

/**
 * Active public links of a project, keyed by document id.
 *
 * Only owners / co-owners can mint links, and the RPC hands an empty array to
 * everyone else, so callers pass `enabled: false` for other roles to skip the
 * round trip entirely. Supabase mode only: local / demo documents have no
 * storage object to share.
 */
export function useDocumentShares(
  projectId: string,
  options: { enabled?: boolean } = {},
): DocumentSharesState {
  const mode = useWorkspaceMode();
  const supabaseMode = mode.kind === "supabase" ? mode : null;
  const enabled = Boolean(supabaseMode && projectId && (options.enabled ?? true));

  const query = useQuery({
    queryKey: documentShareQueryKeys.project(supabaseMode?.profileId ?? "browser", projectId),
    queryFn: () => listDocumentShares(projectId),
    enabled,
    staleTime: DOCUMENT_SHARES_STALE_TIME_MS,
  });

  const shares = enabled ? query.data ?? EMPTY_SHARES : EMPTY_SHARES;
  const sharesByDocumentId = useMemo(
    () => new Map(shares.map((share) => [share.documentId, share])),
    [shares],
  );

  return {
    sharesByDocumentId,
    isLoading: enabled && query.isPending,
  };
}

export function useDocumentShareMutations(projectId: string) {
  const mode = useWorkspaceMode();
  const queryClient = useQueryClient();
  const profileId = mode.kind === "supabase" ? mode.profileId : "browser";
  const queryKey = documentShareQueryKeys.project(profileId, projectId);

  const create = useMutation({
    mutationFn: (documentId: string) => createDocumentShare(documentId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey });
    },
  });

  const revoke = useMutation({
    mutationFn: (documentId: string) => revokeDocumentShare(documentId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey });
    },
  });

  return { create, revoke };
}
