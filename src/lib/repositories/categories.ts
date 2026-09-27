/**
 * Category queries.
 *
 * Categories are reference data written only by migration, so they are effectively
 * immutable at runtime. The seven-row result is cached per request by React's `cache`
 * so a page that renders the nav, a breadcrumb and a card grid issues one query
 * rather than three.
 */
import { cache } from 'react';
import { toCategory, type Category } from '@/lib/domain/types';
import { publicClient } from '@/lib/supabase/server';

const COLUMNS =
  'id, slug, name, description, icon_key, color_token, sort_order, is_active, seo_title, seo_description, keywords, created_at, updated_at';

/** Active categories in display order. RLS already hides inactive ones. */
export const listCategories = cache(async (): Promise<Category[]> => {
  const { data, error } = await publicClient()
    .from('categories')
    .select(COLUMNS)
    .order('sort_order', { ascending: true });

  if (error !== null) throw new Error(`listCategories failed: ${error.message}`);
  return (data ?? []).map(toCategory);
});

/** One category by slug, or null. Null means 404, not an error. */
export const getCategoryBySlug = cache(async (slug: string): Promise<Category | null> => {
  const { data, error } = await publicClient()
    .from('categories')
    .select(COLUMNS)
    .eq('slug', slug)
    .maybeSingle();

  if (error !== null) throw new Error(`getCategoryBySlug failed: ${error.message}`);
  return data === null ? null : toCategory(data);
});

/** Published-article counts per category slug, for the navigation and index pages. */
export async function countArticlesPerCategory(): Promise<ReadonlyMap<string, number>> {
  const { data, error } = await publicClient()
    .from('articles')
    .select('categories!inner(slug)')
    .eq('status', 'published')
    .lte('published_at', new Date().toISOString());

  if (error !== null) throw new Error(`countArticlesPerCategory failed: ${error.message}`);

  const counts = new Map<string, number>();
  for (const row of (data ?? []) as unknown as { categories: { slug: string } | null }[]) {
    const slug = row.categories?.slug;
    if (slug !== undefined) counts.set(slug, (counts.get(slug) ?? 0) + 1);
  }
  return counts;
}
