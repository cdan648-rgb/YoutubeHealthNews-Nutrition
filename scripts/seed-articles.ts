#!/usr/bin/env tsx
/**
 * Inserts the five editorial seed articles.
 *
 * Two modes, and the second one matters:
 *
 *   npm run seed            insert directly (needs SUPABASE_SERVICE_ROLE_KEY)
 *   npm run seed:sql        print the equivalent SQL to stdout
 *
 * The SQL mode exists so the database can be seeded from exactly the same definitions
 * without a service-role key on the machine doing it — the SQL is generated from
 * `SEED_ARTICLES`, so what lands in the database cannot drift from what is committed.
 *
 * Idempotent either way: `ON CONFLICT (slug) DO UPDATE` refreshes an existing seed
 * rather than failing or duplicating, so re-running after an edit is the normal way to
 * update one.
 *
 * Seeds carry `automation_run_id = NULL`. They are editorial back catalogue, not
 * automated daily publications, so they must not occupy a Hanoi publishing date.
 */
import process from 'node:process';
import { SEED_ARTICLES, heroUrl } from '../src/content/seeds';
import { blocksToPlainText, countWords } from '../src/lib/domain/blocks';
import { loadVideoFixture } from '../tests/fixtures';
import { extractEpisodeNumber } from '../src/lib/slug';
import { SOURCE_CHANNEL } from '../src/lib/site';

type SeedRow = {
  slug: string;
  title: string;
  dek: string;
  body_blocks: string;
  body_text: string;
  word_count: number;
  article_type: 'youtube';
  category_slug: string;
  is_fact_check: boolean;
  source_video_youtube_id: string;
  source_video_url: string;
  source_metadata: string;
  references_used: string;
  hero_kind: 'youtube_thumbnail';
  hero_image_url: string;
  hero_alt: string;
  hero_attribution: string;
  status: 'published';
  seo: string;
  published_at: string;
  published_date_hanoi: string;
};

/**
 * The source-video row an article of type `youtube` must reference.
 *
 * `articles.article_type = 'youtube'` requires a non-null `source_video_id`, so seeding
 * an article means seeding its video. These rows come straight from the captured
 * fixtures, so the metadata is the channel's real metadata.
 *
 * They are inserted with `status = 'used'`, which is not incidental: it permanently
 * removes these five videos from the automation's selection pool, so the daily job can
 * never produce a second article from a video a seed already covers. The `used` state is
 * terminal at the database level, so that exclusion cannot be undone by accident.
 *
 * Deliberately minimal: no description or keywords. Populating those is the ingestion
 * layer's job, and it will enrich these rows on its next pass (ingestion updates
 * metadata but never resurrects a `used` video). Duplicating the text here would create
 * a second source of truth for it.
 */
function buildVideoRow(seed: (typeof SEED_ARTICLES)[number]) {
  const fixture = loadVideoFixture(seed.videoId);
  return {
    youtube_video_id: fixture.videoId,
    title: fixture.title,
    duration_seconds: fixture.lengthSeconds,
    view_count: fixture.viewCount,
    thumbnails: {
      best: heroUrl(fixture.videoId),
      variants: {
        maxres: `https://i.ytimg.com/vi/${fixture.videoId}/maxresdefault.jpg`,
        sd: `https://i.ytimg.com/vi/${fixture.videoId}/sddefault.jpg`,
        hq: `https://i.ytimg.com/vi/${fixture.videoId}/hqdefault.jpg`,
      },
    },
    published_at: new Date(fixture.publishDate).toISOString(),
    status: 'used' as const,
    episode_number: extractEpisodeNumber(fixture.title),
  };
}

/** Builds the row for one seed, pulling video metadata from its captured fixture. */
function buildRow(seed: (typeof SEED_ARTICLES)[number]): SeedRow {
  const fixture = loadVideoFixture(seed.videoId);
  const bodyText = blocksToPlainText(seed.body);

  return {
    slug: seed.slug,
    title: seed.title,
    dek: seed.dek,
    body_blocks: JSON.stringify(seed.body),
    body_text: bodyText,
    word_count: countWords(bodyText),
    article_type: 'youtube',
    category_slug: seed.categorySlug,
    is_fact_check: seed.isFactCheck,
    source_video_youtube_id: fixture.videoId,
    source_video_url: `https://www.youtube.com/watch?v=${fixture.videoId}`,
    source_metadata: JSON.stringify({
      video_title: fixture.title,
      channel_title: fixture.channelTitle,
      channel_id: fixture.channelId,
      video_published_at: fixture.publishDate,
      video_duration_seconds: fixture.lengthSeconds,
      // Recorded so a reader or reviewer can see what the article was built from.
      derived_from: 'public video description and metadata',
      transcript_available: false,
      editorial: 'hand-written seed article, human-reviewed',
    }),
    references_used: JSON.stringify(seed.references),
    hero_kind: 'youtube_thumbnail',
    hero_image_url: heroUrl(fixture.videoId),
    hero_alt: `Ảnh đại diện video “${fixture.title}” trên kênh ${fixture.channelTitle}`,
    hero_attribution: `Ảnh: YouTube / ${SOURCE_CHANNEL.title}`,
    status: 'published',
    seo: JSON.stringify(seed.seo),
    // 04:00Z is 11:00 Hanoi — the publishing hour, so the seeds' timestamps are
    // consistent with the schedule the automation will follow.
    published_at: `${seed.publishedDateHanoi}T04:00:00Z`,
    published_date_hanoi: seed.publishedDateHanoi,
  };
}

/** Single-quote escaping for SQL literals. */
function lit(value: string | number | boolean): string {
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return `'${value.replace(/'/g, "''")}'`;
}

function videosSql(seeds: readonly (typeof SEED_ARTICLES)[number][]): string {
  const values = seeds
    .map((seed) => {
      const v = buildVideoRow(seed);
      return `  (${lit(v.youtube_video_id)}, ${lit(v.title)}, ${v.duration_seconds}, ${v.view_count},
   ${lit(JSON.stringify(v.thumbnails))}::jsonb, ${lit(v.published_at)}::timestamptz,
   'used', ${v.episode_number ?? 'null'}, now())`;
    })
    .join(',\n');

  return `-- Source videos for the seed articles, from the captured channel metadata.
-- Inserted as 'used' so the daily automation can never select them again.
insert into internal.youtube_videos (
  youtube_video_id, title, duration_seconds, view_count,
  thumbnails, published_at, status, episode_number, processed_at
)
select v.youtube_video_id, v.title, v.duration_seconds, v.view_count,
       v.thumbnails, v.published_at, v.status::internal.video_status, v.episode_number, v.processed_at
from (values
${values}
) as v(youtube_video_id, title, duration_seconds, view_count,
       thumbnails, published_at, status, episode_number, processed_at)
on conflict (youtube_video_id) do update set
  view_count = excluded.view_count,
  thumbnails = excluded.thumbnails;
`;
}

function toSql(rows: readonly SeedRow[]): string {
  const values = rows
    .map(
      (row) => `  (
    ${lit(row.slug)}, ${lit(row.title)}, ${lit(row.dek)},
    ${lit(row.body_blocks)}::jsonb, ${lit(row.body_text)}, ${row.word_count},
    'youtube', (select id from public.categories where slug = ${lit(row.category_slug)}),
    ${lit(row.is_fact_check)},
    (select id from internal.youtube_videos where youtube_video_id = ${lit(row.source_video_youtube_id)}),
    ${lit(row.source_video_youtube_id)}, ${lit(row.source_video_url)},
    ${lit(row.source_metadata)}::jsonb, ${lit(row.references_used)}::jsonb,
    'youtube_thumbnail', ${lit(row.hero_image_url)}, ${lit(row.hero_alt)}, ${lit(row.hero_attribution)},
    'published', ${lit(row.seo)}::jsonb,
    ${lit(row.published_at)}::timestamptz, ${lit(row.published_date_hanoi)}::date
  )`,
    )
    .join(',\n');

  return `-- Generated by scripts/seed-articles.ts. Do not edit by hand: edit the seed
-- definitions in src/content/seeds/ and regenerate with \`npm run seed:sql\`.
--
-- automation_run_id is left NULL: these are editorial seed articles, not automated
-- daily publications, so they occupy no Hanoi publishing date.
insert into public.articles (
  slug, title, dek,
  body_blocks, body_text, word_count,
  article_type, category_id,
  is_fact_check,
  source_video_id,
  source_video_youtube_id, source_video_url,
  source_metadata, references_used,
  hero_kind, hero_image_url, hero_alt, hero_attribution,
  status, seo,
  published_at, published_date_hanoi
) values
${values}
on conflict (slug) do update set
  title = excluded.title,
  dek = excluded.dek,
  body_blocks = excluded.body_blocks,
  body_text = excluded.body_text,
  word_count = excluded.word_count,
  category_id = excluded.category_id,
  is_fact_check = excluded.is_fact_check,
  source_metadata = excluded.source_metadata,
  references_used = excluded.references_used,
  hero_image_url = excluded.hero_image_url,
  hero_alt = excluded.hero_alt,
  hero_attribution = excluded.hero_attribution,
  seo = excluded.seo,
  published_at = excluded.published_at,
  published_date_hanoi = excluded.published_date_hanoi;
`;
}

async function insertDirect(rows: readonly SeedRow[]): Promise<void> {
  const { serviceClient } = await import('../src/lib/supabase/service');
  const { publicClient } = await import('../src/lib/supabase/server');

  const { data: categories, error: catError } = await publicClient()
    .from('categories')
    .select('id, slug');
  if (catError !== null) throw new Error(`could not read categories: ${catError.message}`);

  const categoryIds = new Map((categories ?? []).map((row) => [row.slug, row.id]));
  const client = serviceClient();

  // Videos first: an article of type 'youtube' cannot exist without its source row.
  const { internalClient } = await import('../src/lib/supabase/service');
  const internal = internalClient();
  const videoIds = new Map<string, string>();
  for (const seed of SEED_ARTICLES) {
    const video = buildVideoRow(seed);
    const { data, error } = await internal
      .from('youtube_videos')
      .upsert(video, { onConflict: 'youtube_video_id' })
      .select('id, youtube_video_id')
      .maybeSingle();
    if (error !== null) throw new Error(`upsert video ${video.youtube_video_id}: ${error.message}`);
    if (data !== null) videoIds.set(data.youtube_video_id, data.id);
    console.log(`  ok  video ${video.youtube_video_id}`);
  }

  for (const row of rows) {
    const categoryId = categoryIds.get(row.category_slug);
    if (categoryId === undefined) {
      throw new Error(`category ${row.category_slug} is not seeded; run the migrations first`);
    }

    const { error } = await client.from('articles').upsert(
      {
        slug: row.slug,
        title: row.title,
        dek: row.dek,
        body_blocks: JSON.parse(row.body_blocks),
        body_text: row.body_text,
        word_count: row.word_count,
        article_type: 'youtube',
        category_id: categoryId,
        is_fact_check: row.is_fact_check,
        source_video_id: videoIds.get(row.source_video_youtube_id) ?? null,
        source_video_youtube_id: row.source_video_youtube_id,
        source_video_url: row.source_video_url,
        source_metadata: JSON.parse(row.source_metadata),
        references_used: JSON.parse(row.references_used),
        hero_kind: 'youtube_thumbnail',
        hero_image_url: row.hero_image_url,
        hero_alt: row.hero_alt,
        hero_attribution: row.hero_attribution,
        status: 'published',
        seo: JSON.parse(row.seo),
        published_at: row.published_at,
        published_date_hanoi: row.published_date_hanoi,
      },
      { onConflict: 'slug' },
    );
    if (error !== null) throw new Error(`upsert ${row.slug} failed: ${error.message}`);
    console.log(`  ok  ${row.slug}`);
  }
}

const rows = SEED_ARTICLES.map(buildRow);

if (process.argv.includes('--sql')) {
  process.stdout.write(`${videosSql(SEED_ARTICLES)}\n${toSql(rows)}`);
} else {
  console.log(`Seeding ${rows.length} editorial articles…`);
  await insertDirect(rows);
  console.log('Done.');
}
