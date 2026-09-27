/**
 * Seed article definitions.
 *
 * These five articles are editorial seed content, written and reviewed by hand rather
 * than generated. They exist to set the standard the automated pipeline is later
 * measured against, and to give the site real content before any AI code exists.
 *
 * They are defined as TypeScript, not SQL or JSON, for one specific reason: the body is
 * typed as `Block[]`, so `tsc` rejects a malformed seed at build time. A seed cannot
 * ship with a dangling reference index, a missing disclaimer or an invalid block.
 *
 * Every seed carries `automationRunId: null` when inserted — they are not automated
 * daily publications and must not occupy a Hanoi publishing date.
 */
import type { Block, Reference } from '@/lib/domain/blocks';
import type { VideoFixtureId } from '../../../tests/fixtures';

export type SeedArticle = {
  readonly slug: string;
  readonly title: string;
  readonly dek: string;
  /** Must match one of the seven seeded category slugs. */
  readonly categorySlug: string;
  /** Renders the fact-check badge and feeds the /kiem-chung listing. */
  readonly isFactCheck: boolean;
  /** A real video from the source channel; metadata comes from its captured fixture. */
  readonly videoId: VideoFixtureId;
  readonly body: readonly Block[];
  readonly references: readonly Reference[];
  readonly seo: {
    readonly metaTitle: string;
    readonly metaDescription: string;
  };
  /**
   * The Hanoi calendar date this seed is presented as published on. Chosen to sit
   * before the automation's first run so the seeds read as the site's back catalogue
   * rather than competing with automated days.
   */
  readonly publishedDateHanoi: string;
};

/** Hero image URL for a video. Referenced from YouTube, never copied or re-hosted. */
export function heroUrl(videoId: string): string {
  return `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`;
}
