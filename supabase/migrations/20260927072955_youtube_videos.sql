-- ============================================================================
-- Phase 1 / 0005 — internal.youtube_videos
-- ============================================================================
-- The ingestion pool. One row per video ever seen on the channel. Selection
-- priority lives entirely in the ORDER BY of the selection query (see the index
-- below), not in a status column, so "several videos uploaded on one day" needs no
-- special handling: the newest wins today and the rest stay ahead of the old
-- backlog tomorrow because they are still inside the fresh window.

create table internal.youtube_videos (
  id                    uuid primary key default gen_random_uuid(),

  -- Dedup key #1: the 11-character YouTube id. Format is checked so a truncated or
  -- URL-shaped value can never be stored and silently fail to match later.
  youtube_video_id      text not null unique
                          constraint youtube_video_id_format
                          check (youtube_video_id ~ '^[A-Za-z0-9_-]{11}$'),

  title                 text not null,

  -- Soft duplicate detection (a re-upload gets a NEW 11-char id, so the unique
  -- constraint above cannot catch it). Episode numbers come from 'Số N' in the
  -- title; the fingerprint is generated, so it can never drift from the title.
  episode_number        integer,
  title_fingerprint     text not null
                          generated always as (internal.title_fingerprint(title)) stored,

  description_raw       text,
  description_clean     text,
  low_signal            boolean not null default false,

  keywords              text[] not null default '{}',
  chapters              jsonb  not null default '[]',

  duration_seconds      integer constraint duration_nonnegative check (duration_seconds is null or duration_seconds >= 0),
  view_count            bigint  constraint view_count_nonnegative check (view_count is null or view_count >= 0),

  -- Best-available variant is HEAD-probed once at ingest: maxresdefault.jpg 404s on
  -- many videos, so probing at render time would leave broken heroes.
  thumbnails            jsonb not null default '{}',

  url                   text generated always as
                          ('https://www.youtube.com/watch?v=' || youtube_video_id) stored,

  published_at          timestamptz not null,
  discovered_at         timestamptz not null default now(),
  processed_at          timestamptz,

  status                internal.video_status not null default 'available',
  ineligible_reason     text,
  possible_duplicate_of uuid references internal.youtube_videos(id) on delete set null,

  attempt_count         integer not null default 0,
  last_error            jsonb,
  metadata              jsonb not null default '{}',

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  -- An ineligible row must say why; anything else must not pretend to have a reason.
  constraint ineligible_has_reason
    check ((status = 'ineligible') = (ineligible_reason is not null)),
  -- A row cannot be its own duplicate.
  constraint duplicate_is_another_row
    check (possible_duplicate_of is null or possible_duplicate_of <> id)
);

-- Backs the selection query exactly: only genuinely selectable rows are indexed.
create index youtube_videos_selection
  on internal.youtube_videos (published_at desc, view_count desc nulls last)
  where status = 'available' and possible_duplicate_of is null;

create index youtube_videos_fingerprint_trgm
  on internal.youtube_videos using gin (title_fingerprint extensions.gin_trgm_ops);

create index youtube_videos_episode
  on internal.youtube_videos (episode_number) where episode_number is not null;

create index youtube_videos_status on internal.youtube_videos (status);

create trigger youtube_videos_set_updated_at
  before update on internal.youtube_videos
  for each row execute function internal.set_updated_at();

-- ---------------------------------------------------------------------------
-- 'used' is terminal.
--
-- Without this, archiving or deleting an article could return its video to the
-- pool and the same video would eventually yield a second article — defeating the
-- whole point of the per-video unique index on articles. Reprocessing is a
-- deliberate operation: delete the article row first (which releases the partial
-- unique index), then the video may be reset by a privileged path.
-- ---------------------------------------------------------------------------
create or replace function internal.enforce_used_is_terminal()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  raise exception
    'youtube_videos.status is terminal at ''used'' (video %, attempted %): delete the article that used it before reprocessing',
    old.youtube_video_id, new.status
    using errcode = 'check_violation';
end;
$fn$;

create trigger youtube_videos_used_is_terminal
  before update of status on internal.youtube_videos
  for each row
  when (old.status = 'used' and new.status <> 'used')
  execute function internal.enforce_used_is_terminal();

comment on table internal.youtube_videos is
  'Every video seen on the source channel. Dedup: unique youtube_video_id (hard) plus title fingerprint and episode number (soft, for re-uploads under a new id).';
