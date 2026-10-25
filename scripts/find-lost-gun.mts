/**
 * One-time recovery helper for a lost browser gun (25 Oct 2026). READ-ONLY: it never signs, broadcasts or writes.
 * It prints addresses, txids and amounts only, never a key.
 *
 * 1. Give it the txids of your gun loads (from your wallet's history: "TokenBlaster: load …" / LOCK & LOAD payments),
 *    as arguments or a file with one txid per line. A load pays the gun in output 0 (src/lib/wallet.ts fund, outputs
 *    not randomised), so every P2PKH output is listed and output 0 is flagged as the load pattern.
 *    For each gun address it reports whether that output is still unspent, what the address holds now, and tokens.
 *
 *      pnpm tsx scripts/find-lost-gun.mts <txid> [<txid> …]
 *      pnpm tsx scripts/find-lost-gun.mts --txids loads.txt [--exclude 1YourOwnChangeAddr,…]
 *
 * 2. Optional: point it at a copy of Chrome's Local Storage leveldb (e.g. restored from Time Machine:
 *    ~/Library/Application Support/Google/Chrome/Default/Local Storage/leveldb). It looks for WIF-shaped strings,
 *    derives their addresses and prints ONLY which candidate gun addresses it found a key for, and in which file.
 *
 *      pnpm tsx scripts/find-lost-gun.mts --txids loads.txt --scan /path/to/copied/leveldb
 *
 *    Work on a COPY of the folder (never the live Chrome profile). If a key is found, import it by hand; this script
 *    never prints it.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { PrivateKey, Transaction, Utils } from '@bsv/sdk';

const WOC = 'https://api.whatsonchain.com/v1/bsv/main';
const GP = 'https://ordinals.gorillapool.io/api';

const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(name);
  if (i < 0) return null;
  const v = args[i + 1];
  args.splice(i, 2);
  return v ?? null;
};
const txidFile = opt('--txids');
const scanDir = opt('--scan');
const exclude = new Set((opt('--exclude') ?? '').split(',').filter(Boolean));
const txids = [...args, ...(txidFile ? readFileSync(txidFile, 'utf8').split(/\s+/) : [])].map((s) => s.trim().toLowerCase()).filter((s) => /^[0-9a-f]{64}$/.test(s));
if (!txids.length) {
  console.error('Give txids (arguments or --txids file). See the header of this script.');
  process.exit(1);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function getJson<T>(url: string): Promise<T | null> {
  for (let i = 0; i < 4; i++) {
    const r = await fetch(url).catch(() => null);
    if (r?.ok) return (await r.json()) as T;
    if (r && r.status !== 429) return null;
    await sleep(1000 * (i + 1));
  }
  return null;
}
async function txHex(txid: string): Promise<string | null> {
  const r = await fetch(`${WOC}/tx/${txid}/hex`).catch(() => null);
  if (r?.ok) return (await r.text()).trim();
  const g = await fetch(`${GP}/tx/${txid}/raw`).catch(() => null);
  if (!g?.ok) return null;
  return Utils.toHex(Array.from(new Uint8Array(await g.arrayBuffer())));
}

type Cand = { address: string; txid: string; vout: number; sats: number; loadPattern: boolean };
const cands: Cand[] = [];
for (const txid of txids) {
  const hex = await txHex(txid);
  if (!hex) {
    console.log(`? ${txid}: could not fetch`);
    continue;
  }
  const tx = Transaction.fromHex(hex);
  tx.outputs.forEach((o, vout) => {
    const chunks = o.lockingScript.chunks;
    // Plain P2PKH: OP_DUP OP_HASH160 <20> OP_EQUALVERIFY OP_CHECKSIG
    if (chunks.length !== 5 || chunks[0].op !== 0x76 || chunks[1].op !== 0xa9 || chunks[2].data?.length !== 20 || chunks[3].op !== 0x88 || chunks[4].op !== 0xac) return;
    const address = Utils.toBase58Check(chunks[2].data!, [0]);
    if (exclude.has(address)) return;
    cands.push({ address, txid, vout, sats: o.satoshis ?? 0, loadPattern: vout === 0 });
  });
}

const byAddr = new Map<string, Cand[]>();
for (const c of cands) byAddr.set(c.address, [...(byAddr.get(c.address) ?? []), c]);

console.log(`\n${byAddr.size} candidate gun address(es) from ${txids.length} tx(s):\n`);
for (const [address, list] of byAddr) {
  const unspent = (await getJson<{ tx_hash: string; tx_pos: number; value: number }[]>(`${WOC}/address/${address}/unspent`)) ?? [];
  const toks = (await getJson<{ id?: string; tick?: string; all?: { confirmed: string; pending: string } }[]>(`${GP}/bsv20/${address}/balance`)) ?? [];
  const held = unspent.reduce((n, u) => n + u.value, 0);
  console.log(`${address}${list.some((c) => c.loadPattern) ? '  [load pattern: output 0]' : ''}`);
  for (const c of list) {
    const live = unspent.some((u) => u.tx_hash === c.txid && u.tx_pos === c.vout);
    console.log(`  ${c.txid}:${c.vout}  ${c.sats.toLocaleString()} sats  ${live ? 'UNSPENT' : 'spent'}`);
  }
  console.log(`  now holds ${held.toLocaleString()} sats in ${unspent.length} output(s)`);
  for (const t of toks) if (t.all) console.log(`  token ${t.id ?? t.tick}: ${(BigInt(t.all.confirmed) + BigInt(t.all.pending)).toString()} (base units)`);
}

if (scanDir) {
  const want = new Set(byAddr.keys());
  const found = new Map<string, string>();
  const files: string[] = [];
  const walk = (d: string) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else files.push(p);
    }
  };
  walk(scanDir);
  let tried = 0;
  for (const f of files) {
    // leveldb may store the JSON as Latin-1 or UTF-16LE: try both views.
    const buf = readFileSync(f);
    for (const text of [buf.toString('latin1'), buf.toString('utf16le')]) {
      for (const m of text.matchAll(/[KL][1-9A-HJ-NP-Za-km-z]{51}|5[HJK][1-9A-HJ-NP-Za-km-z]{49}/g)) {
        let addr: string;
        try {
          addr = PrivateKey.fromWif(m[0]).toAddress();
        } catch {
          continue;
        }
        tried++;
        if (want.has(addr) && !found.has(addr)) found.set(addr, f);
        else if (!want.size && !found.has(addr)) found.set(addr, f);
      }
    }
  }
  console.log(`\nScanned ${files.length} file(s), ${tried} key-shaped string(s).`);
  if (!found.size) console.log('No key for any candidate gun address was found.');
  for (const [addr, f] of found) console.log(`KEY FOUND for ${addr} in ${f} (not printed; import it by hand)`);
}
