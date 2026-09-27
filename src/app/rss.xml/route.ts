import { listArticles } from '@/lib/repositories/articles';
import { SITE, absoluteUrl, articlePath, routes } from '@/lib/site';

export const revalidate = 3600;

/**
 * RSS 2.0 feed.
 *
 * Hand-built rather than pulled from a library: the document is forty lines and a
 * dependency here would be more code to audit than to write. Every text node goes
 * through `escapeXml`, because a Vietnamese title containing an ampersand would
 * otherwise produce a malformed feed.
 */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export async function GET(): Promise<Response> {
  const articles = await listArticles({ limit: 30 });

  const items = articles
    .map((article) => {
      const url = absoluteUrl(articlePath(article));
      return `    <item>
      <title>${escapeXml(article.title)}</title>
      <link>${url}</link>
      <guid isPermaLink="true">${url}</guid>
      <pubDate>${new Date(article.publishedAt).toUTCString()}</pubDate>
      <category>${escapeXml(article.category.name)}</category>
      <description>${escapeXml(article.dek)}</description>
    </item>`;
    })
    .join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(SITE.name)}</title>
    <link>${SITE.url}</link>
    <description>${escapeXml(SITE.description)}</description>
    <language>vi-VN</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    <atom:link href="${absoluteUrl(routes.rss())}" rel="self" type="application/rss+xml" />
${items}
  </channel>
</rss>
`;

  return new Response(xml, {
    headers: {
      'content-type': 'application/rss+xml; charset=utf-8',
      'cache-control': 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400',
    },
  });
}
