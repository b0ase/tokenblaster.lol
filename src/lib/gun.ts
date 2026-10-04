/**
 * The gun: a throwaway key kept in this browser (localStorage, so closing the tab or a reload
 * mid-burst does not strand the coins; Unload sweeps whatever is at its address). Loading funds it from bWallet in one approval; firing
 * chains tagged blasts off it and broadcasts each to GorillaPool ARC; unloading sends what is
 * left back to the player. Same transaction shape as blaster/blast.ts.
 */
import { ARC, P2PKH, PrivateKey, SatoshisPerKilobyte, Script, Transaction, Utils } from '@bsv/sdk';

const ARC_URL = 'https://arc.gorillapool.io';
const WOC = 'https://api.whatsonchain.com/v1/bsv/main';
const FEE_RATE = 100; // sats/kB, matches SATS_PER_BLAST in pricing.ts
const STORE = 'tokenblaster.gun';
export const TAG = 'tokenblaster.lol';
/** Well-known unspendable address: tokens sent here are burned for good. */
export const BURN_ADDRESS = '1BitcoinEaterAddressDontSendf59kuE';
/** Sats per token bullet: ~823-byte transfer (83 sats at 100 sat/kB) plus two 1-sat outputs. */
export const TOKEN_FEE = 90;
const GP = 'https://ordinals.gorillapool.io/api';

const hex = (s: string) => Utils.toHex(Utils.toArray(s, 'utf8'));

/** A BSV-21 transfer inscription of `amt` (base units) of token `id`, locked to `address`. */
export const bsv21 = (id: string, amt: bigint, address: string) =>
  Script.fromASM(
    `OP_0 OP_IF ${hex('ord')} OP_1 ${hex('application/bsv-20')} OP_0 ${hex(JSON.stringify({ p: 'bsv-20', op: 'transfer', id, amt: amt.toString() }))} OP_ENDIF ${new P2PKH().lock(address).toASM()}`,
  );

type TokCoin = { id: string; tx: Transaction; vout: number; amt: bigint };

type Saved = { wif: string; tx?: string; vout?: number; tok?: { id: string; tx: string; vout: number; amt: string } };

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

export class Gun {
  private key: PrivateKey;
  private coin: { tx: Transaction; vout: number } | null = null;
  private tok: TokCoin | null = null; // the token UTXO the gun is firing from
  private spentTok = new Set<string>(); // token outpoints we have spent (the indexer may lag)
  private arc = new ARC(ARC_URL);

  constructor() {
    const s = typeof window !== 'undefined' ? read() : null;
    this.key = s ? PrivateKey.fromWif(s.wif) : PrivateKey.fromRandom();
    if (s?.tx) this.coin = { tx: Transaction.fromHex(s.tx), vout: s.vout ?? 0 };
    if (s?.tok) this.tok = { id: s.tok.id, tx: Transaction.fromHex(s.tok.tx), vout: s.tok.vout, amt: BigInt(s.tok.amt) };
    this.save();
  }

  /** Another tab may have fired since: take the latest coin from storage. */
  private refresh() {
    const s = read();
    if (s?.wif !== this.key.toWif()) return;
    this.coin = s.tx ? { tx: Transaction.fromHex(s.tx), vout: s.vout ?? 0 } : null;
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
    const coins = await this.coinsOnChain();
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
    write({
      wif: this.key.toWif(),
      tx: this.coin?.tx.toHex(),
      vout: this.coin?.vout,
      tok: this.tok && this.tok.amt > BigInt(0) ? { id: this.tok.id, tx: this.tok.tx.toHex(), vout: this.tok.vout, amt: this.tok.amt.toString() } : undefined,
    });
  }

  /** Everything at the gun's address, including coins the gun is not tracking. */
  async balance(): Promise<number> {
    const coins = await this.coinsOnChain();
    const onChain = coins.reduce((n, c) => n + (c.tx.outputs[c.vout].satoshis ?? 0), 0);
    return Math.max(onChain, this.sats);
  }

  /**
   * Take the funding transaction from the wallet as the gun's coin. Topping up while there is still
   * ammo merges the old coin and the new one into a single coin, so nothing is left behind.
   */
  async load(funding: Transaction) {
    const vout = funding.outputs.findIndex((o) => o.lockingScript.toHex() === new P2PKH().lock(this.address).toHex());
    if (vout < 0) throw new Error('Funding transaction does not pay the gun.');
    const fresh = { tx: Transaction.fromHex(funding.toHex()), vout };
    await this.exclusive(async () => {
      this.refresh();
      if (!this.coin || this.sats < 1) {
        this.coin = fresh;
        this.save();
        return;
      }
      const tx = new Transaction();
      for (const c of [this.coin, fresh]) tx.addInput({ sourceTransaction: c.tx, sourceOutputIndex: c.vout, unlockingScriptTemplate: new P2PKH().unlock(this.key) });
      tx.addOutput({ lockingScript: new P2PKH().lock(this.address), change: true });
      await tx.fee(new SatoshisPerKilobyte(FEE_RATE));
      await tx.sign();
      try {
        await this.send(tx);
        this.coin = { tx: Transaction.fromHex(tx.toHex()), vout: 0 };
      } catch {
        // Merge failed (e.g. the old coin was already spent): fall back to the new coin; Unload sweeps the rest.
        this.coin = fresh;
      }
      this.save();
    });
  }

  private async send(tx: Transaction) {
    const txid = tx.id('hex');
    // The wallet may still be propagating the parent; retry briefly before giving up.
    for (let attempt = 0; ; attempt++) {
      const r = await tx.broadcast(this.arc);
      if (r.status === 'success') return;
      // A retry of a tx ARC already has can come back as an error (e.g. "invalid competing
      // transaction identifiers"). Ask ARC directly before treating it as a failure.
      if (await this.known(txid)) return;
      if (attempt >= 4) throw new Error(`ARC rejected ${txid}: ${'description' in r ? r.description : JSON.stringify(r)}`);
      await new Promise((ok) => setTimeout(ok, 500 * (attempt + 1)));
    }
  }

  /** True when ARC reports the tx as on its way into (or already in) a block. */
  private async known(txid: string): Promise<boolean> {
    try {
      const r = await fetch(`${ARC_URL}/v1/tx/${txid}`);
      if (!r.ok) return false;
      const { txStatus } = (await r.json()) as { txStatus?: string };
      return ['SENT_TO_NETWORK', 'ACCEPTED_BY_NETWORK', 'SEEN_ON_NETWORK', 'MINED', 'IMMUTABLE'].includes(txStatus ?? '');
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
  async fireBatch(token: string, startN: number, extras: string[][]): Promise<string[]> {
    return this.exclusive(async () => {
      this.refresh();
      if (!this.coin) throw new Error('The gun is empty. Load it first.');
      const chain: Transaction[] = [];
      let prev = this.coin;
      for (let i = 0; i < extras.length; i++) {
        const tx = new Transaction();
        tx.addInput({ sourceTransaction: prev.tx, sourceOutputIndex: prev.vout, unlockingScriptTemplate: new P2PKH().unlock(this.key) });
        tx.addOutput({ lockingScript: Script.fromASM(`OP_FALSE OP_RETURN ${[TAG, token || 'sats', String(startN + i), ...extras[i]].map(hex).join(' ')}`), satoshis: 0 });
        tx.addOutput({ lockingScript: new P2PKH().lock(this.address), change: true });
        await tx.fee(new SatoshisPerKilobyte(FEE_RATE));
        await tx.sign();
        if ((tx.outputs[1].satoshis ?? 0) < 1) break; // out of ammo: send what we have
        chain.push(tx);
        prev = { tx, vout: 1 };
      }
      if (!chain.length) throw new Error('Out of ammo.');
      const results = (await Promise.race([
        this.arc.broadcastMany(chain),
        new Promise<never>((_, no) => setTimeout(() => no(new Error('ARC did not answer within 20 s.')), 20_000)),
      ])) as { status?: string; description?: string }[];
      // A chain is only as good as its first failure: everything after it spends a missing coin.
      // @bsv/sdk 2.8.11 marks ARC's `competingTxs: null` as "invalid competing transaction
      // identifiers" even when ARC took the tx, so check ARC directly before calling anything failed.
      // The chain is ordered: if ARC has the last tx it has them all.
      let accepted = 0;
      while (accepted < chain.length && results[accepted]?.status === 'success') accepted++;
      if (accepted < chain.length) {
        if (await this.known(chain[chain.length - 1].id('hex'))) accepted = chain.length;
        else while (accepted < chain.length && (await this.known(chain[accepted].id('hex')))) accepted++;
      }
      if (accepted === 0) {
        await this.resync();
        throw new Error(`ARC rejected the batch: ${results[0]?.description ?? 'no response'}`);
      }
      const last = chain[accepted - 1];
      this.coin = { tx: Transaction.fromHex(last.toHex()), vout: 1 };
      this.save();
      return chain.slice(0, accepted).map((t) => t.id('hex'));
    });
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
      if (!this.coin) throw new Error('No sats in the gun for fees. Load some first.');
      const start = await this.tokenCoin(id);
      if (!start || start.amt < per) throw new Error('No tokens in the gun. Send some to its address first.');
      const chain: { tx: Transaction; tok: TokCoin | null; sats: { tx: Transaction; vout: number } }[] = [];
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
      // First bullet after a load spends the wallet's load tx: make sure ARC has it (rebroadcast if not).
      if (this.loadTx) {
        const parent = this.loadTx;
        if (!(await this.known(parent.id('hex')))) await this.send(parent).catch(() => undefined);
        this.loadTx = null;
      }
      const results = (await Promise.race([
        this.arc.broadcastMany(chain.map((c) => c.tx)),
        new Promise<never>((_, no) => setTimeout(() => no(new Error('ARC did not answer within 20 s.')), 20_000)),
      ])) as { status?: string; description?: string; code?: string | number; more?: unknown }[];
      let accepted = 0;
      while (accepted < chain.length && results[accepted]?.status === 'success') accepted++;
      if (accepted === 0) {
        this.tok = null;
        await this.resync();
        const r = results[0];
        console.warn('[tokenblaster] ARC rejected token shot', chain[0].tx.id('hex'), r);
        throw new Error(`ARC rejected the token shots: ${r?.description ?? 'no response'}${r?.code ? ` (code ${r.code})` : ''} · tx ${chain[0].tx.id('hex').slice(0, 12)}…`);
      }
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
    const get = (path: string) => fetch(`${WOC}${path}`).then((r) => (r.ok ? r.json() : { result: [] }));
    const [conf, unconf] = await Promise.all([
      get(`/address/${this.address}/confirmed/unspent`),
      get(`/address/${this.address}/unconfirmed/unspent`),
    ]);
    const utxos = [...(conf.result ?? []), ...(unconf.result ?? [])] as { tx_hash: string; tx_pos: number; value: number; isSpentInMempoolTx?: boolean }[];
    const out: { tx: Transaction; vout: number }[] = [];
    // 1-sat outputs hold tokens (BSV-21 inscriptions): spending them as plain sats would destroy the tokens.
    for (const u of utxos.filter((u) => !u.isSpentInMempoolTx && u.value > 1)) {
      const hex = await fetch(`${WOC}/tx/${u.tx_hash}/hex`).then((r) => r.text());
      out.push({ tx: Transaction.fromHex(hex), vout: u.tx_pos });
    }
    return out;
  }
}
