/**
 * WELCOME TO TERRORNODE title treatment (owner, 27 Oct 2026: "lots of blood"). Bold blood-red lettering with drips
 * running off the letters and a few splatters. Pure CSS (no images), so it stays sharp at any size; drips are static
 * under prefers-reduced-motion. "WELCOME TO" sits small above "TERRORNODE" so the title fits a 390px phone.
 */
const DRIPS = [
  { l: 3, h: 0.55, w: 0.08, d: 0 },
  { l: 8, h: 0.8, w: 0.1, d: 1.1 },
  { l: 14, h: 0.4, w: 0.06, d: 2.3 },
  { l: 20, h: 0.85, w: 0.09, d: 0.6 },
  { l: 27, h: 0.95, w: 0.11, d: 1.7 },
  { l: 33, h: 0.5, w: 0.07, d: 2.9 },
  { l: 39, h: 0.95, w: 0.09, d: 0.3 },
  { l: 46, h: 0.35, w: 0.06, d: 1.4 },
  { l: 51, h: 0.85, w: 0.1, d: 2.1 },
  { l: 57, h: 0.6, w: 0.08, d: 0.9 },
  { l: 63, h: 1.0, w: 0.11, d: 2.6 },
  { l: 69, h: 0.45, w: 0.07, d: 0.2 },
  { l: 75, h: 1.0, w: 0.1, d: 1.9 },
  { l: 81, h: 0.7, w: 0.08, d: 0.5 },
  { l: 87, h: 0.9, w: 0.1, d: 2.4 },
  { l: 93, h: 0.5, w: 0.07, d: 1.2 },
  { l: 97, h: 0.85, w: 0.08, d: 3.1 },
];
const SPLATS = [
  { l: -3, t: 18, s: 0.09 },
  { l: 27, t: -8, s: 0.06 },
  { l: 58, t: 104, s: 0.08 },
  { l: 101, t: 30, s: 0.07 },
  { l: 84, t: -12, s: 0.05 },
];

const CSS = `
.tn-blood{display:inline-flex;flex-direction:column;align-items:flex-start;line-height:.86;font-family:var(--tbx-display),Impact,sans-serif;font-weight:900;text-transform:uppercase;letter-spacing:-.01em;max-width:100%;margin-bottom:.62em}
.tn-blood-pre{font-size:.36em;letter-spacing:.14em;color:#ffd9dd;text-shadow:0 2px 0 #5a000c,0 0 24px rgba(255,20,50,.45);margin-bottom:.12em}
.tn-blood-main{position:relative;display:inline-block;white-space:nowrap;padding-bottom:.08em}
.tn-blood-word{position:relative;z-index:1;background:linear-gradient(180deg,#ff3a4c 0%,#e0001f 38%,#9a0014 72%,#5c000b 100%);-webkit-background-clip:text;background-clip:text;color:transparent;filter:drop-shadow(0 .03em 0 #3d0007) drop-shadow(0 0 .18em rgba(255,0,32,.45)) drop-shadow(0 .1em .3em rgba(0,0,0,.75))}
.tn-blood-main::after{content:'';position:absolute;left:1%;right:2%;top:74%;height:.16em;z-index:0;border-radius:0 0 .1em .1em;background:linear-gradient(180deg,#b80019,#7a0010);filter:blur(.5px)}
.tn-drip{position:absolute;top:74%;z-index:0;left:calc(var(--l)*1%);width:calc(var(--w)*1em);height:calc(var(--h)*1em);border-radius:0 0 999px 999px;background:linear-gradient(180deg,#a50016,#d1001c 55%,#7a0010);transform-origin:top;animation:tn-drip 4.2s cubic-bezier(.5,0,.8,.6) calc(var(--d)*1s) infinite both;box-shadow:inset -.012em 0 0 rgba(255,140,150,.35)}
.tn-drip::after{content:'';position:absolute;left:50%;bottom:-.06em;width:170%;aspect-ratio:1/1.25;transform:translateX(-50%);border-radius:50% 50% 50% 50%/40% 40% 60% 60%;background:radial-gradient(circle at 35% 35%,#ff5a66 0 12%,#c4001b 40%,#6e000e 100%)}
.tn-splat{position:absolute;z-index:0;left:calc(var(--l)*1%);top:calc(var(--t)*1%);width:calc(var(--s)*1em);aspect-ratio:1;border-radius:46% 54% 60% 40%/52% 44% 56% 48%;background:radial-gradient(circle at 40% 40%,#e0001f,#6e000e);box-shadow:.06em .02em 0 -.015em #b30018,-.05em .05em 0 -.025em #b30018,.02em -.06em 0 -.03em #c4001b}
@keyframes tn-drip{0%{transform:scaleY(.6);opacity:1}70%{transform:scaleY(1);opacity:1}100%{transform:scaleY(1.06);opacity:.85}}
@media (prefers-reduced-motion:reduce){.tn-drip{animation:none}}
`;

export function BloodTitle({ pre = 'WELCOME TO', word = 'TERRORNODE', className = '' }: { pre?: string; word?: string; className?: string }) {
  return (
    <span className={`tn-blood ${className}`} aria-label={`${pre} ${word}`} role="text">
      <style>{CSS}</style>
      <span className="tn-blood-pre" aria-hidden>{pre}</span>
      <span className="tn-blood-main" aria-hidden>
        <span className="tn-blood-word">{word}</span>
        {DRIPS.map((d) => (
          <span key={d.l} className="tn-drip" style={{ ['--l' as string]: d.l, ['--h' as string]: d.h, ['--w' as string]: d.w, ['--d' as string]: d.d }} />
        ))}
        {SPLATS.map((s) => (
          <span key={`${s.l}-${s.t}`} className="tn-splat" style={{ ['--l' as string]: s.l, ['--t' as string]: s.t, ['--s' as string]: s.s }} />
        ))}
      </span>
    </span>
  );
}
