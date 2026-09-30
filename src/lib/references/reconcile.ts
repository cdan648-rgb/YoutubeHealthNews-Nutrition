/**
 * Deterministic reference reconciliation.
 *
 * The reference contract is a cross-array invariant the structured-output layer cannot
 * express: a body block may carry `ref: N`, a ZERO-BASED index into the `references` array,
 * and every such N must satisfy `N < references.length`. Nothing in the JSON Schema or the
 * Zod schema ties the two arrays together, so a model can — and on 2026-09-30 did — emit
 * `attribution:"established"` paragraphs with `ref:0` and `ref:1` while returning
 * `references: []`. The gate catches that (hard `dangling_reference`), but catching it only
 * routes a whole article to human review over a citation the model invented.
 *
 * This step closes the contract deterministically, BEFORE the gate and again after any model
 * repair, so a dangling citation is resolved rather than merely reported. It invents nothing:
 *
 *   1. If every `ref` already resolves against the draft's own references, it is a no-op — a
 *      well-formed draft is never disturbed.
 *   2. If citations dangle only because the model dropped the references array entirely
 *      (`references: []`) while a verified pool exists, the verified pool is adopted. The pool
 *      is the exact ordered list of sources the writing stage was handed, so index N in the
 *      body already means pool[N] — populating from it makes the model's own indices resolve.
 *   3. Any `ref` that still points past the end of the reference list has NO verified source
 *      behind it, so its citation marker is stripped: an `established` paragraph becomes plain
 *      prose (`general`, no ref) and a `cited` pull quote becomes a labelled `paraphrase`.
 *
 * What it never does is fabricate a URL, a publisher or a title. A citation with no real
 * source behind it is removed, not invented — a made-up medical reference is the one outcome
 * worse than no reference at all.
 */
import type { Block, Reference } from '@/lib/domain/blocks';

export type ReconcileResult = {
  readonly body: Block[];
  readonly references: Reference[];
  /** True when reconciliation altered the body or the references array. */
  readonly changed: boolean;
};

/** The `ref` a block carries, or undefined for a block that cannot carry one. */
function refOf(block: Block): number | undefined {
  if (block.t === 'p' || block.t === 'pull_quote') return block.ref;
  return undefined;
}

/**
 * Remove a block's citation marker without changing what it says.
 *
 * An `established` paragraph is presented as ordinary prose rather than re-attributed to a
 * speaker the article may not have; a `cited` pull quote becomes an explicitly labelled
 * paraphrase, which is the only honest form for a quote with no citation behind it.
 */
function stripCitation(block: Block): Block {
  if (block.t === 'p') {
    return {
      t: 'p',
      text: block.text,
      attribution: block.attribution === 'established' ? 'general' : block.attribution,
    };
  }
  if (block.t === 'pull_quote') {
    return { t: 'pull_quote', text: block.text, kind: 'paraphrase' };
  }
  return block;
}

/**
 * Reconcile a draft's body citations against its references.
 *
 * `pool` is the ordered list of verified, allowlisted, reachable sources the writing stage was
 * given — youtube: the citable claims in prompt order; research: the paper followed by the
 * citable claims. Its order is the index space the body's `ref` values were defined in, which
 * is what makes adopting it (case 2) a correct remap rather than a guess.
 */
export function reconcileReferences(
  body: readonly Block[],
  references: readonly Reference[],
  pool: readonly Reference[],
): ReconcileResult {
  const dangles = body.some((block) => {
    const ref = refOf(block);
    return ref !== undefined && ref >= references.length;
  });

  // A draft whose every citation already resolves is left exactly as it is.
  if (!dangles) {
    return { body: [...body], references: [...references], changed: false };
  }

  // The model emitted citation markers but no references array, and a verified pool exists:
  // adopt it. The pool's order IS the index space the body cited into, so the model's own
  // `ref` values now resolve to the source the writing stage assigned to that index.
  const adoptedPool = references.length === 0 && pool.length > 0;
  const finalReferences: Reference[] = adoptedPool ? pool.map(withPositionLabel) : [...references];

  // Strip any citation still pointing past the end: it has no verified source behind it.
  let bodyChanged = false;
  const newBody = body.map((block) => {
    const ref = refOf(block);
    if (ref === undefined || ref < finalReferences.length) return block;
    bodyChanged = true;
    return stripCitation(block);
  });

  return { body: newBody, references: finalReferences, changed: adoptedPool || bodyChanged };
}

/** Keep the reader-facing label in step with the array position it now occupies. */
function withPositionLabel(reference: Reference, index: number): Reference {
  return { ...reference, label: String(index + 1) };
}
