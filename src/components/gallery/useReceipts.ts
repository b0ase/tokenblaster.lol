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

export function useReceipts(on: boolean) {
  const [q, setQ] = useState<ReceiptQuote | null>(null);
  const [earned, setEarned] = useState(0); // receipts fired this session (paid at settlement)
  const [note, setNote] = useState<string | null>(null);
  const owed = useRef(0);
  const settling = useRef(false);
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
      owed.current += n;
      setEarned((e) => e + n);
    },
    [live],
  );

  /** Session end: one settlement tx from the gun, then ask the server to send the tokens. */
  const settle = useCallback(
    async (a: { pay: (asm: string, outs: { address: string; sats: number }[]) => Promise<string>; recipient: string; session: string; handle: string; shownAs: string }) => {
      const count = owed.current;
      if (!count || settling.current) return;
      settling.current = true;
      try {
        const fresh = (await quote()) ?? q;
        if (!fresh?.live || !fresh.gasAddress) throw new Error('Receipts are offline: your rounds are kept and settle next time.');
        const total = Number(rangeSats(fresh.issued + 1, count, fresh.pennySats));
        const txid = await a.pay(settlementAsm({ count, recipient: a.recipient, session: a.session, handle: a.handle }), [
          { address: fresh.creator, sats: total },
          { address: fresh.gasAddress, sats: RECEIPT_GAS },
        ]);
        owed.current -= count;
        setNote(`Paid ${total.toLocaleString('en-US')} sats for ${count.toLocaleString('en-US')} $TERRORNODE receipts. Sending…`);
        for (let i = 0; i < 8; i++) {
          const r = await fetch('/api/terrornode/receipts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ txid }) }).catch(() => null);
          const j = (await r?.json().catch(() => null)) as { ok?: boolean; count?: number; error?: string } | null;
          if (r?.ok && j?.ok) {
            setNote(`${(j.count ?? count).toLocaleString('en-US')} $TERRORNODE sent to ${a.shownAs}`);
            setQ(await quote());
            return;
          }
          if (r && ![404, 409, 500, 502].includes(r.status)) throw new Error(j?.error ?? `Receipts refused (${r.status}).`);
          await new Promise((ok) => setTimeout(ok, 3000 * (i + 1)));
        }
        setNote(`Receipts paid (tx ${txid.slice(0, 10)}…); the tokens are queued. Keep this txid.`);
      } catch (e) {
        setNote(e instanceof Error ? e.message : String(e));
      } finally {
        settling.current = false;
      }
    },
    [q],
  );

  return { q, live, curve, earned, note, shots, rangeCost, fired, settle, resetSession: () => setEarned(0) };
}
