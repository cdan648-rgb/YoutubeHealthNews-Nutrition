import type { Metadata } from 'next';
import Link from 'next/link';
import { SITE, routes } from '@/lib/site';

/**
 * The subscription-outcome page.
 *
 * One page renders every state — "check your email", "confirmed", "link expired", and the
 * error cases — because both the no-JS signup form and the confirmation link redirect here
 * with a `state`. `noindex`, since these URLs are transient and carry no content worth
 * crawling.
 */
export const metadata: Metadata = {
  title: 'Xác nhận đăng ký',
  robots: { index: false, follow: false },
};

type Search = { readonly searchParams: Promise<{ readonly state?: string }> };

const MESSAGES: Record<string, { title: string; body: string; tone: 'ok' | 'wait' | 'error' }> = {
  'check-email': {
    title: 'Kiểm tra hộp thư của bạn',
    body: 'Chúng tôi vừa gửi một email xác nhận. Vui lòng mở email và bấm nút xác nhận để hoàn tất đăng ký. Nếu không thấy, hãy kiểm tra hộp thư spam.',
    tone: 'wait',
  },
  confirmed: {
    title: 'Đã xác nhận. Cảm ơn bạn!',
    body: `Bạn đã đăng ký thành công bản tin của ${SITE.name}. Chúng tôi sẽ gửi email mỗi khi có bài viết mới.`,
    tone: 'ok',
  },
  already_active: {
    title: 'Bạn đã đăng ký rồi',
    body: 'Địa chỉ này đã được xác nhận trước đó. Không cần làm gì thêm.',
    tone: 'ok',
  },
  expired: {
    title: 'Liên kết đã hết hạn',
    body: 'Liên kết xác nhận chỉ có hiệu lực trong 48 giờ. Vui lòng đăng ký lại để nhận liên kết mới.',
    tone: 'error',
  },
  invalid: {
    title: 'Liên kết không hợp lệ',
    body: 'Chúng tôi không nhận ra liên kết này. Có thể nó đã được dùng hoặc đã hết hạn. Vui lòng đăng ký lại.',
    tone: 'error',
  },
  'rate-limited': {
    title: 'Bạn thao tác hơi nhanh',
    body: 'Vui lòng đợi ít phút rồi thử lại.',
    tone: 'error',
  },
  error: {
    title: 'Không thể xử lý yêu cầu',
    body: 'Địa chỉ email có thể không hợp lệ. Vui lòng kiểm tra lại và thử một lần nữa.',
    tone: 'error',
  },
};

export default async function ConfirmPage({ searchParams }: Search) {
  const { state } = await searchParams;
  const message = MESSAGES[state ?? ''] ?? MESSAGES['check-email']!;
  const accent =
    message.tone === 'ok'
      ? 'border-accent/40 bg-accent-wash/50'
      : message.tone === 'error'
        ? 'border-fact/40 bg-fact/5'
        : 'border-rule bg-surface';

  return (
    <main id="main" className="mx-auto max-w-lg px-4 py-16 sm:px-6">
      <div className={`rounded-lg border p-6 ${accent}`}>
        <h1 className="font-display text-2xl font-bold tracking-tight">{message.title}</h1>
        <p className="text-ink-2 mt-3 leading-relaxed">{message.body}</p>
        <div className="mt-6 flex flex-wrap gap-3 text-sm">
          <Link
            href={routes.home()}
            className="bg-accent hover:bg-accent-ink rounded px-4 py-2 font-semibold text-white"
          >
            Về trang chủ
          </Link>
          {message.tone === 'error' && (
            <Link
              href={routes.newsletter()}
              className="border-rule hover:border-accent rounded border px-4 py-2 font-semibold"
            >
              Đăng ký lại
            </Link>
          )}
        </div>
      </div>
    </main>
  );
}
