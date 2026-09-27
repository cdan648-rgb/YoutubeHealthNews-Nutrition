import Link from 'next/link';
import { routes } from '@/lib/site';

/** 404. Offers routes onward rather than being a dead end. */
export default function NotFound() {
  return (
    <main id="main" className="mx-auto max-w-2xl px-4 py-24 text-center sm:px-6">
      <p className="font-display text-accent text-xs font-bold tracking-[0.18em] uppercase">
        Lỗi 404
      </p>
      <h1 className="font-display mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
        Không tìm thấy trang này
      </h1>
      <p className="text-ink-2 mt-3 leading-relaxed">
        Đường dẫn có thể đã thay đổi, hoặc bài viết chưa được đăng. Quý vị có thể quay lại trang chủ
        hoặc xem các bài mới nhất.
      </p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Link
          href={routes.home()}
          className="bg-accent hover:bg-accent-ink rounded px-4 py-2.5 text-sm font-semibold text-white"
        >
          Về trang chủ
        </Link>
        <Link
          href={routes.latest()}
          className="border-rule hover:bg-accent-wash rounded border px-4 py-2.5 text-sm font-semibold"
        >
          Tin mới nhất
        </Link>
      </div>
    </main>
  );
}
