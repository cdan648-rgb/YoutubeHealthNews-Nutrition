/**
 * Structured data.
 *
 * Two deliberate choices about honesty, both of which matter more than the SEO:
 *
 *   * the type is `Article`, not `NewsArticle`. We are not a recognised news
 *     publisher, and claiming to be one in structured data is a needless
 *     misrepresentation;
 *   * `author` and `publisher` are always this publication. The doctor whose videos we
 *     report on is expressed through `isBasedOn` and `citation` — "we reported on
 *     this" — never as the byline, which would imply he wrote it.
 */
import type { Article } from '@/lib/domain/types';
import { SITE, SOURCE_CHANNEL, absoluteUrl, articlePath } from '@/lib/site';

export type JsonLd = Record<string, unknown>;

const publisher = {
  '@type': 'Organization',
  name: SITE.name,
  url: SITE.url,
} as const;

export function organizationJsonLd(): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: SITE.name,
    url: SITE.url,
    description: SITE.description,
    // States the relationship explicitly in machine-readable form.
    disambiguatingDescription: `Trang tin độc lập, không liên kết với kênh YouTube ${SOURCE_CHANNEL.title}.`,
  };
}

export function websiteJsonLd(): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: SITE.name,
    url: SITE.url,
    inLanguage: SITE.locale,
    publisher,
  };
}

export function breadcrumbJsonLd(trail: readonly { name: string; path: string }[]): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: trail.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: absoluteUrl(item.path),
    })),
  };
}

/**
 * Article structured data.
 *
 * `isBasedOn` points at the source — the YouTube video for channel-derived pieces, the
 * DOI for research pieces — which is how the relationship is declared without
 * claiming authorship of the underlying work.
 */
export function articleJsonLd(article: Article): JsonLd {
  const url = absoluteUrl(articlePath(article));

  const basedOn: JsonLd[] = [];
  if (article.sourceVideo !== null) {
    basedOn.push({
      '@type': 'VideoObject',
      name: article.sourceVideo.title,
      url: article.sourceVideo.url,
      ...(article.sourceVideo.publishedAt !== null
        ? { uploadDate: article.sourceVideo.publishedAt }
        : {}),
      ...(article.sourceVideo.durationSeconds !== null
        ? { duration: `PT${article.sourceVideo.durationSeconds}S` }
        : {}),
      publisher: { '@type': 'Organization', name: article.sourceVideo.channelTitle },
    });
  }
  if (article.researchSource !== null) {
    const paper = article.researchSource;
    basedOn.push({
      '@type': 'ScholarlyArticle',
      name: paper.title,
      url: paper.sourceUrl,
      ...(paper.doi !== null ? { sameAs: `https://doi.org/${paper.doi}` } : {}),
      ...(paper.journal !== null
        ? { isPartOf: { '@type': 'Periodical', name: paper.journal } }
        : {}),
      ...(paper.publicationDate !== null ? { datePublished: paper.publicationDate } : {}),
      author: paper.authors.map((author) => ({ '@type': 'Person', name: author.name })),
    });
  }

  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: article.title,
    description: article.dek,
    url,
    mainEntityOfPage: url,
    inLanguage: SITE.locale,
    datePublished: article.publishedAt,
    dateModified: article.publishedAt,
    // Never the creator whose material we report on.
    author: publisher,
    publisher,
    articleSection: article.category.name,
    ...(article.hero.kind === 'youtube_thumbnail' ? { thumbnailUrl: article.hero.url } : {}),
    ...(basedOn.length > 0 ? { isBasedOn: basedOn } : {}),
    ...(article.references.length > 0
      ? {
          citation: article.references.map((reference) => ({
            '@type': 'CreativeWork',
            name: reference.title,
            url: reference.url,
            publisher: { '@type': 'Organization', name: reference.publisher },
          })),
        }
      : {}),
  };
}

export function collectionJsonLd(
  name: string,
  path: string,
  items: readonly { slug: string; title: string; articleType: 'youtube' | 'research' }[],
): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name,
    url: absoluteUrl(path),
    inLanguage: SITE.locale,
    publisher,
    mainEntity: {
      '@type': 'ItemList',
      itemListElement: items.map((item, index) => ({
        '@type': 'ListItem',
        position: index + 1,
        url: absoluteUrl(articlePath(item)),
        name: item.title,
      })),
    },
  };
}
