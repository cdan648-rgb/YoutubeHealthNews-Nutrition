import type { Metadata } from 'next';
import Link from 'next/link';
import { checkUnsubscribeToken } from '@/lib/newsletter/lifecycle';
import { SITE, routes } from '@/lib/site';

/**
 * The human unsubscribe page.
 *
 * A GET here NEVER unsubscribes anyone — it only shows a button that POSTs to the API. This
 * is the whole point of the page: email clients and security scanners prefetch links, and a
 * GET that did the work would silently unsubscribe real readers. The actual removal is the
 * POST, which a prefetch does not perform.
 *
 * `noindex`, because the URL carries a per-subscriber token and has nothing to crawl.
 */
export const metadata: Metadata = {
  title: 'Huỷ đăng ký',
  robots: { index: false, follow: false },
};

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Search = {
  readonly searchParams: Promise<{
    readonly u?: string;
    readonly t?: string;
    readonly state?: string;
  }>;
};

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main id="main" className="mx-auto max-w-lg px-4 py-16 sm:px-6">
      <div className="border-rule bg-surface rounded-lg border p-6">
        <h1 className="font-display text-2xl font-bold tracking-tight">{title}</h1>
        <div className="text-ink-2 mt-3 leading-relaxed">{children}</div>
        <div className="mt-6">
          <Link
            href={routes.home()}
            className="border-rule hover:border-accent rounded border px-4 py-2 text-sm font-semibold"
          >
            Về trang chủ
          </Link>
        </div>
      </div>
    </main>
  );
}

export default async function UnsubscribePage({ searchParams }: Search) {
  const { u, t, state } = await searchParams;

  // After a POST the API redirects back here with a result state.
  if (state === 'unsubscribed' || state === 'already_unsubscribed') {
    return (
      <Panel title="Đã huỷ đăng ký">
        <p>
          Bạn sẽ không còn nhận email từ {SITE.name}. Rất tiếc khi bạn rời đi — bạn luôn có thể đăng
          ký lại bất cứ lúc nào.
        </p>
      </Panel>
    );
  }
  if (state === 'invalid') {
    return (
      <Panel title="Liên kết không hợp lệ">
        <p>
          Chúng tôi không xác minh được yêu cầu này. Vui lòng dùng liên kết trong email mới nhất.
        </p>
      </Panel>
    );
  }

  // First visit from an email link: validate the token, then show a confirm button.
  const token = t ?? '';
  const subscriberId = u ?? '';
  const check = await checkUnsubscribeToken(subscriberId, token);

  if (check === 'already_unsubscribed') {
    return (
      <Panel title="Bạn đã huỷ đăng ký">
        <p>Địa chỉ này đã được gỡ khỏi danh sách trước đó. Không cần làm gì thêm.</p>
      </Panel>
    );
  }
  if (check === 'invalid') {
    return (
      <Panel title="Liên kết không hợp lệ">
        <p>
          Liên kết huỷ đăng ký không hợp lệ hoặc đã hết hạn. Vui lòng mở email mới nhất từ chúng tôi
          và dùng liên kết trong đó.
        </p>
      </Panel>
    );
  }

  return (
    <Panel title="Huỷ đăng ký bản tin">
      <p>Bạn có chắc muốn ngừng nhận email từ {SITE.name}? Bấm nút bên dưới để xác nhận.</p>
      {/* The removal is this POST, never the GET that rendered the page. */}
      <form method="post" action="/api/newsletter/unsubscribe" className="mt-5">
        <input type="hidden" name="u" value={subscriberId} />
        <input type="hidden" name="t" value={token} />
        <button
          type="submit"
          className="bg-fact/90 hover:bg-fact rounded px-4 py-2 text-sm font-semibold text-white"
        >
          Xác nhận huỷ đăng ký
        </button>
      </form>
    </Panel>
  );
}
