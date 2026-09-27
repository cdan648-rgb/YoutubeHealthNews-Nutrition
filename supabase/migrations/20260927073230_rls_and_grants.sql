-- ============================================================================
-- Phase 1 / 0010 — RLS policies and the grant model
-- ============================================================================
-- Reader-facing tables are SELECT-only for anon/authenticated, gated by RLS.
-- Everything else lives in `internal`, which is not exposed through the Data API at
-- all. There is NO INSERT, UPDATE or DELETE policy for anon or authenticated
-- anywhere in this database, in either schema.
--
-- Note Supabase's cloud default auto-grants new `public` tables to anon and
-- authenticated, which is why the write privileges are explicitly revoked below
-- rather than merely left ungranted.

-- ===========================================================================
-- public: read-only, RLS-gated
-- ===========================================================================
alter table public.articles         enable row level security;
alter table public.categories       enable row level security;
alter table public.research_sources enable row level security;

revoke all on table public.articles         from anon, authenticated;
revoke all on table public.categories       from anon, authenticated;
revoke all on table public.research_sources from anon, authenticated;

grant select on table public.articles         to anon, authenticated;
grant select on table public.categories       to anon, authenticated;
grant select on table public.research_sources to anon, authenticated;

grant all on table public.articles         to service_role;
grant all on table public.categories       to service_role;
grant all on table public.research_sources to service_role;

-- Published only, and not before its publication instant. A future-dated article is
-- invisible until its time arrives, so scheduling needs no extra machinery.
create policy articles_read_published
  on public.articles for select to anon, authenticated
  using (status = 'published' and published_at is not null and published_at <= now());

create policy categories_read_active
  on public.categories for select to anon, authenticated
  using (is_active);

-- A paper is visible only while some currently published article cites it, so the
-- research table cannot be used to read ahead of publication.
create policy research_sources_read_cited
  on public.research_sources for select to anon, authenticated
  using (exists (
    select 1
    from public.articles a
    where a.research_source_id = research_sources.id
      and a.status = 'published'
      and a.published_at is not null
      and a.published_at <= now()
  ));

-- ===========================================================================
-- internal: RLS on, zero policies, zero privileges (defence in depth)
--
-- service_role and the table owner bypass RLS, so the automation is unaffected. For
-- anon/authenticated this is the third independent barrier, after the exposed-schema
-- list and the absent grants.
-- ===========================================================================
alter table internal.youtube_videos        enable row level security;
alter table internal.automation_runs       enable row level security;
alter table internal.automation_settings   enable row level security;
alter table internal.job_logs              enable row level security;
alter table internal.subscribers           enable row level security;
alter table internal.newsletter_campaigns  enable row level security;
alter table internal.newsletter_sends      enable row level security;
alter table internal.signup_attempts       enable row level security;
alter table internal.reference_cache       enable row level security;

revoke all on all tables    in schema internal from anon, authenticated;
revoke all on all sequences in schema internal from anon, authenticated;
revoke all on all functions in schema internal from anon, authenticated;
revoke usage on schema internal from anon, authenticated;

grant all on all tables    in schema internal to service_role;
grant all on all sequences in schema internal to service_role;
