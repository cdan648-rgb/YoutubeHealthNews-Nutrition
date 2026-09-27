-- ============================================================================
-- Phase 1 / 0001 — extensions, schemas and the exposure boundary
-- ============================================================================
-- Two schemas:
--   public    reader-facing content. Exposed through the Data API, SELECT-only,
--             gated by RLS.
--   internal  automation, ingestion, subscribers, logs. NOT listed in the Data
--             API's exposed schemas, so PostgREST cannot address it at all.
--
-- The exposure boundary is enforced three times over, deliberately:
--   1. `internal` is absent from api.schemas (supabase/config.toml + dashboard),
--   2. anon/authenticated hold no privileges on it (below),
--   3. RLS is on with no policies (migration 0012).
-- Supabase's cloud default auto-grants new `public` tables to anon and
-- authenticated, so "enable RLS and write a policy" is otherwise the only thing
-- between the browser and a table. Belt and braces is the right posture here.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Extensions. All live in `extensions`, never `public`: anything in `public`
-- becomes a PostgREST RPC endpoint, and pgtap alone defines ~700 functions.
-- ---------------------------------------------------------------------------
create extension if not exists pg_trgm      with schema extensions;  -- soft duplicate detection
create extension if not exists unaccent     with schema extensions;  -- search only, see note
create extension if not exists moddatetime  with schema extensions;  -- updated_at triggers
create extension if not exists pgtap        with schema extensions;  -- database tests
create extension if not exists pg_net       with schema extensions;  -- cron -> Edge Function (Phase 2)

-- pg_cron is not relocatable on Supabase; it installs into pg_catalog.
-- Created now so Phase 2 only has to schedule jobs, not enable the extension.
create extension if not exists pg_cron;

-- NOTE on unaccent: it is NOT immutable (it depends on a mutable dictionary), so
-- it can be used in queries but NEVER in a generated column or an index. Where we
-- need deterministic diacritic folding we use internal.fold_vietnamese (0002),
-- which is built on translate() and is genuinely immutable.

-- ---------------------------------------------------------------------------
-- The internal schema
-- ---------------------------------------------------------------------------
create schema if not exists internal;

comment on schema internal is
  'Private operational data: automation runs and settings, YouTube ingestion, '
  'subscribers, newsletter delivery, logs, caches. Deliberately absent from the '
  'Data API exposed-schema list; no anon/authenticated privileges; RLS on with no '
  'policies. Reached only by service_role (Edge Functions and server routes).';

-- No access for the Data API's public roles, now or for anything created later.
revoke all on schema internal from anon, authenticated;
alter default privileges in schema internal revoke all on tables    from anon, authenticated;
alter default privileges in schema internal revoke all on sequences from anon, authenticated;
alter default privileges in schema internal revoke all on functions from anon, authenticated;

-- service_role is the only Data API role that may reach it.
grant usage on schema internal to service_role;
alter default privileges in schema internal grant all on tables    to service_role;
alter default privileges in schema internal grant all on sequences to service_role;
