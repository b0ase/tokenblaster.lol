'use client';

import { useState } from 'react';
import { LiveCard } from '@/components/LiveCard';
import { LIVE_CARDS, liveCardBase } from '@/lib/npgLiveCards';

/**
 * Hue-spinner test, after the original NPG series: each card's layers get a hue rotation. The background is spun freely;
 * the frame (stripes, effects, logo) and the girl herself only when switched on, because the original series used it
 * sparingly on assets. Pure CSS filters on the card's layers: bg <img>, the girl's WebGL canvas, frame <img>.
 */
type Layer = 'bg' | 'frame' | 'girl';
const spin = () => Math.floor(Math.random() * 360);
const fresh = () => LIVE_CARDS.map(() => ({ bg: spin(), frame: spin(), girl: spin() }));

export function HueLab() {
  const [hues, setHues] = useState(() => LIVE_CARDS.map(() => ({ bg: 0, frame: 0, girl: 0 })));
  const [on, setOn] = useState<Record<Layer, boolean>>({ bg: true, frame: false, girl: false });
  const deg = (i: number, l: Layer) => (on[l] ? hues[i][l] : 0);
  const spinOne = (i: number) => setHues((h) => h.map((x, j) => (j === i ? { bg: spin(), frame: spin(), girl: spin() } : x)));
  const setOne = (i: number, l: Layer, v: number) => setHues((h) => h.map((x, j) => (j === i ? { ...x, [l]: v } : x)));

  return (
    <>
      <div className="panel flex flex-wrap items-center gap-3">
        <button className="btn" onClick={() => setHues(fresh())}>
          Spin all
        </button>
        <button className="btn" onClick={() => setHues(LIVE_CARDS.map(() => ({ bg: 0, frame: 0, girl: 0 })))}>
          Reset
        </button>
        <span className="text-dim">Spin these layers:</span>
        {(['bg', 'frame', 'girl'] as Layer[]).map((l) => (
          <label key={l} className="flex items-center gap-1.5">
            <input type="checkbox" checked={on[l]} onChange={(e) => setOn({ ...on, [l]: e.target.checked })} />
            {l === 'bg' ? 'Background' : l === 'frame' ? 'Frame + effects' : 'Girl'}
          </label>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {LIVE_CARDS.map((c, i) => (
          <div
            key={c.slug}
            className="flex flex-col gap-2 [&_canvas]:[filter:hue-rotate(var(--girl))] [&_div[role=img]>img:first-child]:[filter:hue-rotate(var(--bg))] [&_div[role=img]>img:last-child]:[filter:hue-rotate(var(--frame))]"
            style={{ '--bg': `${deg(i, 'bg')}deg`, '--frame': `${deg(i, 'frame')}deg`, '--girl': `${deg(i, 'girl')}deg` } as React.CSSProperties}
          >
            <LiveCard base={liveCardBase(c.slug)} name={c.name} box={c.box} rig={c.rig} />
            <div className="flex flex-col gap-1 text-xs text-dim">
              {(['bg', 'frame', 'girl'] as Layer[])
                .filter((l) => on[l])
                .map((l) => (
                  <label key={l} className="flex items-center gap-2">
                    <span className="w-12">{l}</span>
                    <input type="range" min={0} max={359} value={hues[i][l]} onChange={(e) => setOne(i, l, +e.target.value)} className="flex-1" />
                    <span className="w-10 text-right">{hues[i][l]}°</span>
                  </label>
                ))}
              <button className="btn self-start" onClick={() => spinOne(i)}>
                Spin {c.name}
              </button>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
