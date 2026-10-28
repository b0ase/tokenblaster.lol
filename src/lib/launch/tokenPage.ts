/**
 * Token page rules (BSVEX-PLAN.md §8, owner-approved copy, 27 Oct 2026).
 * Copy: never invest / returns / moon / earn / profit / "price will" / x10. Price only where real.
 */
import { AMMO_COINS } from './ammoCoins';
import { OUR_TOKENS } from '../ourTokens';

/** Shown on every token page. */
export const RISK_LINE = 'Tokens can lose all value. Not an investment. No returns are promised.';

/** Shown on third-party coins (anyone can launch on BlastPad). */
export const issuerLine = (issuer: string) => `Made by ${issuer}, not by bCorp.`;

/** Coins made by us (bCorp / b0ase / NPG): the cabinet ammo coins and the portfolio tokens. Everything else is third-party. */
const OURS = new Set<string>([...AMMO_COINS.map((c) => c.tokenId), ...OUR_TOKENS.map((t) => t.id)].filter(Boolean));
/** Our BlastPad launch wallet (owner confirmed 28 Oct 2026): every coin it launched is ours (BSVGUN, FROGGER, DOUBLEO, ARENA…). */
export const OUR_LAUNCH_WALLETS = new Set<string>(['17B7drUMTBEELCKX89676iV5CegcZuz2m1']);
export const isOurToken = (tokenId: string, creator?: string) => OURS.has(tokenId) || (!!creator && OUR_LAUNCH_WALLETS.has(creator));

/** The coin's token-gated room on bChatX. */
export const chatRoomUrl = (sym: string) => `https://www.bchatx.com/chat?room=${encodeURIComponent(sym.replace(/^\$/, '').toUpperCase())}`;

/** bWalletX on the web: the coin shows up there once it is in your wallet. */
export const BWALLETX_WEB = 'https://web.bwalletx.com';

/** Words the token page must never use (src/lib/tokenPage.test.ts checks the page source, with RISK_LINE taken out first). */
export const BANNED_WORDS = [/\binvest/i, /\breturns\b/i, /\bmoon/i, /\bearn(s|ed|ing)?\b/i, /\bprofit/i, /\bprice will\b/i, /\bx10\b/i];

/** A muted looping background video for one token's page (existing footage only). */
export type BgVideo = { webm: string; mp4: string; poster: string };
/**
 * Per-token page rules, keyed by token_id. Every field is optional.
 *  - bgVideo: shown behind the page (poster only on reduced motion, Save-Data and the phone lite tier).
 *  - name: a page-level display name (the signed launch name is unchanged; the ticker never changes).
 *  - metaTitle: the page's meta/OG title, used as is (no "on BlastPad" suffix).
 *  - description: a page-level override. The coin's own description is part of the creator's SIGNED launch message,
 *    so it is never edited; the signed text still shows, unchanged, under "Launch signature".
 */
/** A page banner: `wide` at 768px and up, `narrow` below. Each lists webp + avif sources (srcset strings). */
export type Banner = { wide: { avif: string; webp: string; src: string }; narrow: { avif: string; webp: string; src: string }; alt: string };
/**
 *  - banner: art across the top of the token page.
 *  - icon: a page-level icon (header and lists). The on-chain icon is inscribed in the signed launch and can't change;
 *    this only changes what our pages draw.
 *  - ogImage: a ready-made 1200x630 JPEG in src/assets/og/ used as the share card (versioned filename, so caches refresh).
 */
/** A title image drawn in the banner's sky (a render of the game's real title, never AI-drawn text). `on` switches it on. */
export type BannerTitle = { src: string; srcSet: string; alt: string; on: boolean };
/**
 *  - announcer: a voice line played once per visit near the banner (first scroll, else first tap/key). `src` lists the
 *    sources in order of preference (m4a, then mp3). Swap the voice by changing these paths (versioned filenames).
 *  - music: the page's own background playlist, started after the announcer finishes. It replaces the site-wide shuffle
 *    on this page (the site player still shows it and its mute/volume). First song opens, then the list loops.
 */
export type Announcer = { src: string[] };
export type PageSong = { src: string; title: string; site: string };
export type TokenPageRule = { bgVideo?: BgVideo; name?: string; metaTitle?: string; description?: string; banner?: Banner; bannerTitle?: BannerTitle; icon?: string; ogImage?: string; announcer?: Announcer; music?: PageSong[] };
export const TOKEN_PAGE_RULES: Record<string, TokenPageRule> = {
  // $TERRORNODE (owner, 28 Oct 2026)
  'd5ffbbfd8310dcb6763c7180b8dbc725b708d0ce990f93cd27d00ff24aa0de02_1': {
    // The token is $TERRORNODE; the game is WELCOME TO TERRORNODE (named once, in the one-liner). Owner, 28 Oct 2026.
    name: '$TERRORNODE',
    metaTitle: '$TERRORNODE · ammo for WELCOME TO TERRORNODE',
    bgVideo: { webm: '/terrornode/bg/token-loop.webm', mp4: '/terrornode/bg/token-loop.mp4', poster: '/terrornode/bg/token-poster.jpg' },
    description: 'Ammo for WELCOME TO TERRORNODE. Every live shot pays you a $TERRORNODE receipt on chain.',
    // Owner's picks, 28 Oct 2026: banners 2 + 3, logo 4 (art-2026-10-28/OWNER-PICKS.md).
    banner: {
      wide: { avif: '/terrornode/token/banner-3-1000.avif 1000w, /terrornode/token/banner-3-1500.avif 1500w', webp: '/terrornode/token/banner-3-1000.webp 1000w, /terrornode/token/banner-3-1500.webp 1500w', src: '/terrornode/token/banner-3-1500.webp' },
      narrow: { avif: '/terrornode/token/banner-2-800.avif 800w, /terrornode/token/banner-2-1200.avif 1200w', webp: '/terrornode/token/banner-2-800.webp 800w, /terrornode/token/banner-2-1200.webp 1200w', src: '/terrornode/token/banner-2-1200.webp' },
      alt: 'NPG fighters face the TERRORNODE war machine over a red neon city',
    },
    // terrornode.com's 3D title (WELCOME TO + dripping TERRORNODE), rendered from b0ase/terrornode. On (owner, 28 Oct 2026).
    bannerTitle: { src: '/terrornode/token/title-1200.webp', srcSet: '/terrornode/token/title-700.webp 700w, /terrornode/token/title-1200.webp 1200w', alt: 'Welcome to TERRORNODE', on: true },
    icon: '/terrornode/token/logo-4-256.webp',
    ogImage: 'terrornode-og-v1.jpg',
    // "WELCOME TO TERRORNODE" voice, take welcome-1d-fall-g1 (owner, 28 Oct 2026: good enough for now, not final).
    announcer: { src: ['/terrornode/voice/welcome-v1.m4a', '/terrornode/voice/welcome-v1.mp3'] },
    // NPGX audio only, hard and heavy, never VexVoid (owner, 28 Oct 2026). Each track's lyrics transcript in
    // npgx/public/music/lyrics-sync/<slug>.json was checked clean (no profanity). Molotov Kiss, Shinobi Girls and
    // Akihabara Fury are left out: no lyrics on file to check.
    music: [
      { src: '/music/arena/chrome-fist.m4a', title: 'Chrome Fist', site: 'NPG-X.com' },
      { src: '/music/arena/shibuya-mosh-pit.m4a', title: 'Shibuya Mosh Pit', site: 'NPG-X.com' },
      { src: '/music/city/tokaido-reload.m4a', title: 'Tokaido Reload', site: 'NPG-X.com' },
      { src: '/music/arena/harajuku-chainsaw.m4a', title: 'Harajuku Chainsaw', site: 'NPG-X.com' },
    ],
  },
};
export const tokenPageRule = (tokenId: string): TokenPageRule => TOKEN_PAGE_RULES[tokenId] ?? {};
