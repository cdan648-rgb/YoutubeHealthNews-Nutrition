import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArticleBody, ReferenceList } from '@/components/article/ArticleBody';
import { SourceHero } from '@/components/article/SourceHero';
import { ArticleCard, SectionHeading } from '@/components/cards/ArticleCard';
import { NewsletterInline } from '@/components/newsletter/NewsletterInline';
import { getArticleBySlug, listRelatedArticles } from '@/lib/repositories/articles';
import { JsonLdScript } from '@/components/seo/JsonLdScript';
import { articleJsonLd, breadcrumbJsonLd } from '@/lib/seo/jsonld';
import { INDEPENDENCE, SITE, absoluteUrl, routes } from '@/lib/site';

export const revalidate = 3600;

type Params = { readonly params: Promise<{ readonly slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const found = await getArticleBySlug(slug);
  // notFound() here rather than returning {}: the status code must be decided before
  // rendering begins. Deciding it in the page body only means the response has already
  // started streaming, so the 404 page renders with a 200 status — which tells crawlers
  // the URL is valid.
  if (found === null || found.article.articleType === 'research') notFound();

  const { article } = found;
  const canonical = routes.article(article.slug);

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
      ...(article.hero.kind === 'youtube_thumbnail' ? { images: [article.hero.url] } : {}),
    },
    twitter: {
      card: 'summary_large_image',
      title: article.title,
      description: article.dek,
    },
  };
}

function formatHanoiDate(article: {
  publishedDateHanoi: string | null;
  publishedAt: string;
}): string {
  const iso = article.publishedDateHanoi ?? article.publishedAt.slice(0, 10);
  const [year, month, dayOfMonth] = iso.split('-');
  return `${dayOfMonth}/${month}/${year}`;
}

export default async function ArticlePage({ params }: Params) {
  const { slug } = await params;
  const found = await getArticleBySlug(slug);

  // A research piece lives only under /nghien-cuu, so serving it here too would make
  // one article reachable at two URLs. 404 rather than redirect: this URL was never
  // valid for it.
  if (found === null || found.article.articleType === 'research') notFound();

  // A body that failed schema validation is treated as missing rather than rendered
  // half-way. On a health site, showing a partially parsed article is worse than
  // showing none.
  if (found.invalidBody) notFound();

  const { article } = found;
  const related = await listRelatedArticles(article, 3);

  return (
    <main id="main" className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
      <JsonLdScript
        data={[
          articleJsonLd(article),
          breadcrumbJsonLd([
            { name: 'Trang chủ', path: routes.home() },
            { name: article.category.name, path: routes.category(article.category.slug) },
            { name: article.title, path: routes.article(article.slug) },
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
            <Link
              href={routes.category(article.category.slug)}
              className="text-accent-ink hover:underline"
            >
              {article.category.name}
            </Link>
          </nav>

          <header>
            <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold tracking-wider uppercase">
              <Link
                href={routes.category(article.category.slug)}
                className="text-accent-ink hover:underline"
              >
                {article.category.name}
              </Link>
              {article.isFactCheck && (
                <span className="text-fact border-fact/40 rounded-sm border px-1.5 py-px">
                  Kiểm chứng
                </span>
              )}
            </div>

            <h1 className="font-display mt-3 text-3xl leading-[1.12] font-bold tracking-tight sm:text-4xl">
              {article.title}
            </h1>

            <p className="text-ink-2 mt-4 text-lg leading-relaxed sm:text-xl">{article.dek}</p>

            <div className="border-rule text-ink-3 mt-5 flex flex-wrap items-center gap-x-3 gap-y-1 border-y py-3 text-xs">
              {/* The byline is the publication. Never the creator of the source video. */}
              <span>
                Tổng hợp bởi <strong className="text-ink-2 font-semibold">{SITE.name}</strong>
              </span>
              <span aria-hidden="true">·</span>
              <time dateTime={article.publishedAt}>{formatHanoiDate(article)}</time>
              <span aria-hidden="true">·</span>
              <span>{article.readingMinutes} phút đọc</span>
            </div>
          </header>

          <div className="mt-6">
            <SourceHero hero={article.hero} priority />
          </div>

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

        {/* Desktop rail. Below the article on mobile, where it reads as a natural
            "read next" rather than competing with the body. */}
        <aside className="mt-12 lg:mt-0">
          {related.length > 0 && (
            <div className="lg:sticky lg:top-28">
              <SectionHeading title="Bài liên quan" />
              <ul className="space-y-5">
                {related.map((item) => (
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
