import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { serviceClient } from '@/lib/supabase/service';
import { articlePath, routes } from '@/lib/site';
import { timingSafeEqualString } from '@/lib/security/compare';

/**
 * On-demand cache invalidation after a publication.
 *
 * Pages use ISR with an hourly window, which is a safety net rather than the mechanism. This
 * is the mechanism: when the automation publishes, the affected paths are purged immediately
 * so a new article is visible within seconds instead of within the hour.
 *
 * Failure here is deliberately non-fatal for the caller — the article is already published
 * and ISR will catch up — so the automation logs a warning and moves on.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<NextResponse> {
  const expected = process.env.REVALIDATE_SECRET;
  if (expected === undefined || expected === '') {
    return NextResponse.json({ error: 'REVALIDATE_SECRET is not configured' }, { status: 503 });
  }
  if (!timingSafeEqualString(request.headers.get('x-revalidate-secret') ?? '', expected)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let articleId: string | null = null;
  try {
    const body = (await request.json()) as { articleId?: unknown };
    if (typeof body.articleId === 'string') articleId = body.articleId;
  } catch {
    // An empty or malformed body is fine: the site-wide paths below still get purged.
  }

  const purged: string[] = [routes.home(), routes.latest(), routes.research(), routes.rss()];

  if (articleId !== null) {
    const { data } = await serviceClient()
      .from('articles')
      .select('slug, article_type, categories(slug)')
      .eq('id', articleId)
      .maybeSingle();

    if (data !== null && data !== undefined) {
      const row = data as unknown as {
        slug: string;
        article_type: 'youtube' | 'research';
        categories: { slug: string } | null;
      };
      purged.push(articlePath({ slug: row.slug, articleType: row.article_type }));
      if (row.categories !== null) purged.push(routes.category(row.categories.slug));
    }
  }

  for (const path of purged) revalidatePath(path);
  // The sitemap is a route handler, so it is purged by path like any other.
  revalidatePath('/sitemap.xml');

  return NextResponse.json({ revalidated: purged }, { status: 200 });
}
