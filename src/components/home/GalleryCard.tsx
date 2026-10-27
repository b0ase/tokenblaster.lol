import Image from 'next/image';
import Link from 'next/link';
import { BloodTitle } from '@/components/gallery/BloodTitle';
import { LOADING_SHOTS } from '@/lib/gallery/story';
import { tbxFontClass } from '../coinop/fonts';
import { PrizeBanner } from '../gallery/PrizeBanner';
import { OfficialNpg } from '../terrornode/OfficialNpg';

/** Filmstrip frames: three of the cinematic loader stills, captioned from the story data. */
const FRAMES = ['/gallery/loading/street-left.webp', '/gallery/loading/tower.webp', '/gallery/loading/muzzle.webp']
  .map((src) => LOADING_SHOTS.find((s) => s.src === src))
  .filter((s): s is NonNullable<typeof s> => Boolean(s));

/** The home page's Shooting Gallery feature: key art, HUD corners, a filmstrip of the story stills, the prize strip under it. */
export function GalleryCard() {
  return (
    <section aria-label="Welcome to TERRORNODE" className={`${tbxFontClass} dr-band flex flex-col gap-3`} data-reveal>
      {/* A card, not one big link: the art is a link and INSERT $b is a real, focusable button-styled link (flow test, 25 Oct). */}
      <div className="hp-gal group">
        <div className="hp-gal-main">
          <Link href="/arcade/terrornode" tabIndex={-1} aria-hidden className="absolute inset-0 z-[2]">
            <span className="sr-only">Welcome to TERRORNODE</span>
          </Link>
          <Image src="/gallery/loading/boss-fire.webp" fill sizes="100vw" alt="The Liquid Unit roars in the rain outside the TERRORNODE tower, Neo-Tokyo 2048" />
          <div className="hp-gal-shade" aria-hidden />
          {(['tl', 'tr', 'bl', 'br'] as const).map((c) => (
            <span key={c} className="hp-gal-corner" data-c={c} aria-hidden />
          ))}
          <div className="hp-gal-film" aria-hidden>
            {FRAMES.map((f) => (
              <figure key={f.src}>
                <Image src={f.src} alt="" fill sizes="260px" style={{ objectPosition: f.pos }} />
                <figcaption>{f.caption}</figcaption>
              </figure>
            ))}
          </div>
          <div className="hp-gal-copy">
            <span className="hp-gal-live">
              <b aria-hidden />
              Welcome to TERRORNODE · 31 Oct stress test
            </span>
            <OfficialNpg size="sm" />
            <p className="hp-gal-title"><BloodTitle /></p>
            <p className="max-w-xl text-[clamp(14px,1.5vw,17px)] leading-relaxed text-[var(--tbx-dim)]">
              Neo-Tokyo, 2048. The Ninja Punk Girls storm the node to free Dr Kweg Wong from his own Erobotz. Join them, drop a coin in and hold the trigger: in paid play every round is a real transaction.
            </p>
            <Link href="/arcade/terrornode" role="button" data-insert-b className="tbx-btn tbx-btn-red pointer-events-auto relative z-10 mt-1 self-start !px-7 !text-[15px]" aria-label="Insert $b: play Welcome to TERRORNODE">
              INSERT <span className="normal-case">$b</span> &raquo;
            </Link>
          </div>
        </div>
      </div>
      <PrizeBanner cta />
    </section>
  );
}
