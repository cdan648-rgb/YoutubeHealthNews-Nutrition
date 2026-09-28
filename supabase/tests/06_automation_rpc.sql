-- ============================================================================
-- Test 06 — the automation worker's public RPC facade
-- ============================================================================
-- pgTAP. Runs inside a transaction that ROLLS BACK, so it is safe against any
-- environment including the live project: no fixture survives the run.
--
-- These functions exist so /api/automation/tick can reach the private `internal`
-- schema WITHOUT that schema being exposed to the Data API. Two things must hold:
--   1. functionally, each operation the tick needs works end to end;
--   2. security-wise, only service_role may execute them — anon and authenticated
--      are denied, and `internal` stays unreachable to them directly.
--
-- Run with:  npm run test:db        (needs DATABASE_URL, see scripts/run-db-tests.mjs)
-- ============================================================================
begin;
set local search_path = extensions, public, internal;
select plan(27);
create temp table tap_results(seq serial primary key, line text) on commit drop;

-- Runs a statement AS a role and reports whether it was denied. Each attempt gets
-- its own subtransaction so a permission error does not abort the whole run.
create function pg_temp.denied(stmt text, as_role text) returns boolean
language plpgsql as $fn$
begin
  begin
    execute format('set local role %I', as_role);
    execute stmt;
    execute 'reset role';
    return false;
  exception when others then
    begin execute 'reset role'; exception when others then null; end;
    return true;
  end;
end $fn$;

-- ================= functional: the whole tick data path ======================
do $fn$
declare
  v_run uuid;
  v_token uuid := gen_random_uuid();
  v_ok boolean;
  v_attempts integer;
  v_art jsonb;
  v_streak integer;
  v_vid uuid;
begin
  insert into tap_results(line) select is(
    (select count(*)::int from public.automation_get_settings()), 1,
    'automation_get_settings returns the settings singleton');

  v_run := public.automation_claim_day('2099-01-01'::date, 'cron');
  insert into tap_results(line) select ok(v_run is not null, 'automation_claim_day claims a fresh Hanoi day');

  insert into tap_results(line) select ok(
    exists(select 1 from public.automation_get_run('2099-01-01'::date) where id = v_run),
    'automation_get_run finds the claimed run');

  v_ok := public.automation_acquire_lease(v_run, v_token, now() + interval '20 min', now());
  insert into tap_results(line) select ok(v_ok, 'automation_acquire_lease succeeds on an un-leased run');

  v_ok := public.automation_acquire_lease(v_run, gen_random_uuid(), now() + interval '20 min', now());
  insert into tap_results(line) select ok(not v_ok, 'automation_acquire_lease refuses a run already leased');

  v_ok := public.automation_save_stage(v_run, v_token, 'source', '{"source":{"kind":"none"}}'::jsonb);
  insert into tap_results(line) select ok(v_ok, 'automation_save_stage writes with a valid lease token');

  v_ok := public.automation_save_stage(v_run, gen_random_uuid(), 'generate', null);
  insert into tap_results(line) select ok(not v_ok, 'automation_save_stage ignores a stale lease token');

  v_art := public.automation_load_artifacts(v_run);
  insert into tap_results(line) select ok(v_art ? 'source', 'automation_load_artifacts returns saved artifacts');

  v_attempts := public.automation_increment_attempt(v_run);
  insert into tap_results(line) select is(v_attempts, 1, 'automation_increment_attempt returns the new count');

  perform public.automation_log('run_claimed', v_run, 'info', 'source', 'pgtap', '{"k":1}'::jsonb);
  insert into tap_results(line) select is(
    (select count(*)::int from internal.job_logs where run_id = v_run and code = 'run_claimed'), 1,
    'automation_log appends a job-log line');

  perform public.automation_finish(v_run, 'no_source'::internal.run_result, 'none'::internal.source_kind, null, 5, null, null);
  insert into tap_results(line) select ok(
    exists(select 1 from internal.automation_runs where id = v_run and result = 'no_source' and streak_at_decision = 5),
    'automation_finish settles the run and records the streak');

  v_streak := public.automation_no_source_streak('2099-01-02'::date);
  insert into tap_results(line) select ok(v_streak >= 0, 'automation_no_source_streak returns a count');

  v_vid := public.automation_youtube_insert(
    '{"youtube_video_id":"PGTAPVIDEO1","title":"pgtap","published_at":"2026-01-01T00:00:00Z","status":"available","keywords":["a"]}'::jsonb);
  insert into tap_results(line) select ok(v_vid is not null, 'automation_youtube_insert inserts a new video');

  insert into tap_results(line) select is(
    (select count(*)::int from public.automation_youtube_existing(array['PGTAPVIDEO1'])), 1,
    'automation_youtube_existing finds the inserted video');

  v_ok := public.automation_youtube_update_metadata(
    '{"youtube_video_id":"PGTAPVIDEO1","title":"pgtap2","view_count":"9","keywords":["b"]}'::jsonb);
  insert into tap_results(line) select ok(v_ok, 'automation_youtube_update_metadata updates an existing video');

  insert into tap_results(line) select ok(
    public.automation_youtube_insert('{"youtube_video_id":"PGTAPVIDEO1","title":"dup","published_at":"2026-01-01T00:00:00Z"}'::jsonb) is null,
    'automation_youtube_insert returns null on a unique conflict');
end;
$fn$;

-- ================= security: only service_role may execute ===================
insert into tap_results(line) select ok(pg_temp.denied($q$select public.automation_get_settings()$q$,'anon'), 'anon canNOT execute automation_get_settings');
insert into tap_results(line) select ok(pg_temp.denied($q$select public.automation_get_settings()$q$,'authenticated'), 'authenticated canNOT execute automation_get_settings');
insert into tap_results(line) select ok(pg_temp.denied($q$select public.automation_claim_day('2099-03-03'::date)$q$,'anon'), 'anon canNOT execute automation_claim_day');
insert into tap_results(line) select ok(pg_temp.denied($q$select public.automation_log('x')$q$,'anon'), 'anon canNOT execute automation_log');
insert into tap_results(line) select ok(pg_temp.denied($q$select public.automation_youtube_insert('{}'::jsonb)$q$,'anon'), 'anon canNOT execute automation_youtube_insert');
insert into tap_results(line) select ok(not pg_temp.denied($q$select public.automation_get_settings()$q$,'service_role'), 'service_role CAN execute automation_get_settings');

-- ================= structural: the grants are what we think ==================
insert into tap_results(line) select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname like 'automation\_%'),
  24, 'exactly 24 public.automation_* functions exist');

insert into tap_results(line) select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname like 'automation\_%' and p.prosecdef),
  24, 'every automation_* function is SECURITY DEFINER');

insert into tap_results(line) select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname like 'automation\_%'
     and has_function_privilege('service_role', p.oid, 'EXECUTE')),
  24, 'service_role can execute every automation_* function');

insert into tap_results(line) select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname like 'automation\_%'
     and has_function_privilege('anon', p.oid, 'EXECUTE')),
  0, 'no automation_* function is executable by anon');

insert into tap_results(line) select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname like 'automation\_%'
     and has_function_privilege('authenticated', p.oid, 'EXECUTE')),
  0, 'no automation_* function is executable by authenticated');

-- Emit every TAP line, then any plan diagnostics from finish().
select lpad(seq::text, 6, '0') as seq, line from tap_results
union all select '999999', 'FINISH: ' || f from finish() f
order by 1;
rollback;
