'use client';
/**
 * Cabinet hardware for the coin-op cabinet (owner, 24 Oct 2026): metallic coins (SVG), a recessed coin slot with a
 * lamp, a 7-segment LED credit display in smoked glass and an anodised frame. The red arcade button is the .tbx-go
 * style. Pure CSS/SVG; styles live in ui.css (.tbx-*).
 */
import { useId, type ReactNode } from 'react';

// ── Metallic coin ──────────────────────────────────────────────────

type Metal = 'gold' | 'silver' | 'copper';
const METALS: Record<Metal, { hi: string; mid: string; lo: string; rim: string; ink: string }> = {
  gold: { hi: '#fff4c2', mid: '#f2c14e', lo: '#8a5a00', rim: '#6b4500', ink: '#5a3a00' },
  silver: { hi: '#ffffff', mid: '#c9ced6', lo: '#5d636d', rim: '#4a4f57', ink: '#3a3e45' },
  copper: { hi: '#ffd2b0', mid: '#d0773d', lo: '#6b2e0c', rim: '#552208', ink: '#4a1d06' },
};
export const metalFor = (usd: number): Metal => (usd >= 1 ? 'gold' : usd <= 0.01 ? 'copper' : 'silver');

/** A coin face: radial metal, reeded rim, embossed value. */
export function CoinFace({ usd, label }: { usd: number; label: string }) {
  const id = useId().replace(/:/g, '');
  const m = METALS[metalFor(usd)];
  return (
    <svg viewBox="0 0 100 100" className="block h-full w-full" aria-hidden>
      <defs>
        <radialGradient id={`f${id}`} cx="35%" cy="30%" r="75%">
          <stop offset="0" stopColor={m.hi} />
          <stop offset="0.45" stopColor={m.mid} />
          <stop offset="1" stopColor={m.lo} />
        </radialGradient>
        <linearGradient id={`r${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={m.hi} />
          <stop offset="0.5" stopColor={m.lo} />
          <stop offset="1" stopColor={m.mid} />
        </linearGradient>
        <filter id={`e${id}`} x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="-0.8" dy="-0.8" stdDeviation="0.3" floodColor="#ffffff" floodOpacity="0.7" />
          <feDropShadow dx="1" dy="1.2" stdDeviation="0.4" floodColor="#000000" floodOpacity="0.55" />
        </filter>
      </defs>
      {/* rim + reeding */}
      <circle cx="50" cy="50" r="48" fill={`url(#r${id})`} />
      <circle cx="50" cy="50" r="46.5" fill="none" stroke={m.rim} strokeWidth="3" strokeDasharray="1.2 1.2" />
      {/* field */}
      <circle cx="50" cy="50" r="41" fill={`url(#f${id})`} />
      <circle cx="50" cy="50" r="41" fill="none" stroke={m.lo} strokeOpacity="0.6" strokeWidth="1" />
      <circle cx="50" cy="50" r="36" fill="none" stroke={m.hi} strokeOpacity="0.45" strokeWidth="0.8" />
      <text x="50" y="50" dy="0.36em" textAnchor="middle" fontSize={label.length > 2 ? 30 : 36} fontWeight="900" fill={m.ink} filter={`url(#e${id})`} style={{ fontFamily: 'var(--font-dr-display, Impact, sans-serif)' }}>
        {label}
      </text>
    </svg>
  );
}

// ── Coin slot ──────────────────────────────────────────────────────

/** A recessed slot with a lamp strip that glows red while there is no credit. */
export function CoinSlot({ lit, children }: { lit: boolean; children?: ReactNode }) {
  return (
    <div className={`tbx-slot ${lit ? 'tbx-slot-lit' : ''}`}>
      <div className="tbx-slot-mouth">{children}</div>
      <span className="tbx-slot-lamp" aria-hidden />
    </div>
  );
}

// ── 7-segment LED ──────────────────────────────────────────────────

// Segments a..g as polygons in a 20×34 cell.
const SEG: Record<string, string> = {
  a: '3,1 17,1 15,4 5,4',
  b: '17.5,2 17.5,16 15,14.5 15,4.5',
  c: '17.5,18 17.5,32 15,29.5 15,19.5',
  d: '3,33 17,33 15,30 5,30',
  e: '2.5,18 5,19.5 5,29.5 2.5,32',
  f: '2.5,2 5,4.5 5,14.5 2.5,16',
  g: '3,17 5,15.5 15,15.5 17,17 15,18.5 5,18.5',
};
const ON: Record<string, string> = { '0': 'abcdef', '1': 'bc', '2': 'abged', '3': 'abgcd', '4': 'fgbc', '5': 'afgcd', '6': 'afgedc', '7': 'abc', '8': 'abcdefg', '9': 'abcdfg', '-': 'g', ' ': '' };

export function SevenSeg({ text, colour = '#ffb000', label = 'CREDIT' }: { text: string; colour?: string; label?: string }) {
  // Digits plus a '.' attached to the previous digit.
  const cells: { ch: string; dot: boolean }[] = [];
  for (const ch of text) {
    if (ch === '.' && cells.length) cells[cells.length - 1].dot = true;
    else cells.push({ ch, dot: false });
  }
  return (
    <div className="tbx-led inline-flex items-center gap-3 px-3.5 py-2" role="img" aria-label={`${label} ${text}`} data-credit>
      <span className="text-[10px] font-bold tracking-[0.35em]" style={{ color: colour, textShadow: `0 0 8px ${colour}88` }}>
        {label}
      </span>
      <svg key={text} viewBox={`0 0 ${cells.length * 24} 36`} className="tbx-led-digits h-[clamp(30px,5vw,44px)]" style={{ filter: `drop-shadow(0 0 4px ${colour}aa)` }}>
        {cells.map((c, i) => {
          const on = c.ch === '$' ? '' : (ON[c.ch] ?? '');
          return (
            <g key={i} transform={`translate(${i * 24 + 2} 1) skewX(-6)`}>
              {c.ch === '$' ? (
                <text x="10" y="27" textAnchor="middle" fontSize="28" fontWeight="900" fill={colour}>
                  $
                </text>
              ) : (
                Object.entries(SEG).map(([k, pts]) => <polygon key={k} points={pts} fill={colour} opacity={on.includes(k) ? 1 : 0.09} />)
              )}
              <circle cx="20.5" cy="32" r="1.8" fill={colour} opacity={c.dot ? 1 : 0.09} />
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ── Cabinet frame ──────────────────────────────────────────────────

/** The anodised cabinet frame that holds the coin-op controls (replaces the old hazard-striped plate). */
export function ControlPanel({ children }: { children: ReactNode }) {
  return (
    <div className="tbx-cab w-full">
      <div className="tbx-cab-in relative px-3 py-4 sm:px-6 sm:py-5">{children}</div>
    </div>
  );
}
