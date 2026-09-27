-- ============================================================================
-- Phase 1 / 0002 — enums and small deterministic helper functions
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.article_type   as enum ('youtube','research');
create type public.article_status as enum ('draft','needs_review','scheduled','published','archived');
create type public.hero_kind      as enum ('youtube_thumbnail','svg','none');

create type internal.video_status as enum ('available','selected','used','ineligible');

-- 'no_source' means the run completed successfully and deliberately published
-- nothing. It is the ONLY result that counts toward the no-source streak:
-- 'expired', 'failed' and 'skipped_window' mean we did not get a clean answer
-- that day, so they must stop the streak rather than extend it.
create type internal.run_result as enum (
  'running','published','research_published',
  'no_source','validation_failed','failed','expired','skipped_window');

create type internal.source_kind as enum ('youtube','research','none');
create type internal.sub_status  as enum ('pending','active','unsubscribed','bounced','complained');

-- 'unknown' is a deliberate terminal-ish state: a send that was handed to the
-- provider but whose outcome we never observed. Such rows are NEVER retried,
-- because a missed email is preferable to a duplicate one.
create type internal.send_status as enum ('queued','sending','sent','unknown','failed');

-- ---------------------------------------------------------------------------
-- internal.fold_vietnamese(text) — immutable diacritic folding
--
-- unaccent() cannot be used in a generated column or an index because it is not
-- immutable (it reads a mutable dictionary). translate() and lower() are, so this
-- does the same job deterministically for the Vietnamese alphabet.
-- ---------------------------------------------------------------------------
create or replace function internal.fold_vietnamese(input text)
returns text
language sql
immutable
strict
parallel safe
set search_path = ''
as $fn$
  select translate(
    lower(input),
    -- a(17) e(11) i(5) o(17) u(11) y(5) d(1)
    'áàảãạăắằẳẵặâấầẩẫậ' ||
    'éèẻẽẹêếềểễệ'       ||
    'íìỉĩị'             ||
    'óòỏõọôốồổỗộơớờởỡợ' ||
    'úùủũụưứừửữự'       ||
    'ýỳỷỹỵ'             ||
    'đ',
    'aaaaaaaaaaaaaaaaa' ||
    'eeeeeeeeeee'       ||
    'iiiii'             ||
    'ooooooooooooooooo' ||
    'uuuuuuuuuuu'       ||
    'yyyyy'             ||
    'd'
  );
$fn$;

comment on function internal.fold_vietnamese(text) is
  'Immutable Vietnamese diacritic folding. Safe in generated columns and indexes, unlike unaccent().';

-- ---------------------------------------------------------------------------
-- internal.title_fingerprint(text) — normalised form for soft duplicate checks
-- "Số 133: Silic và Boron – Mắt xích vàng" -> "so 133 silic va boron mat xich vang"
-- ---------------------------------------------------------------------------
create or replace function internal.title_fingerprint(input text)
returns text
language sql
immutable
strict
parallel safe
set search_path = ''
as $fn$
  select btrim(regexp_replace(internal.fold_vietnamese(input), '[^a-z0-9]+', ' ', 'g'));
$fn$;

-- ---------------------------------------------------------------------------
-- internal.normalize_doi(text) — one canonical form per DOI
--   https://doi.org/10.1/AbC  ->  10.1/abc
--   DOI:10.1/abc              ->  10.1/abc
--   bare, padded 10.1/ABC     ->  10.1/abc
-- NULL in, NULL out, so the partial unique index still permits many DOI-less rows.
-- ---------------------------------------------------------------------------
create or replace function internal.normalize_doi(input text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $fn$
  select nullif(
    btrim(
      regexp_replace(
        lower(btrim(input)),
        '^(https?://(dx\.)?doi\.org/|doi:\s*|info:doi/)',
        ''
      )
    ),
    ''
  );
$fn$;

comment on function internal.normalize_doi(text) is
  'Canonical DOI form. IMMUTABLE so research_sources.doi_normalized can be a generated column, which stops the stored value from ever drifting from doi_raw.';

-- ---------------------------------------------------------------------------
-- internal.normalize_url(text) — canonical form for URL-identity dedup
-- NOTE: superseded by migration 20260927072857, which fixes host case folding.
-- ---------------------------------------------------------------------------
create or replace function internal.normalize_url(input text)
returns text
language sql
immutable
strict
parallel safe
set search_path = ''
as $fn$
  select regexp_replace(
           regexp_replace(
             regexp_replace(btrim(input), '#.*$', ''),
             '^([A-Za-z][A-Za-z0-9+.-]*://[^/?#]+)',
             lower('\1')
           ),
           '/+$', ''
         );
$fn$;

-- ---------------------------------------------------------------------------
-- internal.sha256_hex(text)
-- Immutable wrapper so generated columns need not schema-qualify pgcrypto, and
-- so the hashing choice lives in exactly one place.
-- ---------------------------------------------------------------------------
create or replace function internal.sha256_hex(input text)
returns text
language sql
immutable
strict
parallel safe
set search_path = ''
as $fn$
  select encode(extensions.digest(input, 'sha256'), 'hex');
$fn$;

-- ---------------------------------------------------------------------------
-- internal.normalize_email(text) — folds provider-specific aliasing
-- Lowercases; strips "+tag" everywhere; for Gmail/Googlemail only, also strips
-- dots in the local part. Other providers treat dots as significant, so folding
-- them everywhere would merge genuinely different people.
-- ---------------------------------------------------------------------------
create or replace function internal.normalize_email(input text)
returns text
language plpgsql
immutable
strict
parallel safe
set search_path = ''
as $fn$
declare
  lowered text := lower(btrim(input));
  local_part text;
  domain_part text;
begin
  if position('@' in lowered) = 0 then
    return lowered;
  end if;

  local_part  := split_part(lowered, '@', 1);
  domain_part := split_part(lowered, '@', 2);

  -- Subaddressing ("+tag") is widely supported; strip it everywhere.
  local_part := split_part(local_part, '+', 1);

  -- Dot-insensitivity is a Gmail-specific behaviour.
  if domain_part in ('gmail.com', 'googlemail.com') then
    local_part  := replace(local_part, '.', '');
    domain_part := 'gmail.com';
  end if;

  return local_part || '@' || domain_part;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- internal.set_updated_at() — updated_at trigger
-- ---------------------------------------------------------------------------
create or replace function internal.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  new.updated_at := now();
  return new;
end;
$fn$;
