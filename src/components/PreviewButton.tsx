'use client';

import { setPreviewEnabled, startPreview, stopPreview, trackFor, usePreview } from '@/lib/preview';

/** Mouse hover / keyboard focus handlers that play a game's music. Touch has no hover: use PreviewButton. */
export function previewHandlers(href: string) {
  const play = () => startPreview(href, trackFor(href));
  return {
    onPointerEnter: (e: React.PointerEvent) => e.pointerType === 'mouse' && play(),
    onPointerLeave: (e: React.PointerEvent) => e.pointerType === 'mouse' && stopPreview(href),
    onFocus: play,
    onBlur: () => stopPreview(href),
  };
}

/** Small music button: tap to preview on touch (also unlocks sound); never navigates the card. */
export function PreviewButton({ href, title, className = '' }: { href: string; title: string; className?: string }) {
  const s = usePreview();
  const playing = s.key === href;
  return (
    <button
      type="button"
      aria-label={playing ? `Stop ${title} music` : `Preview ${title} music`}
      aria-pressed={playing}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (playing) return stopPreview(href);
        if (!s.enabled || s.locked || s.paused) setPreviewEnabled(true);
        // state flips synchronously inside this click gesture
        startPreview(href, trackFor(href));
      }}
      className={`z-10 flex h-8 w-8 items-center justify-center border-2 bg-[var(--panel)] text-sm transition-colors hover:border-[var(--hot)] hover:text-[var(--accent)] [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:focus-visible:opacity-100 [@media(hover:hover)]:group-hover:opacity-100 ${
        playing ? 'border-[var(--accent)] text-[var(--accent)] [@media(hover:hover)]:opacity-100' : 'border-[var(--border)] text-hot'
      } ${className}`}
    >
      <span aria-hidden>♪</span>
    </button>
  );
}
