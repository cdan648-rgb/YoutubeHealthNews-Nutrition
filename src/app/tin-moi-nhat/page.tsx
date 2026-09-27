import type { Metadata } from 'next';
import Link from 'next/link';
import { ArticleCard, SectionHeading } from '@/components/cards/ArticleCard';
import { countArticles, listArticles } from '@/lib/repositories/articles';
import { JsonLdScript } from '@/components/seo/JsonLdScript';
import { collectionJsonLd } from '@/lib/seo/jsonld';
import { routes } from '@/lib/site';

export const revalidate = 3600;

const PAGE_SIZE = 12;

export const metadata: Metadata = {
  title: 'Tin mới nhất',
  description:
    'Toàn bộ bài viết mới nhất trên Sức Khoẻ Giải Mã, xếp theo thời gian đăng, gồm cả bài từ video và bài từ nghiên cứu khoa học.',
  alternates: { canonical: routes.latest() },
};

type Props = { readonly searchParams: Promise<{ readonly trang?: string }> };

export default async function LatestPage({ searchParams }: Props) {
  const { trang } = await searchParams;
  // A bad page parameter falls back to page 1 rather than erroring: a mangled URL
  // from a shared link should still show something useful.
  const parsed = Number.parseInt(trang ?? '1', 10);
  const page = Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 1;

  const [articles, total] = await Promise.all([
    listArticles({ limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }),
    countArticles(),
  ]);

  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <main id="main" className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
      <JsonLdScript data={collectionJsonLd('Tin mới nhất', routes.latest(), articles)} />

      <header className="mb-8">
        <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">Tin mới nhất</h1>
        <p className="text-ink-2 mt-2 max-w-prose">
          Toàn bộ bài viết xếp theo thời gian đăng, gồm cả bài tổng hợp từ video và bài từ nghiên
          cứu khoa học.
        </p>
      </header>

      {articles.length === 0 ? (
        <p className="text-ink-3 py-12 text-center">
          Không có bài viết nào ở trang này.{' '}
          <Link href={routes.latest()} className="text-accent-ink underline">
            Về trang đầu
          </Link>
          .
        </p>
      ) : (
        <>
          <SectionHeading title={`${total} bài viết`} />
          <div className="grid gap-x-6 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
            {articles.map((article, index) => (
              <ArticleCard key={article.id} article={article} priority={index < 3} />
            ))}
          </div>
        </>
      )}

      {lastPage > 1 && (
        <nav
          aria-label="Phân trang"
          className="border-rule mt-12 flex items-center justify-between border-t pt-6 text-sm"
        >
          {page > 1 ? (
            <Link
              href={page === 2 ? routes.latest() : `${routes.latest()}?trang=${page - 1}`}
              className="text-accent-ink hover:underline"
              rel="prev"
            >
              ← Trang trước
            </Link>
          ) : (
            <span />
          )}
          <span className="text-ink-3">
            Trang {page} / {lastPage}
          </span>
          {page < lastPage ? (
            <Link
              href={`${routes.latest()}?trang=${page + 1}`}
              className="text-accent-ink hover:underline"
              rel="next"
            >
              Trang sau →
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </main>
  );
}
