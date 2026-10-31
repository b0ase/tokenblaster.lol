'use client';
/**
 * "Send back to my wallet" for one stored game-credit key (owner, 31 Oct 2026): reads every coin at its address
 * (src/lib/gunKeys.ts chainCoins), builds one sweep (src/lib/sweep.ts), shows the amount and the destination, and
 * broadcasts only after the player confirms. The key never leaves this browser.
 */
import { useState, useSyncExternalStore } from 'react';
import { ARC, PrivateKey, Transaction } from '@bsv/sdk';
import { chainCoins, gunKeysForSweep } from '@/lib/gunKeys';
import { buildSweep } from '@/lib/sweep';
import { getSiteWallet, openSiteWallet, subSiteWallet } from '@/lib/siteWallet';

type Step = { k: 'idle' } | { k: 'reading' } | { k: 'confirm'; tx: Transaction; sats: number; inputs: number; to: string } | { k: 'sending' } | { k: 'done'; txid: string } | { k: 'err'; text: string };

export function SendBack({ address }: { address: string }) {
  const site = useSyncExternalStore(subSiteWallet, getSiteWallet, () => null);
  const wallet = site?.wallet ?? null;
  const [step, setStep] = useState<Step>({ k: 'idle' });

  const prepare = async () => {
    const w = wallet ?? (await openSiteWallet());
    if (!w) return setStep({ k: 'err', text: 'Connect your wallet first. The credit goes back to its address.' });
    const key = gunKeysForSweep().find((k) => k.address === address);
    if (!key) return setStep({ k: 'err', text: 'This key is not stored in this browser any more.' });
    setStep({ k: 'reading' });
    try {
      const list = await chainCoins(address);
      const coins = list.filter((c) => c.hex).map((c) => ({ tx: Transaction.fromHex(c.hex!), vout: c.vout }));
      const built = await buildSweep(PrivateKey.fromWif(key.wif), coins, w.address);
      if (!built) return setStep({ k: 'err', text: 'Nothing here is worth more than the network fee to move.' });
      setStep({ k: 'confirm', ...built, to: w.address });
    } catch (e) {
      setStep({ k: 'err', text: e instanceof Error ? e.message : 'Could not read this key.' });
    }
  };
  const send = async (tx: Transaction) => {
    setStep({ k: 'sending' });
    const r = await tx.broadcast(new ARC('https://arc.gorillapool.io')).catch((e: unknown) => ({ status: 'error', description: String(e) }) as const);
    if (r.status === 'success') setStep({ k: 'done', txid: tx.id('hex') });
    else setStep({ k: 'err', text: `The network did not take it: ${'description' in r ? r.description : 'unknown error'}. Nothing was sent. Try again.` });
  };

  if (step.k === 'confirm')
    return (
      <div className="flex flex-col gap-2 rounded-lg border border-white/25 bg-black/40 p-3" role="alertdialog" aria-label="Confirm send back">
        <p className="text-white">
          Send <b>{step.sats.toLocaleString('en-US')} sats</b> to your wallet
          {wallet ? ` (${wallet.name})` : ''}:
        </p>
        <p className="break-all font-mono text-sm text-white/85">{step.to}</p>
        <p className="text-sm text-white/65">{step.inputs.toLocaleString('en-US')} coins, network fee included. Coins worth less than their fee stay.</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-on px-4 py-2 font-bold" onClick={() => void send(step.tx)}>
            Yes, send it
          </button>
          <button type="button" className="btn px-4 py-2" onClick={() => setStep({ k: 'idle' })}>
            Cancel
          </button>
        </div>
      </div>
    );
  return (
    <div className="flex flex-col gap-1" data-send-back>
      <button type="button" className="btn px-4 py-2 self-start" disabled={step.k === 'reading' || step.k === 'sending'} onClick={() => void prepare()}>
        {step.k === 'reading' ? 'Reading coins…' : step.k === 'sending' ? 'Sending…' : 'Send back to my wallet'}
      </button>
      {step.k === 'done' && (
        <p className="text-[var(--tbx-teal,#3fd8e8)]">
          Sent.{' '}
          <a className="underline underline-offset-2" href={`https://whatsonchain.com/tx/${step.txid}`} target="_blank" rel="noopener noreferrer">
            See the transaction
          </a>
        </p>
      )}
      {step.k === 'err' && <p className="text-[#ff8a95]">{step.text}</p>}
    </div>
  );
}
