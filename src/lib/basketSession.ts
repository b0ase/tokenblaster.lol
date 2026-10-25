/**
 * Wallet basket reads, at most once per session (owner, 25 Oct 2026: no permission sheets in the background).
 * Every listOutputs on a basket the site has not been granted opens a sheet in bWalletX. So a basket is read only
 * after an explicit tap, each page of it once per browser session, and a refusal is remembered for the session:
 * the site never asks for that basket again until the tab is reopened.
 */
import type { ListOutputsArgs, ListOutputsResult, WalletInterface } from '@bsv/sdk';

const KEY = 'tb.basketRefused';
const cache = new Map<string, Promise<ListOutputsResult | null>>();
let refusedMem: Set<string> | null = null;

function refused(): Set<string> {
  if (refusedMem) return refusedMem;
  refusedMem = new Set();
  try {
    for (const b of JSON.parse(sessionStorage.getItem(KEY) ?? '[]') as string[]) refusedMem.add(b);
  } catch {
    /* no storage: memory only */
  }
  return refusedMem;
}
function refuse(basket: string) {
  refused().add(basket);
  try {
    sessionStorage.setItem(KEY, JSON.stringify([...refused()]));
  } catch {
    /* memory only */
  }
}

export const basketRefused = (basket: string) => refused().has(basket);

/** True when the wallet's answer is a refusal (the player said no, or the basket is reserved), not a glitch. */
const isRefusal = (e: unknown) => /denied|deny|reject|refus|reserved|not allowed|permission|cancel|user/i.test(e instanceof Error ? e.message : String(e));

/**
 * listOutputs through the session memory. Null when refused (now or earlier this session) or failed.
 * `fresh` skips the read-once cache (only for a spend the player just approved), never the refusal memory.
 */
export function readBasket(wallet: WalletInterface, args: ListOutputsArgs, fresh = false): Promise<ListOutputsResult | null> {
  const basket = args.basket;
  if (basketRefused(basket)) return Promise.resolve(null);
  const k = `${basket}|${args.include ?? ''}|${args.offset ?? 0}|${args.limit ?? ''}`;
  const hit = cache.get(k);
  if (hit && !fresh) return hit;
  const p = wallet.listOutputs(args).catch((e) => {
    if (isRefusal(e)) refuse(basket);
    cache.delete(k); // a glitch may be retried on the next tap
    return null;
  });
  cache.set(k, p);
  return p;
}

/** An explicit refresh tap: forget what was read (so the next read asks again), but keep the refusals. */
export const forgetBasketReads = () => cache.clear();

/** Tests only. */
export function resetBasketSession() {
  cache.clear();
  refusedMem = new Set();
}
