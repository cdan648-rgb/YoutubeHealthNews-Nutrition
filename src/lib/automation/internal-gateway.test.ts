/**
 * The automation gateway boundary.
 *
 * This is the layer that replaced the direct `internal`-schema PostgREST access which broke
 * the tick ("Invalid schema: internal"). The value under test is narrow but load-bearing:
 * every call must name the right `public.automation_*` function with the exact parameter
 * names the SQL declares, and map the snake_case rows back to the shapes the scheduler uses.
 * A wrong param name would fail silently in production, so it is asserted here.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.fn();
vi.mock('@/lib/supabase/service', () => ({
  serviceClient: () => ({ rpc }),
}));

import { liveGateway } from './internal-gateway';
import type { HanoiDate } from '@/lib/time';

function reply(data: unknown, error: { message: string } | null = null) {
  rpc.mockResolvedValueOnce({ data, error });
}

beforeEach(() => {
  rpc.mockReset();
});

describe('settings', () => {
  it('reads the singleton and maps snake_case to the scheduler shape', async () => {
    reply([
      {
        timezone: 'test-tz',
        publish_hour_local: 6,
        publish_window_end_hour: 9,
        abandon_hour_local: 22,
        no_source_threshold: 7,
        fresh_window_days: 14,
        require_approval: false,
        paused: false,
        dry_run: false,
        daily_send_cap: 90,
        boilerplate_markers: ['x'],
        restricted_topics: [],
        allowed_reference_hosts: ['nih.gov'],
        journal_tiers: { a: 1 },
      },
    ]);

    const settings = await liveGateway().getSettings();

    expect(rpc).toHaveBeenCalledWith('automation_get_settings', undefined);
    expect(settings.publishHourLocal).toBe(6);
    expect(settings.noSourceThreshold).toBe(7);
    expect(settings.allowedReferenceHosts).toStrictEqual(['nih.gov']);
    expect(settings.journalTiers).toStrictEqual({ a: 1 });
  });

  it('throws a clear error when the singleton is missing', async () => {
    reply([]);
    await expect(liveGateway().getSettings()).rejects.toThrow(/singleton is missing/);
  });
});

describe('run lifecycle', () => {
  it('claimDay returns the new id, or null when the day is already claimed', async () => {
    reply('run-1');
    expect(await liveGateway().claimDay('2026-09-28' as HanoiDate)).toStrictEqual({ id: 'run-1' });
    expect(rpc).toHaveBeenCalledWith('automation_claim_day', {
      p_day: '2026-09-28',
      p_trigger: 'cron',
    });

    reply(null);
    expect(await liveGateway().claimDay('2026-09-28' as HanoiDate)).toBeNull();
  });

  it('acquireLease sends a generated token + lease window and returns the token on success', async () => {
    reply(true);
    const token = await liveGateway().acquireLease('run-1');
    expect(token).toMatch(/^[0-9a-f-]{36}$/);

    const [name, args] = rpc.mock.calls[0] as [string, Record<string, unknown>];
    expect(name).toBe('automation_acquire_lease');
    expect(args.p_run_id).toBe('run-1');
    expect(args.p_token).toBe(token);
    expect(typeof args.p_lease_until).toBe('string');
    expect(typeof args.p_now).toBe('string');
  });

  it('acquireLease returns null when another driver holds the lease', async () => {
    reply(false);
    expect(await liveGateway().acquireLease('run-1')).toBeNull();
  });

  it('saveStage passes null artifacts through when omitted (leave unchanged)', async () => {
    reply(true);
    await liveGateway().saveStage('run-1', 'tok', 'source');
    expect(rpc).toHaveBeenCalledWith('automation_save_stage', {
      p_run_id: 'run-1',
      p_token: 'tok',
      p_stage: 'source',
      p_artifacts: null,
    });
  });

  it('finish maps optional fields to their p_ parameters', async () => {
    reply(null);
    await liveGateway().finish('run-1', { result: 'no_source', sourceKind: 'none', streak: 3 });
    expect(rpc).toHaveBeenCalledWith('automation_finish', {
      p_run_id: 'run-1',
      p_result: 'no_source',
      p_source_kind: 'none',
      p_article_id: null,
      p_streak: 3,
      p_error_stage: null,
      p_error: null,
    });
  });

  it('incrementAttempt returns the new counter', async () => {
    reply(4);
    expect(await liveGateway().incrementAttempt('run-1')).toBe(4);
  });
});

describe('youtube sources', () => {
  it('youtubeInsert returns the id, or null on a unique conflict', async () => {
    reply('vid-1');
    expect(await liveGateway().youtubeInsert({ youtube_video_id: 'A' })).toBe('vid-1');
    expect(rpc).toHaveBeenCalledWith('automation_youtube_insert', { p: { youtube_video_id: 'A' } });

    reply(null);
    expect(await liveGateway().youtubeInsert({ youtube_video_id: 'A' })).toBeNull();
  });

  it('claimNextVideo maps the claimed row', async () => {
    reply([{ id: 'v1', youtube_video_id: 'yt1', title: 'T' }]);
    expect(await liveGateway().claimNextVideo(14)).toStrictEqual({
      id: 'v1',
      youtubeVideoId: 'yt1',
      title: 'T',
    });
    expect(rpc).toHaveBeenCalledWith('automation_claim_next_video', { p_fresh_window_days: 14 });

    reply([]);
    expect(await liveGateway().claimNextVideo(14)).toBeNull();
  });
});

describe('observability', () => {
  it('log never throws, even when the RPC errors', async () => {
    reply(null, { message: 'boom' });
    await expect(liveGateway().log({ code: 'run_claimed' })).resolves.toBeUndefined();
    expect(rpc).toHaveBeenCalledWith(
      'automation_log',
      expect.objectContaining({ p_code: 'run_claimed', p_level: 'info' }),
    );
  });
});
