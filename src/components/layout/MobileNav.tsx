'use client';

import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';
import { routes } from '@/lib/site';

/**
 * Mobile navigation drawer.
 *
 * One of only two client components on an article page, and kept deliberately small.
 * Uses the native `<dialog>` element so focus trapping, Escape-to-close and the
 * backdrop come from the platform rather than from a focus-management library.
 *
 * The links render on the server inside the dialog, so the navigation is present in
 * the HTML and works for crawlers and for a reader whose JavaScript has not loaded —
 * the button simply does nothing until it has.
 */
export function MobileNav({
  categories,
}: {
  readonly categories: readonly { readonly slug: string; readonly name: string }[];
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const titleId = useId();

  // `showModal()` cannot be called during render, and calling it on an already-open
  // dialog throws, so the imperative call is driven from state.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="border-rule hover:bg-accent-wash flex size-11 items-center justify-center rounded border lg:hidden"
      >
        <span className="sr-only">Mở menu điều hướng</span>
        <svg viewBox="0 0 20 20" className="size-5" aria-hidden="true" fill="currentColor">
          <rect x="2" y="4.5" width="16" height="1.6" rx="0.8" />
          <rect x="2" y="9.2" width="16" height="1.6" rx="0.8" />
          <rect x="2" y="13.9" width="16" height="1.6" rx="0.8" />
        </svg>
      </button>

      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        onClose={() => setOpen(false)}
        // Clicking the backdrop (the dialog element itself, outside its child) closes.
        onClick={(event) => {
          if (event.target === dialogRef.current) setOpen(false);
        }}
        className="bg-surface text-ink m-0 mt-auto w-full max-w-none rounded-t-xl p-0 backdrop:bg-black/50 sm:max-w-sm"
      >
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 id={titleId} className="font-display text-sm font-semibold tracking-wide uppercase">
            Chuyên mục
          </h2>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="hover:bg-accent-wash flex size-11 items-center justify-center rounded"
          >
            <span className="sr-only">Đóng menu</span>
            <svg viewBox="0 0 20 20" className="size-5" aria-hidden="true" fill="currentColor">
              <path d="M5.3 4.3 10 9l4.7-4.7 1 1L11 10l4.7 4.7-1 1L10 11l-4.7 4.7-1-1L9 10 4.3 5.3z" />
            </svg>
          </button>
        </div>

        <nav aria-label="Điều hướng trên thiết bị di động" className="p-2">
          <ul>
            <li>
              <Link
                href={routes.latest()}
                onClick={() => setOpen(false)}
                className="hover:bg-accent-wash flex min-h-11 items-center rounded px-3 text-[15px]"
              >
                Tin mới nhất
              </Link>
            </li>
            {categories.map((category) => (
              <li key={category.slug}>
                <Link
                  href={routes.category(category.slug)}
                  onClick={() => setOpen(false)}
                  className="hover:bg-accent-wash flex min-h-11 items-center rounded px-3 text-[15px]"
                >
                  {category.name}
                </Link>
              </li>
            ))}
            <li className="mt-1 border-t pt-1">
              <Link
                href={routes.research()}
                onClick={() => setOpen(false)}
                className="text-research hover:bg-accent-wash flex min-h-11 items-center rounded px-3 text-[15px] font-semibold"
              >
                Nghiên cứu
              </Link>
            </li>
            <li>
              <Link
                href={routes.factChecks()}
                onClick={() => setOpen(false)}
                className="text-fact hover:bg-accent-wash flex min-h-11 items-center rounded px-3 text-[15px] font-semibold"
              >
                Kiểm chứng
              </Link>
            </li>
            {/* The trust pages, now that they exist — the drawer never links a 404. */}
            <li className="mt-1 border-t pt-1">
              <Link
                href={routes.about()}
                onClick={() => setOpen(false)}
                className="text-ink-2 hover:bg-accent-wash flex min-h-11 items-center rounded px-3 text-[15px]"
              >
                Về chúng tôi
              </Link>
            </li>
            <li>
              <Link
                href={routes.methodology()}
                onClick={() => setOpen(false)}
                className="text-ink-2 hover:bg-accent-wash flex min-h-11 items-center rounded px-3 text-[15px]"
              >
                Nguồn và phương pháp
              </Link>
            </li>
          </ul>
        </nav>
      </dialog>
    </>
  );
}
