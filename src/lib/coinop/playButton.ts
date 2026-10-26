/**
 * The cabinet's main button and the UNLOAD label (owner, 25 Oct 2026): the credit state must be obvious.
 *  - credit in the gun, no new coins: "PLAY ($x.xx credit)" and it starts with no payment ("Add credit" is secondary);
 *  - new coins inserted: "LOCK & LOAD $x.xx" (the one wallet approval);
 *  - nothing at all: "LOCK & LOAD $0.10" (puts the minimum in and pays it).
 * Pure, so the tests can check every state.
 */
import { MIN_CREDIT_USD, fmtCredit, hasCredit } from './credit';

export type PlayButton = { label: string; kind: 'play' | 'pay' | 'quick'; sub: string | null };

export function playButton(creditUsd: number, pendingUsd: number, priceUsd = MIN_CREDIT_USD): PlayButton {
  if (pendingUsd > 0) return { label: `LOCK & LOAD ${fmtCredit(pendingUsd)}`, kind: 'pay', sub: creditUsd > 0 ? `+ ${fmtCredit(creditUsd)} credit` : null };
  if (hasCredit(creditUsd, priceUsd)) return { label: `PLAY (${fmtCredit(creditUsd)} credit)`, kind: 'play', sub: 'no payment' };
  return { label: `LOCK & LOAD ${fmtCredit(Math.max(MIN_CREDIT_USD, priceUsd))}`, kind: 'quick', sub: null };
}

/** UNLOAD shows whenever the gun holds anything (sats credit or tokens). */
export const showUnload = (creditUsd: number, tokens = 0) => creditUsd > 0 || tokens > 0;
export const unloadLabel = (creditUsd: number) => `UNLOAD ${fmtCredit(creditUsd)} → wallet`;
