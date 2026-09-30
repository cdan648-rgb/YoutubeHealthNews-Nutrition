/**
 * Deterministic body normalisation.
 *
 * The validation gate treats structural gaps as warnings, not blockers — but a health article
 * still reads better, and renders more safely, with its source note, its disclaimer, and (for
 * a video piece) its embed present exactly once. Rather than fail a publish over any of these,
 * the pipeline REPAIRS them here, deterministically and for free, before the gate runs:
 *
 *   - a paragraph marked `established` but carrying no citation is presented as plain prose,
 *     and a `cited` pull quote with no citation becomes a labelled paraphrase (honest forms
 *     that need no reference), so a missing ref never blocks or mis-cites;
 *   - a research article never keeps a video embed it has no video for, and never attributes a
 *     paper's finding to a "speaker" who does not exist;
 *   - the render-critical markers are guaranteed to appear exactly once, inserted in their
 *     conventional place when the model forgot them and de-duplicated when it repeated them;
 *   - a research article always carries its single-study caution callout.
 *
 * Everything here is deterministic and invents no claims — it only removes unsupported
 * citation markers, normalises attribution, and places fixed-content marker blocks.
 */
import type { Block, BodySourceKind } from './blocks';

const CAUTION_CALLOUT: Block = {
  t: 'callout',
  tone: 'caution',
  title: 'Một nghiên cứu đơn lẻ',
  text: 'Đây là kết quả của một nghiên cứu và chưa phải kết luận cuối cùng của y học. Kết quả cần được các nghiên cứu độc lập khác kiểm chứng lại trước khi trở thành cơ sở cho thực hành.',
};

/** Strip a citation marker a block cannot support, keeping the text unchanged. */
function neutraliseUnsupportedCitation(block: Block): Block {
  if (block.t === 'p' && block.attribution === 'established' && block.ref === undefined) {
    return { t: 'p', text: block.text, attribution: 'general' };
  }
  if (block.t === 'pull_quote' && block.kind === 'cited' && block.ref === undefined) {
    return { t: 'pull_quote', text: block.text, kind: 'paraphrase' };
  }
  return block;
}

/** Keep the first block of a type and drop the rest. */
function dedupeMarker(blocks: Block[], type: Block['t']): Block[] {
  let seen = false;
  return blocks.filter((block) => {
    if (block.t !== type) return true;
    if (seen) return false;
    seen = true;
    return true;
  });
}

function has(blocks: readonly Block[], type: Block['t']): boolean {
  return blocks.some((block) => block.t === type);
}

/**
 * Normalise a body so a coherent article never fails or mis-renders on structure alone.
 *
 * The result satisfies the block schemas and is safe to hand straight to the gate.
 */
export function normalizeBody(body: readonly Block[], sourceKind: BodySourceKind): Block[] {
  let blocks: Block[] = body.map(neutraliseUnsupportedCitation);

  // Research: no video, no presenter. A video embed renders nothing and a speaker attribution
  // would credit a paper's finding to someone who was never involved.
  if (sourceKind === 'research') {
    blocks = blocks.filter((block) => block.t !== 'video_embed');
    blocks = blocks.map((block) =>
      block.t === 'p' && block.attribution === 'speaker'
        ? { t: 'p', text: block.text, attribution: 'general' }
        : block,
    );
  }

  // Exactly one of each render-critical marker.
  for (const marker of ['source_note', 'disclaimer', 'video_embed'] as const) {
    blocks = dedupeMarker(blocks, marker);
  }

  // Source note near the top, so the reader sees where the piece came from first: after the
  // opening block when there is one, otherwise as the opening block.
  if (!has(blocks, 'source_note')) {
    const at = blocks.length === 0 ? 0 : 1;
    blocks = [...blocks.slice(0, at), { t: 'source_note' }, ...blocks.slice(at)];
  }

  // A YouTube article marks where its video embeds; research never does.
  if (sourceKind === 'youtube' && !has(blocks, 'video_embed')) {
    const end = blocks.length;
    const disclaimerAt = blocks.findIndex((block) => block.t === 'disclaimer');
    const insertAt = disclaimerAt === -1 ? end : disclaimerAt;
    blocks = [...blocks.slice(0, insertAt), { t: 'video_embed' }, ...blocks.slice(insertAt)];
  }

  // Research always carries the single-study caution.
  if (sourceKind === 'research' && !blocks.some((b) => b.t === 'callout' && b.tone === 'caution')) {
    const disclaimerAt = blocks.findIndex((block) => block.t === 'disclaimer');
    const insertAt = disclaimerAt === -1 ? blocks.length : disclaimerAt;
    blocks = [...blocks.slice(0, insertAt), CAUTION_CALLOUT, ...blocks.slice(insertAt)];
  }

  // Disclaimer last.
  if (!has(blocks, 'disclaimer')) {
    blocks = [...blocks, { t: 'disclaimer' }];
  }

  return blocks;
}
