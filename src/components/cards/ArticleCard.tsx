import Link from 'next/link';
import type { ArticleSummary } from '@/lib/domain/types';
import { articlePath, routes } from '@/lib/site';
import { SourceHero } from '@/components/article/SourceHero';

/**
 * Article card, in three sizes.
 *
 * `lead` is the homepage hero, `standard` the grid, `compact` the sidebar and related
 * rails. One component rather than three so the badge rules, the attribution and the
 * date formatting cannot drift apart between placements.
 */

export type CardSize = 'lead' | 'standard' | 'compact';

/**
 * Formats the publication date in Hanoi terms.
 *
 * Uses `publishedDateHanoi` — the stored Hanoi calendar date — in preference to
 * reformatting the timestamp, so the date a reader sees is exactly the date the
 * publishing rules used. Falls back to the timestamp only for older rows.
 */
function formatDate(article: ArticleSummary): string {
  const iso = article.publishedDateHanoi ?? article.publishedAt.slice(0, 10);
  const [year, month, dayOfMonth] = iso.split('-');
  return `${dayOfMonth}/${month}/${year}`;
}

function Badges({ article }: { article: ArticleSummary }) {
  return (
    <span className="flex flex-wrap items-center gap-2 text-[11px] font-semibold tracking-wider uppercase">
      <Link
        href={routes.category(article.category.slug)}
        className="text-accent-ink hover:underline"
      >
        {article.category.name}
      </Link>
      {article.isFactCheck && (
        <span className="text-fact border-fact/40 rounded-sm border px-1.5 py-px">Kiểm chứng</span>
      )}
      {article.articleType === 'research' && (
        <span className="text-research border-research/40 rounded-sm border px-1.5 py-px">
          Nghiên cứu
        </span>
      )}
    </span>
  );
}

export function ArticleCard({
  article,
  size = 'standard',
  priority = false,
}: {
  readonly article: ArticleSummary;
  readonly size?: CardSize;
  readonly priority?: boolean;
}) {
  const href = articlePath(article);

  if (size === 'compact') {
    return (
      <article className="group flex gap-3">
        <div className="w-24 shrink-0 sm:w-28">
          <SourceHero hero={article.hero} />
        </div>
        <div className="min-w-0">
          <Badges article={article} />
          <h3 className="font-display mt-1 text-sm leading-snug font-semibold">
            <Link href={href} className="group-hover:text-accent-ink">
              {article.title}
            </Link>
          </h3>
          <p className="text-ink-3 mt-1 text-xs">
            {formatDate(article)} · {article.readingMinutes} phút đọc
          </p>
        </div>
      </article>
    );
  }

  if (size === 'lead') {
    return (
      <article className="group grid gap-5 lg:grid-cols-[1.35fr_1fr] lg:gap-8">
        <SourceHero hero={article.hero} priority={priority} />
        <div className="flex flex-col justify-center">
          <Badges article={article} />
          <h2 className="font-display mt-2 text-2xl leading-[1.15] font-bold tracking-tight sm:text-3xl lg:text-4xl">
            <Link href={href} className="group-hover:text-accent-ink">
              {article.title}
            </Link>
          </h2>
          <p className="text-ink-2 mt-3 text-base leading-relaxed sm:text-lg">{article.dek}</p>
          <p className="text-ink-3 mt-3 text-xs">
            {formatDate(article)} · {article.readingMinutes} phút đọc
          </p>
        </div>
      </article>
    );
  }

  return (
    <article className="group flex flex-col">
      <SourceHero hero={article.hero} priority={priority} />
      <div className="mt-3 flex flex-1 flex-col">
        <Badges article={article} />
        <h3 className="font-display mt-1.5 text-lg leading-snug font-bold tracking-tight">
          <Link href={href} className="group-hover:text-accent-ink">
            {article.title}
          </Link>
        </h3>
        <p className="text-ink-2 mt-2 line-clamp-3 text-[15px] leading-relaxed">{article.dek}</p>
        <p className="text-ink-3 mt-auto pt-3 text-xs">
          {formatDate(article)} · {article.readingMinutes} phút đọc
        </p>
      </div>
    </article>
  );
}

/** Section heading used across the homepage and index pages. */
export function SectionHeading({
  title,
  href,
  linkLabel = 'Xem tất cả',
  accent,
}: {
  readonly title: string;
  readonly href?: string;
  readonly linkLabel?: string;
  readonly accent?: 'research' | 'fact';
}) {
  return (
    <div className="border-ink mb-6 flex items-baseline justify-between gap-4 border-b pb-2">
      <h2
        className={`font-display text-sm font-bold tracking-wider uppercase ${
          accent === 'research' ? 'text-research' : accent === 'fact' ? 'text-fact' : ''
        }`}
      >
        {title}
      </h2>
      {href !== undefined && (
        <Link href={href} className="text-accent-ink shrink-0 text-xs hover:underline">
          {linkLabel} →
        </Link>
      )}
    </div>
  );
}
