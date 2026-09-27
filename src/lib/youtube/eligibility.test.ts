import { describe, expect, it } from 'vitest';
import { titleFingerprint } from '@/lib/slug';
import {
  DUPLICATE_SIMILARITY_THRESHOLD,
  MIN_DURATION_SECONDS,
  checkEligibility,
  findProbableDuplicate,
  normaliseVideo,
  trigramSimilarity,
  type DuplicateCandidate,
} from './eligibility';
import type { FetchedVideo } from './types';
import { loadVideoFixture } from '../../../tests/fixtures';

function fetched(overrides: Partial<FetchedVideo> = {}): FetchedVideo {
  return {
    youtubeVideoId: 'aaaaaaaaaaa',
    title: 'Số 200: Một tiêu đề bình thường',
    description: `Nội dung biên tập thực sự. ${'Chi tiết đủ dài để vượt ngưỡng. '.repeat(12)}`,
    publishedAt: '2026-09-01T02:00:00Z',
    durationSeconds: 12000,
    viewCount: 1000,
    keywords: ['sức khỏe'],
    thumbnails: { best: null, variants: {} },
    liveInProgress: false,
    ...overrides,
  };
}

describe('checkEligibility', () => {
  it('accepts a normal episode', () => {
    expect(checkEligibility(fetched(), 900)).toStrictEqual({ eligible: true });
  });

  it('rejects a running livestream before anything else', () => {
    expect(
      checkEligibility(fetched({ liveInProgress: true, durationSeconds: 10 }), 900),
    ).toStrictEqual({ eligible: false, reason: 'live_not_ended' });
  });

  it('rejects the real "coming soon" placeholder from the archive', () => {
    // A genuine row on the channel: ilVWYjEcr5c.
    const verdict = checkEligibility(
      fetched({ title: 'Thuốc kích thích rau củ quả có nguy hiểm không? – coming soon' }),
      900,
    );
    expect(verdict).toStrictEqual({ eligible: false, reason: 'placeholder' });
  });

  it('rejects a Short', () => {
    expect(
      checkEligibility(fetched({ durationSeconds: MIN_DURATION_SECONDS - 1 }), 900),
    ).toStrictEqual({ eligible: false, reason: 'is_short' });
    expect(checkEligibility(fetched({ durationSeconds: MIN_DURATION_SECONDS }), 900)).toStrictEqual(
      {
        eligible: true,
      },
    );
  });

  it('rejects a description too thin to build an article from', () => {
    // With no transcript available this is the only substantive input, so too little of
    // it means any article would be padding.
    expect(checkEligibility(fetched(), 100)).toStrictEqual({
      eligible: false,
      reason: 'insufficient_source',
    });
  });

  it('accepts a video with unknown duration rather than guessing', () => {
    expect(checkEligibility(fetched({ durationSeconds: null }), 900)).toStrictEqual({
      eligible: true,
    });
  });
});

describe('normaliseVideo on the real fixtures', () => {
  it('produces an eligible row for every captured video', () => {
    for (const id of [
      'An4HFu4EwFQ',
      'lBKtncuS0yY',
      'cI74O0zS5QI',
      'nfNvuW2lQkI',
      'hkP4Heyobuc',
    ] as const) {
      const fixture = loadVideoFixture(id);
      const row = normaliseVideo(
        fetched({
          youtubeVideoId: fixture.videoId,
          title: fixture.title,
          description: fixture.description,
          durationSeconds: fixture.lengthSeconds,
          viewCount: fixture.viewCount,
          keywords: fixture.keywords,
        }),
      );

      expect(row.eligible).toBe(true);
      expect(row.ineligibleReason).toBeNull();
      expect(row.lowSignal).toBe(false);
      expect(row.descriptionClean.length).toBeGreaterThan(250);
      expect(row.descriptionClean.length).toBeLessThan(row.descriptionRaw.length);
    }
  });

  it('extracts the episode number from the title', () => {
    const fixture = loadVideoFixture('An4HFu4EwFQ');
    expect(normaliseVideo(fetched({ title: fixture.title })).episodeNumber).toBe(118);
  });

  it('records the reason on an ineligible row instead of dropping it', () => {
    const row = normaliseVideo(fetched({ description: 'Quá ngắn.', durationSeconds: 30 }));
    expect(row.eligible).toBe(false);
    expect(row.ineligibleReason).toBe('is_short');
    // The row still carries everything, so "why no article?" is answerable.
    expect(row.title).toBeTruthy();
    expect(row.publishedAt).toBeTruthy();
  });
});

describe('trigramSimilarity', () => {
  it('scores identical strings 1 and disjoint strings 0', () => {
    expect(trigramSimilarity('vitamin b12', 'vitamin b12')).toBe(1);
    expect(trigramSimilarity('abc', 'xyz')).toBe(0);
  });

  it('treats two empty strings as identical', () => {
    expect(trigramSimilarity('', '')).toBe(1);
    expect(trigramSimilarity('abc', '')).toBe(0);
  });

  it('scores a re-upload of the same episode above the threshold', () => {
    const a = titleFingerprint('Số 133: Silic và Boron – Mắt xích vàng bị lãng quên');
    const b = titleFingerprint('Số 133 - Silic và Boron, Mắt xích vàng bị lãng quên!');
    expect(trigramSimilarity(a, b)).toBeGreaterThan(DUPLICATE_SIMILARITY_THRESHOLD);
  });

  it('scores two genuinely different episodes below the threshold', () => {
    const a = titleFingerprint('Số 118: THIẾU MAGIE CƠ THỂ SỤP ĐỔ NHƯ THẾ NÀO?');
    const b = titleFingerprint('Số 132: Vắc xin ung thư viết lại tương lai ung thư học');
    expect(trigramSimilarity(a, b)).toBeLessThan(DUPLICATE_SIMILARITY_THRESHOLD);
  });
});

describe('findProbableDuplicate', () => {
  const used = (overrides: Partial<DuplicateCandidate>): DuplicateCandidate => ({
    id: 'id-1',
    youtubeVideoId: 'aaaaaaaaaaa',
    titleFingerprint: titleFingerprint('Số 133: Silic và Boron – Mắt xích vàng bị lãng quên'),
    episodeNumber: 133,
    status: 'used',
    ...overrides,
  });

  it('catches a re-upload with a new id but the same episode number', () => {
    // The unique constraint on youtube_video_id cannot see this: the id is genuinely new.
    const match = findProbableDuplicate(
      { title: 'Silic và Boron (đăng lại)', episodeNumber: 133 },
      [used({})],
    );
    expect(match?.youtubeVideoId).toBe('aaaaaaaaaaa');
  });

  it('catches a re-upload by title similarity when the number is absent', () => {
    const match = findProbableDuplicate(
      { title: 'Số 133 - Silic và Boron, Mắt xích vàng bị lãng quên!', episodeNumber: null },
      [used({})],
    );
    expect(match).not.toBeNull();
  });

  it('does not flag a genuinely different episode', () => {
    const match = findProbableDuplicate(
      { title: 'Số 134: Vitamin K2 và sức khoẻ mạch máu', episodeNumber: 134 },
      [used({})],
    );
    expect(match).toBeNull();
  });

  it('ignores an episode-number match on a video we have NOT used', () => {
    // Only a used video means "an article already exists for this content".
    const match = findProbableDuplicate({ title: 'Khác hoàn toàn', episodeNumber: 133 }, [
      used({ status: 'available' }),
    ]);
    expect(match).toBeNull();
  });

  it('returns nothing when there is nothing to compare against', () => {
    expect(findProbableDuplicate({ title: 'Bất kỳ', episodeNumber: 1 }, [])).toBeNull();
  });

  it('picks the closest match when several are similar', () => {
    const closer = used({
      id: 'id-2',
      youtubeVideoId: 'bbbbbbbbbbb',
      episodeNumber: null,
      titleFingerprint: titleFingerprint('Số 133: Silic và Boron – Mắt xích vàng bị lãng quên'),
    });
    const looser = used({
      id: 'id-3',
      youtubeVideoId: 'ccccccccccc',
      episodeNumber: null,
      titleFingerprint: titleFingerprint('Số 133: Silic và Boron'),
    });
    const match = findProbableDuplicate(
      { title: 'Số 133: Silic và Boron – Mắt xích vàng bị lãng quên', episodeNumber: null },
      [looser, closer],
    );
    expect(match?.id).toBe('id-2');
  });
});
