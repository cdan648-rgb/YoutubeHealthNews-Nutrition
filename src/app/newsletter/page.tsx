import type { Metadata } from 'next';
import { SubscribeForm } from '@/components/newsletter/SubscribeForm';
import { INDEPENDENCE, SITE, routes } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Bản tin',
  description: `Đăng ký nhận bản tin của ${SITE.name}: một email ngắn cho mỗi bài viết mới, kèm nguồn tham khảo. Không quảng cáo, huỷ bất cứ lúc nào.`,
  alternates: { canonical: routes.newsletter() },
};

/**
 * The newsletter landing page.
 *
 * A full page rather than only the footer widget, so a link in an email or a share can point
 * somewhere that explains what the list is before asking for an address. The form is the
 * interactive `SubscribeForm`; the double-opt-in and privacy promises are stated plainly,
 * because a health newsletter that is vague about what it does with an address does not
 * deserve one.
 */
export default function NewsletterPage() {
  return (
    <main id="main" className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
      <p className="font-display text-accent-ink text-xs font-bold tracking-[0.18em] uppercase">
        Bản tin
      </p>
      <h1 className="font-display mt-2 text-3xl font-bold tracking-tight sm:text-4xl">
        Nhận bài viết mới qua email
      </h1>
      <p className="text-ink-2 mt-4 leading-relaxed">
        Mỗi khi {SITE.name} đăng một bài viết mới, chúng tôi gửi cho bạn một email ngắn kèm tóm tắt
        và liên kết tới bài đầy đủ. Một email cho mỗi bài — không quảng cáo, không bán dữ liệu.
      </p>

      <div className="border-rule bg-surface mt-8 rounded-lg border p-6">
        <SubscribeForm source="newsletter-page" />
      </div>

      <section className="text-ink-2 mt-10 space-y-4 text-sm leading-relaxed">
        <div>
          <h2 className="font-display text-ink text-base font-semibold">Cách đăng ký hoạt động</h2>
          <p className="mt-1">
            Sau khi nhập email, bạn sẽ nhận một thư yêu cầu xác nhận. Chúng tôi chỉ thêm bạn vào
            danh sách sau khi bạn bấm nút xác nhận trong thư đó (xác nhận hai bước). Điều này bảo
            đảm không ai bị đăng ký bằng địa chỉ của người khác.
          </p>
        </div>
        <div>
          <h2 className="font-display text-ink text-base font-semibold">Huỷ đăng ký</h2>
          <p className="mt-1">
            Mỗi email đều có liên kết huỷ đăng ký. Bạn có thể huỷ bất cứ lúc nào, và chúng tôi sẽ
            ngừng gửi ngay lập tức.
          </p>
        </div>
        <p className="text-ink-3 border-rule border-t pt-4 text-xs">{INDEPENDENCE.long}</p>
      </section>
    </main>
  );
}
