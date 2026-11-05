'use client';
/**
 * The attract screen behind every coin-op cabinet (owner, 5 Nov 2026: players were landing on a bare coin slot
 * with no graphics, music or video to make them want to play). Like a real arcade cabinet's attract mode:
 *  - the game's gameplay loop full-bleed behind the cabinet (public/hero/<game>.mp4, the home showcase's captures;
 *    the arcade card public/arcade/<slug>.jpg with a slow push where there is no loop yet, or under reduced
 *    motion / Save-Data);
 *  - the game's name, big, with its one-line pitch;
 *  - the game's own soundtrack station (src/lib/preview.ts) while the cabinet is up. Browsers need a tap first, so
 *    the first coin (or the MUSIC button) starts it; a visitor who muted the site stays muted until they press it.
 * When the game opens the cabinet unmounts and the game's own audio (sfx.ts) takes over again.
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { setPreviewEnabled, setSuppressed, startPreview, stopPreview, trackFor, usePreview } from '@/lib/preview';
import { Logo } from '@/components/bracer-logo';

type Look = { vid?: string; img: string; pitch?: string };

/** Game slug (GameShell `game`) → its attract look. Loops are the home showcase's (HeroShowcase SLIDES). */
const LOOKS: Record<string, Look> = {
  bracer: { vid: '/hero/bracer-v2', img: '/hero/bracer-v2.jpg', pitch: 'Anti-gravity racing at 700 km/h. Every rival ship is a live BSV transaction: the bigger the move, the faster it flies.' },
  rally: { vid: '/hero/rally', img: '/hero/rally.jpg', pitch: 'Flat-out rally against the live chain.' },
  arena: { vid: '/hero/arena', img: '/hero/arena.jpg', pitch: 'Hell-forge shooter.' },
  'npg-arena': { vid: '/hero/npg-arena', img: '/hero/npg-arena.jpg', pitch: 'Ninja brawler.' },
  city: { vid: '/hero/city-v2', img: '/hero/city-v2.jpg', pitch: 'Open-world Satoshi City.' },
  doubleosatoshi: { vid: '/hero/doubleo', img: '/hero/doubleo.jpg' },
};
const lookFor = (game: string): Look => LOOKS[game] ?? { img: `/arcade/${game === 'doubleosatoshi' ? 'doubleo' : game}.jpg` };

type Conn = { saveData?: boolean; addEventListener?: (t: string, cb: () => void) => void; removeEventListener?: (t: string, cb: () => void) => void };
const RM = '(prefers-reduced-motion: reduce)';
function subscribeMotion(cb: () => void) {
  const mq = window.matchMedia(RM);
  const conn = (navigator as Navigator & { connection?: Conn }).connection;
  mq.addEventListener('change', cb);
  conn?.addEventListener?.('change', cb);
  return () => {
    mq.removeEventListener('change', cb);
    conn?.removeEventListener?.('change', cb);
  };
}
const motionSnapshot = () => !window.matchMedia(RM).matches && !(navigator as Navigator & { connection?: Conn }).connection?.saveData;
const motionServer = () => false;

/** Full-bleed background: the gameplay loop (or the card with a slow push) under a dark wash that keeps the cabinet readable. */
export function AttractBackdrop({ game }: { game: string }) {
  const look = lookFor(game);
  const motion = useSyncExternalStore(subscribeMotion, motionSnapshot, motionServer);
  const [failed, setFailed] = useState(false);
  const video = motion && look.vid && !failed;
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {video ? (
        // One src picked on the client (motion is client-only): the 720p loop for phones and small windows.
        <video
          autoPlay
          muted
          loop
          playsInline
          poster={look.img}
          src={`${look.vid}${window.matchMedia('(max-width: 900px)').matches ? '-720' : ''}.mp4`}
          onError={() => setFailed(true)}
          className="absolute inset-0 h-full w-full object-cover opacity-80"
        />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={look.img} alt="" className={`absolute inset-0 h-full w-full object-cover opacity-70 ${motion ? 'attract-push' : ''}`} />
      )}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_45%,rgba(4,7,11,0.35),rgba(4,7,11,0.85)_70%)]" />
      <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-[#04070b] to-transparent" />
    </div>
  );
}

/** The game's name and pitch over the loop, with the MUSIC button. */
export function AttractTitle({ game, title }: { game: string; title: string }) {
  const href = `/arcade/${game}`;
  const pv = usePreview();
  const on = pv.key === href && pv.playing;

  // While the cabinet is up the site player may play this game's station; give the audio back to the game after.
  useEffect(() => {
    // After the site player's own route effect, which suppresses music on game routes.
    const t = window.setTimeout(() => setSuppressed(false), 0);
    return () => {
      window.clearTimeout(t);
      stopPreview(href);
      setSuppressed(true);
    };
  }, [href]);
  // Once sound is unlocked (any tap: a coin, the button) and wanted, play this game's music.
  useEffect(() => {
    if (pv.enabled && !pv.locked && !pv.paused && !pv.suppressed && pv.key !== href) void startPreview(href, trackFor(href));
  }, [pv.enabled, pv.locked, pv.paused, pv.suppressed, pv.key, href]);

  const pitch = lookFor(game).pitch;
  return (
    <div className="mb-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-center lg:mb-0 lg:block lg:text-left">
      <h1 className="leading-none drop-shadow-[0_4px_18px_rgba(0,0,0,0.8)]">
        {game === 'bracer' ? <Logo size="clamp(40px, 5.4vw, 84px)" /> : <span className="tbx-display text-[clamp(32px,6vw,76px)]">{title}</span>}
      </h1>
      {pitch && <p className="hidden max-w-[560px] text-base leading-snug text-white/85 drop-shadow-[0_2px_8px_rgba(0,0,0,0.9)] sm:mx-auto sm:mt-1 sm:block sm:basis-full lg:mx-0 lg:mt-4 lg:text-lg">{pitch}</p>}
      <button
        type="button"
        data-fs-skip
        onClick={() => {
          if (on) return stopPreview(href);
          setPreviewEnabled(true);
          void startPreview(href, trackFor(href));
        }}
        aria-pressed={on}
        className="tbx-btn inline-flex shrink-0 items-center gap-2 !px-3 !py-1.5 text-xs lg:mt-5"
      >
        <span aria-hidden>♪</span>
        {on ? 'MUSIC ON' : 'PLAY MUSIC'}
      </button>
    </div>
  );
}
