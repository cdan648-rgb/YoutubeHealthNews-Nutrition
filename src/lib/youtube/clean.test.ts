import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BOILERPLATE_MARKERS,
  MIN_USEFUL_DESCRIPTION,
  cleanDescription,
  formatDuration,
  parseChapters,
  parseIsoDuration,
} from './clean';
import { loadAllVideoFixtures, loadVideoFixture } from '../../../tests/fixtures';

describe('cleanDescription against the real channel descriptions', () => {
  it('strips the boilerplate from all six captured videos', () => {
    for (const fixture of loadAllVideoFixtures()) {
      const { clean, lowSignal } = cleanDescription(fixture.description);

      // The editorial lead survives...
      expect(clean.length).toBeGreaterThanOrEqual(MIN_USEFUL_DESCRIPTION);
      expect(lowSignal).toBe(false);
      // ...and every boilerplate marker is gone.
      for (const marker of DEFAULT_BOILERPLATE_MARKERS) {
        expect(clean).not.toContain(marker);
      }
      // Cleaning must actually remove something; these descriptions all have a block.
      expect(clean.length).toBeLessThan(fixture.description.length);
    }
  });

  it('keeps the whole editorial lead of the magnesium episode', () => {
    const { clean } = cleanDescription(loadVideoFixture('An4HFu4EwFQ').description);
    expect(clean.startsWith('Tháng 6, mùa hạ đang rực rỡ')).toBe(true);
    expect(clean).toContain('sinh học phân tử');
    expect(clean.endsWith('sự sụp đổ như thế nào.')).toBe(true);
  });

  it('preserves the numbered outline in the meniscus episode', () => {
    // This structure is why that video was chosen as a seed: the description already
    // contains the article's section list.
    const { clean } = cleanDescription(loadVideoFixture('nfNvuW2lQkI').description);
    expect(clean).toContain('1.  Cấu tạo và bản chất sinh học');
    expect(clean).toContain('4. Những triệu chứng "cảnh báo đỏ"');
  });

  it('drops the shortened social links YouTube substitutes for URLs', () => {
    const { clean } = cleanDescription(loadVideoFixture('lBKtncuS0yY').description);
    expect(clean).not.toContain('/ @bacsitranvanphucofficial');
    expect(clean).not.toContain('bs.phuc.radiologist');
  });

  it('flags low signal instead of silently returning almost nothing', () => {
    const mostlyBoilerplate = 'Ngắn.\n🎯 QUÝ KHÁN GIẢ LƯU Ý\n' + 'x'.repeat(2000);
    const { clean, lowSignal } = cleanDescription(mostlyBoilerplate);
    expect(lowSignal).toBe(true);
    // Falls back to the full text rather than handing the generator five characters.
    expect(clean.length).toBeGreaterThan(MIN_USEFUL_DESCRIPTION);
  });

  it('reports low signal for a genuinely short description', () => {
    const { clean, lowSignal } = cleanDescription('Video ngắn.');
    expect(clean).toBe('Video ngắn.');
    expect(lowSignal).toBe(true);
  });

  it('honours runtime markers from settings rather than only the defaults', () => {
    const description = `Nội dung thật ${'a'.repeat(300)}\n--- CẮT Ở ĐÂY ---\nrác`;
    const { clean } = cleanDescription(description, ['--- CẮT Ở ĐÂY ---']);
    expect(clean).not.toContain('rác');
    expect(clean).toContain('Nội dung thật');
  });

  it('is idempotent: cleaning a cleaned description changes nothing', () => {
    const once = cleanDescription(loadVideoFixture('cI74O0zS5QI').description).clean;
    expect(cleanDescription(once).clean).toBe(once);
  });
});

describe('parseChapters', () => {
  it('parses MM:SS and H:MM:SS with labels', () => {
    expect(
      parseChapters('0:00 Mở đầu\n12:30 Phần một\n1:05:00 Phần hai\nkhông phải chương'),
    ).toStrictEqual([
      { seconds: 0, label: 'Mở đầu' },
      { seconds: 750, label: 'Phần một' },
      { seconds: 3900, label: 'Phần hai' },
    ]);
  });

  it('ignores a timestamp with no label', () => {
    expect(parseChapters('12:30\n13:00 Có nhãn')).toStrictEqual([
      { seconds: 780, label: 'Có nhãn' },
    ]);
  });

  it('accepts separators and numbered prefixes the channel uses', () => {
    expect(parseChapters('1) 00:30 - Giới thiệu')).toStrictEqual([
      { seconds: 30, label: 'Giới thiệu' },
    ]);
  });

  it('de-duplicates and sorts by timestamp', () => {
    expect(parseChapters('10:00 Sau\n01:00 Trước\n10:00 Trùng')).toStrictEqual([
      { seconds: 60, label: 'Trước' },
      { seconds: 600, label: 'Sau' },
    ]);
  });

  it('returns nothing for the real descriptions, which have no chapters', () => {
    // Worth asserting: the pipeline must not depend on chapters existing.
    for (const fixture of loadAllVideoFixtures()) {
      expect(parseChapters(fixture.description)).toStrictEqual([]);
    }
  });
});

describe('parseIsoDuration', () => {
  it.each<readonly [string, number]>([
    ['PT5H28M31S', 19711],
    ['PT3H22M44S', 12164],
    ['PT2M', 120],
    ['PT45S', 45],
    ['PT1H', 3600],
  ])('%s -> %i seconds', (input, expected) => {
    expect(parseIsoDuration(input)).toBe(expected);
  });

  it('returns null rather than a misleading zero for unparseable input', () => {
    // Zero would pass a ">= 0" check and read as "a video of no length".
    for (const bad of ['', 'nonsense', 'P1D', undefined, null]) {
      expect(parseIsoDuration(bad)).toBeNull();
    }
  });

  it('matches the captured lengths of the real videos', () => {
    const fixture = loadVideoFixture('lBKtncuS0yY');
    expect(fixture.lengthSeconds).toBe(19710);
    expect(parseIsoDuration('PT5H28M30S')).toBe(19710);
  });
});

describe('formatDuration', () => {
  it.each<readonly [number | null, string]>([
    [19710, '5:28:30'],
    [12164, '3:22:44'],
    [125, '2:05'],
    [59, '0:59'],
    [null, '—'],
  ])('%o -> %s', (input, expected) => {
    expect(formatDuration(input)).toBe(expected);
  });
});
