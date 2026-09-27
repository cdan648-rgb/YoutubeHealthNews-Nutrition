import type { Block, Reference } from '@/lib/domain/blocks';
import type { SourceVideo } from '@/lib/domain/types';
import { MEDICAL_DISCLAIMER, SOURCE_CHANNEL } from '@/lib/site';
import { CategorySvg, type Motif } from '@/components/visual/CategorySvg';
import { VideoEmbedFacade } from './VideoEmbedFacade';

/**
 * Renders a validated block array.
 *
 * No block carries markup, so nothing here needs `dangerouslySetInnerHTML` — text
 * goes through React's escaping like any other string. That is the practical payoff of
 * storing bodies as typed blocks rather than as HTML.
 *
 * The three structural markers (`source_note`, `video_embed`, `disclaimer`) render
 * fixed components rather than model-supplied content, so their wording is ours and
 * identical on every article.
 */

type Props = {
  readonly blocks: readonly Block[];
  readonly references: readonly Reference[];
  readonly sourceVideo: SourceVideo | null;
};

function ReferenceMark({ index, reference }: { index: number; reference: Reference | undefined }) {
  if (reference === undefined) return null;
  return (
    <sup className="ml-0.5">
      <a
        href={`#ref-${index + 1}`}
        className="text-accent-ink no-underline hover:underline"
        aria-label={`Xem nguồn ${index + 1}: ${reference.publisher}`}
      >
        [{index + 1}]
      </a>
    </sup>
  );
}

/**
 * A paragraph whose claim is attributed to the video's presenter.
 *
 * Rendered with a visible marker rather than as plain prose, because the reader needs
 * to be able to tell at a glance which statements are the presenter's and which are
 * independently sourced. This is the visual half of the `attribution` field.
 */
function SpeakerParagraph({ text }: { text: string }) {
  return (
    <p className="border-accent/40 bg-accent-wash/40 my-5 border-l-2 py-1 pl-4">
      <span className="text-accent-ink mr-1.5 text-xs font-semibold tracking-wide uppercase">
        Theo video
      </span>
      <span>{text}</span>
    </p>
  );
}

function KeyFactsPanel({ title, items }: { title: string; items: readonly string[] }) {
  return (
    <aside className="border-accent/30 bg-accent-wash/60 my-8 rounded-lg border p-5">
      <h2 className="font-display text-accent-ink text-sm font-bold tracking-wide uppercase">
        {title}
      </h2>
      <ul className="mt-3 space-y-2">
        {items.map((item, index) => (
          <li key={index} className="flex gap-2.5 text-[15px] leading-relaxed">
            <span className="bg-accent mt-2 size-1.5 shrink-0 rounded-full" aria-hidden="true" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </aside>
  );
}

const CALLOUT_STYLES = {
  info: { border: 'border-accent/30', bg: 'bg-accent-wash/50', label: 'Ghi chú' },
  caution: { border: 'border-fact/40', bg: 'bg-fact/5', label: 'Cần thận trọng' },
  myth: { border: 'border-fact/40', bg: 'bg-fact/5', label: 'Kiểm chứng' },
} as const;

function Callout({
  tone,
  title,
  text,
}: {
  tone: 'info' | 'caution' | 'myth';
  title: string;
  text: string;
}) {
  const style = CALLOUT_STYLES[tone];
  return (
    <aside className={`my-8 rounded-lg border ${style.border} ${style.bg} p-5`}>
      <p
        className={`font-display text-xs font-bold tracking-wider uppercase ${
          tone === 'info' ? 'text-accent-ink' : 'text-fact'
        }`}
      >
        {style.label}
      </p>
      <h2 className="font-display mt-1 text-base font-semibold">{title}</h2>
      <p className="mt-2 text-[15px] leading-relaxed">{text}</p>
    </aside>
  );
}

/**
 * A pull quote.
 *
 * The `kind` is surfaced to the reader, not just validated. A paraphrase is labelled
 * "Diễn giải" so it can never be mistaken for a verbatim quotation — which matters
 * because the source videos have no transcript, so we are never in a position to quote
 * the presenter directly.
 */
function PullQuote({
  text,
  kind,
  reference,
  refIndex,
}: {
  text: string;
  kind: 'paraphrase' | 'cited';
  reference: Reference | undefined;
  refIndex: number | undefined;
}) {
  return (
    <figure className="border-accent my-10 border-l-4 pl-5">
      <blockquote className="font-display text-xl leading-snug font-semibold tracking-tight sm:text-2xl">
        {text}
      </blockquote>
      <figcaption className="text-ink-3 mt-2 text-xs">
        {kind === 'paraphrase' ? (
          <>Diễn giải nội dung video — không phải lời dẫn nguyên văn</>
        ) : (
          <>
            Trích từ {reference?.publisher ?? 'nguồn đã dẫn'}
            {refIndex !== undefined && <ReferenceMark index={refIndex} reference={reference} />}
          </>
        )}
      </figcaption>
    </figure>
  );
}

function SourceNote({ video }: { video: SourceVideo | null }) {
  if (video === null) return null;
  return (
    <aside className="border-rule bg-surface my-8 rounded-lg border p-5">
      <p className="font-display text-ink-3 text-xs font-semibold tracking-wider uppercase">
        Nguồn của bài viết này
      </p>
      <p className="mt-2 text-[15px] leading-relaxed">
        Bài viết được tổng hợp từ phần mô tả công khai của video{' '}
        <a
          href={video.url}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className="text-accent-ink font-medium underline underline-offset-2"
        >
          “{video.title}”
        </a>{' '}
        trên kênh {video.channelTitle}. Chúng tôi không có bản ghi lời nói của video, vì vậy mọi nội
        dung đều được diễn giải lại, không trích nguyên văn.
      </p>
    </aside>
  );
}

function Disclaimer() {
  return (
    <aside className="border-fact/40 bg-fact/5 my-8 rounded-lg border p-5" role="note">
      <h2 className="font-display text-fact text-sm font-bold tracking-wide uppercase">
        {MEDICAL_DISCLAIMER.title}
      </h2>
      <p className="mt-2 text-[15px] leading-relaxed">{MEDICAL_DISCLAIMER.body}</p>
    </aside>
  );
}

function Figure({ motif, caption, alt }: { motif: Motif; caption: string; alt: string }) {
  return (
    <figure className="my-8">
      <div className="bg-accent-wash text-accent aspect-[16/7] overflow-hidden rounded-lg">
        <CategorySvg motif={motif} seed={caption} className="size-full" title={alt} />
      </div>
      <figcaption className="text-ink-3 mt-2 text-xs leading-snug">{caption}</figcaption>
    </figure>
  );
}

export function ArticleBody({ blocks, references, sourceVideo }: Props) {
  return (
    <div className="text-[17px] leading-[1.75] sm:text-[18px]">
      {blocks.map((block, index) => {
        switch (block.t) {
          case 'h2':
            return (
              <h2
                key={index}
                className="font-display mt-10 mb-3 text-xl font-bold tracking-tight sm:text-2xl"
              >
                {block.text}
              </h2>
            );
          case 'h3':
            return (
              <h3 key={index} className="font-display mt-7 mb-2 text-lg font-semibold">
                {block.text}
              </h3>
            );
          case 'p':
            if (block.attribution === 'speaker') {
              return <SpeakerParagraph key={index} text={block.text} />;
            }
            return (
              <p key={index} className="my-5">
                {block.text}
                {block.ref !== undefined && (
                  <ReferenceMark index={block.ref} reference={references[block.ref]} />
                )}
              </p>
            );
          case 'key_facts':
            return <KeyFactsPanel key={index} title={block.title} items={block.items} />;
          case 'callout':
            return <Callout key={index} tone={block.tone} title={block.title} text={block.text} />;
          case 'pull_quote':
            return (
              <PullQuote
                key={index}
                text={block.text}
                kind={block.kind}
                refIndex={block.ref}
                reference={block.ref === undefined ? undefined : references[block.ref]}
              />
            );
          case 'figure_svg':
            return (
              <Figure key={index} motif={block.motif} caption={block.caption} alt={block.alt} />
            );
          case 'video_embed':
            return sourceVideo === null ? null : (
              <div key={index} className="my-8">
                <VideoEmbedFacade videoId={sourceVideo.youtubeVideoId} title={sourceVideo.title} />
                <p className="text-ink-3 mt-2 text-xs">
                  Video gốc trên YouTube · {SOURCE_CHANNEL.title}
                </p>
              </div>
            );
          case 'source_note':
            return <SourceNote key={index} video={sourceVideo} />;
          case 'disclaimer':
            return <Disclaimer key={index} />;
        }
      })}
    </div>
  );
}

/** Numbered reference list. Anchors match the `[n]` marks in the body. */
export function ReferenceList({ references }: { references: readonly Reference[] }) {
  if (references.length === 0) return null;
  return (
    <section aria-labelledby="references" className="border-rule mt-12 border-t pt-8">
      <h2 id="references" className="font-display text-sm font-bold tracking-wider uppercase">
        Nguồn tham khảo
      </h2>
      <ol className="mt-4 space-y-3">
        {references.map((reference, index) => (
          <li key={index} id={`ref-${index + 1}`} className="text-sm leading-relaxed">
            <span className="text-ink-3 mr-1.5 font-mono text-xs">[{index + 1}]</span>
            <a
              href={reference.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent-ink underline underline-offset-2"
            >
              {reference.title}
            </a>
            <span className="text-ink-3"> — {reference.publisher}</span>
            {reference.published !== undefined && (
              <span className="text-ink-3"> ({reference.published})</span>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
