/**
 * The daily publishing state machine.
 *
 * ARCHITECTURAL DEVIATION, recorded deliberately.
 *
 * The approved plan put this worker in a Supabase Edge Function. It runs as a Next.js
 * route handler on Vercel instead, invoked by the same pg_cron → pg_net trigger. The
 * reason is specific: Edge Functions run Deno, and this worker needs the validation gate
 * and the generation pipeline — TypeScript modules with npm dependencies, path aliases and
 * a `server-only` guard. Running them under Deno would require either a fragile import
 * shim or a second implementation of the medical safety rules. A duplicate copy of those
 * rules is the worst thing that could happen to this codebase: the two would drift, and
 * the drift would be invisible until something unsafe published.
 *
 * What made Edge Functions attractive was runtime headroom for a 60–180s pipeline. The
 * time-budgeted stage loop already solves that: each invocation advances ONE stage and
 * returns, so no single call is long. The reliability-critical parts — claiming a Hanoi
 * day, leasing, abandoning — stay in Postgres exactly as designed, which is where the
 * guarantees actually live.
 *
 * Everything the machine touches is behind `SchedulerPorts`, so the whole thing can be
 * driven in memory. That is what makes the concurrency matrix testable without races
 * against a real database.
 */
import { hanoiDate, hanoiHour, type HanoiDate } from '@/lib/time';
import {
  canClaim,
  shouldAbandon,
  windowMissed,
  type RunResult,
  type WindowSettings,
} from './window';

/** Stages, in order. Persisted after each step so a resume never repeats work. */
export const STAGES = ['claimed', 'source', 'generate', 'persist', 'notify', 'done'] as const;
export type Stage = (typeof STAGES)[number];

/** How long one invocation may spend before handing back to the next tick. */
export const DEFAULT_TIME_BUDGET_MS = 50_000;

/** Attempts after which a run is abandoned rather than retried forever. */
export const MAX_ATTEMPTS = 5;

export type SourceChoice =
  | {
      readonly kind: 'youtube';
      readonly videoId: string;
      readonly youtubeVideoId: string;
      readonly title: string;
    }
  | { readonly kind: 'research'; readonly researchSourceId: string; readonly title: string }
  | { readonly kind: 'none'; readonly streak: number };

/**
 * A source that can actually produce an article.
 *
 * `generate` and `persist` are only ever reached with one of these — the machine settles the
 * day as `no_source` before it gets that far — so excluding 'none' here removes impossible
 * branches from the implementations rather than making them assert.
 */
export type PublishableSource = Exclude<SourceChoice, { kind: 'none' }>;

export type PersistResult =
  | { readonly outcome: 'created'; readonly articleId: string; readonly published: boolean }
  /** A unique violation: a previous attempt already succeeded. Treated as success. */
  | { readonly outcome: 'already_exists'; readonly articleId: string | null };

/**
 * Everything the machine needs from the outside world.
 *
 * Narrow on purpose: each method is one database operation or one side effect, so a test
 * double is obvious and a real implementation has nowhere to hide extra behaviour.
 */
export type SchedulerPorts = {
  readonly now: () => Date;
  readonly settings: () => Promise<
    WindowSettings & {
      readonly noSourceThreshold: number;
      readonly freshWindowDays: number;
      readonly requireApproval: boolean;
    }
  >;

  readonly getRun: (
    day: HanoiDate,
  ) => Promise<{ id: string; result: RunResult; stage: Stage; attemptCount: number } | null>;
  readonly claimDay: (day: HanoiDate) => Promise<{ id: string } | null>;
  readonly recordSkippedWindow: (day: HanoiDate) => Promise<void>;
  readonly listRunning: () => Promise<{ id: string; hanoiDate: HanoiDate; attemptCount: number }[]>;
  readonly expireRun: (runId: string) => Promise<void>;

  readonly acquireLease: (runId: string) => Promise<string | null>;
  readonly saveStage: (
    runId: string,
    token: string,
    stage: Stage,
    artifacts?: Record<string, unknown>,
  ) => Promise<boolean>;
  readonly loadArtifacts: (runId: string) => Promise<Record<string, unknown>>;
  readonly incrementAttempt: (runId: string) => Promise<number>;
  readonly finish: (
    runId: string,
    input: {
      result: Exclude<RunResult, 'running'>;
      sourceKind?: 'youtube' | 'research' | 'none';
      articleId?: string | null;
      streak?: number | null;
      errorStage?: string;
      error?: Record<string, unknown>;
    },
  ) => Promise<void>;

  readonly noSourceStreak: (day: HanoiDate) => Promise<number>;
  readonly chooseSource: (
    freshWindowDays: number,
    threshold: number,
    day: HanoiDate,
  ) => Promise<SourceChoice>;
  readonly generate: (
    source: PublishableSource,
    artifacts: Record<string, unknown>,
  ) => Promise<
    | {
        readonly status: 'ok';
        readonly publishable: boolean;
        readonly artifacts: Record<string, unknown>;
        readonly reason?: string;
      }
    | {
        readonly status: 'failed';
        readonly code: string;
        readonly message: string;
        readonly retryable: boolean;
        readonly artifacts: Record<string, unknown>;
      }
  >;
  readonly persist: (
    source: PublishableSource,
    runId: string,
    publishable: boolean,
  ) => Promise<PersistResult>;
  readonly revalidate: (articleId: string) => Promise<void>;
  readonly notify: (articleId: string) => Promise<void>;
  readonly log: (entry: {
    code: string;
    level?: 'info' | 'warn' | 'error';
    stage?: string;
    message?: string;
    runId?: string | null;
    context?: Record<string, unknown>;
  }) => Promise<void>;
};

export type TickResult = {
  /** What the tick did, for the response body and the logs. */
  readonly action:
    | 'paused'
    | 'expired_only'
    | 'claimed'
    | 'advanced'
    | 'completed'
    | 'nothing_to_do'
    | 'window_closed'
    | 'lease_busy';
  readonly hanoiDate: HanoiDate;
  readonly runId?: string;
  readonly stage?: Stage;
  readonly result?: RunResult;
  readonly expired: number;
  readonly stagesAdvanced: number;
  readonly note?: string;
};

/**
 * One tick.
 *
 * Structure mirrors the plan's decision tree exactly: abandon, then claim, then drive.
 * Keeping those three phases separate is what makes a failed drive harmless — the claim
 * already committed, so the next tick simply picks the run up again.
 */
export async function tick(
  ports: SchedulerPorts,
  timeBudgetMs = DEFAULT_TIME_BUDGET_MS,
): Promise<TickResult> {
  const startedAt = ports.now().getTime();
  const settings = await ports.settings();
  const today = hanoiDate(ports.now());

  const base = { hanoiDate: today, expired: 0, stagesAdvanced: 0 } as const;

  if (settings.paused) {
    return { ...base, action: 'paused' };
  }

  /* ------------------------------- A. abandon ------------------------------- */
  // A run that can no longer legitimately publish today is expired, NOT marked no_source.
  // `expired` is deliberately not a confirmed dry day, so it cannot corrupt the streak.
  let expired = 0;
  for (const running of await ports.listRunning()) {
    const tooManyAttempts = running.attemptCount > MAX_ATTEMPTS;
    if (tooManyAttempts || shouldAbandon(running.hanoiDate, ports.now(), settings)) {
      await ports.expireRun(running.id);
      await ports.log({
        code: 'run_expired',
        level: 'warn',
        runId: running.id,
        message: tooManyAttempts
          ? `abandoned after ${running.attemptCount} attempts`
          : `abandoned: ${running.hanoiDate} can no longer publish`,
      });
      expired += 1;
    }
  }

  /* -------------------------------- B. claim -------------------------------- */
  let run = await ports.getRun(today);

  if (run === null) {
    if (canClaim(ports.now(), settings)) {
      const claimed = await ports.claimDay(today);
      if (claimed === null) {
        // Another tick won the race. That is the unique constraint working, not an error.
        return {
          ...base,
          expired,
          action: 'nothing_to_do',
          note: 'day already claimed by a concurrent tick',
        };
      }
      await ports.log({ code: 'run_claimed', runId: claimed.id, message: `claimed ${today}` });
      run = { id: claimed.id, result: 'running', stage: 'claimed', attemptCount: 0 };
    } else if (windowMissed(ports.now(), settings)) {
      // The window passed without a run. Recorded as its own result so the gap is
      // distinguishable from a day we checked and found nothing.
      await ports.recordSkippedWindow(today);
      await ports.log({
        code: 'run_expired',
        level: 'warn',
        message: `publishing window closed at hour ${hanoiHour(ports.now())} with no run`,
      });
      return { ...base, expired, action: 'window_closed' };
    } else {
      return { ...base, expired, action: 'nothing_to_do', note: 'before the publishing window' };
    }
  }

  if (run.result !== 'running') {
    return {
      ...base,
      expired,
      action: 'nothing_to_do',
      runId: run.id,
      result: run.result,
      note: 'today is already settled',
    };
  }

  /* -------------------------------- C. drive -------------------------------- */
  const token = await ports.acquireLease(run.id);
  if (token === null) {
    // Someone else holds the lease. Two ticks cannot drive one run.
    return { ...base, expired, action: 'lease_busy', runId: run.id };
  }

  await ports.incrementAttempt(run.id);

  let stage: Stage = run.stage;
  let stagesAdvanced = 0;
  let artifacts = await ports.loadArtifacts(run.id);

  const outOfTime = () => ports.now().getTime() - startedAt >= timeBudgetMs;

  while (stage !== 'done') {
    if (outOfTime()) {
      // Hand back rather than risk being killed mid-stage. The next tick resumes here.
      return {
        ...base,
        expired,
        stagesAdvanced,
        action: 'advanced',
        runId: run.id,
        stage,
        note: 'time budget reached; will resume',
      };
    }

    switch (stage) {
      case 'claimed': {
        stage = 'source';
        if (!(await ports.saveStage(run.id, token, stage)))
          return leaseLost(base, expired, stagesAdvanced, run.id);
        stagesAdvanced += 1;
        break;
      }

      case 'source': {
        const choice = await ports.chooseSource(
          settings.freshWindowDays,
          settings.noSourceThreshold,
          today,
        );

        if (choice.kind === 'none') {
          // A successful run that deliberately published nothing. This is the result the
          // streak counts, and the only one that does.
          await ports.finish(run.id, {
            result: 'no_source',
            sourceKind: 'none',
            streak: choice.streak,
          });
          await ports.log({
            code: 'no_eligible_source',
            runId: run.id,
            message: `no unused source available; streak now ${choice.streak}`,
          });
          return {
            ...base,
            expired,
            stagesAdvanced,
            action: 'completed',
            runId: run.id,
            result: 'no_source',
          };
        }

        artifacts = { ...artifacts, source: choice };
        stage = 'generate';
        if (!(await ports.saveStage(run.id, token, stage, artifacts)))
          return leaseLost(base, expired, stagesAdvanced, run.id);
        stagesAdvanced += 1;
        break;
      }

      case 'generate': {
        const choice = artifacts.source as SourceChoice | undefined;
        if (choice === undefined || choice.kind === 'none') {
          // Should be unreachable; treat as a failure rather than guessing a source.
          await ports.finish(run.id, {
            result: 'failed',
            errorStage: 'generate',
            error: { reason: 'no source in artifacts' },
          });
          return {
            ...base,
            expired,
            stagesAdvanced,
            action: 'completed',
            runId: run.id,
            result: 'failed',
          };
        }

        const result = await ports.generate(choice, artifacts);

        if (result.status === 'failed') {
          await ports.log({
            code: result.code,
            level: 'error',
            stage: 'generate',
            runId: run.id,
            message: result.message,
          });
          // Keep whatever stages did succeed, so a retry resumes cheaply.
          await ports.saveStage(run.id, token, 'generate', result.artifacts);
          if (!result.retryable) {
            await ports.finish(run.id, {
              result: 'failed',
              errorStage: 'generate',
              error: { code: result.code },
            });
            return {
              ...base,
              expired,
              stagesAdvanced,
              action: 'completed',
              runId: run.id,
              result: 'failed',
            };
          }
          // Retryable: leave the run `running` so the next tick tries again.
          return {
            ...base,
            expired,
            stagesAdvanced,
            action: 'advanced',
            runId: run.id,
            stage: 'generate',
            note: `retryable failure: ${result.code}`,
          };
        }

        artifacts = { ...result.artifacts, source: choice, publishable: result.publishable };
        if (result.reason !== undefined) artifacts = { ...artifacts, reviewReason: result.reason };
        stage = 'persist';
        if (!(await ports.saveStage(run.id, token, stage, artifacts)))
          return leaseLost(base, expired, stagesAdvanced, run.id);
        stagesAdvanced += 1;
        break;
      }

      case 'persist': {
        const choice = artifacts.source as PublishableSource;
        const publishable = artifacts.publishable === true;

        const persisted = await ports.persist(choice, run.id, publishable);

        // A unique violation on automation_run_id means a previous attempt already wrote
        // the article. That is the constraint doing its job, so it counts as success — not
        // as a reason to write a second one.
        if (persisted.outcome === 'already_exists') {
          await ports.log({
            code: 'stage_completed',
            level: 'warn',
            stage: 'persist',
            runId: run.id,
            message: 'article already existed for this run; treating as success',
          });
        }

        const articleId = persisted.articleId;
        const result: Exclude<RunResult, 'running'> = publishable
          ? choice.kind === 'research'
            ? 'research_published'
            : 'published'
          : 'validation_failed';

        await ports.finish(run.id, {
          result,
          sourceKind: choice.kind === 'research' ? 'research' : 'youtube',
          articleId: publishable ? articleId : null,
        });

        if (publishable && articleId !== null) {
          // Both are best-effort: a published article must not be un-published because a
          // cache purge or an email failed.
          try {
            await ports.revalidate(articleId);
          } catch (cause) {
            await ports.log({
              code: 'revalidate_failed',
              level: 'warn',
              runId: run.id,
              message: String(cause),
            });
          }
          try {
            await ports.notify(articleId);
          } catch (cause) {
            await ports.log({
              code: 'email_send_failed',
              level: 'warn',
              runId: run.id,
              message: String(cause),
            });
          }
        }

        await ports.log({ code: 'run_completed', runId: run.id, message: `finished as ${result}` });
        return {
          ...base,
          expired,
          stagesAdvanced: stagesAdvanced + 1,
          action: 'completed',
          runId: run.id,
          result,
        };
      }

      case 'notify': {
        // Notification happens inside `persist`, which returns; this exists only so the
        // switch is exhaustive for a run resumed at a stage that is now a no-op.
        stage = 'done';
        break;
      }
    }
  }

  return { ...base, expired, stagesAdvanced, action: 'completed', runId: run.id, stage: 'done' };
}

function leaseLost(
  base: { hanoiDate: HanoiDate; expired: number; stagesAdvanced: number },
  expired: number,
  stagesAdvanced: number,
  runId: string,
): TickResult {
  // Another driver took over mid-run. Standing down is correct: continuing would mean two
  // drivers on one run, which is what the lease exists to prevent.
  return {
    ...base,
    expired,
    stagesAdvanced,
    action: 'lease_busy',
    runId,
    note: 'lease taken over; standing down',
  };
}
