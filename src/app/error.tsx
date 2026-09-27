'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { routes } from '@/lib/site';

/**
 * Route-level error boundary.
 *
 * Shows a plain apology and a way out; it never surfaces the error message, which can
 * contain query details or identifiers. The digest is logged to the console so it can be
 * correlated with the platform logs.
 */
export default function RouteError({
  error,
  reset,
}: {
  readonly error: Error & { digest?: string };
  readonly reset: () => void;
}) {
  useEffect(() => {
    console.error('route error', error.digest ?? error.message);
  }, [error]);

  return (
    <main id="main" className="mx-auto max-w-2xl px-4 py-24 text-center sm:px-6">
      <h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">
        Đã xảy ra lỗi khi tải trang
      </h1>
      <p className="text-ink-2 mt-3 leading-relaxed">
        Đây là lỗi từ phía chúng tôi, không phải do quý vị. Vui lòng thử lại sau ít phút.
      </p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <button
          type="button"
          onClick={reset}
          className="bg-accent hover:bg-accent-ink rounded px-4 py-2.5 text-sm font-semibold text-white"
        >
          Thử lại
        </button>
        <Link
          href={routes.home()}
          className="border-rule hover:bg-accent-wash rounded border px-4 py-2.5 text-sm font-semibold"
        >
          Về trang chủ
        </Link>
      </div>
      {error.digest !== undefined && (
        <p className="text-ink-3 mt-6 font-mono text-xs">Mã lỗi: {error.digest}</p>
      )}
    </main>
  );
}
