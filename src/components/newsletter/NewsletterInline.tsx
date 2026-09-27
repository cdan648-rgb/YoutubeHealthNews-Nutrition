/**
 * Inline newsletter signup.
 *
 * Phase 3 ships the form markup and the copy; Phase 8 wires the endpoint, the
 * Turnstile widget, double opt-in and the timed modal. Until then the form posts to
 * the real route path so the markup does not have to change later, and it degrades
 * honestly: a submit before Phase 8 lands gets a clear "not yet available" response
 * rather than silently appearing to work.
 *
 * A server component with a plain HTML form — no client JavaScript — so placing this
 * in the footer of every page costs nothing in bundle size.
 */
import { routes } from '@/lib/site';

type Props = {
  readonly variant?: 'footer' | 'section' | 'article-end';
};

const COPY = {
  footer: {
    title: 'Nhận bản tin mỗi khi có bài mới',
    body: 'Một email ngắn cho mỗi bài viết. Không quảng cáo, không bán dữ liệu, huỷ đăng ký bất cứ lúc nào.',
  },
  section: {
    title: 'Theo dõi bản tin sức khoẻ',
    body: 'Mỗi bài viết mới sẽ được gửi tới hộp thư của bạn kèm tóm tắt ngắn và liên kết tới nguồn gốc.',
  },
  'article-end': {
    title: 'Thấy bài này hữu ích?',
    body: 'Đăng ký để nhận bài viết mới. Một email cho mỗi bài, huỷ bất cứ lúc nào.',
  },
} as const;

export function NewsletterInline({ variant = 'section' }: Props) {
  const copy = COPY[variant];
  const isCompact = variant === 'footer';

  return (
    <section
      aria-labelledby={`newsletter-${variant}`}
      className={
        isCompact
          ? 'sm:flex sm:items-center sm:justify-between sm:gap-8'
          : 'border-accent/30 bg-accent-wash/50 rounded-lg border p-6'
      }
    >
      <div className={isCompact ? 'max-w-md' : 'max-w-prose'}>
        <h2
          id={`newsletter-${variant}`}
          className="font-display text-base font-bold tracking-tight sm:text-lg"
        >
          {copy.title}
        </h2>
        <p className="text-ink-2 mt-1 text-sm leading-relaxed">{copy.body}</p>
      </div>

      <form
        action="/api/newsletter/subscribe"
        method="post"
        className={`mt-4 flex flex-col gap-2 sm:flex-row ${isCompact ? 'sm:mt-0 sm:w-auto' : ''}`}
      >
        {/* Which surface produced the signup; recorded with the consent snapshot. */}
        <input type="hidden" name="source" value={variant} />
        {/* Honeypot: invisible to people, irresistible to naive bots. */}
        <div className="absolute left-[-9999px]" aria-hidden="true">
          <label htmlFor={`nl-company-${variant}`}>Company</label>
          <input
            id={`nl-company-${variant}`}
            type="text"
            name="company"
            tabIndex={-1}
            autoComplete="off"
          />
        </div>

        <label htmlFor={`nl-email-${variant}`} className="sr-only">
          Địa chỉ email
        </label>
        <input
          id={`nl-email-${variant}`}
          type="email"
          name="email"
          required
          autoComplete="email"
          inputMode="email"
          placeholder="ban@vidu.com"
          className="border-rule bg-surface focus:border-accent min-h-11 w-full rounded border px-3 text-[15px] sm:w-64"
        />
        <button
          type="submit"
          className="bg-accent hover:bg-accent-ink min-h-11 shrink-0 rounded px-4 text-[15px] font-semibold text-white transition-colors"
        >
          Đăng ký
        </button>
      </form>

      <p className={`text-ink-3 mt-2 text-xs ${isCompact ? 'sm:hidden' : ''}`}>
        Bằng việc đăng ký, bạn đồng ý nhận email từ chúng tôi. Xem{' '}
        <a href={routes.privacy()} className="underline underline-offset-2">
          chính sách bảo mật
        </a>
        .
      </p>
    </section>
  );
}
