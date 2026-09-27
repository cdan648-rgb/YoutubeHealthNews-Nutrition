import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { internalClient } from '@/lib/supabase/service';
import { timingSafeEqualString } from '@/lib/security/compare';

/**
 * Read-only operations view of the automation runs.
 *
 * Token-gated: the token is compared in constant time against ADMIN_TOKEN, and a missing or
 * wrong token returns 404 rather than 401 — a 404 does not reveal that the page exists, which
 * is the right posture for an admin surface that is not linked from anywhere. `noindex` and
 * `force-dynamic` besides, since it reads live internal data with the service-role client.
 *
 * It only reads. Nothing here can pause, retry or edit a run — operational changes go through
 * `automation_settings` and migrations, not a web button, so this page cannot become an
 * unauthenticated control plane if the token ever leaks.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Automation runs',
  robots: { index: false, follow: false },
};

type Search = { readonly searchParams: Promise<{ readonly token?: string }> };

const RESULT_STYLE: Record<string, string> = {
  published: 'text-accent-ink',
  research_published: 'text-research',
  no_source: 'text-ink-3',
  skipped_window: 'text-ink-3',
  running: 'text-fact',
  validation_failed: 'text-fact',
  failed: 'text-fact',
  expired: 'text-fact',
};

function gate(provided: string | undefined): boolean {
  const expected = process.env.ADMIN_TOKEN;
  if (expected === undefined || expected === '') return false;
  return provided !== undefined && timingSafeEqualString(provided, expected);
}

export default async function AdminRunsPage({ searchParams }: Search) {
  const { token } = await searchParams;
  if (!gate(token)) notFound();

  const client = internalClient();
  const runs = await client
    .from('automation_runs')
    .select(
      'hanoi_date, result, stage, source_kind, attempt_count, streak_at_decision, started_at, completed_at, error_stage',
    )
    .order('hanoi_date', { ascending: false })
    .limit(30);

  const logs = await client
    .from('job_logs')
    .select('ts, level, stage, code, message')
    .in('level', ['warn', 'error'])
    .order('ts', { ascending: false })
    .limit(40);

  const rows = runs.data ?? [];
  const failures = logs.data ?? [];

  return (
    <main id="main" className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <h1 className="font-display text-2xl font-bold tracking-tight">Automation runs</h1>
      <p className="text-ink-3 mt-1 text-sm">
        Chỉ đọc · 30 lần chạy gần nhất theo ngày Hà Nội.{' '}
        {runs.error !== null && '(lỗi đọc dữ liệu)'}
      </p>

      <div className="border-rule mt-6 overflow-x-auto rounded-lg border">
        <table className="w-full text-left text-sm">
          <thead className="bg-surface text-ink-3 text-xs uppercase">
            <tr>
              <th className="px-3 py-2 font-semibold">Ngày (HN)</th>
              <th className="px-3 py-2 font-semibold">Kết quả</th>
              <th className="px-3 py-2 font-semibold">Giai đoạn</th>
              <th className="px-3 py-2 font-semibold">Nguồn</th>
              <th className="px-3 py-2 font-semibold">Lần thử</th>
              <th className="px-3 py-2 font-semibold">Streak</th>
              <th className="px-3 py-2 font-semibold">Hoàn tất</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((run) => (
              <tr key={run.hanoi_date} className="border-rule border-t">
                <td className="px-3 py-2 font-mono text-xs">{run.hanoi_date}</td>
                <td className={`px-3 py-2 font-semibold ${RESULT_STYLE[run.result] ?? ''}`}>
                  {run.result}
                </td>
                <td className="px-3 py-2">{run.stage}</td>
                <td className="px-3 py-2">{run.source_kind}</td>
                <td className="px-3 py-2">{run.attempt_count}</td>
                <td className="px-3 py-2">{run.streak_at_decision ?? '—'}</td>
                <td className="text-ink-3 px-3 py-2 text-xs">
                  {run.completed_at === null
                    ? (run.error_stage ?? '—')
                    : run.completed_at.slice(0, 16).replace('T', ' ')}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="text-ink-3 px-3 py-6 text-center">
                  Chưa có lần chạy nào.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <h2 className="font-display mt-10 text-lg font-bold tracking-tight">
        Cảnh báo và lỗi gần đây
      </h2>
      <ul className="mt-4 space-y-2 text-sm">
        {failures.map((log, index) => (
          <li key={index} className="border-rule flex flex-wrap gap-x-3 rounded border px-3 py-2">
            <span className="text-ink-3 font-mono text-xs">
              {log.ts.slice(0, 16).replace('T', ' ')}
            </span>
            <span className={`font-semibold ${log.level === 'error' ? 'text-fact' : 'text-ink-2'}`}>
              {log.code}
            </span>
            {log.stage !== null && <span className="text-ink-3 text-xs">[{log.stage}]</span>}
            {log.message !== null && <span className="text-ink-2">{log.message}</span>}
          </li>
        ))}
        {failures.length === 0 && <li className="text-ink-3">Không có cảnh báo nào gần đây.</li>}
      </ul>
    </main>
  );
}
