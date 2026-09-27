import { hanoiDate, hanoiHour } from '@/lib/time';

// Rendered per request so the publishing clock below reflects the real current
// Hanoi time. Prerendered at build time it would silently freeze, which would
// make this placeholder actively misleading about the thing it exists to show.
export const dynamic = 'force-dynamic';

const PHASES: ReadonlyArray<{ n: number; name: string; done: boolean }> = [
  { n: 0, name: 'Nền tảng & công cụ (scaffold, CI, timezone guardrail)', done: true },
  { n: 1, name: 'Cơ sở dữ liệu, ràng buộc, RLS', done: false },
  { n: 2, name: 'Thời gian & lịch đăng bài (Asia/Ho_Chi_Minh)', done: false },
  { n: 3, name: 'Hệ thống thiết kế & giao diện', done: false },
  { n: 4, name: '5 bài viết hạt giống', done: false },
  { n: 5, name: 'Thu thập dữ liệu YouTube', done: false },
  { n: 6, name: 'Sinh nội dung AI & kiểm định', done: false },
  { n: 7, name: 'Tự động hoá hằng ngày', done: false },
  { n: 8, name: 'Bài viết từ nghiên cứu khoa học', done: false },
  { n: 9, name: 'Bản tin email', done: false },
  { n: 10, name: 'Tối ưu & triển khai', done: false },
];

export default function HomePage() {
  const now = new Date();
  const today = hanoiDate(now);
  const hour = hanoiHour(now);

  return (
    <main className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-20">
      <p className="font-display text-accent text-xs font-semibold tracking-[0.18em] uppercase">
        Giai đoạn 0 · Nền tảng
      </p>

      <h1 className="font-display mt-4 text-4xl font-bold tracking-tight sm:text-5xl">
        Sức Khoẻ Giải Mã
      </h1>

      <p className="text-ink-2 mt-4 text-lg">
        Bản tin độc lập về sức khoẻ và khoa học, tổng hợp từ nội dung công khai của kênh YouTube{' '}
        <em>Bác sĩ Trần Văn Phúc Official</em>.
      </p>

      <div className="border-rule bg-surface mt-10 rounded-lg border p-5">
        <h2 className="font-display text-sm font-semibold tracking-wide uppercase">
          Đồng hồ xuất bản
        </h2>
        <dl className="mt-3 space-y-1.5 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-ink-3">Múi giờ</dt>
            <dd className="font-mono">Asia/Ho_Chi_Minh</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-ink-3">Ngày theo lịch Hà Nội</dt>
            <dd className="font-mono">{today}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-ink-3">Giờ địa phương</dt>
            <dd className="font-mono">{String(hour).padStart(2, '0')}:00</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-ink-3">Khung giờ đăng bài</dt>
            <dd className="font-mono">11:00 – 22:00</dd>
          </div>
        </dl>
        <p className="text-ink-3 mt-3 text-xs">
          Mọi quyết định xuất bản đều dựa trên ngày theo lịch Hà Nội, không dựa trên ngày UTC.
        </p>
      </div>

      <h2 className="font-display mt-12 text-sm font-semibold tracking-wide uppercase">
        Tiến độ triển khai
      </h2>
      <ol className="border-rule mt-4 divide-y border-t border-b">
        {PHASES.map((phase) => (
          <li key={phase.n} className="flex items-center gap-3 py-2.5 text-sm">
            <span
              aria-hidden="true"
              className={
                phase.done
                  ? 'bg-accent size-2 shrink-0 rounded-full'
                  : 'border-rule size-2 shrink-0 rounded-full border'
              }
            />
            <span className="text-ink-3 w-16 shrink-0 font-mono text-xs">GĐ {phase.n}</span>
            <span className={phase.done ? 'text-ink' : 'text-ink-3'}>{phase.name}</span>
            <span className="sr-only">{phase.done ? '— đã xong' : '— chưa làm'}</span>
          </li>
        ))}
      </ol>

      <footer className="border-rule text-ink-3 mt-12 border-t pt-6 text-xs">
        <p>
          <strong className="text-ink-2">Trang tin độc lập.</strong> Không thuộc, không liên kết và
          không được bảo trợ bởi Bác sĩ Trần Văn Phúc hoặc kênh YouTube của ông. Nội dung mang tính
          thông tin, giáo dục, không thay thế tư vấn y tế cá nhân.
        </p>
      </footer>
    </main>
  );
}
