import Link from 'next/link';
import { ArticleCard, SectionHeading } from '@/components/cards/ArticleCard';
import { CategorySvg } from '@/components/visual/CategorySvg';
import { NewsletterInline } from '@/components/newsletter/NewsletterInline';
import { listArticles, listResearchArticles } from '@/lib/repositories/articles';
import { countArticlesPerCategory, listCategories } from '@/lib/repositories/categories';
import { routes } from '@/lib/site';

/**
 * Homepage.
 *
 * Revalidated rather than dynamic: the automation publishes at most once a day and
 * triggers an on-demand revalidation when it does, so the hourly window here is only a
 * safety net for anything that misses the webhook.
 */
export const revalidate = 3600;

export default async function HomePage() {
  // One round trip each, in parallel — the four queries are independent.
  const [articles, research, categories, counts] = await Promise.all([
    listArticles({ limit: 13 }),
    listResearchArticles(3),
    listCategories(),
    countArticlesPerCategory(),
  ]);

  const [lead, ...rest] = articles;
  const grid = rest.slice(0, 6);
  const latest = rest.slice(6, 12);

  if (lead === undefined) {
    return (
      <main id="main" className="mx-auto max-w-2xl px-4 py-24 text-center sm:px-6">
        <h1 className="font-display text-2xl font-bold">Chưa có bài viết nào</h1>
        <p className="text-ink-2 mt-3">
          Trang tin đang được chuẩn bị. Bài viết đầu tiên sẽ xuất hiện tại đây.
        </p>
      </main>
    );
  }

  return (
    <main id="main" className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
      {/* Lead story */}
      <section aria-labelledby="lead-story" className="border-rule border-b pb-10">
        <h1 id="lead-story" className="sr-only">
          Tin chính
        </h1>
        <ArticleCard article={lead} size="lead" priority />
      </section>

      {/* Category navigation. Repeated from the header because a reader arriving on
          the homepage from search has not necessarily noticed the nav. */}
      <nav aria-label="Duyệt theo chuyên mục" className="border-rule border-b py-6">
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
          {categories.map((category) => (
            <li key={category.slug}>
              <Link
                href={routes.category(category.slug)}
                className="border-rule hover:border-accent hover:bg-accent-wash flex h-full flex-col gap-1.5 rounded-lg border p-3 transition-colors"
              >
                <span className="text-accent size-7">
                  <CategorySvg motif={category.iconKey} className="size-full" />
                </span>
                <span className="font-display text-[13px] leading-tight font-semibold">
                  {category.name}
                </span>
                <span className="text-ink-3 mt-auto text-[11px]">
                  {counts.get(category.slug) ?? 0} bài
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {grid.length > 0 && (
        <section aria-labelledby="featured" className="py-10">
          <SectionHeading title="Bài viết nổi bật" href={routes.latest()} />
          <div className="grid gap-x-6 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
            {grid.map((article) => (
              <ArticleCard key={article.id} article={article} />
            ))}
          </div>
        </section>
      )}

      <div className="grid gap-10 lg:grid-cols-[2fr_1fr] lg:gap-12">
        {latest.length > 0 && (
          <section aria-labelledby="latest">
            <SectionHeading title="Tin mới nhất" href={routes.latest()} />
            <ul className="space-y-6">
              {latest.map((article) => (
                <li key={article.id}>
                  <ArticleCard article={article} size="compact" />
                </li>
              ))}
            </ul>
          </section>
        )}

        <aside aria-labelledby="research-rail">
          <SectionHeading title="Nghiên cứu" href={routes.research()} accent="research" />
          {research.length === 0 ? (
            <p className="text-ink-3 text-sm leading-relaxed">
              Mục Nghiên cứu tổng hợp các bài báo khoa học mới được công bố. Chưa có bài nào được
              đăng.
            </p>
          ) : (
            <ul className="space-y-5">
              {research.map((article) => (
                <li key={article.id}>
                  <ArticleCard article={article} size="compact" />
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>

      <div className="mt-12">
        <NewsletterInline variant="section" />
      </div>
    </main>
  );
}
