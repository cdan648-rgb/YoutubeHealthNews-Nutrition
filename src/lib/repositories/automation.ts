/**
 * Automation run data access: claiming a Hanoi day, leasing a run, expiring stale
 * runs, and deriving the no-source streak.
 *
 * These are the data-layer primitives. Phase 6 composes them into the scheduler;
 * keeping them separate means the concurrency guarantees can be tested against the
 * real database without an Edge Function or a cron job in the picture.
 *
 * Service-role only: everything touched here lives in the non-exposed `internal`
 * schema, and the client is typed by `InternalDatabase` so these queries get real
 * type checking rather than an `any` escape hatch.
 */
import 'server-only';

import { deriveNoSourceStreak, type RunResult } from '@/lib/automation/window';
import type { AutomationSettings, JobLogCode, JobLogLevel } from '@/lib/domain/types';
import { toJson, toJsonObject } from '@/lib/json';
import { internalClient, type InternalClient } from '@/lib/supabase/service';
import { hanoiDate, type HanoiDate } from '@/lib/time';

/** How long a driver holds a run before another tick may take over. */
export const LEASE_DURATION_MS = 20 * 60 * 1000;

/** Postgres unique-violation. The "already claimed" signal, not an error. */
const UNIQUE_VIOLATION = '23505';

export type ClaimedRun = {
  readonly id: string;
  readonly hanoiDate: HanoiDate;
};

/**
 * Claim a Hanoi day, or report that it is already claimed.
 *
 * The whole one-article-per-day guarantee rests on the unique constraint on
 * `hanoi_date`: Postgres decides the winner, so a duplicate cron firing, a retry and
 * two concurrent ticks all converge on "already claimed" with no application-level
 * locking. A null return is a normal, expected outcome and never an error.
 */
export async function claimHanoiDay(
  day: HanoiDate,
  client: InternalClient = internalClient(),
  trigger = 'cron',
): Promise<ClaimedRun | null> {
  const { data, error } = await client
    .from('automation_runs')
    .insert({ hanoi_date: day, trigger, result: 'running', stage: 'claimed' })
    .select('id, hanoi_date')
    .maybeSingle();

  if (error !== null) {
    if (error.code === UNIQUE_VIOLATION) return null;
    throw new Error(`claimHanoiDay failed: ${error.message}`);
  }
  if (data === null) return null;
  return { id: data.id, hanoiDate: data.hanoi_date as HanoiDate };
}

/**
 * Record that a Hanoi day's publishing window closed before any run was claimed.
 *
 * Deliberately a distinct result from `no_source`: a day we never opened is not a day
 * we confirmed had no source, and conflating the two would corrupt the streak that
 * drives the research fallback. Returns false when a run already exists for the day.
 */
export async function recordSkippedWindow(
  day: HanoiDate,
  client: InternalClient = internalClient(),
): Promise<boolean> {
  const { error } = await client.from('automation_runs').insert({
    hanoi_date: day,
    trigger: 'cron',
    result: 'skipped_window',
    stage: 'closed',
    completed_at: new Date().toISOString(),
  });

  if (error !== null) {
    if (error.code === UNIQUE_VIOLATION) return false;
    throw new Error(`recordSkippedWindow failed: ${error.message}`);
  }
  return true;
}

/**
 * Take the lease on a run that is not currently being driven.
 *
 * The filter and the write happen in one statement, so two ticks arriving together
 * cannot both acquire it: the loser sees a lease in the future and matches no rows.
 * The returned token must accompany every later write for that run, so a driver whose
 * lease has since been taken over can detect it and stand down.
 */
export async function acquireLease(
  runId: string,
  client: InternalClient = internalClient(),
  now = new Date(),
): Promise<string | null> {
  const token = crypto.randomUUID();
  const nowIso = now.toISOString();

  const { data, error } = await client
    .from('automation_runs')
    .update({
      lease_until: new Date(now.getTime() + LEASE_DURATION_MS).toISOString(),
      lease_token: token,
    })
    .eq('id', runId)
    .eq('result', 'running')
    .or(`lease_until.is.null,lease_until.lt.${nowIso}`)
    .select('lease_token')
    .maybeSingle();

  if (error !== null) throw new Error(`acquireLease failed: ${error.message}`);
  return data === null ? null : token;
}

/** Extend a lease we still hold. False means it was taken over; stand down. */
export async function heartbeatLease(
  runId: string,
  token: string,
  client: InternalClient = internalClient(),
  now = new Date(),
): Promise<boolean> {
  const { data, error } = await client
    .from('automation_runs')
    .update({ lease_until: new Date(now.getTime() + LEASE_DURATION_MS).toISOString() })
    .eq('id', runId)
    .eq('lease_token', token)
    .select('id')
    .maybeSingle();

  if (error !== null) throw new Error(`heartbeatLease failed: ${error.message}`);
  return data !== null;
}

/**
 * Persist stage progress and any artifacts produced.
 *
 * Artifacts are how a resumed run avoids re-paying for an LLM call it already made,
 * so this is written after every stage rather than only at the end.
 */
export async function saveStage(
  runId: string,
  token: string,
  stage: string,
  artifacts?: Record<string, unknown>,
  client: InternalClient = internalClient(),
): Promise<boolean> {
  const { data, error } = await client
    .from('automation_runs')
    .update(artifacts === undefined ? { stage } : { stage, artifacts: toJsonObject(artifacts) })
    .eq('id', runId)
    .eq('lease_token', token)
    .select('id')
    .maybeSingle();

  if (error !== null) throw new Error(`saveStage failed: ${error.message}`);
  return data !== null;
}

/** Stage artifacts already produced for a run, so a resume can skip work. */
export async function loadArtifacts(
  runId: string,
  client: InternalClient = internalClient(),
): Promise<Record<string, unknown>> {
  const { data, error } = await client
    .from('automation_runs')
    .select('artifacts')
    .eq('id', runId)
    .maybeSingle();

  if (error !== null) throw new Error(`loadArtifacts failed: ${error.message}`);
  const artifacts = data?.artifacts;
  return artifacts !== null && typeof artifacts === 'object' && !Array.isArray(artifacts)
    ? artifacts
    : {};
}

export type FinishRunInput = {
  readonly result: Exclude<RunResult, 'running'>;
  readonly sourceKind?: 'youtube' | 'research' | 'none';
  readonly articleId?: string | null;
  readonly youtubeVideoId?: string | null;
  readonly researchSourceId?: string | null;
  readonly streakAtDecision?: number | null;
  readonly errorStage?: string | null;
  readonly error?: Record<string, unknown> | null;
};

/**
 * Close a run out.
 *
 * Scoped to `result = 'running'`, so finishing an already-finished run is a no-op
 * rather than an overwrite — which is what makes a retry after a partial failure
 * safe.
 */
export async function finishRun(
  runId: string,
  input: FinishRunInput,
  client: InternalClient = internalClient(),
): Promise<void> {
  const { error } = await client
    .from('automation_runs')
    .update({
      result: input.result,
      completed_at: new Date().toISOString(),
      lease_until: null,
      lease_token: null,
      ...(input.sourceKind !== undefined ? { source_kind: input.sourceKind } : {}),
      ...(input.articleId !== undefined ? { article_id: input.articleId } : {}),
      ...(input.youtubeVideoId !== undefined ? { youtube_video_id: input.youtubeVideoId } : {}),
      ...(input.researchSourceId !== undefined
        ? { research_source_id: input.researchSourceId }
        : {}),
      ...(input.streakAtDecision !== undefined
        ? { streak_at_decision: input.streakAtDecision }
        : {}),
      ...(input.errorStage !== undefined ? { error_stage: input.errorStage } : {}),
      ...(input.error !== undefined ? { error: toJson(input.error) } : {}),
    })
    .eq('id', runId)
    .eq('result', 'running');

  if (error !== null) throw new Error(`finishRun failed: ${error.message}`);
}

/**
 * Expire runs that can no longer legitimately publish: any still `running` from an
 * earlier Hanoi day, and optionally today's once the abandon hour has passed.
 *
 * `expired` is not `no_source`, so an abandoned day cannot be mistaken for a
 * confirmed dry one. This is what stops a run crossing midnight and publishing into
 * the wrong Hanoi day.
 */
export async function expireStaleRuns(
  today: HanoiDate,
  abandonTodayToo: boolean,
  client: InternalClient = internalClient(),
): Promise<number> {
  const completedAt = new Date().toISOString();
  const patch = {
    result: 'expired' as const,
    completed_at: completedAt,
    lease_until: null,
    lease_token: null,
  };

  const { data: older, error: olderError } = await client
    .from('automation_runs')
    .update(patch)
    .eq('result', 'running')
    .lt('hanoi_date', today)
    .select('id');
  if (olderError !== null) throw new Error(`expireStaleRuns failed: ${olderError.message}`);

  let expired = older?.length ?? 0;

  if (abandonTodayToo) {
    const { data: todays, error: todayError } = await client
      .from('automation_runs')
      .update(patch)
      .eq('result', 'running')
      .eq('hanoi_date', today)
      .select('id');
    if (todayError !== null) throw new Error(`expireStaleRuns failed: ${todayError.message}`);
    expired += todays?.length ?? 0;
  }

  return expired;
}

export type RunSnapshot = {
  readonly id: string;
  readonly hanoiDate: HanoiDate;
  readonly result: RunResult;
  readonly stage: string;
  readonly leaseUntil: string | null;
  readonly attemptCount: number;
};

/** The run for a Hanoi day, if one exists. */
export async function getRunForDay(
  day: HanoiDate,
  client: InternalClient = internalClient(),
): Promise<RunSnapshot | null> {
  const { data, error } = await client
    .from('automation_runs')
    .select('id, hanoi_date, result, stage, lease_until, attempt_count')
    .eq('hanoi_date', day)
    .maybeSingle();

  if (error !== null) throw new Error(`getRunForDay failed: ${error.message}`);
  if (data === null) return null;

  return {
    id: data.id,
    hanoiDate: data.hanoi_date as HanoiDate,
    result: data.result,
    stage: data.stage,
    leaseUntil: data.lease_until,
    attemptCount: data.attempt_count,
  };
}

/** Runs still `running`, oldest first — the queue the scheduler drives. */
export async function listDrivableRuns(
  client: InternalClient = internalClient(),
): Promise<RunSnapshot[]> {
  const { data, error } = await client
    .from('automation_runs')
    .select('id, hanoi_date, result, stage, lease_until, attempt_count')
    .eq('result', 'running')
    .order('hanoi_date', { ascending: true });

  if (error !== null) throw new Error(`listDrivableRuns failed: ${error.message}`);
  return (data ?? []).map((row) => ({
    id: row.id,
    hanoiDate: row.hanoi_date as HanoiDate,
    result: row.result,
    stage: row.stage,
    leaseUntil: row.lease_until,
    attemptCount: row.attempt_count,
  }));
}

/** Bump the attempt counter, so a run cannot be retried forever. */
export async function incrementAttempt(
  runId: string,
  client: InternalClient = internalClient(),
): Promise<number> {
  const { data: current, error: readError } = await client
    .from('automation_runs')
    .select('attempt_count')
    .eq('id', runId)
    .maybeSingle();
  if (readError !== null) throw new Error(`incrementAttempt failed: ${readError.message}`);

  const next = (current?.attempt_count ?? 0) + 1;
  const { error } = await client
    .from('automation_runs')
    .update({ attempt_count: next })
    .eq('id', runId);
  if (error !== null) throw new Error(`incrementAttempt failed: ${error.message}`);
  return next;
}

/**
 * The no-source streak for a decision day, read from run history.
 *
 * Fetches a bounded recent window and hands it to the pure `deriveNoSourceStreak`,
 * so the semantics — a missing day stops the count — are unit-tested without a
 * database and identical to the SQL version asserted in
 * `supabase/tests/04_automation_day_and_articles.sql`.
 */
export async function getNoSourceStreak(
  decisionDay: HanoiDate,
  client: InternalClient = internalClient(),
  lookbackDays = 60,
): Promise<number> {
  const { data, error } = await client
    .from('automation_runs')
    .select('hanoi_date, result')
    .lt('hanoi_date', decisionDay)
    .order('hanoi_date', { ascending: false })
    .limit(lookbackDays);

  if (error !== null) throw new Error(`getNoSourceStreak failed: ${error.message}`);

  const byDate = new Map<string, RunResult>();
  for (const row of data ?? []) byDate.set(row.hanoi_date, row.result);
  return deriveNoSourceStreak(decisionDay, byDate);
}

export type RecentRun = {
  readonly hanoiDate: HanoiDate;
  readonly result: RunResult;
  readonly stage: string;
  readonly articleId: string | null;
  readonly startedAt: string;
  readonly completedAt: string | null;
  readonly errorStage: string | null;
};

/** Recent runs, newest first. Feeds the health endpoint and the admin view. */
export async function listRecentRuns(
  limit = 14,
  client: InternalClient = internalClient(),
): Promise<RecentRun[]> {
  const { data, error } = await client
    .from('automation_runs')
    .select('hanoi_date, result, stage, article_id, started_at, completed_at, error_stage')
    .order('hanoi_date', { ascending: false })
    .limit(limit);

  if (error !== null) throw new Error(`listRecentRuns failed: ${error.message}`);
  return (data ?? []).map((row) => ({
    hanoiDate: row.hanoi_date as HanoiDate,
    result: row.result,
    stage: row.stage,
    articleId: row.article_id,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    errorStage: row.error_stage,
  }));
}

/** Read the settings singleton. */
export async function getAutomationSettings(
  client: InternalClient = internalClient(),
): Promise<AutomationSettings> {
  const { data, error } = await client.from('automation_settings').select('*').maybeSingle();

  if (error !== null) throw new Error(`getAutomationSettings failed: ${error.message}`);
  if (data === null) {
    throw new Error('automation_settings singleton is missing; run the migrations');
  }

  return {
    timezone: data.timezone,
    publishHourLocal: data.publish_hour_local,
    publishWindowEndHour: data.publish_window_end_hour,
    abandonHourLocal: data.abandon_hour_local,
    noSourceThreshold: data.no_source_threshold,
    freshWindowDays: data.fresh_window_days,
    requireApproval: data.require_approval,
    paused: data.paused,
    dryRun: data.dry_run,
    dailySendCap: data.daily_send_cap,
    boilerplateMarkers: data.boilerplate_markers,
    restrictedTopics: data.restricted_topics,
    allowedReferenceHosts: data.allowed_reference_hosts,
    journalTiers:
      data.journal_tiers !== null && typeof data.journal_tiers === 'object'
        ? (data.journal_tiers as Record<string, unknown>)
        : {},
  };
}

export type JobLogEntry = {
  readonly runId?: string | null;
  readonly level?: JobLogLevel;
  readonly stage?: string;
  readonly code: JobLogCode;
  readonly message?: string;
  readonly context?: Record<string, unknown>;
};

/**
 * Append a run-log line.
 *
 * Never throws: losing observability must not fail the work being observed. A failure
 * here goes to stderr so it still surfaces in the platform logs.
 */
export async function logJob(
  entry: JobLogEntry,
  client: InternalClient = internalClient(),
): Promise<void> {
  try {
    const { error } = await client.from('job_logs').insert({
      run_id: entry.runId ?? null,
      level: entry.level ?? 'info',
      stage: entry.stage ?? null,
      code: entry.code,
      message: entry.message ?? null,
      context: toJsonObject(entry.context),
    });
    if (error !== null) console.error(`logJob(${entry.code}) failed: ${error.message}`);
  } catch (cause) {
    console.error(`logJob(${entry.code}) threw`, cause);
  }
}

/** Today's Hanoi date. Re-exported so callers need not reach for the time module. */
export function todayHanoi(now = new Date()): HanoiDate {
  return hanoiDate(now);
}
