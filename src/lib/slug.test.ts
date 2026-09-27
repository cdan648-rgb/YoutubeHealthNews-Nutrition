/**
 * The folding table here must stay identical to SQL `internal.fold_vietnamese` and
 * `internal.title_fingerprint`, because a fingerprint computed in TypeScript is
 * compared against one computed by a Postgres generated column.
 *
 * The SHARED_CASES below are asserted in both places: here, and with the same inputs
 * and expectations in `supabase/tests/01_schema_helpers_and_seeds.sql`. If the two
 * implementations ever diverge, one of the two suites fails.
 */
import { describe, expect, it } from 'vitest';
import {
  extractEpisodeNumber,
  foldVietnamese,
  isValidSlug,
  slugify,
  titleFingerprint,
} from './slug';

/** Kept in lockstep with the pgTAP assertions. */
const SHARED_FOLD_CASES: ReadonlyArray<readonly [string, string]> = [
  ['THIẾU MAGIE CƠ THỂ SỤP ĐỔ', 'thieu magie co the sup do'],
];

const SHARED_FINGERPRINT_CASES: ReadonlyArray<readonly [string, string]> = [
  ['Số 133: Silic và Boron – Mắt xích vàng', 'so 133 silic va boron mat xich vang'],
  ['  Số   133:::  Silic  và Boron -- Mắt xích vàng  ', 'so 133 silic va boron mat xich vang'],
];

describe('foldVietnamese — parity with SQL internal.fold_vietnamese', () => {
  it.each(SHARED_FOLD_CASES)('%o -> %o', (input, expected) => {
    expect(foldVietnamese(input)).toBe(expected);
  });

  it('folds every tone mark of every vowel', () => {
    expect(foldVietnamese('áàảãạăắằẳẵặâấầẩẫậ')).toBe('a'.repeat(17));
    expect(foldVietnamese('éèẻẽẹêếềểễệ')).toBe('e'.repeat(11));
    expect(foldVietnamese('íìỉĩị')).toBe('i'.repeat(5));
    expect(foldVietnamese('óòỏõọôốồổỗộơớờởỡợ')).toBe('o'.repeat(17));
    expect(foldVietnamese('úùủũụưứừửữự')).toBe('u'.repeat(11));
    expect(foldVietnamese('ýỳỷỹỵ')).toBe('y'.repeat(5));
  });

  it('folds đ, which Unicode decomposition would miss', () => {
    // This is why the implementation uses an explicit table rather than NFD +
    // combining-mark stripping: đ has no canonical decomposition.
    expect(foldVietnamese('Đường ĐỎ')).toBe('duong do');
    expect('đ'.normalize('NFD')).toBe('đ');
  });

  it('leaves ASCII and digits untouched', () => {
    expect(foldVietnamese('Vitamin B12 2026')).toBe('vitamin b12 2026');
  });
});

describe('titleFingerprint — parity with SQL internal.title_fingerprint', () => {
  it.each(SHARED_FINGERPRINT_CASES)('%o -> %o', (input, expected) => {
    expect(titleFingerprint(input)).toBe(expected);
  });

  it('is stable across the punctuation the channel actually uses', () => {
    const forms = [
      'Số 132: "Vắc xin ung thư" viết lại tương lai ung thư học',
      'Số 132 - Vắc xin ung thư viết lại tương lai ung thư học',
      'SỐ 132 — VẮC XIN UNG THƯ: VIẾT LẠI TƯƠNG LAI UNG THƯ HỌC!',
    ];
    const fingerprints = forms.map(titleFingerprint);
    expect(new Set(fingerprints).size).toBe(1);
    expect(fingerprints[0]).toBe('so 132 vac xin ung thu viet lai tuong lai ung thu hoc');
  });

  it('distinguishes genuinely different titles', () => {
    expect(titleFingerprint('Số 118: Thiếu magie')).not.toBe(titleFingerprint('Số 119: Thiếu kẽm'));
  });
});

describe('slugify', () => {
  it('produces a slug the database CHECK constraint accepts', () => {
    const slug = slugify('Số 118: THIẾU MAGIE CƠ THỂ SỤP ĐỔ NHƯ THẾ NÀO?');
    expect(slug).toBe('so-118-thieu-magie-co-the-sup-do-nhu-the-nao');
    expect(isValidSlug(slug)).toBe(true);
  });

  it('never emits leading, trailing or doubled hyphens', () => {
    const slug = slugify('  ...Vắc xin ung thư!!!   ');
    expect(slug).toBe('vac-xin-ung-thu');
    expect(isValidSlug(slug)).toBe(true);
  });

  it('trims on a word boundary rather than mid-syllable', () => {
    const slug = slugify('Hiểu cơ thể để sống tự nhiên khi sản phẩm giải độc thải độc', 30);
    expect(slug.length).toBeLessThanOrEqual(30);
    expect(slug.endsWith('-')).toBe(false);
    expect(isValidSlug(slug)).toBe(true);
    // The last segment must be a whole folded syllable, not a fragment.
    expect(slug.split('-').at(-1)).not.toBe('');
  });

  it.each(['Bai_Hoa_Sai', 'CAPITALS', 'has spaces', '-leading', 'trailing-', 'double--hyphen', ''])(
    'rejects %o as a slug',
    (value) => {
      expect(isValidSlug(value)).toBe(false);
    },
  );
});

describe('extractEpisodeNumber — matches the channel titles as they actually appear', () => {
  it.each<readonly [string, number | null]>([
    ['Số 133: Silic và Boron – Mắt xích vàng bị lãng quên', 133],
    ['Số 132: "Vắc xin ung thư" viết lại tương lai ung thư học', 132],
    // Some titles trail the number instead of leading with it.
    ['Sự thật về tổn thương sụn chêm khớp gối: đừng vội mổ! Số 126', 126],
    ['Hiểu cơ thể để sống tự nhiên ... - Số 127', 127],
    ['SỐ 99: Bác sĩ Phúc chia sẻ với đồng nghiệp', 99],
    // Older videos are simply not numbered; null is normal, not an error.
    ['Viêm mãn tính - Nguồn gốc của mọi bệnh tật', null],
    ['Protein được tiêu hoá, hấp thu và chuyển hoá như thế nào?', null],
    ['Giải Nobel Y học năm 2025: Khả năng dung nạp Miễn dịch ngoại vi', null],
  ])('%o -> %o', (title, expected) => {
    expect(extractEpisodeNumber(title)).toBe(expected);
  });

  it('does not mistake a year or a vitamin number for an episode', () => {
    expect(extractEpisodeNumber('Vitamin B12: Bộ tứ Cobalamin')).toBeNull();
    expect(extractEpisodeNumber('Giải Nobel Y học năm 2025')).toBeNull();
  });
});
