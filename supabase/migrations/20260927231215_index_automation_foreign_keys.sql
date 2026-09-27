-- ============================================================================
-- Phase 10 / 0018 — covering indexes for the automation foreign keys
-- ============================================================================
-- The performance advisor flags four foreign keys with no covering index. The tables
-- are small (automation_runs is one row per Hanoi day), so the query-time cost is
-- negligible today — but an uncovered FK forces a sequential scan of the child table
-- whenever a parent row is deleted, and these indexes are cheap and additive. Adding
-- them is the conservative hardening choice.
--
-- Phase 1 deliberately indexed only "the one FK that mattered" for the read paths that
-- existed then; these cover the delete/join paths the later phases introduced.

create index if not exists automation_runs_article_idx
  on internal.automation_runs (article_id) where article_id is not null;

create index if not exists automation_runs_youtube_video_idx
  on internal.automation_runs (youtube_video_id) where youtube_video_id is not null;

create index if not exists automation_runs_research_source_idx
  on internal.automation_runs (research_source_id) where research_source_id is not null;

create index if not exists youtube_videos_possible_duplicate_idx
  on internal.youtube_videos (possible_duplicate_of) where possible_duplicate_of is not null;
