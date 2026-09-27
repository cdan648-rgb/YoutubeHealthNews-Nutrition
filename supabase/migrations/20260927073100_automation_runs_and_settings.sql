-- ============================================================================
-- Phase 1 / 0007 — internal.automation_runs, automation_settings, job_logs
-- ============================================================================
-- automation_runs is the heart of the one-article-per-Hanoi-day guarantee.
-- UNIQUE(hanoi_date) means the scheduler can claim a day with a single atomic
-- INSERT ... ON CONFLICT DO NOTHING RETURNING id. No row returned means the day is
-- already claimed, so a retry, a duplicate cron firing and two concurrent ticks all
-- converge on "do nothing" without any application-level locking.

create table internal.automation_runs (
  id                  uuid primary key default gen_random_uuid(),

  -- The Hanoi calendar date this run belongs to. A PLAIN date column, supplied by
  -- the caller: timestamptz AT TIME ZONE is STABLE, not IMMUTABLE, so Postgres
  -- rejects it in a generated column or an index.
  hanoi_date          date not null unique,

  trigger             text not null default 'cron',
  result              internal.run_result not null default 'running',
  stage               text not null default 'claimed',

  -- Completed stage outputs (extract/write/seo/verify). Persisted so a resumed run
  -- continues where it stopped and never re-pays for an LLM call.
  artifacts           jsonb not null default '{}',

  -- Cooperative lease. The scheduler only drives a run whose lease has expired,
  -- taking the new lease in the same atomic UPDATE ... RETURNING, so two ticks
  -- cannot drive one run concurrently.
  lease_until         timestamptz,
  lease_token         uuid,

  attempt_count       integer not null default 0,

  source_kind         internal.source_kind not null default 'none',
  youtube_video_id    uuid references internal.youtube_videos(id) on delete set null,
  research_source_id  uuid references public.research_sources(id) on delete set null,
  -- article_id FK is added in the articles migration (circular reference).
  article_id          uuid,

  -- Observability copy of the DERIVED streak. Never read as truth: the streak is
  -- always recomputed from run history, so a stale or hand-edited value here cannot
  -- change publishing behaviour.
  streak_at_decision  integer,

  started_at          timestamptz not null default now(),
  completed_at        timestamptz,

  error_stage         text,
  error               jsonb,
  timings             jsonb not null default '{}',

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  -- A terminal run must be closed out; a running one must not be.
  constraint terminal_runs_are_completed
    check ((result = 'running') = (completed_at is null)),
  -- Only a publishing result may name an article.
  constraint article_only_when_published
    check (article_id is null or result in ('published','research_published')),
  -- A publishing result must agree with its source kind.
  constraint published_source_agrees
    check (
      (result = 'published'          and source_kind = 'youtube')  or
      (result = 'research_published' and source_kind = 'research') or
      result not in ('published','research_published')
    )
);

create index automation_runs_active  on internal.automation_runs (lease_until) where result = 'running';
create index automation_runs_recent  on internal.automation_runs (hanoi_date desc);
create index automation_runs_streak  on internal.automation_runs (hanoi_date desc) where result = 'no_source';

create trigger automation_runs_set_updated_at
  before update on internal.automation_runs
  for each row execute function internal.set_updated_at();

comment on table internal.automation_runs is
  'One row per Hanoi calendar day the scheduler acted on. UNIQUE(hanoi_date) is half of the one-automatic-article-per-day guarantee; articles.automation_run_id UNIQUE is the other half.';
comment on column internal.automation_runs.hanoi_date is
  'Asia/Ho_Chi_Minh calendar date. Plain column by necessity: AT TIME ZONE is STABLE, not IMMUTABLE, so it cannot be generated or indexed as an expression.';
comment on column internal.automation_runs.streak_at_decision is
  'Observability only. The no-source streak is always derived from run history; this copy is never read as truth.';

-- ---------------------------------------------------------------------------
-- internal.automation_settings — singleton
--
-- Operational behaviour lives here rather than in environment variables so it can
-- be changed without a deploy (pausing the automation at 2am should not need a
-- redeploy). The bool primary key with a CHECK is the standard one-row idiom.
-- ---------------------------------------------------------------------------
create table internal.automation_settings (
  id                      boolean primary key default true constraint settings_is_singleton check (id),

  -- IANA identifier, never a fixed offset: the offset is a fact about today, the
  -- identifier is a fact about the place. Vietnam has no DST today; this stays
  -- correct if that ever changes.
  timezone                text not null default 'Asia/Ho_Chi_Minh',

  publish_hour_local      integer not null default 11
                            constraint publish_hour_valid check (publish_hour_local between 0 and 23),
  publish_window_end_hour integer not null default 22
                            constraint window_end_valid check (publish_window_end_hour between 0 and 23),
  abandon_hour_local      integer not null default 23
                            constraint abandon_hour_valid check (abandon_hour_local between 0 and 23),

  no_source_threshold     integer not null default 3
                            constraint threshold_positive check (no_source_threshold >= 1),
  fresh_window_days       integer not null default 21
                            constraint fresh_window_positive check (fresh_window_days >= 1),

  require_approval        boolean not null default true,
  paused                  boolean not null default false,
  dry_run                 boolean not null default false,

  daily_send_cap          integer not null default 90
                            constraint send_cap_nonnegative check (daily_send_cap >= 0),

  -- Deterministic description cleaning: everything from the first marker onward is
  -- channel boilerplate, not editorial content. Data, not code, so a change to the
  -- channel's template is a settings update.
  boilerplate_markers     text[] not null default '{}',

  -- Topics that must never be auto-published however well the text validates.
  restricted_topics       text[] not null default '{}',

  -- Only these hosts may be cited as authoritative sources.
  allowed_reference_hosts text[] not null default '{}',

  journal_tiers           jsonb not null default '{}',

  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),

  -- The window must be orderable, and abandonment must come after it closes.
  constraint window_is_ordered check (publish_hour_local <= publish_window_end_hour),
  constraint abandon_after_window check (abandon_hour_local >= publish_window_end_hour)
);

create trigger automation_settings_set_updated_at
  before update on internal.automation_settings
  for each row execute function internal.set_updated_at();

comment on table internal.automation_settings is
  'Singleton. Operational behaviour kept in the database, not environment variables, so it is changeable without a deploy.';

-- ---------------------------------------------------------------------------
-- internal.job_logs — append-only observability
--
-- One stable `code` per failure mode, so "what broke?" is one grouped query rather
-- than log archaeology.
-- ---------------------------------------------------------------------------
create table internal.job_logs (
  id       bigint generated always as identity primary key,
  run_id   uuid references internal.automation_runs(id) on delete cascade,
  ts       timestamptz not null default now(),
  level    text not null default 'info'
             constraint level_valid check (level in ('debug','info','warn','error')),
  stage    text,
  code     text not null,
  message  text,
  context  jsonb not null default '{}'
);

create index job_logs_run    on internal.job_logs (run_id, ts);
create index job_logs_code   on internal.job_logs (code, ts desc);
create index job_logs_errors on internal.job_logs (ts desc) where level in ('warn','error');

comment on table internal.job_logs is
  'Append-only run log. Stable code values (ingest_api_failed, ai_malformed_output, validation_failed, ...) make failure modes queryable.';
