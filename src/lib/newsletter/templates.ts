/**
 * Email templates.
 *
 * Plain HTML strings, not React — an email is not a web page, and rendering one through
 * react-dom/server would pull a renderer into a server route for no benefit. Every template
 * returns both `html` and `text`, because a text part is what keeps a message out of the
 * spam folder and readable in clients that refuse HTML.
 *
 * The design constraints are email's, not the web's: inline styles only (no `<style>` block
 * survives Gmail reliably), a table-free single column, and a max width that reads on a
 * phone. Independence and the unsubscribe link appear in every footer, because a newsletter
 * that hides either is the kind this project is careful not to be.
 */
import { INDEPENDENCE, SITE } from '@/lib/site';

/** Escape text interpolated into HTML. Small and dependency-free; emails are simple. */
function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const FONT_STACK =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

function shell(bodyHtml: string, footerHtml: string): string {
  return `<!doctype html>
<html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f2;">
<div style="max-width:560px;margin:0 auto;padding:24px 16px;font-family:${FONT_STACK};color:#1a1a1a;line-height:1.6;">
<div style="font-weight:700;font-size:15px;letter-spacing:0.02em;color:#0b6b5e;">${esc(SITE.name)}</div>
${bodyHtml}
<hr style="border:none;border-top:1px solid #e0e0dc;margin:28px 0 16px;">
<div style="font-size:12px;color:#6b6b66;line-height:1.5;">${footerHtml}</div>
</div></body></html>`;
}

export type ConfirmEmailInput = {
  readonly confirmUrl: string;
};

/**
 * The double-opt-in confirmation.
 *
 * Deliberately says what will happen (a short email per article) so the confirmation is
 * informed, and carries no unsubscribe link — there is nothing to unsubscribe from until
 * this is confirmed, and offering one here only confuses.
 */
export function confirmEmail(input: ConfirmEmailInput): {
  subject: string;
  html: string;
  text: string;
} {
  const subject = `Xác nhận đăng ký bản tin ${SITE.name}`;
  const html = shell(
    `<h1 style="font-size:20px;margin:20px 0 8px;">Xác nhận đăng ký</h1>
<p style="margin:0 0 16px;">Cảm ơn bạn đã đăng ký nhận bản tin của ${esc(SITE.name)}. Vui lòng bấm nút bên dưới để xác nhận địa chỉ email này. Chúng tôi sẽ gửi một email ngắn mỗi khi có bài viết mới — không quảng cáo, không bán dữ liệu.</p>
<p style="margin:24px 0;"><a href="${esc(input.confirmUrl)}" style="background:#0b6b5e;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:6px;font-weight:600;display:inline-block;">Xác nhận đăng ký</a></p>
<p style="margin:0 0 8px;font-size:13px;color:#6b6b66;">Nếu nút không hoạt động, hãy sao chép đường dẫn sau vào trình duyệt:</p>
<p style="margin:0;font-size:12px;word-break:break-all;color:#0b6b5e;">${esc(input.confirmUrl)}</p>
<p style="margin:20px 0 0;font-size:13px;color:#6b6b66;">Nếu bạn không đăng ký, hãy bỏ qua email này — sẽ không có gì được gửi thêm.</p>`,
    esc(INDEPENDENCE.long),
  );
  const text = `Xác nhận đăng ký bản tin ${SITE.name}

Cảm ơn bạn đã đăng ký. Mở đường dẫn sau để xác nhận địa chỉ email này:

${input.confirmUrl}

Nếu bạn không đăng ký, hãy bỏ qua email này.

—
${INDEPENDENCE.long}`;
  return { subject, html, text };
}

export type CampaignEmailInput = {
  readonly title: string;
  readonly dek: string;
  readonly articleUrl: string;
  readonly unsubscribeUrl: string;
  readonly isFactCheck: boolean;
  readonly isResearch: boolean;
};

/**
 * The per-article announcement.
 *
 * One article, its dek, and a link — not the article body. The point is to bring the reader
 * to the site where the sourcing, the disclaimer and the attribution live; reproducing the
 * article in the email would strip exactly the context that makes it trustworthy.
 */
export function campaignEmail(input: CampaignEmailInput): {
  subject: string;
  html: string;
  text: string;
} {
  const kicker = input.isResearch
    ? 'Nghiên cứu mới'
    : input.isFactCheck
      ? 'Kiểm chứng'
      : 'Bài viết mới';
  const subject = `${kicker}: ${input.title}`;

  const footer = `${esc(INDEPENDENCE.long)}
<br><br>
Bạn nhận email này vì đã đăng ký bản tin ${esc(SITE.name)}.
<a href="${esc(input.unsubscribeUrl)}" style="color:#6b6b66;">Huỷ đăng ký</a>.`;

  const html = shell(
    `<div style="font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#0b6b5e;margin:20px 0 6px;">${esc(kicker)}</div>
<h1 style="font-size:22px;line-height:1.25;margin:0 0 10px;">${esc(input.title)}</h1>
<p style="margin:0 0 20px;color:#3a3a38;">${esc(input.dek)}</p>
<p style="margin:0 0 8px;"><a href="${esc(input.articleUrl)}" style="background:#0b6b5e;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:6px;font-weight:600;display:inline-block;">Đọc bài viết</a></p>`,
    footer,
  );

  const text = `${kicker}: ${input.title}

${input.dek}

Đọc bài viết: ${input.articleUrl}

—
${INDEPENDENCE.long}

Huỷ đăng ký: ${input.unsubscribeUrl}`;
  return { subject, html, text };
}
