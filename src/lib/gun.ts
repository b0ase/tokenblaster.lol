/**
 * The gun: a throwaway key kept in this browser (localStorage, so closing the tab or a reload
 * mid-burst does not strand the coins; Unload sweeps whatever is at its address). Loading funds it from bWallet in one approval; firing
 * chains tagged blasts off it and broadcasts each to GorillaPool ARC; unloading sends what is
 * left back to the player. Same transaction shape as blaster/blast.ts.
 */
import { spendableCoins } from './coinop/ammo';
import { STREAM_STEP, fanoutPlan, lanesFor as plannedLanes } from './gallery';
import { runStorm, type StormBase, type StormBatch, type StormLane, type StormNet } from './stormRun';
import { streamLeaves, type LaneSpec } from './fanoutStream';
import { ARCADE_DEFAULT, ARC_DEFAULT, MAX_DEPTH, ORPHAN, ammoPush, makeBroadcaster, settleTxs, type BroadcasterKind } from './stormCore';
import { hasPayRef } from './payRef';
import { buildSweep } from './sweep';
import { archiveKey, archivedKeys, keyPersisted } from './gunKeys';
import { ARC, P2PKH, PrivateKey, SatoshisPerKilobyte, Script, Transaction, Utils } from '@bsv/sdk';

const ARC_URL = 'https://arc.gorillapool.io';

/**
 * Which service broadcasts the storm (26 Oct 2026): GorillaPool ARC (default) or Arcade, their Teranode-backed
 * successor (src/lib/stormCore.ts). Build-time NEXT_PUBLIC_TB_BROADCASTER=arcade switches it for everyone; for a
 * one-browser test, localStorage 'tb.broadcaster' = 'arcade' (or 'arc') overrides it.
 */
export function stormBroadcaster(): BroadcasterKind {
  let v: string | null | undefined = process.env.NEXT_PUBLIC_TB_BROADCASTER;
  try {
    if (typeof window !== 'undefined') v = window.localStorage.getItem('tb.broadcaster') || v;
  } catch {
    /* storage blocked: the build setting stands */
  }
  return v === 'arcade' ? 'arcade' : 'arc';
}
/** How long LOCK & LOAD waits for the network to have the fan-out before the lanes go anyway (they wait per lane then). */
const FANOUT_SEEN_MS = 60_000;
/** Lane coins LOCK & LOAD has made ready (src/lib/fanoutStream.ts): batches before the storm starts, `push` after. */
type Ammo = {
  batches: { bases: StormBase[]; lanes: LaneSpec[] }[];
  push: ((b: { bases: StormBase[]; lanes: LaneSpec[] }) => void) | null;
  end: (() => void) | null;
  ended: boolean;
  cancelled: boolean;
  done: Promise<void>;
  maxN: number;
  /** Fan-outs handed over and how many of their outputs are lanes (spent by the workers). */
  used: { txid: string; n: number }[];
};

/** One [tb-load] line per POST that held orphans or failures, and a roll-up every 5 s (the orphan rate). */
function batchLogger() {
  let at = 0;
  const sum = { posts: 0, txs: 0, orphans: 0, ms: 0, statuses: {} as Record<string, number> };
  return (b: StormBatch) => {
    const orphans = b.statuses[ORPHAN] ?? 0;
    const odd = Object.keys(b.statuses).filter((k) => !/^(SEEN_ON_NETWORK|SEEN_MULTIPLE_NODES|ACCEPTED_BY_NETWORK|MINED|RECEIVED)$/.test(k));
    if (odd.length) loadMark(`batch via ${b.via}: ${b.n} txs in ${b.ms} ms ${JSON.stringify(b.statuses)}`);
    sum.posts++;
    sum.txs += b.n;
    sum.orphans += orphans;
    sum.ms += b.ms;
    for (const [k, v] of Object.entries(b.statuses)) sum.statuses[k] = (sum.statuses[k] ?? 0) + v;
    const t = Date.now();
    if (t - at < 5000) return;
    at = t;
    loadMark(`batches: ${sum.posts} POSTs, ${sum.txs} txs, orphans ${sum.orphans} (${((100 * sum.orphans) / Math.max(1, sum.txs)).toFixed(1)} %), avg ${Math.round(sum.ms / Math.max(1, sum.posts))} ms ${JSON.stringify(sum.statuses)}`);
  };
}
/** Coins under this are left out of the gun's spend read when bigger ones exist (stormed guns hold thousands of lane ends). */
const READ_MIN_SATS = 100;
const GP_RAW = 'https://ordinals.gorillapool.io/api/tx';

/**
 * A transaction's hex, never fetched twice (a txid's bytes never change): this page's memory, then this browser's
 * storage, then our own /api/tx proxy (server-side WhatsOnChain, cached), then GorillaPool's raw bytes (CORS allowed).
 * The browser never calls WhatsOnChain itself: it has no CORS header on its errors (owner log, 25 Oct 2026:
 * hundreds of "blocked by CORS" refetches of the same txids made reading the gun's 104 coins take 56 s).
 */
const HEX_MEM = new Map<string, string>();
const HEX_LS = 'tokenblaster.txhex.';
export function rememberTxHex(txid: string, hex: string) {
  HEX_MEM.set(txid, hex);
  try {
    if (hex.length < 200_000) localStorage.setItem(HEX_LS + txid, hex);
  } catch {
    /* storage full or blocked: memory still has it for this session */
  }
}
const hexInFlight = new Map<string, Promise<string>>();
export async function txHex(txid: string): Promise<string> {
  const mem = HEX_MEM.get(txid);
  if (mem) return mem;
  try {
    const ls = localStorage.getItem(HEX_LS + txid);
    if (ls) return HEX_MEM.set(txid, ls), ls;
  } catch {
    /* no storage */
  }
  const running = hexInFlight.get(txid);
  if (running) return running;
  const p = (async () => {
    const viaUs = await fetch(`/api/tx/${txid}`, { signal: AbortSignal.timeout(8000) }).catch(() => null);
    let hex = viaUs?.ok ? (await viaUs.text()).trim() : '';
    if (!/^[0-9a-f]+$/i.test(hex)) {
      const r = await fetch(`${GP_RAW}/${txid}/raw`, { signal: AbortSignal.timeout(8000) });
      if (!r.ok) throw new Error(`Could not fetch transaction ${txid.slice(0, 8)}… (${r.status}).`);
      hex = Array.from(new Uint8Array(await r.arrayBuffer()), (b) => b.toString(16).padStart(2, '0')).join('');
    }
    rememberTxHex(txid, hex);
    return hex;
  })().finally(() => hexInFlight.delete(txid));
  hexInFlight.set(txid, p);
  return p;
}
const FEE_RATE = 100; // sats/kB, matches SATS_PER_BLAST in pricing.ts
const STORE = 'tokenblaster.gun';
/** ARC took it AND it's headed for a block (an orphan = its parent is missing/spent: it will never mine). */
const good = (r?: { status?: string; txStatus?: string; description?: string }) =>
  (r?.status === 'success' && !/ORPHAN|REJECT|DOUBLE/i.test(r.txStatus ?? '')) ||
  // @bsv/sdk 2.8 flags ARC's normal `competingTxs: null` reply as an error; ARC did take the tx.
  /invalid competing transaction identifiers/i.test(r?.description ?? '');
export const TAG = 'tokenblaster.lol';
/** Well-known unspendable address: tokens sent here are burned for good. */
export const BURN_ADDRESS = '1BitcoinEaterAddressDontSendf59kuE';
/** Sats per token bullet: ~823-byte transfer (83 sats at 100 sat/kB) plus two 1-sat outputs. */
export const TOKEN_FEE = 90;
/** Sats per BSVGun blast: up to ~300-byte tagged tx at 100 sat/kB. */
export const STORM_FEE = 30;
const GP = 'https://ordinals.gorillapool.io/api';

const hex = (s: string) => Utils.toHex(Utils.toArray(s, 'utf8'));

/** A BSV-21 transfer inscription of `amt` (base units) of token `id`, locked to `address`. */
export const bsv21 = (id: string, amt: bigint, address: string) =>
  Script.fromASM(
    `OP_0 OP_IF ${hex('ord')} OP_1 ${hex('application/bsv-20')} OP_0 ${hex(JSON.stringify({ p: 'bsv-20', op: 'transfer', id, amt: amt.toString() }))} OP_ENDIF ${new P2PKH().lock(address).toASM()}`,
  );

export type TokCoin = { id: string; tx: Transaction; vout: number; amt: bigint };

/**
 * An input's source without its ancestry (the tx re-parsed, so its own inputs carry only txids). Signing a
 * long chain with linked source transactions walks the whole graph for every tx (quadratic: 5.6 ms/tx at
 * 25, 27 ms/tx at 200 in scripts/token-burn-bench.ts); cut like this it stays flat.
 */
const shallowSource = (tx: Transaction, vout: number) => ({ sourceTransaction: Transaction.fromBinary(tx.toBinary()), sourceOutputIndex: vout });

/**
 * The chain of token bullets (swap on load, 25 Oct 2026; used by Gun.fireTokens and the burn bench): each
 * tx spends the last token coin and the last fee coin, sends `per` to `to`, keeps the rest in the gun and
 * carries the tag [TAG, id, n, ...extras[i]]. Stops early when tokens or fee sats run out.
 */
export async function buildTokenBurns(
  key: PrivateKey,
  id: string,
  per: bigint,
  startN: number,
  extras: string[][],
  start: TokCoin,
  fee: { tx: Transaction; vout: number },
  to = BURN_ADDRESS,
): Promise<{ tx: Transaction; tok: TokCoin | null; sats: { tx: Transaction; vout: number } }[]> {
  const me = key.toAddress();
  const chain: { tx: Transaction; tok: TokCoin | null; sats: { tx: Transaction; vout: number } }[] = [];
  let tok = start;
  let sats = fee;
  for (let i = 0; i < extras.length && tok.amt >= per; i++) {
    const rest = tok.amt - per;
    const tx = new Transaction();
    tx.addInput({ ...shallowSource(tok.tx, tok.vout), unlockingScriptTemplate: new P2PKH().unlock(key) });
    tx.addInput({ ...shallowSource(sats.tx, sats.vout), unlockingScriptTemplate: new P2PKH().unlock(key) });
    tx.addOutput({ lockingScript: bsv21(id, per, to), satoshis: 1 });
    if (rest > BigInt(0)) tx.addOutput({ lockingScript: bsv21(id, rest, me), satoshis: 1 });
    tx.addOutput({ lockingScript: Script.fromASM(`OP_FALSE OP_RETURN ${[TAG, id, String(startN + i), ...extras[i]].map(hex).join(' ')}`), satoshis: 0 });
    tx.addOutput({ lockingScript: new P2PKH().lock(me), change: true });
    await tx.fee(new SatoshisPerKilobyte(FEE_RATE));
    await tx.sign();
    const changeVout = tx.outputs.length - 1;
    if ((tx.outputs[changeVout].satoshis ?? 0) < 1) break; // out of sats for fees
    const nextTok: TokCoin | null = rest > BigInt(0) ? { id, tx, vout: 1, amt: rest } : null;
    chain.push({ tx, tok: nextTok, sats: { tx, vout: changeVout } });
    sats = { tx, vout: changeVout };
    if (!nextTok) break;
    tok = nextTok;
  }
  return chain;
}

/**
 * The bulk burn for coin ammo (option A, owner 25 Oct 2026): the rounds were plain tagged sats blasts; this ONE tx
 * burns exactly `n × per` tokens to the burn address and keeps the rest in the gun. At most 2 token outputs.
 *   in  [token coins…, fee coin]   out [burn → eater, rest → gun?, OP_RETURN TAG id burn <n> <game>, change]
 */
export async function buildBulkBurn(key: PrivateKey, id: string, coins: TokCoin[], fee: { tx: Transaction; vout: number }, amt: bigint, n: number, game = 'terrornode') {
  const me = key.toAddress();
  const have = coins.reduce((x, c) => x + c.amt, BigInt(0));
  if (amt <= BigInt(0) || have < amt) throw new Error(`Only ${have} tokens to burn ${amt}.`);
  const tx = new Transaction();
  for (const c of coins) tx.addInput({ sourceTransaction: Transaction.fromBinary(c.tx.toBinary()), sourceOutputIndex: c.vout, unlockingScriptTemplate: new P2PKH().unlock(key) });
  tx.addInput({ sourceTransaction: Transaction.fromBinary(fee.tx.toBinary()), sourceOutputIndex: fee.vout, unlockingScriptTemplate: new P2PKH().unlock(key) });
  tx.addOutput({ lockingScript: bsv21(id, amt, BURN_ADDRESS), satoshis: 1 });
  const rest = have - amt;
  if (rest > BigInt(0)) tx.addOutput({ lockingScript: bsv21(id, rest, me), satoshis: 1 });
  tx.addOutput({ lockingScript: Script.fromASM(`OP_FALSE OP_RETURN ${[TAG, id, 'burn', String(n), game].map(hex).join(' ')}`), satoshis: 0 });
  tx.addOutput({ lockingScript: new P2PKH().lock(me), change: true });
  await tx.fee(new SatoshisPerKilobyte(FEE_RATE));
  await tx.sign();
  return { tx, rest, restVout: rest > BigInt(0) ? 1 : -1, changeVout: tx.outputs.length - 1 };
}

type Saved = {
  wif: string;
  tx?: string;
  vout?: number;
  tok?: { id: string; tx: string; vout: number; amt: string };
  /** Paid coins from the wallet's own responses, not yet consolidated into `tx` (never lost if a load stalls). */
  extra?: { tx: string; vout: number }[];
  /** Outpoints our own transactions spent (the index can lag): never reused. Most recent last, capped. */
  spent?: string[];
  /** Coin ammo (option A, 25 Oct 2026): rounds fired with this token's tag, not yet burned as tokens. */
  owed?: { id: string; n: string };
};
/** True when something is stored under the gun key, even if it can't be parsed: then we never overwrite it. */
const hasRaw = () => {
  try {
    return Boolean(localStorage.getItem(STORE) ?? sessionStorage.getItem(STORE));
  } catch {
    return false;
  }
};

const read = (): Saved | null => {
  try {
    // Guns made before 3 Oct 2026 kept their key in sessionStorage: carry it over once.
    return JSON.parse(localStorage.getItem(STORE) ?? sessionStorage.getItem(STORE) ?? 'null');
  } catch {
    return null;
  }
};
/** A gun record we could not read is copied here (never deleted) before a restored key is written over it. */
const keepRaw = () => {
  try {
    for (const st of [localStorage, sessionStorage]) {
      const raw = st.getItem(STORE);
      if (raw) localStorage.setItem(`${STORE}.locked-${Date.now()}`, raw);
    }
  } catch {
    /* storage blocked: nothing was written over it either */
  }
};
/** Shown (and thrown) when the stored gun can not be read: never a new key over it (its coins would be orphaned). */
export const GUN_LOCKED = 'Gun locked: restore from wallet';

/**
 * Storm sessions hold the shared 'tokenblaster-gun' Web Lock, so a session must not sit on it while nothing is being
 * fired (26 Oct 2026: a paused storm in one tab blocked every gun action in another). A session that has been paused
 * (trigger released / nothing queued) for PAUSE_RELEASE_MS, or paused while the tab is hidden for HIDDEN_RELEASE_MS,
 * ends itself: lanes merge back into one coin, the change is saved, the lock is released. onStatus(STORM_RELEASED)
 * tells the page, which reloads (no new payment) the next time there is something to fire.
 */
export const STORM_RELEASED = 'RELEASED';
export const PAUSE_RELEASE_MS = 30_000;
export const HIDDEN_RELEASE_MS = 2_000;

/** A stateful check: true once the session has been idle (paused) long enough to release the gun. */
export function idleRelease(pauseMs = PAUSE_RELEASE_MS, hiddenMs = HIDDEN_RELEASE_MS) {
  let since = 0;
  return (paused: boolean, hidden: boolean, now: number): boolean => {
    if (!paused) {
      since = 0;
      return false;
    }
    if (!since) since = now;
    return now - since >= (hidden ? hiddenMs : pauseMs);
  };
}
/** Thrown by unloadTokens when the gun has tokens but not enough sats to pay the transfer fee. */
export class GunNeedsSats extends Error {
  constructor(readonly sats: number, readonly id: string) {
    super(`The gun needs ${sats.toLocaleString()} more sats to pay the fee to return your tokens. Load at least ${sats.toLocaleString()} sats, then UNLOAD again.`);
  }
}
/**
 * Sats needed to return `nTok` token coins in one transfer when the gun holds `have` sats: the fee for
 * [nTok token inputs + 1 fee input] -> [token out, change] at FEE_RATE, plus the 1-sat token output and 1 sat of change.
 */
export function satsToRescue(nTok: number, have: number): number {
  const bytes = 10 + (nTok + 1) * 148 + (9 + 260) + 34;
  // In: `have` sats plus the 1 sat each token coin carries. Out: the 1-sat token output and at least 1 sat of change.
  const fee = Math.ceil((bytes * FEE_RATE) / 1000);
  return Math.max(0, fee + 2 - nTok - Math.max(0, have));
}
const write = (s: Saved) => {
  try {
    localStorage.setItem(STORE, JSON.stringify(s));
  } catch {
    /* storage blocked: the gun still works for this page view */
  }
};

/**
 * Tell bWalletX what the gun spent, so its side panel can show a live "gun session" meter
 * (bwallet:session-spend v1, bwalletX docs/LIVE-BALANCE.md). Display only: it can never move
 * funds, and a wallet that doesn't know the message just ignores it.
 */
const reportToWallet = (sats: number, left: number) => {
  if (typeof window === 'undefined') return;
  const msg = { type: 'bwallet:session-spend', v: 1, session: 'gun', sats, left, label: 'TokenBlaster gun' };
  try {
    window.postMessage(msg, window.location.origin);
    if (window.parent !== window) window.parent.postMessage(msg, '*');
  } catch {
    /* the wallet just won't show a meter */
  }
};

/**
 * Load timing (owner, 24 Oct 2026): '[tb-load]' console lines with ms per stage, so a real test shows where
 * the time goes. `loadMark('approve start')` starts a new timeline.
 */
let loadT0 = 0;
let loadLast = 0;
/** A player's press starts a new timeline, so a "+19 s" never reads as 19 s of work that was really idle time. */
const NEW_TIMELINE = /^(approve start|start pressed|retry pressed|pay:|lock & load|demo: INSERT)/;
export function loadMark(stage: string) {
  const t = typeof performance !== 'undefined' ? performance.now() : Date.now();
  if (NEW_TIMELINE.test(stage) || !loadT0) loadT0 = loadLast = t;
  // `at` is the absolute time since the page opened: compare lines across timelines with it.
  console.info(`[tb-load] ${stage}: +${Math.round(t - loadLast)} ms (total ${Math.round(t - loadT0)} ms, at ${(t / 1000).toFixed(1)} s)`);
  loadLast = t;
}

export class Gun {
  private key: PrivateKey;
  private coin: { tx: Transaction; vout: number } | null = null;
  private tok: TokCoin | null = null; // the token UTXO the gun is firing from
  private spentTok = new Set<string>(); // token outpoints we have spent (the indexer may lag)
  private arc = new ARC(ARC_URL);
  private lastReported: number | null = null; // sats left when we last told the wallet
  /** Paid coins not yet consolidated (from the wallet's response). */
  private extra: { tx: Transaction; vout: number }[] = [];
  /** Outpoints our own broadcasts spent. */
  private spent = new Set<string>();
  /** Storage held something we could not read: never write over it (the owner's key may be in it). */
  private readOnly = false;
  /** The running storm session (so a new LOCK & LOAD can end it) and its halt flag. */
  private session: Promise<unknown> | null = null;
  /** Rounds fired under a coin's tag, owed as a bulk burn (persisted, so a closed tab burns them on the next load/unload). */
  private owed: { id: string; n: bigint } | null = null;
  private halt = false;
  /**
   * The stored record exists but its key can't be read (25 Oct 2026 audit: this used to make a fresh key and orphan
   * the old coins). Nothing runs until the key is restored from the wallet backup; the record is never overwritten.
   */
  private lockedGun = false;
  /** No gun was stored: this key was just made, so a wallet backup (an older gun) may take its place while it's empty. */
  private freshGun = false;

  constructor() {
    const win = typeof window !== 'undefined';
    const s = win ? read() : null;
    let key: PrivateKey | null = null;
    if (s) {
      try {
        key = typeof s.wif === 'string' ? PrivateKey.fromWif(s.wif) : null;
      } catch {
        key = null;
      }
    }
    if (win && !key && hasRaw()) this.readOnly = this.lockedGun = true;
    this.freshGun = !key && !this.lockedGun;
    this.key = key ?? PrivateKey.fromRandom();
    if (key && s) {
      try {
        if (s.tx) this.coin = { tx: Transaction.fromHex(s.tx), vout: s.vout ?? 0 };
        if (s.tok) this.tok = { id: s.tok.id, tx: Transaction.fromHex(s.tok.tx), vout: s.tok.vout, amt: BigInt(s.tok.amt) };
        this.owed = s.owed ? { id: s.owed.id, n: BigInt(s.owed.n) } : null;
      } catch {
        // The key is fine but its coin notes are not: keep a copy, keep the key, re-read the coins from the chain.
        keepRaw();
        this.coin = this.tok = this.owed = null;
      }
    }
    this.loadSets(key ? s : null);
    this.save();
    // Every key is listed BEFORE it can be paid, so nothing that later replaces the gun can orphan its coins.
    if (win && !this.lockedGun) archiveKey(this.key);
  }

  /**
   * The key a reload would get back is THIS key (storage works and holds it). False in a private window or with
   * storage blocked: paying into it then would lose the coins on a reload, so the load refuses to pay.
   */
  get persisted(): boolean {
    if (this.lockedGun) return false;
    const wif = this.key.toWif();
    return keyPersisted(wif) && archivedKeys().some((k) => k.wif === wif);
  }

  /** The stored gun could not be read: restore it from the wallet backup (nothing else runs). */
  get locked() {
    return this.lockedGun;
  }

  /** This browser had no gun: the key was just made (a wallet backup may replace it while it is empty). */
  get fresh() {
    return this.freshGun;
  }

  /** Nothing tracked in the gun right now (the caller also checks the chain before replacing a fresh key). */
  private emptyLocally() {
    return !this.coin && !this.tok && !this.extra.length && !(this.owed && this.owed.n > BigInt(0));
  }

  /**
   * Use a key restored from the player's wallet backup. Only over a locked gun (its unreadable record is kept as
   * tokenblaster.gun.locked-<time>) or a fresh, empty one; never over a gun that holds a key of its own.
   */
  adoptKey(key: PrivateKey): boolean {
    if (!this.lockedGun && !(this.freshGun && this.emptyLocally())) return false;
    if (this.lockedGun) keepRaw();
    // Both keys stay listed: the one given up (it may have been paid after all) and the restored one.
    archiveKey(this.key);
    archiveKey(key);
    this.key = key;
    this.coin = this.tok = this.owed = null;
    this.extra = [];
    this.spent = new Set();
    this.spentTok = new Set();
    this.lockedGun = this.readOnly = this.freshGun = false;
    this.save();
    return true;
  }

  /** The gun key as WIF, for the player's own "Back up gun key" (after an explicit confirm) and the wallet backup. */
  exportWif(): string {
    if (this.lockedGun) throw new Error(GUN_LOCKED);
    return this.key.toWif();
  }

  private loadSets(s: Saved | null) {
    try {
      this.extra = (s?.extra ?? []).map((e) => ({ tx: Transaction.fromHex(e.tx), vout: e.vout }));
    } catch {
      this.extra = [];
    }
    this.spent = new Set(s?.spent ?? []);
  }

  /** Remember every input of a transaction we broadcast: those outpoints are spent, whatever the index says. */
  private markSpent(tx: Transaction) {
    for (const i of tx.inputs) {
      const id = i.sourceTXID ?? i.sourceTransaction?.id('hex');
      if (id) this.spent.add(`${id}_${i.sourceOutputIndex}`);
    }
  }

  /** Another tab may have fired since: take the latest coin from storage. */
  private refresh() {
    const s = read();
    if (s?.wif !== this.key.toWif()) return;
    this.coin = s.tx ? { tx: Transaction.fromHex(s.tx), vout: s.vout ?? 0 } : null;
    this.loadSets(s);
    // The token coin the gun is firing from: saved, so a reload doesn't depend on the index catching up.
    this.tok = s.tok ? { id: s.tok.id, tx: Transaction.fromHex(s.tok.tx), vout: s.tok.vout, amt: BigInt(s.tok.amt) } : null;
    this.owed = s.owed ? { id: s.owed.id, n: BigInt(s.owed.n) } : null;
  }

  /** One tab fires at a time (Web Locks); falls back to running directly where unsupported. */
  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    if (this.lockedGun) return Promise.reject(new Error(GUN_LOCKED));
    const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
    if (!locks) return fn();
    // Don't wait forever on a tab that is stuck holding the gun.
    return (locks.request('tokenblaster-gun', { signal: AbortSignal.timeout(10_000) }, fn) as Promise<T>).catch((e) => {
      if (e instanceof DOMException && (e.name === 'TimeoutError' || e.name === 'AbortError')) {
        throw new Error('Another TokenBlaster tab is using the gun. Close it and try again.');
      }
      throw e;
    });
  }

  /** Re-sync with the chain after a double spend: the largest unspent coin at the gun's address. */
  private async resync() {
    const coins = (await this.coinsOnChain()).filter((c) => !this.spent.has(`${c.tx.id('hex')}_${c.vout}`));
    coins.sort((a, b) => (b.tx.outputs[b.vout].satoshis ?? 0) - (a.tx.outputs[a.vout].satoshis ?? 0));
    this.coin = coins[0] ?? null;
    this.save();
  }

  get address() {
    return this.key.toAddress();
  }

  /** Sats loaded in the gun right now. */
  get sats() {
    return this.coin ? (this.coin.tx.outputs[this.coin.vout].satoshis ?? 0) : 0;
  }

  private save() {
    if (this.readOnly) return;
    write({
      extra: this.extra.length ? this.extra.map((e) => ({ tx: e.tx.toHex(), vout: e.vout })) : undefined,
      spent: this.spent.size ? [...this.spent].slice(-2000) : undefined,
      wif: this.key.toWif(),
      tx: this.coin?.tx.toHex(),
      vout: this.coin?.vout,
      owed: this.owed && this.owed.n > BigInt(0) ? { id: this.owed.id, n: this.owed.n.toString() } : undefined,
      tok: this.tok && this.tok.amt > BigInt(0) ? { id: this.tok.id, tx: this.tok.tx.toHex(), vout: this.tok.vout, amt: this.tok.amt.toString() } : undefined,
    });    const left = this.sats;
    const prev = this.lastReported;
    this.lastReported = left;
    if (prev !== null && left !== prev) reportToWallet(Math.max(0, prev - left), left);
  }

  /**
   * The gun's real spendable coins: the chain lookup, plus the wallet's own payment responses, plus our own
   * broadcast change, each once, minus everything our own transactions spent. Largest first.
   */
  private async candidates(): Promise<{ tx: Transaction; vout: number }[]> {
    this.refresh();
    const chain = await this.coinsOnChain().catch(() => [] as { tx: Transaction; vout: number }[]);
    const tag = (l: { tx: Transaction; vout: number }[]) => l.map((c) => ({ txid: c.tx.id('hex'), vout: c.vout, sats: c.tx.outputs[c.vout]?.satoshis ?? 0, c }));
    const own = this.coin ? [this.coin] : [];
    return spendableCoins([tag(this.extra), tag(own), tag(chain)], this.spent).map((x) => x.c);
  }

  /**
   * Did payment `ref` (src/lib/wallet.ts payRefScript) or `txid` reach the gun? Looks at the wallet responses this gun
   * saved and at the coins on chain. Never a balance comparison. Null when the chain could not be read (and nothing
   * local proves it): the caller must not send the payment again on a null.
   */
  async findPayment(ref: string, txid?: string, sats?: number): Promise<boolean | null> {
    this.refresh();
    const match = (tx: Transaction) => (txid && tx.id('hex') === txid) || hasPayRef(tx, ref);
    if (this.extra.some((c) => match(c.tx)) || (this.coin && match(this.coin.tx))) return true;
    // Fast path (31 Oct 2026: this check took 9 s+ on LOCK & LOAD): the payment's gun output is exactly `sats`
    // (wallet.ts fund), so read amounts only and fetch the hex of just those candidates, not of every dust coin.
    if (sats && sats > 0) {
      const amounts = await this.amountsOnChain('find payment').catch(() => null);
      if (!amounts) return null;
      const ids = [...new Set(amounts.filter((c) => c.sats === sats || c.txid === txid).map((c) => c.txid))];
      try {
        const txs = await Promise.all(ids.map(async (t) => Transaction.fromHex(await txHex(t))));
        return txs.some(match);
      } catch {
        return null; // a candidate could not be read: unknown, never "not paid"
      }
    }
    const chain = await this.coinsOnChain().catch(() => null);
    if (!chain) return null;
    return chain.some((c) => match(c.tx));
  }

  /**
   * Spendable sats at the gun right now (what the CREDIT shows). Reads amounts only (no parent tx hex), so the
   * first read on page load is quick even for a gun holding hundreds of dust coins (29 Oct audit: 14 s). The hex
   * is fetched only when a spend needs it (gather, consolidate, unload).
   */
  async balance(caller = 'unknown', strict = false): Promise<number> {
    this.refresh();
    const tag = (l: { tx: Transaction; vout: number }[]) => l.map((c) => ({ txid: c.tx.id('hex'), vout: c.vout, sats: c.tx.outputs[c.vout]?.satoshis ?? 0 }));
    // `strict`: an unreadable chain throws instead of counting as "no coins" (31 Oct: a $0.00 that wasn't).
    const chain = await this.amountsOnChain(caller).catch((e) => {
      if (strict) throw e;
      return [] as { txid: string; vout: number; sats: number }[];
    });
    return spendableCoins([tag(this.extra), tag(this.coin ? [this.coin] : []), chain], this.spent).reduce((n, c) => n + c.sats, 0);
  }

  /**
   * Take the funding transaction from the wallet's own response. No lock and no network: it is saved at
   * once, so a paid coin can never be lost to a busy gun; the next LOCK & LOAD consolidates it.
   */
  async load(funding: Transaction) {
    const vout = funding.outputs.findIndex((o) => o.lockingScript.toHex() === new P2PKH().lock(this.address).toHex());
    if (vout < 0) throw new Error('Funding transaction does not pay the gun.');
    this.refresh();
    const fresh = { tx: Transaction.fromHex(funding.toHex()), vout };
    if (!this.extra.some((e) => e.tx.id('hex') === fresh.tx.id('hex') && e.vout === vout)) this.extra.push(fresh);
    if (!this.coin || this.sats < 1) this.coin = fresh;
    this.save();
    loadMark(`paid coin saved (${fresh.tx.outputs[vout].satoshis ?? 0} sats)`);
  }

  /**
   * Rebuild the coin set into ONE coin from the real unspent outputs. If a stale coin makes the merge fail,
   * fall back to fewer coins (our own, then the wallet's payments, then the largest alone). Never reuses spent coins.
   */
  private async consolidate(coins: { tx: Transaction; vout: number }[]) {
    const key = (c: { tx: Transaction; vout: number }) => `${c.tx.id('hex')}_${c.vout}`;
    const ownKeys = new Set([...this.extra, ...(this.coin ? [this.coin] : [])].map(key));
    const tiers = [coins, coins.filter((c) => ownKeys.has(key(c))), coins.filter((c) => this.extra.some((e) => key(e) === key(c)))].filter((t, i, all) => t.length && all.findIndex((x) => x.length === t.length) === i);
    for (const tier of tiers) {
      if (tier.length === 1) {
        this.coin = tier[0];
        this.extra = [];
        this.save();
        return;
      }
      const tx = new Transaction();
      for (const c of tier.slice(0, 200)) tx.addInput({ sourceTransaction: c.tx, sourceOutputIndex: c.vout, unlockingScriptTemplate: new P2PKH().unlock(this.key) });
      tx.addOutput({ lockingScript: new P2PKH().lock(this.address), change: true });
      await tx.fee(new SatoshisPerKilobyte(FEE_RATE));
      await tx.sign();
      try {
        await this.send(tx, 2);
        this.coin = { tx: Transaction.fromHex(tx.toHex()), vout: 0 };
        this.extra = [];
        this.save();
        loadMark(`coins consolidated (${tier.length} → 1)`);
        return;
      } catch (e) {
        console.info('[tb-load] merge refused, trying fewer coins', e instanceof Error ? e.message : e);
      }
    }
    // Last resort: the largest coin alone.
    if (coins[0]) {
      this.coin = coins[0];
      this.save();
    }
  }

  /** True while a storm session is running (it holds the gun lock). */
  get inSession() {
    return this.session !== null;
  }

  /** End the running storm session (if any): stop its sender, wait for it to merge and save the change. */
  async endSession(timeoutMs = 20_000) {
    const s = this.session;
    if (!s) {
      // Loaded but never fired: still stop the background fan-out feed before anything else uses the coins.
      const a = this.ready;
      this.ready = null;
      await this.stopFeed(a);
      return;
    }
    this.halt = true;
    loadMark('ending previous session');
    await Promise.race([s.catch(() => undefined), new Promise((r) => setTimeout(r, timeoutMs))]);
    loadMark('previous session ended');
  }

  private async send(tx: Transaction, tries = 5) {
    const txid = tx.id('hex');
    // The wallet may still be propagating the parent; retry briefly before giving up.
    for (let attempt = 0; ; attempt++) {
      const r = await tx.broadcast(this.arc);
      if (r.status === 'success') return this.markSpent(tx);
      // A retry of a tx ARC already has can come back as an error (e.g. "invalid competing
      // transaction identifiers"). Ask ARC directly before treating it as a failure.
      if (await this.known(txid)) return this.markSpent(tx);
      if (attempt >= tries - 1) throw new Error(`ARC rejected ${txid}: ${'description' in r ? r.description : JSON.stringify(r)}`);
      await new Promise((ok) => setTimeout(ok, 500 * (attempt + 1)));
    }
  }

  /**
   * Broadcast an ordered chain and return how many ARC really took. A slow ARC or a false error
   * (@bsv/sdk flags ARC's `competingTxs: null` as a failure) is checked against ARC's own status.
   */
  private async broadcastChain(txs: Transaction[]): Promise<{ accepted: number; why?: string }> {
    let results: { status?: string; txStatus?: string; description?: string; code?: string | number }[] = [];
    try {
      results = (await Promise.race([
        this.arc.broadcastMany(txs),
        new Promise<never>((_, no) => setTimeout(() => no(new Error('ARC did not answer within 20 s.')), 20_000)),
      ])) as typeof results;
    } catch (e) {
      results = [{ description: e instanceof Error ? e.message : String(e) }];
    }
    let accepted = 0;
    while (accepted < txs.length && good(results[accepted])) accepted++;
    if (accepted < txs.length) {
      if (await this.known(txs[txs.length - 1].id('hex'))) accepted = txs.length;
      else while (accepted < txs.length && (await this.known(txs[accepted].id('hex')))) accepted++;
    }
    for (const t of txs.slice(0, accepted)) this.markSpent(t);
    const r = results[accepted];
    return { accepted, why: r ? `${r.description ?? 'no response'}${r.code ? ` (code ${r.code})` : ''}` : undefined };
  }

  /** True once the network itself has the tx (not just ARC's queue). */
  private async seen(txid: string): Promise<boolean> {
    try {
      const r = await fetch(`${ARC_URL}/v1/tx/${txid}`);
      const { txStatus } = (await r.json()) as { txStatus?: string };
      return ['SEEN_ON_NETWORK', 'ACCEPTED_BY_NETWORK', 'MINED', 'IMMUTABLE'].includes(txStatus ?? '');
    } catch {
      return false;
    }
  }

  /** True when ARC reports the tx as on its way into (or already in) a block. */
  private async known(txid: string): Promise<boolean> {
    try {
      const r = await fetch(`${ARC_URL}/v1/tx/${txid}`);
      if (!r.ok) return false;
      const { txStatus } = (await r.json()) as { txStatus?: string };
      return ['RECEIVED', 'STORED', 'ANNOUNCED_TO_NETWORK', 'REQUESTED_BY_NETWORK', 'SENT_TO_NETWORK', 'ACCEPTED_BY_NETWORK', 'SEEN_ON_NETWORK', 'MINED', 'IMMUTABLE'].includes(txStatus ?? '');
    } catch {
      return false;
    }
  }

  /**
   * Fire one blast for `token`. `extra` pushes go after the count, e.g. ['arena', '<target>'] for an
   * arena shot (the leaderboard reads only the tag and the token). Returns the txid.
   */
  async fire(token: string, n: number, extra: string[] = []): Promise<string> {
    return this.exclusive(async () => {
      this.refresh();
      try {
        return await this.fireOnce(token, n, extra);
      } catch (e) {
        if (!/DOUBLE_SPEND|competing/i.test(e instanceof Error ? e.message : String(e))) throw e;
        await this.resync();
        return this.fireOnce(token, n, extra);
      }
    });
  }

  /**
   * Fire many blasts in one go: build a chain of `extras.length` blasts locally (signing is fast),
   * send it to ARC in one batch request, and keep the coin at the last blast ARC accepted. This is
   * what lets the arena fire thousands of shots instead of a few a second. Returns accepted txids.
   */
  /** `pay`: an optional payment output in every blast (e.g. 1 sat to the house per game action). */
  /** `signal`: once aborted, nothing more is broadcast (START's timeout cancels the play payment, src/lib/coinop/startPlay.ts). */
  async fireBatch(token: string, startN: number, extras: string[][], pay?: { address: string; sats: number } | { address: string; sats: number }[], signal?: AbortSignal): Promise<string[]> {
    const pays = pay ? (Array.isArray(pay) ? pay : [pay]) : [];
    const abortCheck = () => {
      if (signal?.aborted) throw new Error('START_ABORTED');
    };
    abortCheck();
    return this.exclusive(async () => {
      abortCheck();
      this.refresh();
      let chain: Transaction[] = [];
      let accepted = 0;
      let why: string | undefined;
      // No coin of our own yet (owner, 25 Oct 2026: a payment whose tx the wallet never handed back reached the
      // gun's address, so the CREDIT showed $1.00 from the chain while this.coin was empty and LOCK & LOAD failed):
      // adopt the real coin set first. No wallet involved.
      if (this.needsCoin()) await this.startCoin(() => undefined).catch(() => undefined);
      for (let attempt = 0; attempt < 3; attempt++) {
        if (!this.coin) throw new Error('The gun is empty. Load it first.');
        chain = [];
        let prev = this.coin;
        for (let i = 0; i < extras.length; i++) {
          const tx = new Transaction();
          tx.addInput({ sourceTransaction: prev.tx, sourceOutputIndex: prev.vout, unlockingScriptTemplate: new P2PKH().unlock(this.key) });
          tx.addOutput({ lockingScript: Script.fromASM(`OP_FALSE OP_RETURN ${[TAG, ammoPush(token), String(startN + i), ...extras[i]].map(hex).join(' ')}`), satoshis: 0 });
          for (const p of pays) tx.addOutput({ lockingScript: new P2PKH().lock(p.address), satoshis: p.sats });
          tx.addOutput({ lockingScript: new P2PKH().lock(this.address), change: true });
          await tx.fee(new SatoshisPerKilobyte(FEE_RATE));
          await tx.sign();
          const changeVout = tx.outputs.length - 1;
          if ((tx.outputs[changeVout].satoshis ?? 0) < 1) break; // out of ammo: send what we have
          chain.push(tx);
          prev = { tx, vout: changeVout };
        }
        if (!chain.length) throw new Error('Out of ammo.');
        abortCheck(); // the last moment a timed-out START can still stop the payment
        ({ accepted, why } = await this.broadcastChain(chain));
        if (accepted) break;
        // Nothing went through: our coin is probably stale. Re-read it from the chain and try again.
        await new Promise((ok) => setTimeout(ok, 700 * (attempt + 1)));
        await this.resync().catch(() => undefined);
      }
      if (!accepted) throw new Error(`ARC rejected the batch: ${why ?? 'no response'}`);
      const last = chain[accepted - 1];
      this.coin = { tx: Transaction.fromHex(last.toHex()), vout: last.outputs.length - 1 };
      this.save();
      return chain.slice(0, accepted).map((t) => t.id('hex'));
    });
  }

  /** True when the gun has no coin of its own to fire from (none saved, or the saved one is already spent). */
  private needsCoin() {
    return !this.coin || this.spent.has(`${this.coin.tx.id('hex')}_${this.coin.vout}`) || this.sats < 1;
  }

  /**
   * Gather every spendable coin at the gun's address (the chain, the wallet's payments, our own change) into the
   * one coin the gun fires from, and return its sats. LOCK & LOAD runs this first, so credit that reached the gun
   * by any route (a wallet that only returned a txid, another tab, an earlier page load) becomes rounds without a
   * new payment. Never asks the wallet anything.
   */
  async gather(): Promise<number> {
    return this.exclusive(async () => {
      this.refresh();
      await this.startCoin(() => undefined);
      return this.sats;
    });
  }

  /** Lane coins fanned out ahead of time by prepareStorm(), so the first trigger pull fires at once. */
  private ready: Ammo | null = null;
  /** The load whose leaves are still streaming in (set by prepareStorm, kept through its storm). */
  private feeding: Ammo | null = null;
  /** True while a streamed load's background leaves are still arriving ("loading more rounds…"). */
  get moreRoundsLoading(): boolean {
    const a = this.feeding;
    return !!a && !a.ended && !a.cancelled;
  }

  /** Stop a background fan-out feed (a new LOCK & LOAD, an ended session) and wait for its last POST to settle. */
  private async stopFeed(a: Ammo | null) {
    if (!a) return;
    a.cancelled = true;
    await a.done.catch(() => undefined);
  }

  /**
   * The gun's coin to fire from. The chain index can lag a freshly paid load by many seconds (a BRC-100
   * wallet broadcasts it itself), so when the index has nothing yet we fall back to the coin load() saved:
   * ARC accepts a chain that spends an accepted, unconfirmed parent. Merges several coins into one.
   */
  private async startCoin(onWait: (secs: number) => void) {
    // Start from the real coin set: the wallet's payment output(s), our own change and the chain's unspent
    // outputs, consolidated into one. Coins our transactions already spent are never used (owner, 24 Oct 2026).
    const t0 = Date.now();
    let coins = await this.candidates();
    for (let i = 0; !coins.length && i < 6; i++) {
      onWait(Math.round((Date.now() - t0) / 1000));
      await new Promise((r) => setTimeout(r, 1500));
      coins = await this.candidates();
    }
    if (!coins.length) throw new Error('EMPTY');
    loadMark(`coin set: ${coins.length} coin(s), ${coins.reduce((n, c) => n + (c.tx.outputs[c.vout].satoshis ?? 0), 0)} sats`);
    if (coins.length > 1) await this.consolidate(coins);
    else {
      this.coin = coins[0];
      this.extra = [];
      this.save();
    }
  }

  /**
   * Do all the slow work before the game starts (LOCK & LOAD): find the coin, fan it out WIDE into lane coins and
   * wait until the network has the fan-out. `onStep(pct, slowSecs)`: progress 0..100; slowSecs > 0 while waiting.
   * After this, storm() fires on the first trigger pull.
   *
   * Wide, not deep (GorillaPool, 26 Oct 2026: a child POSTed with its parent is orphaned, and deep chains never
   * recover): ceil(total / LANE_DEPTH) lane coins, each carrying at most LANE_DEPTH blasts. Up to SPLIT_OUTPUTS lanes
   * go in ONE fan-out tx; more go in a root tx paying ceil(lanes / SPLIT_OUTPUTS) leaf fan-outs, broadcast level by
   * level (the root, then the leaves together once the network has the root), never a parent with its child.
   */
  async prepareStorm(total: number, perBlast: number, onStep: (pct: number, slowSecs: number) => void = () => undefined): Promise<void> {
    await this.endSession();
    await this.stopFeed(this.ready);
    return this.exclusive(async () => {
      this.refresh();
      this.ready = null;
      this.halt = false;
      loadMark(`prepare: ${total} rounds`);
      onStep(10, 0);
      await this.startCoin((secs) => onStep(15, secs));
      if (!this.coin) throw new Error('EMPTY');
      onStep(30, 0);
      const plan = fanoutPlan(total, perBlast);
      const { lanes: lanesN, perLane, each, sizes, leaves, leafFee, need } = plan;
      if (this.sats < need) throw new Error('SHORT');
      const root = new Transaction();
      const lock = new P2PKH().lock(this.address);
      root.addInput({ sourceTransaction: this.coin.tx, sourceOutputIndex: this.coin.vout, unlockingScriptTemplate: new P2PKH().unlock(this.key) });
      if (leaves) sizes.forEach((k, i) => root.addOutput({ lockingScript: lock, satoshis: k * each + leafFee[i] }));
      else for (let i = 0; i < lanesN; i++) root.addOutput({ lockingScript: lock, satoshis: each });
      root.addOutput({ lockingScript: lock, change: true });
      await root.fee(new SatoshisPerKilobyte(FEE_RATE));
      await root.sign();
      loadMark(`fan-out root built: ${lanesN} lanes x ${perLane} deep${leaves ? ` over ${leaves} leaves (streamed)` : ''}`);
      onStep(45, 0);
      // Level 1: the root, through the gun's usual send (retries, a parent the wallet is still propagating).
      await this.send(root);
      const rootTxid = root.id('hex');
      this.coin = { tx: Transaction.fromHex(root.toHex()), vout: root.outputs.length - 1 };
      this.save();
      // Wait for the network (not just ARC) to have it: lanes (or leaves) spend it next.
      const bc = makeBroadcaster('arc', ARC_URL);
      const t0 = Date.now();
      const tick = setInterval(() => onStep(leaves ? 55 : 70, Math.round((Date.now() - t0) / 1000)), 1000);
      const ammo: Ammo = { batches: [], push: null, end: null, ended: false, cancelled: false, done: Promise.resolve(), maxN: total + 1, used: [] };
      const hand = (bases: StormBase[], lanes: LaneSpec[]) => {
        const b = { bases, lanes };
        for (const x of bases) ammo.used.push({ txid: x.txid, n: lanes.filter((l) => l.base === x.i).length });
        if (ammo.push) ammo.push(b);
        else ammo.batches.push(b);
      };
      const finish = () => {
        ammo.ended = true;
        ammo.end?.();
      };
      try {
        const rootSeen = await settleTxs(bc, [{ ef: Uint8Array.from(root.toEF()), txid: rootTxid }], { deadlineMs: FANOUT_SEEN_MS });
        loadMark(`fan-out root ${rootSeen.seen.size ? 'seen on network' : `NOT seen yet (${JSON.stringify(rootSeen.statuses)}): lanes will wait per lane`}`);
        if (!leaves) {
          const lanes: LaneSpec[] = [];
          for (let j = 0, left = total; j < sizes[0] && left > 0; j++, left -= perLane) lanes.push({ base: 0, vout: j, count: Math.min(perLane, left) });
          hand([{ i: 0, txid: rootTxid, values: root.outputs.map((o) => o.satoshis ?? 0) }], lanes);
          finish();
        } else {
          // Level 2, streamed: one leaf first (GO as soon as the network has it), the rest in the background.
          onStep(75, 0);
          const st = streamLeaves({
            root,
            plan,
            total,
            key: this.key,
            address: this.address,
            bc,
            seenMs: FANOUT_SEEN_MS,
            cancelled: () => ammo.cancelled,
            onSpent: (op) => this.spent.add(op),
            onReady: hand,
            log: loadMark,
          });
          ammo.done = st.done.then(
            (r) => {
              loadMark(`fan-out feed done: ${r.fed} lanes live${r.unseen.length ? `, ${r.unseen.length} leaves never seen (not used)` : ''}`);
              finish();
            },
            (e) => {
              loadMark(`fan-out feed stopped: ${e instanceof Error ? e.message : String(e)}`);
              finish();
            },
          );
          const fed = await st.first;
          if (!fed) {
            ammo.cancelled = true;
            await ammo.done;
            throw new Error('ARC took none of the fan-out: try LOCK & LOAD again.');
          }
          loadMark(`GO: first ${fed} lanes live after ${Math.round((Date.now() - t0) / 1000)} s; the rest load while you fire`);
        }
      } finally {
        clearInterval(tick);
      }
      onStep(95, 0);
      this.ready = ammo;
      this.feeding = ammo;
      loadMark('ready');
      onStep(100, 0);
    });
  }

  /**
   * Storm: fire `total` blasts as fast as the network will take them, from the lane coins prepareStorm() fanned out
   * (it runs first if nothing is ready). Each lane sends at most MAX_DEPTH blasts, one POST at a time, the next only
   * once the network has the last (src/lib/stormCore.ts): no POST ever holds a parent and its child. The
   * broadcaster is ARC unless stormBroadcaster() says Arcade. Lane ends merge back into one coin.
   * `onProgress(sent, lastTxid)` after every request; `stop()` returning true ends it; `paused()` returning
   * true holds fire without ending the session (trigger released), so the next pull fires at once.
   */
  async storm(
    token: string,
    total: number,
    onProgress: (sent: number, last?: string, net?: StormNet) => void,
    stop: () => boolean = () => false,
    onStatus: (s: string) => void = () => undefined,
    /** The <game> push (default 'bsvgun') and short pushes after it, e.g. the player's handle. */
    tag: { game?: string; extra?: string[] } = {},
    /** Sats each blast needs (default STORM_FEE); a longer tag needs more. */
    perBlast: number = STORM_FEE,
    paused: () => boolean = () => false,
    /** Most blasts per lane per ARC round (src/lib/gallery.ts STREAM_STEP). */
    step = STREAM_STEP,
  ): Promise<number> {
    if (!this.ready) await this.prepareStorm(total, perBlast, (pct) => onStatus(`Loading… ${pct}%`));
    const userStop = stop;
    const idle = idleRelease();
    let released = false;
    let gone = false; // the page is going away: end at once, never keep the lock past it
    const onHide = () => (gone = true);
    if (typeof window !== 'undefined') window.addEventListener('pagehide', onHide);
    stop = () => {
      if (this.halt || gone || userStop()) return true;
      const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
      if (!released && idle(paused(), hidden, Date.now())) {
        released = true;
        loadMark(`storm idle${hidden ? ' (tab hidden)' : ''}: ending the session to release the gun`);
      }
      return released;
    };
    const run = this.exclusive(async () => {
      const r = this.ready;
      if (!r) throw new Error('The gun is not loaded.');
      this.ready = null;
      let n = 1;
      const number = (ls: LaneSpec[]): StormLane[] =>
        ls.map((l) => {
          const lane = { base: l.base, vout: l.vout, count: l.count, n };
          n += l.count;
          return lane;
        });
      const cores = Math.max(1, Math.min(plannedLanes(total), (navigator.hardwareConcurrency || 4) - 1, 12));
      const via = stormBroadcaster();
      let failed: string | null = null;
      loadMark(`storm: ${r.batches.reduce((k, b) => k + b.lanes.length, 0)} lanes live (more streaming in: ${!r.ended}), ${MAX_DEPTH} deep, via ${via}`);
      // Built by `pnpm storm:build` from src/workers/storm.ts (esbuild; Turbopack ships workers as raw TS).
      const { sent, lastWhy, net } = await runStorm({
        workerUrl: '/storm-worker.js',
        // Streamed: only { txid, values } per fan-out reaches the workers, lane batches as their leaf is SEEN.
        feed: {
          maxN: r.maxN,
          subscribe: (push, end) => {
            for (const b of r.batches.splice(0)) push({ bases: b.bases, lanes: number(b.lanes) });
            r.push = (b) => push({ bases: b.bases, lanes: number(b.lanes) });
            r.end = end;
            if (r.ended) end();
          },
        },
        lanes: [],
        wif: this.key.toWif(),
        token,
        step,
        game: tag.game,
        extra: tag.extra,
        arcs: [via === 'arcade' ? ARCADE_DEFAULT : ARC_DEFAULT],
        broadcaster: via,
        maxDepth: MAX_DEPTH,
        cores,
        stop,
        paused,
        onSent: onProgress,
        onWhy: () => onStatus('STALL'),
        onBatch: batchLogger(),
      });
      // What the broadcaster said about each accepted blast: only SEEN_ON_NETWORK-type statuses are on the network
      // now; STORED / QUEUED / SEEN_IN_ORPHAN_MEMPOOL are held and relayed later (the owner's "batch long after", 25 Oct).
      loadMark(`${via} statuses: ${JSON.stringify(net.statuses)} (seen on network: ${net.seen}/${sent}, orphans ${net.orphans})`);
      if (!sent) failed = `${via} took no blasts: ${lastWhy ?? 'no reason given'}`;
      // Session end: merge the lane ends (and the fan-out change) back into one coin once the last blasts settle,
      // and save it. The fan-out's lanes are spent by the workers: never reuse them.
      // Stop the background feed first: no leaf may be POSTed while the coin set is merged.
      await this.stopFeed(r);
      await new Promise((ok) => setTimeout(ok, 6000));
      if (sent) for (const u of r.used) for (let v = 0; v < u.n; v++) this.spent.add(`${u.txid}_${v}`);
      try {
        const coins = await this.candidates();
        if (coins.length > 1) await this.consolidate(coins);
        else this.coin = coins[0] ?? null;
      } catch {
        /* the next LOCK & LOAD rebuilds the coin set anyway */
      }
      this.save();
      loadMark(`session ended: ${sent} sent, ${this.sats} sats saved`);
      if (failed && !sent) throw new Error(failed);
      return sent;
    });
    this.session = run;
    try {
      return await run;
    } finally {
      if (this.session === run) this.session = null;
      this.halt = false;
      if (typeof window !== 'undefined') window.removeEventListener('pagehide', onHide);
      if (released) onStatus(STORM_RELEASED);
    }
  }

  // ── Coin ammo, option A (owner 25 Oct 2026): tagged sats rounds, one bulk burn ──────────

  /** Rounds of coin `id` fired and not yet burned. */
  owedBurn(): { id: string; n: bigint } | null {
    this.refresh();
    return this.owed && this.owed.n > BigInt(0) ? { ...this.owed } : null;
  }

  /** Count `rounds` more fired under coin `id`'s tag (saved at once). A different coin's debt is burned first by the caller. */
  oweBurn(id: string, rounds: number) {
    if (rounds <= 0) return;
    this.refresh();
    if (this.owed && this.owed.id !== id && this.owed.n > BigInt(0)) console.warn('[tokenblaster] owed burn for another coin is pending', this.owed.id);
    this.owed = this.owed && this.owed.id === id ? { id, n: this.owed.n + BigInt(rounds) } : { id, n: BigInt(rounds) };
    this.save();
  }

  /** Burn what is owed in ONE tx (exactly rounds × per to the eater, the rest stays in the gun). Returns the txid. */
  async burnOwed(per: bigint = BigInt(1)): Promise<string | null> {
    return this.exclusive(() => this.burnOwedNow(per));
  }

  private async burnOwedNow(per: bigint = BigInt(1)): Promise<string | null> {
    this.refresh();
    const o = this.owed;
    if (!o || o.n <= BigInt(0)) return null;
    if (!this.coin) {
      await this.startCoin(() => undefined).catch(() => undefined);
      if (!this.coin) throw new Error('No sats in the gun to pay the burn fee.');
    }
    const coins = await this.tokenCoinsAll(o.id);
    const have = coins.reduce((n, c) => n + c.amt, BigInt(0));
    let amt = o.n * per;
    if (have < amt) {
      console.warn(`[tokenblaster] owed ${amt} tokens, gun holds ${have}: burning what is there`);
      amt = have;
    }
    if (amt <= BigInt(0)) {
      this.owed = null;
      this.save();
      return null;
    }
    const b = await buildBulkBurn(this.key, o.id, coins, this.coin, amt, Number(o.n));
    if (this.loadTx && !(await this.known(this.loadTx.id('hex')))) await this.send(this.loadTx).catch(() => undefined);
    await this.send(b.tx);
    this.loadTx = null;
    this.markSpent(b.tx);
    for (const c of coins) this.spentTok.add(`${c.tx.id('hex')}_${c.vout}`);
    const base = Transaction.fromHex(b.tx.toHex());
    this.tok = b.rest > BigInt(0) ? { id: o.id, tx: base, vout: b.restVout, amt: b.rest } : null;
    this.coin = { tx: base, vout: b.changeVout };
    this.owed = null;
    this.save();
    loadMark(`bulk burn: ${amt} tokens for ${o.n} rounds`);
    return base.id('hex');
  }

  /**
   * $TERRORNODE receipts (src/lib/launch/receipts.ts): ONE settlement tx from the gun's sats carrying the session's
   * receipt tag, the receipt money to the creator and the transfer gas to the pool. Returns the txid.
   */
  /**
   * `plan` is told the sats of the ONE coin this settlement spends (inside the lock, so it can't change underneath)
   * and returns the settlement to pay from it, or null when that coin can't afford any (nothing is sent: null).
   */
  async payReceipts(plan: (coinSats: number) => { asm: string; outs: { address: string; sats: number }[] } | null): Promise<string | null> {
    return this.exclusive(async () => {
      this.refresh();
      if (!this.coin) await this.startCoin(() => undefined).catch(() => undefined);
      if (!this.coin) throw new Error('No sats in the gun to pay the receipts.');
      const p = plan(this.sats);
      if (!p) return null;
      const { asm, outs } = p;
      if (outs.reduce((n, o) => n + o.sats, 0) >= this.sats) throw new Error('The gun coin cannot cover this settlement.');
      const tx = new Transaction();
      tx.addInput({ sourceTransaction: this.coin.tx, sourceOutputIndex: this.coin.vout, unlockingScriptTemplate: new P2PKH().unlock(this.key) });
      tx.addOutput({ lockingScript: Script.fromASM(asm), satoshis: 0 });
      for (const o of outs) tx.addOutput({ lockingScript: new P2PKH().lock(o.address), satoshis: o.sats });
      tx.addOutput({ lockingScript: new P2PKH().lock(this.address), change: true });
      await tx.fee(new SatoshisPerKilobyte(FEE_RATE));
      await tx.sign();
      await this.send(tx);
      const base = Transaction.fromHex(tx.toHex());
      this.coin = { tx: base, vout: base.outputs.length - 1 };
      this.save();
      loadMark(`receipts settled: ${base.id('hex')}`);
      return base.id('hex');
    });
  }

  /** Every token coin of `id` the gun knows: the one it fires from plus the index's. */
  private async tokenCoinsAll(id: string): Promise<TokCoin[]> {
    const coins: TokCoin[] = [];
    if (this.tok?.id === id && this.tok.amt > BigInt(0)) coins.push(this.tok);
    for (const u of await this.tokenUtxos(id)) {
      if (coins.some((c) => c.tx.id('hex') === u.txid && c.vout === u.vout)) continue;
      const hexTx = await txHex(u.txid);
      coins.push({ id, tx: Transaction.fromHex(hexTx), vout: u.vout, amt: u.amt });
    }
    return coins;
  }

  // Per-shot token burns in lanes: kept behind PER_SHOT_BURN (src/lib/launch/ammoCoins.ts, default off).
  // ── Coin ammo storm (multi-lane token burns, 25 Oct 2026) ─────────

  /** Lanes made by prepareCoinStorm(): the fan-out tx, its lanes (token coin + fee coin each) and the token. */
  private coinReady: { base: Transaction; id: string; per: bigint; lanes: { tok: number; fee: number; amt: bigint; count: number }[] } | null = null;

  /**
   * Fan the gun's token coin and sats out into `lanesN` lanes in ONE tx signed by the gun (no wallet approval):
   * outputs [token lane 0..K-1 (1 sat each), fee lane 0..K-1, token rest?, change]. Each lane gets `rounds/K`
   * burns of `per` tokens and the sats to pay them. Waits only for ARC to take it.
   */
  async prepareCoinStorm(id: string, per: bigint, rounds: number, lanesN: number, perBurn: number): Promise<{ lanes: number; rounds: number }> {
    await this.endSession();
    return this.exclusive(async () => {
      this.refresh();
      this.coinReady = null;
      this.halt = false;
      const tok = await this.tokenCoin(id);
      if (!tok) throw new Error('No tokens in the gun. Load some first.');
      await this.startCoin(() => undefined);
      if (!this.coin) throw new Error('EMPTY');
      const maxRounds = Number(tok.amt / per);
      rounds = Math.min(rounds, maxRounds);
      const k = Math.max(1, Math.min(lanesN, rounds));
      if (rounds <= 0) throw new Error('No tokens in the gun. Load some first.');
      const counts = Array.from({ length: k }, (_, i) => Math.floor(rounds / k) + (i < rounds % k ? 1 : 0));
      const budget = this.sats - 300 - k * 60;
      const each = counts.map((c) => c * perBurn + 50);
      if (budget < each.reduce((a, b) => a + b, 0)) throw new Error('SHORT');
      const split = new Transaction();
      split.addInput({ sourceTransaction: Transaction.fromBinary(tok.tx.toBinary()), sourceOutputIndex: tok.vout, unlockingScriptTemplate: new P2PKH().unlock(this.key) });
      split.addInput({ sourceTransaction: Transaction.fromBinary(this.coin.tx.toBinary()), sourceOutputIndex: this.coin.vout, unlockingScriptTemplate: new P2PKH().unlock(this.key) });
      const amts = counts.map((c) => BigInt(c) * per);
      for (const a of amts) split.addOutput({ lockingScript: bsv21(id, a, this.address), satoshis: 1 });
      for (const e of each) split.addOutput({ lockingScript: new P2PKH().lock(this.address), satoshis: e });
      const restTok = tok.amt - amts.reduce((a, b) => a + b, BigInt(0));
      if (restTok > BigInt(0)) split.addOutput({ lockingScript: bsv21(id, restTok, this.address), satoshis: 1 });
      split.addOutput({ lockingScript: new P2PKH().lock(this.address), change: true });
      await split.fee(new SatoshisPerKilobyte(FEE_RATE));
      await split.sign();
      if (this.loadTx && !(await this.known(this.loadTx.id('hex')))) await this.send(this.loadTx).catch(() => undefined);
      await this.send(split);
      this.loadTx = null;
      const base = Transaction.fromHex(split.toHex());
      this.spentTok.add(`${tok.tx.id('hex')}_${tok.vout}`);
      this.markSpent(split);
      this.tok = restTok > BigInt(0) ? { id, tx: base, vout: 2 * k, amt: restTok } : null;
      this.coin = { tx: base, vout: split.outputs.length - 1 };
      this.save();
      this.coinReady = { base, id, per, lanes: counts.map((count, i) => ({ tok: i, fee: k + i, amt: amts[i], count })) };
      loadMark(`coin lanes ready: ${k} lanes, ${rounds} burns`);
      return { lanes: k, rounds };
    });
  }

  /**
   * Burn the prepared lanes in the storm workers (src/lib/stormCore.ts burn mode): same pipelined rounds, ARC
   * status / seen counting, and double-spend rules as the sats storm. Returns the accepted burns.
   */
  async coinStorm(
    onProgress: (sent: number, last?: string, net?: StormNet) => void,
    stop: () => boolean,
    paused: () => boolean,
    tag: { game?: string; extra?: string[] } = {},
    step = STREAM_STEP,
    onStatus: (s: string) => void = () => undefined,
  ): Promise<number> {
    const r = this.coinReady;
    if (!r) throw new Error('The gun is not loaded.');
    this.coinReady = null;
    const userStop = stop;
    stop = () => this.halt || userStop();
    const run = this.exclusive(async () => {
      let n = 1;
      const lanes = r.lanes.map((l) => {
        const lane = { vout: l.fee, count: l.count, n, tok: { vout: l.tok, amt: l.amt.toString() } };
        n += l.count;
        return lane;
      });
      const cores = Math.max(1, Math.min(lanes.length, (navigator.hardwareConcurrency || 4) - 1, 12));
      const { sent, lastWhy, net } = await runStorm({
        workerUrl: '/storm-worker.js',
        baseHex: r.base.toHex(),
        lanes,
        wif: this.key.toWif(),
        token: r.id,
        step,
        game: tag.game,
        extra: tag.extra,
        cores,
        stop,
        paused,
        burn: { id: r.id, per: r.per.toString(), toLockHex: new P2PKH().lock(BURN_ADDRESS).toHex() },
        onSent: onProgress,
        onWhy: () => onStatus('STALL'),
        onBatch: batchLogger(),
      });
      loadMark(`coin ARC statuses: ${JSON.stringify(net.statuses)} (seen on network: ${net.seen}/${sent}, orphans ${net.orphans})`);
      // Lane coins are spent by the workers: never reuse them. What is left on each lane is found again by the index.
      if (sent)
        for (const l of r.lanes) {
          this.spent.add(`${r.base.id('hex')}_${l.fee}`);
          this.spentTok.add(`${r.base.id('hex')}_${l.tok}`);
        }
      await new Promise((ok) => setTimeout(ok, 6000));
      try {
        const coins = await this.candidates();
        if (coins.length > 1) await this.consolidate(coins);
        else this.coin = coins[0] ?? null;
      } catch {
        /* the next load rebuilds the coin set anyway */
      }
      this.save();
      if (!sent) throw new Error(`ARC took no burns: ${lastWhy ?? 'no reason given'}`);
      return sent;
    });
    this.session = run;
    try {
      return await run;
    } finally {
      if (this.session === run) this.session = null;
      this.halt = false;
    }
  }

  // ── Token ammo ────────────────────────────────────────────────────

  /** Unspent token outputs of `id` at the gun's address (GorillaPool), largest first. */
  private async tokenUtxos(id: string) {
    const r = await fetch(`${GP}/bsv20/${this.address}/id/${id}`);
    if (!r.ok) return [];
    const list = (await r.json()) as { txid: string; vout: number; amt: string; spend: string }[];
    return list
      .filter((u) => !u.spend && !this.spentTok.has(`${u.txid}_${u.vout}`))
      .map((u) => ({ txid: u.txid, vout: u.vout, amt: BigInt(u.amt) }))
      .sort((a, b) => (b.amt > a.amt ? 1 : b.amt < a.amt ? -1 : 0));
  }

  /** Tokens of `id` loaded in the gun (base units). */
  /** Use a token coin we just received (from loadTokens) straight away, before the index sees it. */
  adoptTokenCoin(id: string, tx: Transaction, vout: number, amt: bigint) {
    // The wallet broadcasts the load itself; keep the full tx (with its parents) so we can make sure
    // ARC has it before our first bullet spends it.
    this.loadTx = tx;
    // Fire from the bigger coin; the other one is still found through the index later.
    if (this.tok?.id === id && this.tok.amt >= amt) return;
    this.tok = { id, tx: Transaction.fromHex(tx.toHex()), vout, amt };
    this.save();
  }
  private loadTx: Transaction | null = null;

  async tokenAmmo(id: string): Promise<bigint> {
    this.refresh();
    const utxos = await this.tokenUtxos(id);
    const indexed = utxos.reduce((n, u) => n + u.amt, BigInt(0));
    // While a chain we fired is still unindexed, trust what we know.
    return this.tok?.id === id ? this.tok.amt + utxos.filter((u) => u.txid !== this.tok!.tx.id('hex')).reduce((n, u) => n + u.amt, BigInt(0)) : indexed;
  }

  private async tokenCoin(id: string): Promise<TokCoin | null> {
    if (this.tok?.id === id && this.tok.amt > BigInt(0)) return this.tok;
    const [u] = await this.tokenUtxos(id);
    if (!u) return null;
    const hexTx = await txHex(u.txid);
    this.tok = { id, tx: Transaction.fromHex(hexTx), vout: u.vout, amt: u.amt };
    return this.tok;
  }

  /**
   * Fire token bullets: each is a real BSV-21 transfer sending `per` (base units) to `to` (the burn
   * address in solo play, the target's address in multiplayer), carrying the TokenBlaster tag, with
   * the rest of the tokens staying in the gun. Fees come from the gun's sats. Built as a chain and
   * sent to ARC in one batch. Returns the accepted txids.
   */
  async fireTokens(id: string, per: bigint, startN: number, extras: string[][], to = BURN_ADDRESS): Promise<string[]> {
    return this.exclusive(async () => {
      this.refresh();
      type Link = { tx: Transaction; tok: TokCoin | null; sats: { tx: Transaction; vout: number } };
      let chain: Link[] = [];
      let start: TokCoin | null = null;
      let accepted = 0;
      let why: string | undefined;
      for (let attempt = 0; attempt < 3; attempt++) {
        if (!this.coin) throw new Error('No sats in the gun for fees. Load some first.');
        start = await this.tokenCoin(id);
        if (!start || start.amt < per) throw new Error('No tokens in the gun. Load some first.');
        chain = await buildTokenBurns(this.key, id, per, startN, extras, start, this.coin, to);
        if (!chain.length) throw new Error('Out of sats for fees.');
        // The first bullet after a load spends the wallet's load tx: make sure ARC has it.
        if (this.loadTx && !(await this.known(this.loadTx.id('hex')))) await this.send(this.loadTx).catch(() => undefined);
        ({ accepted, why } = await this.broadcastChain(chain.map((c) => c.tx)));
        if (accepted) break;
        console.warn('[tokenblaster] token shot not accepted, retrying', chain[0].tx.id('hex'), why);
        await new Promise((ok) => setTimeout(ok, 800 * (attempt + 1)));
        // Only drop our token coin if it was really spent elsewhere; otherwise keep it (the index lags).
        if (/DOUBLE_SPEND|competing|spent|missing/i.test(why ?? '')) {
          this.tok = null;
          await this.resync().catch(() => undefined);
        }
      }
      if (!accepted || !start) throw new Error(`ARC rejected the token shots: ${why ?? 'no response'}`);
      this.loadTx = null;
      this.spentTok.add(`${start.tx.id('hex')}_${start.vout}`);
      for (const c of chain.slice(0, accepted - 1)) if (c.tok) this.spentTok.add(`${c.tx.id('hex')}_1`);
      const last = chain[accepted - 1];
      this.coin = { tx: Transaction.fromHex(last.sats.tx.toHex()), vout: last.sats.vout };
      this.tok = last.tok ? { ...last.tok, tx: Transaction.fromHex(last.tok.tx.toHex()) } : null;
      this.save();
      return chain.slice(0, accepted).map((c) => c.tx.id('hex'));
    });
  }

  private async fireOnce(token: string, n: number, extra: string[]): Promise<string> {
    if (!this.coin) throw new Error('The gun is empty. Load it first.');
    const tx = new Transaction();
    tx.addInput({ sourceTransaction: this.coin.tx, sourceOutputIndex: this.coin.vout, unlockingScriptTemplate: new P2PKH().unlock(this.key) });
    tx.addOutput({ lockingScript: Script.fromASM(`OP_FALSE OP_RETURN ${[TAG, ammoPush(token), String(n), ...extra].map(hex).join(' ')}`), satoshis: 0 });
    tx.addOutput({ lockingScript: new P2PKH().lock(this.address), change: true });
    await tx.fee(new SatoshisPerKilobyte(FEE_RATE));
    await tx.sign();
    if ((tx.outputs[1].satoshis ?? 0) < 1) throw new Error('Out of ammo.');
    await this.send(tx);
    // The next blast only needs this tx's outputs, so drop its ancestry.
    this.coin = { tx: Transaction.fromHex(tx.toHex()), vout: 1 };
    this.save();
    return tx.id('hex');
  }

  /**
   * Send everything at the gun's address back to `address`: the tracked coin plus anything else
   * that landed there (e.g. a second funding when two wallets both answered one Load).
   */
  /** Token ids the gun holds, with amounts (from the index, plus the coin it's firing from). */
  async tokensHeld(): Promise<{ id: string; amt: bigint }[]> {
    const r = await fetch(`${GP}/bsv20/${this.address}/balance`).catch(() => null);
    const list = r && r.ok ? ((await r.json()) as { id?: string; all?: { confirmed: string; pending: string } }[]) : [];
    const out = new Map<string, bigint>();
    for (const t of list) if (t.id && t.all) out.set(t.id, BigInt(t.all.confirmed) + BigInt(t.all.pending));
    this.refresh();
    if (this.tok && this.tok.amt > (out.get(this.tok.id) ?? BigInt(0))) out.set(this.tok.id, this.tok.amt);
    return [...out].filter(([, a]) => a > BigInt(0)).map(([id, amt]) => ({ id, amt }));
  }

  /**
   * Send every token of `id` in the gun to `to` (one transfer, fees from the gun's sats). Returns the
   * transaction with its source transactions attached, ready to hand to the wallet.
   */
  async unloadTokens(id: string, to: string): Promise<{ tx: Transaction; amt: bigint }> {
    return this.exclusive(async () => {
      // Coin ammo: rounds already fired are burned first, so UNLOAD only returns what was not shot.
      if (this.owedBurn()?.id === id) await this.burnOwedNow();
      this.refresh();
      const coins: TokCoin[] = [];
      if (this.tok?.id === id && this.tok.amt > BigInt(0)) coins.push(this.tok);
      for (const u of await this.tokenUtxos(id)) {
        if (coins.some((c) => c.tx.id('hex') === u.txid && c.vout === u.vout)) continue;
        const hexTx = await txHex(u.txid);
        coins.push({ id, tx: Transaction.fromHex(hexTx), vout: u.vout, amt: u.amt });
      }
      const amt = coins.reduce((n, c) => n + c.amt, BigInt(0));
      if (!amt) throw new Error('No tokens of that kind in the gun.');
      // Too few sats for the fee: say exactly how many to load, never strand the tokens silently.
      if (!this.coin) throw new GunNeedsSats(satsToRescue(coins.length, 0), id);
      const tx = new Transaction();
      for (const c of coins) tx.addInput({ sourceTransaction: c.tx, sourceOutputIndex: c.vout, unlockingScriptTemplate: new P2PKH().unlock(this.key) });
      tx.addInput({ sourceTransaction: this.coin.tx, sourceOutputIndex: this.coin.vout, unlockingScriptTemplate: new P2PKH().unlock(this.key) });
      tx.addOutput({ lockingScript: bsv21(id, amt, to), satoshis: 1 });
      tx.addOutput({ lockingScript: new P2PKH().lock(this.address), change: true });
      await tx.fee(new SatoshisPerKilobyte(FEE_RATE));
      const change = tx.outputs[1].satoshis ?? 0;
      if (change < 1) throw new GunNeedsSats(Math.max(satsToRescue(coins.length, this.sats), 1 - change), id);
      await tx.sign();
      await this.send(tx);
      for (const c of coins) this.spentTok.add(`${c.tx.id('hex')}_${c.vout}`);
      this.tok = null;
      this.coin = { tx: Transaction.fromHex(tx.toHex()), vout: 1 };
      this.save();
      return { tx, amt };
    });
  }

  async unload(address: string): Promise<string | null> {
    return this.exclusive(() => this.unloadNow(address));
  }

  private async unloadNow(address: string): Promise<string | null> {
    const coins = await this.coinsOnChain();
    if (this.coin && !coins.some((c) => c.tx.id('hex') === this.coin!.tx.id('hex') && c.vout === this.coin!.vout)) coins.push(this.coin);
    // Every coin worth more than its fee, largest first (src/lib/sweep.ts): thousands of 6-sat lane ends are left.
    const built = await buildSweep(this.key, coins, address);
    if (!built) return null;
    const { tx } = built;
    await this.send(tx);
    this.coin = null;
    this.save();
    return tx.id('hex');
  }

  /** The last chain read, shared for a few seconds: gather, the balance and the split all ask within one LOCK & LOAD. */
  private chainRead: { at: number; p: Promise<{ tx: Transaction; vout: number }[]> } | null = null;
  /** Unspent outputs at the gun's address, confirmed or not, via our server (WhatsOnChain server-side). */
  private coinsOnChain(): Promise<{ tx: Transaction; vout: number }[]> {
    const c = this.chainRead;
    if (c && Date.now() - c.at < 4000) return c.p;
    const p = this.readCoins();
    this.chainRead = { at: Date.now(), p };
    p.catch(() => {
      if (this.chainRead?.p === p) this.chainRead = null;
    });
    return p;
  }
  /** Amounts only (txid, vout, sats) for the CREDIT: reuses a fresh full read, else asks /api/coins?amounts=1. */
  private amountRead: { at: number; p: Promise<{ txid: string; vout: number; sats: number }[]> } | null = null;
  private amountsOnChain(caller = 'unknown'): Promise<{ txid: string; vout: number; sats: number }[]> {
    const full = this.chainRead;
    if (full && Date.now() - full.at < 4000) return full.p.then((l) => l.map((c) => ({ txid: c.tx.id('hex'), vout: c.vout, sats: c.tx.outputs[c.vout]?.satoshis ?? 0 })));
    const a = this.amountRead;
    if (a && Date.now() - a.at < 4000) return a.p;
    const p = (async () => {
      for (let i = 0; i < 2; i++) {
        const t0 = Date.now();
        const r = await fetch(`/api/coins?address=${this.address}&amounts=1`, { cache: 'no-store', signal: AbortSignal.timeout(15_000) }).catch(() => null);
        if (r?.ok && r.headers.get('x-coins-upstream') !== 'failed') {
          const list = (await r.json()) as { txid: string; vout: number; sats: number }[];
          loadMark(`chain amounts for ${caller}: ${list.length} coin(s) in ${Date.now() - t0} ms`);
          return list;
        }
        await new Promise((ok) => setTimeout(ok, 800));
      }
      throw new Error("Couldn't read the gun's coins from the network right now. Try again in a moment.");
    })();
    this.amountRead = { at: Date.now(), p };
    p.catch(() => {
      if (this.amountRead?.p === p) this.amountRead = null;
    });
    return p;
  }
  private async readCoins(): Promise<{ tx: Transaction; vout: number }[]> {
    // Our server asks WOC (it sees mempool spends at once and doesn't rate-limit servers like it does browsers).
    // Never fall back to GorillaPool's lagging index (stale coins mean double spends), and never to the browser
    // calling WOC (CORS). Txids this browser already holds are sent as `have`, so the server skips their hex.
    const have = [...HEX_MEM.keys()].slice(-100).join(',');
    for (let i = 0; i < 2; i++) {
      const t0 = Date.now();
      const r = await fetch(`/api/coins?address=${this.address}&min=${READ_MIN_SATS}${have ? `&have=${have}` : ''}`, { cache: 'no-store', signal: AbortSignal.timeout(40_000) }).catch(() => null); // a stormed gun is ~17 WOC pages (~15 s): 20 s timed out and retried
      if (r?.ok && r.headers.get('x-coins-upstream') !== 'failed') {
        const list = (await r.json()) as { txid: string; vout: number; hex?: string }[];
        const cache = new Map<string, Transaction>();
        const out: { tx: Transaction; vout: number }[] = [];
        // Parents the server skipped (`have`) or could not fetch: read them in parallel, not one by one.
        const missing = [...new Set(list.filter((c) => !c.hex).map((c) => c.txid))];
        const got = new Map(await Promise.all(missing.map(async (t) => [t, await txHex(t)] as const)));
        for (const c of list) {
          const hex = c.hex || got.get(c.txid)!;
          if (c.hex) rememberTxHex(c.txid, c.hex);
          const tx = cache.get(c.txid) ?? Transaction.fromHex(hex);
          cache.set(c.txid, tx);
          out.push({ tx, vout: c.vout });
        }
        loadMark(`chain read: ${out.length} coin(s) in ${Date.now() - t0} ms`);
        return out;
      }
      await new Promise((ok) => setTimeout(ok, 800));
    }
    throw new Error("Couldn't read the gun's coins from the network right now. Try again in a moment.");
  }

  private async coinsGp(): Promise<{ tx: Transaction; vout: number }[]> {
    const r = await fetch(`https://ordinals.gorillapool.io/api/txos/address/${this.address}/unspent?limit=300`);
    if (!r.ok) throw new Error(`Couldn't read the gun's coins (GorillaPool ${r.status}).`);
    const list = (await r.json()) as { txid: string; vout: number; satoshis: number; origin: unknown; spend: string }[];
    const out: { tx: Transaction; vout: number }[] = [];
    const cache = new Map<string, Transaction>();
    for (const u of list.filter((u) => u.satoshis > 1 && !u.origin && !u.spend)) {
      let tx = cache.get(u.txid);
      if (!tx) {
        const raw = await fetch(`https://ordinals.gorillapool.io/api/tx/${u.txid}/raw`).then((x) => x.arrayBuffer());
        tx = Transaction.fromBinary([...new Uint8Array(raw)]);
        cache.set(u.txid, tx);
      }
      out.push({ tx, vout: u.vout });
    }
    return out;
  }

}
