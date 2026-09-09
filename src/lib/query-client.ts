import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { captureException } from "@/lib/observability/sentry";
import { shouldReportDataLayerError } from "@/lib/observability/data-layer-errors";

/**
 * Query keys whose REMAINING elements are a credential, not an id. On these
 * routes the token in the key IS the thing that grants access, so the key must
 * never reach the error tracker whole. The generic SCRUB_RULES cannot help
 * here: the value arrives outside any URL, and only the document-share token
 * has a shape distinctive enough to match on (48 lowercase hex). An estimate
 * share id and an invite token are an ordinary id and a UUID.
 *
 * Add a key here whenever a route's path segment is its credential — the same
 * set as the `secret: true` entries of ANALYTICS_ROUTES.
 */
const CREDENTIAL_QUERY_KEYS = new Set(["document-share", "estimate-share", "invite-token"]);

/** The key with its credential elements replaced, safe to attach to an event. */
export function redactQueryKey(queryKey: readonly unknown[]): unknown[] {
  const head = queryKey[0];
  if (typeof head !== "string" || !CREDENTIAL_QUERY_KEYS.has(head)) return [...queryKey];
  return [head, ...queryKey.slice(1).map(() => "[FILTERED]")];
}

/**
 * App-wide QueryClient singleton. Lives outside App.tsx so non-React session
 * hygiene (auth identity change → clear all cached account data) can reach it
 * without an import cycle through the component tree.
 */
export const queryClient = new QueryClient({
  // App-wide data-layer error reporting (Sentry). shouldReportDataLayerError
  // filters expected outcomes (aborts, tier-limit paywalls, offline query
  // retries) so this stays a defect signal, not noise.
  queryCache: new QueryCache({
    onError: (error, query) => {
      if (!shouldReportDataLayerError(error, "query")) return;
      // The queryKey head (resource/RPC name) goes into a TAG so Sentry alert
      // rules can match critical data sources (e.g. search_canonical_library).
      const keyHead = query.queryKey[0];
      captureException(error, {
        tags: {
          source: "react-query",
          kind: "query",
          query_key: typeof keyHead === "string" ? keyHead : "unknown",
        },
        extra: { queryKey: redactQueryKey(query.queryKey) },
      });
    },
  }),
  mutationCache: new MutationCache({
    onError: (error, _variables, _context, mutation) => {
      if (!shouldReportDataLayerError(error, "mutation")) return;
      captureException(error, {
        tags: { source: "react-query", kind: "mutation" },
        extra: { mutationKey: mutation.options.mutationKey },
      });
    },
  }),
  defaultOptions: {
    queries: {
      // Disabled app-wide on purpose: alt-tabbing back into a half-filled form (or any page)
      // must not refetch-and-reset it, which was a source of visible reload churn. Freshness is
      // preserved via explicit invalidateQueries after mutations + per-query staleTime/refetchInterval
      // (e.g. payment status and tier quota poll on their own). A query that genuinely needs
      // refresh-on-focus should opt back in locally with refetchOnWindowFocus: true.
      refetchOnWindowFocus: false,
    },
  },
});
