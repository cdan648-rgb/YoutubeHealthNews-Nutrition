-- ============================================================================
-- Phase 1 / 0006 — public.research_sources
-- ============================================================================
-- Academic papers used by the research fallback. A paper must never be reused, so
-- there are FOUR independent hard dedup keys plus a soft one:
--   1. doi_normalized    generated, unique         (canonical DOI)
--   2. source_url_sha256 generated, unique         (covers DOI-less items)
--   3. external_ids->>'pmid'  unique when present
--   4. external_ids->>'pmcid' unique when present
--   5. title_fingerprint (trigram, SOFT) catches preprint/published pairs that
--      legitimately carry two different DOIs.
--
-- All generated columns derive from their raw input, so a stored key can never
-- drift from the value it identifies.

create table public.research_sources (
  id                uuid primary key default gen_random_uuid(),

  doi_raw           text,
  doi_normalized    text generated always as (internal.normalize_doi(doi_raw)) stored,

  source_url        text not null,
  source_url_norm   text generated always as (internal.normalize_url(source_url)) stored,
  source_url_sha256 text generated always as
                      (internal.sha256_hex(internal.normalize_url(source_url))) stored,

  title             text not null,
  title_fingerprint text generated always as (internal.title_fingerprint(title)) stored,

  -- Ordered array of {name, affiliation?}. Author order is meaningful in academic
  -- citation, so this is an array and not a set.
  authors           jsonb not null default '[]'
                      constraint authors_is_array check (jsonb_typeof(authors) = 'array'),

  journal           text,
  issn              text,
  publication_date  date,
  abstract          text,

  is_open_access    boolean,
  cited_by_count    integer constraint cited_by_nonnegative
                      check (cited_by_count is null or cited_by_count >= 0),

  external_ids      jsonb not null default '{}'
                      constraint external_ids_is_object check (jsonb_typeof(external_ids) = 'object'),

  -- "Most popular paper" has no universal ranking, so the composite score and its
  -- components are both stored: any pick can be audited after the fact.
  score             numeric,
  score_components  jsonb,

  discovered_at     timestamptz not null default now(),
  used_at           timestamptz,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- Hard dedup keys. DOI is a partial unique index rather than a column constraint
-- so that many DOI-less papers remain insertable.
create unique index research_sources_doi_unique
  on public.research_sources (doi_normalized) where doi_normalized is not null;

create unique index research_sources_url_unique
  on public.research_sources (source_url_sha256);

create unique index research_sources_pmid_unique
  on public.research_sources ((external_ids->>'pmid'))
  where external_ids ? 'pmid';

create unique index research_sources_pmcid_unique
  on public.research_sources ((external_ids->>'pmcid'))
  where external_ids ? 'pmcid';

-- Soft duplicate detection.
create index research_sources_fingerprint_trgm
  on public.research_sources using gin (title_fingerprint extensions.gin_trgm_ops);

create index research_sources_unused
  on public.research_sources (score desc nulls last) where used_at is null;

create trigger research_sources_set_updated_at
  before update on public.research_sources
  for each row execute function internal.set_updated_at();

comment on table public.research_sources is
  'Academic papers behind research articles. Four independent hard dedup keys (DOI, URL hash, PMID, PMCID) guarantee a paper cannot be reused; the title fingerprint catches preprint/published pairs with differing DOIs.';
comment on column public.research_sources.score_components is
  'Per-component breakdown of the selection score (citation velocity, journal tier, topical fit, recency, accessibility) so a pick is auditable.';
