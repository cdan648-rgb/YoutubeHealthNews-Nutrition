/**
 * The concurrency and idempotency matrix.
 *
 * Every scenario the plan demanded be safe: cron firing twice, the worker running twice, a
 * timeout, a crash halfway, a retry, a resume fifteen minutes later, and two drivers on the
 * same run at once. In none of them may two automatic articles exist for one Hanoi day.
 *
 * The ports are in memory and model the two things that actually enforce the guarantee —
 * the unique constraint on `hanoi_date` and the unique constraint on `automation_run_id` —
 * because those are what a race has to get past. The constraints themselves are separately
 * proven against the real database by the pgTAP suite.
 */
import { describe, expect, it } from 'vitest';
import { assertHanoiDate, type HanoiDate } from '@/lib/time';
import { DEFAULT_WINDOW_SETTINGS, type RunResult } from './window';
import {
  MAX_ATTEMPTS,
  tick,
  type SchedulerPorts,
  type SourceChoice,
  type Stage,
} from './scheduler';

/** 04:00Z is 11:00 Hanoi — the publishing hour. */
const IN_WINDOW = new Date('2026-09-28T04:00:00Z');
const BEFORE_WINDOW = new Date('2026-09-28T03:00:00Z');
const ABANDON_HOUR = new Date('2026-09-28T16:00:00Z');
const NEXT_DAY = new Date('2026-09-29T04:00:00Z');

type Run = {
  id: string;
  hanoiDate: HanoiDate;
  result: RunResult;
  stage: Stage;
  attemptCount: number;
  leaseUntil: number | null;
  leaseToken: string | null;
  artifacts: Record<string, unknown>;
  articleId: string | null;
};

type World = {
  clock: Date;
  runs: Run[];
  /** Keyed by automation_run_id, modelling the UNIQUE constraint. */
  articles: Map<string, { id: string; published: boolean }>;
  logs: { code: string; runId?: string | null }[];
  generateCalls: number;
  persistCalls: number;
  revalidateCalls: number;
  notifyCalls: number;
  nextId: number;
};

function newWorld(): World {
  return {
    clock: IN_WINDOW,
    runs: [],
    articles: new Map(),
    logs: [],
    generateCalls: 0,
    persistCalls: 0,
    revalidateCalls: 0,
    notifyCalls: 0,
    nextId: 1,
  };
}

type PortOverrides = Partial<SchedulerPorts> & {
  readonly source?: SourceChoice;
  readonly generateResult?: Awaited<ReturnType<SchedulerPorts['generate']>>;
  readonly publishable?: boolean;
  readonly paused?: boolean;
  readonly streak?: number;
};

function makePorts(world: World, overrides: PortOverrides = {}): SchedulerPorts {
  const settings = {
    ...DEFAULT_WINDOW_SETTINGS,
    paused: overrides.paused ?? false,
    noSourceThreshold: 3,
    freshWindowDays: 21,
    requireApproval: false,
  };

  const ports: SchedulerPorts = {
    now: () => world.clock,
    settings: () => Promise.resolve(settings),

    getRun: (day) => {
      const found = world.runs.find((run) => run.hanoiDate === day);
      return Promise.resolve(
        found === undefined
          ? null
          : {
              id: found.id,
              result: found.result,
              stage: found.stage,
              attemptCount: found.attemptCount,
            },
      );
    },

    // Models the UNIQUE constraint on hanoi_date: the second caller gets nothing.
    claimDay: (day) => {
      if (world.runs.some((run) => run.hanoiDate === day)) return Promise.resolve(null);
      const run: Run = {
        id: `run-${world.nextId++}`,
        hanoiDate: day,
        result: 'running',
        stage: 'claimed',
        attemptCount: 0,
        leaseUntil: null,
        leaseToken: null,
        artifacts: {},
        articleId: null,
      };
      world.runs.push(run);
      return Promise.resolve({ id: run.id });
    },

    recordSkippedWindow: (day) => {
      if (!world.runs.some((run) => run.hanoiDate === day)) {
        world.runs.push({
          id: `run-${world.nextId++}`,
          hanoiDate: day,
          result: 'skipped_window',
          stage: 'done',
          attemptCount: 0,
          leaseUntil: null,
          leaseToken: null,
          artifacts: {},
          articleId: null,
        });
      }
      return Promise.resolve();
    },

    listRunning: () =>
      Promise.resolve(
        world.runs
          .filter((run) => run.result === 'running')
          .map((run) => ({ id: run.id, hanoiDate: run.hanoiDate, attemptCount: run.attemptCount })),
      ),

    expireRun: (runId) => {
      const run = world.runs.find((item) => item.id === runId);
      if (run !== undefined && run.result === 'running') {
        run.result = 'expired';
        run.leaseToken = null;
        run.leaseUntil = null;
      }
      return Promise.resolve();
    },

    // Models the atomic UPDATE ... WHERE lease expired: only one holder at a time.
    acquireLease: (runId) => {
      const run = world.runs.find((item) => item.id === runId);
      if (run === undefined || run.result !== 'running') return Promise.resolve(null);
      const now = world.clock.getTime();
      if (run.leaseUntil !== null && run.leaseUntil > now) return Promise.resolve(null);
      const token = `lease-${world.nextId++}`;
      run.leaseToken = token;
      run.leaseUntil = now + 20 * 60 * 1000;
      return Promise.resolve(token);
    },

    saveStage: (runId, token, stage, artifacts) => {
      const run = world.runs.find((item) => item.id === runId);
      // A stale token means the lease was taken over; the write must not land.
      if (run === undefined || run.leaseToken !== token) return Promise.resolve(false);
      run.stage = stage;
      if (artifacts !== undefined) run.artifacts = artifacts;
      return Promise.resolve(true);
    },

    loadArtifacts: (runId) =>
      Promise.resolve(world.runs.find((item) => item.id === runId)?.artifacts ?? {}),

    incrementAttempt: (runId) => {
      const run = world.runs.find((item) => item.id === runId);
      if (run === undefined) return Promise.resolve(0);
      run.attemptCount += 1;
      return Promise.resolve(run.attemptCount);
    },

    finish: (runId, input) => {
      const run = world.runs.find((item) => item.id === runId);
      // Scoped to `running`, so finishing twice is a no-op rather than an overwrite.
      if (run === undefined || run.result !== 'running') return Promise.resolve();
      run.result = input.result;
      run.articleId = input.articleId ?? null;
      run.leaseToken = null;
      run.leaseUntil = null;
      return Promise.resolve();
    },

    noSourceStreak: () => Promise.resolve(overrides.streak ?? 0),

    chooseSource: () =>
      Promise.resolve(
        overrides.source ?? {
          kind: 'youtube',
          videoId: 'video-uuid',
          youtubeVideoId: 'An4HFu4EwFQ',
          title: 'Số 118',
        },
      ),

    generate: (_source, artifacts) => {
      world.generateCalls += 1;
      return Promise.resolve(
        overrides.generateResult ?? {
          status: 'ok',
          publishable: overrides.publishable ?? true,
          artifacts: { ...artifacts, draft: { title: 'x' } },
        },
      );
    },

    // Models the UNIQUE constraint on articles.automation_run_id.
    persist: (_source, runId, publishable) => {
      world.persistCalls += 1;
      const existing = world.articles.get(runId);
      if (existing !== undefined) {
        return Promise.resolve({ outcome: 'already_exists' as const, articleId: existing.id });
      }
      const article = { id: `article-${world.nextId++}`, published: publishable };
      world.articles.set(runId, article);
      return Promise.resolve({
        outcome: 'created' as const,
        articleId: article.id,
        published: publishable,
      });
    },

    revalidate: () => {
      world.revalidateCalls += 1;
      return Promise.resolve();
    },
    notify: () => {
      world.notifyCalls += 1;
      return Promise.resolve();
    },
    log: (entry) => {
      world.logs.push({ code: entry.code, runId: entry.runId ?? null });
      return Promise.resolve();
    },
  };

  return { ...ports, ...overrides };
}

/** Ticks until the day settles, with a hard cap so a bug cannot loop forever. */
async function runToCompletion(
  world: World,
  overrides: PortOverrides = {},
  maxTicks = 12,
): Promise<number> {
  let ticks = 0;
  for (; ticks < maxTicks; ticks += 1) {
    const result = await tick(makePorts(world, overrides));
    if (
      result.action === 'completed' ||
      result.action === 'window_closed' ||
      result.action === 'paused'
    )
      break;
    if (result.action === 'nothing_to_do') break;
  }
  return ticks + 1;
}

const automaticArticles = (world: World) => world.articles.size;

describe('the normal day', () => {
  it('claims, generates, persists and publishes exactly one article', async () => {
    const world = newWorld();
    await runToCompletion(world);

    expect(world.runs).toHaveLength(1);
    expect(world.runs[0]?.result).toBe('published');
    expect(automaticArticles(world)).toBe(1);
    expect(world.revalidateCalls).toBe(1);
    expect(world.notifyCalls).toBe(1);
  });

  it('does nothing before the publishing window opens', async () => {
    const world = newWorld();
    world.clock = BEFORE_WINDOW;
    const result = await tick(makePorts(world));
    expect(result.action).toBe('nothing_to_do');
    expect(world.runs).toHaveLength(0);
  });

  it('respects the pause switch', async () => {
    const world = newWorld();
    const result = await tick(makePorts(world, { paused: true }));
    expect(result.action).toBe('paused');
    expect(world.runs).toHaveLength(0);
  });
});

describe('cron fires twice', () => {
  it('two ticks in the same Hanoi day produce one run and one article', async () => {
    const world = newWorld();
    await runToCompletion(world);
    await runToCompletion(world);

    expect(world.runs).toHaveLength(1);
    expect(automaticArticles(world)).toBe(1);
    expect(world.generateCalls).toBe(1);
  });

  it('five ticks across the window still produce one article', async () => {
    const world = newWorld();
    for (const hour of [4, 5, 6, 10, 15]) {
      world.clock = new Date(`2026-09-28T${String(hour).padStart(2, '0')}:00:00Z`);
      await runToCompletion(world);
    }
    expect(world.runs.filter((run) => run.hanoiDate === '2026-09-28')).toHaveLength(1);
    expect(automaticArticles(world)).toBe(1);
  });

  it('a concurrent claim loses cleanly', async () => {
    const world = newWorld();
    const ports = makePorts(world);
    // Both see no run, both try to claim; the constraint picks a winner.
    const [a, b] = await Promise.all([tick(ports), tick(ports)]);
    const actions = [a.action, b.action];
    expect(world.runs).toHaveLength(1);
    expect(
      actions.filter((action) => action === 'nothing_to_do' || action === 'lease_busy').length,
    ).toBeGreaterThanOrEqual(1);
  });
});

describe('two drivers on one run', () => {
  it('the second stands down rather than duplicating work', async () => {
    const world = newWorld();
    const ports = makePorts(world);
    await ports.claimDay(assertHanoiDate('2026-09-28'));

    const first = await ports.acquireLease(world.runs[0]!.id);
    expect(first).not.toBeNull();

    // A second tick arrives while the lease is held.
    const result = await tick(ports);
    expect(result.action).toBe('lease_busy');
    expect(world.generateCalls).toBe(0);
  });

  it('a write with a stale token does not land', async () => {
    const world = newWorld();
    const ports = makePorts(world);
    await ports.claimDay(assertHanoiDate('2026-09-28'));
    const runId = world.runs[0]!.id;

    const stale = await ports.acquireLease(runId);
    // Lease expires, another driver takes over.
    world.runs[0]!.leaseUntil = world.clock.getTime() - 1;
    const fresh = await ports.acquireLease(runId);

    expect(fresh).not.toBe(stale);
    expect(await ports.saveStage(runId, stale!, 'generate')).toBe(false);
    expect(await ports.saveStage(runId, fresh!, 'generate')).toBe(true);
  });
});

describe('a crash halfway', () => {
  it('resumes from the persisted stage without regenerating', async () => {
    const world = newWorld();

    // First pass: let generate succeed, then simulate the process dying before persist by
    // running a tick whose budget expires immediately.
    const ports = makePorts(world);
    await ports.claimDay(assertHanoiDate('2026-09-28'));
    const runId = world.runs[0]!.id;
    const token = await ports.acquireLease(runId);
    await ports.saveStage(runId, token!, 'persist', {
      source: { kind: 'youtube', videoId: 'v', youtubeVideoId: 'An4HFu4EwFQ', title: 'T' },
      publishable: true,
      draft: { title: 'already generated' },
    });
    // The lease expires, as it would while the process was gone.
    world.runs[0]!.leaseUntil = world.clock.getTime() - 1;

    await runToCompletion(world);

    expect(world.runs[0]?.result).toBe('published');
    expect(automaticArticles(world)).toBe(1);
    // The expensive stage was never re-run.
    expect(world.generateCalls).toBe(0);
  });

  it('a retry after a persist that already succeeded does not write a second article', async () => {
    const world = newWorld();
    await runToCompletion(world);
    const runId = world.runs[0]!.id;

    // Force the run back to `running` at the persist stage, as a crashed retry would look.
    world.runs[0]!.result = 'running';
    world.runs[0]!.stage = 'persist';
    world.runs[0]!.leaseUntil = null;

    await runToCompletion(world);

    // The unique constraint on automation_run_id returned the existing row.
    expect(automaticArticles(world)).toBe(1);
    expect(world.articles.get(runId)).toBeDefined();
    expect(world.logs.some((log) => log.code === 'stage_completed')).toBe(true);
  });
});

describe('generation failures', () => {
  it('a retryable failure leaves the run open for the next tick', async () => {
    const world = newWorld();
    const result = await tick(
      makePorts(world, {
        generateResult: {
          status: 'failed',
          code: 'openrouter_failed',
          message: 'upstream 500',
          retryable: true,
          artifacts: {},
        },
      }),
    );
    // Two ticks are needed to reach generate (claimed -> source -> generate), so drive on.
    let final = result;
    for (let i = 0; i < 4 && final.action !== 'advanced'; i += 1) {
      final = await tick(
        makePorts(world, {
          generateResult: {
            status: 'failed',
            code: 'openrouter_failed',
            message: 'upstream 500',
            retryable: true,
            artifacts: {},
          },
        }),
      );
    }
    expect(world.runs[0]?.result).toBe('running');
    expect(automaticArticles(world)).toBe(0);
    expect(world.logs.some((log) => log.code === 'openrouter_failed')).toBe(true);
  });

  it('a non-retryable failure settles the day as failed', async () => {
    const world = newWorld();
    await runToCompletion(world, {
      generateResult: {
        status: 'failed',
        code: 'ai_malformed_output',
        message: 'bad json',
        retryable: false,
        artifacts: {},
      },
    });
    expect(world.runs[0]?.result).toBe('failed');
    expect(automaticArticles(world)).toBe(0);
  });

  it('a validation failure stores the article but does not publish or email', async () => {
    const world = newWorld();
    await runToCompletion(world, { publishable: false });

    expect(world.runs[0]?.result).toBe('validation_failed');
    // The draft is kept for a human to look at...
    expect(automaticArticles(world)).toBe(1);
    expect(world.articles.get(world.runs[0]!.id)?.published).toBe(false);
    // ...but nothing was announced.
    expect(world.notifyCalls).toBe(0);
    expect(world.revalidateCalls).toBe(0);
    expect(world.runs[0]?.articleId).toBeNull();
  });

  it('gives up after the attempt cap rather than retrying forever', async () => {
    const world = newWorld();
    const ports = makePorts(world, {
      generateResult: {
        status: 'failed',
        code: 'openrouter_failed',
        message: 'x',
        retryable: true,
        artifacts: {},
      },
    });
    await ports.claimDay(assertHanoiDate('2026-09-28'));
    world.runs[0]!.attemptCount = MAX_ATTEMPTS + 1;

    const result = await tick(ports);
    expect(result.expired).toBe(1);
    expect(world.runs[0]?.result).toBe('expired');
  });
});

describe('no source available', () => {
  it('records a successful run that published nothing', async () => {
    const world = newWorld();
    await runToCompletion(world, { source: { kind: 'none', streak: 2 } });

    expect(world.runs[0]?.result).toBe('no_source');
    expect(automaticArticles(world)).toBe(0);
    expect(world.logs.some((log) => log.code === 'no_eligible_source')).toBe(true);
  });

  it('publishes a research article when the source chooser returns one', async () => {
    const world = newWorld();
    await runToCompletion(world, {
      source: { kind: 'research', researchSourceId: 'paper-1', title: 'A paper' },
    });
    expect(world.runs[0]?.result).toBe('research_published');
    expect(automaticArticles(world)).toBe(1);
  });
});

describe('the midnight boundary', () => {
  it('expires a run that is still going at the abandon hour, before midnight', async () => {
    const world = newWorld();
    const ports = makePorts(world);
    await ports.claimDay(assertHanoiDate('2026-09-28'));

    world.clock = ABANDON_HOUR; // 23:00 Hanoi
    const result = await tick(makePorts(world));

    expect(result.expired).toBe(1);
    expect(world.runs[0]?.result).toBe('expired');
    // Crucially NOT no_source: an abandoned day must not read as a confirmed dry day.
    expect(world.runs[0]?.result).not.toBe('no_source');
    expect(automaticArticles(world)).toBe(0);
  });

  it('expires yesterday and claims today, never publishing twice in one calendar day', async () => {
    const world = newWorld();
    const ports = makePorts(world);
    await ports.claimDay(assertHanoiDate('2026-09-28'));

    world.clock = NEXT_DAY;
    await runToCompletion(world);

    const yesterday = world.runs.find((run) => run.hanoiDate === '2026-09-28');
    const today = world.runs.find((run) => run.hanoiDate === '2026-09-29');
    expect(yesterday?.result).toBe('expired');
    expect(today?.result).toBe('published');
    expect(automaticArticles(world)).toBe(1);
  });

  it('records a skipped window when the day passes unclaimed', async () => {
    const world = newWorld();
    world.clock = ABANDON_HOUR;
    const result = await tick(makePorts(world));
    expect(result.action).toBe('window_closed');
    expect(world.runs[0]?.result).toBe('skipped_window');
    // Not no_source, so the research streak is untouched by a day we never opened.
    expect(world.runs[0]?.result).not.toBe('no_source');
  });
});

describe('across a week', () => {
  it('produces at most one automatic article per Hanoi day', async () => {
    const world = newWorld();
    for (const day of [28, 29, 30]) {
      for (const hour of [4, 6, 12]) {
        world.clock = new Date(`2026-09-${day}T${String(hour).padStart(2, '0')}:00:00Z`);
        await runToCompletion(world);
      }
    }

    const byDay = new Map<string, number>();
    for (const [runId] of world.articles) {
      const run = world.runs.find((item) => item.id === runId);
      if (run !== undefined) byDay.set(run.hanoiDate, (byDay.get(run.hanoiDate) ?? 0) + 1);
    }

    expect([...byDay.values()].every((count) => count === 1)).toBe(true);
    expect(byDay.size).toBe(3);
    expect(world.runs).toHaveLength(3);
  });
});
