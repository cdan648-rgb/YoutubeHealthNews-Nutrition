-- ============================================================================
-- Newsletter signup RPC facade — make /api/newsletter/* work without exposing
-- the `internal` schema to the Data API.
-- ============================================================================
-- ROOT CAUSE this migration addresses:
--   The signup route reached `internal.subscribers`, `internal.signup_attempts`
--   and `internal.job_logs` through a PostgREST client configured
--   `db: { schema: 'internal' }`. The service-role key bypasses RLS but NOT
--   PostgREST's exposed-schema allowlist, and `internal` is intentionally kept
--   off it. Every call therefore failed with "Invalid schema: internal" — which
--   surfaced as HTTP 500 on the desktop no-JS form and as
--   "Địa chỉ email không hợp lệ hoặc không xác minh được" on the mobile modal
--   (the client's generic !response.ok fallback).
--
-- FIX (same pattern as the automation migration): narrowly scoped SECURITY
-- DEFINER functions in the already-exposed `public` schema, one per operation
-- the signup, confirm and unsubscribe paths perform. Each pins
-- `search_path = ''`, fully qualifies its `internal` references, and has
-- EXECUTE revoked from public/anon/authenticated and granted only to
-- service_role. `internal` stays entirely private; anon and authenticated gain
-- no new reach.
--
-- Preserves double opt-in and every existing security property. The token
-- comparison stays in Node (constant-time, verifyToken) — these RPCs return
-- the candidate rows and the caller matches them exactly as before.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Signup: rate limit + subscriber CRUD
-- ---------------------------------------------------------------------------

create or replace function public.newsletter_count_recent_attempts(
  p_ip_hmac text,
  p_since timestamptz
)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::int
  from internal.signup_attempts
  where ip_hmac = p_ip_hmac and ts >= p_since;
$$;

comment on function public.newsletter_count_recent_attempts(text, timestamptz) is
  'Newsletter signup: rate-limit read — attempts from this IP hash since the window start.';

create or replace function public.newsletter_record_attempt(
  p_ip_hmac text,
  p_outcome text
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into internal.signup_attempts (ip_hmac, outcome)
  values (p_ip_hmac, coalesce(p_outcome, 'attempt'));
$$;

comment on function public.newsletter_record_attempt(text, text) is
  'Newsletter signup: record one signup attempt against an HMAC-ed IP.';

create or replace function public.newsletter_find_subscriber(p_email_normalized text)
returns table (id uuid, status internal.sub_status)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id, s.status
  from internal.subscribers s
  where s.email_normalized = p_email_normalized
  limit 1;
$$;

comment on function public.newsletter_find_subscriber(text) is
  'Newsletter signup: look up a subscriber by the normalized email; returns 0 or 1 rows.';

create or replace function public.newsletter_insert_pending(p jsonb)
returns uuid
language sql
security definer
set search_path = ''
as $$
  insert into internal.subscribers (
    email,
    status,
    unsubscribe_token_hash,
    confirm_token_hash,
    confirm_sent_at,
    confirm_expires_at,
    consent_text_version,
    consent_ip_hmac,
    consent_user_agent,
    signup_source
  )
  values (
    p->>'email',
    'pending'::internal.sub_status,
    p->>'unsubscribe_token_hash',
    p->>'confirm_token_hash',
    nullif(p->>'confirm_sent_at','')::timestamptz,
    nullif(p->>'confirm_expires_at','')::timestamptz,
    p->>'consent_text_version',
    p->>'consent_ip_hmac',
    p->>'consent_user_agent',
    p->>'signup_source'
  )
  on conflict (email_normalized) do nothing
  returning id;
$$;

comment on function public.newsletter_insert_pending(jsonb) is
  'Newsletter signup: create a pending subscriber. Returns null on a unique conflict (a concurrent request created the row).';

create or replace function public.newsletter_set_unsubscribe_hash(
  p_id uuid,
  p_hash text
)
returns void
language sql
security definer
set search_path = ''
as $$
  update internal.subscribers
  set unsubscribe_token_hash = p_hash
  where id = p_id;
$$;

comment on function public.newsletter_set_unsubscribe_hash(uuid, text) is
  'Newsletter signup: patch the deterministic unsubscribe hash after the insert (needed because it is derived from the row id).';

create or replace function public.newsletter_rearm_pending(
  p_id uuid,
  p_consent jsonb
)
returns void
language sql
security definer
set search_path = ''
as $$
  update internal.subscribers
  set status = 'pending'::internal.sub_status,
      confirm_token_hash = p_consent->>'confirm_token_hash',
      confirm_sent_at = nullif(p_consent->>'confirm_sent_at','')::timestamptz,
      confirm_expires_at = nullif(p_consent->>'confirm_expires_at','')::timestamptz,
      consent_text_version = p_consent->>'consent_text_version',
      consent_ip_hmac = p_consent->>'consent_ip_hmac',
      consent_user_agent = p_consent->>'consent_user_agent',
      signup_source = p_consent->>'signup_source'
  where id = p_id;
$$;

comment on function public.newsletter_rearm_pending(uuid, jsonb) is
  'Newsletter signup: re-arm a pending/unsubscribed/bounced subscriber with a fresh confirmation token, invalidating any older link.';

create or replace function public.newsletter_log_send_failure(
  p_level text,
  p_message text,
  p_stage text default 'confirm'
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into internal.job_logs (level, code, stage, message)
  values (coalesce(p_level, 'warn'), 'email_send_failed', p_stage, p_message);
$$;

comment on function public.newsletter_log_send_failure(text, text, text) is
  'Newsletter signup: log a confirmation-email send failure into job_logs.';

-- ---------------------------------------------------------------------------
-- Confirm: the double-opt-in landing point
-- ---------------------------------------------------------------------------

create or replace function public.newsletter_pending_with_confirm_tokens()
returns table (
  id uuid,
  confirm_token_hash text,
  confirm_expires_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id, s.confirm_token_hash, s.confirm_expires_at
  from internal.subscribers s
  where s.status = 'pending'::internal.sub_status
    and s.confirm_token_hash is not null;
$$;

comment on function public.newsletter_pending_with_confirm_tokens() is
  'Newsletter confirm: pending rows the incoming token may match. The token itself is never stored; the caller matches its hash in constant time.';

create or replace function public.newsletter_activate(
  p_id uuid,
  p_now timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update internal.subscribers
  set status = 'active'::internal.sub_status,
      confirmed_at = p_now,
      subscribed_at = p_now,
      -- Burn the confirmation token so the link cannot be replayed.
      confirm_token_hash = null
  where id = p_id and status = 'pending'::internal.sub_status;
  return found;
end;
$$;

comment on function public.newsletter_activate(uuid, timestamptz) is
  'Newsletter confirm: activate a pending subscriber. Returns false when another request confirmed it first (still success for the caller).';

-- ---------------------------------------------------------------------------
-- Unsubscribe (part of the signup lifecycle: the link ships in every email)
-- ---------------------------------------------------------------------------

create or replace function public.newsletter_get_subscriber_for_unsub(p_id uuid)
returns table (
  status internal.sub_status,
  unsubscribe_token_hash text
)
language sql
stable
security definer
set search_path = ''
as $$
  select s.status, s.unsubscribe_token_hash
  from internal.subscribers s
  where s.id = p_id;
$$;

comment on function public.newsletter_get_subscriber_for_unsub(uuid) is
  'Newsletter unsubscribe: read the row so the caller can verify the signed token in constant time.';

create or replace function public.newsletter_mark_unsubscribed(
  p_id uuid,
  p_now timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update internal.subscribers
  set status = 'unsubscribed'::internal.sub_status,
      unsubscribed_at = p_now
  where id = p_id and status <> 'unsubscribed'::internal.sub_status;
  return found;
end;
$$;

comment on function public.newsletter_mark_unsubscribed(uuid, timestamptz) is
  'Newsletter unsubscribe: transition to unsubscribed. Returns false when the row was already unsubscribed.';

-- ---------------------------------------------------------------------------
-- Lock these down: server/service-role only. `internal` stays private.
-- ---------------------------------------------------------------------------
do $grants$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname like 'newsletter\_%'
  loop
    execute format('revoke all on function %s from public', fn.sig);
    execute format('revoke all on function %s from anon', fn.sig);
    execute format('revoke all on function %s from authenticated', fn.sig);
    execute format('grant execute on function %s to service_role', fn.sig);
  end loop;
end;
$grants$;
