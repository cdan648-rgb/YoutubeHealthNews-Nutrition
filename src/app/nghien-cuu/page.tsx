import type { Metadata } from 'next';
import { ArticleCard, SectionHeading } from '@/components/cards/ArticleCard';
import { listResearchArticles } from '@/lib/repositories/articles';
import { JsonLdScript } from '@/components/seo/JsonLdScript';
import { breadcrumbJsonLd, collectionJsonLd } from '@/lib/seo/jsonld';
import { routes } from '@/lib/site';

export const revalidate = 3600;

export const metadata: Metadata = {
  title: 'Nghiên cứu',
  description:
    'Bài viết dựa trên các công trình nghiên cứu khoa học được công bố trên tạp chí có phản biện, kèm DOI, tác giả và nguồn gốc đầy đủ.',
  alternates: { canonical: routes.research() },
};

/**
 * The Research index.
 *
 * Kept visually distinct from the YouTube-derived sections, and framed differently:
 * these pieces report on a single published paper, so the page explains up front what a
 * single study can and cannot establish. That framing is the point of separating them
 * rather than mixing them into the category feeds.
 */
export default async function ResearchIndexPage() {
  const articles = await listResearchArticles(24);

  return (
    <main id="main" className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
      <JsonLdScript
        data={[
          collectionJsonLd('Nghiên cứu', routes.research(), articles),
          breadcrumbJsonLd([
            { name: 'Trang chủ', path: routes.home() },
            { name: 'Nghiên cứu', path: routes.research() },
          ]),
        ]}
      />

      <header className="border-research/30 mb-8 border-b pb-6">
        <p className="font-display text-research text-xs font-bold tracking-[0.18em] uppercase">
          Chuyên mục riêng
        </p>
        <h1 className="font-display mt-2 text-3xl font-bold tracking-tight sm:text-4xl">
          Nghiên cứu
        </h1>
        <p className="text-ink-2 mt-3 max-w-prose leading-relaxed">
          Các bài viết trong mục này không dựa trên video, mà dựa trên một công trình nghiên cứu đã
          được công bố. Mỗi bài đều nêu rõ tên bài báo, nhóm tác giả, tạp chí, DOI và ngày công bố
          để quý vị có thể tự kiểm tra nguồn gốc.
        </p>
        <p className="text-ink-3 mt-3 max-w-prose text-sm leading-relaxed">
          Xin lưu ý: một nghiên cứu đơn lẻ không phải là kết luận cuối cùng của y học. Kết quả cần
          được kiểm chứng lại bởi các nghiên cứu độc lập khác trước khi trở thành cơ sở cho thực
          hành điều trị.
        </p>
      </header>

      {articles.length === 0 ? (
        <div className="border-rule rounded-lg border border-dashed py-16 text-center">
          <p className="font-display text-lg font-semibold">Chưa có bài nghiên cứu nào</p>
          <p className="text-ink-3 mx-auto mt-2 max-w-md text-sm leading-relaxed">
            Mục này được dành riêng cho các bài viết dựa trên nghiên cứu khoa học. Bài đầu tiên sẽ
            xuất hiện khi hệ thống chọn được một công trình phù hợp.
          </p>
        </div>
      ) : (
        <>
          <SectionHeading title={`${articles.length} bài nghiên cứu`} accent="research" />
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
