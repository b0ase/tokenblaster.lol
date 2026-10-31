'use client';
/**
 * Gun safety (agreed with bWalletX, 25 Oct 2026): one clear UNLOAD that sends everything still in the browser gun
 * (unused tokens and unused sats) back to the player's wallet, behind a plain confirmation of what's coming back,
 * plus the plain line about where the gun's key lives.
 */
import { useState } from 'react';
import { GUN_KEY_NOTE } from '@/lib/tokenLoad';
import { fmtCredit } from '@/lib/coinop/credit';
import { showUnload, unloadLabel } from '@/lib/coinop/playButton';
import { CREDIT_UNKNOWN_LINE, RECOVERY_URL, missingCreditLine } from '@/lib/coinop/creditSafe';
import type { useBlaster } from '@/lib/useBlaster';

type Blaster = ReturnType<typeof useBlaster>;

export function GunKeyNote({ className = 'text-xs text-dim' }: { className?: string }) {
  return (
    <p className={className} data-gun-key-note>
      {GUN_KEY_NOTE}
    </p>
  );
}

/**
 * "Back up gun key": the WIF is shown (and can be saved as a file) only after an explicit confirm with a warning.
 * It is never logged. The gun is also backed up automatically, encrypted by the player's wallet (src/lib/gunBackup.ts).
 */
export function GunKeyBackup({ b }: { b: Blaster }) {
  const [step, setStep] = useState<'idle' | 'confirm' | 'shown'>('idle');
  const [wif, setWif] = useState<string | null>(null);
  if (b.gunLocked) return null;
  const hide = () => {
    setWif(null);
    setStep('idle');
  };
  const download = (k: string) => {
    const url = URL.createObjectURL(new Blob([`TokenBlaster gun key (WIF). Anyone with this controls the gun's coins.\naddress: ${b.gunAddress}\nkey: ${k}\n`], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `tokenblaster-gun-${b.gunAddress.slice(0, 8)}.txt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  if (step === 'idle')
    return (
      <button type="button" className="btn px-2 py-0.5 text-xs" data-gun-key-backup onClick={() => setStep('confirm')}>
        Back up gun key
      </button>
    );
  if (step === 'confirm')
    return (
      <div className="flex flex-col gap-1 text-xs" data-gun-key-backup>
        <span className="font-bold">Warning: anyone who sees this key can take everything in the gun. Never share it or paste it into a site. Show it only somewhere private.</span>
        <div className="flex gap-2">
          <button
            type="button"
            className="btn px-2 py-0.5 text-xs font-bold"
            onClick={() => {
              setWif(b.exportGunKey());
              setStep('shown');
            }}
          >
            I understand, show the key
          </button>
          <button type="button" className="btn px-2 py-0.5 text-xs" onClick={hide}>
            Cancel
          </button>
        </div>
      </div>
    );
  return (
    <div className="flex flex-col gap-1 text-xs" data-gun-key-backup>
      <input readOnly className="font-mono text-[10px]" value={wif ?? ''} onFocus={(e) => e.currentTarget.select()} aria-label="Gun key (WIF)" />
      <div className="flex gap-2">
        {wif && (
          <button type="button" className="btn px-2 py-0.5 text-xs" onClick={() => download(wif)}>
            Download
          </button>
        )}
        <button type="button" className="btn px-2 py-0.5 text-xs" onClick={hide}>
          Hide
        </button>
      </div>
    </div>
  );
}

/**
 * Credit that can't be seen is said out loud (owner, 31 Oct 2026): a chain read that failed ("unknown", not $0.00) and
 * a restore that found the wallet's earlier credit but couldn't bring it here, with the recovery steps.
 */
export function CreditNotices({ b }: { b: Blaster }) {
  if (!b.creditUnknown && !b.gunMissing) return null;
  return (
    <div className="flex flex-col gap-1 text-xs" data-credit-notice>
      {b.creditUnknown && (
        <span className="text-[var(--tbx-amber)]" data-credit-unknown>
          {CREDIT_UNKNOWN_LINE}{' '}
          <button type="button" className="underline underline-offset-2" onClick={() => void b.refreshGun('credit retry pressed')}>
            Check now
          </button>
        </span>
      )}
      {b.gunMissing && (
        <span data-credit-missing>
          <span className="font-bold">{missingCreditLine(b.gunMissing)}</span>{' '}
          <a href={RECOVERY_URL} className="underline underline-offset-2">
            Recovery steps
          </a>
        </span>
      )}
    </div>
  );
}

/** The stored gun could not be read: never a new key over it. Restore it from the wallet backup. */
export function GunLocked({ b }: { b: Blaster }) {
  if (!b.gunLocked) return null;
  return (
    <div className="flex flex-col gap-1 text-xs" data-gun-locked>
      <span className="font-bold">Gun locked: restore from wallet</span>
      <span className="text-dim">This browser&apos;s gun record could not be read. It has been kept as it is; nothing loads into the gun until it is restored.</span>
      <button type="button" className="btn px-2 py-0.5 text-xs font-bold" disabled={!b.wallet} onClick={() => void b.syncBackup()}>
        {b.wallet ? 'Restore from wallet' : 'Connect your wallet to restore'}
      </button>
    </div>
  );
}

export function GunUnload({ b, disabled = false, className = '' }: { b: Blaster; disabled?: boolean; className?: string }) {
  const [asking, setAsking] = useState(false);
  if (b.gunLocked) return <GunLocked b={b} />;
  // No wallet yet: show the control disabled with a hint, so copy that mentions UNLOAD always has a button to point at.
  if (!b.wallet)
    return (
      <div className={`flex flex-col gap-1 ${className}`} data-gun-unload>
        <button type="button" className="btn px-2 py-0.5 text-xs font-bold" disabled>
          UNLOAD to my wallet
        </button>
        <span className="text-[10px] text-dim">Connect your wallet with LOCK &amp; LOAD first.</span>
      </div>
    );
  const toks = b.gunTokens.filter((t) => t.amt > BigInt(0));
  const empty = !toks.length && b.ammo <= 0;
  const busy = b.busy === 'unloading';
  const what = [
    ...toks.map((t) => {
      const sym = b.tokens.find((x) => x.id === t.id)?.sym;
      return `${t.amt.toLocaleString()} base units of ${sym ? `$${sym}` : `token ${t.id.slice(0, 8)}…`}`;
    }),
    ...(b.ammo > 0 ? [`about ${b.ammo.toLocaleString()} sats (less the network fee)`] : []),
  ];
  return (
    <div className={`flex flex-col gap-1 ${className}`} data-gun-unload>
      {!asking ? (
        <button type="button" className="btn px-2 py-0.5 text-xs font-bold" disabled={disabled || busy || empty || !!b.busy} onClick={() => setAsking(true)}>
          {busy ? 'UNLOADING…' : empty ? 'Gun is empty' : 'UNLOAD to my wallet'}
        </button>
      ) : (
        <div className="flex flex-col gap-1 text-xs">
          <span>Coming back to {b.wallet.name}: {what.join(' and ')}.</span>
          <div className="flex gap-2">
            <button
              type="button"
              className="btn px-2 py-0.5 text-xs font-bold"
              disabled={busy}
              onClick={() => {
                setAsking(false);
                void b.unload();
              }}
            >
              Yes, unload
            </button>
            <button type="button" className="btn px-2 py-0.5 text-xs" onClick={() => setAsking(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      <GunKeyBackup b={b} />
    </div>
  );
}

/**
 * The always-visible UNLOAD (owner, 25 Oct 2026, after #95): wherever the gun has credit, one plain button
 * "UNLOAD $x.xx → wallet" that returns the sats and any tokens. A live round is ended first, behind a confirm.
 * `endRound` (live only) ends the round and runs the unload once play has stopped; without it, it unloads at once.
 */
export function UnloadButton({ b, creditUsd, live = false, endRound, className = '' }: { b: Blaster; creditUsd: number; live?: boolean; endRound?: () => void; className?: string }) {
  const [asking, setAsking] = useState(false);
  const toks = b.gunTokens.filter((t) => t.amt > BigInt(0)).length;
  if (!showUnload(creditUsd, toks) || b.gunLocked) return null;
  const busy = b.busy === 'unloading';
  const go = () => {
    setAsking(false);
    if (live && endRound) return endRound();
    if (!b.wallet) return void b.connectWallet(); // a press: connecting is allowed now; press UNLOAD again after
    void b.unload();
  };
  return (
    <div className={`flex flex-col items-center gap-1 ${className}`} data-unload-button>
      {!asking ? (
        <button type="button" className="btn px-3 py-1 text-xs font-bold tracking-wider" disabled={busy || !!b.busy} onClick={() => setAsking(true)}>
          {busy ? 'UNLOADING…' : unloadLabel(creditUsd)}
        </button>
      ) : (
        <div className="flex flex-col items-center gap-1 text-xs" role="alertdialog" aria-label="Confirm unload">
          <span>
            {live ? 'This ends the round. ' : ''}
            {b.wallet ? `Send ${fmtCredit(creditUsd)}${toks ? ' and your tokens' : ''} back to ${b.wallet.name}?` : 'Connect your wallet first, then UNLOAD sends it back.'}
          </span>
          <div className="flex gap-2">
            <button type="button" className="btn btn-on px-2 py-0.5 text-xs font-bold" onClick={go}>
              {live ? 'End round & unload' : b.wallet ? 'Yes, unload' : 'Connect'}
            </button>
            <button type="button" className="btn px-2 py-0.5 text-xs" onClick={() => setAsking(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
