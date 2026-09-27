/**
 * Seed articles are held to the same standard the automated pipeline will be.
 *
 * Every rule asserted here is one the Phase 5 validation gate will enforce on generated
 * articles. Running them against the hand-written seeds first means the standard is
 * demonstrably achievable before any AI code exists — and if a seed cannot pass, the
 * rule is either wrong or the article is, and both are worth knowing now.
 */
import { describe, expect, it } from 'vitest';
import { bodySchema, checkBodyStructure, blocksToPlainText, countWords } from '@/lib/domain/blocks';
import { isValidSlug } from '@/lib/slug';
import { SEED_ARTICLES } from './index';
import { loadVideoFixture } from '../../../tests/fixtures';

const CATEGORY_SLUGS = [
  'vi-chat-vitamin',
  'dinh-duong-chuyen-hoa',
  'noi-tiet-hormone',
  'mien-dich-nhiem-trung-ung-thu',
  'tieu-hoa-gan-than',
  'co-xuong-khop-van-dong',
  'phong-ngua-tam-than',
];

/** Only these hosts may be cited. Mirrors `allowed_reference_hosts` in the database. */
const ALLOWED_HOSTS = [
  'who.int',
  'www.who.int',
  'nih.gov',
  'ods.od.nih.gov',
  'www.nccih.nih.gov',
  'nccih.nih.gov',
  'medlineplus.gov',
  'pubmed.ncbi.nlm.nih.gov',
  'pmc.ncbi.nlm.nih.gov',
  'europepmc.org',
  'cochranelibrary.com',
  'doi.org',
];

describe('the seed set as a whole', () => {
  it('is exactly five articles', () => {
    expect(SEED_ARTICLES).toHaveLength(5);
  });

  it('uses five DIFFERENT source videos', () => {
    const ids = SEED_ARTICLES.map((seed) => seed.videoId);
    expect(new Set(ids).size).toBe(5);
  });

  it('spreads across five different categories', () => {
    const categories = SEED_ARTICLES.map((seed) => seed.categorySlug);
    expect(new Set(categories).size).toBe(5);
  });

  it('has unique slugs, all valid for the database CHECK constraint', () => {
    const slugs = SEED_ARTICLES.map((seed) => seed.slug);
    expect(new Set(slugs).size).toBe(5);
    for (const slug of slugs) expect(isValidSlug(slug)).toBe(true);
  });

  it('publishes on distinct Hanoi dates before the automation starts', () => {
    const dates = SEED_ARTICLES.map((seed) => seed.publishedDateHanoi);
    expect(new Set(dates).size).toBe(5);
    // The first automated run is 2026-09-28; seeds must not collide with it.
    for (const date of dates) expect(date < '2026-09-28').toBe(true);
  });

  it('includes at least one fact-check to exercise the badge', () => {
    expect(SEED_ARTICLES.filter((seed) => seed.isFactCheck).length).toBeGreaterThanOrEqual(1);
  });
});

describe.each(SEED_ARTICLES.map((seed) => [seed.slug, seed] as const))(
  'seed: %s',
  (_slug, seed) => {
    it('has a body that satisfies the block schema', () => {
      const parsed = bodySchema.safeParse(seed.body);
      expect(parsed.success, JSON.stringify(parsed.error?.issues.slice(0, 3))).toBe(true);
    });

    it('satisfies every structural rule', () => {
      expect(checkBodyStructure(seed.body, seed.references)).toStrictEqual([]);
    });

    it('references a real captured video from the source channel', () => {
      const fixture = loadVideoFixture(seed.videoId);
      expect(fixture.channelId).toBe('UC79E6KatRfXbmdWVWGncsew');
      expect(fixture.videoId).toBe(seed.videoId);
    });

    it('uses a seeded category slug', () => {
      expect(CATEGORY_SLUGS).toContain(seed.categorySlug);
    });

    it('is long enough to be an article and short enough to read', () => {
      const words = countWords(blocksToPlainText(seed.body));
      expect(words).toBeGreaterThanOrEqual(700);
      expect(words).toBeLessThanOrEqual(1600);
    });

    it('cites only allowlisted hosts over https', () => {
      expect(seed.references.length).toBeGreaterThanOrEqual(2);
      for (const reference of seed.references) {
        const url = new URL(reference.url);
        expect(url.protocol).toBe('https:');
        expect(ALLOWED_HOSTS).toContain(url.hostname);
      }
    });

    it('never presents a verbatim quotation as the presenter’s words', () => {
      // There is no transcript for these videos, so a direct quote would be fabricated.
      for (const block of seed.body) {
        if (block.t === 'pull_quote') expect(block.kind).toBe('paraphrase');
      }
    });

    it('contains no dosage instruction', () => {
      const text = blocksToPlainText(seed.body);
      // The trailing lookahead is Unicode-aware on purpose. JavaScript's \b is
      // ASCII-only, so /\d+\s*g\b/ matches "126 gọi" — the boundary falls between "g"
      // and "ọ" because "ọ" is not an ASCII word character. Any dosage detector running
      // over Vietnamese prose must use \p{L} instead, or it flags ordinary sentences.
      expect(text).not.toMatch(/\d+\s*(mg|mcg|µg|g|kg|ml|IU|đơn vị)(?![\p{L}\d])/iu);
    });

    it('contains no prescriptive treatment language', () => {
      const text = blocksToPlainText(seed.body).toLowerCase();
      for (const phrase of [
        'bạn nên uống',
        'hãy uống',
        'liều dùng',
        'chữa khỏi',
        'thay thế thuốc',
      ]) {
        expect(text).not.toContain(phrase);
      }
    });

    it('distinguishes the video’s claims from established information', () => {
      const speaker = seed.body.filter((b) => b.t === 'p' && b.attribution === 'speaker');
      const established = seed.body.filter((b) => b.t === 'p' && b.attribution === 'established');
      expect(speaker.length).toBeGreaterThanOrEqual(1);
      expect(established.length).toBeGreaterThanOrEqual(1);
    });

    it('carries SEO metadata within sensible lengths', () => {
      expect(seed.seo.metaTitle.length).toBeLessThanOrEqual(70);
      expect(seed.seo.metaDescription.length).toBeGreaterThanOrEqual(80);
      expect(seed.seo.metaDescription.length).toBeLessThanOrEqual(200);
      expect(seed.dek.length).toBeGreaterThanOrEqual(80);
    });
  },
);

describe('the breathing article handles its unverifiable claims explicitly', () => {
  // This seed exists to prove the standard: its source description asserts a "15x"
  // clearance effect and a body "immune to illness". An article that repeated either as
  // fact would be exactly the failure mode the whole validation design targets.
  const seed = SEED_ARTICLES.find((item) => item.slug.startsWith('ky-thuat-tho'));

  it('exists', () => {
    expect(seed).toBeDefined();
  });

  it('names the unverified claims rather than omitting them', () => {
    const text = blocksToPlainText(seed?.body ?? []);
    expect(text).toContain('15 lần');
    expect(text.toLowerCase()).toContain('không tìm được bằng chứng');
  });

  it('attributes the strong claims to the video, not to the publication', () => {
    const speakerText = (seed?.body ?? [])
      .filter((block) => block.t === 'p' && block.attribution === 'speaker')
      .map((block) => (block.t === 'p' ? block.text : ''))
      .join(' ');
    expect(speakerText).toContain('15 lần');
  });

  it('states that no method makes the body immune to illness', () => {
    const text = blocksToPlainText(seed?.body ?? []);
    expect(text).toContain('miễn nhiễm với bệnh tật');
    expect(text).toMatch(/không có phương pháp nào/i);
  });
});
