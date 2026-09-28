/**
 * Article queries.
 *
 * Every function here reads through the anon-key client, so RLS decides visibility:
 * drafts, `needs_review` articles and future-dated publications are invisible to
 * these queries by construction rather than by a `where` clause we must remember to
 * write. The explicit `status`/`published_at` filters below are belt-and-braces and
 * also let Postgres use the partial indexes.
 *
 * Bodies are parsed through the block schema at the boundary. A row whose body does
 * not validate is treated as missing rather than rendered half-way: the alternative
 * is a page that throws inside a deeply nested component.
 */
import { bodySchema, referenceSchema, type Block, type Reference } from '@/lib/domain/blocks';
import {
  toArticleSummary,
  toResearchSource,
  type Article,
  type ArticleRowWithCategory,
  type ArticleSummary,
} from '@/lib/domain/types';
import { isPublicSupabaseConfigured, publicClient } from '@/lib/supabase/server';
import { z } from 'zod';

/** Columns needed for a card. Kept narrow so list pages never ship bodies. */
const SUMMARY_COLUMNS = `
  id, slug, title, dek, article_type, is_fact_check, reading_minutes,
  published_at, published_date_hanoi, created_at,
  hero_kind, hero_image_url, hero_alt, hero_attribution,
  categories!inner ( slug, name, icon_key )
` as const;

const DETAIL_COLUMNS = `
  ${SUMMARY_COLUMNS},
  body_blocks, references_used, source_metadata,
  source_video_youtube_id, source_video_url,
  research_sources ( * )
` as const;

const referencesSchema = z.array(referenceSchema);

/** Rows come back loosely typed because of the joins; narrow at the boundary. */
function asSummaryRows(rows: unknown): ArticleSummary[] {
  if (!Array.isArray(rows)) return [];
  return (rows as ArticleRowWithCategory[]).map(toArticleSummary);
}

export type ArticleListOptions = {
  readonly limit?: number;
  readonly offset?: number;
  /** Omit research pieces, which live in their own section with their own framing. */
  readonly excludeResearch?: boolean;
  readonly categorySlug?: string;
  readonly excludeSlug?: string;
};

/** Published articles, newest first. The backbone of the homepage and Latest News. */
export async function listArticles(options: ArticleListOptions = {}): Promise<ArticleSummary[]> {
  const { limit = 12, offset = 0, excludeResearch = false, categorySlug, excludeSlug } = options;
  if (!isPublicSupabaseConfigured()) return [];

  let query = publicClient()
    .from('articles')
    .select(SUMMARY_COLUMNS)
    .eq('status', 'published')
    .lte('published_at', new Date().toISOString())
    .order('published_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (excludeResearch) query = query.eq('article_type', 'youtube');
  if (categorySlug !== undefined) query = query.eq('categories.slug', categorySlug);
  if (excludeSlug !== undefined) query = query.neq('slug', excludeSlug);

  const { data, error } = await query;
  if (error !== null) throw new Error(`listArticles failed: ${error.message}`);
  return asSummaryRows(data);
}

/** Total published articles, for pagination. */
export async function countArticles(
  options: Pick<ArticleListOptions, 'excludeResearch' | 'categorySlug'> = {},
): Promise<number> {
  if (!isPublicSupabaseConfigured()) return 0;
  let query = publicClient()
    .from('articles')
    .select('id, categories!inner(slug)', { count: 'exact', head: true })
    .eq('status', 'published')
    .lte('published_at', new Date().toISOString());

  if (options.excludeResearch === true) query = query.eq('article_type', 'youtube');
  if (options.categorySlug !== undefined) query = query.eq('categories.slug', options.categorySlug);

  const { count, error } = await query;
  if (error !== null) throw new Error(`countArticles failed: ${error.message}`);
  return count ?? 0;
}

/** Research articles only. Separate section, separate URL space, separate framing. */
export async function listResearchArticles(limit = 12, offset = 0): Promise<ArticleSummary[]> {
  if (!isPublicSupabaseConfigured()) return [];
  const { data, error } = await publicClient()
    .from('articles')
    .select(SUMMARY_COLUMNS)
    .eq('status', 'published')
    .eq('article_type', 'research')
    .lte('published_at', new Date().toISOString())
    .order('published_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error !== null) throw new Error(`listResearchArticles failed: ${error.message}`);
  return asSummaryRows(data);
}

/** Articles flagged as fact-checks. A format flag, not an eighth category. */
export async function listFactChecks(limit = 12): Promise<ArticleSummary[]> {
  if (!isPublicSupabaseConfigured()) return [];
  const { data, error } = await publicClient()
    .from('articles')
    .select(SUMMARY_COLUMNS)
    .eq('status', 'published')
    .eq('is_fact_check', true)
    .lte('published_at', new Date().toISOString())
    .order('published_at', { ascending: false })
    .limit(limit);

  if (error !== null) throw new Error(`listFactChecks failed: ${error.message}`);
  return asSummaryRows(data);
}

/**
 * One article by slug, with body and references parsed.
 *
 * Returns null for a missing slug AND for a row whose body fails validation. The
 * caller renders a 404 either way, because a body we cannot trust is not something
 * to show a reader on a health site.
 */
export async function getArticleBySlug(
  slug: string,
): Promise<{ article: Article; invalidBody: boolean } | null> {
  if (!isPublicSupabaseConfigured()) return null;
  const { data, error } = await publicClient()
    .from('articles')
    .select(DETAIL_COLUMNS)
    .eq('slug', slug)
    .eq('status', 'published')
    .lte('published_at', new Date().toISOString())
    .maybeSingle();

  if (error !== null) throw new Error(`getArticleBySlug failed: ${error.message}`);
  if (data === null) return null;

  const row = data as unknown as ArticleRowWithCategory & {
    body_blocks: unknown;
    references_used: unknown;
    source_metadata: unknown;
    source_video_youtube_id: string | null;
    source_video_url: string | null;
    research_sources: Parameters<typeof toResearchSource>[0] | null;
  };

  const summary = toArticleSummary(row);

  const parsedBody = bodySchema.safeParse(row.body_blocks);
  const parsedRefs = referencesSchema.safeParse(row.references_used);

  const body: readonly Block[] = parsedBody.success ? parsedBody.data : [];
  const references: readonly Reference[] = parsedRefs.success ? parsedRefs.data : [];

  const meta =
    row.source_metadata !== null && typeof row.source_metadata === 'object'
      ? (row.source_metadata as Record<string, unknown>)
      : {};

  const sourceVideo =
    row.source_video_youtube_id !== null
      ? {
          youtubeVideoId: row.source_video_youtube_id,
          url:
            row.source_video_url ??
            `https://www.youtube.com/watch?v=${row.source_video_youtube_id}`,
          title: typeof meta.video_title === 'string' ? meta.video_title : summary.title,
          channelTitle:
            typeof meta.channel_title === 'string'
              ? meta.channel_title
              : 'Bác sĩ Trần Văn Phúc Official',
          publishedAt: typeof meta.video_published_at === 'string' ? meta.video_published_at : null,
          durationSeconds:
            typeof meta.video_duration_seconds === 'number' ? meta.video_duration_seconds : null,
        }
      : null;

  return {
    article: {
      ...summary,
      body,
      references,
      sourceVideo,
      researchSource: row.research_sources !== null ? toResearchSource(row.research_sources) : null,
    },
    invalidBody: !parsedBody.success,
  };
}

/**
 * Related stories: same category first, then recent across the site.
 *
 * Two queries rather than one clever one, because the fallback must not be able to
 * return fewer than `limit` items just because a young category is thin.
 */
export async function listRelatedArticles(
  article: Pick<ArticleSummary, 'slug' | 'category'>,
  limit = 3,
): Promise<ArticleSummary[]> {
  const sameCategory = await listArticles({
    limit,
    categorySlug: article.category.slug,
    excludeSlug: article.slug,
  });
  if (sameCategory.length >= limit) return sameCategory;

  const filler = await listArticles({ limit: limit + 1 + sameCategory.length });
  const seen = new Set([article.slug, ...sameCategory.map((item) => item.slug)]);
  return [...sameCategory, ...filler.filter((item) => !seen.has(item.slug))].slice(0, limit);
}

/** Every published slug with its last-modified time. Feeds the sitemap and RSS. */
export async function listPublishedSlugs(): Promise<
  { slug: string; articleType: string; updatedAt: string; publishedAt: string }[]
> {
  if (!isPublicSupabaseConfigured()) return [];
  const { data, error } = await publicClient()
    .from('articles')
    .select('slug, article_type, updated_at, published_at')
    .eq('status', 'published')
    .lte('published_at', new Date().toISOString())
    .order('published_at', { ascending: false });

  if (error !== null) throw new Error(`listPublishedSlugs failed: ${error.message}`);
  return (data ?? []).map((row) => ({
    slug: row.slug,
    articleType: row.article_type,
    updatedAt: row.updated_at,
    publishedAt: row.published_at ?? row.updated_at,
  }));
}
