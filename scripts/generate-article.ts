#!/usr/bin/env tsx
/**
 * Generate one article from a video, without publishing anything.
 *
 *   npm run generate -- --video=An4HFu4EwFQ          # from a checked-in fixture, mocked
 *   npm run generate -- --video=An4HFu4EwFQ --live   # REAL OpenRouter call, spends credit
 *   npm run generate -- --video=An4HFu4EwFQ --live --json
 *
 * Default is the mocked path, so running this by accident costs nothing. `--live` is the
 * only way to reach the real API and it says so before it starts. This is the "clearly
 * separated manual integration test" — it is never part of `npm test`.
 *
 * Nothing is written to the database in either mode. The point is to read the output and
 * the validation report, which is how the gate's thresholds were calibrated.
 */
import process from 'node:process';
import {
  generateArticle,
  totalCost,
  type PipelineDeps,
  type PipelineSource,
} from '../src/lib/ai/pipeline';
import { cleanDescription } from '../src/lib/youtube/clean';
import { loadVideoFixture, VIDEO_FIXTURE_IDS, type VideoFixtureId } from '../tests/fixtures';
import { blocksToPlainText, countWords } from '../src/lib/domain/blocks';

function flag(name: string): string | undefined {
  const match = process.argv.find((arg) => arg === `--${name}` || arg.startsWith(`--${name}=`));
  if (match === undefined) return undefined;
  return match.includes('=') ? match.split('=')[1] : '';
}

const videoId = flag('video') ?? 'An4HFu4EwFQ';
const live = flag('live') !== undefined;
const asJson = flag('json') !== undefined;

if (!(VIDEO_FIXTURE_IDS as readonly string[]).includes(videoId)) {
  console.error(`Unknown fixture "${videoId}". Available: ${VIDEO_FIXTURE_IDS.join(', ')}`);
  process.exit(1);
}

const CATEGORIES = [
  {
    slug: 'vi-chat-vitamin',
    name: 'Vi chất & Vitamin',
    description: 'Vitamin, khoáng chất và vi chất.',
  },
  {
    slug: 'dinh-duong-chuyen-hoa',
    name: 'Dinh dưỡng & Chuyển hoá',
    description: 'Thức ăn và chuyển hoá.',
  },
  { slug: 'noi-tiet-hormone', name: 'Nội tiết & Hormone', description: 'Hormone và hệ nội tiết.' },
  {
    slug: 'mien-dich-nhiem-trung-ung-thu',
    name: 'Miễn dịch, Nhiễm trùng & Ung thư',
    description: 'Miễn dịch, nhiễm trùng, ung thư.',
  },
  { slug: 'tieu-hoa-gan-than', name: 'Tiêu hoá, Gan & Thận', description: 'Tiêu hoá, gan, thận.' },
  {
    slug: 'co-xuong-khop-van-dong',
    name: 'Cơ xương khớp & Vận động',
    description: 'Khớp, cơ, xương, vận động.',
  },
  {
    slug: 'phong-ngua-tam-than',
    name: 'Phòng ngừa & Tâm–Thân',
    description: 'Phòng ngừa, hơi thở, giấc ngủ.',
  },
];

const ALLOWED_HOSTS = [
  'who.int',
  'nih.gov',
  'ods.od.nih.gov',
  'nccih.nih.gov',
  'ncbi.nlm.nih.gov',
  'pubmed.ncbi.nlm.nih.gov',
  'medlineplus.gov',
  'europepmc.org',
  'cdc.gov',
  'cochranelibrary.com',
  'doi.org',
];

const fixture = loadVideoFixture(videoId as VideoFixtureId);
const { clean } = cleanDescription(fixture.description);

const source: PipelineSource = {
  kind: 'youtube',
  title: fixture.title,
  sourceText: clean,
  keywords: fixture.keywords,
  durationSeconds: fixture.lengthSeconds,
  publishedAt: fixture.publishDate,
  channelTitle: fixture.channelTitle,
};

/**
 * Reference verification.
 *
 * Live mode does real checks so the 403-versus-404 distinction is exercised; mocked mode
 * assumes everything resolves, because the point there is the prose and the gate.
 */
async function verifyRefs(urls: readonly string[]) {
  if (!live) {
    return { checks: [], reachable: [...urls], unverifiable: [], unreachable: [] };
  }
  const { verifyReferences } = await import('../src/lib/references/verify');
  return verifyReferences(urls);
}

const deps: PipelineDeps = {
  categories: CATEGORIES,
  allowedReferenceHosts: ALLOWED_HOSTS,
  restrictedTopics: [],
  // Off here so the report shows what the gate alone decided, not the approval policy.
  requireApproval: false,
  verifyReferences: verifyRefs,
};

if (!live) {
  console.error(
    'Running in MOCKED mode: no API call, no credit spent.\n' +
      'Pass --live for a real OpenRouter call (needs OPENROUTER_API_KEY).\n',
  );
  console.error('Source material the generator would receive:\n');
  console.error(`TITLE: ${fixture.title}`);
  console.error(`CLEANED DESCRIPTION (${clean.length} chars):\n${clean}\n`);
  console.error(`KEYWORDS: ${fixture.keywords.slice(0, 10).join(', ')}`);
  console.error(`DURATION: ${Math.round(fixture.lengthSeconds / 60)} min`);
  console.error('\nNothing further to do without --live.');
  process.exit(0);
}

console.error(`LIVE mode: calling OpenRouter for ${videoId}. This spends credit.\n`);

const outcome = await generateArticle(source, deps);

if (asJson) {
  console.log(JSON.stringify(outcome, null, 2));
  process.exit(outcome.decision === 'failed' ? 1 : 0);
}

if (outcome.decision === 'failed') {
  console.error(`FAILED (${outcome.code}, retryable=${outcome.retryable})`);
  console.error(outcome.message);
  console.error(`\nStages completed: ${Object.keys(outcome.artifacts).join(', ') || '(none)'}`);
  console.error(`Spend: $${totalCost(outcome.usage).toFixed(6)}`);
  process.exit(1);
}

const { draft, seo, report } = outcome;
const words = countWords(blocksToPlainText(draft.body));

console.log(
  `DECISION: ${outcome.decision}${outcome.reason === undefined ? '' : ` (${outcome.reason})`}`,
);
console.log(`\nTITLE: ${draft.title}`);
console.log(`SLUG:  ${draft.slug}`);
console.log(`CATEGORY: ${draft.categorySlug}${draft.isFactCheck ? ' [fact-check]' : ''}`);
console.log(`DEK:   ${draft.dek}`);
console.log(
  `\nWORDS: ${words}  SECTIONS: ${report.stats.sections}  REFS: ${report.stats.references}  NUMBERS: ${report.stats.numericClaims}`,
);
console.log(`SPEAKER-ATTRIBUTED PARAGRAPHS: ${report.stats.speakerParagraphs}`);

console.log('\nREFERENCES:');
for (const [index, reference] of draft.references.entries()) {
  console.log(`  [${index}] ${reference.publisher} — ${reference.url}`);
}

console.log('\nVALIDATION:');
if (report.issues.length === 0) {
  console.log('  clean');
} else {
  for (const issue of report.issues) {
    console.log(
      `  ${issue.severity.toUpperCase().padEnd(4)} ${issue.code}: ${issue.message}${issue.detail === undefined ? '' : ` — ${issue.detail}`}`,
    );
  }
}

console.log('\nSEO:');
console.log(`  ${seo.metaTitle}`);
console.log(`  ${seo.metaDescription}`);

console.log(
  `\nSPEND: $${totalCost(outcome.usage).toFixed(6)} across ${outcome.usage.length} calls`,
);
console.log('\nBODY:\n');
console.log(blocksToPlainText(draft.body));
