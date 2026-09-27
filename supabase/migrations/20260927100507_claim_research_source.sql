-- ============================================================================
-- Phase 7 / 0017 — internal.claim_research_source()
-- ============================================================================
-- Claim a paper BEFORE spending anything on generation.
--
-- All five dedup checks happen inside one statement in the database, because the four
-- hard keys are unique indexes there and an application-side pre-check can only ever
-- be a hint. The function reports which check fired so the selector can move to the
-- next candidate and `job_logs` can explain a dry spell afterwards.
--
-- Outcomes:
--   claimed     the row is ours; generation may begin
--   duplicate   a hard key collided (normalised DOI, URL hash, PMID or PMCID)
--   similar     the title fingerprint is close to an existing paper's — the soft
--               preprint/published check. NOT a constraint, so the threshold can be
--               tuned without a migration, and it never permanently blocks a legitimate
--               follow-up study, which would fold to a different fingerprint.
--
-- A claimed paper whose run later fails stays claimed and is therefore never retried.
-- That is deliberate: "a paper must not be reused" is the stated requirement, and the
-- cost of honouring it strictly is one skipped candidate out of a pool of dozens. The
-- next candidate is tried on the same tick.

create or replace function internal.claim_research_source(p jsonb)
returns table (id uuid, outcome text)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_title       text := p->>'title';
  v_fingerprint text;
  v_threshold   real := coalesce((p->>'similarity_threshold')::real, 0.85);
  v_similar_id  uuid;
  v_inserted    uuid;
begin
  if v_title is null or btrim(v_title) = '' then
    raise exception 'claim_research_source requires a title';
  end if;

  v_fingerprint := internal.title_fingerprint(v_title);

  -- Soft check first. A preprint and its published version carry different DOIs, so no
  -- hard key catches that pair; only the folded title does.
  select r.id into v_similar_id
  from public.research_sources r
  where extensions.similarity(r.title_fingerprint, v_fingerprint) >= v_threshold
  order by extensions.similarity(r.title_fingerprint, v_fingerprint) desc
  limit 1;

  if v_similar_id is not null then
    return query select v_similar_id, 'similar'::text;
    return;
  end if;

  -- The claim. ON CONFLICT DO NOTHING covers every unique index on the table at once,
  -- so a key added later is honoured here without this function changing.
  insert into public.research_sources (
    doi_raw, source_url, title, authors, journal, issn, publication_date, abstract,
    is_open_access, cited_by_count, external_ids, score, score_components
  )
  values (
    nullif(p->>'doi', ''),
    p->>'source_url',
    v_title,
    coalesce(p->'authors', '[]'::jsonb),
    nullif(p->>'journal', ''),
    nullif(p->>'issn', ''),
    nullif(p->>'publication_date', '')::date,
    nullif(p->>'abstract', ''),
    case when p->>'is_open_access' is null then null else (p->>'is_open_access')::boolean end,
    case when p->>'cited_by_count' is null then null else (p->>'cited_by_count')::int end,
    coalesce(p->'external_ids', '{}'::jsonb),
    case when p->>'score' is null then null else (p->>'score')::numeric end,
    p->'score_components'
  )
  on conflict do nothing
  returning public.research_sources.id into v_inserted;

  if v_inserted is null then
    return query select null::uuid, 'duplicate'::text;
    return;
  end if;

  return query select v_inserted, 'claimed'::text;
end;
$fn$;

comment on function internal.claim_research_source(jsonb) is
  'Atomically claims a paper before generation. Returns claimed | duplicate (a hard unique key collided) | similar (title fingerprint within the soft threshold of an existing paper).';

revoke all on function internal.claim_research_source(jsonb) from public;

-- ---------------------------------------------------------------------------
-- internal.release_research_source(uuid)
-- ---------------------------------------------------------------------------
-- The one sanctioned way to undo a claim: only for a row that was never used and has
-- no article pointing at it. Exists so an operator correcting a mistake does not have
-- to hand-write a DELETE against a table whose whole purpose is never reusing a row.
create or replace function internal.release_research_source(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_deleted int;
begin
  delete from public.research_sources r
  where r.id = p_id
    and r.used_at is null
    and not exists (select 1 from public.articles a where a.research_source_id = r.id);
  get diagnostics v_deleted = row_count;
  return v_deleted = 1;
end;
$fn$;

comment on function internal.release_research_source(uuid) is
  'Deletes an unused, unreferenced research_sources row so a mistaken claim can be undone. Refuses once an article exists or used_at is set.';

revoke all on function internal.release_research_source(uuid) from public;
