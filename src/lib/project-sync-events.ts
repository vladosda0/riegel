import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";

/**
 * P2 cross-session sync feed: one realtime channel per project on
 * project_sync_events INSERTs (the ledger is member-readable, so realtime RLS
 * never silently drops events the way detail-gated domain tables would).
 * Events are coalesced (default 250ms) before delivery; when the channel
 * degrades, a polling fallback (default 30s) keeps consumers converging and
 * the health state lets the UI say «обновления с задержкой» honestly.
 */

export type ProjectSyncEventKind =
  | "projection"
  | "estimate_draft"
  | "tasks"
  | "checklist"
  | "procurement"
  | "hr"
  | "hr_payments"
  | "members";

export interface ProjectSyncEventRow {
  id: number;
  project_id: string;
  kind: ProjectSyncEventKind;
  revision: string | null;
  actor_profile_id: string | null;
  created_at: string;
}

/**
 * connecting → initial subscribe in flight (no signal yet, not degraded).
 * live       → realtime channel delivering.
 * degraded   → channel down; the 30s poll is the delivery path.
 * unavailable→ pre-P2 backend (ledger table absent); feed permanently off.
 */
export type ProjectSyncFeedHealth = "connecting" | "live" | "degraded" | "unavailable";

export interface ProjectSyncFeedOptions {
  projectId: string;
  /** Coalesced batch, ordered by ledger id ascending, already deduped. */
  onEvents: (events: ProjectSyncEventRow[]) => void;
  onHealthChange?: (health: ProjectSyncFeedHealth) => void;
  coalesceMs?: number;
  pollIntervalMs?: number;
}

const DEFAULT_COALESCE_MS = 250;
const DEFAULT_POLL_INTERVAL_MS = 30_000;
const POLL_BATCH_LIMIT = 100;

// realtime-js keys its channel registry by topic and hands back the channel it
// already holds for one, so a reused topic can give a resubscribe the previous,
// still-registered channel instead of a fresh one (rovno#188).
let subscriptionSeq = 0;

function isMissingTableError(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return code === "42P01" || code === "PGRST205";
}

type UntypedClient = SupabaseClient;

async function loadClient(): Promise<UntypedClient> {
  const { supabase } = await import("@/integrations/supabase/client");
  return supabase as unknown as UntypedClient;
}

export function subscribeToProjectSyncEvents(options: ProjectSyncFeedOptions): () => void {
  const coalesceMs = options.coalesceMs ?? DEFAULT_COALESCE_MS;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;

  let disposed = false;
  let channel: RealtimeChannel | null = null;
  let health: ProjectSyncFeedHealth = "connecting";
  // Highest ledger id already delivered (or present at subscribe time): the
  // poll fallback resumes from here, and late realtime duplicates drop out.
  let lastSeenId = 0;
  let pending = new Map<number, ProjectSyncEventRow>();
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let pollInFlight = false;

  const setHealth = (next: ProjectSyncFeedHealth) => {
    if (disposed || health === next) return;
    health = next;
    options.onHealthChange?.(next);
  };

  const flush = () => {
    flushTimer = null;
    if (disposed || pending.size === 0) return;
    const batch = [...pending.values()].sort((left, right) => left.id - right.id);
    pending = new Map();
    batch.forEach((event) => {
      lastSeenId = Math.max(lastSeenId, event.id);
    });
    options.onEvents(batch);
  };

  // `floor` defaults to the live cursor (realtime path). A poll passes the
  // cursor it CAPTURED when it built its query: a concurrent realtime flush may
  // advance lastSeenId past a row the poll fetched with the older cursor, and
  // dropping it against the advanced cursor would silently lose a row realtime
  // had NOT delivered. Delivering it against the poll's own floor recovers it;
  // any row realtime also delivered is deduped by pending.has (same window) or
  // is a harmless idempotent re-invalidation (later window). Residual: if
  // realtime advances the cursor BEFORE a poll builds its query, that poll's
  // `.gt(cursor)` skips the gap entirely — identity ids have permanent gaps
  // (rolled-back inserts), so the cursor cannot conservatively linger on them;
  // such a rare realtime-drop self-heals via the next event / focus refetch.
  const enqueue = (row: ProjectSyncEventRow, floor: number = lastSeenId) => {
    if (disposed || row.id <= floor || pending.has(row.id)) return;
    pending.set(row.id, row);
    if (!flushTimer) {
      flushTimer = setTimeout(flush, coalesceMs);
    }
  };

  const poll = async (client: UntypedClient) => {
    if (disposed || pollInFlight) return;
    pollInFlight = true;
    const pollFrom = lastSeenId; // capture before the await; flush may advance lastSeenId
    try {
      const { data, error } = await client
        .from("project_sync_events")
        .select("id, project_id, kind, revision, actor_profile_id, created_at")
        .eq("project_id", options.projectId)
        .gt("id", pollFrom)
        .order("id", { ascending: true })
        .limit(POLL_BATCH_LIMIT);
      if (error) {
        if (isMissingTableError(error)) {
          stopPolling();
          setHealth("unavailable");
        }
        return; // transient poll errors: stay degraded, retry next tick
      }
      (data ?? []).forEach((row) => enqueue(row as ProjectSyncEventRow, pollFrom));
    } catch {
      // Network failure: stay degraded, retry next tick.
    } finally {
      pollInFlight = false;
    }
  };

  const stopPolling = () => {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  };

  const startPolling = (client: UntypedClient) => {
    if (disposed || pollTimer || health === "unavailable") return;
    pollTimer = setInterval(() => {
      void poll(client);
    }, pollIntervalMs);
    void poll(client);
  };

  void (async () => {
    const client = await loadClient();
    if (disposed) return;

    // Baseline: never replay history that predates this subscription — the
    // page just fetched fresh data through its own queries.
    try {
      const { data, error } = await client
        .from("project_sync_events")
        .select("id")
        .eq("project_id", options.projectId)
        .order("id", { ascending: false })
        .limit(1);
      if (error) {
        if (isMissingTableError(error)) {
          setHealth("unavailable");
          return;
        }
      } else {
        lastSeenId = (data?.[0] as { id: number } | undefined)?.id ?? 0;
      }
    } catch {
      // Baseline fetch failed (offline): id 0 means the first poll/replay may
      // deliver older events; consumers only invalidate queries, so replays
      // are converging no-ops.
    }
    if (disposed) return;

    channel = client
      .channel(`project-sync:${options.projectId}:${++subscriptionSeq}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "project_sync_events",
          filter: `project_id=eq.${options.projectId}`,
        },
        (payload: { new: ProjectSyncEventRow }) => {
          enqueue(payload.new);
        },
      )
      .subscribe((status) => {
        if (disposed) return;
        if (status === "SUBSCRIBED") {
          stopPolling();
          setHealth("live");
          // Catch anything that landed while the channel was (re)connecting.
          void poll(client);
          return;
        }
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          setHealth("degraded");
          startPolling(client);
        }
      });
  })();

  return () => {
    disposed = true;
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    stopPolling();
    if (channel) {
      void channel.unsubscribe();
      channel = null;
    }
  };
}
