/**
 * Email templates. The properties that matter are structural, not aesthetic: every message
 * has a text part, the campaign email carries the article link and an unsubscribe link, and
 * user-supplied text is escaped into the HTML.
 */
import { describe, expect, it } from 'vitest';
import { campaignEmail, confirmEmail } from './templates';

describe('confirmEmail', () => {
  it('includes the confirm URL in both parts and has no unsubscribe link', () => {
    const url = 'https://site/api/newsletter/confirm?token=abc';
    const email = confirmEmail({ confirmUrl: url });
    expect(email.html).toContain(url);
    expect(email.text).toContain(url);
    expect(email.html.toLowerCase()).not.toContain('huỷ đăng ký'.toLowerCase());
  });
});

describe('campaignEmail', () => {
  const base = {
    title: 'Magie và cơ thể',
    dek: 'Một bản tóm tắt ngắn.',
    articleUrl: 'https://site/bai-viet/magie',
    unsubscribeUrl: 'https://site/huy-dang-ky?u=1&t=z',
    isFactCheck: false,
    isResearch: false,
  };

  it('links both the article and the unsubscribe page', () => {
    const email = campaignEmail(base);
    expect(email.html).toContain(base.articleUrl);
    // The HTML escapes the ampersand in the query string, so match the escaped form there
    // and the raw form in the text part.
    expect(email.html).toContain('https://site/huy-dang-ky?u=1&amp;t=z');
    expect(email.text).toContain(base.articleUrl);
    expect(email.text).toContain(base.unsubscribeUrl);
  });

  it('labels the kind in the subject', () => {
    expect(campaignEmail({ ...base, isResearch: true }).subject).toContain('Nghiên cứu');
    expect(campaignEmail({ ...base, isFactCheck: true }).subject).toContain('Kiểm chứng');
    expect(campaignEmail(base).subject).toContain('Bài viết mới');
  });

  it('escapes HTML in the title', () => {
    const email = campaignEmail({ ...base, title: '<script>x</script>' });
    expect(email.html).not.toContain('<script>');
    expect(email.html).toContain('&lt;script&gt;');
  });
});
