'use client';

import Link from 'next/link';
import { BWALLETX_WEB, RISK_LINE, chatRoomUrl, issuerLine, type Banner, type BannerTitle } from '@/lib/launch/tokenPage';
import { ago, imageOf, short } from './data';

const WOC = 'https://whatsonchain.com';

type HeroCoin = {
  token_id: string;
  sym: string;
  name: string;
  description: string;
  creator: string;
  creator_key: string;
  launched_by?: { paymail: string | null; key: string; address: string };
  grad_rank: number | null;
  created_at: string;
  earn_url?: string;
};

/**
 * Token page hero (owner, 28 Oct 2026: "flashier token pages", modern, never retro/pixel).
 * Art as a blurred backdrop, the icon in a glowing ring, name + ticker that wrap rather than clip,
 * then the four doors: Play, Chat room, Open in bWalletX, Deploy tx. Risk line always; issuer line on third-party coins.
 */
export function Hero({
  c,
  grad,
  king,
  trading,
  ours,
  deployTx,
  watching,
  onWatch,
  copied,
  onCopy,
  onShare,
  banner,
  bannerTitle,
}: {
  c: HeroCoin;
  grad: boolean;
  king: boolean;
  trading: boolean;
  ours: boolean;
  deployTx: string;
  watching: boolean;
  onWatch: () => void;
  copied: boolean;
  onCopy: () => void;
  onShare: () => void;
  banner?: Banner;
  bannerTitle?: BannerTitle;
}) {
  const showTitle = !!banner && !!bannerTitle?.on;
  const art = imageOf(c.token_id);
  const issuer = c.launched_by?.paymail || `wallet ${short(c.launched_by?.address || c.creator)}`;
  const play = c.earn_url ? '/arcade/terrornode' : '/arena';
  return (
    <section className={`tb-hero${banner ? ' tb-hero-has-banner' : ''}${showTitle ? ' tb-hero-has-title' : ''}`} data-token-hero>
      <style>{CSS}</style>
      {banner ? (
        <>
          {/* The token's banner art sits behind the whole header block, like a game store hero. */}
          <picture className="tb-hero-banner" data-token-banner>
            <source media="(min-width: 768px)" type="image/avif" srcSet={banner.wide.avif} sizes="(min-width: 1300px) 920px, 100vw" />
            <source media="(min-width: 768px)" type="image/webp" srcSet={banner.wide.webp} sizes="(min-width: 1300px) 920px, 100vw" />
            <source type="image/avif" srcSet={banner.narrow.avif} sizes="100vw" />
            <source type="image/webp" srcSet={banner.narrow.webp} sizes="100vw" />
            { }
            <img src={banner.narrow.src} alt={banner.alt} fetchPriority="high" />
          </picture>
          <div className="tb-hero-scrim" aria-hidden />
        </>
      ) : (
        <img src={art} alt="" aria-hidden className="tb-hero-bg" /> // eslint-disable-line @next/next/no-img-element
      )}
      <div className="tb-hero-glow" aria-hidden />
      <div className="tb-hero-in">
        <p className="text-xs text-muted">
          <Link href="/launch" className="hover:text-hot">
            ← BlastPad
          </Link>{' '}
          ·{' '}
          <Link href="/tokens" className="hover:text-hot">
            All tokens
          </Link>
        </p>
        {showTitle && bannerTitle && (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="tb-hero-btitle" src={bannerTitle.src} srcSet={bannerTitle.srcSet} sizes="(min-width: 768px) 560px, 86vw" alt={bannerTitle.alt} />
        )}
        <div className="tb-hero-row">
          <div className="tb-hero-icon">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={art} alt={`$${c.sym} icon`} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              {c.name !== `$${c.sym}` && <span className="tb-chip tb-chip-sym">${c.sym}</span>}
              {grad ? <span className="tb-chip">Graduated #{c.grad_rank}</span> : trading ? <span className="tb-chip tb-chip-live">● Live on the curve</span> : <span className="tb-chip">Not trading yet</span>}
              {king && <span className="tb-chip tb-chip-hot">King of the hill</span>}
              <span className="tb-chip">BSV-21</span>
              {ours && <span className="tb-chip">by bCorp</span>}
            </div>
            <h1 className="tb-hero-title">{c.name}</h1>
            {c.description && <p className="tb-hero-desc">{c.description}</p>}
            <p className="mt-2 break-words text-xs text-muted">
              Token{' '}
              <a className="underline" href={`${WOC}/tx/${deployTx}`} target="_blank" rel="noreferrer">
                {short(deployTx)}_{c.token_id.split('_')[1]}
              </a>{' '}
              · launched {ago(c.created_at)} ago by <span className="text-fg">{issuer}</span>
            </p>
          </div>
        </div>

        <div className="tb-hero-doors">
          <Link href={play} className="tb-door tb-door-main">
            <span className="tb-door-k">Play</span>
            <span className="tb-door-v">Fire ${c.sym} ▸</span>
          </Link>
          <a href={chatRoomUrl(c.sym)} className="tb-door" target="_blank" rel="noreferrer">
            <span className="tb-door-k">Chat room</span>
            <span className="tb-door-v">bChatX ↗</span>
          </a>
          <a href={BWALLETX_WEB} className="tb-door" target="_blank" rel="noreferrer">
            <span className="tb-door-k">Wallet</span>
            <span className="tb-door-v">Open in bWalletX ↗</span>
          </a>
          <a href={`${WOC}/tx/${deployTx}`} className="tb-door" target="_blank" rel="noreferrer">
            <span className="tb-door-k">On chain</span>
            <span className="tb-door-v">Deploy tx ↗</span>
          </a>
        </div>

        <div className="mt-3 flex flex-wrap gap-1 text-xs">
          <button className="btn" onClick={onWatch}>
            {watching ? '★ Watching' : '☆ Watch'}
          </button>
          <button className="btn" onClick={onCopy}>
            {copied ? 'Copied ✓' : 'Copy link'}
          </button>
          <button className="btn" onClick={onShare}>
            Share on X
          </button>
        </div>

        <div className="tb-hero-risk" data-risk-line>
          <p>{RISK_LINE}</p>
          {!ours && <p data-issuer-line>{issuerLine(issuer)}</p>}
        </div>
      </div>
    </section>
  );
}

/** A live stat card: big number, small line under it, optional progress bar. */
export function StatCard({ label, value, sub, bar, live }: { label: string; value: string; sub?: string; bar?: number; live?: boolean }) {
  return (
    <div className="tb-stat">
      <p className="tb-stat-k">
        {live && <span className="tb-pulse" aria-hidden />}
        {label}
      </p>
      <p className="tb-stat-v">{value}</p>
      {sub && <p className="tb-stat-s">{sub}</p>}
      {bar !== undefined && (
        <div className="tb-stat-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(bar * 100)} aria-label={label}>
          <span style={{ width: `${Math.min(100, Math.max(0, bar * 100))}%` }} />
        </div>
      )}
    </div>
  );
}

const CSS = `
.tb-hero{position:relative;overflow:hidden;border-radius:20px;border:1px solid color-mix(in srgb,var(--hot) 14%,transparent);background:var(--panel);isolation:isolate}
.tb-hero-bg{position:absolute;inset:-40px;width:calc(100% + 80px);height:calc(100% + 80px);object-fit:cover;filter:blur(48px) saturate(1.4);opacity:.35;z-index:-2}
.tb-hero-glow{position:absolute;inset:0;z-index:-1;background:radial-gradient(120% 90% at 0% 0%,color-mix(in srgb,var(--accent) 30%,transparent),transparent 60%),linear-gradient(180deg,transparent 30%,var(--panel) 100%)}
.tb-hero-in{padding:clamp(16px,3vw,32px)}
.tb-hero-banner{position:absolute;top:0;left:0;right:0;z-index:-2;display:block}
.tb-hero-banner img{display:block;width:100%;aspect-ratio:1200/580;object-fit:cover;object-position:50% 30%}
@media (min-width:768px){.tb-hero-banner img{aspect-ratio:1500/430}}
/* Scrim: light at the top so the art reads, dark by the banner's lower edge so the block on top is legible, then the panel. */
.tb-hero-scrim{position:absolute;top:0;left:0;right:0;z-index:-1;aspect-ratio:1200/580;background:linear-gradient(180deg,rgba(0,0,0,.25) 0%,rgba(0,0,0,.1) 25%,color-mix(in srgb,var(--panel) 70%,transparent) 70%,var(--panel) 100%)}
@media (min-width:768px){.tb-hero-scrim{aspect-ratio:1500/430}}
.tb-hero-has-banner .tb-hero-glow{background:radial-gradient(80% 60% at 0% 100%,color-mix(in srgb,var(--accent) 18%,transparent),transparent 60%)}
/* The block starts part-way down the banner, so the icon straddles its lower edge. Padding % is of the hero's width. */
.tb-hero-has-banner .tb-hero-in{padding-top:calc(48.33% - 120px)}
@media (min-width:768px){.tb-hero-has-banner .tb-hero-in{padding-top:max(16px,calc(28.67% - 150px))}}
.tb-hero-has-banner .tb-hero-in>p:first-child a,.tb-hero-has-banner .tb-hero-in>p:first-child{text-shadow:0 1px 6px #000}
.tb-hero-has-banner .tb-hero-title,.tb-hero-has-banner .tb-hero-desc{text-shadow:0 2px 12px #000,0 0 2px #000}
.tb-hero-has-banner .tb-hero-desc{color:var(--text)}
/* Optional title in the banner's sky: drips stay inside the hero, clear of the icon and doors. */
.tb-hero-btitle{display:block;width:min(86%,560px);height:auto;margin:4px auto 0;filter:drop-shadow(0 6px 18px rgba(0,0,0,.55))}
.tb-hero-has-title .tb-hero-in{padding-top:12px}
@media (min-width:768px){.tb-hero-has-title .tb-hero-in{padding-top:16px}.tb-hero-has-title .tb-hero-btitle{width:min(48%,560px)}}

.tb-hero-row{display:flex;gap:clamp(14px,2.5vw,28px);align-items:center;margin-top:12px;flex-wrap:wrap}
.tb-hero-icon{flex:none;width:clamp(84px,14vw,140px);aspect-ratio:1;border-radius:24px;padding:3px;background:conic-gradient(from 210deg,var(--accent),var(--accent-2),var(--accent));box-shadow:0 0 40px -6px var(--accent),0 20px 40px -20px #000}
.tb-hero-icon img{width:100%;height:100%;object-fit:cover;border-radius:21px;background:var(--bg)}
.tb-hero-title{margin-top:8px;font-family:var(--font-display);font-weight:900;font-style:italic;color:var(--hot);font-size:clamp(28px,5.2vw,64px);line-height:1;letter-spacing:-.01em;overflow-wrap:anywhere;text-shadow:0 2px 30px color-mix(in srgb,var(--accent) 45%,transparent)}
.tb-hero-desc{margin-top:10px;max-width:62ch;color:var(--dim);font-size:14px;line-height:1.5}
.tb-chip{display:inline-flex;align-items:center;gap:4px;border-radius:999px;padding:3px 10px;font-size:11px;font-weight:700;letter-spacing:.04em;color:var(--text);background:color-mix(in srgb,var(--hot) 8%,transparent);border:1px solid color-mix(in srgb,var(--hot) 16%,transparent);backdrop-filter:blur(8px)}
.tb-chip-sym{color:var(--on-accent);background:var(--accent-fill);border-color:transparent}
.tb-chip-live{color:#3ee08f;border-color:#3ee08f55}
.tb-chip-hot{color:var(--accent-2);border-color:color-mix(in srgb,var(--accent-2) 50%,transparent)}
.tb-hero-doors{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-top:18px}
@media (max-width:640px){.tb-hero-doors{grid-template-columns:repeat(2,minmax(0,1fr))}}
.tb-door{display:flex;flex-direction:column;gap:2px;padding:12px 14px;border-radius:14px;background:color-mix(in srgb,var(--hot) 6%,transparent);border:1px solid color-mix(in srgb,var(--hot) 12%,transparent);backdrop-filter:blur(10px);transition:transform .15s ease,border-color .15s ease,background .15s ease;min-width:0}
.tb-door:hover{transform:translateY(-2px);border-color:var(--accent)}
.tb-door-main{background:linear-gradient(135deg,var(--accent-fill),color-mix(in srgb,var(--accent-fill) 60%,#000));border-color:transparent;box-shadow:0 10px 30px -12px var(--accent)}
.tb-door-main .tb-door-k,.tb-door-main .tb-door-v{color:var(--on-accent)}
.tb-door-k{font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--muted)}
.tb-door-v{font-weight:700;color:var(--hot);font-size:14px;overflow-wrap:anywhere}
.tb-hero-risk{margin-top:14px;padding:10px 12px;border-radius:12px;font-size:12px;color:var(--text);background:color-mix(in srgb,var(--accent) 10%,transparent);border:1px solid color-mix(in srgb,var(--accent) 35%,transparent)}
.tb-stat{position:relative;overflow:hidden;border-radius:16px;padding:14px 16px;background:linear-gradient(160deg,color-mix(in srgb,var(--hot) 7%,var(--panel)),var(--panel));border:1px solid color-mix(in srgb,var(--hot) 12%,transparent);min-width:0}
.tb-stat::after{content:"";position:absolute;inset:auto -20% -60% auto;width:120px;height:120px;border-radius:50%;background:radial-gradient(color-mix(in srgb,var(--accent) 25%,transparent),transparent 70%)}
.tb-stat-k{display:flex;align-items:center;gap:6px;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--muted)}
.tb-stat-v{margin-top:6px;font-size:clamp(18px,2.4vw,26px);font-weight:800;color:var(--hot);overflow-wrap:anywhere;line-height:1.1}
.tb-stat-s{margin-top:4px;font-size:11px;color:var(--dim);overflow-wrap:anywhere}
.tb-stat-bar{margin-top:10px;height:6px;border-radius:999px;background:color-mix(in srgb,var(--hot) 10%,transparent);overflow:hidden}
.tb-stat-bar span{display:block;height:100%;border-radius:inherit;background:linear-gradient(90deg,var(--accent-fill),var(--accent-2));box-shadow:0 0 12px var(--accent)}
.tb-pulse{width:7px;height:7px;border-radius:50%;background:#3ee08f;box-shadow:0 0 0 0 #3ee08f88;animation:tbpulse 1.6s infinite}
@keyframes tbpulse{70%{box-shadow:0 0 0 7px #3ee08f00}100%{box-shadow:0 0 0 0 #3ee08f00}}
@media (prefers-reduced-motion:reduce){.tb-pulse{animation:none}.tb-door{transition:none}}
`;
