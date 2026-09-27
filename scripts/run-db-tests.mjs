#!/usr/bin/env node
/**
 * Runs the pgTAP suite in supabase/tests/ against a Postgres database.
 *
 * Why a custom runner instead of `pg_prove` or `supabase test db`:
 * both require tooling this project cannot assume (a Perl TAP harness, or Docker
 * for the local Supabase stack). Every test file already ends with a single
 * statement that returns its complete TAP output, so all a runner has to do is
 * execute the file and read the last result set.
 *
 * Every test file wraps itself in BEGIN ... ROLLBACK, so running the suite leaves
 * no trace even against the live project. It is still a real database though, so
 * the runner refuses to touch a URL that looks like production unless you pass
 * --allow-remote.
 *
 * Usage:
 *   DATABASE_URL=postgresql://... node scripts/run-db-tests.mjs [--allow-remote]
 *   node scripts/run-db-tests.mjs --list      # no database needed
 *
 * Get the connection string from the Supabase dashboard:
 *   Project Settings > Database > Connection string > URI
 * Use the session-mode (port 5432) or pooler URI; both work.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

const TEST_DIR = 'supabase/tests';
const args = new Set(process.argv.slice(2));

function testFiles() {
  return readdirSync(TEST_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort();
}

/** The `select plan(N)` a file declares, so the runner can report coverage. */
function declaredPlan(sql) {
  const match = /select\s+plan\(\s*(\d+)\s*\)/i.exec(sql);
  return match ? Number.parseInt(match[1], 10) : null;
}

if (args.has('--list')) {
  let total = 0;
  console.log('pgTAP suite:');
  for (const file of testFiles()) {
    const sql = readFileSync(join(TEST_DIR, file), 'utf8');
    const plan = declaredPlan(sql);
    total += plan ?? 0;
    console.log(`  ${file.padEnd(40)} plan ${plan ?? '(none declared)'}`);
  }
  console.log(`\n${testFiles().length} files, ${total} assertions declared.`);
  process.exit(0);
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error(
    'run-db-tests: DATABASE_URL is not set.\n' +
      '  Supabase dashboard > Project Settings > Database > Connection string > URI\n' +
      '  Then: DATABASE_URL="postgresql://..." npm run test:db\n' +
      '  (Use --list to inspect the suite without a database.)',
  );
  process.exit(1);
}

const isLocal = /@(localhost|127\.0\.0\.1|db)[:/]/.test(url);
if (!isLocal && !args.has('--allow-remote')) {
  console.error(
    'run-db-tests: refusing to run against a non-local database without --allow-remote.\n' +
      '  Every test rolls back, but this is still a real database. Pass --allow-remote if you mean it.',
  );
  process.exit(1);
}

const { default: pg } = await import('pg');

const client = new pg.Client({
  connectionString: url,
  // Supabase terminates TLS at the pooler with a certificate chain Node does not
  // ship a root for; the connection is still encrypted.
  ssl: isLocal ? false : { rejectUnauthorized: false },
  // A whole file runs as one transaction; give it room but do not hang CI.
  statement_timeout: 120_000,
});

await client.connect();

let filesRun = 0;
let assertionsRun = 0;
let failures = 0;

try {
  for (const file of testFiles()) {
    const sql = readFileSync(join(TEST_DIR, file), 'utf8');
    const plan = declaredPlan(sql);

    let results;
    try {
      // A multi-statement string uses the simple query protocol, so node-postgres
      // returns one Result per statement.
      results = await client.query(sql);
    } catch (error) {
      console.error(`\n=== ${file} — ERRORED ===`);
      console.error(`  ${error.message}`);
      // The file's own ROLLBACK never ran, so the session is in a failed
      // transaction. Clear it before moving on.
      await client.query('rollback').catch(() => {});
      failures += 1;
      filesRun += 1;
      continue;
    }

    const sets = Array.isArray(results) ? results : [results];
    const tap = sets.reverse().find((set) => set.rows?.length > 0 && 'line' in (set.rows[0] ?? {}));

    if (!tap) {
      console.error(`\n=== ${file} — produced no TAP output ===`);
      failures += 1;
      filesRun += 1;
      continue;
    }

    const lines = tap.rows.map((row) => row.line);
    const failed = lines.filter((line) => line.startsWith('not ok'));
    const planNotes = lines.filter((line) => line.startsWith('FINISH:'));
    const assertions = lines.filter((line) => /^(ok|not ok)\b/.test(line)).length;

    filesRun += 1;
    assertionsRun += assertions;

    if (failed.length === 0 && planNotes.length === 0) {
      console.log(`ok   ${file.padEnd(40)} ${assertions}/${plan ?? assertions} assertions`);
    } else {
      failures += failed.length || 1;
      console.log(`FAIL ${file.padEnd(40)} ${assertions}/${plan ?? '?'} assertions`);
      for (const line of failed) {
        for (const part of line.split('\n')) console.log(`       ${part}`);
      }
      // A plan mismatch means an assertion silently did not run, which is a
      // failure even when every assertion that DID run passed.
      for (const note of planNotes) console.log(`       ${note}`);
    }
  }
} finally {
  await client.end();
}

console.log(`\n${filesRun} file(s), ${assertionsRun} assertion(s), ${failures} failure(s).`);
process.exit(failures === 0 ? 0 : 1);
