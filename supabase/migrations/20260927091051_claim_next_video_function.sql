-- ============================================================================
-- Phase 4 / 0015 — atomic selection of the next video to process
-- ============================================================================
-- Why a SQL function rather than a query in the application: the read and the write must
-- be one statement. A plain `select ... limit 1` followed by an `update` lets two
-- concurrent runs read the same row before either writes, and both would then generate an
-- article from it. FOR UPDATE SKIP LOCKED makes the loser skip to the next candidate
-- instead of blocking or colliding.
--
-- The ORDER BY is the entire priority policy:
--   1. videos published inside the fresh window, newest first — a new upload always wins,
--      and when several land on one day the rest stay ahead of the archive on following
--      days because they are still inside the window;
--   2. then the remaining backlog by view count, best content first.
--
-- Freshness is judged on published_at (a property of the video), never discovered_at (a
-- property of when we happened to look). A late backfill must not make a three-year-old
-- episode look like breaking news.
--
-- Claiming flips the row to 'selected' in the same transaction, so money is never spent on
-- generation for a video another run also holds.

create or replace function internal.claim_next_video(fresh_window_days integer default 21)
returns table (id uuid, youtube_video_id text, title text)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  picked uuid;
begin
  select v.id into picked
  from internal.youtube_videos v
  where v.status = 'available'
    and v.possible_duplicate_of is null
  order by
    (v.published_at > now() - make_interval(days => fresh_window_days)) desc,
    v.published_at desc,
    v.view_count desc nulls last
  limit 1
  for update skip locked;

  if picked is null then
    return;
  end if;

  update internal.youtube_videos
  set status = 'selected'
  where internal.youtube_videos.id = picked;

  return query
  select v.id, v.youtube_video_id, v.title
  from internal.youtube_videos v
  where v.id = picked;
end;
$fn$;

comment on function internal.claim_next_video(integer) is
  'Atomically claims the next video to turn into an article (FOR UPDATE SKIP LOCKED), applying the fresh-window-then-view-count priority. Freshness uses published_at, never discovered_at.';

revoke all on function internal.claim_next_video(integer) from public;
grant execute on function internal.claim_next_video(integer) to service_role;
