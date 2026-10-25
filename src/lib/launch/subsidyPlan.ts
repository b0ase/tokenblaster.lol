/**
 * The house-subsidised discount on an ammo-coin buy, kept atomic (pure: shared by the route and tests).
 *
 * The curve always gets the full price: the plan's outputs are exactly what an undiscounted buy of `gross`
 * pays. The house adds ONE input of its own (a P2PKH coin of AMMO_SUBSIDY_WIF, server signed in the same
 * `sign` step as the pool inputs) and, after the fixed outputs, its change back to itself. The input and
 * the change are part of the plan, so `matchesPlan` checks them on both sides exactly like the pool's. The
 * wallet funds what is left, which is the buy minus the subsidy. Nothing moves unless the whole tx does.
 */
import { p2pkh, type OutSpec, type TradePlan } from './shape';

/** A house coin: its outpoint, value and a hex BEEF proving its transaction. */
export type SubsidyCoin = { outpoint: string; sats: number; beef: string };

export function withSubsidy(
  inputs: TradePlan['inputs'],
  outputs: OutSpec[],
  coin: SubsidyCoin,
  subsidy: bigint,
  houseAddress: string,
): { inputs: TradePlan['inputs']; outputs: OutSpec[]; inputIndex: number } {
  const s = Number(subsidy);
  if (!(s > 0)) throw new Error('No subsidy to add.');
  if (coin.sats < s) throw new Error('The house discount coin is too small.');
  const change = coin.sats - s;
  const ins = [...inputs, { outpoint: coin.outpoint, sats: coin.sats, what: 'TokenBlaster discount (house pays)' }];
  const outs = change > 0 ? [...outputs, { script: p2pkh(houseAddress), sats: change, what: 'discount coin change (house)' }] : [...outputs];
  return { inputs: ins, outputs: outs, inputIndex: inputs.length };
}

/** What the wallet itself must fund for a plan (outputs it does not add minus the inputs it does not own). */
export const walletShare = (plan: Pick<TradePlan, 'inputs' | 'outputs'>, extraOutSats = 0) =>
  plan.outputs.reduce((n, o) => n + o.sats, 0) + extraOutSats - plan.inputs.reduce((n, i) => n + i.sats, 0);
