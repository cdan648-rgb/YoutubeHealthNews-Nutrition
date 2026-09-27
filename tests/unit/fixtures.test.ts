/**
 * Guards the fixtures themselves.
 *
 * These assertions are not busywork: they pin the properties of the real channel
 * that the whole architecture is built around. If a fixture is ever replaced with
 * something tidier or invented, these fail — which is the point, because several
 * design decisions only make sense in light of how awkward the real data is.
 */
import { describe, expect, it } from 'vitest';
import { hanoiHour } from '@/lib/time';
import {
  VIDEO_FIXTURE_IDS,
  listFixtureFiles,
  loadAllVideoFixtures,
  loadUploadsFixture,
  loadVideoFixture,
} from '../fixtures';

describe('video fixtures are the real thing', () => {
  it('every declared id has a file, and there are no orphan files', () => {
    const files = listFixtureFiles();
    for (const id of VIDEO_FIXTURE_IDS) expect(files).toContain(`${id}.json`);
    expect(files.length).toBe(VIDEO_FIXTURE_IDS.length + 1); // + uploads-playlist.json
  });

  it('all six come from the one channel under study', () => {
    for (const fixture of loadAllVideoFixtures()) {
      expect(fixture.channelId).toBe('UC79E6KatRfXbmdWVWGncsew');
      expect(fixture.channelTitle).toBe('Bác sĩ Trần Văn Phúc Official');
    }
  });

  it('every fixture records that it was captured rather than authored', () => {
    for (const fixture of loadAllVideoFixtures()) {
      expect(fixture._source).toMatch(/real data, not fabricated/);
    }
  });

  it('video ids match YouTube’s 11-character format, as the DB CHECK requires', () => {
    for (const fixture of loadAllVideoFixtures()) {
      expect(fixture.videoId).toMatch(/^[A-Za-z0-9_-]{11}$/);
    }
  });
});

describe('the properties that shaped the architecture', () => {
  const fixtures = loadAllVideoFixtures();

  it('episodes are hours long, which is why transcripts were never the plan', () => {
    for (const fixture of fixtures) {
      expect(fixture.lengthSeconds).toBeGreaterThan(2 * 3600);
      expect(fixture.lengthSeconds).toBeLessThan(6 * 3600);
    }
  });

  it('only auto-generated Vietnamese captions exist, on every single video', () => {
    // No human captions anywhere: a verbatim quotation attributed to the presenter
    // would therefore be fabricated, which is why the block schema forbids one.
    for (const fixture of fixtures) {
      expect(fixture.captionTracks).toHaveLength(1);
      expect(fixture.captionTracks[0]).toMatchObject({ languageCode: 'vi', kind: 'asr' });
    }
  });

  it('descriptions are substantial enough to carry an article', () => {
    for (const fixture of fixtures) {
      expect(fixture.description.length).toBeGreaterThan(1300);
    }
  });

  it('every description carries the channel boilerplate the cleaner must strip', () => {
    for (const fixture of fixtures) {
      expect(fixture.description).toContain('QUÝ KHÁN GIẢ LƯU Ý');
    }
  });

  it('the channel asserts sole-official status and asks not to be re-uploaded', () => {
    // Both facts drive the independence labelling and the no-re-hosting image policy.
    const withCopyright = fixtures.filter((f) => f.description.includes('Bản quyền'));
    expect(withCopyright.length).toBeGreaterThanOrEqual(4);
    const soleOfficial = fixtures.filter((f) => f.description.includes('là duy nhất'));
    expect(soleOfficial.length).toBeGreaterThanOrEqual(5);
  });

  it('uploads land around 09:00 Hanoi, which is why the publish hour is 11', () => {
    // publishDate comes back with a -07:00 offset; 19:00 PT is 09:00 next day Hanoi.
    // Uses the shared helper rather than its own formatter, so this assertion also
    // exercises the one sanctioned timezone conversion.
    for (const fixture of fixtures) {
      expect(hanoiHour(new Date(fixture.publishDate))).toBe(9);
    }
  });
});

describe('uploads playlist fixture', () => {
  const uploads = loadUploadsFixture();

  it('captures 100 real videos from the uploads playlist', () => {
    expect(uploads.uploadsPlaylistId).toBe('UU79E6KatRfXbmdWVWGncsew');
    expect(uploads.items).toHaveLength(100);
    expect(uploads.capturedCount).toBe(100);
    expect(new Set(uploads.items.map((item) => item.videoId)).size).toBe(100);
  });

  it('contains the "coming soon" placeholder the eligibility filter must reject', () => {
    const placeholder = uploads.items.find((item) => item.videoId === 'ilVWYjEcr5c');
    expect(placeholder?.title).toContain('coming soon');
  });

  it('contains all six fully captured videos', () => {
    const ids = new Set(uploads.items.map((item) => item.videoId));
    for (const id of VIDEO_FIXTURE_IDS) expect(ids.has(id)).toBe(true);
  });

  it('the seed candidates are five DIFFERENT videos in five different topics', () => {
    const seeds = ['lBKtncuS0yY', 'An4HFu4EwFQ', 'cI74O0zS5QI', 'nfNvuW2lQkI', 'hkP4Heyobuc'];
    expect(new Set(seeds).size).toBe(5);
    for (const id of seeds) expect(() => loadVideoFixture(id as never)).not.toThrow();
  });
});
