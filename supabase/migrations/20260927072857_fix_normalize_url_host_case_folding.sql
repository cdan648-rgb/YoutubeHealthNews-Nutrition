-- ============================================================================
-- Phase 1 / 0003 — corrective migration
-- ============================================================================
-- 0002 defined internal.normalize_url with lower() applied to a regexp_replace
-- backreference. That lowercases the two-character literal at parse time, so the
-- replacement was just the untouched backreference and the host was never folded:
-- 'HTTPS://WWW.Example.COM/Path' came back unchanged. regexp_replace cannot apply
-- a function to a capture group, so the split has to be explicit.
--
-- Corrected here rather than by editing 0002, which had already been applied.
-- Found by the Phase 1 pgTAP suite before anything depended on it.

create or replace function internal.normalize_url(input text)
returns text
language plpgsql
immutable
strict
parallel safe
set search_path = ''
as $fn$
declare
  cleaned text;
  parts   text[];
begin
  -- Fragments are client-side only and never identify a distinct resource.
  cleaned := regexp_replace(btrim(input), '#.*$', '');

  -- [1] = scheme + authority (case-insensitive per RFC 3986)
  -- [2] = path + query       (case-SENSITIVE, must be preserved verbatim)
  parts := regexp_match(cleaned, '^([A-Za-z][A-Za-z0-9+.-]*://[^/?#]+)(.*)$');

  if parts is null then
    return regexp_replace(cleaned, '/+$', '');
  end if;

  return regexp_replace(lower(parts[1]) || parts[2], '/+$', '');
end;
$fn$;

comment on function internal.normalize_url(text) is
  'Canonical URL form for identity/dedup: scheme and host lowercased, path case preserved, fragment and trailing slash removed. IMMUTABLE so it can back generated hash columns.';
