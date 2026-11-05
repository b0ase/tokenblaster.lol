'use client';
/**
 * "Your play is paid, now press play" (owner, 5 Nov 2026: bRacer took the money and the RACE button was 700px down
 * the menu, so it looked like it hadn't started at all). After START pays, each game opens on its own menu and waits
 * for its PLAY button. In several games (bRacer, Rally, Arena, DoubleO, Hopper, Invaders, Snake on phones) that button
 * sits below the fold.
 *
 * While a paid play is waiting (coinStore.prepaidCount > 0) and the game's play button ([data-coinop-play]) is off
 * screen, this pins a big PLAY button to the bottom of the stage. Pressing it brings the game's button into view and
 * presses it, so the game's own settings (track, ship, mode) apply. It disappears once the run starts (the game
 * consumes the paid play) or when the game's own button is on screen. A ?demo=1 taste gets it too, until its first run.
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { coinStore } from './store';

const findPlay = () =>
  [...document.querySelectorAll<HTMLButtonElement>('[data-coinop-play]')].find((el) => !el.disabled && el.getClientRects().length > 0) ?? null;

export function PaidPlayReady() {
  const prepaidCount = useSyncExternalStore(coinStore.subscribe, coinStore.prepaidCount, () => 0);
  const demo = useSyncExternalStore(coinStore.subscribe, coinStore.demo, () => false);
  const demoPlays = useSyncExternalStore(coinStore.subscribe, coinStore.demoPlays, () => 0);
  // A ?demo=1 taste waits on the same button until its first run.
  const prepaid = prepaidCount > 0 || (demo && demoPlays === 0);
  const [target, setTarget] = useState<HTMLButtonElement | null>(null);
  const [inView, setInView] = useState(true);

  // Games render and swap their menus late (loading, phases), so look for the button until it is there.
  useEffect(() => {
    if (!prepaid) return;
    const t = window.setInterval(() => setTarget((cur) => (cur?.isConnected && cur.getClientRects().length ? cur : findPlay())), 400);
    return () => window.clearInterval(t);
  }, [prepaid]);

  useEffect(() => {
    if (!target) return;
    const io = new IntersectionObserver(([e]) => setInView(e.intersectionRatio >= 0.6), { threshold: [0, 0.6, 1] });
    io.observe(target);
    return () => io.disconnect();
  }, [target]);

  if (!prepaid || !target || inView) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex justify-center px-4 pb-[max(16px,env(safe-area-inset-bottom))]">
      <button
        type="button"
        data-fs-skip
        onClick={() => {
          target.scrollIntoView({ block: 'center', behavior: 'smooth' });
          target.click();
        }}
        className="pointer-events-auto animate-pulse border-2 border-white bg-[#e8261d] px-10 py-4 text-xl font-black tracking-widest text-white shadow-[0_0_40px_rgba(232,38,29,0.7)] sm:text-3xl"
      >
        {prepaidCount > 0 ? '▶ PLAY · YOUR PLAY IS PAID' : '▶ PLAY · DEMO'}
      </button>
    </div>
  );
}
