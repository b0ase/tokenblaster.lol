/**
 * GET ?txid=<transfer> → { beef, outputIndex } once the receipt transfer is mined: the transfer with its merkle proof
 * as Atomic BEEF (no ancestors needed), for the wallet to take in (src/lib/launch/receiveKey.ts). 202 until mined.
 * Source: WhatsOnChain /tx/<id>/beef (checked 1 Nov 2026 on 62e9b1c9…: proof root matches block 973528).
 */
import { NextResponse } from 'next/server';
import { Beef } from '@bsv/sdk';

export const dynamic = 'force-dynamic';
const WOC = 'https://api.whatsonchain.com/v1/bsv/main';

export async function GET(req: Request) {
  const txid = new URL(req.url).searchParams.get('txid') ?? '';
  if (!/^[0-9a-f]{64}$/.test(txid)) return NextResponse.json({ error: 'Bad txid.' }, { status: 400 });
  const raw = await fetch(`${WOC}/tx/${txid}/beef`, { cache: 'no-store' }).then((r) => (r.ok ? r.text() : null)).catch(() => null);
  const hex = raw?.trim().replace(/"/g, '') ?? '';
  if (!/^[0-9a-f]+$/i.test(hex)) return NextResponse.json({ error: 'Not mined yet.' }, { status: 202 });
  try {
    const tx = Beef.fromString(hex, 'hex').findAtomicTransaction(txid);
    if (!tx?.merklePath || tx.id('hex') !== txid) return NextResponse.json({ error: 'Not mined yet.' }, { status: 202 });
    return NextResponse.json({ beef: tx.toHexAtomicBEEF(), outputIndex: 0 });
  } catch {
    return NextResponse.json({ error: 'Not mined yet.' }, { status: 202 });
  }
}
