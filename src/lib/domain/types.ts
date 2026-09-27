/**
 * Shared domain types.
 *
 * Two layers deliberately:
 *
 *   * `public` tables are typed from the generated `database.types.ts`, so a
 *     migration that changes a column breaks the build.
 *   * `internal` tables are typed by hand here, because the generator cannot see
 *     that schema — it is not exposed through the Data API. That absence is the
 *     security boundary working as intended, so hand-written types are the correct
 *     cost rather than a workaround. They are exercised against the real database by
 *     the pgTAP suite and by the repository layer.
 */
import type { Block, Reference } from '@/lib/domain/blocks';
import type { HanoiDate } from '@/lib/time';
import type { Database } from '@/lib/supabase/database.types';

/* ============================== public schema ============================== */

export type ArticleRow = Database['public']['Tables']['articles']['Row'];
export type CategoryRow = Database['public']['Tables']['categories']['Row'];
export type ResearchSourceRow = Database['public']['Tables']['research_sources']['Row'];

export type ArticleType = Database['public']['Enums']['article_type'];
export type ArticleStatus = Database['public']['Enums']['article_status'];
export type HeroKind = Database['public']['Enums']['hero_kind'];

/** Category icon keys. Mirrors the seeded `icon_key` values. */
export type IconKey = 'molecule' | 'flame' | 'wave' | 'shield' | 'organ' | 'joint' | 'breath';

export const ICON_KEYS: readonly IconKey[] = [
  'molecule',
  'flame',
  'wave',
  'shield',
  'organ',
  'joint',
  'breath',
];

export function asIconKey(value: string): IconKey {
  return (ICON_KEYS as readonly string[]).includes(value) ? (value as IconKey) : 'molecule';
}

export type Category = {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly description: string;
  readonly iconKey: IconKey;
  readonly sortOrder: number;
  readonly seoTitle: string | null;
  readonly seoDescription: string | null;
};

/**
 * The hero image. `kind` records which rung of the fallback ladder was used, so a
 * site-wide switch away from hotlinked thumbnails is a rendering change rather than
 * a data migration.
 */
export type Hero =
  | {
      readonly kind: 'youtube_thumbnail';
      readonly url: string;
      readonly alt: string;
      readonly attribution: string;
    }
  | { readonly kind: 'svg'; readonly alt: string; readonly motif: IconKey }
  | { readonly kind: 'none' };

/** Everything a card needs, and nothing more: cards never fetch a body. */
export type ArticleSummary = {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly dek: string;
  readonly articleType: ArticleType;
  readonly isFactCheck: boolean;
  readonly readingMinutes: number;
  readonly publishedAt: string;
  readonly publishedDateHanoi: string | null;
  readonly hero: Hero;
  readonly category: Pick<Category, 'slug' | 'name' | 'iconKey'>;
};

export type SourceVideo = {
  readonly youtubeVideoId: string;
  readonly url: string;
  readonly title: string;
  readonly channelTitle: string;
  readonly publishedAt: string | null;
  readonly durationSeconds: number | null;
};

export type ResearchSource = {
  readonly id: string;
  readonly title: string;
  readonly authors: readonly { readonly name: string; readonly affiliation?: string }[];
  readonly journal: string | null;
  readonly doi: string | null;
  readonly publicationDate: string | null;
  readonly sourceUrl: string;
  readonly isOpenAccess: boolean | null;
  readonly citedByCount: number | null;
  /** Kept so a past selection can be inspected; never presented as a ranking claim. */
  readonly scoreComponents: Record<string, unknown> | null;
};

export type Article = ArticleSummary & {
  readonly body: readonly Block[];
  readonly references: readonly Reference[];
  readonly sourceVideo: SourceVideo | null;
  readonly researchSource: ResearchSource | null;
};

/* ============================= internal schema ============================= */

export type VideoStatus = 'available' | 'selected' | 'used' | 'ineligible';

export type IneligibleReason =
  'is_short' | 'placeholder' | 'insufficient_source' | 'live_not_ended' | 'unavailable';

/**
 * Thumbnails available for a video. `best` is chosen once at ingest by probing,
 * because `maxresdefault.jpg` 404s on many videos and probing at render time would
 * leave broken heroes.
 */
export type ThumbnailSet = {
  readonly best: string | null;
  readonly variants: Readonly<Partial<Record<'maxres' | 'sd' | 'hq' | 'mq', string>>>;
};

export type VideoChapter = { readonly seconds: number; readonly label: string };

export type YoutubeVideo = {
  readonly id: string;
  readonly youtubeVideoId: string;
  readonly title: string;
  readonly episodeNumber: number | null;
  readonly titleFingerprint: string;
  readonly descriptionRaw: string | null;
  readonly descriptionClean: string | null;
  readonly lowSignal: boolean;
  readonly keywords: readonly string[];
  readonly chapters: readonly VideoChapter[];
  readonly durationSeconds: number | null;
  readonly viewCount: number | null;
  readonly thumbnails: ThumbnailSet;
  readonly url: string;
  readonly publishedAt: string;
  readonly discoveredAt: string;
  readonly processedAt: string | null;
  readonly status: VideoStatus;
  readonly ineligibleReason: IneligibleReason | null;
  readonly possibleDuplicateOf: string | null;
  readonly attemptCount: number;
};

export type RunResult =
  | 'running'
  | 'published'
  | 'research_published'
  | 'no_source'
  | 'validation_failed'
  | 'failed'
  | 'expired'
  | 'skipped_window';

export type SourceKind = 'youtube' | 'research' | 'none';

export type AutomationRun = {
  readonly id: string;
  readonly hanoiDate: HanoiDate;
  readonly trigger: string;
  readonly result: RunResult;
  readonly stage: string;
  readonly leaseUntil: string | null;
  readonly leaseToken: string | null;
  readonly attemptCount: number;
  readonly sourceKind: SourceKind;
  readonly youtubeVideoId: string | null;
  readonly researchSourceId: string | null;
  readonly articleId: string | null;
  readonly streakAtDecision: number | null;
  readonly startedAt: string;
  readonly completedAt: string | null;
  readonly errorStage: string | null;
};

export type AutomationSettings = {
  readonly timezone: string;
  readonly publishHourLocal: number;
  readonly publishWindowEndHour: number;
  readonly abandonHourLocal: number;
  readonly noSourceThreshold: number;
  readonly freshWindowDays: number;
  readonly requireApproval: boolean;
  readonly paused: boolean;
  readonly dryRun: boolean;
  readonly dailySendCap: number;
  readonly boilerplateMarkers: readonly string[];
  readonly restrictedTopics: readonly string[];
  readonly allowedReferenceHosts: readonly string[];
  readonly journalTiers: Readonly<Record<string, unknown>>;
};

/** Stable failure and lifecycle codes written to `internal.job_logs`. */
export type JobLogCode =
  | 'ingest_api_failed'
  | 'ingest_degraded'
  | 'ingest_completed'
  | 'no_eligible_source'
  | 'openrouter_failed'
  | 'ai_malformed_output'
  | 'validation_failed'
  | 'restricted_topic'
  | 'db_failed'
  | 'revalidate_failed'
  | 'email_send_failed'
  | 'email_quota_reached'
  | 'research_none_found'
  | 'research_selected'
  | 'run_claimed'
  | 'run_expired'
  | 'run_completed'
  | 'lease_lost'
  | 'possible_duplicate_video'
  | 'stage_completed';

export type JobLogLevel = 'debug' | 'info' | 'warn' | 'error';

/* ================================ mappers ================================== */

export function toCategory(row: CategoryRow): Category {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    iconKey: asIconKey(row.icon_key),
    sortOrder: row.sort_order,
    seoTitle: row.seo_title,
    seoDescription: row.seo_description,
  };
}

type HeroColumns = Pick<
  ArticleRow,
  'hero_kind' | 'hero_image_url' | 'hero_alt' | 'hero_attribution'
>;

/**
 * Builds the hero from the row's loosely coupled columns.
 *
 * The database already guarantees these combinations are coherent
 * (`thumbnail_hero_is_attributed`, `image_hero_has_alt`, `published_has_hero`), so
 * the fallbacks here are defence rather than routine: an article can never render
 * as a blank box, and a thumbnail can never render without its credit.
 */
export function toHero(row: HeroColumns, motif: IconKey): Hero {
  if (row.hero_kind === 'youtube_thumbnail' && row.hero_image_url !== null) {
    return {
      kind: 'youtube_thumbnail',
      url: row.hero_image_url,
      alt: row.hero_alt ?? '',
      attribution: row.hero_attribution ?? 'YouTube',
    };
  }
  if (row.hero_kind === 'svg') {
    return { kind: 'svg', alt: row.hero_alt ?? '', motif };
  }
  return { kind: 'none' };
}

export function toResearchSource(row: ResearchSourceRow): ResearchSource {
  const authors = Array.isArray(row.authors)
    ? (row.authors as unknown[]).flatMap((entry) => {
        if (entry !== null && typeof entry === 'object' && 'name' in entry) {
          const record = entry as { name?: unknown; affiliation?: unknown };
          if (typeof record.name === 'string') {
            return typeof record.affiliation === 'string'
              ? [{ name: record.name, affiliation: record.affiliation }]
              : [{ name: record.name }];
          }
        }
        return [];
      })
    : [];

  return {
    id: row.id,
    title: row.title,
    authors,
    journal: row.journal,
    doi: row.doi_normalized,
    publicationDate: row.publication_date,
    sourceUrl: row.source_url,
    isOpenAccess: row.is_open_access,
    citedByCount: row.cited_by_count,
    scoreComponents:
      row.score_components !== null && typeof row.score_components === 'object'
        ? (row.score_components as Record<string, unknown>)
        : null,
  };
}

/** Narrowed shape returned by the article queries: the joined category comes along. */
export type ArticleRowWithCategory = ArticleRow & {
  categories: Pick<CategoryRow, 'slug' | 'name' | 'icon_key'> | null;
};

export function toArticleSummary(row: ArticleRowWithCategory): ArticleSummary {
  const iconKey = asIconKey(row.categories?.icon_key ?? 'molecule');
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    dek: row.dek,
    articleType: row.article_type,
    isFactCheck: row.is_fact_check,
    readingMinutes: row.reading_minutes ?? 1,
    // Queries only ever return published rows, where the database guarantees this
    // is non-null (`published_needs_dates`).
    publishedAt: row.published_at ?? row.created_at,
    publishedDateHanoi: row.published_date_hanoi,
    hero: toHero(row, iconKey),
    category: {
      slug: row.categories?.slug ?? 'vi-chat-vitamin',
      name: row.categories?.name ?? 'Vi chất & Vitamin',
      iconKey,
    },
  };
}
