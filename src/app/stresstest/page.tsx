/**
 * /stresstest (owner, 8 Nov 2026): the 31 Oct BSV stress test report, TERRORNODE Halloween look.
 * Static: every figure is in src/lib/stresstest; anything you'd need to trust links to the chain.
 */
import Link from 'next/link';
import { tbxFontClass } from '@/components/coinop/fonts';
import '@/components/coinop/ui.css';
import './stresstest.css';
import { BLOCKS, BOT_WALLET, FANOUT_LIST, FLAGS, RUNS, SHOTS, SWEEP, TOTALS, USD_PER_BSV, addrUrl, blockUrl, txUrl } from '@/lib/stresstest/data';
import { SERIES } from '@/lib/stresstest/series';
import { TERRORNODE_CARD, shareImages } from '@/lib/og';

const description =
  '9,183,007 BSV transactions in one day: 20 TERRORNODE bots, 0 rejected, 0 orphaned. The full report on our 31 Oct 2026 BSV stress test, with every figure linked to the chain.';
export const metadata = {
  title: 'Stress test report · 31 Oct 2026 · TERRORNODE',
  description,
  openGraph: { title: 'TERRORNODE stress test: 9,183,007 transactions', description, url: '/stresstest', images: shareImages(TERRORNODE_CARD).openGraph },
  twitter: { card: 'summary_large_image', title: 'TERRORNODE stress test: 9,183,007 transactions', description, images: shareImages(TERRORNODE_CARD).twitter },
};

const n = (x: number) => x.toLocaleString('en-GB');
const bsv = (sats: number) => (sats / 1e8).toLocaleString('en-GB', { maximumFractionDigits: 4 });
const dur = (s: number) => (s >= 3600 ? `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min` : s >= 120 ? `${Math.round(s / 60)} min` : `${Math.round(s)} s`);
const short = (id: string) => `${id.slice(0, 10)}…${id.slice(-6)}`;
const hhmm = (t: number) => new Date(t * 1000).toISOString().slice(11, 16);
const gb = (b: number) => (b / 1e9).toLocaleString('en-GB', { maximumFractionDigits: 2 });

const RUN_COLOURS: Record<string, string> = { r1: '#a98bff', r3: '#ff2a2a', r4: '#ff7a1a', r5: '#ffc04a', r6: '#ff4f7a', r7: '#9dff4a' };
const SPOOKS = ['🦇', '👻', '🎃', '💀', '🦇', '🕷️', '👻', '🎃', '🦇', '💀', '🕸️', '🦇', '👻', '🎃'];

function Ext({ href, children, className = 'tn-link' }: { href: string; children: React.ReactNode; className?: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={className}>
      {children}
    </a>
  );
}

/** Accepted tx/s per minute, 12:00 to 18:30 UTC, one filled area per run. */
function SpeedChart() {
  const W = 1000, H = 300, L = 46, R = 12, T = 16, B = 30;
  const x0 = 720, x1 = 1110, yMax = 1800;
  const X = (m: number) => L + ((m - x0) / (x1 - x0)) * (W - L - R);
  const Y = (v: number) => T + (1 - v / yMax) * (H - T - B);
  const ticks = [0, 600, 1200, 1800];
  const hours = [12, 13, 14, 15, 16, 17, 18];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Accepted transactions a second, minute by minute, 12:00 to 18:30 UTC on 31 October">
      <defs>
        {Object.entries(RUN_COLOURS).map(([k, c]) => (
          <linearGradient key={k} id={`g-${k}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor={c} stopOpacity="0.75" />
            <stop offset="1" stopColor={c} stopOpacity="0.04" />
          </linearGradient>
        ))}
      </defs>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={L} x2={W - R} y1={Y(t)} y2={Y(t)} stroke="rgba(255,140,100,0.12)" strokeDasharray={t ? '3 5' : undefined} />
          <text x={L - 8} y={Y(t) + 4} textAnchor="end" fontSize="11" fill="#a8968a">{n(t)}</text>
        </g>
      ))}
      {hours.map((h) => (
        <text key={h} x={X(h * 60)} y={H - 8} textAnchor="middle" fontSize="11" fill="#a8968a">{`${h}:00`}</text>
      ))}
      {Object.entries(SERIES).map(([k, pts]) => {
        const line = pts.map(([m, v], i) => `${i ? 'L' : 'M'}${X(m).toFixed(1)},${Y(v).toFixed(1)}`).join(' ');
        const area = `${line} L${X(pts[pts.length - 1][0]).toFixed(1)},${Y(0)} L${X(pts[0][0]).toFixed(1)},${Y(0)} Z`;
        return (
          <g key={k}>
            <path d={area} fill={`url(#g-${k})`} />
            <path d={line} fill="none" stroke={RUN_COLOURS[k]} strokeWidth="1.8" strokeLinejoin="round" />
          </g>
        );
      })}
      {/* best minute: run 3, 13:26 UTC */}
      <g>
        <circle cx={X(806)} cy={Y(1575)} r="5" fill="#fff3d6" stroke="#ff2a2a" strokeWidth="2" />
        <text x={X(806) + 10} y={Y(1575) - 6} fontSize="12" fill="#f4ead6" fontWeight="700">best minute ≈ 1,600 tx/s</text>
      </g>
    </svg>
  );
}

export default function StressTestPage() {
  const realRuns = RUNS.filter((r) => r.accepted > 0);
  const maxAcc = Math.max(...RUNS.map((r) => r.accepted));
  const maxBlock = Math.max(...BLOCKS.map((b) => b.txs));
  const usd = (TOTALS.fees / 1e8) * USD_PER_BSV;
  const perShot = TOTALS.fees / TOTALS.accepted;
  const busiest = realRuns.reduce((a, r) => (r.accepted > a.accepted ? r : a));

  return (
    <main className={`${tbxFontClass} tn`}>
      {/* ---------------- HERO ---------------- */}
      <section className="tn-hero">
        <div className="tn-hero-art" aria-hidden />
        <div className="tn-moon" aria-hidden />
        <div className="tn-spooks" aria-hidden>
          {SPOOKS.map((s, i) => (
            <span
              key={i}
              style={{
                ['--x' as string]: `${(i * 71) % 100}%`,
                ['--s' as string]: `${18 + ((i * 7) % 22)}px`,
                ['--dur' as string]: `${16 + ((i * 5) % 14)}s`,
                ['--d' as string]: `${-((i * 3.7) % 20)}s`,
                ['--sway' as string]: `${i % 2 ? '' : '-'}${20 + ((i * 13) % 50)}px`,
              }}
            >
              {s}
            </span>
          ))}
        </div>
        <div className="tn-hero-in">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/terrornode-banner.jpg" alt="Welcome to TERRORNODE" className="tn-banner mb-8" width={1500} height={500} />
          <div className="tn-kicker">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/terrornode-skull.png" alt="TERRORNODE" className="tn-skull" width={64} height={64} />
            <div>
              <p className="tn-eyebrow">BSV stress test · Halloween · 31 October 2026</p>
              <p className="tn-title mt-1">
                The night the <span className="tn-drip">bots</span> stormed the node
              </p>
            </div>
          </div>
          <h1 className="tn-big mt-6">{n(TOTALS.accepted)}</h1>
          <p className="mt-2 max-w-[62ch] text-[clamp(16px,2.1vw,21px)] leading-snug text-[#f1e2cf]">
            transactions fired at the Bitcoin SV network by 20 TERRORNODE bots in one day, every one a real, signed, fee-paying transaction.
          </p>
          <div className="tn-verdict mt-6">
            <span className="tn-pill tn-pill-ok">✓ Accepted <b>{n(TOTALS.accepted)}</b></span>
            <span className="tn-pill tn-pill-ok">Rejected <b>0</b></span>
            <span className="tn-pill tn-pill-ok">Orphaned <b>0</b></span>
            <span className="tn-pill">🔥 Peak <b>{n(TOTALS.peak1s)}</b> tx/s</span>
          </div>
          <div className="mt-7 flex flex-wrap gap-2">
            <a href="#runs" className="tn-cta">💀 The runs</a>
            <a href="#verify" className="tn-cta tn-cta-ghost">🔍 Check it on chain</a>
            <Link href="/arcade/terrornode" className="tn-cta tn-cta-ghost">🎃 Play TERRORNODE</Link>
          </div>
        </div>
      </section>

      {/* ---------------- KPIs ---------------- */}
      <div className="tn-wrap">
        <section className="tn-section">
          <div className="tn-kpis">
            {[
              { icon: '⚡', v: n(TOTALS.peak1s), u: 'tx/s', l: 'Fastest second', note: `Run 3. The busiest full minute averaged ${n(TOTALS.peakMin)} tx/s.` },
              { icon: '🦇', v: n(busiest.accepted), u: '', l: 'Biggest run', note: `${busiest.name}: ${dur(busiest.secs)} non-stop, ${n(Math.round(busiest.accepted / busiest.secs))} tx/s on average.` },
              { icon: '🎃', v: bsv(TOTALS.fees), u: 'BSV', l: 'All network fees', note: `About $${Math.round(usd)} at $${USD_PER_BSV}/BSV: ${perShot.toFixed(1)} sats a transaction, fan-outs included.` },
              { icon: '⏱️', v: '1.0', u: 's', l: 'Typical accept time', note: 'Median from send to accepted in the big runs; 95% inside about 2.5 s. Run 7: 0.33 s.' },
              { icon: '📦', v: gb(TOTALS.bytes), u: 'GB', l: 'Of transactions', note: 'Bytes sent to the network: shots of about 300 to 390 bytes each.' },
              { icon: '🕸️', v: n(TOTALS.fanouts), u: '', l: 'Fan-outs', note: 'Each one split a coin into 10,000 to 15,430 lanes for the bots to fire down.' },
              { icon: '🔍', v: n(TOTALS.sampled), u: '', l: 'Spot-checked', note: `Shots whose status we asked for after sending. ${n(TOTALS.seen)} were already seen by the network; 0 rejected, 0 orphaned.` },
              { icon: '👹', v: '14', u: 'h', l: 'On the clock', note: 'First shot 04:33 UTC, last 18:25 UTC. The heavy runs went from 12:47 to 18:25.' },
            ].map((k, i) => (
              <div key={k.l} className="tn-panel tn-kpi tbx-rise" style={{ ['--d' as string]: `${i * 0.05}s` }}>
                <span className="tn-kpi-icon" aria-hidden>{k.icon}</span>
                <div className="tn-kpi-v">{k.v}{k.u && <small>{k.u}</small>}</div>
                <div className="tn-kpi-l">{k.l}</div>
                <p className="tn-kpi-n">{k.note}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ---------------- CHART ---------------- */}
        <section className="tn-section">
          <p className="tn-eyebrow">Minute by minute</p>
          <h2 className="tn-h2 mt-2">The <em>storm</em>, 12:00 to 18:30 UTC</h2>
          <p className="tn-lede mt-3">
            Accepted transactions a second, averaged over each minute, from the bots&apos; own logs. The gaps are the pauses between runs, while we fixed whatever the last run had found.
          </p>
          <div className="tn-panel tn-chart tn-web mt-5 p-3 sm:p-5">
            <SpeedChart />
            <div className="tn-legend mt-3">
              {RUNS.filter((r) => RUN_COLOURS[r.id]).map((r) => (
                <span key={r.id}><i style={{ background: RUN_COLOURS[r.id] }} />{r.name} · {n(r.accepted)}</span>
              ))}
            </div>
          </div>
        </section>
      </div>

      {/* ---------------- FLAG TICKER ---------------- */}
      <div className="tn-ticker mt-14" aria-label="The flags the bots carried">
        <div className="tn-ticker-row">
          {[...FLAGS, ...FLAGS].map((f, i) => <span key={i} aria-hidden={i >= FLAGS.length}>{f}</span>)}
        </div>
      </div>

      <div className="tn-wrap">
        {/* ---------------- RUNS ---------------- */}
        <section id="runs" className="tn-section scroll-mt-20">
          <p className="tn-eyebrow">Run by run</p>
          <h2 className="tn-h2 mt-2">Nine <em>runs</em>, one long night</h2>
          <p className="tn-lede mt-3">
            Each run ended on purpose: a safety stop, a budget, or a finish. When broadcast errors passed 5% of the last 5,000 sends, the runner stopped itself. Those errors were timeouts it retried, not rejections. There is no gap in the numbering: run 2 was stopped before it fired a shot.
          </p>
          <div className="tn-runs mt-6">
            {RUNS.map((r, i) => (
              <article key={r.id} className="tn-panel tn-run tbx-rise" style={{ ['--d' as string]: `${i * 0.04}s` }}>
                <div className="tn-run-top">
                  <div className="flex flex-col gap-1.5">
                    <span className="tn-run-name">{r.name}</span>
                    <span className="text-xs text-[#bfae9e]">{r.start.slice(0, 5)} – {r.end.slice(0, 5)} UTC · {dur(r.secs)}</span>
                  </div>
                  <div className="text-right">
                    <div className="tn-run-acc">{n(r.accepted)}</div>
                    <div className="mt-1 text-[10px] font-bold uppercase tracking-[0.18em] text-[#a8968a]">accepted</div>
                  </div>
                </div>
                <div className="tn-bar" aria-hidden><i style={{ width: `${Math.max(0.6, (r.accepted / maxAcc) * 100)}%` }} /></div>
                <dl className="tn-facts">
                  <div><dt>Avg</dt><dd>{r.accepted ? `${n(Math.round(r.accepted / r.secs))} tx/s` : '–'}</dd></div>
                  <div><dt>Peak sec</dt><dd>{r.peak1s ? `${n(r.peak1s)} tx/s` : '–'}</dd></div>
                  <div><dt>Fees</dt><dd>{bsv(r.fees)} BSV</dd></div>
                  <div><dt>Bots</dt><dd>{r.bots}</dd></div>
                  <div><dt>Fan-outs</dt><dd>{n(r.fanouts)}</dd></div>
                  <div><dt>Median</dt><dd>{r.p50 ? `${(r.p50 / 1000).toFixed(r.p50 > 10_000 ? 0 : 2)} s` : '–'}</dd></div>
                </dl>
                <p className="tn-stop">{r.stop}</p>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className={`tn-tag ${r.label === 'Halloween flags' ? '' : 'tn-tag-off'}`}>{r.label === 'Halloween flags' ? '🎃 Halloween flags' : 'Labelled with bot names'}</span>
                  <Ext href={txUrl(r.firstFan)}>First fan-out {short(r.firstFan)} ↗</Ext>
                </div>
              </article>
            ))}
          </div>
        </section>

        {/* ---------------- ANATOMY ---------------- */}
        <section className="tn-section">
          <p className="tn-eyebrow">What one shot looks like</p>
          <h2 className="tn-h2 mt-2">Anatomy of a <em>bullet</em></h2>
          <p className="tn-lede mt-3">
            Every shot is a tiny transaction: one input, two outputs, about 260 to 390 bytes. It spends the shot before it in its lane, pays a fee of about 27 to 36 sats, passes the rest on, and shouts a message in an OP_RETURN.
          </p>
          <div className="tn-anatomy mt-6">
            <div className="tn-panel tn-web p-4 sm:p-5">
              <p className="tn-eyebrow mb-2">The OP_RETURN, push by push</p>
              {[
                ['1', 'tokenblaster.lol', 'Who fired it: the site tag every TokenBlaster shot carries.'],
                ['2', '(ammo)', 'A short binary field: the kind of round fired.'],
                ['3', '148489', "The shot's number in that bot's run."],
                ['4', 'terrornode', 'The game.'],
                ['5', '🎃👻💀 PLAY TERRORNODE · tokenblaster.lol/arcade/terrornode 💀👻🎃', 'The flag. From run 4 on, each bot rotated through 16 flags, one per shot.'],
              ].map(([k, code, what]) => (
                <div key={k} className="tn-push"><b>{k}</b><div><code>{code}</code><span>{what}</span></div></div>
              ))}
              <p className="mt-3 text-xs text-[#a8968a]">Outputs: the OP_RETURN (0 sats) and the lane&apos;s change, which the next shot spends.</p>
            </div>
            <div className="flex flex-col gap-3">
              {SHOTS.map((s) => (
                <div key={s.txid} className="tn-panel tn-shot">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-bold uppercase tracking-[0.12em]">{s.bot}</span>
                    <span className="text-xs text-[#bfae9e]">shot #{n(Number(s.n))} · {s.time} UTC · {s.bytes} bytes</span>
                  </div>
                  <p className="tn-shot-flag">{s.flag}</p>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                    <Ext href={txUrl(s.txid)}>tx {short(s.txid)} ↗</Ext>
                    <Ext href={blockUrl(s.block)}>block {n(s.block)} ↗</Ext>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ---------------- HOW ---------------- */}
        <section className="tn-section">
          <p className="tn-eyebrow">How it ran</p>
          <h2 className="tn-h2 mt-2">The <em>machine</em></h2>
          <div className="tn-steps mt-6">
            <div className="tn-panel tn-step"><h3>Fan out</h3><p>Each bot splits one coin into a fan-out of 10,000 to 15,430 small outputs, its lanes. Only a few fan-outs go out at a time and the bots start a few seconds apart, so the broadcaster isn&apos;t swamped with half-megabyte transactions.</p></div>
            <div className="tn-panel tn-step"><h3>Chain the shots</h3><p>Once a fan-out is seen by the network, the bot fires down every lane: each shot spends the last one, so one lane is a chain of shots. Signing runs on one Mac mini, about 850 a second in the big runs.</p></div>
            <div className="tn-panel tn-step"><h3>Broadcast</h3><p>Shots go out in batches to GorillaPool&apos;s Arcade broadcaster, at 100 sats per kB. About 1 in 100 shots is checked again afterwards, to catch rejections and orphans.</p></div>
            <div className="tn-panel tn-step"><h3>Stay safe</h3><p>Spending caps per bot and per run, a kill switch, an automatic stop at 5% broadcast errors, and a journal of spent coins on disk, so a coin is never spent twice, even after a restart.</p></div>
          </div>
        </section>

        {/* ---------------- BLOCKS ---------------- */}
        <section className="tn-section">
          <p className="tn-eyebrow">On chain</p>
          <h2 className="tn-h2 mt-2">The <em>blocks</em> that carried it</h2>
          <p className="tn-lede mt-3">
            Blocks 973,462 to 973,488 were mined while our runs were landing. The whole network was stress testing that day, so these counts include every team&apos;s traffic, not just ours. Two blocks topped 3 million transactions: 973,465 (3,184,172, mined during run 3) and 973,479 (4,014,228).
          </p>
          <div className="tn-panel tn-blocks mt-5 p-2 sm:p-3">
            <table>
              <thead>
                <tr><th>Block</th><th>Mined (UTC)</th><th>Miner</th><th className="text-right">Transactions</th><th className="tn-cell-bar" aria-label="Share of the biggest block" /><th className="text-right">Size</th></tr>
              </thead>
              <tbody>
                {BLOCKS.map((b) => (
                  <tr key={b.h} className={b.txs > 1_000_000 ? 'tn-hot' : undefined}>
                    <td><Ext href={blockUrl(b.h)}>{n(b.h)}</Ext></td>
                    <td>{hhmm(b.t)}</td>
                    <td>{b.miner}</td>
                    <td className="text-right font-semibold">{n(b.txs)}</td>
                    <td className="tn-cell-bar"><div className="tn-bar"><i style={{ width: `${Math.max(0.4, (b.txs / maxBlock) * 100)}%` }} /></div></td>
                    <td className="text-right">{b.bytes >= 1e6 ? `${(b.bytes / 1e6).toFixed(0)} MB` : `${(b.bytes / 1e3).toFixed(0)} kB`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* ---------------- CLEAN-UP ---------------- */}
        <section className="tn-section">
          <p className="tn-eyebrow">Morning after</p>
          <h2 className="tn-h2 mt-2">Sweeping up the <em>bones</em></h2>
          <div className="tn-panel tn-web mt-5 p-4 sm:p-5">
            <p className="tn-lede">
              When the runs stopped, thousands of lanes still held a few sats each. On 1 November, {n(SWEEP.txs[0] + SWEEP.txs[1])} sweep transactions ({n(SWEEP.txs[0])} + {n(SWEEP.txs[1])}) gathered them up. The leftover, <b className="text-[var(--tn-pumpkin)]">{SWEEP.leftoverBsv} BSV</b>, went home in a single transaction with {n(SWEEP.inputs)} inputs.
            </p>
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm">
              <Ext href={txUrl(SWEEP.leftoverTx)}>Leftover tx {short(SWEEP.leftoverTx)} ↗</Ext>
              <Ext href={blockUrl(SWEEP.block)}>block {n(SWEEP.block)} ↗</Ext>
            </div>
          </div>
        </section>

        {/* ---------------- VERIFY ---------------- */}
        <section id="verify" className="tn-section scroll-mt-20">
          <p className="tn-eyebrow">Don&apos;t trust, verify</p>
          <h2 className="tn-h2 mt-2">Check it <em>yourself</em></h2>
          <div className="tn-steps mt-6">
            <div className="tn-panel tn-step">
              <h3>The bot wallet</h3>
              <p>Every fan-out was paid from one address.</p>
              <p className="mt-2"><Ext href={addrUrl(BOT_WALLET)}><span className="tn-mono">{BOT_WALLET}</span> ↗</Ext></p>
            </div>
            <div className="tn-panel tn-step">
              <h3>Every fan-out</h3>
              <p>All {n(TOTALS.fanouts)} fan-out transactions, with run and bot, as a text file. Each fan-out&apos;s outputs lead to the lanes of shots that spent them.</p>
              <p className="mt-2"><a href={FANOUT_LIST} className="tn-link" download>Download the fan-out list ↓</a></p>
            </div>
            <div className="tn-panel tn-step">
              <h3>Watch the chain</h3>
              <p>
                <Ext href="https://bsv.lol">bsv.lol</Ext> shows BSV transactions live and files every shot under its game, &quot;terrornode&quot;. For one transaction or block, its links go to <Ext href="https://bananablocks.com">BananaBlocks</Ext>, and so do the links on this page.
              </p>
              <p className="mt-2"><Ext href="https://bsv.lol" className="tn-cta tn-cta-ghost !min-h-[36px]">Open bsv.lol ↗</Ext></p>
            </div>
          </div>
        </section>

        {/* ---------------- NOTES ---------------- */}
        <section className="tn-section pb-20">
          <div className="tn-panel p-4 sm:p-5">
            <p className="tn-eyebrow mb-2">The small print</p>
            <ul className="tn-notes">
              <li>&quot;Accepted&quot; means the broadcaster accepted the transaction, as counted in each run&apos;s log. Run 6 wrote no summary, so its figures come from its last log line.</li>
              <li>The {n(TOTALS.accepted)} doesn&apos;t include the transactions that funded the bots, the fan-outs themselves, the sweep, or anyone&apos;s own paid TERRORNODE games that day.</li>
              <li>Fees ({bsv(TOTALS.fees)} BSV) cover every shot and every fan-out, including the warm-up and run 2. The dollar figure uses $17.19 per BSV, the price the runner used that day.</li>
              <li>The fastest second ({n(TOTALS.peak1s)} tx/s) is the best one-second count in the runs&apos; logs. The chart shows minute averages, which are lower.</li>
              <li>Run 4 onwards carried the Halloween flags. The early test and runs 1 to 3 were labelled with plain bot names.</li>
            </ul>
          </div>
        </section>
      </div>
    </main>
  );
}
