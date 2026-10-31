import type { ReactNode } from 'react';
import { GameShell } from '@/components/GameShell';
import { OldGuns } from './OldGuns';

export const metadata = {
  title: 'Find your game credit · TokenBlaster',
  description: 'Where your arcade game credit is, what it was spent on, and how to play it or send it back to your wallet.',
};

const STEPS: { title: string; body: ReactNode }[] = [
  {
    title: 'Use the same browser and the same address.',
    body: (
      <>
        <b className="text-white">www.tokenblaster.lol</b> and <b className="text-white">tokenblaster.lol</b> keep separate credit. So do private windows and
        browsers inside other apps. Open this page there.
      </>
    ),
  },
  {
    title: 'Press Connect in TERRORNODE.',
    body: 'Use the wallet you paid with. Your backed-up credit key comes back to this browser.',
  },
  {
    title: 'Saved a key file? Keep it safe.',
    body: 'Any BSV wallet that imports a private key can collect the credit from it.',
  },
  {
    title: 'Still missing? Message us.',
    body: 'Send the transaction id of your payment. That is all we need.',
  },
];

export default function GunRecoveryPage() {
  return (
    <GameShell title="Find your game credit" back="/arcade/terrornode" backLabel="TERRORNODE">
      <div className="mx-auto flex w-full max-w-[760px] flex-col gap-8 px-4 py-6 text-base leading-relaxed text-white/90 sm:py-10 sm:text-lg" data-recovery>
        <OldGuns />

        <section className="flex flex-col gap-4" aria-labelledby="not-here">
          <h2 id="not-here" className="text-2xl font-bold text-white sm:text-3xl">
            Not here?
          </h2>
          <ol className="flex flex-col gap-3">
            {STEPS.map((s, i) => (
              <li key={s.title} className="flex gap-4 rounded-xl border border-white/15 bg-white/[0.04] p-4">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--tbx-teal,#3fd8e8)] text-lg font-bold text-black" aria-hidden>
                  {i + 1}
                </span>
                <div className="flex flex-col gap-1">
                  <p className="font-bold text-white">{s.title}</p>
                  <p className="text-white/80">{s.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <p className="rounded-xl border-2 border-[#ff4d5e] bg-[#ff4d5e]/10 p-4 font-bold text-white">Never share a key with anyone. We will never ask for one.</p>

        <section className="flex flex-col gap-2 text-white/75" aria-labelledby="how">
          <h2 id="how" className="text-xl font-bold text-white">
            How game credit works
          </h2>
          <p>LOCK &amp; LOAD pays into a key kept in this browser. Only you hold it.</p>
          <p>The money stays at that key&apos;s address until you play it or UNLOAD it back to your wallet.</p>
          <p>Every shot is a real transaction. The history under each key shows where the credit went.</p>
        </section>
      </div>
    </GameShell>
  );
}
