/**
 * The five editorial seed articles.
 *
 * Five different real videos, five different categories, two fact-checks. Ordered as
 * they are presented: the cancer-vaccine piece leads, the magnesium piece represents the
 * channel's largest topic cluster, and the breathing piece deliberately demonstrates how
 * an unverifiable claim is handled rather than repeated.
 *
 * All five carry `automation_run_id = NULL` when inserted, so they occupy no Hanoi
 * publishing date and cannot interfere with the one-automatic-article-per-day rule.
 */
import { giaiDocThaiDoc } from './giai-doc-thai-doc';
import { kyThuatTho478 } from './ky-thuat-tho-4-7-8';
import { thieuMagie } from './thieu-magie';
import { tonThuongSunChem } from './ton-thuong-sun-chem';
import { vacXinUngThu } from './vac-xin-ung-thu';
import type { SeedArticle } from './types';

export const SEED_ARTICLES: readonly SeedArticle[] = [
  vacXinUngThu,
  thieuMagie,
  giaiDocThaiDoc,
  tonThuongSunChem,
  kyThuatTho478,
];

export type { SeedArticle } from './types';
export { heroUrl } from './types';
