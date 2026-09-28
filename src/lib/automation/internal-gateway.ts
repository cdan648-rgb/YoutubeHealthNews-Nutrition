/**
 * The automation worker's gateway to the private `internal` schema. SERVER ONLY.
 *
 * WHY THIS EXISTS
 * ---------------
 * `internal` is deliberately kept off PostgREST's exposed-schema allowlist, so the
 * service-role key — which bypasses RLS but NOT that allowlist — cannot reach it
 * through the Data API. A client configured `db: { schema: 'internal' }` therefore
 * fails every call with `Invalid schema: internal` (first seen as the tick's
 * "settings read failed").
 *
 * Every operation the daily tick needs is instead exposed as a narrowly scoped
 * SECURITY DEFINER function in the already-public `public` schema, callable only by
 * `service_role` (see migration `..._automation_public_rpc.sql`). This module is the
 * one place that calls them. `internal` stays entirely private.
 *
 * The `automation_*` functions are not in the generated `public` types (they wrap the
 * private schema on purpose), so `.rpc` is reached through a single, explicitly typed
 * view of the service client rather than the generated overloads. Everything past that
 * boundary is fully typed by the row shapes below — no `any`.
 */
import 'server-only';

import { serviceClient } from '@/lib/supabase/service';
import type { HanoiDate } from '@/lib/time';

/** The subset of a PostgREST error this module surfaces. */
type RpcError = { message: string; code?: string } | null;

/** A minimally typed view of the service client's `.rpc`, for the automation_* wrappers. */
type RpcCaller = <T>(
  name: string,
  args?: Record<string, unknown>,
) => PromiseLike<{ data: T | null; error: RpcError }>;

function callRpc(): RpcCaller {
  // Cast through `unknown` (never `any`): the generated overloads only know the public
  // functions, and these wrappers are intentionally absent from them. The call is kept on
  // the client object so supabase-js keeps its `this` binding.
  const client = serviceClient() as unknown as { rpc: RpcCaller };
  return <T>(name: string, args?: Record<string, unknown>) => client.rpc<T>(name, args);
}

async function one<T>(name: string, args?: Record<string, unknown>): Promise<T | null> {
  const { data, error } = await callRpc()<T>(name, args);
  if (error !== null) throw new Error(`${name} failed: ${error.message}`);
  return data;
}

async function rows<T>(name: string, args?: Record<string, unknown>): Promise<T[]> {
  const { data, error } = await callRpc()<T[]>(name, args);
  if (error !== null) throw new Error(`${name} failed: ${error.message}`);
  return data ?? [];
}

/* --------------------------------- row shapes ---------------------------------- */

export type VideoStatus = 'available' | 'selected' | 'used' | 'ineligible';

export type RunResultValue =
  | 'running'
  | 'published'
  | 'research_published'
  | 'no_source'
  | 'validation_failed'
  | 'failed'
  | 'expired'
  | 'skipped_window';

export type SourceKindValue = 'youtube' | 'research' | 'none';

export type AutomationSettingsView = {
  readonly timezone: string;
  readonly publishHourLocal: number;
  readonly publishWindowEndHour: number;
  readonly abandonHourLocal: number;
  readonly noSourceThreshold: number;
  readonly freshWindowDays: number;
  readonly requireApproval: boolean;
  readonly paused: boolean;
  readonly dryRun: boolean;
  readonly dailySendCap: number;
  readonly boilerplateMarkers: string[];
  readonly restrictedTopics: string[];
  readonly allowedReferenceHosts: string[];
  readonly journalTiers: Record<string, unknown> | null;
};

export type RunView = {
  readonly id: string;
  readonly result: RunResultValue;
  readonly stage: string;
  readonly attemptCount: number;
};

export type RunningRunView = {
  readonly id: string;
  readonly hanoiDate: HanoiDate;
  readonly attemptCount: number;
};

export type YoutubeVideoSlim = {
  readonly id: string;
  readonly youtubeVideoId: string;
  readonly titleFingerprint: string;
  readonly episodeNumber: number | null;
  readonly status: VideoStatus;
};

export type YoutubeVideoFull = {
  readonly id: string;
  readonly youtubeVideoId: string;
  readonly title: string;
  readonly descriptionRaw: string | null;
  readonly descriptionClean: string | null;
  readonly keywords: string[];
  readonly durationSeconds: number | null;
  readonly viewCount: number | null;
  readonly publishedAt: string;
  readonly thumbnails: unknown;
  readonly url: string;
  readonly status: VideoStatus;
};

export type ReferenceCacheRow = {
  readonly url: string;
  readonly finalUrl: string | null;
  readonly httpStatus: number | null;
  readonly host: string | null;
  readonly checkedAt: string;
};

export type FinishInput = {
  readonly result: Exclude<RunResultValue, 'running'>;
  readonly sourceKind?: SourceKindValue;
  readonly articleId?: string | null;
  readonly streak?: number | null;
  readonly errorStage?: string;
  readonly error?: Record<string, unknown>;
};

export type LogEntry = {
  readonly code: string;
  readonly level?: 'debug' | 'info' | 'warn' | 'error';
  readonly stage?: string;
  readonly message?: string;
  readonly runId?: string | null;
  readonly context?: Record<string, unknown>;
};

/** Raw snake_case row from a settings RPC, mapped once here. */
type SettingsRpcRow = {
  timezone: string;
  publish_hour_local: number;
  publish_window_end_hour: number;
  abandon_hour_local: number;
  no_source_threshold: number;
  fresh_window_days: number;
  require_approval: boolean;
  paused: boolean;
  dry_run: boolean;
  daily_send_cap: number;
  boilerplate_markers: string[] | null;
  restricted_topics: string[] | null;
  allowed_reference_hosts: string[] | null;
  journal_tiers: Record<string, unknown> | null;
};

type RunRpcRow = { id: string; result: RunResultValue; stage: string; attempt_count: number };
type RunningRpcRow = { id: string; hanoi_date: string; attempt_count: number };
type YoutubeSlimRpcRow = {
  id: string;
  youtube_video_id: string;
  title_fingerprint: string;
  episode_number: number | null;
  status: VideoStatus;
};
type YoutubeFullRpcRow = {
  id: string;
  youtube_video_id: string;
  title: string;
  description_raw: string | null;
  description_clean: string | null;
  keywords: string[] | null;
  duration_seconds: number | null;
  view_count: number | null;
  published_at: string;
  thumbnails: unknown;
  url: string;
  status: VideoStatus;
};
type ReferenceCacheRpcRow = {
  url: string;
  final_url: string | null;
  http_status: number | null;
  host: string | null;
  checked_at: string;
};
type ClaimVideoRpcRow = { id: string; youtube_video_id: string; title: string };
type ClaimResearchRpcRow = { id: string | null; outcome: string };

/* --------------------------------- the gateway --------------------------------- */

/** Everything the daily tick reads or writes in the private `internal` schema. */
export type AutomationGateway = {
  // settings + run lifecycle
  getSettings: () => Promise<AutomationSettingsView>;
  getRun: (day: HanoiDate) => Promise<RunView | null>;
  claimDay: (day: HanoiDate, trigger?: string) => Promise<{ id: string } | null>;
  recordSkippedWindow: (day: HanoiDate) => Promise<void>;
  listRunning: () => Promise<RunningRunView[]>;
  expireRun: (runId: string) => Promise<void>;
  acquireLease: (runId: string) => Promise<string | null>;
  saveStage: (
    runId: string,
    token: string,
    stage: string,
    artifacts?: Record<string, unknown>,
  ) => Promise<boolean>;
  loadArtifacts: (runId: string) => Promise<Record<string, unknown>>;
  incrementAttempt: (runId: string) => Promise<number>;
  finish: (runId: string, input: FinishInput) => Promise<void>;
  noSourceStreak: (day: HanoiDate) => Promise<number>;
  log: (entry: LogEntry) => Promise<void>;
  // youtube sources
  youtubeExisting: (ids: readonly string[]) => Promise<YoutubeVideoSlim[]>;
  youtubeCandidates: () => Promise<YoutubeVideoSlim[]>;
  youtubeInsert: (payload: Record<string, unknown>) => Promise<string | null>;
  youtubeUpdateMetadata: (payload: Record<string, unknown>) => Promise<boolean>;
  youtubeMarkUnavailable: (youtubeVideoId: string, title: string) => Promise<void>;
  youtubeMarkUsed: (videoId: string) => Promise<void>;
  youtubeGet: (videoId: string) => Promise<YoutubeVideoFull | null>;
  claimNextVideo: (
    freshWindowDays: number,
  ) => Promise<{ id: string; youtubeVideoId: string; title: string } | null>;
  // research
  claimResearchSource: (
    payload: Record<string, unknown>,
  ) => Promise<{ id: string | null; outcome: string }>;
  // reference verification cache
  referenceCacheGet: (key: string) => Promise<ReferenceCacheRow | null>;
  referenceCachePut: (payload: Record<string, unknown>) => Promise<void>;
};

/** How long a driver holds a run before another tick may take over. */
const LEASE_DURATION_MS = 20 * 60 * 1000;

function mapSettings(row: SettingsRpcRow): AutomationSettingsView {
  return {
    timezone: row.timezone,
    publishHourLocal: row.publish_hour_local,
    publishWindowEndHour: row.publish_window_end_hour,
    abandonHourLocal: row.abandon_hour_local,
    noSourceThreshold: row.no_source_threshold,
    freshWindowDays: row.fresh_window_days,
    requireApproval: row.require_approval,
    paused: row.paused,
    dryRun: row.dry_run,
    dailySendCap: row.daily_send_cap,
    boilerplateMarkers: row.boilerplate_markers ?? [],
    restrictedTopics: row.restricted_topics ?? [],
    allowedReferenceHosts: row.allowed_reference_hosts ?? [],
    journalTiers: row.journal_tiers,
  };
}

function mapSlim(row: YoutubeSlimRpcRow): YoutubeVideoSlim {
  return {
    id: row.id,
    youtubeVideoId: row.youtube_video_id,
    titleFingerprint: row.title_fingerprint,
    episodeNumber: row.episode_number,
    status: row.status,
  };
}

/** The live gateway, backed by the service-role client and the public automation_* RPCs. */
export function liveGateway(): AutomationGateway {
  return {
    getSettings: async () => {
      const list = await rows<SettingsRpcRow>('automation_get_settings');
      const row = list[0];
      if (row === undefined) {
        throw new Error('automation_settings singleton is missing; run the migrations');
      }
      return mapSettings(row);
    },

    getRun: async (day) => {
      const list = await rows<RunRpcRow>('automation_get_run', { p_day: day });
      const row = list[0];
      return row === undefined
        ? null
        : { id: row.id, result: row.result, stage: row.stage, attemptCount: row.attempt_count };
    },

    claimDay: async (day, trigger = 'cron') => {
      const id = await one<string>('automation_claim_day', { p_day: day, p_trigger: trigger });
      return id === null ? null : { id };
    },

    recordSkippedWindow: async (day) => {
      await one<boolean>('automation_record_skipped_window', { p_day: day });
    },

    listRunning: async () => {
      const list = await rows<RunningRpcRow>('automation_list_running');
      return list.map((row) => ({
        id: row.id,
        hanoiDate: row.hanoi_date as HanoiDate,
        attemptCount: row.attempt_count,
      }));
    },

    expireRun: async (runId) => {
      await one<null>('automation_expire_run', { p_run_id: runId });
    },

    acquireLease: async (runId) => {
      const token = crypto.randomUUID();
      const now = new Date();
      const acquired = await one<boolean>('automation_acquire_lease', {
        p_run_id: runId,
        p_token: token,
        p_lease_until: new Date(now.getTime() + LEASE_DURATION_MS).toISOString(),
        p_now: now.toISOString(),
      });
      return acquired === true ? token : null;
    },

    saveStage: async (runId, token, stage, artifacts) => {
      const saved = await one<boolean>('automation_save_stage', {
        p_run_id: runId,
        p_token: token,
        p_stage: stage,
        p_artifacts: artifacts ?? null,
      });
      return saved === true;
    },

    loadArtifacts: async (runId) => {
      const data = await one<Record<string, unknown>>('automation_load_artifacts', {
        p_run_id: runId,
      });
      return data !== null && typeof data === 'object' && !Array.isArray(data) ? data : {};
    },

    incrementAttempt: async (runId) => {
      const next = await one<number>('automation_increment_attempt', { p_run_id: runId });
      return typeof next === 'number' ? next : 0;
    },

    finish: async (runId, input) => {
      await one<null>('automation_finish', {
        p_run_id: runId,
        p_result: input.result,
        p_source_kind: input.sourceKind ?? null,
        p_article_id: input.articleId ?? null,
        p_streak: input.streak ?? null,
        p_error_stage: input.errorStage ?? null,
        p_error: input.error ?? null,
      });
    },

    noSourceStreak: async (day) => {
      const streak = await one<number>('automation_no_source_streak', { p_day: day });
      return typeof streak === 'number' ? streak : 0;
    },

    log: async (entry) => {
      // Losing observability must never fail the work being observed.
      try {
        const { error } = await callRpc()<null>('automation_log', {
          p_code: entry.code,
          p_run_id: entry.runId ?? null,
          p_level: entry.level ?? 'info',
          p_stage: entry.stage ?? null,
          p_message: entry.message ?? null,
          p_context: entry.context ?? {},
        });
        if (error !== null) console.error(`automation_log(${entry.code}) failed: ${error.message}`);
      } catch (cause) {
        console.error(`automation_log(${entry.code}) threw`, cause);
      }
    },

    youtubeExisting: async (ids) => {
      const list = await rows<YoutubeSlimRpcRow>('automation_youtube_existing', {
        p_ids: [...ids],
      });
      return list.map(mapSlim);
    },

    youtubeCandidates: async () => {
      const list = await rows<YoutubeSlimRpcRow>('automation_youtube_candidates');
      return list.map(mapSlim);
    },

    youtubeInsert: async (payload) => one<string>('automation_youtube_insert', { p: payload }),

    youtubeUpdateMetadata: async (payload) => {
      const updated = await one<boolean>('automation_youtube_update_metadata', { p: payload });
      return updated === true;
    },

    youtubeMarkUnavailable: async (youtubeVideoId, title) => {
      await one<null>('automation_youtube_mark_unavailable', {
        p_youtube_video_id: youtubeVideoId,
        p_title: title,
      });
    },

    youtubeMarkUsed: async (videoId) => {
      await one<null>('automation_youtube_mark_used', { p_video_id: videoId });
    },

    youtubeGet: async (videoId) => {
      const list = await rows<YoutubeFullRpcRow>('automation_youtube_get', { p_video_id: videoId });
      const row = list[0];
      if (row === undefined) return null;
      return {
        id: row.id,
        youtubeVideoId: row.youtube_video_id,
        title: row.title,
        descriptionRaw: row.description_raw,
        descriptionClean: row.description_clean,
        keywords: row.keywords ?? [],
        durationSeconds: row.duration_seconds,
        viewCount: row.view_count,
        publishedAt: row.published_at,
        thumbnails: row.thumbnails,
        url: row.url,
        status: row.status,
      };
    },

    claimNextVideo: async (freshWindowDays) => {
      const list = await rows<ClaimVideoRpcRow>('automation_claim_next_video', {
        p_fresh_window_days: freshWindowDays,
      });
      const row = list[0];
      return row === undefined
        ? null
        : { id: row.id, youtubeVideoId: row.youtube_video_id, title: row.title };
    },

    claimResearchSource: async (payload) => {
      const list = await rows<ClaimResearchRpcRow>('automation_claim_research_source', {
        p: payload,
      });
      const row = list[0];
      return { id: row?.id ?? null, outcome: row?.outcome ?? 'duplicate' };
    },

    referenceCacheGet: async (key) => {
      const list = await rows<ReferenceCacheRpcRow>('automation_reference_cache_get', {
        p_key: key,
      });
      const row = list[0];
      if (row === undefined) return null;
      return {
        url: row.url,
        finalUrl: row.final_url,
        httpStatus: row.http_status,
        host: row.host,
        checkedAt: row.checked_at,
      };
    },

    referenceCachePut: async (payload) => {
      await one<null>('automation_reference_cache_put', { p: payload });
    },
  };
}

/* ============================================================================
 *   Newsletter gateway
 * ============================================================================
 *
 * The newsletter signup, confirm and unsubscribe paths share the same private-
 * schema problem: they cannot reach `internal.subscribers` etc. through
 * PostgREST directly, because that schema is intentionally not exposed. Every
 * operation is behind a `public.newsletter_*` SECURITY DEFINER function
 * callable only by `service_role` (see the paired migration).
 *
 * Kept separate from `AutomationGateway` because the newsletter has its own
 * consumers (`subscribe`, `lifecycle`) that never touch the automation
 * surface — one narrow shape each is easier to reason about than one large
 * union.
 */

export type SubStatusValue = 'pending' | 'active' | 'unsubscribed' | 'bounced' | 'complained';

export type SubscriberSummary = {
  readonly id: string;
  readonly status: SubStatusValue;
};

export type PendingConfirmationRow = {
  readonly id: string;
  readonly confirmTokenHash: string | null;
  readonly confirmExpiresAt: string | null;
};

export type SubscriberForUnsub = {
  readonly status: SubStatusValue;
  readonly unsubscribeTokenHash: string;
};

/** The whole shape of the private-schema surface the newsletter code needs. */
export type NewsletterGateway = {
  countRecentAttempts: (ipHmac: string, since: string) => Promise<number>;
  recordAttempt: (ipHmac: string, outcome: string) => Promise<void>;
  findSubscriber: (emailNormalized: string) => Promise<SubscriberSummary | null>;
  insertPending: (payload: Record<string, unknown>) => Promise<string | null>;
  setUnsubscribeHash: (id: string, hash: string) => Promise<void>;
  rearmPending: (id: string, consent: Record<string, unknown>) => Promise<void>;
  logSendFailure: (level: 'warn' | 'error', message: string, stage?: string) => Promise<void>;
  pendingWithConfirmTokens: () => Promise<PendingConfirmationRow[]>;
  activate: (id: string, nowIso: string) => Promise<boolean>;
  getSubscriberForUnsub: (id: string) => Promise<SubscriberForUnsub | null>;
  markUnsubscribed: (id: string, nowIso: string) => Promise<boolean>;
};

type SubscriberRpcRow = { id: string; status: SubStatusValue };
type PendingConfirmRpcRow = {
  id: string;
  confirm_token_hash: string | null;
  confirm_expires_at: string | null;
};
type UnsubRpcRow = { status: SubStatusValue; unsubscribe_token_hash: string };

/** The live newsletter gateway, backed by the service-role client. */
export function liveNewsletterGateway(): NewsletterGateway {
  return {
    countRecentAttempts: async (ipHmac, since) => {
      const n = await one<number>('newsletter_count_recent_attempts', {
        p_ip_hmac: ipHmac,
        p_since: since,
      });
      return typeof n === 'number' ? n : 0;
    },

    recordAttempt: async (ipHmac, outcome) => {
      await one<null>('newsletter_record_attempt', {
        p_ip_hmac: ipHmac,
        p_outcome: outcome,
      });
    },

    findSubscriber: async (emailNormalized) => {
      const list = await rows<SubscriberRpcRow>('newsletter_find_subscriber', {
        p_email_normalized: emailNormalized,
      });
      const row = list[0];
      return row === undefined ? null : { id: row.id, status: row.status };
    },

    insertPending: (payload) => one<string>('newsletter_insert_pending', { p: payload }),

    setUnsubscribeHash: async (id, hash) => {
      await one<null>('newsletter_set_unsubscribe_hash', { p_id: id, p_hash: hash });
    },

    rearmPending: async (id, consent) => {
      await one<null>('newsletter_rearm_pending', { p_id: id, p_consent: consent });
    },

    logSendFailure: async (level, message, stage = 'confirm') => {
      // Logging must never fail the caller.
      try {
        const { error } = await callRpc()<null>('newsletter_log_send_failure', {
          p_level: level,
          p_message: message,
          p_stage: stage,
        });
        if (error !== null) console.error(`newsletter_log_send_failure failed: ${error.message}`);
      } catch (cause) {
        console.error('newsletter_log_send_failure threw', cause);
      }
    },

    pendingWithConfirmTokens: async () => {
      const list = await rows<PendingConfirmRpcRow>('newsletter_pending_with_confirm_tokens');
      return list.map((row) => ({
        id: row.id,
        confirmTokenHash: row.confirm_token_hash,
        confirmExpiresAt: row.confirm_expires_at,
      }));
    },

    activate: async (id, nowIso) => {
      const ok = await one<boolean>('newsletter_activate', { p_id: id, p_now: nowIso });
      return ok === true;
    },

    getSubscriberForUnsub: async (id) => {
      const list = await rows<UnsubRpcRow>('newsletter_get_subscriber_for_unsub', { p_id: id });
      const row = list[0];
      return row === undefined
        ? null
        : { status: row.status, unsubscribeTokenHash: row.unsubscribe_token_hash };
    },

    markUnsubscribed: async (id, nowIso) => {
      const ok = await one<boolean>('newsletter_mark_unsubscribed', { p_id: id, p_now: nowIso });
      return ok === true;
    },
  };
}
