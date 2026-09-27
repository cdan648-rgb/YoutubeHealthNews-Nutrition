'use client';

import { useState } from 'react';
import { SOURCE_CHANNEL } from '@/lib/site';
import { youtubeSrcSet } from './SourceHero';

/**
 * Click-to-load YouTube embed.
 *
 * A YouTube iframe pulls roughly a megabyte of JavaScript and sets cookies before the
 * reader has asked for the video, which would dominate the article's Largest
 * Contentful Paint and its privacy footprint alike. So until the reader clicks, this
 * is a thumbnail and a play button — no iframe, no request to youtube.com at all.
 *
 * On click we load the `youtube-nocookie.com` player with `autoplay=1`, so the click
 * that reveals the player is also the click that starts it: the reader does not have
 * to press play twice.
 */
export function VideoEmbedFacade({
  videoId,
  title,
}: {
  readonly videoId: string;
  readonly title: string;
}) {
  const [active, setActive] = useState(false);
  const thumbnail = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
  const srcSet = youtubeSrcSet(thumbnail);

  if (active) {
    return (
      <div className="bg-ink aspect-video overflow-hidden rounded-lg">
        <iframe
          src={`https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&rel=0`}
          title={title}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          className="size-full border-0"
        />
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setActive(true)}
      className="group bg-ink relative block aspect-video w-full overflow-hidden rounded-lg"
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- Deliberate: see SourceHero. The facade references YouTube’s own thumbnail URL and
        stores no copy of it. */}
      <img
        src={thumbnail}
        {...(srcSet !== undefined ? { srcSet } : {})}
        sizes="(min-width: 1024px) 720px, 100vw"
        alt=""
        width={1280}
        height={720}
        loading="lazy"
        decoding="async"
        referrerPolicy="strict-origin-when-cross-origin"
        className="size-full object-cover opacity-85 transition-opacity group-hover:opacity-100"
      />

      <span className="absolute inset-0 flex items-center justify-center">
        <span className="flex size-16 items-center justify-center rounded-full bg-black/70 ring-2 ring-white/80 transition-transform group-hover:scale-105">
          <svg viewBox="0 0 24 24" className="ml-1 size-7 fill-white" aria-hidden="true">
            <path d="M8 5v14l11-7z" />
          </svg>
        </span>
      </span>

      <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-3 pt-10 pb-2 text-left text-xs leading-snug text-white">
        Phát video trên YouTube · {SOURCE_CHANNEL.title}
      </span>
      <span className="sr-only">Phát video: {title}</span>
    </button>
  );
}
