import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ArticleCard, SectionHeading } from '@/components/cards/ArticleCard';
import { CategorySvg } from '@/components/visual/CategorySvg';
import { NewsletterInline } from '@/components/newsletter/NewsletterInline';
import { listArticles } from '@/lib/repositories/articles';
import { getCategoryBySlug, listCategories } from '@/lib/repositories/categories';
import { JsonLdScript } from '@/components/seo/JsonLdScript';
import { breadcrumbJsonLd, collectionJsonLd } from '@/lib/seo/jsonld';
import { routes } from '@/lib/site';

export const revalidate = 3600;

type Params = { readonly params: Promise<{ readonly slug: string }> };

/** Seven categories, all known at build time, so all seven prerender. */
export async function generateStaticParams() {
  const categories = await listCategories();
  return categories.map((category) => ({ slug: category.slug }));
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const category = await getCategoryBySlug(slug);
  if (category === null) return {};

  return {
    title: category.seoTitle ?? category.name,
    description: category.seoDescription ?? category.description,
    alternates: { canonical: routes.category(category.slug) },
    openGraph: {
      title: category.seoTitle ?? category.name,
      description: category.seoDescription ?? category.description,
      url: routes.category(category.slug),
    },
  };
}

export default async function CategoryPage({ params }: Params) {
  const { slug } = await params;
  const category = await getCategoryBySlug(slug);
  if (category === null) notFound();

  const articles = await listArticles({ limit: 24, categorySlug: category.slug });

  return (
    <main id="main" className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
      <JsonLdScript
        data={[
          collectionJsonLd(category.name, routes.category(category.slug), articles),
          breadcrumbJsonLd([
            { name: 'Trang chủ', path: routes.home() },
            { name: category.name, path: routes.category(category.slug) },
          ]),
        ]}
      />

      <header className="border-rule mb-8 flex items-start gap-4 border-b pb-6">
        <span className="text-accent bg-accent-wash size-14 shrink-0 rounded-lg p-2">
          <CategorySvg motif={category.iconKey} className="size-full" />
        </span>
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">
            {category.name}
          </h1>
          <p className="text-ink-2 mt-2 max-w-prose leading-relaxed">{category.description}</p>
        </div>
      </header>

      {articles.length === 0 ? (
        <div className="py-12 text-center">
          <p className="font-display text-lg font-semibold">
            Chưa có bài viết trong chuyên mục này
          </p>
          <p className="text-ink-3 mx-auto mt-2 max-w-md text-sm leading-relaxed">
            Chuyên mục này đã được thiết lập nhưng chưa có bài nào được đăng. Bài viết mới sẽ xuất
            hiện tại đây.
          </p>
        </div>
      ) : (
        <>
          <SectionHeading title={`${articles.length} bài viết`} />
          <div className="grid gap-x-6 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
            {articles.map((article, index) => (
              <ArticleCard key={article.id} article={article} priority={index < 3} />
            ))}
          </div>
        </>
      )}

      <div className="mt-12">
        <NewsletterInline variant="section" />
      </div>
    </main>
  );
}
