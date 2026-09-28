-- ============================================================================
-- Automation worker RPC facade — make /api/automation/tick work without
-- exposing the `internal` schema to the Data API.
-- ============================================================================
-- ROOT CAUSE this migration addresses:
--   The Next.js worker reached `internal` tables/functions through PostgREST with
--   a client configured `db: { schema: 'internal' }`. The service-role key
--   bypasses RLS but NOT PostgREST's exposed-schema allowlist, and `internal` is
--   intentionally kept off that list. Every such call failed with
--   `Invalid schema: internal` — first observed as "settings read failed".
--
-- FIX:
--   Narrowly scoped SECURITY DEFINER functions in the already-exposed `public`
--   schema, one per operation the automation tick performs. Each:
--     * runs with `search_path = ''` and fully schema-qualifies every reference,
--       so it cannot be hijacked by a caller's search_path;
--     * has EXECUTE revoked from public/anon/authenticated and granted only to
--       service_role — the role the server's service-role key authenticates as.
--   `internal` stays entirely private: anon/authenticated gain no new reach, and
--   no `internal` object is added to the Data API.
--
-- These wrap ONLY the operations /api/automation/tick needs. Newsletter, admin
-- and other paths are deliberately out of scope for this migration.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Settings
-- ---------------------------------------------------------------------------
create or replace function public.automation_get_settings()
returns table (
  timezone text,
  publish_hour_local integer,
  publish_window_end_hour integer,
  abandon_hour_local integer,
  no_source_threshold integer,
  fresh_window_days integer,
  require_approval boolean,
  paused boolean,
  dry_run boolean,
  daily_send_cap integer,
  boilerplate_markers text[],
  restricted_topics text[],
  allowed_reference_hosts text[],
  journal_tiers jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select s.timezone, s.publish_hour_local, s.publish_window_end_hour, s.abandon_hour_local,
         s.no_source_threshold, s.fresh_window_days, s.require_approval, s.paused, s.dry_run,
         s.daily_send_cap, s.boilerplate_markers, s.restricted_topics, s.allowed_reference_hosts,
         s.journal_tiers
  from internal.automation_settings s
  limit 1;
$$;

comment on function public.automation_get_settings() is
  'Automation worker: read the settings singleton. Wraps internal.automation_settings so the worker never needs the internal schema exposed.';

-- ---------------------------------------------------------------------------
-- Automation runs
-- ---------------------------------------------------------------------------
create or replace function public.automation_get_run(p_day date)
returns table (
  id uuid,
  result internal.run_result,
  stage text,
  attempt_count integer,
  lease_until timestamptz,
  hanoi_date date
)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id, r.result, r.stage, r.attempt_count, r.lease_until, r.hanoi_date
  from internal.automation_runs r
  where r.hanoi_date = p_day;
$$;

comment on function public.automation_get_run(date) is
  'Automation worker: the run for a Hanoi day, if one exists.';

create or replace function public.automation_claim_day(p_day date, p_trigger text default 'cron')
returns uuid
language sql
security definer
set search_path = ''
as $$
  insert into internal.automation_runs (hanoi_date, trigger, result, stage)
  values (p_day, coalesce(p_trigger, 'cron'), 'running', 'claimed')
  on conflict (hanoi_date) do nothing
  returning id;
$$;

comment on function public.automation_claim_day(date, text) is
  'Automation worker: claim a Hanoi day. Returns the new run id, or null when the day is already claimed (the unique constraint deciding the winner).';

create or replace function public.automation_record_skipped_window(p_day date)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into internal.automation_runs (hanoi_date, trigger, result, stage, completed_at)
  values (p_day, 'cron', 'skipped_window', 'done', now())
  on conflict (hanoi_date) do nothing;
  return found;
end;
$$;

comment on function public.automation_record_skipped_window(date) is
  'Automation worker: record that a day''s window closed with no run. False when a run already exists.';

create or replace function public.automation_list_running()
returns table (id uuid, hanoi_date date, attempt_count integer)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id, r.hanoi_date, r.attempt_count
  from internal.automation_runs r
  where r.result = 'running'
  order by r.hanoi_date asc;
$$;

comment on function public.automation_list_running() is
  'Automation worker: runs still in progress, oldest first.';

create or replace function public.automation_expire_run(p_run_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update internal.automation_runs
  set result = 'expired', completed_at = now(), lease_until = null, lease_token = null
  where id = p_run_id and result = 'running';
$$;

comment on function public.automation_expire_run(uuid) is
  'Automation worker: expire a still-running run so it can no longer publish.';

create or replace function public.automation_acquire_lease(
  p_run_id uuid,
  p_token uuid,
  p_lease_until timestamptz,
  p_now timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update internal.automation_runs
  set lease_until = p_lease_until, lease_token = p_token
  where id = p_run_id
    and result = 'running'
    and (lease_until is null or lease_until < p_now);
  return found;
end;
$$;

comment on function public.automation_acquire_lease(uuid, uuid, timestamptz, timestamptz) is
  'Automation worker: take the lease on an un-driven run in one statement. False when another driver holds it.';

create or replace function public.automation_save_stage(
  p_run_id uuid,
  p_token uuid,
  p_stage text,
  p_artifacts jsonb default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update internal.automation_runs
  set stage = p_stage,
      artifacts = case when p_artifacts is null then artifacts else p_artifacts end
  where id = p_run_id and lease_token = p_token;
  return found;
end;
$$;

comment on function public.automation_save_stage(uuid, uuid, text, jsonb) is
  'Automation worker: persist stage progress (and artifacts, if given), only while the caller still holds the lease. Null artifacts means leave them unchanged.';

create or replace function public.automation_load_artifacts(p_run_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(r.artifacts, '{}'::jsonb)
  from internal.automation_runs r
  where r.id = p_run_id;
$$;

comment on function public.automation_load_artifacts(uuid) is
  'Automation worker: the artifacts blob for a run, so a resume can skip completed stages.';

create or replace function public.automation_increment_attempt(p_run_id uuid)
returns integer
language sql
security definer
set search_path = ''
as $$
  update internal.automation_runs
  set attempt_count = attempt_count + 1
  where id = p_run_id
  returning attempt_count;
$$;

comment on function public.automation_increment_attempt(uuid) is
  'Automation worker: bump and return the attempt counter in one statement.';

create or replace function public.automation_finish(
  p_run_id uuid,
  p_result internal.run_result,
  p_source_kind internal.source_kind default null,
  p_article_id uuid default null,
  p_streak integer default null,
  p_error_stage text default null,
  p_error jsonb default null
)
returns void
language sql
security definer
set search_path = ''
as $$
  update internal.automation_runs
  set result = p_result,
      completed_at = now(),
      lease_until = null,
      lease_token = null,
      source_kind = coalesce(p_source_kind, source_kind),
      article_id = coalesce(p_article_id, article_id),
      streak_at_decision = coalesce(p_streak, streak_at_decision),
      error_stage = coalesce(p_error_stage, error_stage),
      error = coalesce(p_error, error)
  where id = p_run_id and result = 'running';
$$;

comment on function public.automation_finish(uuid, internal.run_result, internal.source_kind, uuid, integer, text, jsonb) is
  'Automation worker: close a run out. Scoped to result=running, so finishing twice is a no-op. Null optional args leave the corresponding column unchanged.';

create or replace function public.automation_no_source_streak(p_day date)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select internal.no_source_streak(p_day);
$$;

comment on function public.automation_no_source_streak(date) is
  'Automation worker: consecutive prior no_source days for a decision day.';

-- ---------------------------------------------------------------------------
-- Job logs
-- ---------------------------------------------------------------------------
create or replace function public.automation_log(
  p_code text,
  p_run_id uuid default null,
  p_level text default 'info',
  p_stage text default null,
  p_message text default null,
  p_context jsonb default '{}'::jsonb
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into internal.job_logs (run_id, level, stage, code, message, context)
  values (p_run_id, coalesce(p_level, 'info'), p_stage, p_code, p_message, coalesce(p_context, '{}'::jsonb));
$$;

comment on function public.automation_log(text, uuid, text, text, text, jsonb) is
  'Automation worker: append a run-log line to internal.job_logs.';

-- ---------------------------------------------------------------------------
-- YouTube source records
-- ---------------------------------------------------------------------------
create or replace function public.automation_youtube_existing(p_ids text[])
returns table (
  id uuid,
  youtube_video_id text,
  title_fingerprint text,
  episode_number integer,
  status internal.video_status
)
language sql
stable
security definer
set search_path = ''
as $$
  select v.id, v.youtube_video_id, v.title_fingerprint, v.episode_number, v.status
  from internal.youtube_videos v
  where v.youtube_video_id = any(p_ids);
$$;

comment on function public.automation_youtube_existing(text[]) is
  'Automation worker (ingest): which of these video ids we already have.';

create or replace function public.automation_youtube_candidates()
returns table (
  id uuid,
  youtube_video_id text,
  title_fingerprint text,
  episode_number integer,
  status internal.video_status
)
language sql
stable
security definer
set search_path = ''
as $$
  select v.id, v.youtube_video_id, v.title_fingerprint, v.episode_number, v.status
  from internal.youtube_videos v;
$$;

comment on function public.automation_youtube_candidates() is
  'Automation worker (ingest): every row a re-upload could duplicate.';

create or replace function public.automation_youtube_insert(p jsonb)
returns uuid
language sql
security definer
set search_path = ''
as $$
  insert into internal.youtube_videos (
    youtube_video_id, title, episode_number, description_raw, description_clean,
    low_signal, keywords, chapters, duration_seconds, view_count, thumbnails,
    published_at, status, ineligible_reason, possible_duplicate_of
  )
  values (
    p->>'youtube_video_id',
    p->>'title',
    nullif(p->>'episode_number','')::integer,
    p->>'description_raw',
    p->>'description_clean',
    coalesce((p->>'low_signal')::boolean, false),
    case when p ? 'keywords' then array(select jsonb_array_elements_text(p->'keywords')) else '{}'::text[] end,
    coalesce(p->'chapters', '[]'::jsonb),
    nullif(p->>'duration_seconds','')::integer,
    nullif(p->>'view_count','')::integer,
    coalesce(p->'thumbnails', '{}'::jsonb),
    (p->>'published_at')::timestamptz,
    coalesce((p->>'status')::internal.video_status, 'available'),
    p->>'ineligible_reason',
    nullif(p->>'possible_duplicate_of','')::uuid
  )
  on conflict (youtube_video_id) do nothing
  returning id;
$$;

comment on function public.automation_youtube_insert(jsonb) is
  'Automation worker (ingest): insert a discovered video. Returns null on a unique conflict (a concurrent run got there first).';

create or replace function public.automation_youtube_update_metadata(p jsonb)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update internal.youtube_videos
  set title = p->>'title',
      description_raw = p->>'description_raw',
      description_clean = p->>'description_clean',
      low_signal = coalesce((p->>'low_signal')::boolean, false),
      keywords = case when p ? 'keywords' then array(select jsonb_array_elements_text(p->'keywords')) else '{}'::text[] end,
      chapters = coalesce(p->'chapters', '[]'::jsonb),
      duration_seconds = nullif(p->>'duration_seconds','')::integer,
      view_count = nullif(p->>'view_count','')::integer,
      thumbnails = coalesce(p->'thumbnails', '{}'::jsonb),
      episode_number = nullif(p->>'episode_number','')::integer
  where youtube_video_id = p->>'youtube_video_id';
  return found;
end;
$$;

comment on function public.automation_youtube_update_metadata(jsonb) is
  'Automation worker (ingest): refresh mutable metadata for an existing video. Never touches status (lifecycle is owned by the automation).';

create or replace function public.automation_youtube_mark_unavailable(
  p_youtube_video_id text,
  p_title text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from internal.youtube_videos where youtube_video_id = p_youtube_video_id) then
    -- Only an untouched (available) row is demoted; a used video keeps its status.
    update internal.youtube_videos
    set status = 'ineligible', ineligible_reason = 'unavailable'
    where youtube_video_id = p_youtube_video_id and status = 'available';
  else
    insert into internal.youtube_videos (youtube_video_id, title, published_at, status, ineligible_reason)
    values (p_youtube_video_id, p_title, now(), 'ineligible', 'unavailable');
  end if;
end;
$$;

comment on function public.automation_youtube_mark_unavailable(text, text) is
  'Automation worker (ingest): record a video that has disappeared, without resurrecting or demoting a used one.';

create or replace function public.automation_youtube_mark_used(p_video_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update internal.youtube_videos
  set status = 'used', processed_at = now()
  where id = p_video_id;
$$;

comment on function public.automation_youtube_mark_used(uuid) is
  'Automation worker (persist): mark the source video consumed.';

create or replace function public.automation_youtube_get(p_video_id uuid)
returns table (
  id uuid,
  youtube_video_id text,
  title text,
  description_raw text,
  description_clean text,
  keywords text[],
  duration_seconds integer,
  view_count integer,
  published_at timestamptz,
  thumbnails jsonb,
  url text,
  status internal.video_status
)
language sql
stable
security definer
set search_path = ''
as $$
  select v.id, v.youtube_video_id, v.title, v.description_raw, v.description_clean, v.keywords,
         v.duration_seconds, v.view_count, v.published_at, v.thumbnails, v.url, v.status
  from internal.youtube_videos v
  where v.id = p_video_id;
$$;

comment on function public.automation_youtube_get(uuid) is
  'Automation worker (generate/persist): the source video row for building the article.';

create or replace function public.automation_claim_next_video(p_fresh_window_days integer)
returns table (id uuid, youtube_video_id text, title text)
language sql
security definer
set search_path = ''
as $$
  select c.id, c.youtube_video_id, c.title
  from internal.claim_next_video(p_fresh_window_days) c;
$$;

comment on function public.automation_claim_next_video(integer) is
  'Automation worker (source): atomically claim the next video to turn into an article.';

-- ---------------------------------------------------------------------------
-- Research source claim
-- ---------------------------------------------------------------------------
create or replace function public.automation_claim_research_source(p jsonb)
returns table (id uuid, outcome text)
language sql
security definer
set search_path = ''
as $$
  select c.id, c.outcome
  from internal.claim_research_source(p) c;
$$;

comment on function public.automation_claim_research_source(jsonb) is
  'Automation worker (source): claim a research paper before generation, with all dedup checks inside one statement.';

-- ---------------------------------------------------------------------------
-- Reference verification cache
-- ---------------------------------------------------------------------------
create or replace function public.automation_reference_cache_get(p_key text)
returns table (
  url text,
  final_url text,
  http_status integer,
  host text,
  checked_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select c.url, c.final_url, c.http_status, c.host, c.checked_at
  from internal.reference_cache c
  where c.url_sha256 = p_key;
$$;

comment on function public.automation_reference_cache_get(text) is
  'Automation worker (verify): a cached reference-check result, if present.';

create or replace function public.automation_reference_cache_put(p jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into internal.reference_cache (url_sha256, url, final_url, http_status, host, checked_at, error)
  values (
    p->>'url_sha256',
    p->>'url',
    p->>'final_url',
    nullif(p->>'http_status','')::integer,
    p->>'host',
    coalesce((p->>'checked_at')::timestamptz, now()),
    p->>'error'
  )
  on conflict (url_sha256) do update
  set url = excluded.url,
      final_url = excluded.final_url,
      http_status = excluded.http_status,
      host = excluded.host,
      checked_at = excluded.checked_at,
      error = excluded.error;
$$;

comment on function public.automation_reference_cache_put(jsonb) is
  'Automation worker (verify): upsert a reference-check result.';

-- ---------------------------------------------------------------------------
-- Lock these down: server/service-role only. The `internal` schema stays private.
-- ---------------------------------------------------------------------------
do $grants$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname like 'automation\_%'
  loop
    execute format('revoke all on function %s from public', fn.sig);
    execute format('revoke all on function %s from anon', fn.sig);
    execute format('revoke all on function %s from authenticated', fn.sig);
    execute format('grant execute on function %s to service_role', fn.sig);
  end loop;
end;
$grants$;
