-- ============================================================================
-- Phase 1 / 0008 — public.articles
-- ============================================================================
-- THE ONE-ARTICLE-PER-HANOI-DAY GUARANTEE, entirely in Postgres:
--
--   internal.automation_runs.hanoi_date UNIQUE   -> at most one run per Hanoi day
--   public.articles.automation_run_id   UNIQUE   -> at most one article per run
--   ------------------------------------------------------------------------
--   => at most one AUTOMATIC article per Hanoi calendar day.
--
-- Manual and seed articles carry automation_run_id IS NULL, and Postgres permits
-- unlimited NULLs in a unique constraint, so editorial publishing is untouched.
-- That matches the rule exactly: it limits automatically generated articles.

create table public.articles (
  id                      uuid primary key default gen_random_uuid(),

  slug                    text not null unique
                            constraint articles_slug_format
                            check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),

  title                   text not null,
  dek                     text not null,

  -- Structured blocks, never HTML or Markdown. This is what makes the validation
  -- gate possible (rules run over typed nodes), keeps rendering XSS-free, and lets
  -- visuals be placed deterministically instead of hoping the model emits them.
  body_blocks             jsonb not null
                            constraint body_blocks_is_array check (jsonb_typeof(body_blocks) = 'array'),
  -- Plain-text projection for search, word counting and copy-overlap checks.
  body_text               text not null,
  word_count              integer not null constraint word_count_positive check (word_count > 0),
  reading_minutes         integer generated always as
                            (greatest(1, ceil(word_count / 220.0))::integer) stored,

  article_type            public.article_type not null,
  category_id             uuid not null references public.categories(id) on delete restrict,

  -- The channel's myth-busting strand is a FORMAT FLAG, not an eighth category: it
  -- drives a badge and a listing without inflating the taxonomy.
  is_fact_check           boolean not null default false,

  source_video_id         uuid references internal.youtube_videos(id) on delete restrict,
  source_video_youtube_id text,
  source_video_url        text,

  research_source_id      uuid references public.research_sources(id) on delete restrict,
  source_doi              text,

  source_metadata         jsonb not null default '{}',
  references_used         jsonb not null default '[]'
                            constraint references_is_array check (jsonb_typeof(references_used) = 'array'),

  -- hero_kind records which rung of the fallback ladder was used, so switching the
  -- whole site from hotlinked thumbnails to our own SVG art is a config change.
  -- NOTE: this default is corrected to 'none' by migration 20260927073934, which
  -- also adds published_has_hero. Left as applied so the history replays faithfully.
  hero_kind               public.hero_kind not null default 'svg',
  hero_image_url          text,
  hero_alt                text,
  hero_attribution        text,

  status                  public.article_status not null default 'draft',
  validation_report       jsonb,
  seo                     jsonb not null default '{}',

  -- Half of the per-day guarantee. UNIQUE, nullable.
  automation_run_id       uuid unique references internal.automation_runs(id) on delete set null,

  generated_at            timestamptz,
  published_at            timestamptz,
  -- Plain date column by necessity (AT TIME ZONE is STABLE, not IMMUTABLE). Written
  -- by the same code that sets published_at; a pgTAP test asserts they agree.
  published_date_hanoi    date,

  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),

  -- Each article type must actually have its source.
  constraint youtube_needs_video
    check (article_type <> 'youtube' or source_video_id is not null),
  constraint research_needs_source
    check (article_type <> 'research' or research_source_id is not null),
  -- A published article must be dated, in both UTC and Hanoi terms.
  constraint published_needs_dates
    check (status <> 'published' or (published_at is not null and published_date_hanoi is not null)),
  -- A thumbnail hero must carry both a URL and its credit: attribution is
  -- structural, not something an individual row can omit.
  constraint thumbnail_hero_is_attributed
    check (hero_kind <> 'youtube_thumbnail'
           or (hero_image_url is not null and hero_attribution is not null)),
  -- Alt text is required whenever there is an image at all (accessibility).
  constraint image_hero_has_alt
    check (hero_kind = 'none' or hero_alt is not null)
);

-- Dedup: a given source can back at most one article, enforced by the database
-- rather than by application logic.
create unique index articles_one_per_video
  on public.articles (source_video_id) where source_video_id is not null;
create unique index articles_one_per_doi
  on public.articles (source_doi) where source_doi is not null;
create unique index articles_one_per_research_source
  on public.articles (research_source_id) where research_source_id is not null;

create index articles_feed
  on public.articles (published_at desc) where status = 'published';
create index articles_category_feed
  on public.articles (category_id, published_at desc) where status = 'published';
create index articles_research_feed
  on public.articles (published_at desc) where status = 'published' and article_type = 'research';
create index articles_hanoi_day on public.articles (published_date_hanoi);
create index articles_needs_review on public.articles (created_at desc) where status = 'needs_review';

create trigger articles_set_updated_at
  before update on public.articles
  for each row execute function internal.set_updated_at();

-- Close the circular reference now that articles exists.
alter table internal.automation_runs
  add constraint automation_runs_article_fk
  foreign key (article_id) references public.articles(id) on delete set null;

comment on table public.articles is
  'Published content. automation_run_id UNIQUE combined with automation_runs.hanoi_date UNIQUE caps automatic publication at one article per Hanoi calendar day; manual articles use NULL and are unaffected.';
comment on column public.articles.body_blocks is
  'Structured block array, never HTML/Markdown: enables deterministic validation, XSS-free rendering and fixed visual placement.';
comment on column public.articles.published_date_hanoi is
  'Asia/Ho_Chi_Minh calendar date of publication. Plain column: AT TIME ZONE is STABLE, so it cannot be generated.';
