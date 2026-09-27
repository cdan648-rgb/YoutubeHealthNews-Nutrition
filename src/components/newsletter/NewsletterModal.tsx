'use client';

import { useEffect, useRef, useState } from 'react';
import { SITE } from '@/lib/site';
import { SubscribeForm } from './SubscribeForm';

/**
 * The timed signup modal.
 *
 * Every rule here is about not being the pop-up people resent, and they are enforced with
 * `localStorage` so a reader's choice survives across pages:
 *
 *   - never before 30 seconds of reading;
 *   - at most once per browser session;
 *   - not again for 45 days after a dismissal;
 *   - never once dismissed-permanently or already subscribed on this device;
 *   - never when arriving from the newsletter itself (`?utm_source=newsletter`), because that
 *     reader has already decided.
 *
 * `localStorage` can throw (private mode, blocked storage), so every access is guarded and the
 * modal simply does not show rather than crashing the page. It is also fully keyboard
 * operable: focus is trapped while open and Escape dismisses it, because a trap the keyboard
 * cannot escape is worse than no modal.
 */

const DELAY_MS = 30_000;
const DISMISS_DAYS = 45;
const KEY_DISMISSED_UNTIL = 'skgm.nl.dismissedUntil';
const KEY_SUBSCRIBED = 'skgm.nl.subscribed';
const KEY_SESSION_SHOWN = 'skgm.nl.shownThisSession';

function readStore(key: string, session = false): string | null {
  try {
    return (session ? sessionStorage : localStorage).getItem(key);
  } catch {
    return null;
  }
}
function writeStore(key: string, value: string, session = false): void {
  try {
    (session ? sessionStorage : localStorage).setItem(key, value);
  } catch {
    /* storage unavailable — the modal degrades to not remembering, which is safe */
  }
}

function suppressed(): boolean {
  if (typeof window === 'undefined') return true;
  if (new URLSearchParams(window.location.search).get('utm_source') === 'newsletter') return true;
  if (readStore(KEY_SUBSCRIBED) === '1') return true;
  if (readStore(KEY_SESSION_SHOWN, true) === '1') return true;
  const until = readStore(KEY_DISMISSED_UNTIL);
  if (until !== null && Number(until) > Date.now()) return true;
  return false;
}

export function NewsletterModal() {
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (suppressed()) return;
    const timer = window.setTimeout(() => {
      if (suppressed()) return;
      writeStore(KEY_SESSION_SHOWN, '1', true);
      setOpen(true);
    }, DELAY_MS);
    return () => window.clearTimeout(timer);
  }, []);

  // Focus management and Escape-to-close while open.
  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        dismiss();
        return;
      }
      if (event.key !== 'Tab' || dialogRef.current === null) return;
      const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (first === undefined || last === undefined) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  function dismiss() {
    writeStore(KEY_DISMISSED_UNTIL, String(Date.now() + DISMISS_DAYS * 86_400_000));
    setOpen(false);
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
      onClick={(event) => {
        if (event.target === event.currentTarget) dismiss();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="nl-modal-title"
        className="bg-paper w-full max-w-md rounded-xl p-6 shadow-xl"
      >
        <div className="flex items-start justify-between gap-4">
          <h2 id="nl-modal-title" className="font-display text-lg font-bold tracking-tight">
            Nhận bài viết mới qua email
          </h2>
          <button
            ref={closeRef}
            type="button"
            onClick={dismiss}
            aria-label="Đóng"
            className="text-ink-3 hover:text-ink -mt-1 text-2xl leading-none"
          >
            ×
          </button>
        </div>
        <p className="text-ink-2 mt-2 text-sm leading-relaxed">
          Mỗi bài viết mới của {SITE.name} kèm tóm tắt ngắn và liên kết tới nguồn gốc. Một email cho
          mỗi bài, không quảng cáo.
        </p>
        <div className="mt-4">
          <SubscribeForm source="modal" onDone={() => writeStore(KEY_SUBSCRIBED, '1')} />
        </div>
      </div>
    </div>
  );
}
