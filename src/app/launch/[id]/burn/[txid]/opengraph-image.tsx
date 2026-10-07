/** Share card for one vault burn: "🔥 N $SYM BURNED", supply now, txid. BlastPad's red phosphor look. */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ImageResponse } from 'next/og';
import { fmtBurn } from '@/lib/launch/burn';
import { burnOf } from '@/lib/launch/burnData';
import { fmtTokens } from '@/lib/launch/curve';

export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const alt = 'A BlastPad buyback burn on TokenBlaster.lol';
export const revalidate = 300;

const C = { bg: '#0a0404', text: '#ff5a48', accent: '#ff9a85', hot: '#ffd0c0', dim: '#e0958a', muted: '#b06e66', border: '#8a2222', input: '#1a0b0b' };

export default async function Image({ params }: { params: Promise<{ id: string; txid: string }> }) {
  const { id, txid } = await params;
  const font = await readFile(join(process.cwd(), 'src/assets/fonts/SpaceMono-Bold.ttf'));
  const b = await burnOf(id, txid);
  const sym = b?.sym ?? 'COIN';
  const head = b ? `${fmtBurn(b.tokens)} $${sym}` : `$${sym}`;
  const lit = b ? Math.max(1, Math.min(40, Math.round(b.pct * 4))) : 0; // 10% burned fills the bar

  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: C.bg, fontFamily: 'Space Mono', color: C.text, position: 'relative' }}>
        <div style={{ position: 'absolute', top: 18, left: 18, right: 18, bottom: 18, border: `2px solid ${C.border}`, display: 'flex' }} />
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 260, display: 'flex', background: 'linear-gradient(0deg, rgba(255,90,72,0.28) 0%, rgba(10,4,4,0) 100%)' }} />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '40px 56px 0', fontSize: 22 }}>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <span style={{ color: C.hot, fontSize: 30 }}>BLAST</span>
            <span style={{ color: C.text, fontSize: 30 }}>PAD</span>
            <span style={{ color: C.muted, marginLeft: 16 }}>{'// BUYBACK & BURN'}</span>
          </div>
          <span style={{ color: C.accent, border: `2px solid ${C.accent}`, padding: '0 12px' }}>ON CHAIN</span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', margin: '50px 56px 0' }}>
          <span style={{ fontSize: 40, color: C.accent }}>{'/// BURNED ///'}</span>
          <span style={{ fontSize: head.length > 16 ? 92 : 116, color: C.hot, lineHeight: 1.05, textShadow: `0 0 30px ${C.text}` }}>{head}</span>
          <span style={{ fontSize: 28, color: C.dim, marginTop: 14 }}>bought back on the curve by the coin&apos;s own fees, sent to the burn address</span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', margin: '34px 56px 0' }}>
          <div style={{ display: 'flex', gap: 4, height: 22 }}>
            {Array.from({ length: 40 }, (_, i) => (
              <div key={i} style={{ flex: 1, background: i < lit ? (i === lit - 1 ? C.hot : C.text) : C.input }} />
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 24, color: C.muted, marginTop: 10 }}>
            <span>{b ? `${fmtTokens(b.burned)} burned so far · ${b.pct.toFixed(2)}% of supply` : 'burn not found'}</span>
            <span>{b ? `supply now ${fmtTokens(b.supplyNow)}` : ''}</span>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', margin: 'auto 56px 44px', fontSize: 22 }}>
          <span style={{ color: C.muted }}>tx {txid.slice(0, 16)}…{txid.slice(-8)}</span>
          <span style={{ color: C.hot, fontSize: 30 }}>TOKENBLASTER.LOL/LAUNCH</span>
        </div>
      </div>
    ),
    { ...size, fonts: [{ name: 'Space Mono', data: font, weight: 700, style: 'normal' }] },
  );
}
