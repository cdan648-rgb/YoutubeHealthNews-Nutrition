/**
 * An in-memory stand-in for the `internal` schema client.
 *
 * Only the query shapes the ingestion orchestrator actually uses are implemented —
 * `select().in()`, `select()`, `select().eq().maybeSingle()`, `insert()`,
 * `update().eq()` — because a faithful reimplementation of PostgREST would be a larger
 * and less trustworthy thing than the code under test.
 *
 * What it does model precisely is the two behaviours the tests exist to prove:
 *
 *   * the unique constraint on `youtube_video_id`, returning Postgres error code 23505,
 *     so "run ingestion twice" exercises the same conflict path as production;
 *   * generated columns (`title_fingerprint`, `url`), computed on write from the same
 *     helpers the SQL uses, so a test cannot pass by supplying a fingerprint the real
 *     database would have derived differently.
 *
 * The constraints themselves are separately proven against the real database by the
 * pgTAP suite; this fake exists to test the orchestration around them.
 */
import { titleFingerprint } from '@/lib/slug';
import type { InternalClient } from '@/lib/supabase/service';

type Row = Record<string, unknown>;

export type FakeDb = {
  youtube_videos: Row[];
  job_logs: Row[];
  automation_runs: Row[];
  automation_settings: Row[];
};

export function emptyDb(): FakeDb {
  return { youtube_videos: [], job_logs: [], automation_runs: [], automation_settings: [] };
}

let idCounter = 0;
function nextId(): string {
  idCounter += 1;
  return `00000000-0000-4000-8000-${String(idCounter).padStart(12, '0')}`;
}

/** Seed a video row with the generated columns filled in, as the database would. */
export function seedVideo(
  db: FakeDb,
  row: Partial<Row> & { youtube_video_id: string; title: string },
): Row {
  const full: Row = {
    id: nextId(),
    episode_number: null,
    description_raw: null,
    description_clean: null,
    low_signal: false,
    keywords: [],
    chapters: [],
    duration_seconds: null,
    view_count: null,
    thumbnails: {},
    published_at: '2026-01-01T00:00:00Z',
    discovered_at: '2026-01-01T00:00:00Z',
    processed_at: null,
    status: 'available',
    ineligible_reason: null,
    possible_duplicate_of: null,
    attempt_count: 0,
    ...row,
    // Generated columns, always derived — never taken from the caller.
    title_fingerprint: titleFingerprint(String(row.title)),
    url: `https://www.youtube.com/watch?v=${row.youtube_video_id}`,
  };
  db.youtube_videos.push(full);
  return full;
}

type Filter = { column: string; value: unknown };

class Query implements PromiseLike<{
  data: unknown;
  error: { code?: string; message: string } | null;
}> {
  private filters: Filter[] = [];
  private inFilter: { column: string; values: unknown[] } | null = null;
  private single = false;

  constructor(
    private readonly db: FakeDb,
    private readonly table: keyof FakeDb,
    private readonly op: 'select' | 'insert' | 'update',
    private readonly payload?: Row | Row[],
  ) {}

  select(): this {
    return this;
  }

  eq(column: string, value: unknown): this {
    this.filters.push({ column, value });
    return this;
  }

  in(column: string, values: unknown[]): this {
    this.inFilter = { column, values };
    return this;
  }

  order(): this {
    return this;
  }

  limit(): this {
    return this;
  }

  maybeSingle(): this {
    this.single = true;
    return this;
  }

  private matches(row: Row): boolean {
    if (this.inFilter !== null && !this.inFilter.values.includes(row[this.inFilter.column])) {
      return false;
    }
    return this.filters.every((filter) => row[filter.column] === filter.value);
  }

  private run(): { data: unknown; error: { code?: string; message: string } | null } {
    const rows = this.db[this.table];

    if (this.op === 'select') {
      const found = rows.filter((row) => this.matches(row));
      return { data: this.single ? (found[0] ?? null) : found, error: null };
    }

    if (this.op === 'insert') {
      const incoming = Array.isArray(this.payload) ? this.payload : [this.payload ?? {}];
      for (const candidate of incoming) {
        if (this.table === 'youtube_videos') {
          const id = candidate.youtube_video_id;
          if (rows.some((row) => row.youtube_video_id === id)) {
            // The real unique constraint. Ingestion must treat this as "someone else got
            // there first", not as a failure.
            return {
              data: null,
              error: { code: '23505', message: `duplicate key: ${String(id)}` },
            };
          }
          seedVideo(this.db, candidate as Parameters<typeof seedVideo>[1]);
        } else {
          rows.push({ id: nextId(), ...candidate });
        }
      }
      return { data: this.single ? (rows.at(-1) ?? null) : null, error: null };
    }

    // update
    const touched: Row[] = [];
    for (const row of rows) {
      if (!this.matches(row)) continue;
      Object.assign(row, this.payload);
      if (typeof row.title === 'string') row.title_fingerprint = titleFingerprint(row.title);
      touched.push(row);
    }
    return { data: this.single ? (touched[0] ?? null) : touched, error: null };
  }

  then<
    TResult1 = { data: unknown; error: { code?: string; message: string } | null },
    TResult2 = never,
  >(
    onfulfilled?:
      | ((value: {
          data: unknown;
          error: { code?: string; message: string } | null;
        }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.run()).then(onfulfilled, onrejected);
  }
}

/** A client backed by `db`, shaped enough like the real one for the orchestrator. */
export function fakeInternalClient(db: FakeDb): InternalClient {
  const client = {
    from(table: keyof FakeDb) {
      return {
        select: () => new Query(db, table, 'select'),
        insert: (payload: Row | Row[]) => new Query(db, table, 'insert', payload),
        update: (payload: Row) => new Query(db, table, 'update', payload),
      };
    },
  };
  return client as unknown as InternalClient;
}
