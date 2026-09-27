import { CategorySvg } from '@/components/visual/CategorySvg';
import type { Hero } from '@/lib/domain/types';

/**
 * The article hero.
 *
 * Two decisions here are load-bearing.
 *
 * 1. A plain `<img>`, not `next/image`. The optimiser would fetch the thumbnail and
 *    cache a derivative on our own CDN — a copy, not a reference. The source channel's
 *    descriptions carry a "please do not re-upload" notice, so we reference YouTube's
 *    own URL and store nothing. `srcset` across YouTube's fixed variants gives
 *    responsive behaviour without an optimiser, and explicit width/height plus a
 *    16:9 aspect ratio keep CLS at zero.
 *
 * 2. The credit is rendered by this component, not passed in as an option. There is no
 *    prop that suppresses it, so no caller — and no future generated article — can
 *    publish the thumbnail without its attribution. The database enforces the same
 *    rule from the other side (`thumbnail_hero_is_attributed`).
 */

type Props = {
  readonly hero: Hero;
  /** Heroes above the fold load eagerly with high priority; cards do not. */
  readonly priority?: boolean;
  readonly className?: string;
};

/** YouTube's fixed thumbnail sizes, used to build a srcset from any variant URL. */
const YT_VARIANTS = [
  { name: 'mqdefault', width: 320 },
  { name: 'hqdefault', width: 480 },
  { name: 'sddefault', width: 640 },
  { name: 'maxresdefault', width: 1280 },
] as const;

/**
 * Derive a srcset from a single i.ytimg.com URL.
 *
 * Returns undefined for anything that is not a recognisable ytimg thumbnail path, so
 * an unexpected URL degrades to a plain `src` rather than to broken candidates.
 */
export function youtubeSrcSet(url: string): string | undefined {
  const match = /^(https:\/\/i\.ytimg\.com\/vi\/[A-Za-z0-9_-]{11}\/)[a-z]+\.jpg/.exec(url);
  if (match?.[1] === undefined) return undefined;
  return YT_VARIANTS.map((variant) => `${match[1]}${variant.name}.jpg ${variant.width}w`).join(
    ', ',
  );
}

export function SourceHero({ hero, priority = false, className }: Props) {
  if (hero.kind === 'youtube_thumbnail') {
    const srcSet = youtubeSrcSet(hero.url);
    return (
      <figure className={className}>
        <div className="bg-accent-wash relative aspect-video overflow-hidden rounded-lg">
          {/* eslint-disable-next-line @next/next/no-img-element -- Deliberate, see
              the note above: next/image would cache a derivative copy of the
              thumbnail on our own CDN, which is a copy rather than a reference. */}
          <img
            src={hero.url}
            {...(srcSet !== undefined ? { srcSet } : {})}
            sizes="(min-width: 1024px) 720px, 100vw"
            alt={hero.alt}
            width={1280}
            height={720}
            loading={priority ? 'eager' : 'lazy'}
            fetchPriority={priority ? 'high' : 'auto'}
            decoding="async"
            // Keeps the referrer to an origin rather than a full article URL.
            referrerPolicy="strict-origin-when-cross-origin"
            className="size-full object-cover"
          />
          {/* Rendered unconditionally. There is no prop to turn this off. */}
          <figcaption className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent px-3 pt-8 pb-2 text-[11px] leading-snug text-white">
            {hero.attribution}
          </figcaption>
        </div>
      </figure>
    );
  }

  if (hero.kind === 'svg') {
    return (
      <div
        className={`bg-accent-wash text-accent aspect-video overflow-hidden rounded-lg ${className ?? ''}`}
      >
        <CategorySvg motif={hero.motif} seed={hero.alt} className="size-full" />
      </div>
    );
  }

  // `published_has_hero` prevents this in published data; kept so a draft preview
  // renders something rather than collapsing.
  return (
    <div
      className={`bg-accent-wash text-accent/40 aspect-video overflow-hidden rounded-lg ${className ?? ''}`}
      aria-hidden="true"
    >
      <CategorySvg motif="lattice" className="size-full" />
    </div>
  );
}
