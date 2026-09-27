'use client';

import { useEffect, useRef, useState } from 'react';
import { routes } from '@/lib/site';

/**
 * The interactive signup form.
 *
 * Progressive enhancement over the plain form: it POSTs JSON and shows the result inline
 * rather than navigating away, and it mounts the Turnstile widget when a site key is
 * configured. The no-JS `NewsletterInline` form still exists for readers without JavaScript;
 * this is the richer path, not the only one.
 *
 * Turnstile is optional. With no `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, the widget is skipped and
 * the server (which also skips verification when its secret is absent) accepts the signup —
 * so the whole flow works before the captcha keys exist, and hardens automatically once they
 * are set.
 */

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

type State =
  { kind: 'idle' } | { kind: 'submitting' } | { kind: 'done' } | { kind: 'error'; message: string };

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, options: Record<string, unknown>) => string;
      reset: (id?: string) => void;
    };
  }
}

export function SubscribeForm({ source, onDone }: { source: string; onDone?: () => void }) {
  const [state, setState] = useState<State>({ kind: 'idle' });
  const [token, setToken] = useState<string>('');
  const widgetRef = useRef<HTMLDivElement | null>(null);

  // Load and render the Turnstile widget only when a key is configured.
  useEffect(() => {
    if (SITE_KEY === undefined || SITE_KEY === '' || widgetRef.current === null) return;

    const render = () => {
      if (window.turnstile === undefined || widgetRef.current === null) return;
      window.turnstile.render(widgetRef.current, {
        sitekey: SITE_KEY,
        callback: (value: string) => setToken(value),
        'error-callback': () => setToken(''),
        'expired-callback': () => setToken(''),
      });
    };

    if (window.turnstile !== undefined) {
      render();
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
    script.async = true;
    script.onload = render;
    document.head.appendChild(script);
  }, []);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setState({ kind: 'submitting' });

    try {
      const response = await fetch('/api/newsletter/subscribe', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          email: typeof data.get('email') === 'string' ? data.get('email') : '',
          company: typeof data.get('company') === 'string' ? data.get('company') : '',
          source,
          'cf-turnstile-response': token,
        }),
      });
      if (response.status === 429) {
        setState({
          kind: 'error',
          message: 'Bạn thao tác hơi nhanh. Vui lòng thử lại sau ít phút.',
        });
        return;
      }
      if (!response.ok) {
        setState({
          kind: 'error',
          message: 'Địa chỉ email không hợp lệ hoặc không xác minh được. Vui lòng kiểm tra lại.',
        });
        if (window.turnstile !== undefined) window.turnstile.reset();
        setToken('');
        return;
      }
      setState({ kind: 'done' });
      onDone?.();
    } catch {
      setState({ kind: 'error', message: 'Không kết nối được máy chủ. Vui lòng thử lại.' });
    }
  }

  if (state.kind === 'done') {
    return (
      <div
        role="status"
        className="border-accent/30 bg-accent-wash/50 rounded-lg border p-4 text-sm"
      >
        <p className="font-semibold">Gần xong rồi!</p>
        <p className="text-ink-2 mt-1 leading-relaxed">
          Chúng tôi vừa gửi một email xác nhận. Vui lòng mở email và bấm nút xác nhận để hoàn tất
          đăng ký. Nếu không thấy, hãy kiểm tra hộp thư spam.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={(event) => void handleSubmit(event)} className="flex flex-col gap-2">
      {/* Honeypot: invisible to people, tempting to naive bots. */}
      <div className="absolute left-[-9999px]" aria-hidden="true">
        <label htmlFor={`sf-company-${source}`}>Company</label>
        <input
          id={`sf-company-${source}`}
          type="text"
          name="company"
          tabIndex={-1}
          autoComplete="off"
        />
      </div>

      <label htmlFor={`sf-email-${source}`} className="sr-only">
        Địa chỉ email
      </label>
      <input
        id={`sf-email-${source}`}
        type="email"
        name="email"
        required
        autoComplete="email"
        inputMode="email"
        placeholder="ban@vidu.com"
        className="border-rule bg-surface focus:border-accent min-h-11 w-full rounded border px-3 text-[15px]"
      />

      {SITE_KEY !== undefined && SITE_KEY !== '' && (
        <div ref={widgetRef} className="min-h-[65px]" />
      )}

      <button
        type="submit"
        disabled={state.kind === 'submitting'}
        className="bg-accent hover:bg-accent-ink min-h-11 shrink-0 rounded px-4 text-[15px] font-semibold text-white transition-colors disabled:opacity-60"
      >
        {state.kind === 'submitting' ? 'Đang gửi…' : 'Đăng ký'}
      </button>

      {state.kind === 'error' && (
        <p role="alert" className="text-fact text-sm">
          {state.message}
        </p>
      )}

      <p className="text-ink-3 text-xs leading-relaxed">
        Bằng việc đăng ký, bạn đồng ý nhận email từ chúng tôi. Xem{' '}
        <a href={routes.privacy()} className="underline underline-offset-2">
          chính sách bảo mật
        </a>
        . Huỷ bất cứ lúc nào.
      </p>
    </form>
  );
}
