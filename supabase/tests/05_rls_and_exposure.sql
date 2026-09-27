-- ============================================================================
-- Phase 1 test 05 — RLS and the exposure boundary
-- ============================================================================
-- pgTAP. Runs inside a transaction that ROLLS BACK, so it is safe against any
-- environment including the live project: no fixture survives the run.
--
-- These assertions are made by actually SWITCHING ROLE to anon / authenticated /
-- service_role and attempting the statement, rather than by inspecting catalogues.
-- Reading pg_policy proves a policy exists; it does not prove the policy works.
--
-- Run with:  npm run test:db        (needs DATABASE_URL, see scripts/run-db-tests.mjs)
-- ============================================================================
begin;
set local search_path = extensions, public, internal;
select plan(29);
create temp table tap_results(seq serial primary key, line text) on commit drop;

-- Runs a statement AS a role and reports whether it was denied. The inner block
-- gives each attempt its own subtransaction, so a permission error does not abort
-- the whole test run.
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

-- Counts rows visible to a role. The count is taken as that role, but the result is
-- recorded after resetting, because anon cannot write to the temp table.
create function pg_temp.count_as(stmt text, as_role text) returns bigint
language plpgsql as $fn$
declare n bigint;
begin
  execute format('set local role %I', as_role);
  execute stmt into n;
  execute 'reset role';
  return n;
end $fn$;

-- ---- fixtures spanning every visibility case -------------------------------
insert into internal.youtube_videos (youtube_video_id, title, published_at)
values ('An4HFu4EwFQ','Số 118','2026-06-27T02:00:00Z'),
       ('lBKtncuS0yY','Số 132','2026-09-19T02:00:07Z'),
       ('hkP4Heyobuc','Số 121','2026-07-04T02:00:00Z'),
       ('zPMAZzk5840','Số 131','2026-09-12T02:00:00Z');

insert into public.research_sources (doi_raw, source_url, title) values
  ('10.1/cited-by-published','https://europepmc.org/article/MED/1','Cited by a published article'),
  ('10.1/cited-by-draft','https://europepmc.org/article/MED/2','Cited only by a draft'),
  ('10.1/not-cited','https://europepmc.org/article/MED/3','Not cited at all');

insert into public.categories (slug,name,description,icon_key,color_token,is_active)
values ('chuyen-muc-an','Chuyên mục ẩn','Inactive category','molecule','accent',false);

insert into public.articles
  (slug,title,dek,body_blocks,body_text,word_count,article_type,category_id,source_video_id,
   research_source_id,hero_kind,hero_alt,status,published_at,published_date_hanoi)
values
  ('bai-da-xuat-ban','Đã xuất bản','Dek','[]','t',800,'youtube',
   (select id from public.categories where slug='vi-chat-vitamin'),
   (select id from internal.youtube_videos where youtube_video_id='An4HFu4EwFQ'),
   (select id from public.research_sources where doi_normalized='10.1/cited-by-published'),
   'svg','Alt','published','2026-09-20T04:00:00Z','2026-09-20'),
  ('bai-nhap','Bản nháp','Dek','[]','t',800,'youtube',
   (select id from public.categories where slug='vi-chat-vitamin'),
   (select id from internal.youtube_videos where youtube_video_id='lBKtncuS0yY'),
   (select id from public.research_sources where doi_normalized='10.1/cited-by-draft'),
   'svg','Alt','draft',null,null),
  ('bai-cho-duyet','Chờ duyệt','Dek','[]','t',800,'youtube',
   (select id from public.categories where slug='vi-chat-vitamin'),
   (select id from internal.youtube_videos where youtube_video_id='hkP4Heyobuc'),
   null,'svg','Alt','needs_review',null,null),
  ('bai-hen-gio','Hẹn giờ','Dek','[]','t',800,'youtube',
   (select id from public.categories where slug='vi-chat-vitamin'),
   (select id from internal.youtube_videos where youtube_video_id='zPMAZzk5840'),
   null,'svg','Alt','published', now() + interval '2 days', (now() + interval '2 days')::date);

insert into internal.subscribers (email, unsubscribe_token_hash, consent_text_version)
values ('reader@example.com', internal.sha256_hex('token'), 'v1');

-- ================= what anon may READ ======================================
insert into tap_results(line) select is(pg_temp.count_as($q$select count(*) from public.articles where slug='bai-da-xuat-ban'$q$,'anon'), 1::bigint, 'anon CAN read a published article');
insert into tap_results(line) select is(pg_temp.count_as($q$select count(*) from public.articles where slug='bai-nhap'$q$,'anon'), 0::bigint, 'anon canNOT read a draft');
insert into tap_results(line) select is(pg_temp.count_as($q$select count(*) from public.articles where slug='bai-cho-duyet'$q$,'anon'), 0::bigint, 'anon canNOT read a needs_review article (failed validation stays private)');
insert into tap_results(line) select is(pg_temp.count_as($q$select count(*) from public.articles where slug='bai-hen-gio'$q$,'anon'), 0::bigint, 'anon canNOT read a future-dated published article');
insert into tap_results(line) select is(pg_temp.count_as($q$select count(*) from public.articles$q$,'anon'), 1::bigint, 'anon sees exactly one of the four articles');
insert into tap_results(line) select is(pg_temp.count_as($q$select count(*) from public.categories$q$,'anon'), 7::bigint, 'anon sees only the seven ACTIVE categories');
insert into tap_results(line) select is(pg_temp.count_as($q$select count(*) from public.research_sources where doi_normalized='10.1/cited-by-published'$q$,'anon'), 1::bigint, 'anon CAN read a research source cited by a published article');
insert into tap_results(line) select is(pg_temp.count_as($q$select count(*) from public.research_sources where doi_normalized='10.1/cited-by-draft'$q$,'anon'), 0::bigint, 'anon canNOT read a source cited only by a draft');
insert into tap_results(line) select is(pg_temp.count_as($q$select count(*) from public.research_sources where doi_normalized='10.1/not-cited'$q$,'anon'), 0::bigint, 'anon canNOT read an uncited research source');

-- ================= what anon may NOT WRITE =================================
insert into tap_results(line) select ok(pg_temp.denied($q$insert into public.articles (slug,title,dek,body_blocks,body_text,word_count,article_type,category_id,research_source_id,hero_kind,hero_alt) select 'anon-chen','A','D','[]','t',800,'research',id,null,'svg','Alt' from public.categories limit 1$q$,'anon'), 'anon canNOT INSERT into public.articles');
insert into tap_results(line) select ok(pg_temp.denied($q$update public.articles set title='hacked' where slug='bai-da-xuat-ban'$q$,'anon'), 'anon canNOT UPDATE public.articles');
insert into tap_results(line) select ok(pg_temp.denied($q$delete from public.articles where slug='bai-da-xuat-ban'$q$,'anon'), 'anon canNOT DELETE from public.articles');
insert into tap_results(line) select ok(pg_temp.denied($q$update public.categories set name='hacked'$q$,'anon'), 'anon canNOT UPDATE public.categories');
insert into tap_results(line) select ok(pg_temp.denied($q$insert into public.research_sources (source_url,title) values ('https://x.test/1','Anon')$q$,'anon'), 'anon canNOT INSERT into public.research_sources');

-- ================= the internal schema is unreachable ======================
insert into tap_results(line) select ok(pg_temp.denied($q$select count(*) from internal.subscribers$q$,'anon'), 'anon canNOT read internal.subscribers (no email enumeration)');
insert into tap_results(line) select ok(pg_temp.denied($q$insert into internal.subscribers (email,unsubscribe_token_hash,consent_text_version) values ('x@y.test','h','v1')$q$,'anon'), 'anon canNOT write internal.subscribers');
insert into tap_results(line) select ok(pg_temp.denied($q$select count(*) from internal.automation_runs$q$,'anon'), 'anon canNOT read internal.automation_runs');
insert into tap_results(line) select ok(pg_temp.denied($q$select count(*) from internal.youtube_videos$q$,'anon'), 'anon canNOT read internal.youtube_videos');
insert into tap_results(line) select ok(pg_temp.denied($q$select count(*) from internal.newsletter_sends$q$,'anon'), 'anon canNOT read internal.newsletter_sends');
insert into tap_results(line) select ok(pg_temp.denied($q$select count(*) from internal.automation_settings$q$,'anon'), 'anon canNOT read internal.automation_settings');
insert into tap_results(line) select ok(not has_schema_privilege('anon','internal','USAGE'), 'anon has no USAGE on schema internal');
insert into tap_results(line) select ok(not has_schema_privilege('authenticated','internal','USAGE'), 'authenticated has no USAGE on schema internal');
insert into tap_results(line) select ok(not has_schema_privilege('anon','cron','USAGE'), 'anon has no USAGE on the pg_cron schema');

-- ================= authenticated is no more privileged =====================
insert into tap_results(line) select is(pg_temp.count_as($q$select count(*) from public.articles$q$,'authenticated'), 1::bigint, 'authenticated sees the same single published article');
insert into tap_results(line) select ok(pg_temp.denied($q$select count(*) from internal.subscribers$q$,'authenticated'), 'authenticated canNOT read internal.subscribers either');
insert into tap_results(line) select ok(pg_temp.denied($q$update public.articles set title='hacked' where slug='bai-da-xuat-ban'$q$,'authenticated'), 'authenticated canNOT UPDATE public.articles');

-- ================= service_role still works ================================
insert into tap_results(line) select is(pg_temp.count_as($q$select count(*) from internal.subscribers$q$,'service_role'), 1::bigint, 'service_role CAN read internal.subscribers (automation unaffected)');

-- ================= structural assertions ===================================
-- Scoped to OUR schemas: pg_cron ships its own owner-scoped ALL policies on
-- cron.job and cron.job_run_details, which are not ours to assert about.
insert into tap_results(line) select is(
  (select count(*)::int from pg_policy p join pg_class c on c.oid=p.polrelid
     join pg_namespace n on n.oid=c.relnamespace
   where n.nspname in ('public','internal') and p.polcmd <> 'r'),
  0, 'no INSERT/UPDATE/DELETE/ALL policy exists in public or internal');
insert into tap_results(line) select is(
  (select array_agg(n.nspname||'.'||c.relname||':'||p.polcmd::text order by c.relname)
   from pg_policy p join pg_class c on c.oid=p.polrelid join pg_namespace n on n.oid=c.relnamespace
   where n.nspname in ('public','internal')),
  array['public.articles:r','public.categories:r','public.research_sources:r'],
  'exactly three policies exist, all SELECT-only, all on public tables');

-- Emit every TAP line, then any plan diagnostics from finish(). The runner fails
-- the suite if any line starts with "not ok" or if finish() reports a plan
-- mismatch (which would mean an assertion silently did not run).
select lpad(seq::text, 6, '0') as seq, line from tap_results
union all select '999999', 'FINISH: ' || f from finish() f
order by 1;
rollback;
