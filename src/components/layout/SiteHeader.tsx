import Link from 'next/link';
import { listCategories } from '@/lib/repositories/categories';
import { INDEPENDENCE, SITE, routes } from '@/lib/site';
import { MobileNav } from './MobileNav';

/**
 * Site header.
 *
 * A server component: the navigation is derived from the seven seeded categories, so
 * it needs no client state. The only client JavaScript on the page is the mobile
 * drawer, which is a separate island.
 *
 * The independence strip sits above the masthead rather than buried in the footer.
 * That placement is deliberate — a reader arriving on an article from search should
 * learn in the first viewport that this is not the creator's own site.
 */
export async function SiteHeader() {
  const categories = await listCategories();

  return (
    <header className="border-rule bg-surface/95 sticky top-0 z-40 border-b backdrop-blur">
      <p className="bg-ink text-paper px-4 py-1.5 text-center text-[11px] leading-snug tracking-wide sm:text-xs">
        {INDEPENDENCE.short}
      </p>

      <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3 sm:px-6">
        <Link
          href={routes.home()}
          className="font-display shrink-0 text-lg font-bold tracking-tight sm:text-xl"
        >
          {SITE.name}
        </Link>

        <span className="text-ink-3 hidden border-l pl-3 text-xs sm:block" aria-hidden="true">
          {SITE.tagline}
        </span>

        <nav aria-label="Chuyên mục chính" className="ml-auto hidden items-center gap-1 lg:flex">
          {categories.slice(0, 4).map((category) => (
            <Link
              key={category.slug}
              href={routes.category(category.slug)}
              className="hover:bg-accent-wash hover:text-accent-ink rounded px-2.5 py-1.5 text-sm transition-colors"
            >
              {category.name}
            </Link>
          ))}
          <Link
            href={routes.research()}
            className="text-research hover:bg-accent-wash rounded px-2.5 py-1.5 text-sm font-semibold transition-colors"
          >
            Nghiên cứu
          </Link>
          <Link
            href={routes.factChecks()}
            className="text-fact hover:bg-accent-wash rounded px-2.5 py-1.5 text-sm font-semibold transition-colors"
          >
            Kiểm chứng
          </Link>
        </nav>

        <div className="ml-auto lg:ml-0">
          <MobileNav categories={categories.map(({ slug, name }) => ({ slug, name }))} />
        </div>
      </div>
    </header>
  );
}
