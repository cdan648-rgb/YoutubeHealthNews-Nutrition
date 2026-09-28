-- ============================================================================
-- Test 07 — the newsletter signup RPC facade
-- ============================================================================
-- pgTAP. Runs inside a transaction that ROLLS BACK, so it is safe against any
-- environment: no fixture survives the run.
--
-- These functions exist so /api/newsletter/{subscribe,confirm,unsubscribe} can
-- reach the private `internal` schema WITHOUT that schema being exposed to the
-- Data API. Two things must hold:
--   1. functionally, each operation the signup flow needs works end to end;
--   2. security-wise, only service_role may execute them — anon and authenticated
--      are denied, and the private schema stays private to them.
--
-- Run with:  npm run test:db        (needs DATABASE_URL, see scripts/run-db-tests.mjs)
-- ============================================================================
begin;
set local search_path = extensions, public, internal;
select plan(20);
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

-- ================= functional: the whole signup flow =========================
do $fn$
declare
  v_id uuid; v_cnt integer; v_ok boolean; v_status text;
begin
  -- rate limit
  perform public.newsletter_record_attempt('pgtap-ip','attempt');
  v_cnt := public.newsletter_count_recent_attempts('pgtap-ip', now() - interval '1 min');
  insert into tap_results(line) select is(v_cnt, 1, 'newsletter_count_recent_attempts returns fresh attempts');

  -- new pending row
  v_id := public.newsletter_insert_pending(
    '{"email":"pgtap.reader@gmail.com","unsubscribe_token_hash":"placeholder","confirm_token_hash":"cth","confirm_sent_at":"2026-09-28T10:00:00Z","confirm_expires_at":"2026-09-30T10:00:00Z","consent_text_version":"v","consent_ip_hmac":"pgtap-ip","consent_user_agent":"pgtap","signup_source":"test"}'::jsonb
  );
  insert into tap_results(line) select ok(v_id is not null, 'newsletter_insert_pending returns the new id');

  -- deterministic unsubscribe hash
  perform public.newsletter_set_unsubscribe_hash(v_id, 'final-hash');
  insert into tap_results(line) select is(
    (select unsubscribe_token_hash from internal.subscribers where id = v_id),
    'final-hash', 'newsletter_set_unsubscribe_hash updates the row');

  -- lookup by normalized address (the caller passes the already-normalised form; Gmail
  -- drops dots and everything after '+', so 'pgtap.reader@gmail.com' -> 'pgtapreader@gmail.com')
  perform 1 from public.newsletter_find_subscriber('pgtapreader@gmail.com') where id = v_id;
  insert into tap_results(line) select ok(found, 'newsletter_find_subscriber returns the row by its normalised email');

  -- Gmail normalisation: dots and + do not create a duplicate row
  insert into tap_results(line) select ok(
    public.newsletter_insert_pending(
      '{"email":"p.gtap.reader+news@gmail.com","unsubscribe_token_hash":"h","consent_text_version":"v"}'::jsonb
    ) is null,
    'newsletter_insert_pending returns null on a normalized-email conflict (Gmail alias dedup)');

  -- re-arm a pending row
  perform public.newsletter_rearm_pending(v_id,
    '{"confirm_token_hash":"new-cth","confirm_sent_at":"2026-09-29T10:00:00Z","confirm_expires_at":"2026-10-01T10:00:00Z","consent_text_version":"v","consent_ip_hmac":"pgtap-ip","consent_user_agent":"pgtap","signup_source":"test"}'::jsonb);
  insert into tap_results(line) select is(
    (select confirm_token_hash from internal.subscribers where id = v_id),
    'new-cth', 'newsletter_rearm_pending refreshes the confirmation token');

  -- pending list includes the row
  perform 1 from public.newsletter_pending_with_confirm_tokens() where id = v_id;
  insert into tap_results(line) select ok(found, 'newsletter_pending_with_confirm_tokens lists the pending row');

  -- activate
  v_ok := public.newsletter_activate(v_id, now());
  insert into tap_results(line) select ok(v_ok, 'newsletter_activate flips pending to active');
  insert into tap_results(line) select is(
    (select confirm_token_hash from internal.subscribers where id = v_id),
    null, 'newsletter_activate burns the confirmation token');

  -- activate is idempotent
  insert into tap_results(line) select ok(
    not public.newsletter_activate(v_id, now()),
    'newsletter_activate returns false on a second attempt');

  -- unsubscribe read + mark
  select s.status::text into v_status from public.newsletter_get_subscriber_for_unsub(v_id) s;
  insert into tap_results(line) select is(v_status, 'active', 'newsletter_get_subscriber_for_unsub returns the current status');
  insert into tap_results(line) select ok(
    public.newsletter_mark_unsubscribed(v_id, now()),
    'newsletter_mark_unsubscribed transitions active to unsubscribed');
  insert into tap_results(line) select ok(
    not public.newsletter_mark_unsubscribed(v_id, now()),
    'newsletter_mark_unsubscribed is idempotent');

  -- send failure log
  perform public.newsletter_log_send_failure('warn', 'pgtap log');
  insert into tap_results(line) select is(
    (select count(*)::int from internal.job_logs where code='email_send_failed' and message='pgtap log'),
    1, 'newsletter_log_send_failure appends a job_logs row');
end;
$fn$;

-- ================= security: only service_role may execute ===================
insert into tap_results(line) select ok(pg_temp.denied($q$select public.newsletter_find_subscriber('x@example.com')$q$,'anon'), 'anon canNOT execute newsletter_find_subscriber (no email enumeration)');
insert into tap_results(line) select ok(pg_temp.denied($q$select public.newsletter_insert_pending('{"email":"x@example.com","unsubscribe_token_hash":"h","consent_text_version":"v"}'::jsonb)$q$,'anon'), 'anon canNOT execute newsletter_insert_pending');
insert into tap_results(line) select ok(pg_temp.denied($q$select public.newsletter_pending_with_confirm_tokens()$q$,'authenticated'), 'authenticated canNOT execute newsletter_pending_with_confirm_tokens');
insert into tap_results(line) select ok(not pg_temp.denied($q$select public.newsletter_find_subscriber('x@example.com')$q$,'service_role'), 'service_role CAN execute newsletter_find_subscriber');

-- ================= structural: grants are what we expect =====================
insert into tap_results(line) select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname like 'newsletter\_%'
     and (not p.prosecdef
          or has_function_privilege('anon', p.oid, 'EXECUTE')
          or has_function_privilege('authenticated', p.oid, 'EXECUTE')
          or not has_function_privilege('service_role', p.oid, 'EXECUTE'))),
  0, 'every newsletter_* function is SECURITY DEFINER, service_role only');

insert into tap_results(line) select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname like 'newsletter\_%'),
  11, 'exactly 11 public.newsletter_* functions exist');

-- Emit every TAP line, then any plan diagnostics from finish().
select lpad(seq::text, 6, '0') as seq, line from tap_results
union all select '999999', 'FINISH: ' || f from finish() f
order by 1;
rollback;
