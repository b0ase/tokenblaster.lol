'use client';
/**
 * $TERRORNODE receipts in the Assault cabinet (src/lib/launch/receipts.ts): the live price, the rounds a load buys,
 * the count fired this session, and the settlement at session end (the gun pays, the server sends the tokens).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { RECEIPT_GAS, rangeSats, settlementAsm } from '@/lib/launch/receipts';
import { SETTLE_FEE, shotsForSats, type ReceiptCurve } from '@/lib/coinop/shots';

export type ReceiptQuote = { live: boolean; issued: number; pennySats: number; nextPriceSats: number; creator: string; gasAddress: string | null; gasSats: number; bsvUsd: number };

async function quote(): Promise<ReceiptQuote | null> {
  const r = await fetch('/api/terrornode/receipts', { cache: 'no-store' }).catch(() => null);
  if (!r?.ok) return null;
  const j = (await r.json().catch(() => null)) as ReceiptQuote | null;
  return j && typeof j.issued === 'number' ? j : null;
}

/**
 * Receipts fired but not yet paid for, and a settlement paid but not yet delivered, survive a reload, a closed tab
 * and a session that ended some other way (owner, 25 Oct 2026: 38,800 rounds fired, no $TERRORNODE arrived and
 * nothing said why). Kept in this browser, next to the gun that owes them.
 */
const OWED_KEY = 'tokenblaster.receipts.owed';
const PAID_KEY = 'tokenblaster.receipts.paid';
type Paid = { txid: string; count: number; shownAs: string };
function readJson<T>(k: string): T | null {
  try {
    return JSON.parse(localStorage.getItem(k) ?? 'null') as T | null;
  } catch {
    return null;
  }
}
function writeJson(k: string, v: unknown) {
  try {
    if (v == null) localStorage.removeItem(k);
    else localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* private mode: this tab still settles */
  }
}

/** Ask the server to send the receipts a settlement tx paid for. True once sent; false while it is still working. */
async function deliver(txid: string): Promise<{ ok: true; count?: number } | { ok: false; retry: boolean; why: string }> {
  const r = await fetch('/api/terrornode/receipts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ txid }) }).catch(() => null);
  const j = (await r?.json().catch(() => null)) as { ok?: boolean; count?: number; error?: string } | null;
  if (r?.ok && j?.ok) return { ok: true, count: j.count };
  const retry = !r || [404, 409, 500, 502, 503].includes(r.status);
  return { ok: false, retry, why: j?.error ?? (r ? `Receipts refused (${r.status}).` : 'Could not reach TokenBlaster.') };
}

export function useReceipts(on: boolean) {
  const [q, setQ] = useState<ReceiptQuote | null>(null);
  const [earned, setEarned] = useState(0); // receipts fired this session (paid at settlement)
  const [note, setNote] = useState<string | null>(null);
  const owed = useRef(0);
  const [owedN, setOwedN] = useState(0);
  const settling = useRef(false);
  const setOwed = useCallback((n: number) => {
    owed.current = Math.max(0, n);
    setOwedN(owed.current);
    writeJson(OWED_KEY, owed.current ? { count: owed.current } : null);
  }, []);
  // Pick up what an earlier page load owed, and finish delivering a settlement that was paid but not sent.
  useEffect(() => {
    if (!on) return;
    const o = readJson<{ count?: number }>(OWED_KEY);
    if (o?.count && o.count > owed.current) setOwed(o.count);
    const paid = readJson<Paid>(PAID_KEY);
    if (!paid?.txid) return;
    let dead = false;
    void (async () => {
      for (let i = 0; i < 6 && !dead; i++) {
        const r = await deliver(paid.txid);
        if (r.ok) {
          writeJson(PAID_KEY, null);
          if (!dead) setNote(`${(r.count ?? paid.count).toLocaleString('en-US')} $TERRORNODE sent to ${paid.shownAs}`);
          return;
        }
        if (!r.retry) {
          if (!dead) setNote(`Receipts tx ${paid.txid.slice(0, 10)}… was not accepted: ${r.why}`);
          return;
        }
        await new Promise((ok) => setTimeout(ok, 4000 * (i + 1)));
      }
    })();
    return () => {
      dead = true;
    };
  }, [on, setOwed]);
  useEffect(() => {
    if (!on) return;
    let dead = false;
    const tick = () => void quote().then((x) => !dead && setQ(x));
    tick();
    const t = setInterval(tick, 30_000);
    return () => {
      dead = true;
      clearInterval(t);
    };
  }, [on]);
  const live = on && !!q?.live && !!q.gasAddress;

  /** Where the receipt curve is now (null: receipts off). Every "buys N shots" uses it via src/lib/coinop/shots.ts. */
  const curve: ReceiptCurve = live && q ? { issued: q.issued, pennySats: q.pennySats } : null;
  /** Shots `sats` buys: each = `feeSats` + its receipt, with the load overhead and the settlement's gas and fee held back. */
  const shots = useCallback((sats: number, feeSats: number) => (live && q ? shotsForSats(sats, feeSats, { issued: q.issued, pennySats: q.pennySats }) : null), [live, q]);
  const rangeCost = useCallback((n: number) => (live && q && n > 0 ? Number(rangeSats(q.issued + 1, n, q.pennySats)) + RECEIPT_GAS + SETTLE_FEE : 0), [live, q]);

  const fired = useCallback(
    (n: number) => {
      if (!live || n <= 0) return;
      setOwed(owed.current + n);
      setEarned((e) => e + n);
    },
    [live, setOwed],
  );

  /** Session end: one settlement tx from the gun, then ask the server to send the tokens. */
  const settle = useCallback(
    async (a: { pay: (asm: string, outs: { address: string; sats: number }[]) => Promise<string>; recipient: string | null; session: string; handle: string; shownAs: string }) => {
      const count = owed.current;
      if (!count || settling.current) return;
      if (!a.recipient) {
        // Never drop them silently (the old code returned when no wallet was attached): they wait for a wallet.
        setNote(`${count.toLocaleString('en-US')} $TERRORNODE receipts are waiting: connect your wallet to receive them.`);
        return;
      }
      settling.current = true;
      try {
        const fresh = (await quote()) ?? q;
        if (!fresh?.live || !fresh.gasAddress) throw new Error('Receipts are offline: your rounds are kept and settle next time.');
        const total = Number(rangeSats(fresh.issued + 1, count, fresh.pennySats));
        setNote(`Paying for ${count.toLocaleString('en-US')} $TERRORNODE receipts from your gun…`);
        const txid = await a.pay(settlementAsm({ count, recipient: a.recipient, session: a.session, handle: a.handle }), [
          { address: fresh.creator, sats: total },
          { address: fresh.gasAddress, sats: RECEIPT_GAS },
        ]);
        writeJson(PAID_KEY, { txid, count, shownAs: a.shownAs } satisfies Paid);
        setOwed(owed.current - count);
        setNote(`Paid ${total.toLocaleString('en-US')} sats for ${count.toLocaleString('en-US')} $TERRORNODE receipts. Sending…`);
        for (let i = 0; i < 8; i++) {
          const r = await deliver(txid);
          if (r.ok) {
            writeJson(PAID_KEY, null);
            setNote(`${(r.count ?? count).toLocaleString('en-US')} $TERRORNODE sent to ${a.shownAs}`);
            setQ(await quote());
            return;
          }
          if (!r.retry) throw new Error(`${r.why} (receipts tx ${txid})`);
          await new Promise((ok) => setTimeout(ok, 3000 * (i + 1)));
        }
        setNote(`Receipts paid (tx ${txid.slice(0, 10)}…); the tokens are queued and are sent next time you open the game.`);
      } catch (e) {
        console.warn('[tb-receipts] settlement failed', e);
        setNote(`Receipts not settled yet: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        settling.current = false;
      }
    },
    [q, setOwed],
  );

  return { q, live, curve, earned, owed: owedN, note, shots, rangeCost, fired, settle, resetSession: () => setEarned(0) };
}
