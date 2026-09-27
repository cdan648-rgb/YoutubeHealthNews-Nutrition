-- ============================================================================
-- Phase 1 / 0004 — public.categories
-- ============================================================================
-- A small, fixed taxonomy seeded by migration. Categories are reference data, not
-- user content: nothing in the application creates them at runtime, so the only
-- write path is a migration.

create table public.categories (
  id              uuid primary key default gen_random_uuid(),
  slug            text not null unique
                    constraint categories_slug_format check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name            text not null unique,
  description     text not null,

  -- Design-system references, not literal values: the renderer maps these to a
  -- token and an SVG motif, so a palette change never needs a data migration.
  icon_key        text not null,
  color_token     text not null,

  sort_order      integer not null default 100,
  is_active       boolean not null default true,

  seo_title       text,
  seo_description text,

  -- Vocabulary for the research fallback's topical-fit score: a candidate paper is
  -- scored partly on keyword overlap with these.
  keywords        text[] not null default '{}',

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index categories_active_order on public.categories (sort_order, name) where is_active;

create trigger categories_set_updated_at
  before update on public.categories
  for each row execute function internal.set_updated_at();

comment on table public.categories is
  'Fixed seven-category taxonomy derived from the source channel''s actual topic distribution. Reference data: written only by migration.';
comment on column public.categories.keywords is
  'Topic vocabulary used by the research fallback to score a candidate paper''s relevance to what this site actually covers.';
