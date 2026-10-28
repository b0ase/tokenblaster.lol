'use client';
/**
 * Page-wide coin-op state shared by the GameShell gate and the game inside it (src/components/InsertCoin.tsx):
 *  - `prepaid`: plays already paid to the house (each entry is that payment's txid). The gate's START adds one;
 *    the game's PLAY · 1 CREDIT takes it.
 *  - `payer`: pays one more play from the loaded credit (PLAY AGAIN), registered by the gate. One gun per page.
 *  - `name`: the player NAME typed at the cabinet.
 *  - `demo`: the taste mode (src/components/coinop/DemoOverlay.tsx): the game's PLAY starts an unpaid, unscored run.
 */
type Payer = () => Promise<string>;
let prepaid: string[] = [];
let payer: Payer | null = null;
let name = '';
let creditUsd = 0;
/** Demo (taste) mode, owner 28 Oct 2026: the game runs unpaid with the INSERT $b banner over it; no scores. */
let demo = false;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

export const coinStore = {
  subscribe(f: () => void) {
    subs.add(f);
    return () => void subs.delete(f);
  },
  prepaidCount: () => prepaid.length,
  addPrepaid(txid: string) {
    prepaid = [...prepaid, txid];
    emit();
  },
  takePrepaid(): string | null {
    if (!prepaid.length) return null;
    const [t, ...rest] = prepaid;
    prepaid = rest;
    emit();
    return t;
  },
  setPayer(p: Payer | null) {
    payer = p;
    emit();
  },
  payer: () => payer,
  name: () => name,
  setName(n: string) {
    name = n;
    emit();
  },
  demo: () => demo,
  setDemo(v: boolean) {
    if (v === demo) return;
    demo = v;
    emit();
  },
  credit: () => creditUsd,
  setCredit(v: number) {
    if (v === creditUsd) return;
    creditUsd = v;
    emit();
  },
};
