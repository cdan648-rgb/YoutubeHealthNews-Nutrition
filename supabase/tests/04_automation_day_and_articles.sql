-- ============================================================================
-- Phase 1 test 04 — one automatic article per Hanoi day, and streak semantics
-- ============================================================================
-- pgTAP. Runs inside a transaction that ROLLS BACK, so it is safe against any
-- environment including the live project: no fixture survives the run.
--
-- Run with:  npm run test:db        (needs DATABASE_URL, see scripts/run-db-tests.mjs)
-- ============================================================================

begin;
set local search_path = extensions, public, internal;
select plan(24);
create temp table tap_results(seq serial primary key, line text) on commit drop;

create temp table fx(k text primary key, v uuid) on commit drop;
insert into fx values ('cat', (select id from public.categories where slug='vi-chat-vitamin'));
insert into internal.youtube_videos (youtube_video_id, title, published_at)
values ('An4HFu4EwFQ','Số 118: THIẾU MAGIE','2026-06-27T02:00:00Z'),
       ('lBKtncuS0yY','Số 132: Vắc xin ung thư','2026-09-19T02:00:07Z'),
       ('hkP4Heyobuc','Số 121: Kỹ thuật thở 4-7-8','2026-07-04T02:00:00Z');
insert into fx values
  ('v1',(select id from internal.youtube_videos where youtube_video_id='An4HFu4EwFQ')),
  ('v2',(select id from internal.youtube_videos where youtube_video_id='lBKtncuS0yY')),
  ('v3',(select id from internal.youtube_videos where youtube_video_id='hkP4Heyobuc'));

-- ============== one run per Hanoi calendar day ==============================
insert into internal.automation_runs (hanoi_date) values ('2026-09-28');

insert into tap_results(line) select throws_ok(
  $q$insert into internal.automation_runs (hanoi_date) values ('2026-09-28')$q$,
  '23505', null, 'a second run for the same Hanoi date is rejected');
insert into tap_results(line) select lives_ok(
  $q$insert into internal.automation_runs (hanoi_date) values ('2026-09-29')$q$,
  'a run for a different Hanoi date is fine');

-- The exact claim statement the scheduler uses. Re-running it must be a no-op,
-- which is what makes a duplicate cron firing and a retry both harmless.
do $blk$
declare claimed uuid;
begin
  insert into internal.automation_runs (hanoi_date, result, stage)
  values ('2026-09-28','running','claimed')
  on conflict (hanoi_date) do nothing returning id into claimed;
  insert into tap_results(line) select ok(claimed is null,
    'claiming an already-claimed Hanoi day returns NO row, so a duplicate tick is a no-op');
end $blk$;
do $blk$
declare claimed uuid;
begin
  insert into internal.automation_runs (hanoi_date, result, stage)
  values ('2026-09-30','running','claimed')
  on conflict (hanoi_date) do nothing returning id into claimed;
  insert into tap_results(line) select ok(claimed is not null,
    'claiming a fresh Hanoi day returns the new run id');
end $blk$;

-- ============== one article per run, hence one per Hanoi day ================
update internal.automation_runs set result='published', source_kind='youtube', completed_at=now()
where hanoi_date='2026-09-28';

insert into public.articles
  (slug,title,dek,body_blocks,body_text,word_count,article_type,category_id,source_video_id,
   automation_run_id,hero_kind,hero_alt,status,published_at,published_date_hanoi)
values ('bai-ngay-28','Bài ngày 28','Dek','[]','t',800,'youtube',
   (select v from fx where k='cat'), (select v from fx where k='v1'),
   (select id from internal.automation_runs where hanoi_date='2026-09-28'),
   'svg','Minh hoạ','published','2026-09-28T04:00:00Z','2026-09-28');

insert into tap_results(line) select throws_ok(
  format($q$insert into public.articles
      (slug,title,dek,body_blocks,body_text,word_count,article_type,category_id,source_video_id,automation_run_id,hero_kind,hero_alt)
    values ('bai-thu-hai-cung-ngay','Bài thứ hai cùng ngày','Dek','[]','t',800,'youtube',%L,%L,%L,'svg','Alt')$q$,
    (select v from fx where k='cat'), (select v from fx where k='v2'),
    (select id from internal.automation_runs where hanoi_date='2026-09-28')),
  '23505', null, 'a second article for the SAME run is rejected: one automatic article per Hanoi day');

-- Manual and seed articles carry automation_run_id IS NULL. Postgres allows
-- unlimited NULLs in a unique index, so editorial publishing is untouched by the cap.
insert into tap_results(line) select lives_ok(
  format($q$insert into public.articles
      (slug,title,dek,body_blocks,body_text,word_count,article_type,category_id,source_video_id,hero_kind,hero_alt)
    values ('bai-thu-cong-1','Thủ công 1','Dek','[]','t',800,'youtube',%L,%L,'svg','Alt'),
           ('bai-thu-cong-2','Thủ công 2','Dek','[]','t',800,'youtube',%L,%L,'svg','Alt')$q$,
    (select v from fx where k='cat'), (select v from fx where k='v2'),
    (select v from fx where k='cat'), (select v from fx where k='v3')),
  'several MANUAL articles with automation_run_id NULL are allowed on the same day');
insert into tap_results(line) select is(
  (select count(*)::int from public.articles where automation_run_id is null), 2,
  'both manual articles persisted alongside the automatic one');
insert into tap_results(line) select is(
  (select count(*)::int from public.articles a
     join internal.automation_runs r on r.id = a.automation_run_id
   where r.hanoi_date = '2026-09-28'),
  1, 'exactly one AUTOMATIC article exists for Hanoi date 2026-09-28');

-- ============== run bookkeeping constraints =================================
insert into tap_results(line) select throws_ok(
  $q$insert into internal.automation_runs (hanoi_date, result) values ('2026-10-01','no_source')$q$,
  '23514', null, 'a terminal run must record completed_at');
insert into tap_results(line) select throws_ok(
  $q$insert into internal.automation_runs (hanoi_date, result, completed_at) values ('2026-10-02','running',now())$q$,
  '23514', null, 'a still-running run must not have completed_at');
insert into tap_results(line) select throws_ok(
  format($q$insert into internal.automation_runs (hanoi_date, result, completed_at, article_id)
            values ('2026-10-03','no_source',now(),%L)$q$,
    (select id from public.articles where slug='bai-ngay-28')),
  '23514', null, 'only a publishing result may name an article');
insert into tap_results(line) select throws_ok(
  $q$insert into internal.automation_runs (hanoi_date, result, completed_at, source_kind)
     values ('2026-10-04','research_published',now(),'youtube')$q$,
  '23514', null, 'a research_published run must have source_kind research');

-- ============== article integrity ==========================================
insert into tap_results(line) select throws_ok(
  format($q$insert into public.articles
      (slug,title,dek,body_blocks,body_text,word_count,article_type,category_id,source_video_id,hero_kind,hero_alt,status,published_at)
    values ('bai-thieu-ngay','Thiếu ngày','Dek','[]','t',800,'youtube',%L,%L,'svg','Alt','published',now())$q$,
    (select v from fx where k='cat'), (select v from fx where k='v1')),
  '23514', null, 'a published article must carry published_date_hanoi as well as published_at');
insert into tap_results(line) select throws_ok(
  format($q$insert into public.articles
      (slug,title,dek,body_blocks,body_text,word_count,article_type,category_id,source_video_id,hero_kind,hero_alt)
    values ('bai-ngay-28','Trùng slug','Dek','[]','t',800,'youtube',%L,%L,'svg','Alt')$q$,
    (select v from fx where k='cat'), (select v from fx where k='v1')),
  '23505', null, 'a duplicate slug is rejected');
insert into tap_results(line) select throws_ok(
  format($q$insert into public.articles
      (slug,title,dek,body_blocks,body_text,word_count,article_type,category_id,source_video_id,hero_kind,hero_alt)
    values ('Bai_Hoa_Sai','Slug sai','Dek','[]','t',800,'youtube',%L,%L,'svg','Alt')$q$,
    (select v from fx where k='cat'), (select v from fx where k='v1')),
  '23514', null, 'a slug with uppercase or underscores is rejected');
insert into tap_results(line) select throws_ok(
  format($q$insert into public.articles
      (slug,title,dek,body_blocks,body_text,word_count,article_type,category_id,source_video_id,hero_kind,hero_alt)
    values ('bai-khong-chu','Không chữ','Dek','[]','t',0,'youtube',%L,%L,'svg','Alt')$q$,
    (select v from fx where k='cat'), (select v from fx where k='v1')),
  '23514', null, 'an article with zero words is rejected');
insert into tap_results(line) select throws_ok(
  format($q$insert into public.articles
      (slug,title,dek,body_blocks,body_text,word_count,article_type,category_id,source_video_id,hero_kind,hero_alt)
    values ('bai-blocks-sai','Blocks sai','Dek','{"t":"p"}','t',800,'youtube',%L,%L,'svg','Alt')$q$,
    (select v from fx where k='cat'), (select v from fx where k='v1')),
  '23514', null, 'body_blocks must be a JSON array');
insert into tap_results(line) select is(
  (select reading_minutes from public.articles where slug='bai-ngay-28'), 4,
  'reading_minutes is generated from word_count (800 words -> 4 min)');

-- ============== the Hanoi/UTC boundary the app must honour ==================
-- 17:00Z is still 27 Sept in UTC but already 28 Sept in Hanoi. published_date_hanoi
-- must follow HANOI, which is exactly why the application writes it.
insert into tap_results(line) select is(
  ('2026-09-27T17:00:00Z'::timestamptz at time zone 'Asia/Ho_Chi_Minh')::date, '2026-09-28'::date,
  'the instant 17:00Z belongs to the NEXT Hanoi calendar day, not the UTC one');
insert into tap_results(line) select is(
  (select published_date_hanoi from public.articles where slug='bai-ngay-28'),
  (select (published_at at time zone 'Asia/Ho_Chi_Minh')::date from public.articles where slug='bai-ngay-28'),
  'published_date_hanoi agrees with the Hanoi conversion of published_at');

-- ============== no-source streak, in Hanoi calendar dates ==================
-- Canonical semantics, pinned here as the spec for the Phase 2 tick():
--   count back from D-1 while a run exists for that Hanoi date with result
--   'no_source'. A MISSING day stops the count (we never checked, so we cannot
--   claim it was dry), and so does any non-'no_source' terminal result.
insert into internal.automation_runs (hanoi_date, result, completed_at, source_kind) values
  ('2026-02-12','no_source',now(),'none'),
  ('2026-02-13','no_source',now(),'none'),
  ('2026-02-14','no_source',now(),'none');

create temp view streak as
  select d0.day as decision_day,
         (with recursive s(d,n) as (
            select d0.day - 1, 1
            where exists (select 1 from internal.automation_runs
                          where hanoi_date = d0.day - 1 and result = 'no_source')
            union all
            select s.d - 1, s.n + 1 from s
            where exists (select 1 from internal.automation_runs
                          where hanoi_date = s.d - 1 and result = 'no_source'))
          select coalesce(max(n),0)::int from s) as value
  from (values ('2026-02-15'::date), ('2026-02-16'::date)) d0(day);

insert into tap_results(line) select is(
  (select value from streak where decision_day='2026-02-15'), 3,
  'three consecutive dry Hanoi days give streak 3, so research fires on the 4th day');

delete from internal.automation_runs where hanoi_date = '2026-02-13';
insert into tap_results(line) select is(
  (select value from streak where decision_day='2026-02-15'), 1,
  'a MISSING Hanoi day stops the streak rather than bridging it');

update internal.automation_runs set result='expired' where hanoi_date='2026-02-14';
insert into tap_results(line) select is(
  (select value from streak where decision_day='2026-02-15'), 0,
  'an expired run stops the streak (it is not a confirmed dry day)');

update internal.automation_runs set result='no_source' where hanoi_date='2026-02-14';
insert into internal.automation_runs (hanoi_date, result, completed_at, source_kind)
values ('2026-02-15','research_published',now(),'research');
insert into tap_results(line) select is(
  (select value from streak where decision_day='2026-02-16'), 0,
  'publishing research resets the streak for free: research_published is not no_source');

-- Emit every TAP line, then any plan diagnostics from finish(). The runner fails
-- the suite if any line starts with "not ok" or if finish() reports a plan
-- mismatch (which would mean an assertion silently did not run).
select lpad(seq::text, 6, '0') as seq, line from tap_results
union all select '999999', 'FINISH: ' || f from finish() f
order by 1;
rollback;
