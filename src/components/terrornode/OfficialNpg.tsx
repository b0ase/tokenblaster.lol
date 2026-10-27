/**
 * OFFICIAL NPG GAME (owner, 27 Oct): the pink Ninja Punk Girls logo (copied from ninja-punk-girls-com,
 * public/brand/npg-logo.webp) with the line, small, above or beside the WELCOME TO TERRORNODE title so the title stays
 * the hero. NPG is the PG-13 brand: never pair this with NPGX marks.
 */
export function OfficialNpg({ className = '', size = 'md' }: { className?: string; size?: 'sm' | 'md' }) {
  // inline size: some hosts (the home gallery card) style every img in the block, so classes alone lose
  const h = size === 'sm' ? 24 : 34;
  return (
    <span className={`inline-flex items-center gap-2 align-middle ${className}`} data-official-npg>
      <picture className="contents">
        <source srcSet="/brand/npg-logo.webp" type="image/webp" />
        <img src="/brand/npg-logo.png" alt="Ninja Punk Girls" width={355} height={228} style={{ height: h, width: 'auto', maxWidth: 'none', position: 'static' }} className="drop-shadow-[0_2px_8px_rgba(0,0,0,.6)]" />
      </picture>
      <span className="whitespace-nowrap font-sans text-[10px] font-black not-italic leading-none tracking-[0.24em] text-[#ff5fb4] sm:text-[11px]">OFFICIAL NPG GAME</span>
    </span>
  );
}
