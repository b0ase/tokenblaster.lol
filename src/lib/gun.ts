/**
 * The gun: a throwaway key kept in this browser (localStorage, so closing the tab or a reload
 * mid-burst does not strand the coins; Unload sweeps whatever is at its address). Loading funds it from bWallet in one approval; firing
 * chains tagged blasts off it and broadcasts each to GorillaPool ARC; unloading sends what is
 * left back to the player. Same transaction shape as blaster/blast.ts.
 */
import { spendableCoins } from './coinop/ammo';
import { STREAM_STEP, lanesFor } from './gallery';
import { runStorm } from './stormRun';
import { ARC, P2PKH, PrivateKey, SatoshisPerKilobyte, Script, Transaction, Utils } from '@bsv/sdk';

const ARC_URL = 'https://arc.gorillapool.io';
const WOC = 'https://api.whatsonchain.com/v1/bsv/main';
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

type TokCoin = { id: string; tx: Transaction; vout: number; amt: bigint };

type Saved = {
  wif: string;
  tx?: string;
  vout?: number;
  tok?: { id: string; tx: string; vout: number; amt: string };
  /** Paid coins from the wallet's own responses, not yet consolidated into `tx` (never lost if a load stalls). */
  extra?: { tx: string; vout: number }[];
  /** Outpoints our own transactions spent (the index can lag): never reused. Most recent last, capped. */
  spent?: string[];
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
export function loadMark(stage: string) {
  const t = typeof performance !== 'undefined' ? performance.now() : Date.now();
  if (stage === 'approve start' || !loadT0) loadT0 = loadLast = t;
  console.info(`[tb-load] ${stage}: +${Math.round(t - loadLast)} ms (total ${Math.round(t - loadT0)} ms)`);
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
  private halt = false;

  constructor() {
    const s = typeof window !== 'undefined' ? read() : null;
    if (!s && typeof window !== 'undefined' && hasRaw()) this.readOnly = true;
    this.key = s ? PrivateKey.fromWif(s.wif) : PrivateKey.fromRandom();
    if (s?.tx) this.coin = { tx: Transaction.fromHex(s.tx), vout: s.vout ?? 0 };
    if (s?.tok) this.tok = { id: s.tok.id, tx: Transaction.fromHex(s.tok.tx), vout: s.tok.vout, amt: BigInt(s.tok.amt) };
    this.loadSets(s);
    this.save();
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
  }

  /** One tab fires at a time (Web Locks); falls back to running directly where unsupported. */
  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
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

  /** Spendable sats at the gun right now (what the CREDIT shows). */
  async balance(): Promise<number> {
    const coins = await this.candidates();
    return coins.reduce((n, c) => n + (c.tx.outputs[c.vout].satoshis ?? 0), 0);
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

  /** End the running storm session (if any): stop its sender, wait for it to merge and save the change. */
  async endSession(timeoutMs = 20_000) {
    const s = this.session;
    if (!s) return;
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
  async fireBatch(token: string, startN: number, extras: string[][], pay?: { address: string; sats: number }): Promise<string[]> {
    return this.exclusive(async () => {
      this.refresh();
      let chain: Transaction[] = [];
      let accepted = 0;
      let why: string | undefined;
      for (let attempt = 0; attempt < 3; attempt++) {
        if (!this.coin) throw new Error('The gun is empty. Load it first.');
        chain = [];
        let prev = this.coin;
        for (let i = 0; i < extras.length; i++) {
          const tx = new Transaction();
          tx.addInput({ sourceTransaction: prev.tx, sourceOutputIndex: prev.vout, unlockingScriptTemplate: new P2PKH().unlock(this.key) });
          tx.addOutput({ lockingScript: Script.fromASM(`OP_FALSE OP_RETURN ${[TAG, token || 'sats', String(startN + i), ...extras[i]].map(hex).join(' ')}`), satoshis: 0 });
          if (pay) tx.addOutput({ lockingScript: new P2PKH().lock(pay.address), satoshis: pay.sats });
          tx.addOutput({ lockingScript: new P2PKH().lock(this.address), change: true });
          await tx.fee(new SatoshisPerKilobyte(FEE_RATE));
          await tx.sign();
          const changeVout = tx.outputs.length - 1;
          if ((tx.outputs[changeVout].satoshis ?? 0) < 1) break; // out of ammo: send what we have
          chain.push(tx);
          prev = { tx, vout: changeVout };
        }
        if (!chain.length) throw new Error('Out of ammo.');
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

  /** Lanes split ahead of time by prepareStorm(), so the first trigger pull fires at once. */
  private ready: { base: Transaction; lanesN: number; perLane: number } | null = null;

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
   * Do all the slow work before the game starts (LOCK & LOAD): find the coin, split it into lanes and wait
   * until the network has the split. `onStep(pct, slowSecs)`: progress 0..100; slowSecs > 0 while waiting.
   * After this, storm() fires on the first trigger pull.
   */
  async prepareStorm(total: number, perBlast: number, onStep: (pct: number, slowSecs: number) => void = () => undefined): Promise<void> {
    await this.endSession();
    return this.exclusive(async () => {
      this.refresh();
      this.ready = null;
      this.halt = false;
      loadMark(`prepare: ${total} rounds`);
      onStep(10, 0);
      await this.startCoin((secs) => onStep(15, secs));
      if (!this.coin) throw new Error('EMPTY');
      onStep(30, 0);
      const lanesN = lanesFor(total);
      const perLane = Math.ceil(total / lanesN);
      const budget = this.sats - 300 - lanesN * 40;
      if (budget < lanesN * perBlast) throw new Error('SHORT');
      const split = new Transaction();
      split.addInput({ sourceTransaction: this.coin.tx, sourceOutputIndex: this.coin.vout, unlockingScriptTemplate: new P2PKH().unlock(this.key) });
      const each = Math.min(Math.floor(budget / lanesN), perLane * (perBlast + 2) + 100);
      for (let i = 0; i < lanesN; i++) split.addOutput({ lockingScript: new P2PKH().lock(this.address), satoshis: each });
      split.addOutput({ lockingScript: new P2PKH().lock(this.address), change: true });
      await split.fee(new SatoshisPerKilobyte(FEE_RATE));
      await split.sign();
      loadMark('split built');
      onStep(45, 0);
      await this.send(split);
      const base = Transaction.fromHex(split.toHex());
      this.coin = { tx: base, vout: lanesN };
      this.save();
      // ARC took the split: that is enough to chain the first rounds on it (no waiting for an index).
      loadMark('split accepted');
      onStep(95, 0);
      this.ready = { base, lanesN, perLane };
      loadMark('ready');
      onStep(100, 0);
    });
  }

  /**
   * Storm: fire `total` blasts as fast as ARC will take them. The coin is split into up to 100
   * lanes in one transaction (or uses the lanes prepareStorm() made), every lane chains its own blasts,
   * and each round sends a few thousand at once. Lane ends merge back into one coin.
   * `onProgress(sent, lastTxid)` after every request; `stop()` returning true ends it; `paused()` returning
   * true holds fire without ending the session (trigger released), so the next pull fires at once.
   */
  async storm(
    token: string,
    total: number,
    onProgress: (sent: number, last?: string) => void,
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
    stop = () => this.halt || userStop();
    const run = this.exclusive(async () => {
      const r = this.ready;
      if (!r) throw new Error('The gun is not loaded.');
      this.ready = null;
      const { base, lanesN, perLane } = r;
      const lanes = Array.from({ length: lanesN }, (_, i) => ({ vout: i, count: perLane, n: i * perLane + 1 }));
      const cores = Math.max(1, Math.min(lanesN, (navigator.hardwareConcurrency || 4) - 1, 12));
      let failed: string | null = null;
      // Built by `pnpm storm:build` from src/workers/storm.ts (esbuild; Turbopack ships workers as raw TS).
      const { sent, lastWhy } = await runStorm({
        workerUrl: '/storm-worker.js',
        baseHex: base.toHex(),
        lanes,
        wif: this.key.toWif(),
        token,
        step,
        game: tag.game,
        extra: tag.extra,
        cores,
        stop,
        paused,
        onSent: onProgress,
        onWhy: () => onStatus('STALL'),
      });
      if (!sent) failed = `ARC took no blasts: ${lastWhy ?? 'no reason given'}`;
      // Session end: merge every lane end (and the split's change) back into one coin once the last blasts
      // settle, and save it. The split's lanes are spent by the workers: never reuse them.
      await new Promise((r) => setTimeout(r, 6000));
      if (sent) for (let i = 0; i < lanesN; i++) this.spent.add(`${base.id('hex')}_${i}`);
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
    const hexTx = await fetch(`${WOC}/tx/${u.txid}/hex`).then((r) => (r.ok ? r.text() : Promise.reject(new Error('Could not fetch the token transaction.'))));
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
        chain = [];
        let tok: TokCoin = start;
        let sats = this.coin;
        for (let i = 0; i < extras.length && tok.amt >= per; i++) {
          const rest = tok.amt - per;
          const tx = new Transaction();
          tx.addInput({ sourceTransaction: tok.tx, sourceOutputIndex: tok.vout, unlockingScriptTemplate: new P2PKH().unlock(this.key) });
          tx.addInput({ sourceTransaction: sats.tx, sourceOutputIndex: sats.vout, unlockingScriptTemplate: new P2PKH().unlock(this.key) });
          tx.addOutput({ lockingScript: bsv21(id, per, to), satoshis: 1 });
          if (rest > BigInt(0)) tx.addOutput({ lockingScript: bsv21(id, rest, this.address), satoshis: 1 });
          tx.addOutput({ lockingScript: Script.fromASM(`OP_FALSE OP_RETURN ${[TAG, id, String(startN + i), ...extras[i]].map(hex).join(' ')}`), satoshis: 0 });
          tx.addOutput({ lockingScript: new P2PKH().lock(this.address), change: true });
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
    tx.addOutput({ lockingScript: Script.fromASM(`OP_FALSE OP_RETURN ${[TAG, token || 'sats', String(n), ...extra].map(hex).join(' ')}`), satoshis: 0 });
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
      this.refresh();
      if (!this.coin) throw new Error('No sats in the gun to pay the fee.');
      const coins: TokCoin[] = [];
      if (this.tok?.id === id && this.tok.amt > BigInt(0)) coins.push(this.tok);
      for (const u of await this.tokenUtxos(id)) {
        if (coins.some((c) => c.tx.id('hex') === u.txid && c.vout === u.vout)) continue;
        const hexTx = await fetch(`${WOC}/tx/${u.txid}/hex`).then((r) => (r.ok ? r.text() : Promise.reject(new Error('Could not fetch a token transaction.'))));
        coins.push({ id, tx: Transaction.fromHex(hexTx), vout: u.vout, amt: u.amt });
      }
      const amt = coins.reduce((n, c) => n + c.amt, BigInt(0));
      if (!amt) throw new Error('No tokens of that kind in the gun.');
      const tx = new Transaction();
      for (const c of coins) tx.addInput({ sourceTransaction: c.tx, sourceOutputIndex: c.vout, unlockingScriptTemplate: new P2PKH().unlock(this.key) });
      tx.addInput({ sourceTransaction: this.coin.tx, sourceOutputIndex: this.coin.vout, unlockingScriptTemplate: new P2PKH().unlock(this.key) });
      tx.addOutput({ lockingScript: bsv21(id, amt, to), satoshis: 1 });
      tx.addOutput({ lockingScript: new P2PKH().lock(this.address), change: true });
      await tx.fee(new SatoshisPerKilobyte(FEE_RATE));
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
    const total = coins.reduce((n, c) => n + (c.tx.outputs[c.vout].satoshis ?? 0), 0);
    if (total < 50) return null;
    const tx = new Transaction();
    for (const c of coins) tx.addInput({ sourceTransaction: c.tx, sourceOutputIndex: c.vout, unlockingScriptTemplate: new P2PKH().unlock(this.key) });
    tx.addOutput({ lockingScript: new P2PKH().lock(address), change: true });
    await tx.fee(new SatoshisPerKilobyte(FEE_RATE));
    await tx.sign();
    await this.send(tx);
    this.coin = null;
    this.save();
    return tx.id('hex');
  }

  /** Unspent outputs at the gun's address, confirmed or not (WhatsOnChain). */
  private async coinsOnChain(): Promise<{ tx: Transaction; vout: number }[]> {
    // Our server asks WOC (it sees mempool spends at once and doesn't rate-limit servers like it
    // does browsers). Never fall back to GorillaPool's lagging index: stale coins mean double spends.
    try {
      const r = await fetch(`/api/coins?address=${this.address}`, { cache: 'no-store' });
      if (r.ok) {
        const list = (await r.json()) as { vout: number; hex: string }[];
        const cache = new Map<string, Transaction>();
        return list.map((c) => {
          const tx = cache.get(c.hex) ?? Transaction.fromHex(c.hex);
          cache.set(c.hex, tx);
          return { tx, vout: c.vout };
        });
      }
    } catch {
      /* fall through to asking WOC from the browser */
    }
    return this.coinsWoc();
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

  private async coinsWoc(): Promise<{ tx: Transaction; vout: number }[]> {
    const get = (path: string) =>
      fetch(`${WOC}${path}`).then((r) => {
        if (!r.ok) throw new Error(`WOC ${r.status}`);
        return r.json();
      });
    const [conf, unconf] = await Promise.all([
      get(`/address/${this.address}/confirmed/unspent`),
      get(`/address/${this.address}/unconfirmed/unspent`),
    ]);
    const utxos = [...(conf.result ?? []), ...(unconf.result ?? [])] as { tx_hash: string; tx_pos: number; value: number; isSpentInMempoolTx?: boolean }[];
    const out: { tx: Transaction; vout: number }[] = [];
    // 1-sat outputs hold tokens (BSV-21 inscriptions): spending them as plain sats would destroy the tokens.
    for (const u of utxos.filter((u) => !u.isSpentInMempoolTx && u.value > 1)) {
      const hex = await fetch(`${WOC}/tx/${u.tx_hash}/hex`).then((r) => {
        if (!r.ok) throw new Error(`WOC ${r.status}`);
        return r.text();
      });
      out.push({ tx: Transaction.fromHex(hex), vout: u.tx_pos });
    }
    return out;
  }
}
