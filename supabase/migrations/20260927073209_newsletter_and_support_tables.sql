-- ============================================================================
-- Phase 1 / 0009 — subscribers, campaigns, sends, signup_attempts, reference_cache
-- ============================================================================
-- THREE IDEMPOTENCY ANCHORS make a retried send incapable of duplicating email:
--   1. newsletter_campaigns.article_id UNIQUE          -> one campaign per article
--   2. newsletter_sends (campaign_id, subscriber_id)   -> one row per recipient
--   3. newsletter_sends.idempotency_key UNIQUE         -> generated, so it cannot
--      drift from the pair it identifies; also sent as the provider's
--      Idempotency-Key header (defence in depth; anchors 1-2 are authoritative).

create table internal.subscribers (
  id                     uuid primary key default gen_random_uuid(),

  email                  text not null unique
                           constraint email_is_lowercase check (email = lower(email))
                           constraint email_shape check (email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[a-z]{2,}$'),
  -- Folds "+tag" everywhere and Gmail's dot-insensitivity, so one person cannot
  -- occupy several rows (and cannot receive several copies of one article).
  email_normalized       text not null unique
                           generated always as (internal.normalize_email(email)) stored,

  status                 internal.sub_status not null default 'pending',

  -- Only hashes are stored. A leaked table must not yield working tokens.
  confirm_token_hash     text,
  confirm_sent_at        timestamptz,
  confirm_expires_at     timestamptz,
  confirmed_at           timestamptz,
  -- Stable (it appears in every email), single-purpose, stored as a hash.
  unsubscribe_token_hash text not null,

  -- Consent evidence. The IP is HMAC'd with a server-side salt, not plain SHA-256:
  -- the entire IPv4 space brute-forces in seconds, so a bare hash is not
  -- anonymisation.
  consent_text_version   text not null,
  consent_ip_hmac        text,
  consent_user_agent     text,
  signup_source          text,

  subscribed_at          timestamptz not null default now(),
  unsubscribed_at        timestamptz,

  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),

  constraint active_is_confirmed
    check (status <> 'active' or confirmed_at is not null),
  constraint unsubscribed_has_timestamp
    check ((status = 'unsubscribed') <= (unsubscribed_at is not null))
);

create index subscribers_deliverable on internal.subscribers (created_at) where status = 'active';
create index subscribers_pending on internal.subscribers (confirm_expires_at) where status = 'pending';

create trigger subscribers_set_updated_at
  before update on internal.subscribers
  for each row execute function internal.set_updated_at();

comment on table internal.subscribers is
  'Newsletter list. Never writable from a browser: signup goes through a server route with the service-role key so Turnstile, rate limiting, normalisation and consent capture are enforced, and so the table cannot be used for email enumeration.';

-- ---------------------------------------------------------------------------
create table internal.newsletter_campaigns (
  id           uuid primary key default gen_random_uuid(),
  -- Anchor #1: one campaign per article, so a retried notify stage cannot start a
  -- second send-out.
  article_id   uuid not null unique references public.articles(id) on delete cascade,
  created_at   timestamptz not null default now(),
  started_at   timestamptz,
  completed_at timestamptz,
  total_queued integer not null default 0,
  total_sent   integer not null default 0,
  updated_at   timestamptz not null default now()
);

create trigger newsletter_campaigns_set_updated_at
  before update on internal.newsletter_campaigns
  for each row execute function internal.set_updated_at();

-- ---------------------------------------------------------------------------
create table internal.newsletter_sends (
  id                  uuid primary key default gen_random_uuid(),
  campaign_id         uuid not null references internal.newsletter_campaigns(id) on delete cascade,
  subscriber_id       uuid not null references internal.subscribers(id) on delete cascade,

  -- Anchor #3: generated from the pair, so it is impossible to store a key that
  -- does not match the recipient it is meant to protect.
  idempotency_key     text not null
                        generated always as
                        (internal.sha256_hex(campaign_id::text || ':' || subscriber_id::text)) stored,

  status              internal.send_status not null default 'queued',
  attempted_at        timestamptz,
  sent_at             timestamptz,
  provider_message_id text,
  attempt_count       integer not null default 0,
  error               jsonb,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  -- Anchor #2.
  constraint one_send_per_recipient unique (campaign_id, subscriber_id),
  constraint sent_has_timestamp check ((status = 'sent') <= (sent_at is not null))
);

create unique index newsletter_sends_idempotency on internal.newsletter_sends (idempotency_key);
-- Retries read ONLY 'queued'. 'sending' rows that age out become 'unknown' and are
-- never retried: a missed email beats a duplicate one.
create index newsletter_sends_queued on internal.newsletter_sends (campaign_id) where status = 'queued';
create index newsletter_sends_inflight on internal.newsletter_sends (attempted_at) where status = 'sending';

create trigger newsletter_sends_set_updated_at
  before update on internal.newsletter_sends
  for each row execute function internal.set_updated_at();

comment on table internal.newsletter_sends is
  'One row per (campaign, subscriber). Retries read only status=queued; a sending row whose outcome was never observed becomes unknown and is never retried, because a missed email is preferable to a duplicate.';

-- ---------------------------------------------------------------------------
-- Rate limiting for the signup endpoint. IP is HMAC'd, never stored in clear.
create table internal.signup_attempts (
  id       bigint generated always as identity primary key,
  ip_hmac  text not null,
  ts       timestamptz not null default now(),
  outcome  text not null default 'attempt'
);

create index signup_attempts_window on internal.signup_attempts (ip_hmac, ts desc);

-- ---------------------------------------------------------------------------
-- Citation verification cache. Makes validation cheap, polite to the sources we
-- cite, and reproducible: a past validation decision can be re-examined against the
-- same evidence.
create table internal.reference_cache (
  url_sha256  text primary key,
  url         text not null,
  final_url   text,
  http_status integer,
  host        text,
  checked_at  timestamptz not null default now(),
  error       text
);

create index reference_cache_staleness on internal.reference_cache (checked_at);

comment on table internal.reference_cache is
  'URL reachability cache (30-day TTL) used by the source-verification stage.';
