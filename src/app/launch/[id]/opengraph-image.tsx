/**
 * Share card for one coin: its picture, ticker, market cap and how far up the curve it is,
 * in BlastPad's red phosphor look. Every coin a player shares advertises BlastPad.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ImageResponse } from 'next/og';
import sharp from 'sharp';
import { GRAD_SOLD, marketCap, price, progress } from '@/lib/launch/curve';
import { rpc } from '@/lib/launch/server';
import { bsvUsd } from '@/lib/price';
import { GAME_COINS } from '@/lib/gameCoins';

/** Game coins get their game's artwork behind the card (owner, 7 Oct 2026: themed cards). */
const GAME_ART: Record<string, { file: string; line: string }> = {
  [GAME_COINS.arena.id]: { file: 'arena.jpg', line: 'HOUSE AMMO in the Arena: gold rounds hit 1.5x' },
  [GAME_COINS.doubleo.id]: { file: 'doubleo.jpg', line: 'HOUSE AMMO in Double-O Satoshi: gold rounds hit 1.5x' },
  [GAME_COINS.frogger.id]: { file: 'frogger.jpg', line: 'Pay your Chain Frogger hops in $FROGGER' },
  [GAME_COINS.bsvgun.id]: { file: 'bsvgun.jpg', line: 'HOUSE AMMO in BSVGun: gold rounds hit 1.5x' },
};

async function gameArt(tokenId: string): Promise<string | null> {
  const g = GAME_ART[tokenId];
  if (!g) return null;
  try {
    // Fetched by URL: serverless functions don't ship public/.
    const r = await fetch(`https://www.tokenblaster.lol/arcade/${g.file}`, { next: { revalidate: 86_400 } });
    if (!r.ok) return null;
    const jpg = await sharp(Buffer.from(await r.arrayBuffer())).resize(1200, 630, { fit: 'cover' }).jpeg({ quality: 80 }).toBuffer();
    return `data:image/jpeg;base64,${jpg.toString('base64')}`;
  } catch {
    return null;
  }
}

export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const alt = 'A BlastPad coin on TokenBlaster.lol';
export const revalidate = 300;

type Row = { token_id: string; sym: string; name: string; sold: number; graduated_at: string | null; grad_rank: number | null };

const C = { bg: '#0a0404', panel: '#0e0606', text: '#ff5a48', accent: '#ff9a85', hot: '#ffd0c0', dim: '#e0958a', muted: '#b06e66', border: '#8a2222', input: '#1a0b0b', green: '#4ade80' };

/** The coin's inscribed picture as a PNG data URL (inscriptions are WebP, which the renderer can't draw). */
async function picture(tokenId: string): Promise<string | null> {
  try {
    const r = await fetch(`https://ordfs.network/${tokenId.split('_')[0]}_0`, { next: { revalidate: 86_400 } });
    if (!r.ok) return null;
    const png = await sharp(Buffer.from(await r.arrayBuffer())).resize(320, 320, { fit: 'cover' }).png().toBuffer();
    return `data:image/png;base64,${png.toString('base64')}`;
  } catch {
    return null;
  }
}

const money = (sats: number, rate: number) => {
  if (!rate) return `${(sats / 1e8).toFixed(2)} BSV`;
  const v = (sats / 1e8) * rate;
  return v >= 1000 ? `$${Math.round(v).toLocaleString('en-US')}` : `$${v.toFixed(2)}`;
};

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const font = await readFile(join(process.cwd(), 'src/assets/fonts/SpaceMono-Bold.ttf'));
  const [rows, rate] = await Promise.all([
    /^[0-9a-f]{64}_\d+$/.test(id) ? rpc<Row[]>('tokenblaster_launch_coin', { p_token: id }, false).catch(() => []) : Promise.resolve([]),
    bsvUsd(),
  ]);
  const c = rows[0];
  const [img, art] = c ? await Promise.all([picture(c.token_id), gameArt(c.token_id)]) : [null, null];
  const fresh = Number(c?.sold ?? 0) === 0;
  const sold = BigInt(c?.sold ?? 0);
  const p = progress(sold);
  const grad = Boolean(c?.graduated_at) || sold >= GRAD_SOLD;
  const mcap = marketCap(sold);
  const lit = Math.round(p * 40);

  // The real curve shape (constant product: price ∝ 1/(T0 − sold)²), with a dot where the coin is.
  const W = 420, H = 120, G = Number(GRAD_SOLD);
  const lo = price(BigInt(0)), hi = price(GRAD_SOLD);
  const pt = (s: number) => `${((Math.min(s, G) / G) * W).toFixed(1)},${(H - 8 - ((price(BigInt(Math.floor(Math.min(s, G)))) - lo) / (hi - lo)) * (H - 18)).toFixed(1)}`;
  const line = Array.from({ length: 61 }, (_, i) => `${i ? 'L' : 'M'}${pt((G * i) / 60)}`).join(' ');
  const [dx, dy] = pt(Number(sold)).split(',');

  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: C.bg, fontFamily: 'Space Mono', color: C.text, position: 'relative' }}>
        {art && (
          <>
            <img src={art} width={1200} height={630} style={{ position: 'absolute', top: 0, left: 0 }} alt="" />
            <div style={{ position: 'absolute', top: 0, left: 0, width: 1200, height: 630, display: 'flex', background: 'linear-gradient(90deg, rgba(10,4,4,0.93) 0%, rgba(10,4,4,0.82) 55%, rgba(10,4,4,0.55) 100%)' }} />
          </>
        )}
        <div style={{ position: 'absolute', top: 18, left: 18, right: 18, bottom: 18, border: `2px solid ${C.border}`, display: 'flex' }} />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '40px 56px 0', fontSize: 22 }}>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <span style={{ color: C.hot, fontSize: 30 }}>BLAST</span>
            <span style={{ color: C.text, fontSize: 30 }}>PAD</span>
            <span style={{ color: C.muted, marginLeft: 16 }}>{'// BSV-21 LAUNCHPAD'}</span>
          </div>
          <span style={{ display: 'flex', alignItems: 'center', gap: 10, color: grad ? C.accent : C.green, border: `2px solid ${grad ? C.accent : C.green}`, padding: '0 12px' }}>
            {!grad && <span style={{ width: 12, height: 12, borderRadius: 6, background: C.green, display: 'flex' }} />}
            {grad ? `GRADUATED #${c?.grad_rank ?? ''}` : 'LIVE'}
          </span>
        </div>

        <div style={{ display: 'flex', margin: '36px 56px 0', gap: 40 }}>
          {img ? (
            <img src={img} width={280} height={280} style={{ border: `3px solid ${C.border}`, boxShadow: `0 0 40px ${C.text}55` }} alt="" />
          ) : (
            <div style={{ width: 280, height: 280, border: `3px solid ${C.border}`, background: C.input, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 110, color: C.hot }}>
              {(c?.sym ?? '?').slice(0, 2)}
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
            <span style={{ fontSize: c && c.sym.length > 8 ? 76 : 96, color: C.hot, lineHeight: 1, textShadow: `0 0 24px ${C.text}` }}>${c?.sym ?? 'COIN'}</span>
            <span style={{ fontSize: 34, color: C.dim, marginTop: 8 }}>{c?.name ?? 'A BlastPad coin'}</span>
            <div style={{ display: 'flex', alignItems: 'baseline', marginTop: 22, fontSize: 26, color: C.muted }}>
              MCAP <span style={{ fontSize: 52, color: C.hot, margin: '0 16px' }}>{money(mcap, rate)}</span>
              {rate ? `${(mcap / 1e8).toFixed(2)} BSV` : ''}
            </div>
            <div style={{ display: 'flex', gap: 4, marginTop: 20, height: 22 }}>
              {Array.from({ length: 40 }, (_, i) => (
                <div key={i} style={{ flex: 1, background: i < lit ? (i === lit - 1 ? C.hot : C.accent) : C.input, opacity: i < lit ? 0.45 + (0.55 * (i + 1)) / lit : 1 }} />
              ))}
            </div>
            {fresh && (
              <span style={{ fontSize: 22, color: C.green, marginTop: 10 }}>NEW · nobody has bought yet · 0 BSV in the curve</span>
            )}
            <span style={{ fontSize: 22, color: C.muted, marginTop: 8 }}>{grad ? 'graduated · still trading on the curve' : `${(p * 100).toFixed(1)}% of the curve sold · graduates at 100%`}</span>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', margin: 'auto 56px 44px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', fontSize: 26 }}>
            <span style={{ color: C.accent }}>{(c && GAME_ART[c.token_id]?.line) ?? 'AMMO in the Arena & Double-O Satoshi'}</span>
            <span style={{ color: C.hot, fontSize: 30, marginTop: 6 }}>TOKENBLASTER.LOL/LAUNCH</span>
          </div>
          <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
            <path d={line} fill="none" stroke={C.accent} strokeWidth={3} />
            <line x1={W - 2} x2={W - 2} y1={0} y2={H} stroke={C.accent} strokeDasharray="5 5" />
            <circle cx={dx} cy={dy} r={9} fill={C.hot} />
          </svg>
        </div>
      </div>
    ),
    { ...size, fonts: [{ name: 'Space Mono', data: font, weight: 700, style: 'normal' }] },
  );
}
