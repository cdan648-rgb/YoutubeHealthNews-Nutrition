import type { Metadata } from 'next';
import { ArticleCard, SectionHeading } from '@/components/cards/ArticleCard';
import { listFactChecks } from '@/lib/repositories/articles';
import { JsonLdScript } from '@/components/seo/JsonLdScript';
import { breadcrumbJsonLd, collectionJsonLd } from '@/lib/seo/jsonld';
import { routes } from '@/lib/site';

export const revalidate = 3600;

export const metadata: Metadata = {
  title: 'Kiểm chứng',
  description:
    'Các bài viết phản biện những quan niệm sai phổ biến hoặc những sản phẩm được quảng cáo quá mức, tách bạch điều đã được chứng minh với điều chưa.',
  alternates: { canonical: routes.factChecks() },
};

/**
 * The fact-check index.
 *
 * `is_fact_check` has been a flag on articles since Phase 1, driving only a badge until now;
 * this page finally gives that strand its own home. It reads the same published articles as
 * everywhere else — a fact-check is not a separate content type, just a lens — so nothing
 * about publishing or dedup changes.
 */
export default async function FactChecksPage() {
  const articles = await listFactChecks(24);

  return (
    <main id="main" className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
      <JsonLdScript
        data={[
          collectionJsonLd('Kiểm chứng', routes.factChecks(), articles),
          breadcrumbJsonLd([
            { name: 'Trang chủ', path: routes.home() },
            { name: 'Kiểm chứng', path: routes.factChecks() },
          ]),
        ]}
      />

      <header className="border-fact/30 mb-8 border-b pb-6">
        <p className="font-display text-fact text-xs font-bold tracking-[0.18em] uppercase">
          Tách thật khỏi đồn
        </p>
        <h1 className="font-display mt-2 text-3xl font-bold tracking-tight sm:text-4xl">
          Kiểm chứng
        </h1>
        <p className="text-ink-2 mt-3 max-w-prose leading-relaxed">
          Những bài viết trong mục này tập trung phản biện các quan niệm sai phổ biến và các sản
          phẩm được quảng cáo quá mức. Chúng tôi nêu rõ điều gì đã được khoa học chứng minh, điều gì
          chưa, và dẫn nguồn để bạn tự kiểm tra.
        </p>
      </header>

      {articles.length === 0 ? (
        <div className="border-rule rounded-lg border border-dashed py-16 text-center">
          <p className="font-display text-lg font-semibold">Chưa có bài kiểm chứng nào</p>
          <p className="text-ink-3 mx-auto mt-2 max-w-md text-sm leading-relaxed">
            Mục này dành cho các bài phản biện quan niệm sai. Bài đầu tiên sẽ xuất hiện tại đây.
          </p>
        </div>
      ) : (
        <>
          <SectionHeading title={`${articles.length} bài kiểm chứng`} accent="fact" />
          <div className="grid gap-x-6 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
            {articles.map((article, index) => (
              <ArticleCard key={article.id} article={article} priority={index < 3} />
            ))}
          </div>
        </>
      )}
    </main>
  );
}
