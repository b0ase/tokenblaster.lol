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
