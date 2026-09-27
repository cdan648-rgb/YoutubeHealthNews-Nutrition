-- ============================================================================
-- Phase 1 test 01 — schema shape, helper functions, seeded data
-- ============================================================================
-- pgTAP. Runs inside a transaction that ROLLS BACK, so it is safe against any
-- environment including the live project: no fixture survives the run.
--
-- Run with:  npm run test:db        (needs DATABASE_URL, see scripts/run-db-tests.mjs)
-- ============================================================================

begin;
set local search_path = extensions, public, internal;
select plan(54);
create temp table tap_results(seq serial primary key, line text) on commit drop;

-- schemas
insert into tap_results(line) select has_schema('public'::name,   'schema public exists');
insert into tap_results(line) select has_schema('internal'::name, 'schema internal exists');

-- tables
insert into tap_results(line) select has_table('public'::name,'articles'::name,'public.articles exists');
insert into tap_results(line) select has_table('public'::name,'categories'::name,'public.categories exists');
insert into tap_results(line) select has_table('public'::name,'research_sources'::name,'public.research_sources exists');
insert into tap_results(line) select has_table('internal'::name,'youtube_videos'::name,'internal.youtube_videos exists');
insert into tap_results(line) select has_table('internal'::name,'automation_runs'::name,'internal.automation_runs exists');
insert into tap_results(line) select has_table('internal'::name,'automation_settings'::name,'internal.automation_settings exists');
insert into tap_results(line) select has_table('internal'::name,'job_logs'::name,'internal.job_logs exists');
insert into tap_results(line) select has_table('internal'::name,'subscribers'::name,'internal.subscribers exists');
insert into tap_results(line) select has_table('internal'::name,'newsletter_campaigns'::name,'internal.newsletter_campaigns exists');
insert into tap_results(line) select has_table('internal'::name,'newsletter_sends'::name,'internal.newsletter_sends exists');
insert into tap_results(line) select has_table('internal'::name,'signup_attempts'::name,'internal.signup_attempts exists');
insert into tap_results(line) select has_table('internal'::name,'reference_cache'::name,'internal.reference_cache exists');

-- Helper immutability. This is load-bearing: a STABLE function cannot back a
-- generated column or an index, so if any of these regress to STABLE the dedup
-- keys silently stop being enforceable.
insert into tap_results(line) select volatility_is('internal'::name,'normalize_doi'::name,     array['text'],'immutable','normalize_doi is IMMUTABLE');
insert into tap_results(line) select volatility_is('internal'::name,'normalize_url'::name,     array['text'],'immutable','normalize_url is IMMUTABLE');
insert into tap_results(line) select volatility_is('internal'::name,'fold_vietnamese'::name,   array['text'],'immutable','fold_vietnamese is IMMUTABLE');
insert into tap_results(line) select volatility_is('internal'::name,'title_fingerprint'::name, array['text'],'immutable','title_fingerprint is IMMUTABLE');
insert into tap_results(line) select volatility_is('internal'::name,'sha256_hex'::name,        array['text'],'immutable','sha256_hex is IMMUTABLE');
insert into tap_results(line) select volatility_is('internal'::name,'normalize_email'::name,   array['text'],'immutable','normalize_email is IMMUTABLE');

-- DOI normalisation: every real-world spelling must converge on one value
insert into tap_results(line) select is(internal.normalize_doi('https://doi.org/10.1/AbC'), '10.1/abc', 'DOI: resolver prefix stripped and lowercased');
insert into tap_results(line) select is(internal.normalize_doi('http://dx.doi.org/10.1/ABC'), '10.1/abc', 'DOI: legacy dx.doi.org prefix stripped');
insert into tap_results(line) select is(internal.normalize_doi('DOI: 10.1/abc'), '10.1/abc', 'DOI: doi: scheme and whitespace stripped');
insert into tap_results(line) select is(internal.normalize_doi('  10.1/ABC  '), '10.1/abc', 'DOI: bare form trimmed and lowercased');
insert into tap_results(line) select is(internal.normalize_doi(null), null, 'DOI: NULL in, NULL out (so many DOI-less rows stay insertable)');
insert into tap_results(line) select is(internal.normalize_doi('   '), null, 'DOI: blank collapses to NULL, not empty string');

-- Vietnamese folding
insert into tap_results(line) select is(internal.fold_vietnamese('THIẾU MAGIE CƠ THỂ SỤP ĐỔ'), 'thieu magie co the sup do', 'fold_vietnamese strips diacritics and đ');
insert into tap_results(line) select is(internal.title_fingerprint('Số 133: Silic và Boron – Mắt xích vàng'), 'so 133 silic va boron mat xich vang', 'title_fingerprint normalises punctuation and diacritics');
insert into tap_results(line) select is(internal.title_fingerprint('  Số   133:::  Silic  và Boron -- Mắt xích vàng  '), 'so 133 silic va boron mat xich vang', 'title_fingerprint is stable across punctuation and spacing noise');

-- URL normalisation
insert into tap_results(line) select is(internal.normalize_url('HTTPS://WWW.Example.COM/Path/#frag'), 'https://www.example.com/Path', 'URL: host lowercased, path case kept, fragment dropped');
insert into tap_results(line) select is(internal.normalize_url('https://example.com/'), 'https://example.com', 'URL: trailing slash dropped');
insert into tap_results(line) select is(internal.normalize_url('https://example.com/a?B=c'), 'https://example.com/a?B=c', 'URL: query string preserved verbatim');

-- Email normalisation
insert into tap_results(line) select is(internal.normalize_email('Tran.Viet.Duc+news@GMail.com'), 'tranvietduc@gmail.com', 'email: Gmail dots and +tag folded');
insert into tap_results(line) select is(internal.normalize_email('First.Last+tag@Outlook.com'), 'first.last@outlook.com', 'email: non-Gmail dots preserved, +tag still stripped');
insert into tap_results(line) select is(internal.normalize_email('a.b@googlemail.com'), 'ab@gmail.com', 'email: googlemail folded onto gmail');

-- Settings singleton and its seeded values
insert into tap_results(line) select is((select count(*)::int from internal.automation_settings), 1, 'exactly one automation_settings row');
insert into tap_results(line) select is((select timezone from internal.automation_settings), 'Asia/Ho_Chi_Minh', 'timezone is the IANA id Asia/Ho_Chi_Minh');
insert into tap_results(line) select is((select publish_hour_local from internal.automation_settings), 11, 'publish hour is 11 Hanoi (channel uploads ~09:00 Hanoi)');
insert into tap_results(line) select is((select publish_window_end_hour from internal.automation_settings), 22, 'publish window closes at 22 Hanoi');
insert into tap_results(line) select is((select abandon_hour_local from internal.automation_settings), 23, 'unfinished runs abandoned from 23 Hanoi');
insert into tap_results(line) select is((select no_source_threshold from internal.automation_settings), 3, 'no-source threshold is 3');
insert into tap_results(line) select is((select fresh_window_days from internal.automation_settings), 21, 'fresh window is 21 days');
insert into tap_results(line) select is((select require_approval from internal.automation_settings), true, 'manual approval required by default');
insert into tap_results(line) select is((select paused from internal.automation_settings), false, 'automation is not paused');
insert into tap_results(line) select is((select dry_run from internal.automation_settings), false, 'dry run is off');
insert into tap_results(line) select is((select daily_send_cap from internal.automation_settings), 90, 'daily send cap is 90 (under Resend free tier 100/day)');

insert into tap_results(line) select throws_ok(
  $q$insert into internal.automation_settings (id) values (false)$q$,
  '23514', null, 'a second automation_settings row is rejected (singleton CHECK)');
insert into tap_results(line) select throws_ok(
  $q$update internal.automation_settings set publish_hour_local = 23, publish_window_end_hour = 9$q$,
  '23514', null, 'an inverted publish window is rejected');

-- Seeded taxonomy
insert into tap_results(line) select is((select count(*)::int from public.categories), 7, 'exactly seven categories seeded');
insert into tap_results(line) select is(
  (select array_agg(slug order by sort_order) from public.categories),
  array['vi-chat-vitamin','dinh-duong-chuyen-hoa','noi-tiet-hormone','mien-dich-nhiem-trung-ung-thu',
        'tieu-hoa-gan-than','co-xuong-khop-van-dong','phong-ngua-tam-than'],
  'category slugs and ordering match the approved taxonomy');
insert into tap_results(line) select is((select count(*)::int from public.categories where not is_active), 0, 'all seeded categories are active');
insert into tap_results(line) select ok((select array_length(boilerplate_markers,1) from internal.automation_settings) >= 5, 'boilerplate markers are seeded');
insert into tap_results(line) select ok((select array_length(restricted_topics,1) from internal.automation_settings) >= 5, 'restricted topics are seeded');
insert into tap_results(line) select ok((select array_length(allowed_reference_hosts,1) from internal.automation_settings) >= 15, 'reference host allowlist is seeded');

-- Emit every TAP line, then any plan diagnostics from finish(). The runner fails
-- the suite if any line starts with "not ok" or if finish() reports a plan
-- mismatch (which would mean an assertion silently did not run).
select lpad(seq::text, 6, '0') as seq, line from tap_results
union all select '999999', 'FINISH: ' || f from finish() f
order by 1;
rollback;
