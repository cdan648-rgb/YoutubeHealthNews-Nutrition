import type { ReactNode } from 'react';

/**
 * Shared shell for the editorial trust pages (About, Methodology, Privacy, and so on).
 *
 * These pages are prose, and there is no typography plugin in this project, so the
 * vertical rhythm and link styling are set once here rather than re-specified on every
 * page. Keeping them identical is part of the point: the trust pages should read as one
 * coherent voice, not five separately styled documents.
 */
export function EditorialPage({
  kicker,
  title,
  lead,
  children,
}: {
  readonly kicker: string;
  readonly title: string;
  readonly lead?: string;
  readonly children: ReactNode;
}) {
  return (
    <main id="main" className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
      <p className="font-display text-accent-ink text-xs font-bold tracking-[0.18em] uppercase">
        {kicker}
      </p>
      <h1 className="font-display mt-2 text-3xl font-bold tracking-tight sm:text-4xl">{title}</h1>
      {lead !== undefined && <p className="text-ink-2 mt-4 text-lg leading-relaxed">{lead}</p>}
      <div className="editorial [&_h2]:font-display [&_a]:text-accent-ink mt-8 space-y-5 leading-relaxed [&_a]:underline [&_a]:underline-offset-2 [&_h2]:mt-8 [&_h2]:text-lg [&_h2]:font-bold [&_h2]:tracking-tight [&_li]:ml-1 [&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:pl-5">
        {children}
      </div>
    </main>
  );
}
