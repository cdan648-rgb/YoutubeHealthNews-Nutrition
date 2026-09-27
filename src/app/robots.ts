import type { MetadataRoute } from 'next';
import { SITE, absoluteUrl } from '@/lib/site';

/**
 * robots.txt
 *
 * The API routes and the transactional newsletter pages are disallowed: they are
 * either machine endpoints or one-visitor-only confirmation pages, so indexing them
 * wastes crawl budget and could surface a tokenised URL in search results.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/api/', '/admin/', '/huy-dang-ky', '/newsletter/xac-nhan', '/tim-kiem'],
      },
    ],
    sitemap: absoluteUrl('/sitemap.xml'),
    host: SITE.url,
  };
}
