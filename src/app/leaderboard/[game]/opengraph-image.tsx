/**
 * Share card for one board's champion: game, name (or @handle), score, in the DR poster style (hazard bands, red and
 * amber on ink). Fonts: Audiowide fetched for the glyphs on the card, Space Mono Bold from the repo as the fallback.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ImageResponse } from 'next/og';
import sharp from 'sharp';
import { boardRows, cabinetOfBoard, fmtSecs, playerOf } from '@/lib/hallOfFame';
import { avatarUrl } from '@/lib/identity';
import { isScoreGame, SCORE_GAMES } from '@/lib/scores';

export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const alt = 'A TokenBlaster hall of fame champion';
export const revalidate = 300;

const C = { ink: '#0a0a0c', red: '#e8261d', amber: '#ffb800', paper: '#f2efe6', grey: '#8a8a92' };

async function audiowide(text: string): Promise<ArrayBuffer | null> {
  try {
    const css = await (await fetch(`https://fonts.googleapis.com/css2?family=Audiowide&text=${encodeURIComponent(text)}`, { next: { revalidate: 86_400 } })).text();
    const url = css.match(/src: url\((.+?)\) format\('(?:opentype|truetype)'\)/)?.[1];
    if (!url) return null;
    const r = await fetch(url, { next: { revalidate: 86_400 } });
    return r.ok ? await r.arrayBuffer() : null;
  } catch {
    return null;
  }
}

/** The champion's X avatar as a PNG data URL (the renderer can't draw WebP/SVG). */
async function avatar(handle: string): Promise<string | null> {
  try {
    const r = await fetch(`https://www.tokenblaster.lol${avatarUrl(handle)}`, { next: { revalidate: 3600 } });
    if (!r.ok) return null;
    const png = await sharp(Buffer.from(await r.arrayBuffer())).resize(200, 200, { fit: 'cover' }).png().toBuffer();
    return `data:image/png;base64,${png.toString('base64')}`;
  } catch {
    return null;
  }
}

const stripes = `repeating-linear-gradient(-45deg, ${C.amber} 0px, ${C.amber} 18px, ${C.ink} 18px, ${C.ink} 36px)`;

export default async function Image({ params }: { params: Promise<{ game: string }> }) {
  const { game } = await params;
  const known = isScoreGame(game);
  const title = known ? SCORE_GAMES[game].title : 'TokenBlaster';
  const top = known ? (await boardRows(game, 'all', 3)).slice(0, 3) : [];
  const champ = top[0];
  const p = champ ? playerOf(champ) : null;
  const unit = known ? (cabinetOfBoard(game)?.unit ?? 'pts') : 'pts';
  const [mono, aw, img] = await Promise.all([
    readFile(join(process.cwd(), 'src/assets/fonts/SpaceMono-Bold.ttf')),
    audiowide(`ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz #@_.,:'\-0123456789${title}${p?.name ?? ''}${unit}TOKENBLASTER.LOL`),
    p?.handle ? avatar(p.handle) : Promise.resolve(null),
  ]);
  const disp = aw ? 'Audiowide' : 'Space Mono';
  const nameSize = !p ? 90 : p.name.length > 14 ? 78 : 110;

  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: C.ink, color: C.paper, fontFamily: 'Space Mono', position: 'relative' }}>
        <div style={{ display: 'flex', height: 30, background: stripes }} />
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, padding: '28px 56px 0' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ display: 'flex', fontFamily: disp, fontSize: 34, color: C.amber }}>HALL OF FAME</span>
            <span style={{ display: 'flex', fontSize: 24, color: C.grey }}>TB-HOF / {known ? game.toUpperCase() : 'ALL'}</span>
          </div>
          <span style={{ display: 'flex', fontFamily: disp, fontSize: title.length > 26 ? 44 : 58, color: C.paper, marginTop: 18 }}>{title}</span>
          {champ && p ? (
            <div style={{ display: 'flex', alignItems: 'center', marginTop: 26, gap: 30 }}>
              {img && <img src={img} width={170} height={170} alt="" style={{ border: `4px solid ${C.red}` }} />}
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span style={{ display: 'flex', fontFamily: disp, fontSize: 30, color: C.red }}>#1 CHAMPION</span>
                <span style={{ display: 'flex', fontFamily: disp, fontSize: nameSize, color: C.paper, lineHeight: 1.05 }}>{p.name}</span>
                <span style={{ display: 'flex', alignItems: 'baseline', gap: 16, marginTop: 6 }}>
                  <span style={{ display: 'flex', fontFamily: disp, fontSize: 84, color: C.amber }}>{champ.score.toLocaleString('en-US')}</span>
                  <span style={{ display: 'flex', fontSize: 28, color: C.grey }}>
                    {unit}
                    {champ.secs > 0 ? ` · ${fmtSecs(champ.secs)}` : ''}
                    {champ.verified ? ' · verified on chain' : ''}
                  </span>
                </span>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', marginTop: 40 }}>
              <span style={{ display: 'flex', fontFamily: disp, fontSize: nameSize, color: C.paper }}>NO RECORD YET</span>
              <span style={{ display: 'flex', fontSize: 34, color: C.amber, marginTop: 10 }}>Be first on the board.</span>
            </div>
          )}
          <div style={{ display: 'flex', marginTop: 'auto', marginBottom: 26, alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ display: 'flex', fontSize: 26, color: C.grey }}>Every bullet = 1 real BSV transaction</span>
            <span style={{ display: 'flex', fontFamily: disp, fontSize: 34, color: C.paper, borderBottom: `5px solid ${C.red}` }}>TOKENBLASTER.LOL</span>
          </div>
        </div>
        <div style={{ display: 'flex', height: 30, background: stripes }} />
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: 'Space Mono', data: mono, weight: 700, style: 'normal' },
        ...(aw ? [{ name: 'Audiowide', data: aw, weight: 400 as const, style: 'normal' as const }] : []),
      ],
    },
  );
}
