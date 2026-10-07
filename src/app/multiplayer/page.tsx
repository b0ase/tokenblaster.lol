import Link from 'next/link';
import { Barcode, Pictogram, type PictogramName } from '@/components/dr';
import { SectionHead } from '@/components/dr/site';
import { HeroLoop, PrivateRoomButton } from '@/components/MultiplayerBits';
import { identiconUrl } from '@/lib/identity';
import { MULTIPLAYER_CARD, shareImages } from '@/lib/og';

const title = 'Multiplayer · TokenBlaster.lol';
const description =
  'Blast your group chat: set your X handle, start or join a room, paste the invite link in X. Your friends’ avatars float over their heads in Arena, bRacer, Token Rally, Double-O Satoshi, BSVGun, Mempool Invaders and Token Snake.';
export const metadata = {
  title,
  description,
  alternates: { canonical: '/multiplayer' },
  openGraph: { title: 'TokenBlaster Multiplayer: blast your group chat', description, url: '/multiplayer', images: shareImages(MULTIPLAYER_CARD).openGraph },
  twitter: { card: 'summary_large_image', title: 'TokenBlaster Multiplayer: blast your group chat', description, images: shareImages(MULTIPLAYER_CARD).twitter },
};

/** Every claim below was checked against the game code (src/lib/racemp, src/lib/identity.ts, each game's MP wiring). */
type Pvp = 'live' | 'score' | 'soon';
type MpGame = {
  href: string;
  title: string;
  img: string;
  kind: string;
  modes: string[];
  max: string;
  line: string;
  pvp: Pvp;
  pvpText: string;
  /** private-room deep link: the game opens on ?room=CODE (+ extra) and joins that private room. null = one shared room only. */
  room: { extra?: string } | null;
};

const GAMES: MpGame[] = [
  {
    href: '/arena',
    title: 'Arena',
    img: '/arcade/arena.jpg',
    kind: 'hell-forge shooter',
    modes: ['Free-for-all'],
    max: 'One shared room for everyone in /arena',
    line: 'Demons and other players in the same forge. X avatars over every head, a kill feed of who blasted whom.',
    pvp: 'live',
    pvpText: 'LIVE: a hit on a player sends your token to their gun.',
    room: null,
  },
  {
    href: '/arcade/bracer',
    title: 'bRacer',
    img: '/arcade/bracer.jpg',
    kind: 'anti-gravity racer',
    modes: ['Quick race', 'Private room'],
    max: 'Up to 8 pilots; empty grid slots get AI rivals',
    line: '700 km/h on the live chain with rockets, mines and boost pads. Lobby, ready-up, one shared start.',
    pvp: 'live',
    pvpText: 'LIVE (credit race): hit another pilot and your token lands in their gun.',
    room: {},
  },
  {
    href: '/arcade/rally',
    title: 'Token Rally',
    img: '/arcade/rally.jpg',
    kind: '3D rally',
    modes: ['Quick race', 'Private room'],
    max: 'Up to 8 drivers; empty slots get live-chain AI rivals',
    line: 'Forest, desert and snow stages against live transactions. Cars do not collide, so it is a clean race to the line.',
    pvp: 'score',
    pvpText: 'No player-to-player payments. Each driver pays their own fuel in LIVE.',
    room: {},
  },
  {
    href: '/arcade/doubleosatoshi',
    title: 'Double-O Satoshi',
    img: '/arcade/doubleo.jpg',
    kind: 'spy shooter',
    modes: ['Co-op (2-4 agents)', 'Deathmatch (first to 10 frags, 5 min)'],
    max: 'Co-op 2-4 agents; deathmatch bots optional',
    line: 'Run a mission together or hunt each other through the map.',
    pvp: 'live',
    pvpText: 'LIVE deathmatch: every hit on another agent sends your token to their gun.',
    room: { extra: '&mode=dm&m=facility' },
  },
  {
    href: '/arcade/bsvgun',
    title: 'BSVGun',
    img: '/arcade/bsvgun.jpg',
    kind: 'versus shooting range',
    modes: ['Versus range (75 s round)'],
    max: 'Up to 8 shooters',
    line: 'Same targets for everyone, earliest hit takes the target. Highest score when the clock ends.',
    pvp: 'score',
    pvpText: 'Score only. Nobody pays anybody for a hit.',
    room: {},
  },
  {
    href: '/arcade/invaders',
    title: 'Mempool Invaders',
    img: '/arcade/invaders.jpg',
    kind: '3D shooter',
    modes: ['Co-op', 'Versus'],
    max: 'Up to 8 pilots',
    line: 'Share the wave of live transactions, or race your friends for every kill.',
    pvp: 'score',
    pvpText: 'Score only. The multiplayer layer moves no money.',
    room: {},
  },
  {
    href: '/arcade/snake',
    title: 'Token Snake',
    img: '/arcade/snake.jpg',
    kind: 'slither-style arena',
    modes: ['Arena: quick match', 'Private room', 'Solo vs bots'],
    max: 'Up to 10 snakes',
    line: 'Cut other snakes off and they burst into food. Avatars over every head, kill feed, shared seeded food.',
    pvp: 'soon',
    pvpText: 'LIVE (token mode): cut someone off and one of their loaded tokens lands in your gun.',
    room: {},
  },
];

const PVP_STYLE: Record<Pvp, string> = {
  live: 'text-[var(--accent)]',
  score: 'text-dim',
  soon: 'text-dim',
};

/** Example players for the hero. Handles are made up; avatars are the deterministic identicons the game falls back to. */
const DEMO: { handle: string; ok: boolean; cls: string }[] = [
  { handle: 'frog_dad', ok: true, cls: 'right-[9%] top-[22%]' },
  { handle: 'nick_sats', ok: false, cls: 'right-[27%] top-[46%]' },
  { handle: 'maya0x', ok: true, cls: 'right-[4%] top-[58%]' },
];

const STEPS: { n: string; icon: PictogramName; head: string; body: string }[] = [
  { n: '01', icon: 'target', head: 'Set your X handle', body: 'Type it once in any multiplayer game. Your X avatar and @handle float over your head for everyone in the room. Sign in with bWalletX and you get a ✓.' },
  { n: '02', icon: 'flag', head: 'Start or join a room', body: 'Hit quick match to drop into the public room, or start a private room and get a link. Anyone who opens the link joins your room.' },
  { n: '03', icon: 'bolt', head: 'Invite your group chat', body: 'In the lobby hit “Invite your group chat”. It copies the post text and the link, or opens a ready-made X post. Paste it, wait for the avatars to show up.' },
];

const FAQ: [string, string][] = [
  ['Do I need a wallet?', 'Not to play. Practice mode needs no wallet and is free. LIVE mode needs a connected wallet with tokens or sats, because every action is a real transaction.'],
  ['Does it work on phones?', 'The games ship touch controls and the pages are responsive, so you can drop into a room from a phone. The shooters and racers still feel best with a keyboard and mouse or a pad.'],
  ['How many players fit?', 'bRacer, Token Rally, BSVGun and Mempool Invaders hold up to 8. Token Snake arena holds up to 10 snakes. Double-O Satoshi co-op is 2-4 agents. Arena is one shared room.'],
  ['What if someone fakes a handle?', 'They can type any handle, but without the ✓ it is just a label. The tick only appears when that player’s wallet proves it holds the identity key bWalletX registered for that X account. Identity is cosmetic and never decides where money goes: payments go to the gun address of the player you actually hit.'],
  ['Is there a prize pool?', 'No. Nothing here pays out a pot. The only money that moves is your own transactions and, in the PvP games above, your token landing in the gun of the player you hit.'],
];

export default function MultiplayerPage() {
  return (
    <main className="flex w-full flex-col">
      {/* Hero */}
      <header className="dr-hero dr-rise">
        <HeroLoop vid="/hero/arena" poster="/hero/arena.jpg" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[5] h-[90%] bg-[linear-gradient(to_top,var(--panel)_10%,color-mix(in_srgb,var(--panel)_82%,transparent)_50%,transparent)] lg:hidden" aria-hidden />
        <div className="pointer-events-none absolute inset-0 z-[5] hidden bg-[linear-gradient(90deg,var(--panel)_0%,color-mix(in_srgb,var(--panel)_88%,transparent)_28%,color-mix(in_srgb,var(--panel)_40%,transparent)_52%,transparent_74%)] lg:block" aria-hidden />
        {/* example players: made-up handles, same tag the games draw over a head */}
        <div className="pointer-events-none absolute inset-0 z-[6] hidden lg:block" aria-hidden>
          {DEMO.map((d) => (
            <div key={d.handle} className={`absolute flex flex-col items-center ${d.cls}`}>
              <span className="flex items-center gap-2 border-2 border-[var(--accent)] bg-[var(--panel)] px-2 py-1">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={identiconUrl(d.handle)} alt="" width={28} height={28} className="h-7 w-7 rounded-full" />
                <span className="text-sm font-bold text-hot">@{d.handle}</span>
                {d.ok && <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-[#1d9bf0] text-[10px] text-white">✓</span>}
              </span>
              <span className="h-0 w-0 border-x-[7px] border-t-[10px] border-x-transparent border-t-[var(--accent)]" />
            </div>
          ))}
          <span className="dr-code absolute bottom-24 right-6">example players</span>
        </div>
        <div className="relative z-10 flex flex-1 items-end px-4 pb-16 pt-[150px] sm:px-8 lg:items-center lg:px-12 lg:pb-16 lg:pt-8">
          <div className="min-w-0 lg:max-w-[56%]">
            <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1">
              <span className="dr-code !text-[var(--accent)]">TB-MP / MULTIPLAYER</span>
              <span className="dr-code">TokenBlaster.lol</span>
              <span className="dr-kana text-[11px] text-[var(--muted)]" aria-hidden>
                グループ対戦
              </span>
            </div>
            <h1 className="dr-display dr-mega dr-skew text-hot [text-shadow:0_2px_0_var(--panel),0_0_18px_var(--panel)]">
              <span className="dr-line" style={{ ['--d' as string]: '0.05s' }}>
                Blast your
              </span>
              <span className="dr-line" style={{ ['--d' as string]: '0.2s' }}>
                group chat<span className="text-[var(--accent)]">.</span>
              </span>
            </h1>
            <p className="mt-4 max-w-xl text-base text-dim sm:text-lg">
              Your friends&rsquo; X avatars float over their heads. Shoot them, race them, eat them. Seven games, one invite link.
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <span className="dr-sticker text-base sm:text-xl">Practice is free</span>
              <span className="dr-sticker dr-sticker-red text-xs sm:text-sm">LIVE = real BSV tx</span>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-3 sm:gap-4">
              <a href="#games" className="btn-fire inline-flex items-center justify-center !text-xl sm:!text-2xl">
                Pick a game &raquo;
              </a>
              <Link href="/leaderboard" className="btn-fire inline-flex items-center justify-center !bg-[var(--panel)] !bg-none !text-xl !text-[var(--hot)] sm:!text-2xl">
                Leaderboard
              </Link>
            </div>
          </div>
        </div>
      </header>

      <div className="dr-chev dr-chev-march !h-[16px]" aria-hidden />

      {/* How it works */}
      <section aria-label="How it works" className="dr-band dr-band-grid flex flex-col gap-5">
        <SectionHead n="01">How it works</SectionHead>
        <ol className="grid gap-4 md:grid-cols-3">
          {STEPS.map((s) => (
            <li key={s.n} className="panel flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="dr-display text-[clamp(48px,7vw,84px)] text-[var(--accent)]">{s.n}</span>
                <Pictogram name={s.icon} size={34} colour="var(--hot)" />
              </div>
              <h3 className="dr-display text-2xl text-hot">{s.head}</h3>
              <p className="text-sm text-dim">{s.body}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* Games */}
      <section id="games" aria-label="Multiplayer games" className="dr-band flex scroll-mt-16 flex-col gap-5">
        <SectionHead
          n="02"
          right={
            <Link href="/arcade" className="text-dim hover:text-[var(--accent)] hover:underline">
              whole arcade &gt;&gt;
            </Link>
          }
        >
          The multiplayer games
        </SectionHead>
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {GAMES.map((g, i) => (
            <li key={g.href} className="panel flex flex-col !p-0">
              <div className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={g.img} alt={`${g.title} gameplay`} loading="lazy" className="aspect-video w-full border-b-2 border-[var(--border)] object-cover" />
                <span className="dr-sticker absolute left-2 top-2 text-xs">{g.kind}</span>
                <span className="dr-code absolute bottom-1 right-2 !text-[var(--hot)] [text-shadow:0_1px_2px_#000]">MP-{String(i + 1).padStart(3, '0')}</span>
              </div>
              <div className="flex flex-1 flex-col gap-2 p-3">
                <h3 className="dr-display text-3xl text-hot">{g.title}</h3>
                <div className="flex flex-wrap gap-1.5">
                  {g.modes.map((m) => (
                    <span key={m} className="border border-[var(--accent)] px-1.5 py-0.5 text-[11px] uppercase tracking-wider text-[var(--accent)]">
                      {m}
                    </span>
                  ))}
                </div>
                <p className="flex items-center gap-2 text-sm text-hot">
                  <Pictogram name="hex" size={14} colour="var(--accent)" />
                  {g.max}
                </p>
                <p className="text-sm text-dim">{g.line}</p>
                <p className={`text-xs ${PVP_STYLE[g.pvp]}`}>{g.pvpText}</p>
                <div className="mt-auto flex flex-wrap items-center gap-2 pt-2">
                  <Link href={g.href} className="btn-fire !px-4 !py-1.5 !text-lg">
                    Play &raquo;
                  </Link>
                  {g.room ? (
                    <PrivateRoomButton href={g.href} extra={g.room.extra} className="btn px-3 py-1.5 text-xs font-bold uppercase tracking-wider" />
                  ) : (
                    <span className="text-[11px] text-dim">Share the page link: everyone lands in the same room.</span>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {/* Money, honestly */}
      <section aria-label="LIVE and money" className="dr-band dr-band-grid grid gap-4 lg:grid-cols-[1.1fr_1fr]">
        <div className="flex flex-col gap-3">
          <SectionHead n="03">LIVE &amp; money</SectionHead>
          <p className="text-dim">
            Every game has two modes. <strong className="text-hot">Practice</strong> is free and needs no wallet. <strong className="text-hot">LIVE</strong> turns your actions into real BSV transactions that you pay for,
            network fee included, so every bullet and boost is on chain.
          </p>
          <p className="text-dim">
            In the PvP games marked LIVE above (Arena, bRacer, Double-O Satoshi deathmatch and Token Snake) a hit sends the token you loaded to the gun of the player you hit; in Snake, the snake that dies pays one token to the snake that cut it off. BSVGun, Mempool Invaders and Token Rally have no
            player-to-player payments.
          </p>
          <p className="text-dim">
            <strong className="text-hot">No prize pools.</strong> Nothing here holds or pays out a pot.
          </p>
        </div>
        <div className="panel flex flex-col gap-3 self-start">
          <div className="panel-header">
            <span className="panel-title">Verified ✓ explained</span>
            <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-[#1d9bf0] text-xs text-white">✓</span>
          </div>
          <p className="text-sm text-dim">
            <strong className="text-hot">With the tick:</strong> you signed in with X in bWalletX, and the wallet you play with proves it holds that account&rsquo;s identity key. Everyone in the room checks the signature
            themselves, no server of ours in the middle.
          </p>
          <p className="text-sm text-dim">
            <strong className="text-hot">Without the tick:</strong> you typed the handle. It still shows the avatar, but anyone could have typed it, so treat it as a nickname.
          </p>
          <Barcode seed="VERIFIED-X" h={16} w={96} colour="var(--muted)" />
        </div>
      </section>

      {/* FAQ */}
      <section aria-label="FAQ" className="dr-band flex flex-col gap-4">
        <SectionHead n="04">FAQ</SectionHead>
        <div className="grid gap-3 md:grid-cols-2">
          {FAQ.map(([q, a]) => (
            <details key={q} className="panel group" open={q === FAQ[0][0]}>
              <summary className="dr-display cursor-pointer list-none text-xl text-hot group-open:text-[var(--accent)]">{q}</summary>
              <p className="mt-2 text-sm text-dim">{a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* Close */}
      <Link href="/arcade" className="dr-band dr-band-grid group block !p-0">
        <div className="dr-hazard-2" aria-hidden />
        <div className="flex flex-wrap items-end justify-between gap-3 px-[clamp(12px,2.6vw,64px)] py-6">
          <div>
            <p className="dr-code !text-[var(--accent)]">TB-MP-END / SEE WHO WINS</p>
            <p className="dr-display text-[clamp(36px,7vw,80px)] text-hot group-hover:text-[var(--accent)]">
              <span aria-hidden>▶ </span>Into the arcade
            </p>
          </div>
          <span className="btn-fire !px-5 !py-2 !text-xl">Enter the arcade &raquo;</span>
        </div>
      </Link>
      <div className="dr-band flex flex-wrap items-center gap-4 !py-3 text-sm">
        <Link href="/leaderboard" className="text-dim hover:text-[var(--accent)] hover:underline">
          See the leaderboard &gt;&gt;
        </Link>
        <Link href="/arcade" className="text-dim hover:text-[var(--accent)] hover:underline">
          All arcade games &gt;&gt;
        </Link>
      </div>
    </main>
  );
}
