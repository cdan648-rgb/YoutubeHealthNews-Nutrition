import Link from 'next/link';
import { listCategories } from '@/lib/repositories/categories';
import { FOOTER_LINKS, INDEPENDENCE, SITE, SOURCE_CHANNEL, routes } from '@/lib/site';
import { hanoiYear } from '@/lib/time';
import { NewsletterInline } from '@/components/newsletter/NewsletterInline';

/**
 * Site footer.
 *
 * Carries the full independence disclosure (the header only has room for the short
 * form) and an attribution link back to the source channel, so a reader can always
 * reach the original material in one click from any page.
 */
export async function SiteFooter() {
  const categories = await listCategories();

  return (
    <footer className="border-rule bg-surface mt-16 border-t">
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
        <div className="border-rule mb-10 border-b pb-10">
          <NewsletterInline variant="footer" />
        </div>

        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          <div className="lg:col-span-2">
            <p className="font-display text-base font-bold">{SITE.name}</p>
            <p className="text-ink-3 mt-1 text-sm">{SITE.tagline}</p>
            <p className="text-ink-2 mt-4 max-w-prose text-xs leading-relaxed">
              {INDEPENDENCE.long}
            </p>
            <p className="text-ink-3 mt-3 text-xs">
              Nội dung gốc thuộc về{' '}
              <a
                href={SOURCE_CHANNEL.url}
                rel="noopener noreferrer nofollow"
                target="_blank"
                className="text-accent-ink underline underline-offset-2"
              >
                {SOURCE_CHANNEL.title}
              </a>{' '}
              trên YouTube.
            </p>
          </div>

          <nav aria-labelledby="footer-categories">
            <p
              id="footer-categories"
              className="font-display text-xs font-semibold tracking-wider uppercase"
            >
              Chuyên mục
            </p>
            <ul className="mt-3 space-y-1.5 text-sm">
              {categories.map((category) => (
                <li key={category.slug}>
                  <Link
                    href={routes.category(category.slug)}
                    className="text-ink-2 hover:text-accent-ink"
                  >
                    {category.name}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <nav aria-labelledby="footer-about">
            <p
              id="footer-about"
              className="font-display text-xs font-semibold tracking-wider uppercase"
            >
              Thông tin
            </p>
            <ul className="mt-3 space-y-1.5 text-sm">
              {FOOTER_LINKS.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className="text-ink-2 hover:text-accent-ink">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>

        <p className="border-rule text-ink-3 mt-10 border-t pt-6 text-xs">
          © {hanoiYear()} {SITE.name}. Thông tin trên trang mang tính giáo dục, không thay thế tư
          vấn y tế cá nhân.
        </p>
      </div>
    </footer>
  );
}
