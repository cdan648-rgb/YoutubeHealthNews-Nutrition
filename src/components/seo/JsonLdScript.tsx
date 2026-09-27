import type { JsonLd } from '@/lib/seo/jsonld';

/**
 * Renders a JSON-LD script tag.
 *
 * Lives in `components` rather than `lib/seo` because it is JSX; the builders in
 * `@/lib/seo/jsonld` stay free of React so they can be unit-tested as plain data.
 */
export function JsonLdScript({ data }: { readonly data: JsonLd | readonly JsonLd[] }) {
  return (
    <script
      type="application/ld+json"
      // The content is built from our own typed objects, never from reader input, and
      // JSON.stringify escapes the values. The one remaining injection vector in JSON-LD
      // is a literal "</script>" inside a string, which escaping "<" neutralises.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, '\u003c') }}
    />
  );
}
