-- ============================================================================
-- Phase 6 / 0016 — the cron tick, the derived streak, and housekeeping
-- ============================================================================
-- REFINEMENT to the approved design, and it removes a failure mode rather than adding one.
--
-- The plan had internal.tick() claim the Hanoi day and then POST to the worker. Review
-- flagged that pg_net sends after commit, so a failed send would leave the day claimed with
-- nothing ever running — a silently lost day, patched by a re-drive sweeper.
--
-- Here tick() ONLY invokes the worker. The worker performs the claim itself, as a single
-- INSERT ... ON CONFLICT DO NOTHING. The guarantee was never about which process issued
-- that statement — it is the unique constraint on hanoi_date — so nothing is weakened, and
-- a failed pg_net send now means simply "no tick happened", which the next tick fixes.
-- There is no state to be stranded in.

create or replace function internal.no_source_streak(decision_day date, max_lookback integer default 400)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  cursor_day date := decision_day - 1;
  streak integer := 0;
  found boolean;
begin
  loop
    exit when streak >= max_lookback;

    select exists (
      select 1 from internal.automation_runs
      where hanoi_date = cursor_day and result = 'no_source'
    ) into found;

    exit when not found;

    streak := streak + 1;
    cursor_day := cursor_day - 1;
  end loop;

  return streak;
end;
$fn$;

comment on function internal.no_source_streak(date, integer) is
  'Consecutive prior Hanoi dates that finished as no_source. A missing day stops the count rather than bridging it. Derived on every call; never stored.';

-- Worker URL and shared secret live in Vault, so the secret never appears in a migration,
-- a backup or a dump.
create or replace function internal.worker_config()
returns table (worker_url text, worker_secret text)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  return query
  select
    (select decrypted_secret from vault.decrypted_secrets where name = 'automation_worker_url' limit 1),
    (select decrypted_secret from vault.decrypted_secrets where name = 'automation_secret' limit 1);
end;
$fn$;

-- Invoked every 15 minutes. Does one thing: ask the worker to run. Frequent ticks are what
-- make recovery fast — a missed firing, a cold start or a transient 500 is simply retried a
-- quarter of an hour later, and the worker is idempotent by construction.
create or replace function internal.tick()
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  cfg record;
  paused boolean;
begin
  select * into cfg from internal.worker_config();

  if cfg.worker_url is null or cfg.worker_secret is null then
    insert into internal.job_logs (level, code, message)
    values ('warn', 'db_failed',
            'automation tick skipped: set the automation_worker_url and automation_secret Vault secrets');
    return;
  end if;

  select s.paused into paused from internal.automation_settings s where s.id;
  if coalesce(paused, false) then
    return;
  end if;

  perform net.http_post(
    url := cfg.worker_url,
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-automation-secret', cfg.worker_secret
    ),
    body := jsonb_build_object('trigger', 'cron', 'at', now()),
    timeout_milliseconds := 60000
  );
end;
$fn$;

comment on function internal.tick() is
  'Cron entry point. Invokes the worker over pg_net and nothing else: the worker claims the Hanoi day itself, so a failed send strands no state.';

revoke all on function internal.tick() from public;
revoke all on function internal.no_source_streak(date, integer) from public;
revoke all on function internal.worker_config() from public;
grant execute on function internal.no_source_streak(date, integer) to service_role;

-- pg_net records every response in net._http_response, which grows without bound, and
-- job_logs would too. Both are pruned daily.
create or replace function internal.housekeeping()
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  delete from net._http_response where created < now() - interval '7 days';
  delete from internal.job_logs where ts < now() - interval '90 days';
  delete from internal.reference_cache where checked_at < now() - interval '120 days';
  delete from internal.signup_attempts where ts < now() - interval '30 days';
end;
$fn$;

revoke all on function internal.housekeeping() from public;

-- pg_cron runs in UTC and has no per-job timezone, which is exactly why the tick is
-- frequent and dumb: the worker asks Postgres for the Hanoi date and decides for itself.
-- Nothing here encodes a Hanoi hour, so nothing here can be wrong about one.
select cron.schedule('automation-tick', '*/15 * * * *', $cron$select internal.tick();$cron$);
select cron.schedule('automation-housekeeping', '17 3 * * *', $cron$select internal.housekeeping();$cron$);
