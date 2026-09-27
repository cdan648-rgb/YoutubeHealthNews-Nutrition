/**
 * Hand-written types for the `internal` schema.
 *
 * The Supabase type generator cannot see this schema — it is absent from the Data
 * API's exposed-schema list, which is the security boundary working as intended. So
 * these are written by hand, shaped exactly like a generated `Database` so that
 * `createClient<InternalDatabase, 'internal'>` gives fully typed access with no
 * `any` anywhere.
 *
 * The cost is that a migration touching `internal` must be mirrored here. That is
 * the correct trade: the alternative was casting the client to `any`, which silently
 * disabled type checking across every automation query — including the ones that
 * enforce the one-article-per-day guarantee.
 *
 * Column shapes are verified against the real database by the pgTAP suite.
 */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type VideoStatusEnum = 'available' | 'selected' | 'used' | 'ineligible';

export type RunResultEnum =
  | 'running'
  | 'published'
  | 'research_published'
  | 'no_source'
  | 'validation_failed'
  | 'failed'
  | 'expired'
  | 'skipped_window';

export type SourceKindEnum = 'youtube' | 'research' | 'none';

export type SubStatusEnum = 'pending' | 'active' | 'unsubscribed' | 'bounced' | 'complained';

export type SendStatusEnum = 'queued' | 'sending' | 'sent' | 'unknown' | 'failed';

type YoutubeVideoRow = {
  id: string;
  youtube_video_id: string;
  title: string;
  episode_number: number | null;
  /** Generated from `title`; never writable. */
  title_fingerprint: string;
  description_raw: string | null;
  description_clean: string | null;
  low_signal: boolean;
  keywords: string[];
  chapters: Json;
  duration_seconds: number | null;
  view_count: number | null;
  thumbnails: Json;
  /** Generated from `youtube_video_id`; never writable. */
  url: string;
  published_at: string;
  discovered_at: string;
  processed_at: string | null;
  status: VideoStatusEnum;
  ineligible_reason: string | null;
  possible_duplicate_of: string | null;
  attempt_count: number;
  last_error: Json | null;
  metadata: Json;
  created_at: string;
  updated_at: string;
};

type YoutubeVideoInsert = {
  youtube_video_id: string;
  title: string;
  published_at: string;
  id?: string;
  episode_number?: number | null;
  description_raw?: string | null;
  description_clean?: string | null;
  low_signal?: boolean;
  keywords?: string[];
  chapters?: Json;
  duration_seconds?: number | null;
  view_count?: number | null;
  thumbnails?: Json;
  discovered_at?: string;
  processed_at?: string | null;
  status?: VideoStatusEnum;
  ineligible_reason?: string | null;
  possible_duplicate_of?: string | null;
  attempt_count?: number;
  last_error?: Json | null;
  metadata?: Json;
};

type AutomationRunRow = {
  id: string;
  hanoi_date: string;
  trigger: string;
  result: RunResultEnum;
  stage: string;
  artifacts: Json;
  lease_until: string | null;
  lease_token: string | null;
  attempt_count: number;
  source_kind: SourceKindEnum;
  youtube_video_id: string | null;
  research_source_id: string | null;
  article_id: string | null;
  streak_at_decision: number | null;
  started_at: string;
  completed_at: string | null;
  error_stage: string | null;
  error: Json | null;
  timings: Json;
  created_at: string;
  updated_at: string;
};

type AutomationRunInsert = {
  hanoi_date: string;
  id?: string;
  trigger?: string;
  result?: RunResultEnum;
  stage?: string;
  artifacts?: Json;
  lease_until?: string | null;
  lease_token?: string | null;
  attempt_count?: number;
  source_kind?: SourceKindEnum;
  youtube_video_id?: string | null;
  research_source_id?: string | null;
  article_id?: string | null;
  streak_at_decision?: number | null;
  completed_at?: string | null;
  error_stage?: string | null;
  error?: Json | null;
  timings?: Json;
};

type AutomationSettingsRow = {
  id: boolean;
  timezone: string;
  publish_hour_local: number;
  publish_window_end_hour: number;
  abandon_hour_local: number;
  no_source_threshold: number;
  fresh_window_days: number;
  require_approval: boolean;
  paused: boolean;
  dry_run: boolean;
  daily_send_cap: number;
  boilerplate_markers: string[];
  restricted_topics: string[];
  allowed_reference_hosts: string[];
  journal_tiers: Json;
  created_at: string;
  updated_at: string;
};

type JobLogRow = {
  id: number;
  run_id: string | null;
  ts: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  stage: string | null;
  code: string;
  message: string | null;
  context: Json;
};

type JobLogInsert = {
  code: string;
  run_id?: string | null;
  ts?: string;
  level?: 'debug' | 'info' | 'warn' | 'error';
  stage?: string | null;
  message?: string | null;
  context?: Json;
};

type SubscriberRow = {
  id: string;
  email: string;
  /** Generated from `email`; never writable. */
  email_normalized: string;
  status: SubStatusEnum;
  confirm_token_hash: string | null;
  confirm_sent_at: string | null;
  confirm_expires_at: string | null;
  confirmed_at: string | null;
  unsubscribe_token_hash: string;
  consent_text_version: string;
  consent_ip_hmac: string | null;
  consent_user_agent: string | null;
  signup_source: string | null;
  subscribed_at: string;
  unsubscribed_at: string | null;
  created_at: string;
  updated_at: string;
};

type SubscriberInsert = {
  email: string;
  unsubscribe_token_hash: string;
  consent_text_version: string;
  id?: string;
  status?: SubStatusEnum;
  confirm_token_hash?: string | null;
  confirm_sent_at?: string | null;
  confirm_expires_at?: string | null;
  confirmed_at?: string | null;
  consent_ip_hmac?: string | null;
  consent_user_agent?: string | null;
  signup_source?: string | null;
  subscribed_at?: string;
  unsubscribed_at?: string | null;
};

type CampaignRow = {
  id: string;
  article_id: string;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  total_queued: number;
  total_sent: number;
  updated_at: string;
};

type SendRow = {
  id: string;
  campaign_id: string;
  subscriber_id: string;
  /** Generated from the (campaign, subscriber) pair; never writable. */
  idempotency_key: string;
  status: SendStatusEnum;
  attempted_at: string | null;
  sent_at: string | null;
  provider_message_id: string | null;
  attempt_count: number;
  error: Json | null;
  created_at: string;
  updated_at: string;
};

type SendInsert = {
  campaign_id: string;
  subscriber_id: string;
  id?: string;
  status?: SendStatusEnum;
  attempted_at?: string | null;
  sent_at?: string | null;
  provider_message_id?: string | null;
  attempt_count?: number;
  error?: Json | null;
};

type SignupAttemptRow = {
  id: number;
  ip_hmac: string;
  ts: string;
  outcome: string;
};

type ReferenceCacheRow = {
  url_sha256: string;
  url: string;
  final_url: string | null;
  http_status: number | null;
  host: string | null;
  checked_at: string;
  error: string | null;
};

/** Shaped like a generated `Database` so supabase-js can type the client. */
export type InternalDatabase = {
  internal: {
    Tables: {
      youtube_videos: {
        Row: YoutubeVideoRow;
        Insert: YoutubeVideoInsert;
        Update: Partial<YoutubeVideoInsert>;
        Relationships: [];
      };
      automation_runs: {
        Row: AutomationRunRow;
        Insert: AutomationRunInsert;
        Update: Partial<AutomationRunInsert>;
        Relationships: [];
      };
      automation_settings: {
        Row: AutomationSettingsRow;
        Insert: Partial<AutomationSettingsRow>;
        Update: Partial<AutomationSettingsRow>;
        Relationships: [];
      };
      job_logs: {
        Row: JobLogRow;
        Insert: JobLogInsert;
        Update: Partial<JobLogInsert>;
        Relationships: [];
      };
      subscribers: {
        Row: SubscriberRow;
        Insert: SubscriberInsert;
        Update: Partial<SubscriberInsert>;
        Relationships: [];
      };
      newsletter_campaigns: {
        Row: CampaignRow;
        Insert: {
          article_id: string;
          id?: string;
          started_at?: string | null;
          completed_at?: string | null;
          total_queued?: number;
          total_sent?: number;
        };
        Update: Partial<{
          started_at: string | null;
          completed_at: string | null;
          total_queued: number;
          total_sent: number;
        }>;
        Relationships: [];
      };
      newsletter_sends: {
        Row: SendRow;
        Insert: SendInsert;
        Update: Partial<SendInsert>;
        Relationships: [];
      };
      signup_attempts: {
        Row: SignupAttemptRow;
        Insert: { ip_hmac: string; ts?: string; outcome?: string };
        Update: Partial<{ ip_hmac: string; ts: string; outcome: string }>;
        Relationships: [];
      };
      reference_cache: {
        Row: ReferenceCacheRow;
        Insert: {
          url_sha256: string;
          url: string;
          final_url?: string | null;
          http_status?: number | null;
          host?: string | null;
          checked_at?: string;
          error?: string | null;
        };
        Update: Partial<ReferenceCacheRow>;
        Relationships: [];
      };
    };
    Views: Record<never, never>;
    Functions: {
      /**
       * Atomically claims the next video to process. Implemented in SQL because the read
       * and the write must be one statement — see the migration for why.
       */
      claim_next_video: {
        Args: { fresh_window_days?: number };
        Returns: { id: string; youtube_video_id: string; title: string }[];
      };
    };
    Enums: {
      video_status: VideoStatusEnum;
      run_result: RunResultEnum;
      source_kind: SourceKindEnum;
      sub_status: SubStatusEnum;
      send_status: SendStatusEnum;
    };
    CompositeTypes: Record<never, never>;
  };
};
