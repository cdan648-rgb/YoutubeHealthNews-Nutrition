import type { Metadata } from 'next';
import { Be_Vietnam_Pro, Noto_Serif } from 'next/font/google';
import { SiteHeader } from '@/components/layout/SiteHeader';
import { SiteFooter } from '@/components/layout/SiteFooter';
import { NewsletterModal } from '@/components/newsletter/NewsletterModal';
import { JsonLdScript } from '@/components/seo/JsonLdScript';
import { organizationJsonLd, websiteJsonLd } from '@/lib/seo/jsonld';
import { SITE } from '@/lib/site';
import '@/styles/globals.css';

/*
  Both families load the `vietnamese` subset explicitly. Without it, diacritics fall
  back to a system font mid-word, which looks broken and shifts layout. next/font
  self-hosts them and generates a size-adjusted fallback, so there is no CLS while the
  webfont loads.
*/
const beVietnamPro = Be_Vietnam_Pro({
  subsets: ['vietnamese', 'latin'],
  weight: ['400', '600', '700'],
  variable: '--font-be-vietnam-pro',
  display: 'swap',
});

const notoSerif = Noto_Serif({
  subsets: ['vietnamese', 'latin'],
  weight: ['400', '600'],
  variable: '--font-noto-serif',
  display: 'swap',
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE.url),
  title: {
    default: `${SITE.name} — ${SITE.tagline}`,
    template: `%s — ${SITE.name}`,
  },
  description: SITE.description,
  applicationName: SITE.name,
  openGraph: {
    type: 'website',
    siteName: SITE.name,
    locale: 'vi_VN',
    title: `${SITE.name} — ${SITE.tagline}`,
    description: SITE.description,
    url: SITE.url,
  },
  twitter: { card: 'summary_large_image' },
  robots: { index: true, follow: true },
  alternates: {
    canonical: '/',
    types: { 'application/rss+xml': `${SITE.url}/rss.xml` },
  },
  formatDetection: { telephone: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi-VN" className={`${beVietnamPro.variable} ${notoSerif.variable}`}>
      <body className="flex min-h-dvh flex-col antialiased">
        <JsonLdScript data={[organizationJsonLd(), websiteJsonLd()]} />
        {/* Keyboard users land here first; the target is the <main> of each page. */}
        <a
          href="#main"
          className="bg-accent sr-only rounded px-3 py-2 text-white focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50"
        >
          Bỏ qua điều hướng, tới nội dung chính
        </a>
        <SiteHeader />
        <div className="flex-1">{children}</div>
        <SiteFooter />
        {/* Timed, dismissible, and self-suppressing — see NewsletterModal for the rules. */}
        <NewsletterModal />
      </body>
    </html>
  );
}
