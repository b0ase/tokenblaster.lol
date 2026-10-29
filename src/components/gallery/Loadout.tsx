'use client';
/**
 * The loadout (owner, 24 Oct 2026): MISSION BRIEFING, the weapon cards (3D previews) and the coin-op cabinet.
 * Presentational: the Shooting Gallery owns the state and passes the cabinet in. All copy is from
 * src/lib/gallery/story.ts.
 */
import Link from 'next/link';
import { Brand } from '@/components/Brand';
import { useState, type ReactNode } from 'react';
import { liveCeiling, liveRate, patternLabel, roundsForFullRate, txPattern, type TxPattern } from '@/lib/gallery';
import type { RangeWeapon } from '@/lib/bsvgun/weapons';
import { BloodTitle } from './BloodTitle';
import { BRIEFING, CHARACTERS, SETTING, PRACTICE, TAGLINE, forPractice, stageBrief } from '@/lib/gallery/story';
import { Icon, useExisting } from '../coinop/ui';
import { CharacterCard } from '../coinop/LoadingScreen';
import { GunPreview } from './GunPreview';
import { RARITY_COLOR } from '@/lib/ordnance';

const RARITY_WORD = { common: 'STANDARD ISSUE', rare: 'RARE', epic: 'EPIC', legendary: 'LEGENDARY' } as const;
import { NpgBackdrop } from '../terrornode/NpgBackdrop';
import { OfficialNpg } from '../terrornode/OfficialNpg';
import { SignedOutBwalletButton } from '@/components/walletbar/BwalletButton';

export function Loadout({ start, weapons, weaponId, setWeaponId, canUse, paymail, cabinet, player, levels, practice = false, rounds = 0 }: { start?: ReactNode; player?: ReactNode; levels?: ReactNode; practice?: boolean; rounds?: number; weapons: RangeWeapon[]; weaponId: string; setWeaponId: (id: string) => void; canUse: (w: RangeWeapon) => boolean; paymail: string | null; cabinet: ReactNode }) {
  const [who, setWho] = useState('kweg');
  const have = useExisting(CHARACTERS.map((c) => c.portrait ?? ''));
  const c = CHARACTERS.find((x) => x.id === who) ?? CHARACTERS[0];
  const w1 = stageBrief(1);
  return (
    <>
    <NpgBackdrop />
    <div className="tbx-screen absolute inset-0 z-[6] overflow-y-auto bg-[radial-gradient(ellipse_at_50%_-10%,rgba(14,52,66,.82),rgba(4,9,14,.93)_62%)]" data-loadout>
      <div className="mx-auto flex max-w-[1440px] flex-col gap-4 p-3 sm:gap-5 sm:p-6">
        <header className="tbx-in-d flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="tbx-eyebrow flex items-center gap-2" style={{ color: 'var(--tbx-teal)' }}>
              <span className="inline-block h-[2px] w-6 bg-[var(--tbx-red)]" /> {SETTING}
            </p>
            <OfficialNpg className="mt-2" />
            <h2 className="mt-1 text-[clamp(44px,16.5vw,150px)]"><BloodTitle /></h2>
          </div>
          <div className="flex flex-col items-end gap-2">
            {/* The game bar (and its yellow bWallet button) is hidden in phone game mode: the button comes along here. */}
            <SignedOutBwalletButton className="gs-bar-hidden-only" />
            <Link href="/arcade/terrornode/leaderboard" data-fs-skip className="tbx-btn !min-h-[36px] !px-3 !text-xs" data-info-link>
              <Icon name="trophy" size={14} /> Scores &amp; info
            </Link>
            <p className="hidden max-w-[320px] text-right text-sm text-[var(--tbx-dim)] sm:block">{practice ? forPractice(TAGLINE) : TAGLINE}</p>
          </div>
        </header>
        {start}
        {levels}

        <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,560px)] xl:grid-cols-[minmax(0,360px)_minmax(0,1fr)_minmax(0,560px)] lg:items-start">
          {/* MISSION BRIEFING */}
          <section className="tbx-glass tbx-in-l flex min-w-0 flex-col gap-3 p-4 sm:p-5 lg:col-span-1" aria-label={BRIEFING.heading} data-briefing>
            <div>
              <p className="tbx-eyebrow flex items-center gap-2" style={{ color: 'var(--tbx-red)' }}>
                <Icon name="eye" size={14} /> {BRIEFING.heading}
              </p>
              <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.26em] text-[var(--tbx-mute)]">{BRIEFING.code}</p>
            </div>
            <p className="text-[15px] font-medium leading-snug text-white/92">{BRIEFING.objective}</p>
            <div className="rounded-lg border border-[var(--tbx-line)] bg-black/25 p-3">
              <p className="tbx-eyebrow" style={{ color: 'var(--tbx-teal)' }}>{w1.code}</p>
              <p className="tbx-display mt-1 text-2xl"><Brand>{w1.title}</Brand></p>
              <p className="mt-1.5 text-[13px] leading-snug text-[var(--tbx-dim)]"><Brand>{w1.brief}</Brand></p>
            </div>
            <ul className="flex flex-col gap-1.5 text-[13px] text-[var(--tbx-dim)]">
              {BRIEFING.rules.map((r0) => {
                const r = practice ? forPractice(r0) : r0;
                return (
                <li key={r} className="flex gap-2">
                  <Icon name="chevron" size={13} className="mt-0.5 shrink-0 text-[var(--tbx-red)]" /> {r}
                </li>
                );
              })}
            </ul>
            {/* Who is who */}
            <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Characters">
              {CHARACTERS.map((x) => (
                <button key={x.id} type="button" role="tab" aria-selected={x.id === who} onClick={() => setWho(x.id)} className="rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] transition" style={{ borderColor: x.id === who ? x.colour : 'var(--tbx-line)', color: x.id === who ? x.colour : 'var(--tbx-dim)', background: x.id === who ? 'rgba(255,255,255,.06)' : 'transparent' }}>
                  {x.name.replace(/^THE /, '')}
                </button>
              ))}
            </div>
            <div key={c.id} className="tbx-fade">
              <CharacterCard c={c} portrait={!!c.portrait && have.has(c.portrait)} />
            </div>
          </section>

          {/* Weapons */}
          <section className="flex min-w-0 flex-col gap-2" aria-label="Weapons">
            <p className="tbx-eyebrow flex items-center gap-2"><Icon name="crosshair" size={14} /> Choose your gun</p>
            <div className="tbx-snap tbx-scroll -mx-3 flex gap-2.5 overflow-x-auto px-3 pb-2 sm:mx-0 sm:px-0 xl:grid xl:grid-cols-1 xl:overflow-visible">
              {weapons.map((w, k) => {
                const p = txPattern(w);
                const ok = canUse(w);
                const on = w.id === weaponId;
                return (
                  <button key={w.id} type="button" onClick={() => ok && setWeaponId(w.id)} disabled={!ok} aria-pressed={on} className="tbx-card tbx-ord tbx-rise flex w-[196px] shrink-0 flex-col gap-1 p-2.5 sm:w-[212px] xl:w-auto" style={{ ['--d' as string]: `${0.1 + k * 0.08}s`, ['--rc' as string]: RARITY_COLOR[w.ordnance?.rarity ?? 'common'] }} data-ord-card>
                    <span aria-hidden className="tbx-ord-dots" />
                    <span className="relative flex items-center justify-between gap-1">
                      <span className="tbx-ord-label">{w.ordnance ? '1SAT ORDNANCE' : w.id === 'minigun' ? 'DEFAULT ISSUE' : 'STOCK ISSUE'}</span>
                      <span className="tbx-ord-tag">{w.ordnance ? RARITY_WORD[w.ordnance.rarity] : 'STANDARD'}</span>
                    </span>
                    <span className="relative"><GunPreview url={w.def.url} active={on} /></span>
                    <span className="tbx-ord-name relative text-[clamp(17px,1.8vw,22px)]" style={{ color: on ? '#fff' : '#fff1dc' }}>{w.name}</span>
                    <span className="flex items-center gap-1.5 text-[11px] font-semibold" style={{ color: p.kind === 'stream' ? 'var(--tbx-teal)' : 'var(--tbx-amber)' }}>
                      <Icon name={p.kind === 'stream' ? 'bolt' : 'stack'} size={12} /> {practice ? (p.kind === 'stream' ? `DEMO · ${p.rate.toLocaleString()} rounds/s, simulated` : `DEMO · ${p.n} rounds per pull`) : patternLabel(p)}
                    </span>
                    <span className="text-[10px] leading-snug text-[var(--tbx-dim)]" data-live-rate>{rateNote(p, rounds, practice)}</span>
                    {(['rate', 'spread', 'power'] as const).map((key) => (
                      <span key={key} className="flex items-center gap-2 text-[10px] text-[var(--tbx-dim)]">
                        <span className="w-11 font-semibold uppercase tracking-wider">{key}</span>
                        <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
                          <span className="block h-full origin-left rounded-full transition-transform duration-500" style={{ width: `${Math.round(w.bars[key] * 100)}%`, background: on ? 'linear-gradient(90deg,var(--tbx-red-deep),var(--tbx-red))' : 'linear-gradient(90deg,#2b7f8a,var(--tbx-teal))' }} />
                        </span>
                      </span>
                    ))}
                    {!ok && <span className="text-[10px] text-[var(--tbx-amber)]">Own the 1Sat Ordnance to fire it LIVE</span>}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-[var(--tbx-dim)]">
              {practice ? (
                <>{PRACTICE.nothing}</>
              ) : paymail ? (
                <>
                  Every round carries your paymail <span className="text-[var(--tbx-amber)]">{paymail}</span> on the record.
                </>
              ) : (
                <>Your paymail goes on every round once you pay.</>
              )}
            </p>
          </section>

          {/* Cabinet */}
          <div className="tbx-in-r flex min-w-0 flex-col gap-4 lg:col-start-2 lg:row-span-2 lg:row-start-1 xl:col-start-3 xl:row-span-1">{cabinet}{player}</div>
        </div>
      </div>
    </div>
    </>
  );
}

/** The honest tx/s line under each gun (src/lib/gallery.ts liveCeiling): free play never claims on chain. */
function rateNote(p: TxPattern, rounds: number, practice: boolean) {
  if (p.kind !== 'stream') return null;
  if (practice) return 'Demo only: nothing is sent on chain.';
  const full = roundsForFullRate(p.rate);
  if (rounds > 0) return `LIVE with ${rounds.toLocaleString()} rounds loaded: up to ${liveRate(p, rounds).toLocaleString()} tx/s (sender ceiling ${liveCeiling(rounds).toLocaleString()}; network-limited).`;
  return `LIVE: up to ${p.rate.toLocaleString()} tx/s once ${full.toLocaleString()}+ rounds are loaded (10,000 rounds: up to ${liveRate(p, 10_000).toLocaleString()} tx/s). Network-limited.`;
}
