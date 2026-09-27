-- ============================================================================
-- Phase 1 / 0014 — cover the one foreign key where it actually matters
-- ============================================================================
-- The database linter reports five unindexed foreign keys. Four are on tables that
-- stay tiny and are deliberately left alone, because an index that is never used
-- still costs write time and storage:
--   automation_runs.youtube_video_id / research_source_id / article_id
--     -> one row per Hanoi day, so a few hundred rows a year, and the FKs are
--        ON DELETE SET NULL rather than CASCADE.
--   youtube_videos.possible_duplicate_of
--     -> bounded by the channel's size (136 videos today).
--
-- newsletter_sends.subscriber_id is different and does get an index:
--   * the table grows as subscribers x published articles, so it is the only one
--     with an unbounded row count;
--   * the FK is ON DELETE CASCADE, and deleting a subscriber is a real operation we
--     intend to support (a data-erasure request), which without this index means a
--     sequential scan of the whole send history;
--   * per-subscriber delivery history is the natural way to debug "did this reader
--     get that article?".

create index newsletter_sends_subscriber
  on internal.newsletter_sends (subscriber_id);

comment on index internal.newsletter_sends_subscriber is
  'Covers the ON DELETE CASCADE from subscribers (data-erasure requests) and per-subscriber delivery lookups. The other unindexed FKs are on bounded-size tables and are intentionally left uncovered.';
