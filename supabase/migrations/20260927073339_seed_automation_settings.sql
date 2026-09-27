-- ============================================================================
-- Phase 1 / 0012 — seed the automation settings singleton
-- ============================================================================
-- publish_hour_local = 11 is not arbitrary: the source channel uploads at roughly
-- 09:00 Hanoi on Saturdays (measured from real publishedAt values), so an earlier
-- hour would systematically miss each new episode until the following day.
--
-- Idempotent, and deliberately does NOT overwrite on conflict: once running, these
-- values are operational state that an operator may have tuned, and a later
-- migration must not silently reset a pause or an approval requirement.

insert into internal.automation_settings (
  id,
  timezone,
  publish_hour_local,
  publish_window_end_hour,
  abandon_hour_local,
  no_source_threshold,
  fresh_window_days,
  require_approval,
  paused,
  dry_run,
  daily_send_cap,
  boilerplate_markers,
  restricted_topics,
  allowed_reference_hosts,
  journal_tiers
) values (
  true,
  'Asia/Ho_Chi_Minh',
  11,   -- publish hour, Hanoi local
  22,   -- window closes; a run is never claimed near midnight
  23,   -- unfinished runs abandoned from 23:00, so nothing crosses midnight
  3,    -- research fires once three consecutive prior Hanoi days were 'no_source'
  21,   -- a video counts as "fresh" for 21 days after ITS publish date
  true, -- every generated article needs manual approval until explicitly relaxed
  false,
  false,
  90,   -- below Resend's 100/day free-tier limit, so we stop rather than fail en masse

  -- Everything from the first marker onward is channel boilerplate, not editorial
  -- content. Taken verbatim from the real video descriptions.
  array[
    '🚀 Đừng quên kết nối',
    '🎯 QUÝ KHÁN GIẢ LƯU Ý',
    '© Bản quyền',
    '© Copyright by',
    'Please do not Reup',
    '• Đăng ký kênh',
    'Kênh YouTube chính thức của'
  ],

  -- Topics that must never auto-publish however well the text validates: they are
  -- routed to needs_review regardless of validation score.
  array[
    'dosing_protocol',
    'paediatric_dosing',
    'pregnancy_advice',
    'cancer_treatment_choice',
    'drug_interaction',
    'vaccine_safety_controversy',
    'cure_claim',
    'self_diagnosis'
  ],

  -- Only these hosts may be cited as authoritative. Anything else fails validation.
  array[
    'who.int',
    'nih.gov',
    'ods.od.nih.gov',
    'nccih.nih.gov',
    'ncbi.nlm.nih.gov',
    'pubmed.ncbi.nlm.nih.gov',
    'pmc.ncbi.nlm.nih.gov',
    'medlineplus.gov',
    'europepmc.org',
    'cdc.gov',
    'cochrane.org',
    'cochranelibrary.com',
    'efsa.europa.eu',
    'ema.europa.eu',
    'nice.org.uk',
    'moh.gov.vn',
    'doi.org',
    'nejm.org',
    'thelancet.com',
    'jamanetwork.com',
    'bmj.com',
    'nature.com',
    'science.org'
  ],

  -- Journal tiers for the research score. 3 = general flagship, 2 = major specialty,
  -- everything else indexed scores 1 by default.
  jsonb_build_object(
    'tier3', jsonb_build_array(
      'New England Journal of Medicine','The Lancet','JAMA','BMJ',
      'Nature','Science','Nature Medicine','Cell'),
    'tier2', jsonb_build_array(
      'European Heart Journal','Diabetes Care','Gut','Circulation',
      'Journal of Clinical Oncology','The Lancet Oncology','Annals of Internal Medicine',
      'JAMA Internal Medicine','American Journal of Clinical Nutrition','Blood',
      'Gastroenterology','Journal of the American College of Cardiology'),
    'default', 1
  )
)
on conflict (id) do nothing;
