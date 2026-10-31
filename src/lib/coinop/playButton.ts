/**
 * The cabinet's main button and the UNLOAD label (owner, 25 Oct 2026): the credit state must be obvious.
 *  - credit in the gun, no new coins: "PLAY ($x.xx credit)" and it starts with no payment ("Add credit" is secondary);
 *  - new coins inserted: "LOCK & LOAD $x.xx" (the one wallet approval);
 *  - nothing at all: "LOCK & LOAD $0.10" (puts the minimum in and pays it).
 * Pure, so the tests can check every state.
 */
import { MIN_CREDIT_USD, fmtCredit, hasCredit } from './credit';

export type PlayButton = { label: string; kind: 'play' | 'pay' | 'quick'; sub: string | null };

/** "about 170,000 rounds": rounded to 2 significant figures, a plain promise, never more than is bought. */
export function aboutRounds(n: number | null | undefined): string | null {
  if (n == null || !(n > 0)) return null;
  const k = 10 ** Math.max(0, Math.floor(Math.log10(n)) - 1);
  return `about ${(Math.floor(n / k) * k).toLocaleString('en-US')} rounds`;
}

export function playButton(creditUsd: number, pendingUsd: number, priceUsd = MIN_CREDIT_USD, pendingRounds?: number | null): PlayButton {
  // The amount picked, said once (owner, 31 Oct 2026: "LOCK & LOAD $1.00 + $0.10 credit" read as one bill). The
  // wallet is asked for exactly this; credit already in the gun is shown on its own CREDIT readout.
  if (pendingUsd > 0) return { label: `LOCK & LOAD ${fmtCredit(pendingUsd)}`, kind: 'pay', sub: aboutRounds(pendingRounds) };
  if (hasCredit(creditUsd, priceUsd)) return { label: `PLAY (${fmtCredit(creditUsd)} credit)`, kind: 'play', sub: 'no payment' };
  return { label: `LOCK & LOAD ${fmtCredit(Math.max(MIN_CREDIT_USD, priceUsd))}`, kind: 'quick', sub: null };
}

/**
 * UNLOAD shows whenever the gun holds anything (sats credit or tokens), and ALWAYS when this browser has a gun key
 * (owner, 31 Oct 2026: a short balance read hid UNLOAD over 5.8M sats). A low or failed read never hides it.
 */
export const showUnload = (creditUsd: number, tokens = 0, hasKey = false) => hasKey || creditUsd > 0 || tokens > 0;
export const unloadLabel = (creditUsd: number) => (creditUsd > 0 ? `UNLOAD ${fmtCredit(creditUsd)} → wallet` : 'UNLOAD → wallet (check balance)');
