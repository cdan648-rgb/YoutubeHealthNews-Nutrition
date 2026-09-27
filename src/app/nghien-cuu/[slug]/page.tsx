import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArticleBody, ReferenceList } from '@/components/article/ArticleBody';
import { SourceHero } from '@/components/article/SourceHero';
import { ArticleCard, SectionHeading } from '@/components/cards/ArticleCard';
import { NewsletterInline } from '@/components/newsletter/NewsletterInline';
import { getArticleBySlug, listResearchArticles } from '@/lib/repositories/articles';
import { JsonLdScript } from '@/components/seo/JsonLdScript';
import { articleJsonLd, breadcrumbJsonLd } from '@/lib/seo/jsonld';
import type { ResearchSource } from '@/lib/domain/types';
import { INDEPENDENCE, SITE, absoluteUrl, routes } from '@/lib/site';

export const revalidate = 3600;

type Params = { readonly params: Promise<{ readonly slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const found = await getArticleBySlug(slug);
  // See the note in /bai-viet/[slug]: the 404 must be decided before render starts.
  if (found === null || found.article.articleType !== 'research') notFound();

  const { article } = found;
  const canonical = routes.researchArticle(article.slug);
  return {
    title: article.title,
    description: article.dek,
    alternates: { canonical },
    openGraph: {
      type: 'article',
      title: article.title,
      description: article.dek,
      url: absoluteUrl(canonical),
      publishedTime: article.publishedAt,
      siteName: SITE.name,
    },
  };
}

/**
 * The paper's own metadata, shown before the article text.
 *
 * Everything a reader needs to find and judge the source themselves: authors in
 * publication order, journal, DOI, date, open-access status. Citation counts are shown
 * as a fact about the paper, never as a claim that it is the "most important" work —
 * there is no such ranking, and implying one would be dishonest.
 */
function PaperPanel({ paper }: { readonly paper: ResearchSource }) {
  const authors = paper.authors.map((author) => author.name);
  const shown = authors.slice(0, 6);
  const remaining = authors.length - shown.length;

  return (
    <aside className="border-research/30 bg-research/5 my-8 rounded-lg border p-5">
      <p className="font-display text-research text-xs font-bold tracking-wider uppercase">
        Công trình nghiên cứu gốc
      </p>
      <h2 className="font-display mt-2 text-base leading-snug font-semibold">{paper.title}</h2>

      <dl className="mt-3 space-y-1.5 text-sm">
        {authors.length > 0 && (
          <div className="flex flex-wrap gap-x-2">
            <dt className="text-ink-3">Tác giả:</dt>
            <dd>
              {shown.join(', ')}
              {remaining > 0 && ` và ${remaining} tác giả khác`}
            </dd>
          </div>
        )}
        {paper.journal !== null && (
          <div className="flex flex-wrap gap-x-2">
            <dt className="text-ink-3">Tạp chí:</dt>
            <dd className="italic">{paper.journal}</dd>
          </div>
        )}
        {paper.publicationDate !== null && (
          <div className="flex flex-wrap gap-x-2">
            <dt className="text-ink-3">Ngày công bố:</dt>
            <dd>{paper.publicationDate}</dd>
          </div>
        )}
        {paper.doi !== null && (
          <div className="flex flex-wrap gap-x-2">
            <dt className="text-ink-3">DOI:</dt>
            <dd>
              <a
                href={`https://doi.org/${paper.doi}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent-ink font-mono text-xs underline underline-offset-2"
              >
                {paper.doi}
              </a>
            </dd>
          </div>
        )}
        {paper.citedByCount !== null && (
          <div className="flex flex-wrap gap-x-2">
            <dt className="text-ink-3">Số lần được trích dẫn:</dt>
            <dd>{paper.citedByCount}</dd>
          </div>
        )}
      </dl>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <a
          href={paper.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="bg-research/90 hover:bg-research rounded px-3 py-2 text-sm font-semibold text-white"
        >
          Đọc bài báo gốc
        </a>
        {paper.isOpenAccess === true && (
          <span className="text-research border-research/40 rounded-sm border px-1.5 py-px text-[11px] font-semibold tracking-wider uppercase">
            Truy cập mở
          </span>
        )}
      </div>
    </aside>
  );
}

export default async function ResearchArticlePage({ params }: Params) {
  const { slug } = await params;
  const found = await getArticleBySlug(slug);

  // Mirror of the /bai-viet guard: a YouTube-derived article is not served here.
  if (found === null || found.article.articleType !== 'research' || found.invalidBody) notFound();

  const { article } = found;
  const others = (await listResearchArticles(4)).filter((item) => item.slug !== article.slug);

  return (
    <main id="main" className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
      <JsonLdScript
        data={[
          articleJsonLd(article),
          breadcrumbJsonLd([
            { name: 'Trang chủ', path: routes.home() },
            { name: 'Nghiên cứu', path: routes.research() },
            { name: article.title, path: routes.researchArticle(article.slug) },
          ]),
        ]}
      />

      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_280px] lg:gap-12">
        <article className="mx-auto w-full max-w-[68ch]">
          <nav aria-label="Đường dẫn" className="text-ink-3 mb-4 text-xs">
            <Link href={routes.home()} className="hover:text-accent-ink">
              Trang chủ
            </Link>
            <span aria-hidden="true"> / </span>
            <Link href={routes.research()} className="text-research hover:underline">
              Nghiên cứu
            </Link>
          </nav>

          <header>
            <span className="text-research border-research/40 rounded-sm border px-1.5 py-px text-[11px] font-semibold tracking-wider uppercase">
              Nghiên cứu
            </span>
            <h1 className="font-display mt-3 text-3xl leading-[1.12] font-bold tracking-tight sm:text-4xl">
              {article.title}
            </h1>
            <p className="text-ink-2 mt-4 text-lg leading-relaxed sm:text-xl">{article.dek}</p>
            <div className="border-rule text-ink-3 mt-5 flex flex-wrap items-center gap-x-3 gap-y-1 border-y py-3 text-xs">
              <span>
                Tổng hợp bởi <strong className="text-ink-2 font-semibold">{SITE.name}</strong>
              </span>
              <span aria-hidden="true">·</span>
              <time dateTime={article.publishedAt}>
                {(article.publishedDateHanoi ?? article.publishedAt.slice(0, 10))
                  .split('-')
                  .reverse()
                  .join('/')}
              </time>
              <span aria-hidden="true">·</span>
              <span>{article.readingMinutes} phút đọc</span>
            </div>
          </header>

          <div className="mt-6">
            <SourceHero hero={article.hero} priority />
          </div>

          {article.researchSource !== null && <PaperPanel paper={article.researchSource} />}

          <ArticleBody
            blocks={article.body}
            references={article.references}
            sourceVideo={article.sourceVideo}
          />

          <ReferenceList references={article.references} />

          <aside className="border-rule text-ink-3 mt-8 rounded-lg border border-dashed p-4 text-xs leading-relaxed">
            {INDEPENDENCE.long}
          </aside>

          <div className="mt-10">
            <NewsletterInline variant="article-end" />
          </div>
        </article>

        <aside className="mt-12 lg:mt-0">
          {others.length > 0 && (
            <div className="lg:sticky lg:top-28">
              <SectionHeading title="Nghiên cứu khác" accent="research" />
              <ul className="space-y-5">
                {others.slice(0, 3).map((item) => (
                  <li key={item.id}>
                    <ArticleCard article={item} size="compact" />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </aside>
      </div>
    </main>
  );
}
