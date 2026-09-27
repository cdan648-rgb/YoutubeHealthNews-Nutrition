-- ============================================================================
-- Phase 1 test 03 — research-paper deduplication (four independent keys)
-- ============================================================================
-- pgTAP. Runs inside a transaction that ROLLS BACK, so it is safe against any
-- environment including the live project: no fixture survives the run.
--
-- Run with:  npm run test:db        (needs DATABASE_URL, see scripts/run-db-tests.mjs)
-- ============================================================================

begin;
set local search_path = extensions, public, internal;
select plan(18);
create temp table tap_results(seq serial primary key, line text) on commit drop;

-- A real paper from the Europe PMC probe, used as the baseline row.
insert into public.research_sources (doi_raw, source_url, title, journal, publication_date, cited_by_count, external_ids)
values ('10.1093/eurheartj/ehaf661',
        'https://europepmc.org/article/MED/40001111',
        'Gut microbiota-derived imidazole propionate predicts cardiometabolic risk in patients with coronary artery disease',
        'European heart journal', '2026-08-01', 13,
        jsonb_build_object('pmid','40001111','pmcid','PMC11111111'));

-- ===================== generated dedup keys are correct =====================
insert into tap_results(line) select is(
  (select doi_normalized from public.research_sources where doi_raw = '10.1093/eurheartj/ehaf661'),
  '10.1093/eurheartj/ehaf661', 'doi_normalized is generated from doi_raw');
insert into tap_results(line) select is(
  (select title_fingerprint from public.research_sources limit 1),
  'gut microbiota derived imidazole propionate predicts cardiometabolic risk in patients with coronary artery disease',
  'title_fingerprint is generated from the title');
insert into tap_results(line) select is(
  (select source_url_sha256 from public.research_sources limit 1),
  internal.sha256_hex('https://europepmc.org/article/MED/40001111'),
  'source_url_sha256 is the hash of the NORMALISED url');

-- ===================== dedup key 1: normalised DOI ==========================
insert into tap_results(line) select throws_ok(
  $q$insert into public.research_sources (doi_raw, source_url, title)
     values ('https://doi.org/10.1093/EurHeartJ/ehaf661', 'https://example.org/other-landing-page', 'Same paper, DOI written differently')$q$,
  '23505', null, 'the same DOI in a different spelling is rejected: a paper cannot be reused');
insert into tap_results(line) select lives_ok(
  $q$insert into public.research_sources (doi_raw, source_url, title)
     values ('10.1056/NEJMoa2026001', 'https://www.nejm.org/doi/full/10.1056/NEJMoa2026001', 'A genuinely different paper')$q$,
  'a different DOI inserts fine');
insert into tap_results(line) select lives_ok(
  $q$insert into public.research_sources (source_url, title) values
      ('https://who.int/publications/report-a', 'A DOI-less report'),
      ('https://who.int/publications/report-b', 'Another DOI-less report')$q$,
  'many DOI-less sources coexist (the DOI index is partial)');

-- ===================== dedup key 2: normalised URL hash =====================
insert into tap_results(line) select throws_ok(
  $q$insert into public.research_sources (source_url, title)
     values ('HTTPS://EuropePMC.org/article/MED/40001111/', 'Same landing page, different casing and trailing slash')$q$,
  '23505', null, 'a URL differing only by host case or trailing slash is rejected as a duplicate');
insert into tap_results(line) select lives_ok(
  $q$insert into public.research_sources (source_url, title)
     values ('https://europepmc.org/article/MED/40001112', 'Neighbouring article')$q$,
  'a genuinely different URL inserts fine');

-- ===================== dedup key 3: PMID ====================================
insert into tap_results(line) select throws_ok(
  $q$insert into public.research_sources (source_url, title, external_ids)
     values ('https://pubmed.ncbi.nlm.nih.gov/40001111/', 'Same paper reached via PubMed', '{"pmid":"40001111"}')$q$,
  '23505', null, 'a duplicate PMID is rejected even when the DOI and URL differ');

-- ===================== dedup key 4: PMCID ===================================
insert into tap_results(line) select throws_ok(
  $q$insert into public.research_sources (source_url, title, external_ids)
     values ('https://pmc.ncbi.nlm.nih.gov/articles/PMC11111111/', 'Same paper reached via PMC', '{"pmcid":"PMC11111111"}')$q$,
  '23505', null, 'a duplicate PMCID is rejected even when the DOI and URL differ');
insert into tap_results(line) select lives_ok(
  $q$insert into public.research_sources (source_url, title, external_ids) values
      ('https://who.int/publications/report-c', 'No external ids at all', '{}'),
      ('https://who.int/publications/report-d', 'Also no external ids', '{}')$q$,
  'sources without PMID/PMCID coexist (those indexes are partial too)');

-- ===================== soft duplicate detection =============================
-- A preprint and its published version legitimately carry two different DOIs, so
-- no hard key catches them. The trigram fingerprint does.
insert into public.research_sources (doi_raw, source_url, title)
values ('10.1101/2026.01.01.000001', 'https://biorxiv.org/content/10.1101/2026.01.01.000001',
        'Gut microbiota derived imidazole propionate predicts cardiometabolic risk in patients with coronary artery disease');
insert into tap_results(line) select ok(
  (select extensions.similarity(a.title_fingerprint, b.title_fingerprint) > 0.85
   from public.research_sources a, public.research_sources b
   where a.doi_normalized = '10.1093/eurheartj/ehaf661'
     and b.doi_normalized = '10.1101/2026.01.01.000001'),
  'a preprint and its published version score >0.85 trigram similarity (soft duplicate flag)');

-- ===================== shape and range constraints ==========================
insert into tap_results(line) select throws_ok(
  $q$insert into public.research_sources (source_url, title, authors) values ('https://a.test/1','Bad authors','{"name":"not an array"}')$q$,
  '23514', null, 'authors must be a JSON array (author order is meaningful)');
insert into tap_results(line) select throws_ok(
  $q$insert into public.research_sources (source_url, title, external_ids) values ('https://a.test/2','Bad ids','[]')$q$,
  '23514', null, 'external_ids must be a JSON object');
insert into tap_results(line) select throws_ok(
  $q$insert into public.research_sources (source_url, title, cited_by_count) values ('https://a.test/3','Bad citations',-1)$q$,
  '23514', null, 'a negative citation count is rejected');

-- ===================== one article per paper =================================
insert into tap_results(line) select throws_ok(
  format($q$insert into public.articles
      (slug,title,dek,body_blocks,body_text,word_count,article_type,category_id,research_source_id)
    values ('nc-mot','NC một','Dek','[]','t',800,'research',%L,%L),
           ('nc-hai','NC hai','Dek','[]','t',800,'research',%L,%L)$q$,
    (select id from public.categories where slug='vi-chat-vitamin'),
    (select id from public.research_sources where doi_normalized='10.1093/eurheartj/ehaf661'),
    (select id from public.categories where slug='vi-chat-vitamin'),
    (select id from public.research_sources where doi_normalized='10.1093/eurheartj/ehaf661')),
  '23505', null, 'two articles cannot share one research source');
insert into tap_results(line) select throws_ok(
  format($q$insert into public.articles
      (slug,title,dek,body_blocks,body_text,word_count,article_type,category_id)
    values ('nc-khong-nguon','NC không nguồn','Dek','[]','t',800,'research',%L)$q$,
    (select id from public.categories where slug='vi-chat-vitamin')),
  '23514', null, 'a research article without a research source is rejected');
insert into tap_results(line) select throws_ok(
  format($q$insert into public.articles
      (slug,title,dek,body_blocks,body_text,word_count,article_type,category_id,research_source_id,source_doi)
    values ('nc-doi-a','A','Dek','[]','t',800,'research',%L,%L,'10.1/x'),
           ('nc-doi-b','B','Dek','[]','t',800,'research',%L,%L,'10.1/x')$q$,
    (select id from public.categories where slug='vi-chat-vitamin'),
    (select id from public.research_sources where doi_normalized='10.1056/nejmoa2026001'),
    (select id from public.categories where slug='vi-chat-vitamin'),
    (select id from public.research_sources where doi_normalized='10.1101/2026.01.01.000001')),
  '23505', null, 'two articles cannot share one source_doi either');

-- Emit every TAP line, then any plan diagnostics from finish(). The runner fails
-- the suite if any line starts with "not ok" or if finish() reports a plan
-- mismatch (which would mean an assertion silently did not run).
select lpad(seq::text, 6, '0') as seq, line from tap_results
union all select '999999', 'FINISH: ' || f from finish() f
order by 1;
rollback;
