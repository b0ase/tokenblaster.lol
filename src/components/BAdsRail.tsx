import Script from 'next/script';

/**
 * bAds rail (owner, 27 Oct 2026): house + paid squares from the bAds server (www.bchatx.com/api/bads).
 * Browse pages only (home, arcade list); never on a game page, where players have paid to play.
 * One host element: a fixed column in the left gutter on wide screens, a swipe row at the end of the page otherwise.
 */
const CSS = `
.tb-bads{margin:24px auto 8px;width:100%;max-width:1200px;padding:0 10px;box-sizing:border-box}
.tb-bads .bads-rail{flex-direction:row;max-width:none;overflow-x:auto;scroll-snap-type:x mandatory;padding-bottom:4px}
.tb-bads .bads-rail a{flex:0 0 min(42%,180px);scroll-snap-align:start}
@media (min-width:1560px){
  .tb-bads.docked{position:fixed;left:16px;top:calc(var(--nav-h,76px) + 16px);width:160px;margin:0;padding:0;z-index:20}
  .tb-bads.docked .bads-rail{flex-direction:column;overflow:visible}
  .tb-bads.docked .bads-rail a{flex:none}
}`;

/** docked: fixed in the left gutter on wide screens (pages with a centred column). Full-bleed pages (home) keep the row. */
/** slotType 'token-page': house squares only (no paid third-party ads next to a token); bit-sign /api/bads/serve enforces it. */
export function BAdsRail({ rating = '17', slots = 4, docked = true, slotType }: { rating?: 'pg' | '17' | '18'; slots?: number; docked?: boolean; slotType?: 'token-page' }) {
  return (
    <>
      <style>{CSS}</style>
      <aside className={docked ? 'tb-bads docked' : 'tb-bads'} aria-label="Ads">
        <div data-bads-rail data-site="tokenblaster.lol" data-rating={rating} data-slots={slots} data-slot-type={slotType || undefined} />
      </aside>
      <Script src="https://www.bchatx.com/bads/rail.js" strategy="lazyOnload" />
    </>
  );
}
