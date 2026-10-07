/**
 * DR components: small, server-safe building blocks (no hooks) for the poster look.
 * ChevronBar, HazardBar, Sticker, Barcode, ProductCode, Pictogram, PosterFrame, Kana, Halftone, Display.
 */
import type { CSSProperties, ReactNode } from 'react';
import { DR } from '@/lib/dr/tokens';

const disp: CSSProperties = { fontFamily: DR.font.display, fontWeight: 900, fontStyle: 'italic', textTransform: 'uppercase', letterSpacing: '-0.01em', lineHeight: 0.88 };

/** Oversized display type. */
export function Display({ children, size = DR.type.h1, colour = DR.colour.paper, style, className, keepCase }: { children: ReactNode; size?: number | string; colour?: string; style?: CSSProperties; className?: string; keepCase?: boolean }) {
  return (
    <span className={className} style={{ ...disp, ...(keepCase ? { textTransform: 'none' as const } : {}), fontSize: size, color: colour, display: 'inline-block', ...style }}>
      {children}
    </span>
  );
}

/** A row of chevrons pointing right (or left with dir=-1). */
export function ChevronBar({ n = 12, colour = DR.colour.amber, h = 22, dir = 1, gap = 2, className }: { n?: number; colour?: string; h?: number; dir?: 1 | -1; gap?: number; className?: string }) {
  const w = h * 0.55;
  return (
    <svg className={className} width="100%" height={h} viewBox={`0 0 ${n * (w + gap)} ${h}`} preserveAspectRatio="none" aria-hidden style={{ display: 'block', transform: dir === -1 ? 'scaleX(-1)' : undefined }}>
      {Array.from({ length: n }, (_, i) => (
        <path key={i} d={`M${i * (w + gap)} 0 L${i * (w + gap) + w * 0.55} 0 L${i * (w + gap) + w} ${h / 2} L${i * (w + gap) + w * 0.55} ${h} L${i * (w + gap)} ${h} L${i * (w + gap) + w * 0.45} ${h / 2} Z`} fill={colour} />
      ))}
    </svg>
  );
}

/** Diagonal hazard stripes, the 1Sat Ordnance card band. */
export function HazardBar({ colour = DR.colour.amber, h = 16, className, style }: { colour?: string; h?: number; className?: string; style?: CSSProperties }) {
  return <div aria-hidden className={className} style={{ height: h, backgroundImage: `repeating-linear-gradient(-45deg, ${colour} 0 12px, ${DR.colour.ink} 12px 24px)`, ...style }} />;
}

/** A tilted slogan sticker. */
export function Sticker({ children, bg = DR.colour.amber, fg = DR.colour.ink, rot = -3, size = 14, className, style }: { children: ReactNode; bg?: string; fg?: string; rot?: number; size?: number; className?: string; style?: CSSProperties }) {
  return (
    <span className={className} style={{ ...disp, display: 'inline-block', background: bg, color: fg, fontSize: size, padding: `${size * 0.25}px ${size * 0.55}px`, transform: `rotate(${rot}deg)`, lineHeight: 1, whiteSpace: 'nowrap', ...style }}>
      {children}
    </span>
  );
}

/** Deterministic barcode from a seed string. */
export function Barcode({ seed = 'TOKENBLASTER', h = 28, colour = DR.colour.paper, w = 120 }: { seed?: string; h?: number; colour?: string; w?: number }) {
  let r = 7;
  for (const c of seed) r = (r * 31 + c.charCodeAt(0)) % 233280;
  const bars: [number, number][] = [];
  let x = 0;
  while (x < w) {
    r = (r * 9301 + 49297) % 233280;
    const bw = 1 + Math.floor((r / 233280) * 3.4);
    bars.push([x, bw]);
    x += bw + 1 + ((r >> 3) % 3);
  }
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden style={{ display: 'block' }}>
      {bars.map(([bx, bw], i) => (
        <rect key={i} x={bx} y={0} width={bw} height={h} fill={colour} />
      ))}
    </svg>
  );
}

/** Faux catalogue code with a barcode: "HG-003 / TB". */
export function ProductCode({ code, label = 'TB', colour = DR.colour.paper, className }: { code: string; label?: string; colour?: string; className?: string }) {
  return (
    <span className={className} style={{ display: 'inline-flex', flexDirection: 'column', gap: 3, fontFamily: DR.font.mono, fontSize: 10, color: colour, letterSpacing: '0.12em' }}>
      <Barcode seed={code + label} h={18} w={92} colour={colour} />
      <span>
        {code} / {label}
      </span>
    </span>
  );
}

export type PictogramName = 'arrow' | 'bolt' | 'rocket' | 'mine' | 'shield' | 'turbo' | 'quake' | 'hex' | 'star' | 'flag' | 'target' | 'speed' | 'loop' | 'chip';

/** The pictogram set: one-colour glyphs on a 24 grid. */
export function Pictogram({ name, size = 24, colour = DR.colour.paper, className }: { name: PictogramName; size?: number; colour?: string; className?: string }) {
  const p: Record<PictogramName, ReactNode> = {
    arrow: <path d="M3 9h10V4l8 8-8 8v-5H3z" />,
    bolt: <path d="M13 2 4 14h6l-1 8 9-12h-6z" />,
    rocket: <path d="M12 2c3 2 5 6 5 10l2 3-4 1-1 5h-4l-1-5-4-1 2-3c0-4 2-8 5-10zm0 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4z" />,
    mine: <path d="M12 6a6 6 0 1 0 0 12 6 6 0 0 0 0-12zM11 1h2v4h-2zm0 18h2v4h-2zM1 11h4v2H1zm18 0h4v2h-4zM4.2 5.6l1.4-1.4 2.8 2.8-1.4 1.4zm11.4 11.4 1.4-1.4 2.8 2.8-1.4 1.4zM4.2 18.4l2.8-2.8 1.4 1.4-2.8 2.8zM15.6 7l2.8-2.8 1.4 1.4L17 8.4z" />,
    shield: <path d="M12 2 4 5v6c0 5 3 9 8 11 5-2 8-6 8-11V5zm0 3 5 2v4c0 3-2 6-5 8-3-2-5-5-5-8V7z" />,
    turbo: <path d="M2 4l8 8-8 8V4zm9 0 8 8-8 8V4z" />,
    quake: <path d="M2 12c2-6 4-6 6 0s4 6 6 0 4-6 6 0l-2 1c-1-4-2-4-3 0-2 6-5 6-7 0-1-4-2-4-3 0z" />,
    hex: <path d="M12 2 21 7v10l-9 5-9-5V7z" />,
    star: <path d="m12 2 3 7 7 .5-5.5 4.5 2 7-6.5-4-6.5 4 2-7L2 9.5 9 9z" />,
    flag: <path d="M5 2h2v20H5zm3 1h12l-3 5 3 5H8z" />,
    target: <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 3a7 7 0 1 1 0 14 7 7 0 0 1 0-14zm0 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm0 3a1 1 0 1 1 0 2 1 1 0 0 1 0-2z" />,
    speed: <path d="M12 4a10 10 0 0 0-9 14h3a7 7 0 1 1 12 0h3A10 10 0 0 0 12 4zm1 5-1 5a2 2 0 1 0 2 .5z" />,
    loop: <path d="M12 3a8 8 0 1 0 8 8h-3a5 5 0 1 1-5-5V3zm2 0v6l5-3z" />,
    chip: <path d="M7 7h10v10H7zm-4 3h3v2H3zm0 4h3v2H3zm15-4h3v2h-3zm0 4h3v2h-3zM10 3h2v3h-2zm4 0h2v3h-2zM10 18h2v3h-2zm4 0h2v3h-2z" />,
  };
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill={colour} aria-hidden style={{ display: 'block' }}>
      {p[name]}
    </svg>
  );
}

/** Katakana (or any) flourish in the JP face, tracked wide. */
export function Kana({ children, size = 14, colour = DR.colour.paper, className }: { children: ReactNode; size?: number; colour?: string; className?: string }) {
  return (
    <span className={className} style={{ fontFamily: DR.font.jp, fontWeight: 900, fontSize: size, color: colour, letterSpacing: '0.25em', lineHeight: 1 }}>
      {children}
    </span>
  );
}

/** Halftone dot field as a background. */
export const halftone = (colour: string = DR.colour.amber, size = 14, alpha = 0.22): CSSProperties => ({
  backgroundImage: `radial-gradient(circle, ${colour}${Math.round(alpha * 255).toString(16).padStart(2, '0')} 22%, transparent 24%)`,
  backgroundSize: `${size}px ${size}px`,
});

/** The visible 12-col grid as a background. */
export const gridBg = (rule: string = DR.grid.rule, cell: number = DR.grid.cell): CSSProperties => ({
  backgroundImage: `linear-gradient(${rule} 1px, transparent 1px), linear-gradient(90deg, ${rule} 1px, transparent 1px)`,
  backgroundSize: `${cell}px ${cell}px`,
});

/** A poster: black field, grid, hazard bars, corner code. Children are the content. */
export function PosterFrame({ children, accent = DR.colour.amber, code, kana, className, style, bars = true, bg = DR.colour.ink }: { children: ReactNode; accent?: string; code?: string; kana?: string; className?: string; style?: CSSProperties; bars?: boolean; bg?: string }) {
  return (
    <div className={className} style={{ position: 'relative', background: bg, border: `2px solid ${accent}`, overflow: 'hidden', ...gridBg(), ...style }}>
      {bars && <HazardBar colour={accent} h={10} />}
      <div style={{ position: 'relative' }}>{children}</div>
      {bars && <HazardBar colour={accent} h={10} />}
      {(code || kana) && (
        <div style={{ position: 'absolute', right: 8, top: 16, textAlign: 'right', fontFamily: DR.font.mono, fontSize: 10, color: accent, letterSpacing: '0.14em' }}>
          {code}
          {kana && (
            <div>
              <Kana size={10} colour={accent}>
                {kana}
              </Kana>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
