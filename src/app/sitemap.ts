import type { MetadataRoute } from 'next';
import { listPublishedSlugs } from '@/lib/repositories/articles';
import { listCategories } from '@/lib/repositories/categories';
import { absoluteUrl, articlePath, routes } from '@/lib/site';

export const revalidate = 3600;

/**
 * Sitemap.
 *
 * Built from the database so a newly published article appears without a deploy. Only
 * indexable routes are listed: the transactional newsletter pages and the admin view
 * are excluded here as well as in robots.txt.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [articles, categories] = await Promise.all([listPublishedSlugs(), listCategories()]);

  const newest = articles[0]?.updatedAt;

  const staticRoutes: MetadataRoute.Sitemap = [
    {
      url: absoluteUrl(routes.home()),
      changeFrequency: 'daily',
      priority: 1,
      ...(newest !== undefined ? { lastModified: new Date(newest) } : {}),
    },
    { url: absoluteUrl(routes.latest()), changeFrequency: 'daily', priority: 0.9 },
    { url: absoluteUrl(routes.research()), changeFrequency: 'weekly', priority: 0.7 },
    { url: absoluteUrl(routes.factChecks()), changeFrequency: 'weekly', priority: 0.7 },
    { url: absoluteUrl(routes.newsletter()), changeFrequency: 'monthly', priority: 0.5 },
    { url: absoluteUrl(routes.about()), changeFrequency: 'yearly', priority: 0.4 },
    { url: absoluteUrl(routes.methodology()), changeFrequency: 'yearly', priority: 0.5 },
    { url: absoluteUrl(routes.disclaimer()), changeFrequency: 'yearly', priority: 0.3 },
    { url: absoluteUrl(routes.privacy()), changeFrequency: 'yearly', priority: 0.3 },
    { url: absoluteUrl(routes.contact()), changeFrequency: 'yearly', priority: 0.3 },
  ];

  return [
    ...staticRoutes,
    ...categories.map((category) => ({
      url: absoluteUrl(routes.category(category.slug)),
      changeFrequency: 'weekly' as const,
      priority: 0.6,
    })),
    ...articles.map((article) => ({
      url: absoluteUrl(
        articlePath({
          slug: article.slug,
          articleType: article.articleType as 'youtube' | 'research',
        }),
      ),
      lastModified: new Date(article.updatedAt),
      changeFrequency: 'monthly' as const,
      priority: 0.8,
    })),
  ];
}
