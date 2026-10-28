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
export type TokenPageRule = { bgVideo?: BgVideo; description?: string; banner?: Banner; icon?: string; ogImage?: string };
export const TOKEN_PAGE_RULES: Record<string, TokenPageRule> = {
  // $TERRORNODE (owner, 28 Oct 2026)
  'd5ffbbfd8310dcb6763c7180b8dbc725b708d0ce990f93cd27d00ff24aa0de02_1': {
    bgVideo: { webm: '/terrornode/bg/token-loop.webm', mp4: '/terrornode/bg/token-loop.mp4', poster: '/terrornode/bg/token-poster.jpg' },
    description: 'Ammo for WELCOME TO TERRORNODE. Every live shot pays you a $TERRORNODE receipt on chain.',
    // Owner's picks, 28 Oct 2026: banners 2 + 3, logo 4 (art-2026-10-28/OWNER-PICKS.md).
    banner: {
      wide: { avif: '/terrornode/token/banner-3-1000.avif 1000w, /terrornode/token/banner-3-1500.avif 1500w', webp: '/terrornode/token/banner-3-1000.webp 1000w, /terrornode/token/banner-3-1500.webp 1500w', src: '/terrornode/token/banner-3-1500.webp' },
      narrow: { avif: '/terrornode/token/banner-2-800.avif 800w, /terrornode/token/banner-2-1200.avif 1200w', webp: '/terrornode/token/banner-2-800.webp 800w, /terrornode/token/banner-2-1200.webp 1200w', src: '/terrornode/token/banner-2-1200.webp' },
      alt: 'NPG fighters face the TERRORNODE war machine over a red neon city',
    },
    icon: '/terrornode/token/logo-4-256.webp',
    ogImage: 'terrornode-og-v1.jpg',
  },
};
export const tokenPageRule = (tokenId: string): TokenPageRule => TOKEN_PAGE_RULES[tokenId] ?? {};
