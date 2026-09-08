import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

// The document_shares table and its RPCs land in the generated Database type
// only after the rovno-db migration (20260908120000_document_shares) is on dev
// and the backend-truth sync PR regenerates supabase-types.ts. Until then use
// the untyped client, the same way estimate-share-source.ts does.
const rawSupabase = supabase as unknown as SupabaseClient;

export interface DocumentShare {
  documentId: string;
  shareToken: string;
  createdAt: string;
}

interface DocumentShareRow {
  document_id: string;
  share_token: string;
  created_at: string;
}

function rowToShare(row: DocumentShareRow): DocumentShare {
  return {
    documentId: row.document_id,
    shareToken: row.share_token,
    createdAt: row.created_at,
  };
}

/** Owner / co_owner only (the RPC raises 42501 otherwise). Idempotent while a token is live. */
export async function createDocumentShare(documentId: string): Promise<DocumentShare> {
  const { data, error } = await rawSupabase.rpc("create_document_share", {
    p_document_id: documentId,
  });
  if (error) throw error;
  if (data == null) {
    throw new Error("create_document_share returned no row");
  }
  return rowToShare(data as DocumentShareRow);
}

/** True when an active share existed and was withdrawn. */
export async function revokeDocumentShare(documentId: string): Promise<boolean> {
  const { data, error } = await rawSupabase.rpc("revoke_document_share", {
    p_document_id: documentId,
  });
  if (error) throw error;
  return data === true;
}

/** Active shares of a project. Empty for anyone who is not owner / co_owner. */
export async function listDocumentShares(projectId: string): Promise<DocumentShare[]> {
  const { data, error } = await rawSupabase.rpc("list_document_shares", {
    p_project_id: projectId,
  });
  if (error) throw error;
  if (!Array.isArray(data)) return [];
  return (data as DocumentShareRow[]).map(rowToShare);
}

export function buildDocumentShareLink(shareToken: string): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}/share/document/${shareToken}`;
}

/** What the get-shared-document Edge Function returns for a live token. */
export interface SharedDocumentFile {
  title: string;
  filename: string;
  mimeType: string | null;
  sizeBytes: number | null;
  signedUrl: string;
  /** ISO timestamp; the signed URL must not be used after it. */
  expiresAt: string;
}

function isSharedDocumentFile(value: unknown): value is SharedDocumentFile {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return typeof row.title === "string"
    && typeof row.filename === "string"
    && typeof row.signedUrl === "string"
    && typeof row.expiresAt === "string";
}

function invokeFailureStatus(error: unknown): number | null {
  if (error && typeof error === "object" && "context" in error) {
    const ctx = (error as { context?: unknown }).context;
    if (typeof Response !== "undefined" && ctx instanceof Response) {
      return ctx.status;
    }
  }
  return null;
}

/**
 * Resolve a public share token into a downloadable file description.
 *
 * Returns null for every "this link does not work" answer: an unknown, revoked
 * or malformed token, a document reclassified to internal, an archived one.
 * The function deliberately gives one 404 for all of them, and a malformed
 * token is a 400 that means the same thing to the visitor. Anything else
 * (network, 5xx) is thrown so the page can distinguish "gone" from "try again".
 */
export async function fetchSharedDocument(shareToken: string): Promise<SharedDocumentFile | null> {
  if (!shareToken) return null;
  const { data, error } = await rawSupabase.functions.invoke("get-shared-document", {
    body: { token: shareToken },
  });
  if (error) {
    const status = invokeFailureStatus(error);
    if (status === 404 || status === 400) return null;
    throw error instanceof Error ? error : new Error(String(error));
  }
  if (!isSharedDocumentFile(data)) return null;
  return data;
}
