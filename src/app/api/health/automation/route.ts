import { NextResponse } from 'next/server';
import { liveOperationsGateway } from '@/lib/automation/internal-gateway';
import { PUBLISHING_TIMEZONE, addHanoiDays, hanoiDate } from '@/lib/time';

/**
 * Automation health, for an external uptime monitor.
 *
 * This endpoint is the answer to the most likely real-world failure: a Supabase free-tier
 * project pauses after about a week of inactivity, and a paused project's cron does not run.
 * No amount of application code detects that from the inside, so something outside has to
 * ask — and asking also touches the database, which keeps the project awake.
 *
 * Returns 503 when a recent Hanoi day has no terminal run, so a monitor treats it as an
 * outage rather than needing to parse the body.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** How many days back to require coverage. Today is excluded: it may be mid-run. */
const WINDOW_DAYS = 7;

export async function GET(): Promise<NextResponse> {
  try {
    const gateway = liveOperationsGateway();
    const today = hanoiDate();
    const from = addHanoiDays(today, -WINDOW_DAYS);

    // Public RPC — SECURITY DEFINER reader for the same rows the previous direct-table read
    // used, since `internal` is not exposed to PostgREST.
    const runs = await gateway.runsSince(from);

    const byDate = new Map(runs.map((row) => [row.hanoiDate, row]));

    // Expected days: yesterday back through the window. Today is deliberately excluded.
    const missing: string[] = [];
    const stuck: string[] = [];
    for (let back = 1; back <= WINDOW_DAYS; back += 1) {
      const day = addHanoiDays(today, -back);
      const run = byDate.get(day);
      if (run === undefined) {
        missing.push(day);
      } else if (run.result === 'running') {
        // A run still 'running' on a past day means the abandon sweep is not happening.
        stuck.push(day);
      }
    }

    const healthy = missing.length === 0 && stuck.length === 0;

    return NextResponse.json(
      {
        status: healthy ? 'ok' : 'degraded',
        timezone: PUBLISHING_TIMEZONE,
        todayHanoi: today,
        windowDays: WINDOW_DAYS,
        missingDays: missing,
        stuckDays: stuck,
        recent: runs.slice(0, WINDOW_DAYS + 1).map((row) => ({
          hanoiDate: row.hanoiDate,
          result: row.result,
          stage: row.stage,
          published: row.articleId !== null,
        })),
      },
      {
        status: healthy ? 200 : 503,
        headers: { 'cache-control': 'no-store' },
      },
    );
  } catch (cause) {
    return NextResponse.json(
      { status: 'error', message: cause instanceof Error ? cause.message : String(cause) },
      { status: 503 },
    );
  }
}
