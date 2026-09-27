/**
 * An in-memory fake of the `internal` Supabase client for the newsletter use cases.
 *
 * Separate from `fake-internal-client.ts` (which serves the ingestion tests with a smaller
 * query surface) because the newsletter code uses a wider slice of the builder — gte/lt/in,
 * head+count reads, upsert with ignoreDuplicates, neq, and not-is-null. Rather than stub each
 * call's return value, this implements that slice over plain arrays with real filtering, so
 * the drain's "only queued rows", the rate limiter's time window, and the idempotent fan-out
 * are genuinely exercised. An unsupported call throws loudly rather than silently returning
 * nothing.
 *
 * The unique constraints of the real tables are emulated so "run it twice" hits the same
 * 23505 path as production. The constraints themselves are proven against the real database
 * by the pgTAP suite; this fake tests the orchestration around them.
 */

type Row = Record<string, unknown>;
type Filter = (row: Row) => boolean;

export type FakeResult<T> = {
  data: T;
  error: { code?: string; message: string } | null;
  count: number | null;
};

let idCounter = 0;
function uuid(): string {
  idCounter += 1;
  return `00000000-0000-0000-0000-${String(idCounter).padStart(12, '0')}`;
}

function asString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

export class FakeInternalClient {
  readonly tables: Map<string, Row[]>;
  private readonly generated: Record<string, (row: Row) => void>;

  constructor(seed: Record<string, Row[]> = {}) {
    this.tables = new Map(
      Object.entries(seed).map(([name, rows]) => [name, rows.map((r) => ({ ...r }))]),
    );
    this.generated = {
      subscribers: (row) => {
        row.id ??= uuid();
        row.email_normalized ??= normalizeEmail(asString(row.email));
        row.status ??= 'pending';
        row.created_at ??= new Date().toISOString();
      },
      newsletter_campaigns: (row) => {
        row.id ??= uuid();
        row.total_queued ??= 0;
        row.total_sent ??= 0;
      },
      newsletter_sends: (row) => {
        row.id ??= uuid();
        row.status ??= 'queued';
        row.attempt_count ??= 0;
        row.idempotency_key ??= `${asString(row.campaign_id)}:${asString(row.subscriber_id)}`;
      },
      signup_attempts: (row) => {
        row.id ??= idCounter += 1;
        row.ts ??= new Date().toISOString();
      },
      job_logs: (row) => {
        row.id ??= idCounter += 1;
        row.ts ??= new Date().toISOString();
      },
    };
  }

  rowsOf(table: string): Row[] {
    let rows = this.tables.get(table);
    if (rows === undefined) {
      rows = [];
      this.tables.set(table, rows);
    }
    return rows;
  }

  from(table: string) {
    return new FakeQuery(this, table);
  }

  rpc(): never {
    throw new Error('FakeInternalClient.rpc is not implemented for the newsletter tests');
  }

  applyGenerated(table: string, row: Row): void {
    this.generated[table]?.(row);
  }
}

class FakeQuery {
  private filters: Filter[] = [];
  private pending: {
    kind: 'insert' | 'upsert' | 'update';
    payload: Row | Row[];
    onConflict?: string;
    ignoreDuplicates?: boolean;
  } | null = null;
  private wantCount = false;
  private headOnly = false;
  private limitN = Number.POSITIVE_INFINITY;

  constructor(
    private readonly db: FakeInternalClient,
    private readonly table: string,
  ) {}

  insert(payload: Row | Row[]) {
    this.pending = { kind: 'insert', payload };
    return this;
  }
  upsert(payload: Row | Row[], options?: { onConflict?: string; ignoreDuplicates?: boolean }) {
    this.pending = { kind: 'upsert', payload, ...options };
    return this;
  }
  update(payload: Row) {
    this.pending = { kind: 'update', payload };
    return this;
  }
  select(_columns?: string, options?: { count?: string; head?: boolean }) {
    if (options?.count !== undefined) this.wantCount = true;
    if (options?.head === true) this.headOnly = true;
    return this;
  }
  eq(column: string, value: unknown) {
    this.filters.push((row) => row[column] === value);
    return this;
  }
  neq(column: string, value: unknown) {
    this.filters.push((row) => row[column] !== value);
    return this;
  }
  gte(column: string, value: string) {
    this.filters.push((row) => asString(row[column]) >= value);
    return this;
  }
  lt(column: string, value: string) {
    this.filters.push((row) => row[column] !== null && asString(row[column]) < value);
    return this;
  }
  in(column: string, values: readonly unknown[]) {
    this.filters.push((row) => values.includes(row[column]));
    return this;
  }
  not(column: string, op: string, value: unknown) {
    if (op === 'is' && value === null) {
      this.filters.push((row) => row[column] !== null && row[column] !== undefined);
      return this;
    }
    throw new Error(`FakeQuery.not does not support op "${op}"`);
  }
  order() {
    return this;
  }
  limit(n: number) {
    this.limitN = n;
    return this;
  }

  private matching(): Row[] {
    return this.db.rowsOf(this.table).filter((row) => this.filters.every((f) => f(row)));
  }

  private run(): FakeResult<Row[]> {
    if (this.pending !== null) return this.runWrite();
    const matched = this.matching().slice(0, this.limitN);
    if (this.headOnly) return { data: [], error: null, count: matched.length };
    return { data: matched, error: null, count: this.wantCount ? matched.length : null };
  }

  private runWrite(): FakeResult<Row[]> {
    const rows = this.db.rowsOf(this.table);
    const pending = this.pending;
    if (pending === null) return { data: [], error: null, count: null };

    if (pending.kind === 'insert' || pending.kind === 'upsert') {
      const incoming = Array.isArray(pending.payload) ? pending.payload : [pending.payload];
      const written: Row[] = [];
      for (const raw of incoming) {
        const row = { ...raw };
        this.db.applyGenerated(this.table, row);
        const conflict = this.findConflict(rows, row, pending.onConflict);
        if (conflict !== null) {
          if (pending.kind === 'upsert' && pending.ignoreDuplicates === true) continue;
          if (pending.kind === 'insert') {
            return {
              data: [],
              error: { code: '23505', message: 'duplicate key value' },
              count: null,
            };
          }
          continue;
        }
        rows.push(row);
        written.push(row);
      }
      return { data: written, error: null, count: null };
    }

    const matched = this.matching();
    for (const row of matched) Object.assign(row, pending.payload);
    return { data: matched, error: null, count: null };
  }

  private findConflict(rows: Row[], row: Row, onConflict?: string): Row | null {
    const uniques: Record<string, string[][]> = {
      subscribers: [['email'], ['email_normalized']],
      newsletter_campaigns: [['article_id']],
      newsletter_sends: [['campaign_id', 'subscriber_id'], ['idempotency_key']],
    };
    const keySets = [
      ...(uniques[this.table] ?? []),
      ...(onConflict !== undefined ? [onConflict.split(',')] : []),
    ];
    for (const keySet of keySets) {
      const existing = rows.find(
        (candidate) => candidate !== row && keySet.every((k) => candidate[k] === row[k]),
      );
      if (existing !== undefined) return existing;
    }
    return null;
  }

  maybeSingle(): Promise<FakeResult<Row | null>> {
    const result = this.run();
    return Promise.resolve({
      data: result.data[0] ?? null,
      error: result.error,
      count: result.count,
    });
  }

  then<TResult1 = FakeResult<Row[]>, TResult2 = never>(
    onfulfilled?: ((value: FakeResult<Row[]>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.run()).then(onfulfilled, onrejected);
  }
}

/** Mirror of internal.normalize_email, so seeded rows dedupe like the database does. */
function normalizeEmail(input: string): string {
  const lowered = input.trim().toLowerCase();
  const at = lowered.indexOf('@');
  if (at === -1) return lowered;
  let local = lowered.slice(0, at);
  let domain = lowered.slice(at + 1);
  const plus = local.indexOf('+');
  if (plus !== -1) local = local.slice(0, plus);
  if (domain === 'gmail.com' || domain === 'googlemail.com') {
    local = local.replace(/\./g, '');
    domain = 'gmail.com';
  }
  return `${local}@${domain}`;
}
