'use client';
/**
 * Damage feedback layered over the street (owner, 24 Oct 2026): a red edge vignette that flashes on every hit, a
 * direction wedge around the crosshair pointing at what hurt you, and a slow red pulse while health is low.
 * Imperative on purpose: the engine calls `hit()` from its frame loop, so nothing here re-renders per hit.
 * Pointer events are off; the gun keeps the trigger.
 */
import { forwardRef, useImperativeHandle, useRef } from 'react';
import { TUNING } from '@/lib/galleryGame/tuning';

export type DamageFxHandle = {
  /** `angle`: where the blow came from relative to the view (0 ahead, + right, +-PI behind); `dmg` sizes the flash. */
  hit: (angle: number, dmg: number) => void;
};

const CSS = `
@keyframes tbx-lowhp { 0%,100% { opacity: .35 } 50% { opacity: .85 } }
@keyframes tbx-wedge { 0% { opacity: 0; transform: var(--t) scale(.8) } 12% { opacity: 1; transform: var(--t) scale(1.08) } 100% { opacity: 0; transform: var(--t) scale(1) } }
`;

export const DamageFx = forwardRef<DamageFxHandle, { hp: number; hpMax: number }>(function DamageFx({ hp, hpMax }, ref) {
  const vignette = useRef<HTMLDivElement>(null);
  const wedges = useRef<HTMLDivElement>(null);
  useImperativeHandle(ref, () => ({
    hit(angle, dmg) {
      if (dmg <= 0) return;
      const v = vignette.current;
      if (v) {
        v.getAnimations().forEach((a) => a.cancel());
        const peak = Math.min(1, 0.45 + dmg / 25);
        v.animate([{ opacity: peak }, { opacity: 0 }], { duration: 650 + dmg * 14, easing: 'ease-out' });
      }
      const host = wedges.current;
      if (!host) return;
      const w = document.createElement('div');
      const deg = (angle * 180) / Math.PI;
      w.style.cssText = `position:absolute;left:50%;top:50%;width:min(300px,56vw);height:min(300px,56vw);margin:calc(min(300px,56vw) / -2) 0 0 calc(min(300px,56vw) / -2);--t:rotate(${deg.toFixed(1)}deg);transform:var(--t);animation:tbx-wedge 1.1s ease-out forwards;pointer-events:none;`;
      // a 56 degree arc of red at the rim of a circle, centred on the direction of the blow
      w.innerHTML =
        '<svg viewBox="-100 -100 200 200" width="100%" height="100%" style="filter:drop-shadow(0 0 6px rgba(255,40,30,.9))"><path d="M-46-86A98 98 0 0146-86" fill="none" stroke="#ff2a1e" stroke-width="9" stroke-linecap="round"/><path d="M-30-72A78 78 0 0130-72" fill="none" stroke="rgba(255,120,100,.7)" stroke-width="3" stroke-linecap="round"/></svg>';
      host.appendChild(w);
      setTimeout(() => w.remove(), 1200);
    },
  }));
  const low = hp > 0 && hp / hpMax < TUNING.player.lowFraction;
  return (
    <div className="pointer-events-none absolute inset-0 z-[12] overflow-hidden" aria-hidden data-damage-fx>
      <style>{CSS}</style>
      <div ref={vignette} className="absolute inset-0 opacity-0" style={{ background: 'radial-gradient(ellipse at 50% 50%, rgba(255,20,10,0) 38%, rgba(190,0,0,.55) 78%, rgba(120,0,0,.92) 100%)', boxShadow: 'inset 0 0 120px 30px rgba(255,0,0,.55)' }} />
      {low && <div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse at 50% 50%, rgba(255,0,0,0) 52%, rgba(200,0,0,.6) 100%)', animation: 'tbx-lowhp 0.9s ease-in-out infinite' }} />}
      <div ref={wedges} className="absolute inset-0" />
    </div>
  );
});
