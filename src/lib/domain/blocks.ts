/**
 * The article body format.
 *
 * Bodies are stored as an array of typed blocks, never as HTML or Markdown. Three
 * things follow from that choice, and they are the whole reason for it:
 *
 *   1. Validation rules can run over typed nodes. "Does every pull quote declare
 *      whether it is a paraphrase?" is a field check here; over a Markdown string
 *      it would be a regex guess.
 *   2. Rendering is XSS-free by construction. No block carries markup, so the
 *      renderer never needs `dangerouslySetInnerHTML`.
 *   3. Visuals are placed deterministically. The generator says WHERE the video
 *      embed and the key-facts panel go; it cannot forget them, because their
 *      presence is asserted.
 *
 * Zod is the single source of truth: the TypeScript types are inferred from the
 * schemas, so a schema change cannot leave the types behind.
 */
import { z } from 'zod';

/** Index into `Article.references`, used to attribute a claim to a source. */
const referenceIndex = z.number().int().nonnegative();

/**
 * Where a paragraph's content comes from. This is the load-bearing field for
 * medical honesty: `speaker` marks something the video's presenter said, which the
 * renderer surfaces as an explicit attribution ("Theo bác sĩ Phúc trong video…"),
 * while `established` requires a resolvable reference.
 */
export const attributionSchema = z.enum(['speaker', 'established', 'general']);
export type Attribution = z.infer<typeof attributionSchema>;

const headingBlock = z.object({
  t: z.literal('h2'),
  text: z.string().min(3).max(160),
});

const subheadingBlock = z.object({
  t: z.literal('h3'),
  text: z.string().min(3).max(160),
});

const paragraphBlock = z.object({
  t: z.literal('p'),
  text: z.string().min(20).max(1600),
  attribution: attributionSchema.default('general'),
  /** Required when `attribution` is 'established'; enforced in refinement below. */
  ref: referenceIndex.optional(),
});

const keyFactsBlock = z.object({
  t: z.literal('key_facts'),
  title: z.string().min(3).max(120),
  items: z.array(z.string().min(5).max(320)).min(2).max(8),
});

/**
 * A pull quote. `kind` exists because there is no transcript for the source
 * videos, so a verbatim quotation attributed to the presenter would be fabricated
 * by construction. A quote is therefore either an explicitly labelled paraphrase,
 * or a real quotation from a cited publication.
 */
const pullQuoteBlock = z.object({
  t: z.literal('pull_quote'),
  text: z.string().min(20).max(400),
  kind: z.enum(['paraphrase', 'cited']),
  ref: referenceIndex.optional(),
});

const calloutBlock = z.object({
  t: z.literal('callout'),
  tone: z.enum(['info', 'caution', 'myth']),
  title: z.string().min(3).max(120),
  text: z.string().min(20).max(900),
});

/**
 * An inline diagram. `motif` names one of our own SVG generators rather than
 * carrying image data, so no external or copyrighted asset can enter an article
 * body, and the drawing stays a rendering concern.
 */
const figureBlock = z.object({
  t: z.literal('figure_svg'),
  motif: z.enum(['molecule', 'flame', 'wave', 'shield', 'organ', 'joint', 'breath', 'lattice']),
  caption: z.string().min(5).max(300),
  alt: z.string().min(5).max(300),
});

/** Marks where the source video embed sits in the reading flow. */
const videoEmbedBlock = z.object({ t: z.literal('video_embed') });

/** Marks where the source attribution card sits. */
const sourceNoteBlock = z.object({ t: z.literal('source_note') });

/** Marks where the medical-information disclaimer sits. */
const disclaimerBlock = z.object({ t: z.literal('disclaimer') });

export const blockSchema = z.discriminatedUnion('t', [
  headingBlock,
  subheadingBlock,
  paragraphBlock,
  keyFactsBlock,
  pullQuoteBlock,
  calloutBlock,
  figureBlock,
  videoEmbedBlock,
  sourceNoteBlock,
  disclaimerBlock,
]);

export type Block = z.infer<typeof blockSchema>;
export type BlockType = Block['t'];

/** A cited source. Every reference must resolve to an allowlisted host. */
export const referenceSchema = z.object({
  /** 1-based label shown to readers; array position is what blocks point at. */
  label: z.string().min(1).max(200),
  title: z.string().min(3).max(400),
  publisher: z.string().min(2).max(200),
  url: z.string().url(),
  /** ISO date if the source is dated; many authoritative pages are not. */
  published: z.string().optional(),
});

export type Reference = z.infer<typeof referenceSchema>;

export const bodySchema = z.array(blockSchema).min(6);

/**
 * Structural rules every article body must satisfy. Kept separate from the per-block
 * schemas so the reasons are inspectable and so each can be reported individually
 * rather than as one opaque failure.
 */
export type BodyStructureIssue = {
  readonly code: string;
  readonly message: string;
};

/**
 * Which kind of source the body was written from.
 *
 * Most rules are shared, but three are genuinely source-specific rather than
 * configurable strictness:
 *
 *   A YouTube article MUST embed the video and MUST distinguish what the presenter said
 *   from what is established, because those are the two things a reader needs in order to
 *   judge it.
 *
 *   A research article MUST NOT embed a video, because there is none — a `video_embed`
 *   block would render nothing, and its presence means the generator was confused about
 *   what it was writing. It must also carry the single-study caveat, and it must not
 *   attribute anything to a "speaker", because a paper has authors, not a presenter.
 */
export type BodySourceKind = 'youtube' | 'research';

export function checkBodyStructure(
  blocks: readonly Block[],
  references: readonly Reference[],
  sourceKind: BodySourceKind = 'youtube',
): BodyStructureIssue[] {
  const issues: BodyStructureIssue[] = [];
  const count = (type: BlockType) => blocks.filter((block) => block.t === type).length;

  if (count('h2') < 4) {
    issues.push({
      code: 'too_few_sections',
      message: `article needs at least 4 h2 sections, found ${count('h2')}`,
    });
  }
  if (count('key_facts') < 1) {
    issues.push({ code: 'missing_key_facts', message: 'article needs a key-facts panel' });
  }
  const required =
    sourceKind === 'youtube'
      ? (['video_embed', 'source_note', 'disclaimer'] as const)
      : (['source_note', 'disclaimer'] as const);

  for (const marker of required) {
    if (count(marker) !== 1) {
      issues.push({
        code: `missing_${marker}`,
        message: `article needs exactly one ${marker} block, found ${count(marker)}`,
      });
    }
  }

  if (sourceKind === 'research' && count('video_embed') > 0) {
    issues.push({
      code: 'unexpected_video_embed',
      message: 'a research article has no source video, so a video_embed block cannot render',
    });
  }

  // The single-study caveat. Required as a caution callout rather than trusted to the
  // prose, because "one study is not a conclusion" is the single most important thing a
  // reader of a research piece needs to be told, and a rule that is checked is the only
  // kind that survives a bad generation.
  if (
    sourceKind === 'research' &&
    !blocks.some((block) => block.t === 'callout' && block.tone === 'caution')
  ) {
    issues.push({
      code: 'missing_study_caveat',
      message: 'a research article needs a caution callout explaining what one study can establish',
    });
  }

  // Every reference pointer must resolve. A dangling index would render as a
  // citation the reader cannot follow, which is worse than no citation at all.
  blocks.forEach((block, index) => {
    const ref = 'ref' in block ? block.ref : undefined;
    if (ref !== undefined && ref >= references.length) {
      issues.push({
        code: 'dangling_reference',
        message: `block ${index} cites reference ${ref}, but only ${references.length} exist`,
      });
    }
  });

  // A claim presented as established fact must say where it comes from.
  blocks.forEach((block, index) => {
    if (block.t === 'p' && block.attribution === 'established' && block.ref === undefined) {
      issues.push({
        code: 'unsourced_established_claim',
        message: `paragraph ${index} is presented as established fact but cites no reference`,
      });
    }
  });

  // A quotation must either be labelled a paraphrase or point at a publication we
  // can actually quote. See the note on pullQuoteBlock.
  blocks.forEach((block, index) => {
    if (block.t === 'pull_quote' && block.kind === 'cited' && block.ref === undefined) {
      issues.push({
        code: 'uncited_quotation',
        message: `pull quote ${index} claims to be a citation but points at no reference`,
      });
    }
  });

  const speakerParagraphs = blocks.filter(
    (block) => block.t === 'p' && block.attribution === 'speaker',
  ).length;

  if (sourceKind === 'youtube' && speakerParagraphs === 0) {
    issues.push({
      code: 'no_speaker_attribution',
      message: 'article never distinguishes what the video says from established information',
    });
  }

  // "Theo video" on a research article would attribute a paper's finding to a presenter
  // who was never involved in it.
  if (sourceKind === 'research' && speakerParagraphs > 0) {
    issues.push({
      code: 'speaker_attribution_without_speaker',
      message: `a research article has no presenter, but ${speakerParagraphs} paragraph(s) are attributed to one`,
    });
  }

  return issues;
}

/** Plain-text projection, used for word counts, search and copy-overlap checks. */
export function blocksToPlainText(blocks: readonly Block[]): string {
  const parts: string[] = [];
  for (const block of blocks) {
    switch (block.t) {
      case 'h2':
      case 'h3':
      case 'p':
        parts.push(block.text);
        break;
      case 'pull_quote':
        parts.push(block.text);
        break;
      case 'key_facts':
        parts.push(block.title, ...block.items);
        break;
      case 'callout':
        parts.push(block.title, block.text);
        break;
      case 'figure_svg':
        parts.push(block.caption);
        break;
      case 'video_embed':
      case 'source_note':
      case 'disclaimer':
        break;
    }
  }
  return parts.join('\n\n');
}

/**
 * Word count over the plain-text projection.
 *
 * Vietnamese is written with spaces between syllables rather than words, so this
 * counts syllables and reads high compared with English. The 700–1,400 band used by
 * the validation gate is calibrated to that, not to English prose.
 */
export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed === '' ? 0 : trimmed.split(/\s+/).length;
}
