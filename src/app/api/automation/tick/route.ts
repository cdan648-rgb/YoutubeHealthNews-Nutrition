import { NextResponse } from 'next/server';
import { tick } from '@/lib/automation/scheduler';
import { createPorts } from '@/lib/automation/ports';
import { timingSafeEqualString } from '@/lib/security/compare';

/**
 * The automation worker.
 *
 * Invoked by `internal.tick()` over pg_net every 15 minutes. Idempotent by construction:
 * the Hanoi day is claimed with a single INSERT ... ON CONFLICT, the run is leased, and
 * `articles.automation_run_id` is unique — so calling this twice, or twenty times, produces
 * at most one automatic article per Hanoi calendar day.
 *
 * Runs on the Node runtime rather than Edge because the pipeline needs npm dependencies.
 * `maxDuration` is 60s, and the stage loop hands back at 50s, so a long generation spans
 * several ticks rather than risking a mid-stage kill.
 */
export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<NextResponse> {
  const expected = process.env.AUTOMATION_SECRET;
  if (expected === undefined || expected === '') {
    // Fail closed. An unauthenticated worker is worse than one that does not run.
    return NextResponse.json({ error: 'AUTOMATION_SECRET is not configured' }, { status: 503 });
  }

  const provided = request.headers.get('x-automation-secret') ?? '';
  if (!timingSafeEqualString(provided, expected)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  try {
    const result = await tick(createPorts());
    return NextResponse.json(result, { status: 200 });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    console.error('automation tick failed', message);
    // 500 so the cron's response row records the failure; the next tick retries.
    return NextResponse.json({ error: 'tick failed', message }, { status: 500 });
  }
}

/** Convenience for a manual run during setup. Same authentication. */
export async function GET(request: Request): Promise<NextResponse> {
  return POST(request);
}
