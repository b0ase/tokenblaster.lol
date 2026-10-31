import { GameShell } from '@/components/GameShell';
import { OldGuns } from './OldGuns';

export const metadata = {
  title: 'Find your game credit · TokenBlaster',
  description: 'Where your arcade game credit lives and how to get it back to your wallet.',
};

export default function GunRecoveryPage() {
  return (
    <GameShell title="Find your game credit" back="/arcade/terrornode" backLabel="TERRORNODE">
      <div className="panel mx-auto flex max-w-[720px] flex-col gap-4 p-5 text-sm">
        <p>
          LOCK &amp; LOAD pays into your own game credit: a key kept in this browser. The money sits on chain at that key&apos;s
          address until you play it or UNLOAD it back to your wallet. Nobody else holds it, so it is not lost when a game fails
          to load; it just has to be found on the right device.
        </p>
        <ol className="flex list-decimal flex-col gap-2 pl-5">
          <li>
            Use the same browser and the same site address you paid from. <b>www.tokenblaster.lol</b> and <b>tokenblaster.lol</b>, a
            private window, or the browser inside another app each keep their own storage.
          </li>
          <li>
            Open TERRORNODE and press <b>Connect</b> or <b>LOCK &amp; LOAD</b> with the same wallet. After your first paid load the
            key is backed up, encrypted by your wallet, and a browser without it restores it then.
          </li>
          <li>If you saved a key file with &quot;Back up gun key&quot;, keep it: any BSV wallet that imports a private key can sweep it.</li>
          <li>Still missing? Message us with your wallet&apos;s payment transaction id. Never send anyone a key.</li>
        </ol>
        <section className="flex flex-col gap-2">
          <h2 className="font-bold">Game credit keys in this browser</h2>
          <OldGuns />
        </section>
      </div>
    </GameShell>
  );
}
