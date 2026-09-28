-- ============================================================================
-- Public RPC facade for the newsletter send state machine and the operational
-- read surfaces (admin dashboard, health endpoint, Resend delivery webhook).
-- ============================================================================
-- ROOT CAUSE this migration addresses:
--   The same schema-exposure problem the automation and signup migrations
--   already fixed for their own tables: PostgREST's exposed-schema allowlist
--   excludes `internal`, so a client configured `db: { schema: 'internal' }`
--   fails every call with "Invalid schema: internal" — even under the
--   service-role key, which bypasses RLS but NOT that allowlist.
--
--   The signup migration covered the pending/confirm/unsubscribe path but not
--   the SEND path (fanout, drain, mark-sent, reclaim-stale, cap-read) and not
--   the Resend delivery webhook, and not the admin/health readers. Those still
--   used `internalClient()` and would 500 the moment automation tries to notify
--   after publishing, the moment a bounce arrives, or the moment an operator
--   opens /admin/runs.
--
-- FIX:
--   Narrowly scoped SECURITY DEFINER functions in the already-exposed `public`
--   schema, one per operation. Each pins `search_path = ''`, fully qualifies
--   every reference and has EXECUTE granted only to service_role. `internal`
--   stays entirely private.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Newsletter send state machine
-- ---------------------------------------------------------------------------

create or replace function public.newsletter_campaign_get_or_create(p_article_id uuid)
returns table (id uuid, created boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_id uuid;
  existing_id uuid;
begin
  insert into internal.newsletter_campaigns (article_id)
  values (p_article_id)
  on conflict (article_id) do nothing
  returning newsletter_campaigns.id into new_id;

  if new_id is not null then
    return query select new_id, true;
    return;
  end if;

  select c.id into existing_id
  from internal.newsletter_campaigns c
  where c.article_id = p_article_id;

  return query select existing_id, false;
end;
$$;

comment on function public.newsletter_campaign_get_or_create(uuid) is
  'Newsletter send: create the campaign for an article, or return the existing one. `created` distinguishes the two so fan-out only runs once.';

create or replace function public.newsletter_active_subscriber_ids()
returns table (id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id from internal.subscribers s where s.status = 'active'::internal.sub_status;
$$;

comment on function public.newsletter_active_subscriber_ids() is
  'Newsletter send: the ids of every subscriber currently active. Used for the initial fan-out.';

create or replace function public.newsletter_fanout(p_campaign_id uuid, p_subscriber_ids uuid[])
returns integer
language sql
security definer
set search_path = ''
as $$
  with inserted as (
    insert into internal.newsletter_sends (campaign_id, subscriber_id)
    select p_campaign_id, sub_id
    from unnest(p_subscriber_ids) as sub_id
    on conflict (campaign_id, subscriber_id) do nothing
    returning id
  )
  select count(*)::int from inserted;
$$;

comment on function public.newsletter_fanout(uuid, uuid[]) is
  'Newsletter send: insert one queued send per (campaign, subscriber), skipping duplicates. Returns the number of new rows.';

create or replace function public.newsletter_campaign_set_started(p_campaign_id uuid, p_total_queued integer)
returns void
language sql
security definer
set search_path = ''
as $$
  update internal.newsletter_campaigns
  set total_queued = p_total_queued, started_at = coalesce(started_at, now())
  where id = p_campaign_id;
$$;

comment on function public.newsletter_campaign_set_started(uuid, integer) is
  'Newsletter send: record the fan-out total and stamp started_at once.';

create or replace function public.newsletter_reclaim_stale(p_campaign_id uuid, p_cutoff timestamptz)
returns integer
language sql
security definer
set search_path = ''
as $$
  with updated as (
    update internal.newsletter_sends
    set status = 'unknown'::internal.send_status,
        error = jsonb_build_object('reason','sending_timed_out')
    where campaign_id = p_campaign_id
      and status = 'sending'::internal.send_status
      and attempted_at < p_cutoff
    returning id
  )
  select count(*)::int from updated;
$$;

comment on function public.newsletter_reclaim_stale(uuid, timestamptz) is
  'Newsletter send: mark rows stuck in sending past the cutoff as unknown. Never retried — a missed email beats a duplicate.';

create or replace function public.newsletter_daily_send_cap()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select daily_send_cap from internal.automation_settings limit 1;
$$;

comment on function public.newsletter_daily_send_cap() is
  'Newsletter send: how many emails the day may consume. Read from the settings singleton.';

create or replace function public.newsletter_sent_today_count(p_since timestamptz)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::int
  from internal.newsletter_sends
  where attempted_at >= p_since
    and status in ('sent'::internal.send_status, 'sending'::internal.send_status, 'unknown'::internal.send_status);
$$;

comment on function public.newsletter_sent_today_count(timestamptz) is
  'Newsletter send: how many emails have consumed provider quota since the given instant. Counts sent + sending + unknown.';

create or replace function public.newsletter_queued_batch(p_campaign_id uuid, p_limit integer)
returns table (id uuid, subscriber_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id, s.subscriber_id
  from internal.newsletter_sends s
  where s.campaign_id = p_campaign_id
    and s.status = 'queued'::internal.send_status
  limit greatest(coalesce(p_limit, 200), 1);
$$;

comment on function public.newsletter_queued_batch(uuid, integer) is
  'Newsletter send: read up to p_limit queued rows for the campaign, in insertion order.';

create or replace function public.newsletter_claim_send(p_send_id uuid, p_now timestamptz)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update internal.newsletter_sends
  set status = 'sending'::internal.send_status, attempted_at = p_now
  where id = p_send_id and status = 'queued'::internal.send_status;
  return found;
end;
$$;

comment on function public.newsletter_claim_send(uuid, timestamptz) is
  'Newsletter send: atomically move a send from queued to sending. False when someone else won the race.';

create or replace function public.newsletter_subscriber_for_send(p_subscriber_id uuid)
returns table (email text, unsubscribe_token_hash text)
language sql
stable
security definer
set search_path = ''
as $$
  select s.email, s.unsubscribe_token_hash
  from internal.subscribers s
  where s.id = p_subscriber_id;
$$;

comment on function public.newsletter_subscriber_for_send(uuid) is
  'Newsletter send: the email + unsubscribe token hash for a subscriber, to build the message and the one-click header.';

create or replace function public.newsletter_mark_send_sent(
  p_send_id uuid,
  p_provider_message_id text,
  p_now timestamptz
)
returns void
language sql
security definer
set search_path = ''
as $$
  update internal.newsletter_sends
  set status = 'sent'::internal.send_status,
      sent_at = p_now,
      provider_message_id = p_provider_message_id,
      attempt_count = 1
  where id = p_send_id;
$$;

comment on function public.newsletter_mark_send_sent(uuid, text, timestamptz) is
  'Newsletter send: record a successful send.';

create or replace function public.newsletter_mark_send_failed(
  p_send_id uuid,
  p_reason text
)
returns void
language sql
security definer
set search_path = ''
as $$
  update internal.newsletter_sends
  set status = 'failed'::internal.send_status,
      attempt_count = 1,
      error = jsonb_build_object('reason', coalesce(p_reason, 'unknown'))
  where id = p_send_id;
$$;

comment on function public.newsletter_mark_send_failed(uuid, text) is
  'Newsletter send: record a hard send failure with a short reason.';

create or replace function public.newsletter_log(
  p_level text,
  p_code text,
  p_stage text,
  p_message text,
  p_context jsonb
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into internal.job_logs (level, code, stage, message, context)
  values (coalesce(p_level, 'info'), p_code, p_stage, p_message, coalesce(p_context, '{}'::jsonb));
$$;

comment on function public.newsletter_log(text, text, text, text, jsonb) is
  'Newsletter send/webhook: append one line to job_logs.';

create or replace function public.newsletter_load_article_for_campaign(p_campaign_id uuid)
returns table (
  title text,
  dek text,
  slug text,
  is_fact_check boolean,
  article_type public.article_type
)
language sql
stable
security definer
set search_path = ''
as $$
  select a.title, a.dek, a.slug, a.is_fact_check, a.article_type
  from internal.newsletter_campaigns c
  join public.articles a on a.id = c.article_id
  where c.id = p_campaign_id;
$$;

comment on function public.newsletter_load_article_for_campaign(uuid) is
  'Newsletter send: load the campaign''s article fields for message rendering.';

create or replace function public.newsletter_update_campaign_totals(p_campaign_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  sent_count integer;
  open_count integer;
begin
  select count(*)::int into sent_count
  from internal.newsletter_sends
  where campaign_id = p_campaign_id
    and status = 'sent'::internal.send_status;

  select count(*)::int into open_count
  from internal.newsletter_sends
  where campaign_id = p_campaign_id
    and status in ('queued'::internal.send_status, 'sending'::internal.send_status);

  update internal.newsletter_campaigns
  set total_sent = sent_count,
      completed_at = case when open_count = 0 then now() else completed_at end
  where id = p_campaign_id;
end;
$$;

comment on function public.newsletter_update_campaign_totals(uuid) is
  'Newsletter send: refresh total_sent and stamp completed_at once the queue is empty.';

-- ---------------------------------------------------------------------------
-- Resend delivery webhook: mark bounced/complained
-- ---------------------------------------------------------------------------

create or replace function public.newsletter_mark_subscriber_delivery_status(
  p_email_normalized text,
  p_status text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  target internal.sub_status;
  n integer;
begin
  if p_status = 'bounced' then
    target := 'bounced'::internal.sub_status;
  elsif p_status = 'complained' then
    target := 'complained'::internal.sub_status;
  else
    return 0;
  end if;

  with updated as (
    update internal.subscribers
    set status = target
    where email_normalized = p_email_normalized
      -- Never resurrect an unsubscribed row into bounced/complained.
      and status in ('active'::internal.sub_status, 'pending'::internal.sub_status)
    returning id
  )
  select count(*)::int into n from updated;
  return n;
end;
$$;

comment on function public.newsletter_mark_subscriber_delivery_status(text, text) is
  'Resend webhook: mark a subscriber bounced or complained, only from a mailable state.';

-- ---------------------------------------------------------------------------
-- Admin runs page + health endpoint readers
-- ---------------------------------------------------------------------------

create or replace function public.automation_recent_runs(p_limit integer)
returns table (
  hanoi_date date,
  result internal.run_result,
  stage text,
  source_kind internal.source_kind,
  attempt_count integer,
  streak_at_decision integer,
  started_at timestamptz,
  completed_at timestamptz,
  error_stage text,
  article_id uuid
)
language sql
stable
security definer
set search_path = ''
as $$
  select r.hanoi_date, r.result, r.stage, r.source_kind, r.attempt_count,
         r.streak_at_decision, r.started_at, r.completed_at, r.error_stage, r.article_id
  from internal.automation_runs r
  order by r.hanoi_date desc
  limit greatest(coalesce(p_limit, 30), 1);
$$;

comment on function public.automation_recent_runs(integer) is
  'Admin dashboard: most recent runs, newest first.';

create or replace function public.automation_runs_since(p_since date)
returns table (
  hanoi_date date,
  result internal.run_result,
  stage text,
  article_id uuid,
  started_at timestamptz,
  completed_at timestamptz,
  error_stage text
)
language sql
stable
security definer
set search_path = ''
as $$
  select r.hanoi_date, r.result, r.stage, r.article_id, r.started_at, r.completed_at, r.error_stage
  from internal.automation_runs r
  where r.hanoi_date >= p_since
  order by r.hanoi_date desc;
$$;

comment on function public.automation_runs_since(date) is
  'Health endpoint: runs on or after a given Hanoi day, to compute coverage.';

create or replace function public.automation_recent_failures(p_limit integer)
returns table (
  ts timestamptz,
  level text,
  stage text,
  code text,
  message text
)
language sql
stable
security definer
set search_path = ''
as $$
  select l.ts, l.level, l.stage, l.code, l.message
  from internal.job_logs l
  where l.level in ('warn','error')
  order by l.ts desc
  limit greatest(coalesce(p_limit, 40), 1);
$$;

comment on function public.automation_recent_failures(integer) is
  'Admin dashboard: recent warn/error log lines.';

-- ---------------------------------------------------------------------------
-- Lock them down. `internal` stays entirely private.
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
      and (
        p.proname like 'newsletter\_%' or
        p.proname in (
          'automation_recent_runs',
          'automation_runs_since',
          'automation_recent_failures'
        )
      )
  loop
    execute format('revoke all on function %s from public', fn.sig);
    execute format('revoke all on function %s from anon', fn.sig);
    execute format('revoke all on function %s from authenticated', fn.sig);
    execute format('grant execute on function %s to service_role', fn.sig);
  end loop;
end;
$grants$;
