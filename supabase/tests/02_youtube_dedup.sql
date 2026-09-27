-- ============================================================================
-- Phase 1 test 02 — YouTube deduplication and the used terminal state
-- ============================================================================
-- pgTAP. Runs inside a transaction that ROLLS BACK, so it is safe against any
-- environment including the live project: no fixture survives the run.
--
-- Run with:  npm run test:db        (needs DATABASE_URL, see scripts/run-db-tests.mjs)
-- ============================================================================

begin;
set local search_path = extensions, public, internal;
select plan(22);
create temp table tap_results(seq serial primary key, line text) on commit drop;

-- Fixtures are real videos from the source channel.
insert into internal.youtube_videos (youtube_video_id, title, published_at, view_count, duration_seconds)
values
  ('An4HFu4EwFQ', 'Số 118: THIẾU MAGIE CƠ THỂ SỤP ĐỔ NHƯ THẾ NÀO?', '2026-06-27T02:00:00Z', 424298, 12164),
  ('lBKtncuS0yY', 'Số 132: "Vắc xin ung thư" viết lại tương lai ung thư học', '2026-09-19T02:00:07Z', 278189, 19710);

create temp table fx(k text primary key, v uuid) on commit drop;
insert into fx values
  ('cat',    (select id from public.categories where slug = 'vi-chat-vitamin')),
  ('magie',  (select id from internal.youtube_videos where youtube_video_id = 'An4HFu4EwFQ')),
  ('vaccine',(select id from internal.youtube_videos where youtube_video_id = 'lBKtncuS0yY'));

-- ============================ dedup: the video ==============================
insert into tap_results(line) select throws_ok(
  $q$insert into internal.youtube_videos (youtube_video_id, title, published_at)
     values ('An4HFu4EwFQ', 'A re-ingest of the same video', '2026-06-27T02:00:00Z')$q$,
  '23505', null, 'duplicate youtube_video_id is rejected by the database');
insert into tap_results(line) select lives_ok(
  $q$insert into internal.youtube_videos (youtube_video_id, title, published_at)
     values ('hkP4Heyobuc', 'Số 121: Kỹ thuật thở 4 - 7 - 8', '2026-07-04T02:00:00Z')$q$,
  'a genuinely different video id inserts fine');
insert into tap_results(line) select throws_ok(
  $q$insert into internal.youtube_videos (youtube_video_id, title, published_at)
     values ('https://www.youtube.com/watch?v=An4HFu4EwFQ', 'URL instead of id', now())$q$,
  '23514', null, 'a URL-shaped / wrong-length video id is rejected by the format CHECK');
insert into tap_results(line) select throws_ok(
  $q$insert into internal.youtube_videos (youtube_video_id, title, published_at, duration_seconds)
     values ('aaaaaaaaaaa', 'Negative duration', now(), -5)$q$,
  '23514', null, 'a negative duration is rejected');

-- ==================== generated columns cannot drift ========================
insert into tap_results(line) select is(
  (select title_fingerprint from internal.youtube_videos where youtube_video_id = 'An4HFu4EwFQ'),
  'so 118 thieu magie co the sup do nhu the nao',
  'title_fingerprint is generated from the title (soft re-upload detection)');
insert into tap_results(line) select is(
  (select url from internal.youtube_videos where youtube_video_id = 'An4HFu4EwFQ'),
  'https://www.youtube.com/watch?v=An4HFu4EwFQ',
  'url is generated from the video id');

-- ==================== dedup: one article per video ==========================
insert into tap_results(line) select throws_ok(
  format($q$insert into public.articles
      (slug,title,dek,body_blocks,body_text,word_count,article_type,category_id,source_video_id)
    values ('bai-mot','Bài một','Dek một','[]','text',800,'youtube',%L,%L),
           ('bai-hai','Bài hai','Dek hai','[]','text',800,'youtube',%L,%L)$q$,
    (select v from fx where k='cat'), (select v from fx where k='magie'),
    (select v from fx where k='cat'), (select v from fx where k='magie')),
  '23505', null, 'two articles cannot share one source_video_id: never two articles from one video');
insert into tap_results(line) select lives_ok(
  format($q$insert into public.articles
      (slug,title,dek,body_blocks,body_text,word_count,article_type,category_id,source_video_id)
    values ('bai-magie','Bài magie','Dek','[]','text',800,'youtube',%L,%L),
           ('bai-vaccine','Bài vaccine','Dek','[]','text',800,'youtube',%L,%L)$q$,
    (select v from fx where k='cat'), (select v from fx where k='magie'),
    (select v from fx where k='cat'), (select v from fx where k='vaccine')),
  'two articles from two DIFFERENT videos are allowed');
insert into tap_results(line) select throws_ok(
  format($q$insert into public.articles
      (slug,title,dek,body_blocks,body_text,word_count,article_type,category_id)
    values ('bai-khong-nguon','Không nguồn','Dek','[]','text',800,'youtube',%L)$q$,
    (select v from fx where k='cat')),
  '23514', null, 'a youtube article without a source video is rejected');

-- ==================== hero / accessibility constraints ======================
insert into tap_results(line) select is(
  (select hero_kind::text from public.articles where slug = 'bai-magie'),
  'none', 'a new article defaults to hero_kind none (no artwork chosen yet)');
insert into tap_results(line) select throws_ok(
  format($q$insert into public.articles
      (slug,title,dek,body_blocks,body_text,word_count,article_type,category_id,source_video_id,
       hero_kind,hero_image_url,hero_attribution)
    values ('bai-thieu-alt','Thiếu alt','Dek','[]','text',800,'youtube',%L,%L,
            'youtube_thumbnail','https://i.ytimg.com/vi/x/hqdefault.jpg','YouTube')$q$,
    (select v from fx where k='cat'), (select id from internal.youtube_videos where youtube_video_id='hkP4Heyobuc')),
  '23514', null, 'a hero image without alt text is rejected (accessibility)');
insert into tap_results(line) select throws_ok(
  format($q$insert into public.articles
      (slug,title,dek,body_blocks,body_text,word_count,article_type,category_id,source_video_id,
       hero_kind,hero_alt)
    values ('bai-thieu-credit','Thiếu credit','Dek','[]','text',800,'youtube',%L,%L,
            'youtube_thumbnail','Alt text')$q$,
    (select v from fx where k='cat'), (select id from internal.youtube_videos where youtube_video_id='hkP4Heyobuc')),
  '23514', null, 'a thumbnail hero without a URL and credit is rejected: attribution is structural');
insert into tap_results(line) select throws_ok(
  $q$update public.articles set status='published', published_at=now(), published_date_hanoi=current_date
     where slug='bai-magie'$q$,
  '23514', null, 'an article with no hero cannot be published (every published article carries visuals)');

-- ==================== used is a terminal state ==============================
update internal.youtube_videos set status = 'used', processed_at = now()
where youtube_video_id = 'An4HFu4EwFQ';

insert into tap_results(line) select is(
  (select status::text from internal.youtube_videos where youtube_video_id = 'An4HFu4EwFQ'),
  'used', 'available -> used is allowed');
insert into tap_results(line) select throws_ok(
  $q$update internal.youtube_videos set status = 'available' where youtube_video_id = 'An4HFu4EwFQ'$q$,
  '23514', null, 'used -> available is rejected: a used video can never re-enter the pool');
insert into tap_results(line) select throws_ok(
  $q$update internal.youtube_videos set status = 'selected' where youtube_video_id = 'An4HFu4EwFQ'$q$,
  '23514', null, 'used -> selected is rejected too');
insert into tap_results(line) select lives_ok(
  $q$update internal.youtube_videos set view_count = 999999 where youtube_video_id = 'An4HFu4EwFQ'$q$,
  'a used row can still be updated in non-status columns (view counts keep refreshing)');

-- ==================== ineligibility bookkeeping =============================
insert into tap_results(line) select throws_ok(
  $q$insert into internal.youtube_videos (youtube_video_id, title, published_at, status)
     values ('bbbbbbbbbbb', 'Ineligible with no reason', now(), 'ineligible')$q$,
  '23514', null, 'an ineligible video must record why');
insert into tap_results(line) select throws_ok(
  $q$insert into internal.youtube_videos (youtube_video_id, title, published_at, ineligible_reason)
     values ('ccccccccccc', 'Available but has a reason', now(), 'is_short')$q$,
  '23514', null, 'a non-ineligible video must not carry an ineligibility reason');

-- ============ selection ordering: several uploads on one day ================
-- Two videos published the same day plus an older, far more popular one. The newest
-- must win today, and the older backlog entry must rank last despite the view count.
insert into internal.youtube_videos (youtube_video_id, title, published_at, view_count)
values ('ddddddddddd', 'Same-day upload A', '2026-09-26T02:00:00Z', 1000),
       ('eeeeeeeeeee', 'Same-day upload B', '2026-09-26T09:00:00Z', 500),
       ('fffffffffff', 'Old but very popular', '2025-01-01T02:00:00Z', 9000000);

insert into tap_results(line) select is(
  (select array_agg(youtube_video_id order by
       (published_at > now() - interval '21 days') desc, published_at desc, view_count desc nulls last)
   from internal.youtube_videos
   where status = 'available' and possible_duplicate_of is null
     and youtube_video_id in ('ddddddddddd','eeeeeeeeeee','fffffffffff')),
  array['eeeeeeeeeee','ddddddddddd','fffffffffff'],
  'selection order: newest fresh first, same-day runner-up next, old high-view backlog last');

insert into tap_results(line) select throws_ok(
  $q$update internal.youtube_videos set possible_duplicate_of = id where youtube_video_id = 'ddddddddddd'$q$,
  '23514', null, 'a video cannot be marked as its own duplicate');

update internal.youtube_videos
set possible_duplicate_of = (select id from internal.youtube_videos where youtube_video_id='eeeeeeeeeee')
where youtube_video_id = 'ddddddddddd';
insert into tap_results(line) select is(
  (select count(*)::int from internal.youtube_videos
   where status='available' and possible_duplicate_of is null
     and youtube_video_id in ('ddddddddddd','eeeeeeeeeee','fffffffffff')),
  2, 'a suspected duplicate is excluded from the selection pool');

-- Emit every TAP line, then any plan diagnostics from finish(). The runner fails
-- the suite if any line starts with "not ok" or if finish() reports a plan
-- mismatch (which would mean an assertion silently did not run).
select lpad(seq::text, 6, '0') as seq, line from tap_results
union all select '999999', 'FINISH: ' || f from finish() f
order by 1;
rollback;
